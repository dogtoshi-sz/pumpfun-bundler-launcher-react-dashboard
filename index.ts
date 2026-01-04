import { VersionedTransaction, Keypair, Connection, ComputeBudgetProgram, TransactionInstruction, TransactionMessage, PublicKey, SystemProgram } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID } from "@solana/spl-token"
import { SPL_ACCOUNT_LAYOUT } from "@raydium-io/raydium-sdk"
import base58 from "bs58"
import fs from "fs"
import path from "path"
import dotenv from 'dotenv'

// CRITICAL: Force reload .env file with override to get latest values
// This ensures we read the .env file that was just updated by the API server
const rootEnvPath = path.join(process.cwd(), '.env')
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath, override: true })
  console.log(`[index.ts] Reloaded .env file from: ${rootEnvPath}`)
} else {
  dotenv.config({ override: true })
  console.log(`[index.ts] Using default .env location`)
}

import { DISTRIBUTION_WALLETNUM, LIL_JIT_MODE, PRIVATE_KEY, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, SWAP_AMOUNT, SWAP_AMOUNTS, VANITY_MODE, BUYER_AMOUNT, AUTO_RAPID_SELL, AUTO_GATHER, BUNDLE_WALLET_COUNT, BUNDLE_SWAP_AMOUNTS, HOLDER_WALLET_COUNT, HOLDER_SWAP_AMOUNTS, HOLDER_WALLET_AMOUNT, USE_NORMAL_LAUNCH, WEBSOCKET_TRACKING_ENABLED, WEBSOCKET_EXTERNAL_BUY_THRESHOLD, WEBSOCKET_EXTERNAL_BUY_WINDOW, WEBSOCKET_ULTRA_FAST_MODE, AUTO_SELL_50_PERCENT } from "./constants"

// CRITICAL: Read BUYER_WALLET directly from process.env AFTER reloading .env
// This ensures we get the latest value even if it was just updated
const BUYER_WALLET = process.env.BUYER_WALLET || ''
import { generateVanityAddress, saveDataToFile, sleep, getNextPumpAddress, markPumpAddressAsUsed } from "./utils"
import { createTokenTx, distributeSol, createLUT, makeBuyIx, addAddressesToTableMultiExtend, fundExistingWalletWithMixing, loadMixingWallets } from "./src/main";
import { USE_MIXING_WALLETS } from "./constants/constants";
import { executeJitoTx, stopJitoRetries } from "./executor/jito";
import { sendBundle } from "./executor/liljito";
import { updateWebsite, createTelegramGroup, postToTwitter } from "./utils/marketing-helpers";



const commitment = "confirmed"

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT, commitment
})
const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))
console.log("mainKp", mainKp.publicKey.toBase58());
let kps: Keypair[] = []
const transactions: VersionedTransaction[] = []

// Support for pregenerated mint keypair
// Priority: 1) MINT_PRIVATE_KEY env var, 2) Pump address pool, 3) Vanity mode, 4) Generate new
let mintKp: Keypair
if (process.env.MINT_PRIVATE_KEY) {
  console.log("📌 Using pregenerated mint keypair from MINT_PRIVATE_KEY")
  mintKp = Keypair.fromSecretKey(base58.decode(process.env.MINT_PRIVATE_KEY))
  console.log("mintKp (pregenerated from env):", mintKp.publicKey.toBase58())
} else {
  mintKp = Keypair.generate()
  console.log("mintKp (new):", mintKp.publicKey.toBase58())
}


