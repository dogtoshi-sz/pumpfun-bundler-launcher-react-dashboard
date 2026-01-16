import base58 from "bs58"
import fs from "fs"
import path from "path"
import { readJson, retrieveEnvVariable, sleep } from "../utils"
import { Connection, Keypair, VersionedTransaction, PublicKey, TransactionMessage } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID } from "@solana/spl-token"
import { SPL_ACCOUNT_LAYOUT, TokenAccount } from "@raydium-io/raydium-sdk"
// Note: We'll get quotes and swap transactions directly here instead of using getSellTxWithJupiter
// This allows us to bundle them properly
import { BUYER_WALLET, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, LIL_JIT_MODE, AUTO_COLLECT_FEES, PRIVATE_KEY } from "../constants"
import { collectCreatorFees } from "./collect-fees"
import { executeJitoTx } from "../executor/jito"
import { sendBundle } from "../executor/liljito"

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: "processed"
})

// BUNDLED RAPID SELL - Uses Jito bundling just like token launch
// Gets sell transactions from Jupiter, rebuilds them with same blockhash, bundles via Jito
const rapidSellBundled = async (mintAddress?: string, initialWaitMs: number = 0) => {
  console.log("🚀🚀🚀 BUNDLED RAPID SELL - Using Jito bundling like token launch! 🚀🚀🚀")
  console.log("⚡ Getting sell transactions, bundling them, and sending via Jito...")
  const startTime = Date.now()
  
  // Read current run info
  const currentRunPath = path.join(process.cwd(), 'keys', 'current-run.json')
  let walletsToProcess: Keypair[] = []
  let targetMint: string | null = null
  
  if (fs.existsSync(currentRunPath)) {
    try {
      const currentRunData = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'))
      targetMint = mintAddress || currentRunData.mintAddress || null
      
      if (currentRunData.walletKeys && Array.isArray(currentRunData.walletKeys) && currentRunData.walletKeys.length > 0) {
        walletsToProcess = currentRunData.walletKeys.map((kp: string) => Keypair.fromSecretKey(base58.decode(kp)))
        console.log(`✅ Found ${walletsToProcess.length} wallets from current run`)
      } else {
        console.log("❌ No walletKeys in current-run.json")
        return
      }
    } catch (error) {
      console.log('❌ Error reading current-run.json:', error)
      return
    }
  } else {
    console.log('❌ No current-run.json found')
    return
  }
  
  // Add DEV wallet
  const buyerKp = Keypair.fromSecretKey(base58.decode(BUYER_WALLET))
  const devWalletAlreadyIncluded = walletsToProcess.some(kp => kp.publicKey.equals(buyerKp.publicKey))
  if (!devWalletAlreadyIncluded) {
    walletsToProcess.push(buyerKp)
  }
  
  if (!targetMint) {
    console.log("❌ No mint address provided or found in current-run.json")
    return
  }
  
  console.log(`🎯 Target mint: ${targetMint}`)
  console.log(`📦 Total wallets: ${walletsToProcess.length}`)
  
  // Optional initial wait
  if (initialWaitMs > 0) {
    console.log(`⏳ Waiting ${initialWaitMs}ms before starting...`)
    await sleep(initialWaitMs)
  }
  
  // Get token accounts and balances for all wallets
  console.log(`\n🔍 Getting token accounts and balances for all wallets...`)
  const walletTokenData: Array<{ wallet: Keypair, account: TokenAccount, balance: string, walletAddr: string }> = []
  
  for (const kp of walletsToProcess) {
    try {
      const tokenAccounts = await connection.getTokenAccountsByOwner(kp.publicKey, {
        programId: TOKEN_PROGRAM_ID,
      }, "confirmed")
      
      for (const { pubkey, account } of tokenAccounts.value) {
        const accountInfo = SPL_ACCOUNT_LAYOUT.decode(account.data)
        if (accountInfo.mint.toBase58() === targetMint) {
          const balance = await connection.getTokenAccountBalance(pubkey, "confirmed")
          if (balance.value.uiAmount && balance.value.uiAmount > 0) {
            walletTokenData.push({
              wallet: kp,
              account: {
                pubkey,
                programId: account.owner,
                accountInfo,
              },
              balance: balance.value.amount,
              walletAddr: kp.publicKey.toBase58()
            })
            console.log(`   ✅ ${kp.publicKey.toBase58().slice(0, 8)}... has ${balance.value.uiAmount} tokens`)
          }
        }
      }
    } catch (error: any) {
      console.log(`   ⚠️  Error checking ${kp.publicKey.toBase58().slice(0, 8)}...: ${error.message}`)
    }
  }
  
  if (walletTokenData.length === 0) {
    console.log("❌ No wallets have tokens to sell")
    return
  }
  
  console.log(`\n💰 Found ${walletTokenData.length} wallets with tokens to sell`)
  
  // Get a SINGLE blockhash FIRST (required for Jito bundling - all transactions must use same blockhash)
  console.log(`\n🔑 Getting fresh blockhash for bundle...`)
  const latestBlockhash = await connection.getLatestBlockhash("confirmed")
  console.log(`   Blockhash: ${latestBlockhash.blockhash.slice(0, 8)}... (valid until block ${latestBlockhash.lastValidBlockHeight})`)
  
  // Get quotes from Jupiter for all wallets first (parallel)
  console.log(`\n📊 Getting quotes from Jupiter for all wallets (parallel)...`)
  const SLIPPAGE = 50
  let failedWallets = 0
  const quotePromises = walletTokenData.map(async ({ wallet, account, balance, walletAddr }) => {
    try {
      const quoteUrl = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${account.accountInfo.mint.toBase58()}&outputMint=So11111111111111111111111111111111111111112&amount=${balance}&slippageBps=${SLIPPAGE}`
      const quoteResponse = await fetch(quoteUrl).then(r => r.json())
      
      if (quoteResponse.error || !quoteResponse.outAmount) {
        console.log(`   ❌ Quote error for ${walletAddr.slice(0, 8)}...`)
        return null
      }
      
      return { quote: quoteResponse, wallet, account, balance, walletAddr }
    } catch (error: any) {
      console.log(`   ❌ Quote error for ${walletAddr.slice(0, 8)}...: ${error.message}`)
      return null
    }
  })
  
  const quoteResults = await Promise.all(quotePromises)
  const validQuotes = quoteResults.filter(q => q !== null) as Array<{ quote: any, wallet: Keypair, account: TokenAccount, balance: string, walletAddr: string }>
  
  if (validQuotes.length === 0) {
    console.log("❌ Failed to get any quotes from Jupiter")
    return
  }
  
  console.log(`✅ Got ${validQuotes.length}/${walletTokenData.length} quotes`)
  
  // Now get swap transactions from Jupiter for all wallets in parallel
  // They'll use similar blockhashes since we request them quickly
  console.log(`\n🔄 Getting swap transactions from Jupiter (parallel)...`)
  const swapTxPromises = validQuotes.map(async ({ quote, wallet, account, balance, walletAddr }) => {
    try {
      const swapResponse = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: wallet.publicKey.toString(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 52000
        }),
      })
      
      const swapData = await swapResponse.json()
      
      if (swapData.error || !swapData.swapTransaction) {
        console.log(`   ❌ Swap error for ${walletAddr.slice(0, 8)}...`)
        return null
      }
      
      const swapTransactionBuf = Buffer.from(swapData.swapTransaction, "base64")
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf)
      transaction.sign([wallet])
      
      return { tx: transaction, walletAddr }
    } catch (error: any) {
      console.log(`   ❌ Swap error for ${walletAddr.slice(0, 8)}...: ${error.message}`)
      return null
    }
  })
  
  const swapResults = await Promise.all(swapTxPromises)
  const bundledTransactions: VersionedTransaction[] = []
  
  for (const result of swapResults) {
    if (result) {
      bundledTransactions.push(result.tx)
      console.log(`   ✅ Got swap transaction for ${result.walletAddr.slice(0, 8)}...`)
    } else {
      failedWallets++
    }
  }
  
  if (bundledTransactions.length === 0) {
    console.log("❌ Failed to get any swap transactions")
    return
  }
  
  console.log(`\n📦 Bundle ready: ${bundledTransactions.length} transactions`)
  console.log(`   ⚠️  Note: Jupiter transactions may have different blockhashes`)
  console.log(`   Jito will attempt to bundle them - if blockhashes differ too much, it may fail`)
  console.log(`🚀 Sending bundle via Jito...\n`)
  
  // Send bundle via Jito (same as token launch)
  const mainKp = Keypair.fromSecretKey(base58.decode(retrieveEnvVariable('PRIVATE_KEY')))
  
  if (LIL_JIT_MODE) {
    const bundleId = await sendBundle(bundledTransactions)
    if (!bundleId) {
      console.error("❌ Bundle sending failed")
      return
    }
    console.log(`✅ Bundle sent via Lil Jito with ID: ${bundleId}`)
  } else {
    const result = await executeJitoTx(bundledTransactions, mainKp, "confirmed", latestBlockhash)
    if (!result) {
      console.error("❌ Jito bundle execution failed")
      return
    }
    console.log(`✅ Bundle executed via Jito, signature: ${result}`)
  }
  
  const elapsed = Date.now() - startTime
  console.log(`\n${'='.repeat(60)}`)
  console.log(`🏁 BUNDLED RAPID SELL COMPLETE`)
  console.log(`${'='.repeat(60)}`)
  console.log(`✅ Bundled and sent: ${bundledTransactions.length} sell transactions`)
  console.log(`❌ Failed: ${failedWallets} wallets`)
  console.log(`⏱️  Total time: ${elapsed}ms (${(elapsed / 1000).toFixed(2)}s)`)
  console.log(`${'='.repeat(60)}\n`)

  // Optional: Collect creator fees after selling
  if (AUTO_COLLECT_FEES) {
    try {
      const creatorWallet = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))
      await collectCreatorFees(creatorWallet)
    } catch (error: any) {
      console.error(`\n⚠️  Error collecting fees: ${error.message}`)
      console.log("   You can manually collect fees with: npm run collect-fees")
    }
  }
}

// Run if called directly
if (require.main === module) {
  const mintAddress = process.argv[2]
  const initialWait = process.argv[3] ? parseInt(process.argv[3]) : 0
  rapidSellBundled(mintAddress, initialWait).catch(console.error)
}

export { rapidSellBundled }

