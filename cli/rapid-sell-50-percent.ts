import base58 from "bs58"
import fs from "fs"
import path from "path"
import { readJson, retrieveEnvVariable, sleep } from "../utils"
import { Connection, Keypair, VersionedTransaction, PublicKey } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID } from "@solana/spl-token"
import { SPL_ACCOUNT_LAYOUT, TokenAccount } from "@raydium-io/raydium-sdk"
import { getSellTxWithJupiter } from "../utils/swapOnlyAmm"
import { BUYER_WALLET, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, AUTO_COLLECT_FEES, PRIVATE_KEY, SWAP_AMOUNTS, BUYER_AMOUNT, PRIORITY_FEE_LAMPORTS_MEDIUM } from "../constants"
import { collectCreatorFees } from "./collect-fees"

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: "processed"
})

// SELL 50% OF WALLETS - Sells 100% from half the wallets, keeps the other half
// Uses same parallel sell approach as rapid-sell.ts (no Jito bundling)
const rapidSell50Percent = async (mintAddress?: string, initialWaitMs: number = 0) => {
  console.log("🚀🚀🚀 SELL 50% OF WALLETS - Selling 100% from half the wallets 🚀🚀🚀")
  console.log("⚡ This will sell 100% from approximately 50% of wallets, keeping the other half untouched")
  const startTime = Date.now()
  
  // Read current run info
  const currentRunPath = path.join(process.cwd(), 'keys', 'current-run.json')
  let bundlerWallets: Keypair[] = []
  let targetMint: string | null = null
  
  if (fs.existsSync(currentRunPath)) {
    try {
      const currentRunData = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'))
      targetMint = mintAddress || currentRunData.mintAddress || null
      
      if (currentRunData.walletKeys && Array.isArray(currentRunData.walletKeys) && currentRunData.walletKeys.length > 0) {
        bundlerWallets = currentRunData.walletKeys.map((kp: string) => Keypair.fromSecretKey(base58.decode(kp)))
        console.log(`✅ Found ${bundlerWallets.length} bundler wallets from current run`)
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
  
  // DO NOT include DEV wallet in the 50% sell - it will be sold in the remaining wallets sell
  const buyerKp = Keypair.fromSecretKey(base58.decode(BUYER_WALLET))
  const filteredBundlerWallets = bundlerWallets.filter(kp => !kp.publicKey.equals(buyerKp.publicKey))
  
  if (filteredBundlerWallets.length === 0) {
    console.log("❌ No bundler wallets found (only dev wallet)")
    return
  }
  
  if (!targetMint) {
    console.log("❌ No mint address provided or found in current-run.json")
    return
  }
  
  console.log(`🎯 Target mint: ${targetMint}`)
  console.log(`📦 Total bundler wallets: ${filteredBundlerWallets.length}`)
  
  // Get buy amounts for each bundler wallet
  // SWAP_AMOUNTS is already a number[] array (bundler wallets only, excludes dev)
  const swapAmounts = SWAP_AMOUNTS && SWAP_AMOUNTS.length > 0 ? SWAP_AMOUNTS : []
  
  // Create array of wallets with their buy amounts
  const walletsWithAmounts = filteredBundlerWallets.map((kp, index) => ({
    wallet: kp,
    buyAmount: swapAmounts[index] || 0.3, // Default to 0.3 if not specified
    index: index
  }))
  
  // Sort by buy amount DESCENDING (highest first)
  walletsWithAmounts.sort((a, b) => b.buyAmount - a.buyAmount)
  
  console.log(`💰 Bundler wallets sorted by buy amount (highest first):`)
  walletsWithAmounts.forEach((w, i) => {
    console.log(`   ${i + 1}. Wallet ${w.index + 1}: ${w.buyAmount} SOL`)
  })
  
  // Calculate 50% - if odd number, sell one extra (so 5 wallets = sell 3, not 2)
  const totalBundlerWallets = filteredBundlerWallets.length
  const halfCount = Math.ceil(totalBundlerWallets / 2) // Round UP for odd numbers
  
  console.log(`\n📊 Calculation: ${totalBundlerWallets} bundler wallets → sell ${halfCount} (${totalBundlerWallets % 2 === 0 ? '50%' : 'more than 50% due to odd number'})`)
  
  // Take the top wallets (highest buy amounts) to sell
  const walletsToSell = walletsWithAmounts.slice(0, halfCount).map(w => w.wallet)
  const walletsToKeep = walletsWithAmounts.slice(halfCount).map(w => w.wallet)
  
  console.log(`\n💰 Wallets to SELL (100% of tokens, highest buy amounts first): ${walletsToSell.length}`)
  walletsToSell.forEach((kp, i) => {
    const walletInfo = walletsWithAmounts.find(w => w.wallet.publicKey.equals(kp.publicKey))
    console.log(`   ${i + 1}. ${kp.publicKey.toBase58().slice(0, 8)}... (${walletInfo?.buyAmount || '?'} SOL buy)`)
  })
  
  console.log(`\n💎 Wallets to KEEP (untouched): ${walletsToKeep.length}`)
  walletsToKeep.forEach((kp, i) => {
    const walletInfo = walletsWithAmounts.find(w => w.wallet.publicKey.equals(kp.publicKey))
    console.log(`   ${i + 1}. ${kp.publicKey.toBase58().slice(0, 8)}... (${walletInfo?.buyAmount || '?'} SOL buy)`)
  })
  
  console.log(`\n👤 Dev wallet: NOT included in 50% sell - will be sold in remaining wallets sell`)
  
  // Save which wallets were sold and which to keep for the remaining sell
  const soldWalletsPath = path.join(process.cwd(), 'keys', 'sold-wallets.json')
  const soldWalletsData = {
    soldWalletKeys: walletsToSell.map(kp => base58.encode(kp.secretKey)),
    keptWalletKeys: walletsToKeep.map(kp => base58.encode(kp.secretKey)),
    devWalletKey: base58.encode(buyerKp.secretKey),
    mintAddress: targetMint,
    timestamp: new Date().toISOString()
  }
  fs.writeFileSync(soldWalletsPath, JSON.stringify(soldWalletsData, null, 2))
  console.log(`💾 Saved wallet state to sold-wallets.json`)
  
  // SKIP DIAGNOSTIC CHECKS - They block and slow down rapid sell!
  // Rapid sell has retry logic that will handle tokens not being available yet
  // These checks just waste time when we need to sell IMMEDIATELY
  console.log(`\n⚡⚡⚡ SKIPPING DIAGNOSTIC CHECKS FOR SPEED ⚡⚡⚡`)
  console.log(`   Rapid sell will retry until tokens are detected`)
  console.log(`   Starting IMMEDIATELY to beat all bots!\n`)
  
  // INSTANT START - Fire immediately, don't wait for bonding curve
  // Smart retry will handle "tokens not detected yet" errors
  if (initialWaitMs > 0) {
    console.log(`⏳ Optional wait: ${initialWaitMs}ms...`)
    await sleep(initialWaitMs)
  }
  console.log(`⚡⚡⚡ INSTANT FIRE: All wallets starting NOW - will retry until tokens detected! ⚡⚡⚡\n`)
  
  // RPC Rate Limiting
  const MAX_RPC_PER_SECOND = 45
  let lastRpcCallTime = 0
  const minRpcInterval = 1000 / MAX_RPC_PER_SECOND
  
  const rateLimitedRpc = async <T>(rpcCall: () => Promise<T>): Promise<T> => {
    const now = Date.now()
    const timeSinceLastCall = now - lastRpcCallTime
    if (timeSinceLastCall < minRpcInterval) {
      await sleep(minRpcInterval - timeSinceLastCall)
    }
    lastRpcCallTime = Date.now()
    return await rpcCall()
  }
  
  console.log(`⚡ RPC Rate Limiter: ${MAX_RPC_PER_SECOND} RPS (Helius Developer plan: 50 RPS)`)
  console.log(`⚡ PARALLEL MODE: All transactions sent simultaneously via Helius RPC (not Jito)`)
  console.log(`⚡ Higher priority fees (0.001 SOL per wallet) for faster inclusion`)
  console.log(`⏱️  Starting rapid sell process...\n`)
  
  // Create sell tasks for wallets to sell - even if tokens not detected yet
  // Smart fallback: will keep checking until tokens appear
  const sellTasks = walletsToSell.map(kp => ({
    wallet: kp,
    account: null as TokenAccount | null, // Will be found in retry loop
    balance: "0", // Will be updated when tokens detected
    walletAddr: kp.publicKey.toBase58(),
    mint: targetMint!
  }))
  
  console.log(`📦 Created ${sellTasks.length} sell tasks - will detect tokens and sell 100% from each\n`)
  
  // RACE MODE - INSTANT FIRE with smart retry
  // Fires IMMEDIATELY, retries until tokens detected, then sells 100% at maximum speed
  const MAX_RETRIES = 500 // More retries to handle early detection
  const RETRY_DELAY = 20 // 20ms between retries (ultra-fast - optimized for speed)
  const EARLY_RETRY_DELAY = 20 // Same delay even early (we want maximum speed)
  
  // INSTANT FIRE - ALL wallets start with small stagger to avoid liquidity conflicts
  // Small 50ms stagger prevents all wallets from hitting pool simultaneously
  // This avoids error 6001 (insufficient liquidity/price moved) when multiple sells compete
  // Smart fallback: keeps checking for tokens until detected, then sells 100%
  // Each wallet sends its transaction via Helius RPC in parallel (not Jito bundling)
  // Higher priority fees ensure faster inclusion
  const sellPromises = sellTasks.map(async ({ wallet, account, balance, walletAddr, mint }, index) => {
    // Small stagger: 50ms delay per wallet to avoid simultaneous pool hits
    // This prevents error 6001 when multiple wallets compete for same liquidity
    await sleep(index * 50) // 0ms, 50ms, 100ms, 150ms, etc.
    let attempts = 0
    let success = false
    let currentAccount: TokenAccount | null = account
    let currentBalance = balance
    
    console.log(`🚀 Wallet ${index + 1}/${sellTasks.length}: ${walletAddr.slice(0, 8)}... started checking for tokens`)
    
    while (attempts < MAX_RETRIES && !success) {
      attempts++
      
      if (attempts === 1 || attempts % 20 === 0) {
        console.log(`🔄 Wallet ${index + 1}/${sellTasks.length} (${walletAddr.slice(0, 8)}...): attempt ${attempts}/${MAX_RETRIES}`)
      }
      
      try {
        // Find token account if not found yet
        if (!currentAccount) {
          try {
            const tokenAccounts = await rateLimitedRpc(() => 
              connection.getTokenAccountsByOwner(wallet.publicKey, {
                programId: TOKEN_PROGRAM_ID,
              }, "processed")
            )
            
            for (const { pubkey, account: acc } of tokenAccounts.value) {
              const accountInfo = SPL_ACCOUNT_LAYOUT.decode(acc.data)
              if (accountInfo.mint.toBase58() === mint) {
                currentAccount = {
                  pubkey,
                  programId: acc.owner,
                  accountInfo,
                }
                break
              }
            }
            
            if (!currentAccount) {
              await sleep(RETRY_DELAY)
              continue
            }
          } catch (error: any) {
            await sleep(RETRY_DELAY)
            continue
          }
        }
        
        // Get fresh balance
        try {
          const freshBalance = await rateLimitedRpc(() =>
            connection.getTokenAccountBalance(currentAccount!.pubkey, "processed")
          )
          if (freshBalance.value.uiAmount && freshBalance.value.uiAmount > 0) {
            currentBalance = freshBalance.value.amount
          } else {
            await sleep(RETRY_DELAY)
            continue
          }
        } catch (error) {
          await sleep(RETRY_DELAY)
          continue
        }
        
        // Get sell transaction from Jupiter (100% of current balance) with MEDIUM priority fee
        const sellTx = await getSellTxWithJupiter(wallet, currentAccount.accountInfo.mint, currentBalance, PRIORITY_FEE_LAMPORTS_MEDIUM)
        
        if (!sellTx) {
          if (attempts % 30 === 0) {
            console.log(`⏳ ${walletAddr.slice(0, 8)}... tokens found but bonding curve not ready yet (attempt ${attempts})...`)
          }
          await sleep(RETRY_DELAY)
          continue
        }
        
        // Send transaction via Helius RPC (parallel execution)
        const signature = await rateLimitedRpc(() =>
          connection.sendTransaction(sellTx, {
            skipPreflight: true,
            maxRetries: 0,
            preflightCommitment: "processed"
          })
        )
        
        // Verify transaction confirmed
        let confirmed = false
        for (let verifyAttempt = 0; verifyAttempt < 100; verifyAttempt++) {
          await sleep(100)
          try {
            const status = await connection.getSignatureStatus(signature)
            if (status.value) {
              if (status.value.err) {
                break
              } else if (status.value.confirmationStatus === "confirmed" || status.value.confirmationStatus === "finalized") {
                confirmed = true
                break
              }
            }
          } catch (e) {
            // Keep checking
          }
        }
        
        if (confirmed) {
          console.log(`✅✅✅ SOLD 100%: ${walletAddr.slice(0, 8)}... → ${signature.slice(0, 8)}... (attempt ${attempts}) - CONFIRMED`)
          console.log(`   View: https://solscan.io/tx/${signature}`)
          success = true
        } else {
          console.log(`⚠️  Transaction sent but NOT confirmed: ${walletAddr.slice(0, 8)}... → ${signature.slice(0, 8)}...`)
          await sleep(RETRY_DELAY)
        }
        
      } catch (error: any) {
        const errorMsg = error.message || String(error)
        if (errorMsg.includes('429') || errorMsg.includes('Too Many Requests')) {
          const backoffDelay = Math.min(RETRY_DELAY * Math.pow(1.3, Math.floor(attempts / 30)), 300)
          await sleep(backoffDelay)
        } else {
          await sleep(RETRY_DELAY)
        }
        
        if (attempts >= MAX_RETRIES) {
          console.log(`❌❌❌ Wallet ${index + 1}/${sellTasks.length} FAILED after ${MAX_RETRIES} attempts: ${walletAddr.slice(0, 8)}...`)
        }
      }
    }
    
    return { walletAddr, success, attempts }
  })
  
  // Wait for all sells to complete
  const results = await Promise.all(sellPromises)
  
  const successful = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length
  const elapsed = Date.now() - startTime
  
  console.log(`\n${'='.repeat(60)}`)
  console.log(`🏁 50% WALLETS SELL COMPLETE`)
  console.log(`${'='.repeat(60)}`)
  console.log(`✅ Sold from: ${successful} wallets (100% of tokens)`)
  console.log(`💎 Kept untouched: ${walletsToKeep.length} wallets`)
  console.log(`👤 Dev wallet: Will be sold in remaining wallets sell`)
  console.log(`❌ Failed: ${failed} wallets`)
  console.log(`⏱️  Total time: ${elapsed}ms (${(elapsed / 1000).toFixed(2)}s)`)
  console.log(`\n💡 Next step: Run 'npm run rapid-sell-remaining' to sell the remaining wallets`)
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
  rapidSell50Percent(mintAddress, initialWait).catch(console.error)
}

export { rapidSell50Percent }
