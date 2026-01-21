import base58 from "bs58"
import fs from "fs"
import path from "path"
import { sleep } from "../utils"
import { ComputeBudgetProgram, Connection, Keypair, SystemProgram, sendAndConfirmTransaction, Transaction } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID, createCloseAccountInstruction } from "@solana/spl-token"
import { BUYER_WALLET, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, PRIVATE_KEY } from "../constants"

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: "confirmed"
})

const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))

// GATHER SOL ONLY - No token checking, just recover SOL from failed run wallets
// This avoids RPC rate limiting from checking token accounts
const gatherSolOnly = async () => {
  console.log("💰💰💰 GATHERING SOL ONLY (No Token Checks) 💰💰💰")
  console.log("⚡ This will ONLY gather SOL from current-run.json wallets")
  console.log("⚡ No token account checks = No RPC rate limiting!\n")
  
  // Read current run info
  const currentRunPath = path.join(process.cwd(), 'keys', 'current-run.json')
  let walletsToProcess: Keypair[] = []
  
  if (!fs.existsSync(currentRunPath)) {
    console.log('❌ No current-run.json found. Cannot gather from failed run.')
    console.log('   Run a token launch first, or use npm run gather-all for all wallets')
    return
  }
  
  try {
    const currentRunData = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'))
    
    if (currentRunData.walletKeys && Array.isArray(currentRunData.walletKeys) && currentRunData.walletKeys.length > 0) {
      const launchStatus = currentRunData.launchStatus || 'UNKNOWN'
      console.log(`✅ Found ${currentRunData.walletKeys.length} wallet keys from ${launchStatus} launch`)
      console.log(`   Mint: ${currentRunData.mintAddress || 'N/A (launch failed)'}`)
      console.log(`   Timestamp: ${new Date(currentRunData.timestamp).toLocaleString()}\n`)
      
      walletsToProcess = currentRunData.walletKeys.map((kp: string) => Keypair.fromSecretKey(base58.decode(kp)))
    } else {
      console.log('❌ No walletKeys in current-run.json')
      return
    }
  } catch (error) {
    console.log('❌ Error reading current-run.json:', error)
    return
  }
  
  // Add DEV wallet
  const buyerKp = Keypair.fromSecretKey(base58.decode(BUYER_WALLET))
  const devWalletAlreadyIncluded = walletsToProcess.some(kp => kp.publicKey.equals(buyerKp.publicKey))
  
  if (!devWalletAlreadyIncluded) {
    walletsToProcess.push(buyerKp)
    console.log(`Added DEV buy wallet: ${buyerKp.publicKey.toBase58()}`)
  }
  
  console.log(`\n📊 GATHERING FROM ${walletsToProcess.length} WALLETS (SOL ONLY - NO TOKEN CHECKS)\n`)
  
  // Process wallets with rate limiting protection
  const MIN_RENT_EXEMPT = 890_880 // ~0.00089 SOL
  const ADDITIONAL_BUFFER = 20_000
  const MIN_FEE_RESERVE = MIN_RENT_EXEMPT + ADDITIONAL_BUFFER // ~0.00091 SOL
  
  let successCount = 0
  let failCount = 0
  
  // Process in batches to avoid RPC rate limits
  const BATCH_SIZE = 5
  const DELAY_BETWEEN_BATCHES = 2000 // 2 seconds between batches
  
  for (let i = 0; i < walletsToProcess.length; i += BATCH_SIZE) {
    const batch = walletsToProcess.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(walletsToProcess.length / BATCH_SIZE)
    
    console.log(`\n📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} wallets)...`)
    
    const batchPromises = batch.map(async (kp, idx) => {
      const globalIdx = i + idx
      const isDevWallet = kp.publicKey.equals(buyerKp.publicKey)
      const walletLabel = isDevWallet ? "DEV Wallet" : `Wallet ${globalIdx + 1}`
      
      try {
        // Small delay to avoid hitting RPC too fast
        await sleep(idx * 100) // 100ms stagger within batch
        
        // Get balance (only RPC call we need)
        const solBal = await connection.getBalance(kp.publicKey, "confirmed")
        const solAmount = solBal > MIN_FEE_RESERVE ? solBal - MIN_FEE_RESERVE : 0
        
        if (solAmount <= 0) {
          console.log(`   [${globalIdx + 1}/${walletsToProcess.length}] ⚠️  ${walletLabel}: Balance too low (${(solBal / 1e9).toFixed(6)} SOL), skipping`)
          return { success: true, wallet: kp.publicKey.toBase58(), amount: 0 }
        }
        
        console.log(`   [${globalIdx + 1}/${walletsToProcess.length}] 💸 ${walletLabel}: Transferring ${(solAmount / 1e9).toFixed(6)} SOL`)
        
        // Transfer SOL
        const solTx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
          // No priority fee instruction - uses network default (cheapest)
          SystemProgram.transfer({
            fromPubkey: kp.publicKey,
            toPubkey: mainKp.publicKey,
            lamports: solAmount
          })
        )
        solTx.feePayer = mainKp.publicKey
        solTx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash
        
        const sig = await sendAndConfirmTransaction(connection, solTx, [mainKp, kp], { 
          commitment: "confirmed",
          skipPreflight: false
        })
        
        console.log(`   [${globalIdx + 1}/${walletsToProcess.length}] ✅ ${walletLabel}: Transferred ${(solAmount / 1e9).toFixed(6)} SOL`)
        console.log(`      https://solscan.io/tx/${sig}`)
        
        // Close any empty token accounts to recover rent
        try {
          const tokenAccounts = await connection.getTokenAccountsByOwner(kp.publicKey, {
            programId: TOKEN_PROGRAM_ID,
          }, "confirmed")
          
          if (tokenAccounts.value.length > 0) {
            let closedCount = 0
            let totalRentRecovered = 0
            
            for (const { pubkey } of tokenAccounts.value) {
              try {
                const balance = await connection.getTokenAccountBalance(pubkey)
                
                // Only close if account is empty (balance is 0)
                if (balance.value.amount === '0' || balance.value.uiAmount === 0) {
                  const closeIx = createCloseAccountInstruction(
                    pubkey,
                    mainKp.publicKey, // Rent recipient
                    kp.publicKey // Owner
                  )
                  
                  const closeTx = new Transaction().add(
                    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
                    closeIx
                  )
                  closeTx.feePayer = mainKp.publicKey
                  closeTx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash
                  
                  const closeSig = await sendAndConfirmTransaction(connection, closeTx, [mainKp, kp], {
                    commitment: "confirmed",
                    skipPreflight: false
                  })
                  
                  // Estimate rent recovered (~0.002 SOL per token account)
                  const estimatedRent = 2_039_280
                  totalRentRecovered += estimatedRent
                  closedCount++
                  
                  console.log(`   [${globalIdx + 1}/${walletsToProcess.length}] 🧹 ${walletLabel}: Closed empty token account, recovered ~${(estimatedRent / 1e9).toFixed(6)} SOL rent`)
                }
              } catch (closeError: any) {
                const errorMsg = closeError.message || String(closeError)
                if (!errorMsg.includes('AccountNotFound') && !errorMsg.includes('no record')) {
                  // Silently skip - account might already be closed or have balance
                }
              }
            }
            
            if (closedCount > 0) {
              console.log(`   [${globalIdx + 1}/${walletsToProcess.length}] ✅ ${walletLabel}: Closed ${closedCount} empty token account(s), recovered ~${(totalRentRecovered / 1e9).toFixed(6)} SOL rent`)
            }
          }
        } catch (closeAccountsError: any) {
          // Non-critical - just continue
        }
        
        return { success: true, wallet: kp.publicKey.toBase58(), amount: solAmount }
      } catch (error: any) {
        const errorMsg = error.message || String(error)
        if (errorMsg.includes('429') || errorMsg.includes('Too Many Requests')) {
          console.log(`   [${globalIdx + 1}/${walletsToProcess.length}] ⚠️  ${walletLabel}: Rate limited, will retry later`)
        } else {
          console.log(`   [${globalIdx + 1}/${walletsToProcess.length}] ❌ ${walletLabel}: ${errorMsg.slice(0, 100)}`)
        }
        return { success: false, wallet: kp.publicKey.toBase58(), error: errorMsg }
      }
    })
    
    await Promise.all(batchPromises)
    
    // Count successes/failures
    const results = await Promise.all(batchPromises)
    results.forEach(r => {
      if (r.success) successCount++
      else failCount++
    })
    
    // Delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < walletsToProcess.length) {
      console.log(`   ⏳ Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch...`)
      await sleep(DELAY_BETWEEN_BATCHES)
    }
  }
  
  console.log(`\n${'='.repeat(80)}`)
  console.log(`📊 FINAL SUMMARY`)
  console.log(`${'='.repeat(80)}`)
  console.log(`✅ Successfully gathered: ${successCount}/${walletsToProcess.length} wallets`)
  console.log(`❌ Failed: ${failCount}/${walletsToProcess.length} wallets`)
  console.log(`${'='.repeat(80)}\n`)
}

if (require.main === module) {
  gatherSolOnly().catch(console.error)
}

export { gatherSolOnly }

