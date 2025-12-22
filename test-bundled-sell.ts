import base58 from "bs58"
import fs from "fs"
import path from "path"
import { readJson, retrieveEnvVariable, sleep } from "./utils"
import { Connection, Keypair, VersionedTransaction, PublicKey, TransactionMessage } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID } from "@solana/spl-token"
import { SPL_ACCOUNT_LAYOUT, TokenAccount } from "@raydium-io/raydium-sdk"
import { BUYER_WALLET, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, LIL_JIT_MODE } from "./constants"
import { executeJitoTx } from "./executor/jito"
import { sendBundle } from "./executor/liljito"

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: "processed"
})

// TEST MODE: Test bundled rapid sell without actually sending transactions
// Usage: npm run test-bundled-sell [mintAddress] [--dry-run]
const testBundledSell = async (mintAddress?: string, dryRun: boolean = true) => {
  console.log("🧪🧪🧪 TEST MODE - Bundled Rapid Sell (DRY RUN) 🧪🧪🧪")
  console.log(`   Mode: ${dryRun ? 'DRY RUN (no transactions sent)' : 'LIVE (will send transactions)'}`)
  console.log("=".repeat(80))
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
    console.log('   💡 Tip: Run a token launch first to create current-run.json')
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
    console.log("   💡 Usage: npm run test-bundled-sell <mintAddress> [--dry-run]")
    return
  }
  
  console.log(`🎯 Target mint: ${targetMint}`)
  console.log(`📦 Total wallets: ${walletsToProcess.length}`)
  
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
            console.log(`   ✅ ${kp.publicKey.toBase58().slice(0, 8)}... has ${balance.value.uiAmount?.toFixed(2)} tokens`)
          }
        }
      }
    } catch (error: any) {
      console.log(`   ⚠️  Error checking ${kp.publicKey.toBase58().slice(0, 8)}...: ${error.message}`)
    }
  }
  
  if (walletTokenData.length === 0) {
    console.log("❌ No wallets have tokens to sell")
    console.log("   💡 Tip: Make sure the token was successfully launched and wallets received tokens")
    return
  }
  
  console.log(`\n💰 Found ${walletTokenData.length} wallets with tokens to sell`)
  
  // Get a SINGLE blockhash FIRST (required for Jito bundling)
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
        if (quoteResponse.error) {
          console.log(`      Error: ${JSON.stringify(quoteResponse.error)}`)
        }
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
    console.log("   💡 This might mean:")
    console.log("      - Token is not yet on Raydium (still on bonding curve)")
    console.log("      - Token has no liquidity")
    console.log("      - Jupiter API is down")
    return
  }
  
  console.log(`✅ Got ${validQuotes.length}/${walletTokenData.length} quotes`)
  
  // Show quote summary
  console.log(`\n📊 Quote Summary:`)
  for (const { quote, walletAddr } of validQuotes) {
    const inAmount = (parseInt(quote.inAmount) / 1e9).toFixed(4)
    const outAmount = (parseInt(quote.outAmount) / 1e9).toFixed(4)
    console.log(`   ${walletAddr.slice(0, 8)}...: ${inAmount} tokens → ${outAmount} SOL`)
  }
  
  // Now get swap transactions from Jupiter for all wallets in parallel
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
        if (swapData.error) {
          console.log(`      Error: ${JSON.stringify(swapData.error)}`)
        }
        return null
      }
      
      const swapTransactionBuf = Buffer.from(swapData.swapTransaction, "base64")
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf)
      transaction.sign([wallet])
      
      return { tx: transaction, walletAddr, quote }
    } catch (error: any) {
      console.log(`   ❌ Swap error for ${walletAddr.slice(0, 8)}...: ${error.message}`)
      return null
    }
  })
  
  const swapResults = await Promise.all(swapTxPromises)
  const bundledTransactions: VersionedTransaction[] = []
  const transactionDetails: Array<{ walletAddr: string, size: number, quote: any }> = []
  
  for (const result of swapResults) {
    if (result) {
      bundledTransactions.push(result.tx)
      const txSize = result.tx.serialize().length
      transactionDetails.push({
        walletAddr: result.walletAddr,
        size: txSize,
        quote: result.quote
      })
      console.log(`   ✅ Got swap transaction for ${result.walletAddr.slice(0, 8)}... (${txSize} bytes)`)
    } else {
      failedWallets++
    }
  }
  
  if (bundledTransactions.length === 0) {
    console.log("❌ Failed to get any swap transactions")
    return
  }
  
  // Analyze transaction blockhashes
  console.log(`\n🔍 Analyzing transaction blockhashes...`)
  const blockhashes = new Set<string>()
  for (const tx of bundledTransactions) {
    // Extract blockhash from transaction message
    const message = tx.message
    // VersionedTransaction doesn't expose blockhash directly, but we can check serialization
    const serialized = tx.serialize()
    // For now, just note that we have transactions
    blockhashes.add('jupiter-generated')
  }
  
  console.log(`   ⚠️  Note: Jupiter generates transactions with their own blockhashes`)
  console.log(`   Jito bundling requires same blockhash - transactions may have different ones`)
  console.log(`   If blockhashes differ, Jito may reject the bundle`)
  
  // Calculate total bundle size
  const totalBundleSize = bundledTransactions.reduce((sum, tx) => sum + tx.serialize().length, 0)
  console.log(`\n📦 Bundle Analysis:`)
  console.log(`   Total transactions: ${bundledTransactions.length}`)
  console.log(`   Total bundle size: ${totalBundleSize} bytes (${(totalBundleSize / 1024).toFixed(2)} KB)`)
  console.log(`   Average transaction size: ${Math.round(totalBundleSize / bundledTransactions.length)} bytes`)
  
  // DRY RUN MODE - Don't actually send
  if (dryRun) {
    console.log(`\n${'='.repeat(80)}`)
    console.log(`🧪 DRY RUN COMPLETE - No transactions were sent`)
    console.log(`${'='.repeat(80)}`)
    console.log(`✅ Would bundle and send: ${bundledTransactions.length} sell transactions`)
    console.log(`❌ Would fail: ${failedWallets} wallets`)
    console.log(`⏱️  Total time: ${Date.now() - startTime}ms`)
    console.log(`\n💡 To actually send the bundle, run:`)
    console.log(`   npm run test-bundled-sell ${targetMint} --live`)
    console.log(`   OR`)
    console.log(`   npm run rapid-sell-bundled ${targetMint}`)
    console.log(`${'='.repeat(80)}\n`)
    return
  }
  
  // LIVE MODE - Actually send the bundle
  console.log(`\n🚀 LIVE MODE - Sending bundle via Jito...\n`)
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
}

// Run if called directly
if (require.main === module) {
  const args = process.argv.slice(2)
  const mintAddress = args.find(arg => !arg.startsWith('--'))
  const dryRun = !args.includes('--live')
  
  testBundledSell(mintAddress, dryRun).catch(console.error)
}

export { testBundledSell }

