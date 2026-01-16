import base58 from "bs58"
import fs from "fs"
import path from "path"
import { readJson, retrieveEnvVariable, sleep } from "../utils"
import { Connection, Keypair, VersionedTransaction, PublicKey } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID } from "@solana/spl-token"
import { SPL_ACCOUNT_LAYOUT, TokenAccount } from "@raydium-io/raydium-sdk"
import { getSellTxWithJupiter } from "../utils/swapOnlyAmm"
import { BUYER_WALLET, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, AUTO_COLLECT_FEES, PRIVATE_KEY, PRIORITY_FEE_LAMPORTS_MEDIUM } from "../constants"
import { collectCreatorFees } from "./collect-fees"

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: "processed"
})

// SELL REMAINING WALLETS - Sells from the wallets that were kept + dev wallet
// Uses same parallel sell approach as rapid-sell.ts (no Jito bundling)
const rapidSellRemaining = async (mintAddress?: string, initialWaitMs: number = 0) => {
  console.log("🚀🚀🚀 SELL REMAINING WALLETS - Selling from kept wallets + dev wallet 🚀🚀🚀")
  console.log("⚡ This will sell from the wallets that were NOT sold in the 50% sell, plus the dev wallet")
  const startTime = Date.now()
  
  // Read sold wallets info to get which wallets to sell now
  const soldWalletsPath = path.join(process.cwd(), 'keys', 'sold-wallets.json')
  let walletsToSell: Keypair[] = []
  let targetMint: string | null = null
  
  if (fs.existsSync(soldWalletsPath)) {
    try {
      const soldWalletsData = JSON.parse(fs.readFileSync(soldWalletsPath, 'utf8'))
      targetMint = mintAddress || soldWalletsData.mintAddress || null
      
      // Get the wallets that were kept (not sold in 50% sell)
      if (soldWalletsData.keptWalletKeys && Array.isArray(soldWalletsData.keptWalletKeys)) {
        const keptWallets = soldWalletsData.keptWalletKeys.map((kp: string) => Keypair.fromSecretKey(base58.decode(kp)))
        walletsToSell.push(...keptWallets)
        console.log(`✅ Found ${keptWallets.length} kept wallets from 50% sell`)
      }
      
      // Add dev wallet
      if (soldWalletsData.devWalletKey) {
        const devWallet = Keypair.fromSecretKey(base58.decode(soldWalletsData.devWalletKey))
        walletsToSell.push(devWallet)
        console.log(`✅ Found dev wallet`)
      }
      
      if (walletsToSell.length === 0) {
        console.log("❌ No wallets found in sold-wallets.json")
        return
      }
    } catch (error) {
      console.log('❌ Error reading sold-wallets.json:', error)
      console.log('💡 If you haven\'t run the 50% sell yet, use rapid-sell-50-percent first')
      return
    }
  } else {
    console.log('❌ No sold-wallets.json found')
    console.log('💡 You need to run rapid-sell-50-percent first to create the wallet state')
    return
  }
  
  if (!targetMint) {
    console.log("❌ No mint address provided or found in sold-wallets.json")
    return
  }
  
  console.log(`🎯 Target mint: ${targetMint}`)
  console.log(`📦 Total wallets to sell: ${walletsToSell.length}`)
  
  // Optional initial wait
  if (initialWaitMs > 0) {
    console.log(`⏳ Waiting ${initialWaitMs}ms before starting...`)
    await sleep(initialWaitMs)
  }
  
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
  
  console.log(`⚡ RPC Rate Limiter: ${MAX_RPC_PER_SECOND} RPS`)
  console.log(`⚡ PARALLEL MODE: All transactions sent simultaneously via Helius RPC (not Jito)`)
  console.log(`⏱️  Starting sell process...\n`)
  
  // Create sell tasks for wallets to sell
  const sellTasks = walletsToSell.map(kp => ({
    wallet: kp,
    account: null as TokenAccount | null,
    balance: "0",
    walletAddr: kp.publicKey.toBase58(),
    mint: targetMint!
  }))
  
  const MAX_RETRIES = 500
  const RETRY_DELAY = 20
  
  // Parallel sell execution
  const sellPromises = sellTasks.map(async ({ wallet, account, balance, walletAddr, mint }, index) => {
    await sleep(index * 50) // Small stagger to avoid simultaneous pool hits
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
  console.log(`🏁 REMAINING WALLETS SELL COMPLETE`)
  console.log(`${'='.repeat(60)}`)
  console.log(`✅ Sold from: ${successful} wallets (remaining + dev wallet)`)
  console.log(`❌ Failed: ${failed} wallets`)
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
  rapidSellRemaining(mintAddress, initialWait).catch(console.error)
}

export { rapidSellRemaining }
