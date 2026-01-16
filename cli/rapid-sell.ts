import base58 from "bs58"
import fs from "fs"
import path from "path"
import { readJson, retrieveEnvVariable, sleep } from "../utils"
import { Connection, Keypair, VersionedTransaction, PublicKey } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID } from "@solana/spl-token"
import { SPL_ACCOUNT_LAYOUT, TokenAccount } from "@raydium-io/raydium-sdk"
import { getSellTxWithJupiter } from "../utils/swapOnlyAmm"
import { BUYER_WALLET, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, AUTO_COLLECT_FEES, PRIVATE_KEY, PRIORITY_FEE_LAMPORTS_HIGH, PRIORITY_FEE_LAMPORTS_MEDIUM, PRIORITY_FEE_LAMPORTS_LOW } from "../constants"
import { collectCreatorFees } from "./collect-fees"

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: "processed"
})

// Rapid sell function - sells from ALL wallets in parallel (milliseconds speed)
// Optimized to beat sniper bots - fires IMMEDIATELY, before bonding curve is even detected
// Smart retry: if tokens not detected yet, keeps trying until they are
// priorityFee: 'high' for WebSocket threshold triggers (very fast, expensive), 'medium' for rapid sells (fast, reasonable), 'low' for manual sells (cheap!), 'none' for no priority fee
const rapidSell = async (mintAddress?: string, initialWaitMs: number = 0, priorityFee: 'high' | 'medium' | 'low' | 'none' = 'medium') => {
  let priorityFeeText: string
  let priorityFeeAmount: string
  let priorityFeeLamports: number
  
  if (priorityFee === 'none') {
    priorityFeeText = 'NONE (no priority fee - cheapest!)'
    priorityFeeAmount = '0'
    priorityFeeLamports = 0
  } else if (priorityFee === 'high') {
    priorityFeeText = 'HIGH (WebSocket threshold met!)'
    priorityFeeAmount = (PRIORITY_FEE_LAMPORTS_HIGH / 1e9).toFixed(4)
    priorityFeeLamports = PRIORITY_FEE_LAMPORTS_HIGH
  } else if (priorityFee === 'medium') {
    priorityFeeText = 'MEDIUM (rapid sell - fast and reasonable)'
    priorityFeeAmount = (PRIORITY_FEE_LAMPORTS_MEDIUM / 1e9).toFixed(4)
    priorityFeeLamports = PRIORITY_FEE_LAMPORTS_MEDIUM
  } else {
    priorityFeeText = 'LOW (manual/cheap)'
    priorityFeeAmount = (PRIORITY_FEE_LAMPORTS_LOW / 1e9).toFixed(4)
    priorityFeeLamports = PRIORITY_FEE_LAMPORTS_LOW
  }
  
  console.log("🚀🚀🚀 RACE MODE - INSTANT FIRE to beat sniper bots! 🚀🚀🚀")
  console.log(`⚡ Priority Fee: ${priorityFeeText} (${priorityFeeAmount} SOL)`)
  console.log("⚡ Starting IMMEDIATELY - will retry until tokens detected...")
  const startTime = Date.now()
  
  // Read current run info
  const currentRunPath = path.join(process.cwd(), 'keys', 'current-run.json')
  let walletsToProcess: Keypair[] = []
  let targetMint: string | null = null
  
  // Check command line argument for mint address (from WebSocket tracker)
  if (process.argv[2]) {
    targetMint = process.argv[2]
    console.log(`✅ Using mint address from command line: ${targetMint}`)
  }
  
  // Determine DEV/Creator wallet - PRIORITY: creatorDevWalletKey from current-run.json, FALLBACK: BUYER_WALLET from .env
  let buyerKp: Keypair
  let devWalletSource: string
  
  if (fs.existsSync(currentRunPath)) {
    try {
      const currentRunData = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'))
      
      // PRIORITY: Use creatorDevWalletKey from current-run.json (the actual wallet used for the launch)
      if (currentRunData.creatorDevWalletKey) {
        buyerKp = Keypair.fromSecretKey(base58.decode(currentRunData.creatorDevWalletKey))
        devWalletSource = 'creatorDevWalletKey from current-run.json'
        console.log(`✅ Using DEV wallet from current-run.json: ${buyerKp.publicKey.toBase58()}`)
      } else if (BUYER_WALLET && BUYER_WALLET.trim() !== '') {
        // FALLBACK: Use BUYER_WALLET from .env (persistent wallet)
        buyerKp = Keypair.fromSecretKey(base58.decode(BUYER_WALLET))
        devWalletSource = 'BUYER_WALLET from .env'
        console.log(`✅ Using DEV wallet from BUYER_WALLET (.env): ${buyerKp.publicKey.toBase58()}`)
      } else {
        console.log("❌ No DEV wallet found - cannot sell")
        return
      }
      
      // Get mint address from parameter or current-run.json
      targetMint = mintAddress || currentRunData.mintAddress || null
      
      // Add DEV wallet FIRST (highest priority - should sell first)
      walletsToProcess.push(buyerKp)
      console.log(`✅ Added DEV wallet first (${devWalletSource}): ${buyerKp.publicKey.toBase58()}`)
      
      // PRIORITY: Bundle wallets first (these are the important ones with larger amounts)
      // Holder wallets are just for holder count and can be sold later separately
      if (currentRunData.bundleWalletKeys && Array.isArray(currentRunData.bundleWalletKeys) && currentRunData.bundleWalletKeys.length > 0) {
        // Use bundleWalletKeys if available (new format)
        const bundleWallets = currentRunData.bundleWalletKeys.map((kp: string) => Keypair.fromSecretKey(base58.decode(kp)))
        // Filter out DEV wallet if it's already in bundle wallets (shouldn't happen, but safety check)
        const bundleWalletsFiltered = bundleWallets.filter(kp => !kp.publicKey.equals(buyerKp.publicKey))
        walletsToProcess.push(...bundleWalletsFiltered)
        console.log(`✅ Added ${bundleWalletsFiltered.length} BUNDLE wallets (priority for selling)`)
      } else if (currentRunData.walletKeys && Array.isArray(currentRunData.walletKeys) && currentRunData.walletKeys.length > 0) {
        // Fallback: Use walletKeys (old format - assume all are bundle wallets)
        const bundlerWallets = currentRunData.walletKeys.map((kp: string) => Keypair.fromSecretKey(base58.decode(kp)))
        // Filter out DEV wallet if it's already in bundler wallets
        const bundlerWalletsFiltered = bundlerWallets.filter(kp => !kp.publicKey.equals(buyerKp.publicKey))
        walletsToProcess.push(...bundlerWalletsFiltered)
        console.log(`✅ Added ${bundlerWalletsFiltered.length} wallets from current run (old format - assuming all are bundle wallets)`)
      } else {
        console.log("⚠️  No walletKeys in current-run.json (only DEV wallet will sell)")
      }
      
      // Include holder wallets in rapid-sell (sell ALL wallets when user clicks "SELL ALL")
      if (currentRunData.holderWalletKeys && Array.isArray(currentRunData.holderWalletKeys) && currentRunData.holderWalletKeys.length > 0) {
        const holderWallets = currentRunData.holderWalletKeys.map((kp: string) => Keypair.fromSecretKey(base58.decode(kp)))
        // Filter out DEV wallet if it's already in holder wallets (shouldn't happen, but safety check)
        const holderWalletsFiltered = holderWallets.filter(kp => !kp.publicKey.equals(buyerKp.publicKey))
        walletsToProcess.push(...holderWalletsFiltered)
        console.log(`✅ Added ${holderWalletsFiltered.length} HOLDER wallets (selling ALL wallets)`)
      }
    } catch (error) {
      console.log('❌ Error reading current-run.json:', error)
      // Fallback to BUYER_WALLET if current-run.json read failed
      if (BUYER_WALLET && BUYER_WALLET.trim() !== '') {
        buyerKp = Keypair.fromSecretKey(base58.decode(BUYER_WALLET))
        devWalletSource = 'BUYER_WALLET from .env (fallback)'
        walletsToProcess.push(buyerKp)
        console.log(`✅ Using DEV wallet from BUYER_WALLET (fallback): ${buyerKp.publicKey.toBase58()}`)
      } else {
        console.log('   ❌ No DEV wallet available - cannot sell')
        return
      }
    }
  } else {
    // No current-run.json - use BUYER_WALLET from .env
    if (BUYER_WALLET && BUYER_WALLET.trim() !== '') {
      buyerKp = Keypair.fromSecretKey(base58.decode(BUYER_WALLET))
      devWalletSource = 'BUYER_WALLET from .env'
      walletsToProcess.push(buyerKp)
      console.log(`✅ Using DEV wallet from BUYER_WALLET (.env): ${buyerKp.publicKey.toBase58()}`)
      console.log('⚠️  No current-run.json found (only DEV wallet will sell)')
    } else {
      console.log('❌ No current-run.json found and no BUYER_WALLET set - cannot sell')
      return
    }
  }
  
  if (!targetMint) {
    console.log("❌ No mint address provided or found in current-run.json")
    return
  }
  
  console.log(`🎯 Target mint: ${targetMint}`)
  console.log(`   Source: ${mintAddress ? 'provided as parameter' : 'from current-run.json'}`)
  console.log(`   View on Solscan: https://solscan.io/token/${targetMint}`)
  console.log(`📦 Total wallets: ${walletsToProcess.length}`)
  
  // SKIP DIAGNOSTIC CHECKS - They block and slow down rapid sell!
  // Rapid sell has retry logic that will handle tokens not being available yet
  // These checks just waste time when we need to sell IMMEDIATELY
  console.log(`\n⚡⚡⚡ SKIPPING DIAGNOSTIC CHECKS FOR SPEED ⚡⚡⚡`)
  console.log(`   Rapid sell will retry until tokens are detected`)
  console.log(`   Starting IMMEDIATELY to beat all bots!\n`)
  
  // RPC Rate Limiting: Helius Developer plan = 50 RPS
  // With 6 wallets, we need to manage RPC calls carefully
  // Each wallet needs ~2 RPC calls per retry (getTokenAccounts + getBalance)
  // 6 wallets × 2 calls = 12 calls per cycle
  // 50 RPS / 12 calls = ~4.17 cycles/second = ~240ms minimum per cycle
  // We'll use a simple delay-based rate limiter to stay under 50 RPS
  const MAX_RPC_PER_SECOND = 45 // Leave 5 RPS buffer for safety
  
  // Simplified rate limiter - ensures we never exceed 50 RPS
  // Uses a simple delay-based approach for reliability
  let lastRpcCallTime = 0
  const minRpcInterval = 1000 / MAX_RPC_PER_SECOND // ~22ms between calls
  
  const rateLimitedRpc = async <T>(rpcCall: () => Promise<T>): Promise<T> => {
    const now = Date.now()
    const timeSinceLastCall = now - lastRpcCallTime
    
    // If we called too recently, wait
    if (timeSinceLastCall < minRpcInterval) {
      await sleep(minRpcInterval - timeSinceLastCall)
    }
    
    lastRpcCallTime = Date.now()
    return await rpcCall()
  }
  
  console.log(`⚡ RPC Rate Limiter: ${MAX_RPC_PER_SECOND} RPS (Helius Developer plan: 50 RPS)`)
  
  // INSTANT START - Fire immediately, don't wait for bonding curve
  // Smart retry will handle "tokens not detected yet" errors
  if (initialWaitMs > 0) {
    console.log(`⏳ Optional wait: ${initialWaitMs}ms...`)
    await sleep(initialWaitMs)
  }
  console.log(`⚡⚡⚡ INSTANT FIRE: All wallets starting NOW - will retry until tokens detected! ⚡⚡⚡\n`)
  
  // Create sell tasks for ALL wallets - even if tokens not detected yet
  // Smart fallback: will keep checking until tokens appear
  const sellTasks: Array<{ 
    wallet: Keypair, 
    account: TokenAccount | null, 
    balance: string, 
    walletAddr: string,
    mint: string
  }> = []
  
  // Create a task for each wallet to monitor and sell
  // If token account doesn't exist yet, we'll keep checking in the retry loop
  for (const kp of walletsToProcess) {
    sellTasks.push({
      wallet: kp,
      account: null, // Will be found in retry loop
      balance: "0", // Will be updated when tokens detected
      walletAddr: kp.publicKey.toBase58(),
      mint: targetMint
    })
  }
  
  console.log(`📦 Created ${sellTasks.length} sell tasks - will detect tokens and sell 100% from each\n`)
  console.log(`⚡ PARALLEL MODE: All transactions sent simultaneously via Helius RPC (not Jito)`)
  console.log(`⚡ Higher priority fees (0.001 SOL per wallet) for faster inclusion`)
  console.log(`⏱️  Starting rapid sell process...\n`)
  
  // RACE MODE - INSTANT FIRE with smart retry
  // Fires IMMEDIATELY, retries until tokens detected, then sells 100% at maximum speed
  const MAX_RETRIES = 500 // More retries to handle early detection
  const RETRY_DELAY = 20 // 20ms between retries (ultra-fast - optimized for speed)
  const EARLY_RETRY_DELAY = 20 // Same delay even early (we want maximum speed)
  
  // Shared bonding curve detection - once ONE wallet detects it, all go full speed
  let bondingCurveDetected = false
  const bondingCurveDetectedTime = { value: 0 }
  
  // INSTANT FIRE - ALL wallets start with small stagger to avoid liquidity conflicts
  // Small 50ms stagger prevents all wallets from hitting pool simultaneously
  // This avoids error 6001 (insufficient liquidity/price moved) when multiple sells compete
  // Smart fallback: keeps checking for tokens until detected, then sells 100%
  // Each wallet sends its transaction via Helius RPC in parallel (not Jito bundling)
  // Higher priority fees ensure faster inclusion
  // PRIORITY: DEV wallet (index 0) sends FIRST, then bundler wallets in parallel
  // NO DELAYS - Maximum speed, but DEV wallet transaction is sent first
  const sellPromises = sellTasks.map(async ({ wallet, account, balance, walletAddr, mint }, index) => {
    // NO DELAY - All wallets start checking immediately for maximum speed
    // DEV wallet (index 0) will send its transaction first when ready
    let attempts = 0
    let success = false
    let localBondingCurveReady = false
    let tokensDetected = false
    let currentAccount: TokenAccount | null = account
    let currentBalance = balance // Track balance (might be 0 initially)
    
    // Log that this wallet started
    console.log(`🚀 Wallet ${index + 1}/${sellTasks.length}: ${walletAddr.slice(0, 8)}... started checking for tokens`)
    
    while (attempts < MAX_RETRIES && !success) {
      attempts++
      
      // Log progress more frequently so we can see all wallets are working
      if (attempts === 1 || attempts % 20 === 0) {
        console.log(`🔄 Wallet ${index + 1}/${sellTasks.length} (${walletAddr.slice(0, 8)}...): attempt ${attempts}/${MAX_RETRIES}`)
      }
      
      try {
        // SMART FALLBACK: If no account found yet, keep checking for token accounts
        if (!currentAccount) {
          try {
            const tokenAccounts = await rateLimitedRpc(() => 
              connection.getTokenAccountsByOwner(wallet.publicKey, {
                programId: TOKEN_PROGRAM_ID,
              }, "processed")
            )
            
            // Find account matching our mint
            for (const { pubkey, account: acc } of tokenAccounts.value) {
              const accountInfo = SPL_ACCOUNT_LAYOUT.decode(acc.data)
              if (accountInfo.mint.toBase58() === mint) {
                currentAccount = {
                  pubkey,
                  programId: acc.owner,
                  accountInfo,
                }
                tokensDetected = true
                if (attempts === 1 || attempts % 20 === 0) {
                  console.log(`✅ Token account found for ${walletAddr.slice(0, 8)}... (attempt ${attempts})`)
                }
                break
              }
            }
            
            if (!currentAccount) {
              // Still no token account - retry
              if (attempts % 30 === 0) {
                console.log(`   ⏳ ${walletAddr.slice(0, 8)}... no token account found yet (attempt ${attempts})`)
              }
              await sleep(RETRY_DELAY)
              continue
            }
          } catch (error: any) {
            // Error getting accounts - retry
            if (attempts % 30 === 0) {
              console.log(`   ⚠️  ${walletAddr.slice(0, 8)}... error checking accounts: ${error.message || error} (attempt ${attempts})`)
            }
            await sleep(RETRY_DELAY)
            continue
          }
        }
        
        // Get fresh balance (tokens might have just appeared)
        try {
          const freshBalance = await rateLimitedRpc(() =>
            connection.getTokenAccountBalance(currentAccount!.pubkey, "processed")
          )
          if (freshBalance.value.uiAmount && freshBalance.value.uiAmount > 0) {
            currentBalance = freshBalance.value.amount
            if (!tokensDetected) {
              tokensDetected = true
              console.log(`✅ Tokens detected for ${walletAddr.slice(0, 8)}... (${freshBalance.value.uiAmount} tokens)`)
            }
          } else {
            // No balance yet - retry
            await sleep(RETRY_DELAY)
            continue
          }
        } catch (error) {
          // Account might not exist yet - retry
          await sleep(RETRY_DELAY)
          continue
        }
        
        // Get sell transaction from Jupiter (100% of current balance)
        // Use HIGH priority fee if threshold was met (WebSocket auto-sell), LOW for manual sells, 0 for no priority fee
        const sellTx = await getSellTxWithJupiter(wallet, currentAccount.accountInfo.mint, currentBalance, priorityFeeLamports)
        
        if (!sellTx) {
          // Tokens detected but bonding curve not ready yet OR Jupiter can't route
          // This is EXPECTED early on - smart fallback: keep retrying
          if (attempts % 30 === 0) {
            // Log every 30th attempt so we know it's working (less spam)
            console.log(`⏳ ${walletAddr.slice(0, 8)}... tokens found but bonding curve not ready yet (attempt ${attempts})...`)
          }
          
          // Use shared detection - if another wallet detected it, retry faster
          const delay = bondingCurveDetected ? RETRY_DELAY : EARLY_RETRY_DELAY
          await sleep(delay)
          continue
        }
        
        // SUCCESS! We got a transaction - tokens are detected and bonding curve is live
        if (!tokensDetected) {
          tokensDetected = true
        }
        
        if (!bondingCurveDetected) {
          bondingCurveDetected = true
          bondingCurveDetectedTime.value = Date.now()
          console.log(`🔥🔥🔥 TOKENS DETECTED! BONDING CURVE LIVE! (attempt ${attempts}) - ALL WALLETS GOING FULL SPEED! 🔥🔥🔥`)
        }
        if (!localBondingCurveReady) {
          localBondingCurveReady = true
        }
        
        // PRIORITY: DEV wallet (index 0) sends FIRST - no delays, maximum speed
        // Send transaction IMMEDIATELY via Helius RPC (not Jito)
        // This is the FASTEST possible method - beats all bots
        // DEV wallet is first in array (index 0), so it processes and sends first
        // Higher priority fees (0.0001 SOL) ensure faster inclusion
        // Note: sendTransaction also counts as RPC, but it's critical so we allow it
        const signature = await rateLimitedRpc(() =>
          connection.sendTransaction(sellTx, {
            skipPreflight: true, // Skip preflight for speed
            maxRetries: 0, // No retries - fire and forget
            preflightCommitment: "processed" // Use processed for fastest inclusion
          })
        )
        
        // Verify transaction actually confirmed (wait up to 10 seconds)
        // Optimized: check every 100ms for faster confirmation detection
        let confirmed = false
        for (let verifyAttempt = 0; verifyAttempt < 100; verifyAttempt++) {
          await sleep(100) // Check every 100ms (faster detection)
          try {
            const status = await connection.getSignatureStatus(signature)
            if (status.value) {
              if (status.value.err) {
                console.log(`   ❌ Transaction failed: ${JSON.stringify(status.value.err)}`)
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
          console.log(`✅✅✅ SOLD 100%: ${walletAddr.slice(0, 8)}... → ${signature.slice(0, 8)}... (attempt ${attempts}, ${(Date.now() - startTime)}ms) - CONFIRMED`)
          console.log(`   View: https://solscan.io/tx/${signature}`)
          success = true
        } else {
          console.log(`⚠️  Transaction sent but NOT confirmed: ${walletAddr.slice(0, 8)}... → ${signature.slice(0, 8)}...`)
          console.log(`   View: https://solscan.io/tx/${signature}`)
          console.log(`   ⚠️  Transaction may still be pending or failed - check Solscan`)
          // Don't mark as success - will retry
        }
        
      } catch (error: any) {
        const errorMsg = error.message || String(error)
        
        // Smart error handling - retry on everything except permanent failures
        if (errorMsg.includes('429') || errorMsg.includes('Too Many Requests')) {
          // Rate limited - minimal backoff (speed > safety)
          const backoffDelay = Math.min(RETRY_DELAY * Math.pow(1.3, Math.floor(attempts / 30)), 300)
          await sleep(backoffDelay)
        } else if (errorMsg.includes('fetch failed') || errorMsg.includes('ECONNREFUSED') || errorMsg.includes('ENOTFOUND')) {
          // Network error - retry with longer delay (network might be down)
          if (attempts % 10 === 0) {
            console.log(`⚠️  Network error for ${walletAddr.slice(0, 8)}... (attempt ${attempts}) - retrying...`)
          }
          await sleep(Math.min(RETRY_DELAY * 2, 200)) // Slightly longer delay for network errors
        } else if (errorMsg.includes('No quote available') || errorMsg.includes('No routes found')) {
          // Tokens not detected yet - this is normal, retry fast
          await sleep(RETRY_DELAY)
        } else {
          // All other errors - retry fast (might be temporary)
          const delay = bondingCurveDetected ? RETRY_DELAY : EARLY_RETRY_DELAY
          await sleep(delay)
        }
        
        if (attempts >= MAX_RETRIES) {
          console.log(`❌❌❌ Wallet ${index + 1}/${sellTasks.length} FAILED after ${MAX_RETRIES} attempts: ${walletAddr.slice(0, 8)}...`)
          console.log(`   Error: ${errorMsg.slice(0, 100)}`)
          console.log(`   This wallet did NOT sell - check if it has tokens or if there was an issue`)
        }
      }
    }
    
    return { 
      walletAddr, 
      success, 
      attempts, 
      bondingCurveReady: localBondingCurveReady, 
      tokensDetected: tokensDetected || currentAccount !== null 
    }
  })
  
  // PRIORITY: Send DEV wallet transaction FIRST (if it exists), then bundler wallets in parallel
  // NO DELAYS - Maximum speed, but DEV wallet goes first
  let results;
  if (sellTasks.length > 0 && sellTasks[0]) {
    // DEV wallet is at index 0 - send it first
    const devWalletResult = await sellPromises[0];
    // Then send bundler wallets in parallel (if any)
    if (sellPromises.length > 1) {
      const bundlerResults = await Promise.all(sellPromises.slice(1));
      results = [devWalletResult, ...bundlerResults];
    } else {
      results = [devWalletResult];
    }
  } else {
    // No wallets (shouldn't happen, but safety)
    results = await Promise.all(sellPromises);
  }
  
  const successful = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length
  const elapsed = Date.now() - startTime
  
  const avgAttempts = results.reduce((sum, r) => sum + r.attempts, 0) / results.length
  const bondingCurveDetectedCount = results.filter(r => r.bondingCurveReady).length
  const tokensDetectedCount = results.filter(r => r.tokensDetected).length
  const timeToFirstSale = bondingCurveDetectedTime.value > 0 
    ? bondingCurveDetectedTime.value - startTime 
    : 0
  
  console.log(`\n${'='.repeat(60)}`)
  console.log(`🏁 RACE MODE COMPLETE`)
  console.log(`${'='.repeat(60)}`)
  console.log(`✅ Successful: ${successful}/${results.length} wallets sold 100%`)
  console.log(`❌ Failed: ${failed}/${results.length} wallets`)
  console.log(`📈 Tokens detected: ${tokensDetectedCount}/${results.length} wallets`)
  console.log(`📈 Bonding curve live: ${bondingCurveDetectedCount}/${results.length} wallets`)
  
  // Show detailed results for each wallet
  console.log(`\n📋 Detailed Results:`)
  results.forEach((result, idx) => {
    if (result.success) {
      console.log(`   ✅ Wallet ${idx + 1}: ${result.walletAddr.slice(0, 8)}... - SOLD (${result.attempts} attempts)`)
    } else {
      console.log(`   ❌ Wallet ${idx + 1}: ${result.walletAddr.slice(0, 8)}... - FAILED (${result.attempts} attempts)`)
      console.log(`      Tokens detected: ${result.tokensDetected ? 'YES' : 'NO'}`)
      console.log(`      Bonding curve ready: ${result.bondingCurveReady ? 'YES' : 'NO'}`)
    }
  })
  
  if (timeToFirstSale > 0) {
    console.log(`\n⚡⚡⚡ Time to first sale: ${timeToFirstSale}ms (${(timeToFirstSale / 1000).toFixed(3)}s) ⚡⚡⚡`)
  }
  console.log(`📊 Average attempts: ${avgAttempts.toFixed(1)}`)
  console.log(`⏱️  Total time elapsed: ${elapsed}ms (${(elapsed / 1000).toFixed(2)}s)`)
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
  const mintAddress = process.argv[2] // Optional: pass mint address as argument
  const initialWait = process.argv[3] ? parseInt(process.argv[3]) : 0 // Default: 0ms (INSTANT start)
  const priorityFee = (process.argv[4] as 'high' | 'medium' | 'low' | 'none') || 'medium' // Default: 'medium' (fast and reasonable), use 'high' for very fast, 'low' for cheap, 'none' for no priority fee
  rapidSell(mintAddress, initialWait, priorityFee).catch(console.error)
}

export { rapidSell }

