import base58 from "bs58"
import fs from "fs"
import path from "path"
import { sleep } from "../utils"
import { Connection, Keypair } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID } from "@solana/spl-token"
import { SPL_ACCOUNT_LAYOUT, TokenAccount } from "@raydium-io/raydium-sdk"
import { getSellTxWithJupiter } from "../utils/swapOnlyAmm"
import { BUYER_WALLET, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, PRIORITY_FEE_LAMPORTS_HIGH, STAGED_SELL_STAGE1_THRESHOLD, STAGED_SELL_STAGE2_THRESHOLD, STAGED_SELL_STAGE3_THRESHOLD, STAGED_SELL_STAGE1_PERCENTAGE, STAGED_SELL_STAGE2_PERCENTAGE, STAGED_SELL_STAGE3_PERCENTAGE } from "../constants"

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: "processed"
})

// STAGED SELL - Sells wallets in stages based on volume thresholds
// Stage 1: Sell X% of biggest wallets at Y SOL volume (configurable via .env)
// Stage 2: Sell X% at Y SOL volume (configurable via .env)
// Stage 3: Sell remaining X% + DEV wallet at Y SOL volume (configurable via .env)
// DEV wallet ALWAYS sells LAST (in final stage)
// stage: 'stage1' | 'stage2' | 'stage3' - which stage to execute
const rapidSellStaged = async (mintAddress?: string, stage: 'stage1' | 'stage2' | 'stage3' = 'stage1', priorityFee: 'high' | 'low' = 'high') => {
  // Use percentages from .env (defaults to 30%, 30%, 40% if not set)
  const stage1Percentage = STAGED_SELL_STAGE1_PERCENTAGE || 30
  const stage2Percentage = STAGED_SELL_STAGE2_PERCENTAGE || 30
  const stage3Percentage = STAGED_SELL_STAGE3_PERCENTAGE || 40
  
  // Use thresholds from .env (defaults to 5, 10, 20 if not set)
  const stage1Threshold = STAGED_SELL_STAGE1_THRESHOLD || 5
  const stage2Threshold = STAGED_SELL_STAGE2_THRESHOLD || 10
  const stage3Threshold = STAGED_SELL_STAGE3_THRESHOLD || 20
  
  const stageInfo = {
    stage1: { threshold: stage1Threshold, percentage: stage1Percentage, name: `Stage 1 (${stage1Percentage}% at ${stage1Threshold} SOL)` },
    stage2: { threshold: stage2Threshold, percentage: stage2Percentage, name: `Stage 2 (${stage2Percentage}% at ${stage2Threshold} SOL)` },
    stage3: { threshold: stage3Threshold, percentage: stage3Percentage, name: `Stage 3 (${stage3Percentage}% + DEV at ${stage3Threshold} SOL)` }
  }
  
  const currentStage = stageInfo[stage]
  console.log(`🚀🚀🚀 STAGED SELL - ${currentStage.name} 🚀🚀🚀`)
  console.log(`⚡ Selling ${currentStage.percentage}% of wallets at ${currentStage.threshold} SOL volume threshold`)
  if (stage === 'stage3') {
    console.log(`⚡ DEV wallet will be included in this final stage`)
  }
  
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
  
  if (!targetMint) {
    console.log("❌ No mint address provided or found in current-run.json")
    return
  }
  
  // Get DEV wallet
  const buyerKp = Keypair.fromSecretKey(base58.decode(BUYER_WALLET))
  
  // Separate DEV wallet from bundler wallets
  const filteredBundlerWallets = bundlerWallets.filter(kp => !kp.publicKey.equals(buyerKp.publicKey))
  
  if (filteredBundlerWallets.length === 0) {
    console.log("❌ No bundler wallets found (only dev wallet)")
    if (stage === 'stage3') {
      // If stage 3 and only DEV wallet, sell it
      console.log("⚡ Stage 3: Selling DEV wallet only")
      bundlerWallets = [buyerKp]
    } else {
      return
    }
  }
  
  console.log(`🎯 Target mint: ${targetMint}`)
  console.log(`📦 Total bundler wallets: ${filteredBundlerWallets.length}`)
  
  // Read SWAP_AMOUNTS to determine wallet sizes
  const swapAmountsStr = process.env.SWAP_AMOUNTS || ''
  const swapAmounts = swapAmountsStr 
    ? swapAmountsStr.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n))
    : []
  
  // Create array of bundler wallets with their buy amounts
  const walletsWithAmounts = filteredBundlerWallets.map((kp, index) => ({
    wallet: kp,
    buyAmount: swapAmounts[index] || 0.3, // Default to 0.3 if not specified
    index: index
  }))
  
  // Sort by buy amount DESCENDING (biggest wallets first)
  walletsWithAmounts.sort((a, b) => b.buyAmount - a.buyAmount)
  
  console.log(`💰 Bundler wallets sorted by buy amount (biggest first):`)
  walletsWithAmounts.forEach((w, i) => {
    console.log(`   ${i + 1}. Wallet ${w.index + 1}: ${w.buyAmount} SOL`)
  })
  
  // Calculate which wallets to sell based on stage
  let walletsToSell: Keypair[] = []
  
  if (stage === 'stage1') {
    // Stage 1: First X% of biggest wallets (from .env)
    const count = Math.ceil(walletsWithAmounts.length * (stage1Percentage / 100))
    walletsToSell = walletsWithAmounts.slice(0, count).map(w => w.wallet)
    console.log(`\n📊 Stage 1: Selling first ${count} wallets (${stage1Percentage}% of ${walletsWithAmounts.length} bundler wallets)`)
  } else if (stage === 'stage2') {
    // Stage 2: Next X% of biggest wallets (from .env)
    const total = walletsWithAmounts.length
    const stage1Count = Math.ceil(total * (stage1Percentage / 100))
    const stage2Count = Math.ceil(total * (stage2Percentage / 100))
    walletsToSell = walletsWithAmounts.slice(stage1Count, stage1Count + stage2Count).map(w => w.wallet)
    console.log(`\n📊 Stage 2: Selling next ${stage2Count} wallets (${stage2Percentage}% of ${total} bundler wallets, after stage 1)`)
  } else if (stage === 'stage3') {
    // Stage 3: Remaining X% + DEV wallet (DEV wallet LAST)
    // Remaining = all wallets not sold in stage 1 and stage 2
    const total = walletsWithAmounts.length
    const stage1Count = Math.ceil(total * (stage1Percentage / 100))
    const stage2Count = Math.ceil(total * (stage2Percentage / 100))
    const remainingWallets = walletsWithAmounts.slice(stage1Count + stage2Count).map(w => w.wallet)
    walletsToSell = [...remainingWallets, buyerKp] // DEV wallet added LAST
    const remainingPercentage = 100 - stage1Percentage - stage2Percentage
    console.log(`\n📊 Stage 3: Selling remaining ${remainingWallets.length} wallets (${remainingPercentage}% of ${total} bundler wallets) + DEV wallet`)
    console.log(`⚡ DEV wallet will be sold LAST in this stage`)
  }
  
  console.log(`\n💰 Wallets to SELL in ${currentStage.name}: ${walletsToSell.length}`)
  walletsToSell.forEach((kp, i) => {
    const isDev = kp.publicKey.equals(buyerKp.publicKey)
    const walletInfo = walletsWithAmounts.find(w => w.wallet.publicKey.equals(kp))
    const label = isDev ? 'DEV WALLET' : `Wallet ${walletInfo?.index || '?'}`
    const amount = isDev ? (parseFloat(process.env.BUYER_AMOUNT || '0') || 0) : (walletInfo?.buyAmount || 0)
    console.log(`   ${i + 1}. ${kp.publicKey.toBase58().slice(0, 8)}... (${label}, ${amount} SOL buy)`)
  })
  
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
  
  console.log(`\n⚡ Starting staged sell - ${currentStage.name}...`)
  console.log(`⚡ Priority Fee: ${priorityFee === 'high' ? 'HIGH' : 'LOW'}\n`)
  
  // Create sell tasks
  const sellTasks: Array<{ 
    wallet: Keypair, 
    account: TokenAccount | null, 
    balance: string, 
    walletAddr: string,
    mint: string,
    isDev: boolean
  }> = []
  
  for (const kp of walletsToSell) {
    const isDev = kp.publicKey.equals(buyerKp.publicKey)
    sellTasks.push({
      wallet: kp,
      account: null,
      balance: "0",
      walletAddr: kp.publicKey.toBase58(),
      mint: targetMint,
      isDev: isDev
    })
  }
  
  console.log(`📦 Created ${sellTasks.length} sell tasks\n`)
  
  // Priority fee
  const priorityFeeLamports = priorityFee === 'high' ? PRIORITY_FEE_LAMPORTS_HIGH : 100000
  
  // Sell process - same as rapid-sell.ts but with DEV wallet priority at end
  const MAX_RETRIES = 500
  const RETRY_DELAY = 20
  
  const sellPromises = sellTasks.map(async ({ wallet, account, balance, walletAddr, mint, isDev }, index) => {
    let attempts = 0
    let success = false
    let currentAccount: TokenAccount | null = account
    let currentBalance = balance
    
    const walletLabel = isDev ? 'DEV' : `Wallet ${index + 1}`
    console.log(`🚀 ${walletLabel} (${walletAddr.slice(0, 8)}...): started checking for tokens`)
    
    while (attempts < MAX_RETRIES && !success) {
      attempts++
      
      if (attempts === 1 || attempts % 20 === 0) {
        console.log(`🔄 ${walletLabel} (${walletAddr.slice(0, 8)}...): attempt ${attempts}/${MAX_RETRIES}`)
      }
      
      try {
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
              if (attempts % 30 === 0) {
                console.log(`   ⏳ ${walletLabel} (${walletAddr.slice(0, 8)}...): no token account found yet (attempt ${attempts})`)
              }
              await sleep(RETRY_DELAY)
              continue
            }
          } catch (error: any) {
            if (attempts % 30 === 0) {
              console.log(`   ⚠️  ${walletLabel} (${walletAddr.slice(0, 8)}...): error checking accounts: ${error.message || error} (attempt ${attempts})`)
            }
            await sleep(RETRY_DELAY)
            continue
          }
        }
        
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
        
        const sellTx = await getSellTxWithJupiter(wallet, currentAccount.accountInfo.mint, currentBalance, priorityFeeLamports)
        
        if (!sellTx) {
          if (attempts % 30 === 0) {
            console.log(`⏳ ${walletLabel} (${walletAddr.slice(0, 8)}...): tokens found but bonding curve not ready yet (attempt ${attempts})...`)
          }
          await sleep(RETRY_DELAY)
          continue
        }
        
        // DEV wallet sends LAST in stage 3 (it's at the end of the array)
        // For other stages, send immediately
        if (isDev && stage === 'stage3') {
          // Small delay for DEV wallet in stage 3 to ensure it's truly last
          await sleep(50)
        }
        
        const signature = await rateLimitedRpc(() =>
          connection.sendTransaction(sellTx, {
            skipPreflight: true,
            maxRetries: 0,
            preflightCommitment: "processed"
          })
        )
        
        console.log(`✅ ${walletLabel} (${walletAddr.slice(0, 8)}...): SELL TRANSACTION SENT!`)
        console.log(`   Signature: https://solscan.io/tx/${signature}`)
        
        success = true
      } catch (error: any) {
        if (attempts % 30 === 0) {
          console.log(`   ⚠️  ${walletLabel} (${walletAddr.slice(0, 8)}...): ${error.message || error} (attempt ${attempts})`)
        }
        await sleep(RETRY_DELAY)
      }
    }
    
    if (!success) {
      console.log(`❌ ${walletLabel} (${walletAddr.slice(0, 8)}...): FAILED after ${attempts} attempts`)
    }
  })
  
  await Promise.all(sellPromises)
  
  const endTime = Date.now()
  const duration = ((endTime - startTime) / 1000).toFixed(2)
  console.log(`\n✅✅✅ ${currentStage.name} COMPLETED in ${duration}s! ✅✅✅`)
}

// Main execution
const mintAddress = process.argv[2] || undefined
const stage = (process.argv[3] as 'stage1' | 'stage2' | 'stage3') || 'stage1'
const priorityFee = (process.argv[4] as 'high' | 'low') || 'high'

rapidSellStaged(mintAddress, stage, priorityFee).catch(console.error)