const main = async () => {
  // Define path to current-run.json
  const keysPath = path.join(process.cwd(), 'keys', 'current-run.json')
  
  // Track if we used a pump address from pool (to mark as used after successful launch)
  let usedPumpAddressPublicKey: string | null = null
  
  // Priority order for mint keypair:
  // 1. MINT_PRIVATE_KEY env variable (already handled above)
  // 2. Pump address pool (pregenerated pump addresses)
  // 3. Vanity mode (generate new with "pump" suffix)
  // 4. Generate new random keypair (default)
  
  if (!process.env.MINT_PRIVATE_KEY) {
    // Try to get from pump address pool first
    const pumpAddress = getNextPumpAddress()
    if (pumpAddress) {
      mintKp = pumpAddress.keypair
      usedPumpAddressPublicKey = pumpAddress.publicKey
      console.log(`🎯 Using pregenerated pump address from pool: ${pumpAddress.publicKey}`)
      console.log(`   This address will be marked as used after successful launch`)
    } else if (VANITY_MODE) {
      // Generate vanity address if enabled and no pool address available
      console.log("🔍 No pump addresses in pool, generating vanity address...")
      const result = generateVanityAddress("pump");
      // Handle both sync and async returns
      if (result instanceof Promise) {
        const { keypair, pubkey } = await result;
        mintKp = keypair;
        console.log(`✅ Keypair generated with "pump" ending: ${pubkey}`);
      } else {
        mintKp = result.keypair;
        console.log(`✅ Keypair generated with "pump" ending: ${result.pubkey}`);
      }
    }
  }
  const mintAddress = mintKp.publicKey
  console.log("mintAddress", mintAddress.toBase58());

  const mainBal = await connection.getBalance(mainKp.publicKey)
  console.log((mainBal / 10 ** 9).toFixed(3), "SOL in main keypair")

  console.log("Mint address of token ", mintAddress.toBase58())
  saveDataToFile([base58.encode(mintKp.secretKey)], "mint.json")

  // Prepare buyer wallet for dev buy (needed for createTokenTx)
  // If BUYER_WALLET is not set, create it the SAME WAY as bundle wallets (using distributeSol)
  // CRITICAL: Re-read BUYER_WALLET from process.env to get latest value (in case it was just updated)
  const currentBuyerWallet = process.env.BUYER_WALLET || ''
  console.log(`[Wallet Creation] BUYER_WALLET from .env: ${currentBuyerWallet ? currentBuyerWallet.substring(0, 8) + '...' + currentBuyerWallet.substring(currentBuyerWallet.length - 8) : '(empty - will auto-create)'}`)
  
  let buyerKp: Keypair
  let buyerWalletSource: string
  if (currentBuyerWallet && currentBuyerWallet.trim() !== '') {
    // Use BUYER_WALLET from .env (persistent wallet)
    buyerKp = Keypair.fromSecretKey(base58.decode(currentBuyerWallet))
    buyerWalletSource = 'BUYER_WALLET env var (persistent)'
    console.log("Dev buyer wallet (from .env):", buyerKp.publicKey.toBase58())
  } else {
    // Create DEV wallet FIRST using distributeSol (same as bundle wallets) - saves to data.json automatically
    console.log("   ⚠️  BUYER_WALLET not set in .env - creating DEV wallet like bundle wallets")
    console.log("   💡 This wallet will be created and saved to data.json (same as bundle wallets)")
    
    const buyerAmount = Number(process.env.BUYER_AMOUNT || '0.1');
    const jitoFee = Number(process.env.JITO_FEE || '0.001');
    // CRITICAL: Creator wallet needs enough SOL to pay for:
    // - Token creation costs: ~0.01 SOL (rent, fees)
    // - Jito fee (if bundling): 0.001 SOL
    // - DEV buy amount: BUYER_AMOUNT
    // - Priority fees for DEV buy: 5M units * 20k microLamports = 0.1 SOL
    // - Transaction base fees: ~0.000005 SOL
    // - Rent exemption (if needed): ~0.001 SOL
    // - Safety margin: ~0.05 SOL
    // Total: 0.01 (token creation) + 0.001 (Jito) + BUYER_AMOUNT + 0.1 (priority) + 0.05 (safety) = 0.161 + BUYER_AMOUNT
    const devRequiredAmount = buyerAmount + 0.161 + jitoFee // Always include Jito fee (won't be used in normal launch but that's fine)
    console.log(`\n💰 Creating DEV wallet FIRST (same as bundle wallets)...`)
    console.log(`   Amount: ${devRequiredAmount.toFixed(4)} SOL`)
    console.log(`   Breakdown:`)
    console.log(`     - Token creation: ~0.01 SOL`)
    console.log(`     - Jito fee: ${jitoFee.toFixed(4)} SOL`)
    console.log(`     - DEV buy: ${buyerAmount.toFixed(4)} SOL`)
    console.log(`     - Priority fees: ~0.1 SOL`)
    console.log(`     - Safety margin: ~0.05 SOL`)
    
    const devWalletResult = await distributeSol(connection, mainKp, 1, [devRequiredAmount], USE_MIXING_WALLETS)
    if (!devWalletResult || devWalletResult.length === 0) {
      console.error(`   ❌ Failed to create DEV wallet`)
      return
    }
    buyerKp = devWalletResult[0]
    buyerWalletSource = 'auto-created (saved to data.json like bundle wallets)'
    console.log(`   ✅ Created DEV wallet: ${buyerKp.publicKey.toBase58()}`)
    console.log(`   ✅ Saved to data.json (same as bundle wallets)`)
    
    // CRITICAL: Wait for the wallet to be fully confirmed and settled on-chain
    // distributeSol uses execute() which confirms, but we need to verify the wallet is ready
    console.log(`   ⏳ Verifying wallet is confirmed and ready...`)
    
    // Poll for wallet balance to ensure it's confirmed on-chain
    let verified = false
    for (let attempt = 0; attempt < 10; attempt++) {
      const settledBalance = await connection.getBalance(buyerKp.publicKey)
      const settledBalanceSol = settledBalance / 1e9
      
      if (settledBalanceSol >= devRequiredAmount) {
        console.log(`   ✅ Wallet confirmed and ready. Balance: ${settledBalanceSol.toFixed(4)} SOL`)
        verified = true
        break
      }
      
      if (attempt < 9) {
        console.log(`   ⏳ Waiting for wallet confirmation (attempt ${attempt + 1}/10)... Balance: ${settledBalanceSol.toFixed(4)} SOL`)
        await sleep(1000)
      }
    }
    
    if (!verified) {
      const finalBalance = await connection.getBalance(buyerKp.publicKey)
      const finalBalanceSol = finalBalance / 1e9
      console.error(`   ❌ ERROR: Wallet not confirmed after 10 attempts!`)
      console.error(`   Expected: ${devRequiredAmount.toFixed(4)} SOL, Got: ${finalBalanceSol.toFixed(4)} SOL`)
      console.error(`   The funding transaction may have failed or is still pending`)
      return
    }
    
    // CRITICAL: "Warm up" the newly created wallet by sending a tiny transaction to itself
    // This establishes the wallet on-chain and may help with pump.fun validation
    // Some protocols require wallets to have transaction history before they can be used as creators
    console.log(`   🔥 Warming up wallet with a self-transfer to establish on-chain history...`)
    try {
      const warmupBlockhash = await connection.getLatestBlockhash()
      const warmupMsg = new TransactionMessage({
        payerKey: buyerKp.publicKey,
        recentBlockhash: warmupBlockhash.blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
          SystemProgram.transfer({
            fromPubkey: buyerKp.publicKey,
            toPubkey: buyerKp.publicKey, // Self-transfer (establishes wallet on-chain)
            lamports: 1 // 1 lamport (minimal amount to establish transaction)
          })
        ]
      }).compileToV0Message()
      
      const warmupTx = new VersionedTransaction(warmupMsg)
      warmupTx.sign([buyerKp])
      
      const warmupSig = await connection.sendTransaction(warmupTx, { skipPreflight: true, maxRetries: 3 })
      await connection.confirmTransaction(warmupSig, 'confirmed')
      console.log(`   ✅ Wallet warmed up. Transaction: https://solscan.io/tx/${warmupSig}`)
    } catch (warmupError: any) {
      console.warn(`   ⚠️  Wallet warm-up failed (non-critical): ${warmupError.message}`)
      console.warn(`   Continuing anyway - this may cause issues if pump.fun requires wallet history`)
    }
  }

  // CRITICAL: Verify buyerKp is the newly created wallet (not funding wallet)
  console.log(`\n🔍 Token Creation Details:`)
  console.log(`   Creator Wallet (buyerKp): ${buyerKp.publicKey.toBase58()}`)
  console.log(`   Wallet Source: ${buyerWalletSource}`)
  console.log(`   Funding Wallet (mainKp): ${mainKp.publicKey.toBase58()}`)
  if (buyerKp.publicKey.equals(mainKp.publicKey)) {
    console.warn(`   ⚠️  WARNING: Creator wallet is the same as funding wallet!`)
  } else {
    console.log(`   ✅ Creator wallet is different from funding wallet (correct)`)
  }

  const tokenCreationIxs = await createTokenTx(buyerKp, mintKp, mainKp)
  if (tokenCreationIxs.length == 0) {
    console.log("Token creation failed")
    return
  }
  // Calculate minimum SOL needed
  // CRITICAL: Re-read from process.env to get latest values (constants were loaded at import time)
  // This ensures we use the values that were just saved by the API server
  const bundleWalletCount = Number(process.env.BUNDLE_WALLET_COUNT || process.env.DISTRIBUTION_WALLETNUM || '0');
  const bundleSwapAmountsString = process.env.BUNDLE_SWAP_AMOUNTS || '';
  const bundleSwapAmounts = bundleSwapAmountsString
    ? bundleSwapAmountsString.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n))
    : [];
  const holderWalletCount = Number(process.env.HOLDER_WALLET_COUNT || '0');
  const holderSwapAmountsString = process.env.HOLDER_SWAP_AMOUNTS || '';
  const holderSwapAmounts = holderSwapAmountsString
    ? holderSwapAmountsString.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n))
    : [];
  const holderWalletAmount = Number(process.env.HOLDER_WALLET_AMOUNT || '0.01');
  const buyerAmount = Number(process.env.BUYER_AMOUNT || '0.1');
  
  console.log(`\n📊 Buy Amount Configuration (from .env):`);
  console.log(`   - BUNDLE_SWAP_AMOUNTS from .env: ${bundleSwapAmountsString || '(empty)'}`);
  console.log(`   - Parsed BUNDLE_SWAP_AMOUNTS array: [${bundleSwapAmounts.join(', ')}] (length: ${bundleSwapAmounts.length})`);
  console.log(`   - BUNDLE_WALLET_COUNT: ${bundleWalletCount}`);
  console.log(`   - SWAP_AMOUNT (fallback): ${SWAP_AMOUNT}`);
  console.log(`   - BUYER_AMOUNT (DEV buy): ${buyerAmount}`);
  console.log(`   - DISTRIBUTION_WALLETNUM (legacy): ${DISTRIBUTION_WALLETNUM}`);
  
  let swapAmountsToUse: number[];
  if (bundleSwapAmounts.length > 0) {
    swapAmountsToUse = [...bundleSwapAmounts];
    // Pad with SWAP_AMOUNT if we have fewer amounts than wallets
    while (swapAmountsToUse.length < bundleWalletCount) {
      console.warn(`   ⚠️  BUNDLE_SWAP_AMOUNTS has ${swapAmountsToUse.length} values but need ${bundleWalletCount}. Padding with SWAP_AMOUNT (${SWAP_AMOUNT})`);
      swapAmountsToUse.push(SWAP_AMOUNT);
    }
    // Trim if we have more amounts than wallets (shouldn't happen, but be safe)
    swapAmountsToUse = swapAmountsToUse.slice(0, bundleWalletCount);
    console.log(`   ✅ Using custom amounts: [${swapAmountsToUse.join(', ')}]`);
  } else {
    console.warn(`   ⚠️  BUNDLE_SWAP_AMOUNTS is empty! All wallets will use SWAP_AMOUNT (${SWAP_AMOUNT})`);
    swapAmountsToUse = Array(bundleWalletCount).fill(SWAP_AMOUNT);
  }
  const minimumSolAmount = swapAmountsToUse.reduce((sum, amount) => sum + amount + 0.01, 0) + 0.04 + buyerAmount

  if (mainBal / 10 ** 9 < minimumSolAmount) {
    console.log("Main wallet balance is not enough to run the bundler")
    console.log(`Plz charge the wallet more than ${minimumSolAmount.toFixed(3)}SOL`)
    return
  }

  // Check if existing BUYER_WALLET has enough balance (if using persistent wallet)
  // If insufficient, fund it automatically (same as auto-created wallets)
  // BUT: Skip funding if BUYER_WALLET is the same as PRIVATE_KEY (same wallet, no transfer needed)
  // CRITICAL: Use currentBuyerWallet (re-read from process.env) instead of BUYER_WALLET constant
  if (currentBuyerWallet && currentBuyerWallet.trim() !== '') {
    const isSameWallet = mainKp.publicKey.equals(buyerKp.publicKey)
    
    if (isSameWallet) {
      // Same wallet - just check balance, no funding needed
      const existingBalance = await connection.getBalance(buyerKp.publicKey)
      const existingBalanceSol = existingBalance / 1e9
      const devRequiredAmount = buyerAmount + 0.15 // BUYER_AMOUNT + 0.15 SOL buffer for fees/rent/safety
      if (existingBalanceSol < devRequiredAmount) {
        console.log(`\n⚠️  BUYER_WALLET is the same as PRIVATE_KEY (master wallet)`)
        console.log(`   Current balance: ${existingBalanceSol.toFixed(4)} SOL`)
        console.log(`   Need at least ${devRequiredAmount.toFixed(4)} SOL for DEV buy`)
        console.log(`   Breakdown: ${buyerAmount.toFixed(4)} SOL (buy) + 0.15 SOL (buffer for fees/rent/safety)`)
        console.log(`   ⚠️  Insufficient balance - please fund the master wallet`)
        return
      } else {
        console.log(`\n✅ BUYER_WALLET is the same as PRIVATE_KEY (master wallet)`)
        console.log(`   Balance: ${existingBalanceSol.toFixed(4)} SOL (sufficient for DEV buy)`)
      }
    } else {
      // Different wallet - check balance and fund if needed
      const existingBalance = await connection.getBalance(buyerKp.publicKey)
      const existingBalanceSol = existingBalance / 1e9
      const devRequiredAmount = buyerAmount + 0.15 // BUYER_AMOUNT + 0.15 SOL buffer for fees/rent/safety
      if (existingBalanceSol < devRequiredAmount) {
        const fundingNeeded = devRequiredAmount - existingBalanceSol
        console.log(`\n⚠️  BUYER_WALLET has insufficient balance (${existingBalanceSol.toFixed(4)} SOL)`)
        console.log(`   Need at least ${devRequiredAmount.toFixed(4)} SOL for DEV buy`)
        console.log(`   Breakdown: ${buyerAmount.toFixed(4)} SOL (buy) + 0.15 SOL (buffer for fees/rent/safety)`)
        console.log(`\n💰 Funding BUYER_WALLET with ${fundingNeeded.toFixed(4)} SOL...`)
        
        // Use mixer wallets if enabled, otherwise direct funding
        if (USE_MIXING_WALLETS) {
          console.log(`   🔀 Using mixing wallets to break connection trail...`)
          const mixingWallets = loadMixingWallets()
          
          if (mixingWallets.length > 0) {
            const success = await fundExistingWalletWithMixing(connection, mainKp, buyerKp, fundingNeeded, mixingWallets)
            if (!success) {
              console.error(`   ❌ Failed to fund BUYER_WALLET through mixer`)
              return
            }
            // Verify balance after funding
            const newBalance = await connection.getBalance(buyerKp.publicKey)
            console.log(`   ✅ Funded BUYER_WALLET! New balance: ${(newBalance / 1e9).toFixed(4)} SOL`)
          } else {
            console.log(`   ⚠️  No mixing wallets available, using direct funding...`)
            // Fallback to direct funding
            try {
              const latestBlockhash = await connection.getLatestBlockhash()
              const fundingLamports = Math.ceil(fundingNeeded * 1e9)
              const transferMsg = new TransactionMessage({
                payerKey: mainKp.publicKey,
                recentBlockhash: latestBlockhash.blockhash,
                instructions: [
                  ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
                  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
                  SystemProgram.transfer({
                    fromPubkey: mainKp.publicKey,
                    toPubkey: buyerKp.publicKey,
                    lamports: fundingLamports
                  })
                ]
              }).compileToV0Message()

              const transferTx = new VersionedTransaction(transferMsg)
              transferTx.sign([mainKp])

              const sig = await connection.sendTransaction(transferTx, { skipPreflight: false, maxRetries: 3 })
              await connection.confirmTransaction(sig, 'confirmed')

              const newBalance = await connection.getBalance(buyerKp.publicKey)
              console.log(`   ✅ Funded BUYER_WALLET! New balance: ${(newBalance / 1e9).toFixed(4)} SOL`)
              console.log(`   Transaction: https://solscan.io/tx/${sig}`)
            } catch (error: any) {
              console.error(`   ❌ Failed to fund BUYER_WALLET: ${error.message}`)
              return
            }
          }
        } else {
          // Direct funding (mixing disabled)
          try {
            const latestBlockhash = await connection.getLatestBlockhash()
            const fundingLamports = Math.ceil(fundingNeeded * 1e9)
            const transferMsg = new TransactionMessage({
              payerKey: mainKp.publicKey,
              recentBlockhash: latestBlockhash.blockhash,
              instructions: [
                ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
                ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
                SystemProgram.transfer({
                  fromPubkey: mainKp.publicKey,
                  toPubkey: buyerKp.publicKey,
                  lamports: fundingLamports
                })
              ]
            }).compileToV0Message()

            const transferTx = new VersionedTransaction(transferMsg)
            transferTx.sign([mainKp])

            const sig = await connection.sendTransaction(transferTx, { skipPreflight: false, maxRetries: 3 })
            await connection.confirmTransaction(sig, 'confirmed')

            const newBalance = await connection.getBalance(buyerKp.publicKey)
            console.log(`   ✅ Funded BUYER_WALLET! New balance: ${(newBalance / 1e9).toFixed(4)} SOL`)
            console.log(`   Transaction: https://solscan.io/tx/${sig}`)
          } catch (error: any) {
            console.error(`   ❌ Failed to fund BUYER_WALLET: ${error.message}`)
            return
          }
        }
      } else {
        console.log(`\n✅ BUYER_WALLET has sufficient balance: ${existingBalanceSol.toFixed(4)} SOL`)
      }
    }
  }
  // Note: If BUYER_WALLET was not set, the wallet was already created and funded above using distributeSol

  if (bundleWalletCount === 0) {
    console.log("⚠️  BUNDLE_WALLET_COUNT is 0 - no bundle wallets will be created")
    console.log("   Set BUNDLE_WALLET_COUNT in .env to create bundle wallets")
  }

  console.log("Distributing SOL to wallets...")
  const swapAmountsForDistribution = bundleSwapAmounts.length > 0 ? bundleSwapAmounts : undefined
  
  let result = await distributeSol(connection, mainKp, bundleWalletCount, swapAmountsForDistribution, USE_MIXING_WALLETS)
  if (!result) {
    console.log("Distribution failed")
    return
  } else {
    kps = result
  }
  
  // CRITICAL: Save custom BUYER_WALLET to data.json for consistency (if not auto-created)
  // This ensures all wallets used in the launch are in data.json, not just auto-created ones
  if (currentBuyerWallet && currentBuyerWallet.trim() !== '') {
    console.log(`\n💾 Saving custom BUYER_WALLET to data.json for consistency...`)
    try {
      // Read existing data.json
      const dataPath = path.join(process.cwd(), 'keys', 'data.json')
      let existingWallets: string[] = []
      if (fs.existsSync(dataPath)) {
        const dataContent = fs.readFileSync(dataPath, 'utf8')
        existingWallets = JSON.parse(dataContent)
        if (!Array.isArray(existingWallets)) {
          existingWallets = []
        }
      }
      
      // Check if BUYER_WALLET is already in data.json
      const buyerWalletKey = base58.encode(buyerKp.secretKey)
      if (!existingWallets.includes(buyerWalletKey)) {
        existingWallets.push(buyerWalletKey)
        fs.writeFileSync(dataPath, JSON.stringify(existingWallets, null, 2))
        console.log(`   ✅ Saved custom BUYER_WALLET to data.json`)
      } else {
        console.log(`   ℹ️  Custom BUYER_WALLET already exists in data.json`)
      }
    } catch (error: any) {
      console.warn(`   ⚠️  Failed to save custom BUYER_WALLET to data.json: ${error.message}`)
      // Don't fail the launch if this fails - it's just for consistency
    }
  }

  // Create holder wallets (buy separately, not in bundle)
  let holderWallets: Keypair[] = []
  if (holderWalletCount > 0) {
    console.log(`\n👥 Creating ${holderWalletCount} holder wallets...`)
    
    // Parse holder amounts (use fresh values from process.env)
    let holderAmounts: number[] = []
    if (holderSwapAmounts.length > 0) {
      holderAmounts = [...holderSwapAmounts]
      // Pad with HOLDER_WALLET_AMOUNT if needed
      while (holderAmounts.length < holderWalletCount) {
        holderAmounts.push(holderWalletAmount)
      }
      holderAmounts = holderAmounts.slice(0, holderWalletCount)
    } else {
      holderAmounts = Array(holderWalletCount).fill(holderWalletAmount)
    }
    
    console.log(`   Holder wallet amounts: [${holderAmounts.join(', ')}]`)
    
    // Create and fund holder wallets
    const holderResult = await distributeSol(connection, mainKp, holderWalletCount, holderAmounts, USE_MIXING_WALLETS)
    if (holderResult) {
      holderWallets = holderResult
      console.log(`   ✅ Created ${holderWallets.length} holder wallets`)
    } else {
      console.log("   ⚠️  Holder wallet distribution failed, continuing without holder wallets")
    }
  } else {
    console.log("   ℹ️  HOLDER_WALLET_COUNT is 0 - no holder wallets will be created")
  }

  // CRITICAL: Save current-run.json IMMEDIATELY after wallets are created
  // This ensures wallets are saved even if bundle fails early
  console.log("\n💾 Saving wallet info to current-run.json (immediate save)...")
  const initialRunWallets: any = {
    count: kps.length, // Will update with walletsUsed.length after buy instructions are created
    totalCreated: kps.length + holderWallets.length + (currentBuyerWallet && currentBuyerWallet.trim() !== '' ? 0 : 1),
    timestamp: Date.now(),
    mintAddress: mintAddress.toBase58(),
    launchStatus: "PENDING", // Will be updated to SUCCESS/FAILED after confirmation
    launchStage: "FUNDING_WALLETS", // Wallets created and funded, ready for LUT
    bundleWalletKeys: kps.map(kp => base58.encode(kp.secretKey)), // All bundle wallets (will filter to walletsUsed later)
    holderWalletKeys: holderWallets.map(kp => base58.encode(kp.secretKey)), // Holder wallets
    walletKeys: [...kps, ...holderWallets].map(kp => base58.encode(kp.secretKey)) // All wallets for backward compatibility
  }
  // Save creatorDevWalletKey
  initialRunWallets.creatorDevWalletKey = base58.encode(buyerKp.secretKey)
  fs.writeFileSync(keysPath, JSON.stringify(initialRunWallets, null, 2))
  console.log(`   ✅ Saved ${kps.length} bundle wallets, ${holderWallets.length} holder wallets, and DEV wallet`)
  console.log(`   ✅ current-run.json will be updated as process progresses`)

  // Check if we should use normal launch (no Jito, no LUT)
  const shouldUseNormalLaunch = USE_NORMAL_LAUNCH && bundleWalletCount === 0
  
  let lutAddress: PublicKey | null = null
  let lookupTable: any = null
  
  if (shouldUseNormalLaunch) {
    console.log("\n🚀 NORMAL LAUNCH MODE ENABLED")
    console.log("   - Skipping LUT creation (not needed for normal launches)")
    console.log("   - Will send transactions normally (no Jito bundling)")
    console.log("   - Token creation → wait for confirmation → DEV buy → wait for confirmation")
  } else {
    // Update stage: Creating LUT
    if (fs.existsSync(keysPath)) {
      const stageData = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
      stageData.launchStage = "CREATING_LUT"
      fs.writeFileSync(keysPath, JSON.stringify(stageData, null, 2))
    }
    
    console.log("Creating LUT started")
    lutAddress = await createLUT(mainKp)
    if (!lutAddress) {
      console.log("Lut creation failed")
      // Update stage to failed
      if (fs.existsSync(keysPath)) {
        const stageData = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
        stageData.launchStage = "FAILED"
        stageData.launchStatus = "FAILED"
        fs.writeFileSync(keysPath, JSON.stringify(stageData, null, 2))
      }
      return
    }
    console.log("LUT Address:", lutAddress.toBase58())
    saveDataToFile([lutAddress.toBase58()], "lut.json")
    
    // Add buyer wallet and holder wallets to LUT along with bundle wallets
    const allWalletsForLUT = [...kps, buyerKp, ...holderWallets]
    if (!(await addAddressesToTableMultiExtend(lutAddress, mintAddress, allWalletsForLUT, mainKp))) {
      console.log("Adding addresses to table failed")
      return
    }

    // Get lookup table (needed for dev buy and bundler buys)
    lookupTable = (await connection.getAddressLookupTable(lutAddress)).value;
    if (!lookupTable) {
      console.log("Lookup table not ready")
      return
    }
  }

  // Store buy instructions per wallet index to handle skipped wallets correctly
  // Also track which wallets are actually used (not skipped)
  const buyIxsByWallet: { [walletIndex: number]: TransactionInstruction[] } = {}
  const walletsUsed: Keypair[] = [] // Track wallets that actually get buy instructions

  for (let i = 0; i < bundleWalletCount; i++) {
    // Use custom amount if provided, otherwise use SWAP_AMOUNT
    let buyAmount = swapAmountsToUse[i] || SWAP_AMOUNT; // Fallback to SWAP_AMOUNT if undefined
    if (isNaN(buyAmount) || buyAmount <= 0) {
      console.error(`Invalid buy amount for wallet ${i}: ${buyAmount}. Using SWAP_AMOUNT instead.`);
      buyAmount = SWAP_AMOUNT;
    }
    const buyAmountLamports = Math.floor(buyAmount * 10 ** 9);
    if (isNaN(buyAmountLamports) || buyAmountLamports <= 0) {
      console.error(`Invalid buy amount in lamports for wallet ${i}: ${buyAmountLamports}. Skipping wallet.`);
      console.warn(`⚠️  Wallet ${i} (${kps[i].publicKey.toBase58()}) will NOT be used for buying (skipped due to invalid amount)`);
      continue; // Skip this wallet
    }
    // CRITICAL: buyerKp is the token creator (passed to createTokenTx), so it must be the referrer
    const ix = await makeBuyIx(kps[i], buyAmountLamports, i, buyerKp.publicKey, mintAddress)
    buyIxsByWallet[i] = ix // Store by wallet index
    walletsUsed.push(kps[i]) // Track this wallet as used
    console.log(`Wallet ${i} will buy ${buyAmount} SOL worth of tokens`)
  }
  
  console.log(`\n📊 Wallet Usage Summary:`)
  console.log(`   - Total wallets created: ${kps.length}`)
  console.log(`   - Wallets with buy instructions: ${walletsUsed.length}`)
  if (walletsUsed.length < kps.length) {
    console.warn(`   ⚠️  ${kps.length - walletsUsed.length} wallet(s) skipped (no buy instructions)`)
    console.warn(`   ⚠️  Skipped wallets remain in data.json as backup`)
  }
  
  // Update current-run.json with actual wallets used (filter out skipped wallets)
  console.log(`\n💾 Updating current-run.json with wallets actually used...`)
  if (fs.existsSync(keysPath)) {
    const currentRunData = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
    currentRunData.count = walletsUsed.length
    currentRunData.bundleWalletKeys = walletsUsed.map(kp => base58.encode(kp.secretKey))
    currentRunData.walletKeys = [...walletsUsed, ...holderWallets].map(kp => base58.encode(kp.secretKey))
    currentRunData.launchStage = "BUILDING_BUNDLE" // Buy instructions created, building bundle
    fs.writeFileSync(keysPath, JSON.stringify(currentRunData, null, 2))
    console.log(`   ✅ Updated: ${walletsUsed.length} bundle wallets will be used in bundle`)
  }
  
  console.log(`\n📝 Current run info:`)
  console.log(`   - Wallets used (with buy instructions): ${walletsUsed.length}`)
  console.log(`   - Total wallets created: ${kps.length}`)
  console.log(`   - Mint: ${mintAddress.toBase58()}`)
  console.log(`   - current-run.json saved and will be updated as process progresses`)

  // Get a fresh blockhash RIGHT BEFORE creating all transactions
  // All transactions in the bundle MUST use the same blockhash for Jito bundling
  console.log("Getting fresh blockhash for bundle...")
  let latestBlockhash = await connection.getLatestBlockhash()
  console.log(`Using blockhash: ${latestBlockhash.blockhash.slice(0, 8)}... (valid until block ${latestBlockhash.lastValidBlockHeight})`)

  // CRITICAL: For pump.fun, the PAYER is the CREATOR
  // The creator wallet (buyerKp) must be the payer, not the funding wallet (mainKp)
  // The funding wallet can still pay for fees by transferring SOL to buyerKp first, but buyerKp must be the transaction payer
  const tokenCreationTx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: buyerKp.publicKey, // CRITICAL: Creator wallet must be payer for pump.fun
      recentBlockhash: latestBlockhash.blockhash,
      instructions: tokenCreationIxs
    }).compileToV0Message()
  )

  // CRITICAL: Creator (buyerKp) signs as payer and creator
  // Mint (mintKp) signs as the mint authority
  // Note: mainKp is NOT a signer - buyerKp pays for everything
  tokenCreationTx.sign([buyerKp, mintKp])

  // const simResult = await connection.simulateTransaction(tokenCreationTx, { sigVerify: false });
  // console.log("Simulation result:", simResult.value);
  // if (simResult.value.err) {
  //   console.log("Simulation failed. Adjust compute units or batch size.");
  //   return;
  // }

  // const sig = await connection.sendTransaction(tokenCreationTx, { skipPreflight: true })
  // console.log("Transaction sent:", sig)
  // const confirmation = await connection.confirmTransaction(sig, "confirmed")
  // console.log("Transaction confirmed:", confirmation)
  // if (confirmation.value.err) {
  //   console.log("Transaction failed")
  //   return
  // }

  transactions.push(tokenCreationTx)
  
  // Create DEV buy transaction (FIRST buy, right after token creation)
  // IMPORTANT: This uses the OFFICIAL pump.fun SDK (sdk.getBuyInstructionsBySolAmount)
  // This is the EXACT SAME method the pump.fun frontend uses - it's a normal buy, not a "sniper"
  // The only difference is it's bundled with Jito for speed, but the buy instruction itself is identical
  // Use the SAME blockhash as token creation for proper bundling
  // CRITICAL: buyerKp is the token creator (passed to createTokenTx), so it must be the referrer
  console.log("Creating DEV buy transaction (FIRST buy)...")
  console.log("   Using official pump.fun SDK - same as frontend (not a sniper)")
  
  // Verify DEV wallet has sufficient balance before creating buy transaction
  const devBalance = await connection.getBalance(buyerKp.publicKey)
  const devBalanceSol = devBalance / 1e9
  // CRITICAL: Match the buffer used when creating the wallet (0.15 SOL)
  const devRequiredAmount = buyerAmount + 0.15 // BUYER_AMOUNT + 0.15 SOL buffer for fees
  console.log(`   DEV wallet balance: ${devBalanceSol.toFixed(4)} SOL`)
  console.log(`   Required: ${devRequiredAmount.toFixed(4)} SOL (${buyerAmount.toFixed(4)} for buy + 0.15 buffer for fees)`)
  
  if (devBalanceSol < devRequiredAmount) {
    console.error(`\n❌ ERROR: DEV wallet has insufficient balance!`)
    console.error(`   Current: ${devBalanceSol.toFixed(4)} SOL`)
    console.error(`   Required: ${devRequiredAmount.toFixed(4)} SOL`)
    console.error(`   Please fund the wallet or check funding logic`)
    return
  }
  
  const devBuyAmountLamports = Math.floor(buyerAmount * 10 ** 9)
  
  // CRITICAL: Verify buyerKp is the newly created wallet (not funding wallet)
  console.log(`\n🔍 DEV Buy Transaction Details:`)
  console.log(`   Creator/Buyer Wallet: ${buyerKp.publicKey.toBase58()}`)
  console.log(`   Wallet Source: ${buyerWalletSource}`)
  console.log(`   Funding Wallet (mainKp): ${mainKp.publicKey.toBase58()}`)
  if (buyerKp.publicKey.equals(mainKp.publicKey)) {
    console.warn(`   ⚠️  WARNING: Buyer wallet is the same as funding wallet!`)
  } else {
    console.log(`   ✅ Buyer wallet is different from funding wallet (correct)`)
  }
  
  const devBuyIxs = await makeBuyIx(buyerKp, devBuyAmountLamports, 0, buyerKp.publicKey, mintAddress)
  
  // Use same blockhash as token creation for bundling (important!)
  // Priority fees: Lower for normal launch, higher for bundles
  // For normal launch, don't use LUT (not needed)
  // CRITICAL: payerKey MUST be buyerKp (the creator wallet), NOT mainKp
  // Calculation: (units * price) / 1,000,000 = lamports
  // Bundle: (5M * 20k) / 1M = 100k lamports = 0.0001 SOL per tx
  // Normal: (500k * 5k) / 1M = 2.5k lamports = 0.0000025 SOL per tx (much cheaper!)
  const devBuyComputeLimit = shouldUseNormalLaunch ? 500_000 : 5_000_000 // Lower for normal launch
  const devBuyComputePrice = shouldUseNormalLaunch ? 5_000 : 20_000 // Lower for normal launch (~0.0025 SOL vs ~0.1 SOL per tx)
  
  const devBuyMsg = new TransactionMessage({
    payerKey: buyerKp.publicKey, // CRITICAL: Creator wallet pays for DEV buy
    recentBlockhash: latestBlockhash.blockhash, // Same blockhash as token creation
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: devBuyComputeLimit }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: devBuyComputePrice }),
      ...devBuyIxs
    ]
  }).compileToV0Message(shouldUseNormalLaunch ? [] : [lookupTable]) // Use lookup table only if bundling
  
  const devBuyTx = new VersionedTransaction(devBuyMsg)
  // CRITICAL: Only buyerKp signs (the creator wallet), NOT mainKp
  devBuyTx.sign([buyerKp])
  console.log(`   ✅ DEV buy transaction signed by: ${buyerKp.publicKey.toBase58()}`)
  
  // NOTE: We don't simulate the DEV buy transaction because it depends on the token creation
  // transaction that comes before it in the bundle. During simulation, the token doesn't exist yet,
  // so it would fail with "IncorrectProgramId". The bundle will be validated by Jito/validators.
  // We've already verified the wallet has sufficient balance above.
  
  transactions.push(devBuyTx)
  console.log(`✅ DEV buy transaction created: ${buyerAmount} SOL from ${buyerKp.publicKey.toBase58()}`)
  console.log(`   This will be the FIRST buy transaction in the bundle (right after token creation)`)
  console.log(`   Bundle order: 1) Token Creation → 2) DEV Buy → 3) Bundler Wallet Buys`)
  
  // Now create bundler wallet buy transactions
  // IMPORTANT: Use the SAME blockhash as token creation and DEV buy for proper bundling
  for (let i = 0; i < Math.ceil(bundleWalletCount / 4); i++) {
    const instructions: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 5_000_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }),
    ]

    for (let j = 0; j < 4; j++) {
      const index = i * 4 + j
      if (kps[index] && buyIxsByWallet[index]) {
        // Add both instructions for this wallet
        instructions.push(...buyIxsByWallet[index])
        console.log(`Transaction instruction added for wallet ${index}:`, kps[index].publicKey.toString())
      } else if (kps[index] && !buyIxsByWallet[index]) {
        console.warn(`⚠️  Wallet ${index} exists but has no buy instructions (was skipped due to invalid amount)`)
      }

    }
    const msg = new TransactionMessage({
      payerKey: kps[i * 4].publicKey,
      recentBlockhash: latestBlockhash.blockhash, // Use SAME blockhash as token creation and DEV buy
      instructions
    }).compileToV0Message([lookupTable])
    console.log("Transaction message compiled:", msg)

    const tx = new VersionedTransaction(msg)
    console.log("Transaction created:", tx)

    for (let j = 0; j < 4; j++) {
      const index = i * 4 + j
      if (kps[index]) {
        tx.sign([kps[index]])
        console.log("Transaction signed:", kps[index].publicKey.toString())
      }
    }
    console.log("transaction size", tx.serialize().length)

    // const simResult = await connection.simulateTransaction(tx, { sigVerify: false });
    // console.log("Simulation result:", simResult.value);
    // if (simResult.value.err) {
    //   console.log("Simulation failed. Adjust compute units or batch size.");
    //   return;
    // }

    // const sig = await connection.sendTransaction(tx, { skipPreflight: true })
    // console.log("Transaction sent:", sig)
    // const confirmation = await connection.confirmTransaction(sig, "confirmed")
    // console.log("Transaction confirmed:", confirmation)
    // if (confirmation.value.err) {
    //   console.log("Transaction failed")
    //   return
    // }

    transactions.push(tx)
  }

  // transactions.map(async (tx, i) => console.log(i, " | ", tx.serialize().length, "bytes | \n", (await connection.simulateTransaction(tx, { sigVerify: true }))))

  console.log("\n" + "=".repeat(80))
  console.log("BUNDLE SUMMARY")
  console.log("=".repeat(80))
  console.log(`Total transactions in bundle: ${transactions.length}`)
  console.log(`1. Token Creation Transaction`)
  console.log(`2. DEV Buy Transaction (${buyerAmount} SOL from ${buyerKp.publicKey.toBase58()})`)
  console.log(`3-${transactions.length}. Bundler Wallet Buy Transactions (${bundleWalletCount} wallets)`)
  console.log(`All transactions use blockhash: ${latestBlockhash.blockhash.slice(0, 8)}...`)
  console.log(`Valid until block height: ${latestBlockhash.lastValidBlockHeight}`)
  console.log("=".repeat(80))
  
  // Verify blockhash is still valid before sending
  const currentSlot = await connection.getSlot()
  const currentBlockHeight = await connection.getBlockHeight()
  console.log(`\nCurrent block height: ${currentBlockHeight}, Valid until: ${latestBlockhash.lastValidBlockHeight}`)
  
  if (currentBlockHeight >= latestBlockhash.lastValidBlockHeight) {
    console.error("❌ ERROR: Blockhash has expired! Getting fresh blockhash and rebuilding transactions...")
    // Get fresh blockhash and rebuild all transactions
    const freshBlockhash = await connection.getLatestBlockhash()
    console.log(`New blockhash: ${freshBlockhash.blockhash.slice(0, 8)}... (valid until block ${freshBlockhash.lastValidBlockHeight})`)
    
    // Rebuild token creation transaction
    // CRITICAL: Creator wallet (buyerKp) must be payer, not funding wallet (mainKp)
    const newTokenCreationTx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: buyerKp.publicKey, // CRITICAL: Creator wallet must be payer for pump.fun
        recentBlockhash: freshBlockhash.blockhash,
        instructions: tokenCreationIxs
      }).compileToV0Message()
    )
    // CRITICAL: Creator (buyerKp) signs as payer and creator
    newTokenCreationTx.sign([buyerKp, mintKp])
    transactions[0] = newTokenCreationTx
    
    // Rebuild DEV buy transaction (using same compute budget as bundler wallets)
    const newDevBuyMsg = new TransactionMessage({
      payerKey: buyerKp.publicKey,
      recentBlockhash: freshBlockhash.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 5_000_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }),
        ...devBuyIxs
      ]
    }).compileToV0Message([lookupTable])
    const newDevBuyTx = new VersionedTransaction(newDevBuyMsg)
    newDevBuyTx.sign([buyerKp])
    transactions[1] = newDevBuyTx
    
    // Rebuild bundler wallet transactions
    let txIndex = 2
    for (let i = 0; i < Math.ceil(bundleWalletCount / 4); i++) {
      const instructions: TransactionInstruction[] = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 5_000_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }),
      ]
      for (let j = 0; j < 4; j++) {
        const index = i * 4 + j
        if (kps[index] && buyIxsByWallet[index]) {
          // Add both instructions for this wallet
          instructions.push(...buyIxsByWallet[index])
        }
      }
      const msg = new TransactionMessage({
        payerKey: kps[i * 4].publicKey,
        recentBlockhash: freshBlockhash.blockhash,
        instructions
      }).compileToV0Message([lookupTable])
      const tx = new VersionedTransaction(msg)
      for (let j = 0; j < 4; j++) {
        const index = i * 4 + j
        if (kps[index]) {
          tx.sign([kps[index]])
        }
      }
      transactions[txIndex] = tx
      txIndex++
    }
    
    console.log("✅ All transactions rebuilt with fresh blockhash")
    latestBlockhash = freshBlockhash
  } else {
    const blocksRemaining = latestBlockhash.lastValidBlockHeight - currentBlockHeight
    console.log(`✅ Blockhash is still valid (${blocksRemaining} blocks remaining)`)
  }
  
  // NORMAL LAUNCH: Send transactions sequentially (no Jito bundling)
  let bundleSuccess = false // Declare for both normal launch and bundle mode
  if (shouldUseNormalLaunch) {
    console.log("\n🚀 NORMAL LAUNCH: Sending transactions sequentially...")
    console.log("   Step 1: Token Creation")
    console.log("   Step 2: DEV Buy (after token creation confirms)")
    
    // Update stage: Normal launch
    if (fs.existsSync(keysPath)) {
      const stageData = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
      stageData.launchStage = "NORMAL_LAUNCH"
      fs.writeFileSync(keysPath, JSON.stringify(stageData, null, 2))
    }
    
    try {
      // Step 1: Send token creation transaction
      console.log("\n📤 Sending token creation transaction...")
      const tokenCreationSig = await connection.sendTransaction(tokenCreationTx, {
        skipPreflight: false,
        maxRetries: 3
      })
      console.log(`✅ Token creation sent: https://solscan.io/tx/${tokenCreationSig}`)
      
      // Wait for confirmation with timeout
      console.log("⏳ Waiting for token creation confirmation...")
      console.log(`   Transaction: https://solscan.io/tx/${tokenCreationSig}`)
      console.log("   This may take 10-30 seconds depending on network congestion...")
      
      try {
        const tokenCreationConfirmation = await Promise.race([
          connection.confirmTransaction(tokenCreationSig, 'confirmed'),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Confirmation timeout after 60 seconds')), 60000)
          )
        ]) as any
        
        if (tokenCreationConfirmation.value?.err) {
          console.error("❌ Token creation failed:", tokenCreationConfirmation.value.err)
          if (fs.existsSync(keysPath)) {
            const stageData = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
            stageData.launchStatus = "FAILED"
            stageData.launchStage = "FAILED"
            stageData.failureReason = "Token creation transaction failed"
            fs.writeFileSync(keysPath, JSON.stringify(stageData, null, 2))
          }
          return
        }
        console.log("✅ Token creation confirmed!")
      } catch (error: any) {
        if (error.message.includes('timeout')) {
          console.warn("⚠️  Confirmation timeout - checking transaction status...")
          // Check if transaction was actually confirmed
          const status = await connection.getSignatureStatus(tokenCreationSig)
          if (status?.value?.confirmationStatus) {
            console.log(`✅ Transaction confirmed (status: ${status.value.confirmationStatus})`)
            if (status.value.err) {
              console.error("❌ Token creation failed:", status.value.err)
              return
            }
          } else {
            console.error("❌ Transaction not confirmed after 60 seconds")
            console.error("   Check manually: https://solscan.io/tx/" + tokenCreationSig)
            return
          }
        } else {
          throw error
        }
      }
      
      // Step 2: Get fresh blockhash for DEV buy (token creation might have taken time)
      console.log("\n📤 Getting fresh blockhash for DEV buy...")
      const devBuyBlockhash = await connection.getLatestBlockhash()
      
      // Rebuild DEV buy transaction with fresh blockhash
      // Use lower priority fees for normal launch (not competing in bundles)
      // Calculation: (units * price) / 1,000,000 = lamports
      // Normal: (500k * 5k) / 1M = 2.5k lamports = 0.0000025 SOL (much cheaper than bundle!)
      const devBuyMsgFresh = new TransactionMessage({
        payerKey: buyerKp.publicKey,
        recentBlockhash: devBuyBlockhash.blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }), // Lower limit for normal launch
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5_000 }), // Lower price (~0.0025 SOL vs ~0.1 SOL)
          ...devBuyIxs
        ]
      }).compileToV0Message([]) // No LUT for normal launch
      
      const devBuyTxFresh = new VersionedTransaction(devBuyMsgFresh)
      devBuyTxFresh.sign([buyerKp])
      
      // Send DEV buy transaction
      console.log("📤 Sending DEV buy transaction...")
      const devBuySig = await connection.sendTransaction(devBuyTxFresh, {
        skipPreflight: false,
        maxRetries: 3
      })
      console.log(`✅ DEV buy sent: https://solscan.io/tx/${devBuySig}`)
      
      // Wait for confirmation
      console.log("⏳ Waiting for DEV buy confirmation...")
      const devBuyConfirmation = await connection.confirmTransaction(devBuySig, 'confirmed')
      if (devBuyConfirmation.value.err) {
        console.error("❌ DEV buy failed:", devBuyConfirmation.value.err)
        console.warn("⚠️  Token was created but DEV buy failed - you can manually buy or retry")
        if (fs.existsSync(keysPath)) {
          const stageData = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
          stageData.launchStatus = "PARTIAL"
          stageData.launchStage = "DEV_BUY_FAILED"
          stageData.failureReason = "Token created but DEV buy failed"
          fs.writeFileSync(keysPath, JSON.stringify(stageData, null, 2))
        }
        return
      }
      console.log("✅ DEV buy confirmed!")
      console.log("\n🎉 NORMAL LAUNCH SUCCESSFUL!")
      console.log(`   Token: ${mintAddress.toBase58()}`)
      console.log(`   Token Creation: https://solscan.io/tx/${tokenCreationSig}`)
      console.log(`   DEV Buy: https://solscan.io/tx/${devBuySig}`)
      
      // Update stage: Success
      if (fs.existsSync(keysPath)) {
        const stageData = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
        stageData.launchStatus = "SUCCESS"
        stageData.launchStage = "COMPLETE"
        fs.writeFileSync(keysPath, JSON.stringify(stageData, null, 2))
      }
      
      // Continue to rapid sell if enabled (same as bundle mode)
      // The rapid sell logic below will handle this
      bundleSuccess = true // Set to true so rapid sell can proceed
      
    } catch (error: any) {
      console.error("❌ Normal launch failed:", error.message)
      if (fs.existsSync(keysPath)) {
        const stageData = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
        stageData.launchStatus = "FAILED"
        stageData.launchStage = "FAILED"
        stageData.failureReason = error.message
        fs.writeFileSync(keysPath, JSON.stringify(stageData, null, 2))
      }
      return
    }
  } else {
    // BUNDLE MODE: Use Jito bundling
    // Update stage: Submitting bundle
    if (fs.existsSync(keysPath)) {
      const stageData = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
      stageData.launchStage = "SUBMITTING_BUNDLE"
      fs.writeFileSync(keysPath, JSON.stringify(stageData, null, 2))
    }
    
    // Send bundle IMMEDIATELY after creation to avoid blockhash expiration
    // CRITICAL: Start bundle submission in background, don't wait for all retries
    // Rapid sell needs to start immediately, not wait for Jito rate limit retries
    console.log("\nSending bundle immediately to avoid blockhash expiration...")
    console.log("⚡⚡⚡ Bundle submission starting - rapid sell will fire IMMEDIATELY after first success ⚡⚡⚡")
    
    let bundlePromise: Promise<boolean>
    
    if (LIL_JIT_MODE) {
      bundlePromise = (async () => {
        const bundleId = await sendBundle(transactions)
        if (!bundleId) {
          console.error("❌ ERROR: Bundle sending failed - no bundle ID received")
          return false
        } else {
          console.log("✅ Bundle sent successfully with ID:", bundleId)
          return true
        }
      })()
    } else {
      bundlePromise = (async () => {
        const result = await executeJitoTx(transactions, mainKp, commitment, latestBlockhash)
        if (!result) {
          console.error("❌ ERROR: Jito bundle execution failed - no successful responses")
          return false
        } else {
          console.log("✅ Bundle executed successfully, signature:", result)
          return true
        }
      })()
    }
    
    // Wait for bundle to be sent (but don't wait for all retries to complete)
    // Use Promise.race to get first success or timeout after 2 seconds MAX
    const bundleTimeout = new Promise<boolean>((resolve) => {
      setTimeout(() => {
        console.log("⚡⚡⚡ 2s timeout - starting rapid sell IMMEDIATELY! ⚡⚡⚡")
        console.log("   Bundle submission continues in background")
        resolve(true) // Assume success to allow rapid sell to start
      }, 2000) // 2 second MAX timeout - rapid sell MUST start immediately
    })
    
    bundleSuccess = await Promise.race([bundlePromise, bundleTimeout])
    
    if (!bundleSuccess) {
      console.error("❌ CRITICAL: Bundle submission failed - aborting")
      process.exit(1)
    }
  }
  
  // Update current-run.json with bundle submission status
  // (Wallets were already saved earlier, just updating status)
  console.log("\n💾 Updating current-run.json with bundle submission status...")
  if (fs.existsSync(keysPath)) {
    const currentRunData = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
    // Ensure all fields are up to date
    currentRunData.count = walletsUsed.length
    currentRunData.bundleWalletKeys = walletsUsed.map(kp => base58.encode(kp.secretKey))
    currentRunData.holderWalletKeys = holderWallets.map(kp => base58.encode(kp.secretKey))
    currentRunData.walletKeys = [...walletsUsed, ...holderWallets].map(kp => base58.encode(kp.secretKey))
    currentRunData.creatorDevWalletKey = base58.encode(buyerKp.secretKey)
    currentRunData.launchStatus = "PENDING" // Will be updated to SUCCESS/FAILED after confirmation
    currentRunData.launchStage = "CONFIRMING" // Bundle submitted, waiting for confirmation
    fs.writeFileSync(keysPath, JSON.stringify(currentRunData, null, 2))
    console.log(`   ✅ Updated current-run.json (ready for rapid sell)`)
  }
  
  // AUTOMATIC RAPID SELL - Start IMMEDIATELY after bundle is sent (don't wait for confirmation!)
  // Rapid sell has retry logic to handle tokens not detected yet
  let rapidSellPromise: Promise<void> | null = null
  if (AUTO_RAPID_SELL) {
    console.log("\n🚀🚀🚀 AUTOMATIC RAPID SELL STARTING IMMEDIATELY... 🚀🚀🚀")
    console.log("⚡⚡⚡ FIRING INSTANTLY - No waiting for token confirmation! ⚡⚡⚡")
    console.log("⚡ Rapid sell will retry until tokens are detected (beats all bots!)")
    console.log("⚡ This will sell 100% of tokens from ALL wallets (bundler + DEV)\n")
    
    rapidSellPromise = (async () => {
      try {
        const { rapidSell } = await import('./rapid-sell')
        // Start with 0ms wait - fires immediately, retries until tokens detected
        await rapidSell(mintAddress.toBase58(), 0)
        
        // AUTOMATIC GATHER - Recover SOL from all wallets after rapid sell (if enabled)
        if (AUTO_GATHER) {
          console.log("\n💰💰💰 AUTOMATIC GATHER STARTING... 💰💰💰")
          console.log("⚡ Recovering SOL from all wallets (bundler + DEV)")
          console.log("⚡ This will sell any remaining tokens and transfer all SOL to main wallet\n")
          
          try {
            // Import and call gather function directly
            const { gather } = await import('./gather')
            await gather()
            console.log("\n✅✅✅ AUTOMATIC GATHER COMPLETED ✅✅✅")
          } catch (error: any) {
            console.error("❌ Error starting automatic gather:", error.message)
            console.error("   You can manually run: npm run gather")
          }
        } else {
          console.log("\n⏸️  AUTO_GATHER is disabled in .env")
          console.log("   Gather will NOT start automatically")
          console.log("   Run manually with: npm run gather")
        }
      } catch (error: any) {
        console.error("❌ Error in rapid sell:", error.message)
        console.error("   You can manually run: npm run rapid-sell")
      }
    })()
  } else {
    console.log("\n⏸️  AUTO_RAPID_SELL is disabled in .env")
    console.log("   Rapid sell will NOT start automatically")
    console.log("   Run manually with: npm run rapid-sell")
  }
  
  // WEBSOCKET TRACKING - Monitor external buys and auto-sell when threshold is met
  if (WEBSOCKET_TRACKING_ENABLED) {
    console.log("\n📡📡📡 WEBSOCKET TRACKING STARTING... 📡📡📡")
    console.log("⚡ Monitoring external buys (wallets NOT in our list)")
    console.log(`⚡ Threshold: ${WEBSOCKET_EXTERNAL_BUY_THRESHOLD} SOL (cumulative within ${WEBSOCKET_EXTERNAL_BUY_WINDOW}s)`)
    console.log("⚡ When threshold is met, will INSTANTLY trigger rapid sell!\n")
    
    const websocketTrackingPromise = (async () => {
      try {
        // Import WebSocket tracker
        let websocketTracker;
        if (WEBSOCKET_ULTRA_FAST_MODE) {
          const { UltraFastWebSocketTracker } = await import('./api-server/websocket-tracker-ultra-fast');
          websocketTracker = new UltraFastWebSocketTracker();
          console.log("🚀 Using ULTRA-FAST WebSocket mode (sub-500ms reaction time)");
        } else {
          websocketTracker = require('./api-server/websocket-tracker');
          console.log("📊 Using STANDARD WebSocket mode");
        }
        
        // Get all our wallet addresses to exclude from tracking
        const ourWallets: string[] = [];
        
        // Add DEV/Creator wallet
        if (buyerKp) {
          ourWallets.push(buyerKp.publicKey.toBase58());
        }
        
        // Add bundle wallets
        if (kps && kps.length > 0) {
          kps.forEach(kp => {
            ourWallets.push(kp.publicKey.toBase58());
          });
        }
        
        // Add holder wallets
        if (holderWallets && holderWallets.length > 0) {
          holderWallets.forEach(kp => {
            ourWallets.push(kp.publicKey.toBase58());
          });
        }
        
        console.log(`📊 Excluding ${ourWallets.length} of our wallets from tracking`);
        
        // Determine auto-sell type
        const autoSellType = AUTO_SELL_50_PERCENT ? 'rapid-sell-50-percent' : 'rapid-sell';
        
        // Start tracking
        const success = websocketTracker.startTracking(
          mintAddress.toBase58(),
          ourWallets,
          true, // autoSell enabled
          0.1, // threshold (not used for cumulative)
          WEBSOCKET_EXTERNAL_BUY_THRESHOLD,
          WEBSOCKET_EXTERNAL_BUY_WINDOW * 1000, // Convert to milliseconds
          false, // simulationMode
          autoSellType
        );
        
        if (success) {
          console.log("✅✅✅ WebSocket tracking started successfully!");
          console.log("⚡ Real-time transaction monitoring is active");
          console.log("⚡ Will trigger rapid sell when external buys reach threshold\n");
        } else {
          console.error("❌ Failed to start WebSocket tracking");
        }
      } catch (error: any) {
        console.error("❌ Error starting WebSocket tracking:", error.message || error);
        console.error("   You can manually start with: npm run start-tracking");
      }
    })();
    
    // Don't await - let it run in background
  } else {
    console.log("\n⏸️  WEBSOCKET_TRACKING_ENABLED is disabled in .env")
    console.log("   WebSocket tracking will NOT start automatically")
    console.log("   Run manually with: npm run start-tracking")
  }
  
  // Token confirmation check runs in PARALLEL with rapid sell (non-blocking)
  // This is just for error handling - rapid sell already handles retries
  console.log("\n⏳ Token confirmation check running in background (non-blocking)...")
  console.log(`   Mint address: ${mintAddress.toBase58()}`)
  console.log(`   Rapid sell is already running - this check is just for error handling`)
  
  const maxWaitTime = 90000 // 90 seconds
  const checkInterval = 2000 // 2 seconds
  const startWaitTime = Date.now()
  let tokenConfirmed = false
  let bundleSignature: string | null = null
  
  // Get bundle signature for reference
  if (LIL_JIT_MODE) {
    bundleSignature = null
  } else {
    bundleSignature = transactions[0] ? base58.encode(transactions[0].signatures[0]) : null
  }
  
  // Run token confirmation check in background (don't block rapid sell)
  const confirmationCheckPromise = (async () => {
    while (Date.now() - startWaitTime < maxWaitTime) {
      try {
        // First check if bundle transaction was actually included in a block
        if (bundleSignature) {
          try {
            const txStatus = await connection.getSignatureStatus(bundleSignature, { searchTransactionHistory: true })
            if (txStatus.value) {
              if (txStatus.value.err) {
                console.log(`\n❌ Bundle transaction failed: ${JSON.stringify(txStatus.value.err)}`)
                console.log(`   Transaction: https://solscan.io/tx/${bundleSignature}`)
                // Continue checking - might be a different transaction that succeeded
              } else if (txStatus.value.confirmationStatus === 'confirmed' || txStatus.value.confirmationStatus === 'finalized') {
                console.log(`\n✅ Bundle transaction confirmed on-chain!`)
                console.log(`   Transaction: https://solscan.io/tx/${bundleSignature}`)
              }
            }
          } catch (e) {
            // Ignore errors checking transaction status
          }
        }
        
        const mintInfo = await connection.getParsedAccountInfo(mintAddress, "confirmed")
        if (mintInfo.value && mintInfo.value.data) {
          console.log("\n✅ Token confirmed on-chain!")
          
          // Verify buys went through by checking if wallets have tokens
          // If token is confirmed, the bundle was included, so all buys should have gone through
          // But let's verify quickly to be 100% sure
          try {
            // Check DEV wallet first (should have tokens if buy went through)
            // Decode raw Buffer data like rapid-sell.ts does
            const devTokenAccounts = await connection.getTokenAccountsByOwner(buyerKp.publicKey, {
              programId: TOKEN_PROGRAM_ID,
            })
            const devHasTokens = devTokenAccounts.value.some(acc => {
              try {
                const accountInfo = SPL_ACCOUNT_LAYOUT.decode(acc.account.data as Buffer)
                return accountInfo.mint.toBase58() === mintAddress.toBase58()
              } catch {
                return false
              }
            })
            
            // Check at least one bundler wallet
            let bundlerHasTokens = false
            if (walletsUsed.length > 0) {
              const bundlerTokenAccounts = await connection.getTokenAccountsByOwner(walletsUsed[0].publicKey, {
                programId: TOKEN_PROGRAM_ID,
              })
              bundlerHasTokens = bundlerTokenAccounts.value.some(acc => {
                try {
                  const accountInfo = SPL_ACCOUNT_LAYOUT.decode(acc.account.data as Buffer)
                  return accountInfo.mint.toBase58() === mintAddress.toBase58()
                } catch {
                  return false
                }
              })
            }
            
            if (devHasTokens || bundlerHasTokens) {
              console.log("   ✅ Buys confirmed - wallets have tokens!")
              console.log(`   ${devHasTokens ? 'DEV wallet' : ''}${devHasTokens && bundlerHasTokens ? ' + ' : ''}${bundlerHasTokens ? 'Bundler wallets' : ''} have tokens`)
            } else {
              console.log("   ⚠️  Token exists but buys may not have gone through yet (checking again in 2s...)")
              // Don't break yet - wait a bit more for buys to settle
              await sleep(2000)
              // Check one more time
              const devTokenAccounts2 = await connection.getTokenAccountsByOwner(buyerKp.publicKey, {
                programId: TOKEN_PROGRAM_ID,
              })
              const devHasTokens2 = devTokenAccounts2.value.some(acc => {
                try {
                  const accountInfo = SPL_ACCOUNT_LAYOUT.decode(acc.account.data as Buffer)
                  return accountInfo.mint.toBase58() === mintAddress.toBase58()
                } catch {
                  return false
                }
              })
              if (devHasTokens2) {
                console.log("   ✅ Buys confirmed on second check!")
              } else {
                console.log("   ⚠️  Token exists but buys not detected - bundle may have been partially included")
                console.log("   💡 Rapid sell will handle this - it checks for tokens before selling")
              }
            }
          } catch (error) {
            // If verification fails, assume buys went through (token exists = bundle succeeded)
            console.log("   ⚠️  Could not verify buys (RPC error), but token exists = bundle succeeded")
          }
          
          console.log("   ⚡ Stopping all Jito retries - bundle succeeded!")
          tokenConfirmed = true
          // Stop all Jito retries - bundle succeeded, no need to keep retrying
          stopJitoRetries()
          break
        }
      } catch (error) {
        // Ignore errors, keep checking
      }
      
      const elapsed = Math.floor((Date.now() - startWaitTime) / 1000)
      if (elapsed % 10 === 0 && elapsed > 0) { // Log every 10 seconds to avoid spam
        console.log(`   ⏳ Token confirmation check: ${elapsed}s elapsed (rapid sell is running in parallel)`)
      }
      await sleep(checkInterval)
    }
    
    if (!tokenConfirmed) {
      console.log("\n❌❌❌ WARNING: Token NOT confirmed on-chain after 90 seconds!")
      console.log("   This means the bundle was likely NOT included in a block")
      console.log("   However, rapid sell may have already completed if bundle succeeded")
      console.log("   Possible reasons:")
      console.log("   1. Bundle was rejected by validators")
      console.log("   2. Bundle lost in competition")
      console.log("   3. Blockhash expired")
      console.log("   4. Network congestion")
      if (bundleSignature) {
        console.log("\n   Check the transaction on Solscan:")
        console.log(`   https://solscan.io/tx/${bundleSignature}`)
      }
      
      // Save as failed
      // Update existing current-run.json with FAILED status
      if (fs.existsSync(keysPath)) {
        const currentRunData = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
        currentRunData.launchStatus = "FAILED"
        currentRunData.launchStage = "FAILED"
        currentRunData.failureReason = "Bundle not included on-chain"
        fs.writeFileSync(keysPath, JSON.stringify(currentRunData, null, 2))
        console.log("\n   ⚠️  Updated current-run.json: launchStatus = FAILED")
        console.log("   💡 All wallets are saved in current-run.json - you can retry with: npm run retry-bundle")
        console.log("   💡 Or run gather script to recover SOL from wallets")
      } else {
        // Fallback: create new file if somehow it doesn't exist
        const failedRunWallets: any = {
          count: walletsUsed.length,
          totalCreated: kps.length + holderWallets.length + (currentBuyerWallet && currentBuyerWallet.trim() !== '' ? 0 : 1),
          timestamp: Date.now(),
          mintAddress: mintAddress.toBase58(),
          launchStatus: "FAILED",
          launchStage: "FAILED",
          bundleWalletKeys: walletsUsed.map(kp => base58.encode(kp.secretKey)),
          holderWalletKeys: holderWallets.map(kp => base58.encode(kp.secretKey)),
          walletKeys: [...walletsUsed, ...holderWallets].map(kp => base58.encode(kp.secretKey)),
          creatorDevWalletKey: base58.encode(buyerKp.secretKey),
          failureReason: "Bundle not included on-chain"
        }
        fs.writeFileSync(keysPath, JSON.stringify(failedRunWallets, null, 2))
        console.log("\n   ⚠️  Created current-run.json with FAILED status")
      }
      return false
    } else {
      // Update existing current-run.json with SUCCESS status
      if (fs.existsSync(keysPath)) {
        const currentRunData = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
        currentRunData.launchStatus = "SUCCESS"
        currentRunData.totalCreated = kps.length + holderWallets.length + (BUYER_WALLET && BUYER_WALLET.trim() !== '' ? 0 : 1)
        // Ensure all fields are up to date
        currentRunData.count = walletsUsed.length
        currentRunData.bundleWalletKeys = walletsUsed.map(kp => base58.encode(kp.secretKey))
        currentRunData.holderWalletKeys = holderWallets.map(kp => base58.encode(kp.secretKey))
        currentRunData.walletKeys = [...walletsUsed, ...holderWallets].map(kp => base58.encode(kp.secretKey))
        currentRunData.creatorDevWalletKey = base58.encode(buyerKp.secretKey)
        currentRunData.launchStatus = "SUCCESS"
        currentRunData.launchStage = "SUCCESS"
        fs.writeFileSync(keysPath, JSON.stringify(currentRunData, null, 2))
        console.log(`   ✅ Updated current-run.json: launchStatus = SUCCESS`)
      } else {
        // Fallback: create new file if somehow it doesn't exist
        const currentRunWallets: any = {
          count: walletsUsed.length,
          totalCreated: kps.length + holderWallets.length + (currentBuyerWallet && currentBuyerWallet.trim() !== '' ? 0 : 1),
          timestamp: Date.now(),
          mintAddress: mintAddress.toBase58(),
          launchStatus: "SUCCESS",
          launchStage: "SUCCESS",
          bundleWalletKeys: walletsUsed.map(kp => base58.encode(kp.secretKey)),
          holderWalletKeys: holderWallets.map(kp => base58.encode(kp.secretKey)),
          walletKeys: [...walletsUsed, ...holderWallets].map(kp => base58.encode(kp.secretKey)),
          creatorDevWalletKey: base58.encode(buyerKp.secretKey)
        }
        fs.writeFileSync(keysPath, JSON.stringify(currentRunWallets, null, 2))
        console.log(`   ✅ Created current-run.json with SUCCESS status`)
      }
      console.log("\n✅✅✅ TOKEN LAUNCH CONFIRMED - Token is on-chain! ✅✅✅")
      
      // Mark pump address as used if we used one from the pool
      if (usedPumpAddressPublicKey) {
        markPumpAddressAsUsed(usedPumpAddressPublicKey)
        console.log(`✅ Marked pump address as used: ${usedPumpAddressPublicKey}`)
      }
      
      // ============================================
      // MARKETING TASKS (After Launch Success)
      // ============================================
      // Only run if ENABLE_MARKETING is set to 'true' in .env
      if (process.env.ENABLE_MARKETING === 'true') {
        console.log("\n📢 Starting marketing tasks...")
        
        // Load token image as base64 if FILE is set
        let tokenImageBase64: string | null = null
        let imageUrl: string | null = null
        if (process.env.FILE && process.env.FILE.trim()) {
          try {
            const imagePath = process.env.FILE
            // Handle relative paths (./image/filename.jpg or image/filename.jpg)
            let fullImagePath = imagePath
            if (imagePath.startsWith('./image/') || imagePath.startsWith('image/')) {
              fullImagePath = path.join(process.cwd(), 'image', path.basename(imagePath))
            } else if (!path.isAbsolute(imagePath)) {
              fullImagePath = path.join(process.cwd(), imagePath)
            }
            
            if (fs.existsSync(fullImagePath)) {
              const imageBuffer = fs.readFileSync(fullImagePath)
              const imageBase64 = imageBuffer.toString('base64')
              // Detect MIME type from file extension
              const ext = path.extname(fullImagePath).toLowerCase()
              const mimeTypes: Record<string, string> = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.webp': 'image/webp',
              }
              const mimeType = mimeTypes[ext] || 'image/png'
              tokenImageBase64 = `data:${mimeType};base64,${imageBase64}`
              imageUrl = `http://localhost:3001/image/${path.basename(fullImagePath)}`
              console.log(`   📸 Loaded token image: ${path.basename(fullImagePath)}`)
            } else {
              console.log(`   ⚠️  Image file not found: ${fullImagePath}`)
            }
          } catch (error: any) {
            console.log(`   ⚠️  Failed to load image: ${error.message}`)
          }
        }
        
        // Prepare token data for marketing - automatically uses values from .env
        const tokenData = {
          tokenName: process.env.TOKEN_NAME || '',
          tokenSymbol: process.env.TOKEN_SYMBOL || '',
          tokenAddress: mintAddress.toBase58(),
          chain: 'solana',
          website: process.env.WEBSITE || '',
          telegram: '', // Will be updated after Telegram creation
          twitter: process.env.TWITTER || '',
          description: process.env.DESCRIPTION || '',
          websiteLogoUrl: imageUrl || process.env.WEBSITE_LOGO || process.env.FILE || undefined,
          tokenLogoUrl: imageUrl || process.env.FILE || undefined,
          tokenImageBase64: tokenImageBase64 || undefined,
        }
        
        console.log(`   📋 Using token data from launch form:`)
        console.log(`      Name: ${tokenData.tokenName}`)
        console.log(`      Symbol: ${tokenData.tokenSymbol}`)
        console.log(`      Address: ${tokenData.tokenAddress}`)
        console.log(`      Website: ${tokenData.website || 'N/A'}`)
        console.log(`      Twitter: ${tokenData.twitter || 'N/A'}`)
        console.log(`      Description: ${tokenData.description ? tokenData.description.substring(0, 50) + '...' : 'N/A'}`)
        console.log(`      Image: ${tokenImageBase64 ? '✅ Loaded' : '❌ Not set'}`)
        
        // 1. Website Update (if enabled)
        if (process.env.ENABLE_WEBSITE_UPDATE === 'true' && process.env.WEBSITE_URL) {
          try {
            console.log("🌐 Updating website configuration...")
            const websiteResult = await updateWebsite(tokenData, {
              siteUrl: process.env.WEBSITE_URL,
              secret: process.env.WEBSITE_SECRET || '',
            })
            if (websiteResult.success) {
              console.log("✅ Website updated successfully")
            } else {
              console.warn("⚠️  Website update failed:", websiteResult.error)
              console.warn("   Continuing with other marketing tasks...")
            }
          } catch (error: any) {
            console.warn("⚠️  Website update error:", error.message)
            console.warn("   Continuing with other marketing tasks...")
            // Don't throw - continue with other marketing tasks
          }
        }
        
        // 2. Telegram Creation (if enabled)
        let telegramLink = ''
        if (process.env.ENABLE_TELEGRAM_CREATION === 'true' && 
            process.env.TELEGRAM_API_ID && 
            process.env.TELEGRAM_API_HASH && 
            process.env.TELEGRAM_PHONE) {
          try {
            console.log("📱 Creating Telegram group/channel...")
            const telegramResult = await createTelegramGroup(tokenData, {
              apiId: process.env.TELEGRAM_API_ID,
              apiHash: process.env.TELEGRAM_API_HASH,
              phone: process.env.TELEGRAM_PHONE,
              createGroup: process.env.TELEGRAM_CREATE_GROUP !== 'false',
              createChannel: process.env.TELEGRAM_CREATE_CHANNEL === 'true',
              channelUsername: process.env.TELEGRAM_CHANNEL_USERNAME || '',
              groupTitleTemplate: process.env.TELEGRAM_GROUP_TITLE_TEMPLATE || '{token_name} Official',
              useSafeguardBot: process.env.TELEGRAM_USE_SAFEGUARD_BOT !== 'false',
              safeguardBotUsername: process.env.TELEGRAM_SAFEGUARD_BOT_USERNAME || '@safeguard',
              createPortal: process.env.TELEGRAM_CREATE_PORTAL === 'true',
            })
            telegramLink = telegramResult.telegramLink || ''
            tokenData.telegram = telegramLink
            console.log("✅ Telegram group/channel created:", telegramLink)
          } catch (error: any) {
            console.error("❌ Telegram creation failed:", error.message)
            // Don't throw - continue with other marketing tasks
          }
        }
        
        // 3. Twitter Posting (if enabled)
        if (process.env.ENABLE_TWITTER_POSTING === 'true' && 
            process.env.TWITTER_API_KEY && 
            process.env.TWITTER_API_SECRET && 
            process.env.TWITTER_ACCESS_TOKEN && 
            process.env.TWITTER_ACCESS_TOKEN_SECRET) {
          try {
            console.log("🐦 Posting to Twitter...")
            
            // Parse tweets - support both new JSON format and old pipe-separated format
            let tweets: string[] = []
            let tweetImages: (string | null)[] = []
            
            try {
              // Try to parse as JSON (new format with images)
              const tweetData = JSON.parse(process.env.TWITTER_TWEETS || '[]')
              if (Array.isArray(tweetData)) {
                tweets = tweetData.map((t: any) => typeof t === 'string' ? t : (t.text || ''))
                // Load images as base64
                tweetImages = await Promise.all(tweetData.map(async (t: any) => {
                  if (t.imagePath) {
                    try {
                      let fullImagePath = t.imagePath
                      if (t.imagePath.startsWith('./image/') || t.imagePath.startsWith('image/')) {
                        fullImagePath = path.join(process.cwd(), 'image', path.basename(t.imagePath))
                      } else if (!path.isAbsolute(t.imagePath)) {
                        fullImagePath = path.join(process.cwd(), t.imagePath)
                      }
                      
                      if (fs.existsSync(fullImagePath)) {
                        const imageBuffer = fs.readFileSync(fullImagePath)
                        const imageBase64 = imageBuffer.toString('base64')
                        const ext = path.extname(fullImagePath).toLowerCase()
                        const mimeTypes: Record<string, string> = {
                          '.jpg': 'image/jpeg',
                          '.jpeg': 'image/jpeg',
                          '.png': 'image/png',
                          '.gif': 'image/gif',
                          '.webp': 'image/webp',
                        }
                        const mimeType = mimeTypes[ext] || 'image/png'
                        return `data:${mimeType};base64,${imageBase64}`
                      }
                    } catch (error: any) {
                      console.log(`   ⚠️  Failed to load tweet image: ${error.message}`)
                    }
                  }
                  return null
                }))
              } else {
                throw new Error('Not an array')
              }
            } catch (e) {
              // Fallback to old format: pipe-separated tweets
              tweets = (process.env.TWITTER_TWEETS || '[token_name] is live! CA: [CA]').split('|')
              tweetImages = new Array(tweets.length).fill(null)
            }
            
            const tweetDelays = (process.env.TWITTER_TWEET_DELAYS || '').split(',').map(d => parseInt(d) || 0).filter(d => d > 0)
            const twitterResult = await postToTwitter(tokenData, {
              apiKey: process.env.TWITTER_API_KEY,
              apiSecret: process.env.TWITTER_API_SECRET,
              accessToken: process.env.TWITTER_ACCESS_TOKEN,
              accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
              tweets: tweets,
              tweetDelays: tweetDelays,
              tweetImages: tweetImages,
              updateProfile: process.env.TWITTER_UPDATE_PROFILE !== 'false',
              deleteOldTweets: process.env.TWITTER_DELETE_OLD_TWEETS === 'true',
            })
            console.log("✅ Twitter posts sent:", twitterResult.tweetIds.length, "tweet(s)")
          } catch (error: any) {
            console.error("❌ Twitter posting failed:", error.message)
            // Don't throw - marketing tasks are optional
          }
        }
        
        console.log("\n📢 Marketing tasks completed")
      }
      
      return true
    }
  })()
  
  // Wait for rapid sell to complete (if it was started)
  if (rapidSellPromise) {
    await rapidSellPromise
    console.log("\n✅ Rapid sell completed - process exiting")
    // Exit immediately after rapid sell - don't wait for confirmation check
    process.exit(0)
  }
  
  // If rapid sell wasn't started, wait for confirmation check
  await confirmationCheckPromise
}

main()

