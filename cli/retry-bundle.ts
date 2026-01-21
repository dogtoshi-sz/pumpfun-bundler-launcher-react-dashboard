import { VersionedTransaction, Keypair, Connection, ComputeBudgetProgram, TransactionMessage, PublicKey, TransactionInstruction, AddressLookupTableAccount, SystemProgram, sendAndConfirmTransaction } from "@solana/web3.js"
import base58 from "bs58"
import fs from "fs"
import path from "path"
import dotenv from 'dotenv';
dotenv.config({ override: true });

import { PRIVATE_KEY, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, LIL_JIT_MODE, BUYER_WALLET, BUNDLE_SWAP_AMOUNTS, SWAP_AMOUNT, SWAP_AMOUNTS, JITO_FEE, BUYER_AMOUNT } from "../constants"
import { createTokenTx, makeBuyIx } from "../src/main"
import { executeJitoTx } from "../executor/jito"
import { sendBundle } from "../executor/liljito"

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: "confirmed"
})

const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))

async function retryBundle() {
  console.log("🔄 RETRYING FAILED BUNDLE\n")
  
  // Read current-run.json to get wallets and mint address
  const currentRunPath = path.join(process.cwd(), 'keys', 'current-run.json')
  if (!fs.existsSync(currentRunPath)) {
    console.error("❌ No current-run.json found. Cannot retry bundle.")
    console.error("   Run a token launch first.")
    return
  }
  
  const currentRunData = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'))
  let mintAddress = currentRunData.mintAddress
  
  console.log(`📋 Current Run Info:`)
  console.log(`   Status: ${currentRunData.launchStatus || 'FAILED'}`)
  
  // Load wallets from current-run.json
  let bundleWallets: Keypair[] = []
  let creatorDevWallet: Keypair | null = null
  let mintKp: Keypair | null = null
  
  if (currentRunData.bundleWalletKeys && Array.isArray(currentRunData.bundleWalletKeys)) {
    bundleWallets = currentRunData.bundleWalletKeys.map((kp: string) => 
      Keypair.fromSecretKey(base58.decode(kp))
    )
    console.log(`   ✅ Loaded ${bundleWallets.length} bundle wallets`)
  } else {
    console.error("❌ No bundle wallets found in current-run.json")
    return
  }
  
  // Load creator/DEV wallet
  if (currentRunData.creatorDevWalletKey) {
    creatorDevWallet = Keypair.fromSecretKey(base58.decode(currentRunData.creatorDevWalletKey))
    console.log(`   ✅ Loaded creator/DEV wallet: ${creatorDevWallet.publicKey.toBase58()}`)
  } else if (BUYER_WALLET && BUYER_WALLET.trim() !== '') {
    creatorDevWallet = Keypair.fromSecretKey(base58.decode(BUYER_WALLET))
    console.log(`   ✅ Using BUYER_WALLET from .env: ${creatorDevWallet.publicKey.toBase58()}`)
  } else {
    console.error("❌ No creator/DEV wallet found")
    return
  }
  
  // Load mint keypair (needed for token creation transaction)
  const mintJsonPath = path.join(process.cwd(), 'keys', 'mint.json')
  if (!fs.existsSync(mintJsonPath)) {
    // Try root directory as fallback
    const rootMintPath = path.join(process.cwd(), 'mint.json')
    if (fs.existsSync(rootMintPath)) {
      const mintData = JSON.parse(fs.readFileSync(rootMintPath, 'utf8'))
      if (mintData && mintData[0]) {
        mintKp = Keypair.fromSecretKey(base58.decode(mintData[0]))
        console.log(`   ✅ Loaded mint keypair from root: ${mintKp.publicKey.toBase58()}`)
      }
    }
  } else {
    const mintData = JSON.parse(fs.readFileSync(mintJsonPath, 'utf8'))
    if (mintData && mintData[0]) {
      mintKp = Keypair.fromSecretKey(base58.decode(mintData[0]))
      console.log(`   ✅ Loaded mint keypair: ${mintKp.publicKey.toBase58()}`)
    }
  }
  
  if (!mintKp) {
    console.error("❌ Could not load mint keypair from keys/mint.json or mint.json")
    return
  }
  
  // If mintAddress is null, derive it from mint keypair
  if (!mintAddress) {
    mintAddress = mintKp.publicKey.toBase58()
    console.log(`   ⚠️  No mint address in current-run.json, using mint from mint.json: ${mintAddress}`)
  } else {
    // Verify mint address matches
    if (mintKp.publicKey.toBase58() !== mintAddress) {
      console.error(`❌ Mint address mismatch!`)
      console.error(`   Expected: ${mintAddress}`)
      console.error(`   Got: ${mintKp.publicKey.toBase58()}`)
      console.error(`   Using mint from mint.json: ${mintKp.publicKey.toBase58()}`)
      mintAddress = mintKp.publicKey.toBase58() // Use the one from mint.json
    }
  }
  
  console.log(`   Mint: ${mintAddress}`)
  
  // Get bundle wallet amounts
  let bundleSwapAmounts: number[] = []
  if (BUNDLE_SWAP_AMOUNTS.length > 0) {
    bundleSwapAmounts = [...BUNDLE_SWAP_AMOUNTS].slice(0, bundleWallets.length)
    while (bundleSwapAmounts.length < bundleWallets.length) {
      bundleSwapAmounts.push(SWAP_AMOUNT)
    }
  } else if (SWAP_AMOUNTS.length > 0) {
    bundleSwapAmounts = [...SWAP_AMOUNTS].slice(0, bundleWallets.length)
    while (bundleSwapAmounts.length < bundleWallets.length) {
      bundleSwapAmounts.push(SWAP_AMOUNT)
    }
  } else {
    bundleSwapAmounts = Array(bundleWallets.length).fill(SWAP_AMOUNT)
  }
  
  console.log(`\n💰 Bundle Wallet Amounts: [${bundleSwapAmounts.map(a => a.toFixed(2)).join(', ')}] SOL`)
  
  // Check wallet balances
  console.log(`\n🔍 Checking wallet balances...`)
  for (let i = 0; i < bundleWallets.length; i++) {
    const balance = await connection.getBalance(bundleWallets[i].publicKey)
    const solBalance = balance / 1e9
    console.log(`   Bundle Wallet ${i}: ${solBalance.toFixed(4)} SOL (need ~${(bundleSwapAmounts[i] + 0.01).toFixed(4)} SOL)`)
    
    if (solBalance < bundleSwapAmounts[i] + 0.01) {
      console.error(`   ⚠️  Wallet ${i} has insufficient balance!`)
    }
  }
  
  const creatorBalance = await connection.getBalance(creatorDevWallet.publicKey)
  const creatorBalanceSol = creatorBalance / 1e9
  console.log(`   Creator/DEV Wallet: ${creatorBalanceSol.toFixed(4)} SOL`)
  
  // Check if DEV wallet needs funding (only if it was auto-created)
  // If BUYER_WALLET was set in .env, user is responsible for funding it
  // Compute fees are tiny: 5M units * 20k microLamports = 0.0001 SOL
  // But we need extra buffer since buy might use most of the balance
  const devRequiredAmount = BUYER_AMOUNT + 0.1 // BUYER_AMOUNT + 0.1 SOL buffer for fees/rent/safety
  const isAutoCreated = currentRunData.creatorDevWalletKey && (!BUYER_WALLET || BUYER_WALLET.trim() === '')
  
  if (isAutoCreated && creatorBalanceSol < devRequiredAmount) {
    const fundingAmount = devRequiredAmount - creatorBalanceSol
    console.log(`\n💰 Funding DEV wallet with ${fundingAmount.toFixed(4)} SOL...`)
    console.log(`   Breakdown: ${BUYER_AMOUNT.toFixed(4)} SOL (buy) + 0.1 SOL (buffer for fees/rent/safety)`)
    try {
      const mainBalance = await connection.getBalance(mainKp.publicKey)
      const mainBalanceSol = mainBalance / 1e9
      if (mainBalanceSol < fundingAmount + 0.01) {
        console.error(`   ❌ Main wallet has insufficient balance (${mainBalanceSol.toFixed(4)} SOL)`)
        console.error(`   Need at least ${(fundingAmount + 0.01).toFixed(4)} SOL to fund DEV wallet`)
        return
      }
      
      const fundingLamports = Math.ceil(fundingAmount * 1e9)
      const latestBlockhash = await connection.getLatestBlockhash()
      const transferMsg = new TransactionMessage({
        payerKey: mainKp.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: [
          SystemProgram.transfer({
            fromPubkey: mainKp.publicKey,
            toPubkey: creatorDevWallet.publicKey,
            lamports: fundingLamports
          })
        ]
      }).compileToV0Message()
      
      const transferTx = new VersionedTransaction(transferMsg)
      transferTx.sign([mainKp])
      
      const sig = await connection.sendTransaction(transferTx, { skipPreflight: false, maxRetries: 3 })
      await connection.confirmTransaction(sig, 'confirmed')
      
      const newBalance = await connection.getBalance(creatorDevWallet.publicKey)
      console.log(`   ✅ Funded DEV wallet! New balance: ${(newBalance / 1e9).toFixed(4)} SOL`)
      console.log(`   Transaction: https://solscan.io/tx/${sig}`)
    } catch (error: any) {
      console.error(`   ❌ Failed to fund DEV wallet: ${error.message}`)
      return
    }
  } else {
    console.log(`   ✅ DEV wallet has sufficient balance`)
  }
  
  // Check if token already exists on-chain
  console.log(`\n🔍 Checking if token already exists on-chain...`)
  const mintPublicKey = new PublicKey(mintAddress)
  let tokenExists = false
  try {
    const mintInfo = await connection.getAccountInfo(mintPublicKey)
    tokenExists = mintInfo !== null
    if (tokenExists) {
      console.log(`   ✅ Token already exists on-chain - will skip token creation`)
    } else {
      console.log(`   ⚠️  Token does not exist yet - will include token creation`)
    }
  } catch (error) {
    console.log(`   ⚠️  Could not verify token existence - will include token creation`)
  }
  
  // Load lookup table if it exists (needed for buys)
  let lookupTable: AddressLookupTableAccount | null = null
  const lutJsonPath = path.join(process.cwd(), 'keys', 'lut.json')
  if (!fs.existsSync(lutJsonPath)) {
    // Try root directory as fallback
    const rootLutPath = path.join(process.cwd(), 'lut.json')
    if (fs.existsSync(rootLutPath)) {
      try {
        const lutData = JSON.parse(fs.readFileSync(rootLutPath, 'utf8'))
        if (lutData && lutData[0]) {
          const lutAddress = new PublicKey(lutData[0])
          const lutResult = await connection.getAddressLookupTable(lutAddress)
          lookupTable = lutResult.value
          if (lookupTable) {
            console.log(`   ✅ Loaded lookup table from root: ${lutAddress.toBase58()}`)
          } else {
            console.log(`   ⚠️  Lookup table not ready yet`)
          }
        }
      } catch (error) {
        console.log(`   ⚠️  Could not load lookup table: ${error}`)
      }
    }
  } else {
    try {
      const lutData = JSON.parse(fs.readFileSync(lutJsonPath, 'utf8'))
      if (lutData && lutData[0]) {
        const lutAddress = new PublicKey(lutData[0])
        const lutResult = await connection.getAddressLookupTable(lutAddress)
        lookupTable = lutResult.value
        if (lookupTable) {
          console.log(`   ✅ Loaded lookup table: ${lutAddress.toBase58()}`)
        } else {
          console.log(`   ⚠️  Lookup table not ready yet`)
        }
      }
    } catch (error) {
      console.log(`   ⚠️  Could not load lookup table: ${error}`)
    }
  }
  
  // Rebuild bundle transactions
  console.log(`\n🔨 Rebuilding bundle transactions...`)
  const transactions: VersionedTransaction[] = []
  
  // Get fresh blockhash
  console.log("Getting fresh blockhash for bundle...")
  const latestBlockhash = await connection.getLatestBlockhash()
  console.log(`Using blockhash: ${latestBlockhash.blockhash.slice(0, 8)}... (valid until block ${latestBlockhash.lastValidBlockHeight})`)
  
  // Only create token creation transaction if token doesn't exist
  if (!tokenExists) {
    const tokenCreationIxs = await createTokenTx(creatorDevWallet, mintKp, mainKp)
    
    // CRITICAL: For pump.fun, the PAYER is the CREATOR
    // The creator wallet (creatorDevWallet) must be the payer, not the funding wallet (mainKp)
    // The funding wallet can still pay for fees by transferring SOL to creatorDevWallet first, but creatorDevWallet must be the transaction payer
    const tokenCreationTx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: creatorDevWallet.publicKey, // CRITICAL: Creator wallet must be payer for pump.fun
        recentBlockhash: latestBlockhash.blockhash,
        instructions: tokenCreationIxs
      }).compileToV0Message()
    )
    // CRITICAL: Creator (creatorDevWallet) signs as payer and creator
    // Mint (mintKp) signs as the mint authority
    // Note: mainKp is NOT a signer - creatorDevWallet pays for everything
    tokenCreationTx.sign([creatorDevWallet, mintKp])
    transactions.push(tokenCreationTx)
    console.log(`   ✅ Token creation transaction ready`)
  } else {
    console.log(`   ⏭️  Skipping token creation (token already exists)`)
  }
  
  // Create DEV buy transaction
  const devBuyAmountLamports = Math.floor(BUYER_AMOUNT * 10 ** 9)
  const devBuyIx = await makeBuyIx(creatorDevWallet, devBuyAmountLamports, 0, creatorDevWallet.publicKey, mintKp.publicKey)
  
  const devBuyMsg = new TransactionMessage({
    payerKey: creatorDevWallet.publicKey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 5_000_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }),
      ...devBuyIx
    ]
  })
  
  const devBuyTx = new VersionedTransaction(
    lookupTable ? devBuyMsg.compileToV0Message([lookupTable]) : devBuyMsg.compileToV0Message()
  )
  devBuyTx.sign([creatorDevWallet])
  transactions.push(devBuyTx)
  console.log(`   ✅ DEV buy transaction ready`)
  
  // Create bundle wallet buy transactions
  const buyIxsByWallet: { [walletIndex: number]: TransactionInstruction[] } = {}
  for (let i = 0; i < bundleWallets.length; i++) {
    const buyAmountLamports = Math.floor(bundleSwapAmounts[i] * 10 ** 9)
    const buyIx = await makeBuyIx(bundleWallets[i], buyAmountLamports, i, creatorDevWallet.publicKey, mintKp.publicKey)
    buyIxsByWallet[i] = buyIx
  }
  
  // Create bundle transactions (4 wallets per transaction)
  for (let i = 0; i < Math.ceil(bundleWallets.length / 4); i++) {
    const instructions: TransactionInstruction[] = []
    const signers: Keypair[] = []
    
    for (let j = 0; j < 4; j++) {
      const index = i * 4 + j
      if (index < bundleWallets.length && bundleWallets[index] && buyIxsByWallet[index]) {
        instructions.push(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 5_000_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }),
          ...buyIxsByWallet[index]
        )
        signers.push(bundleWallets[index])
      }
    }
    
    if (instructions.length > 0) {
      const msg = new TransactionMessage({
        payerKey: bundleWallets[i * 4].publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions
      })
      
      const tx = new VersionedTransaction(
        lookupTable ? msg.compileToV0Message([lookupTable]) : msg.compileToV0Message()
      )
      
      tx.sign(signers)
      transactions.push(tx)
      console.log(`   ✅ Bundle transaction ${i + 1}: ${signers.length} wallet(s)`)
    }
  }
  
  console.log(`\n📦 Bundle ready: ${transactions.length} transactions`)
  if (!tokenExists) {
    console.log(`   1. Token Creation`)
    console.log(`   2. DEV Buy`)
    console.log(`   3-${transactions.length}. Bundle Wallet Buys (${bundleWallets.length} wallets)`)
  } else {
    console.log(`   1. DEV Buy`)
    console.log(`   2-${transactions.length}. Bundle Wallet Buys (${bundleWallets.length} wallets)`)
  }
  
  // Send bundle
  console.log(`\n🚀 Sending bundle via Jito...`)
  let bundleSuccess = false
  
  if (LIL_JIT_MODE) {
    const bundleId = await sendBundle(transactions)
    if (bundleId) {
      console.log(`✅ Bundle sent successfully with ID: ${bundleId}`)
      bundleSuccess = true
    } else {
      console.error("❌ Bundle sending failed")
    }
  } else {
    const result = await executeJitoTx(transactions, mainKp, "confirmed", latestBlockhash)
    if (result) {
      console.log(`✅ Bundle executed successfully, signature: ${result}`)
      bundleSuccess = true
    } else {
      console.error("❌ Jito bundle execution failed")
    }
  }
  
  if (bundleSuccess) {
    console.log(`\n✅ Bundle retry completed successfully!`)
    console.log(`   Check Solscan for transaction confirmations`)
  } else {
    console.log(`\n❌ Bundle retry failed. You can run this script again to retry.`)
  }
}

retryBundle().catch((error) => {
  console.error("❌ Fatal error:", error)
  process.exit(1)
})

