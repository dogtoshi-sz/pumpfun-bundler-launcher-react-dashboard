import base58 from "bs58"
import fs from "fs"
import path from "path"
import { readJson, retrieveEnvVariable, sleep } from "./utils"
import { ComputeBudgetProgram, Connection, Keypair, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createTransferCheckedInstruction, getAssociatedTokenAddress } from "@solana/spl-token";
import { SPL_ACCOUNT_LAYOUT, TokenAccount } from "@raydium-io/raydium-sdk";
import { getSellTxWithJupiter } from "./utils/swapOnlyAmm";
import { execute } from "./executor/legacy";
import { BUYER_WALLET, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT } from "./constants";

export const solanaConnection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT, commitment: "processed"
})

const rpcUrl = retrieveEnvVariable("RPC_ENDPOINT");
const mainKpStr = retrieveEnvVariable('PRIVATE_KEY');
const connection = new Connection(rpcUrl, { commitment: "processed" });
const mainKp = Keypair.fromSecretKey(base58.decode(mainKpStr))

const main = async () => {
  const walletsData = readJson()
  
  // Read current run info to know which wallets to gather from
  const currentRunPath = path.join(process.cwd(), 'keys', 'current-run.json')
  let walletsToProcess: Keypair[] = []
  
  if (fs.existsSync(currentRunPath)) {
    try {
      const currentRunData = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'))
      
      // NEW: Use actual wallet keys from current-run.json if available (more accurate)
      if (currentRunData.walletKeys && Array.isArray(currentRunData.walletKeys) && currentRunData.walletKeys.length > 0) {
        const launchStatus = currentRunData.launchStatus || (currentRunData.mintAddress ? 'SUCCESS' : 'UNKNOWN')
        console.log(`✅ Found ${currentRunData.walletKeys.length} wallet keys in current-run.json`)
        console.log(`   Mint: ${currentRunData.mintAddress || 'N/A (launch failed)'}`)
        console.log(`   Launch Status: ${launchStatus}`)
        console.log(`   Timestamp: ${new Date(currentRunData.timestamp).toLocaleString()}`)
        
        if (launchStatus === 'FAILED') {
          console.log(`   ⚠️  This was a FAILED launch - no tokens to sell, just recovering SOL`)
        }
        
        // Use the exact wallets from this run
        walletsToProcess = currentRunData.walletKeys.map((kp: string) => Keypair.fromSecretKey(base58.decode(kp)))
        console.log(`   Using EXACT wallets from current run (no unnecessary RPC calls for old wallets)`)
      } else {
        // FALLBACK: Old format - use count and slice from data.json
        console.log(`⚠️  Old format current-run.json detected (no walletKeys). Using count-based approach.`)
        const walletCount = currentRunData.count || walletsData.length
        console.log(`Current run used ${walletCount} wallets`)
        console.log(`Total wallets in data.json: ${walletsData.length}`)
        
        // Only use the LAST N wallets (from the current run)
        const startIndex = Math.max(0, walletsData.length - walletCount)
        const currentRunWallets = walletsData.slice(startIndex)
        
        console.log(`Gathering from wallets ${startIndex + 1} to ${walletsData.length} (${currentRunWallets.length} wallets)`)
        
        walletsToProcess = currentRunWallets.map((kp: string) => Keypair.fromSecretKey(base58.decode(kp)))
      }
    } catch (error) {
      console.log('❌ Error reading current-run.json, using all wallets:', error)
      walletsToProcess = walletsData.map((kp: string) => Keypair.fromSecretKey(base58.decode(kp)))
    }
  } else {
    console.log('⚠️ No current-run.json found. Using ALL wallets from data.json')
    console.log('This will gather from all historical wallets. Consider running a token launch first.')
    walletsToProcess = walletsData.map((kp: string) => Keypair.fromSecretKey(base58.decode(kp)))
  }
  
  // Check if there's a 50% sell in progress (sold-wallets.json exists)
  // If so, we should ONLY gather from sold wallets, NOT kept wallets
  const soldWalletsPath = path.join(process.cwd(), 'keys', 'sold-wallets.json')
  let keptWalletKeys: string[] = []
  let shouldSkipKeptWallets = false
  
  if (fs.existsSync(soldWalletsPath)) {
    try {
      const soldWalletsData = JSON.parse(fs.readFileSync(soldWalletsPath, 'utf8'))
      if (soldWalletsData.keptWalletKeys && Array.isArray(soldWalletsData.keptWalletKeys)) {
        keptWalletKeys = soldWalletsData.keptWalletKeys
        shouldSkipKeptWallets = true
        console.log(`\n⚠️  Found sold-wallets.json from 50% sell`)
        console.log(`   Will SKIP ${keptWalletKeys.length} kept wallets (they should remain untouched)`)
        console.log(`   Will only gather from sold wallets + DEV wallet`)
      }
    } catch (error) {
      console.log(`⚠️  Error reading sold-wallets.json: ${error}`)
    }
  }
  
  // Filter out kept wallets if we're in a 50% sell scenario
  if (shouldSkipKeptWallets && keptWalletKeys.length > 0) {
    const keptWalletSet = new Set(keptWalletKeys)
    const originalCount = walletsToProcess.length
    walletsToProcess = walletsToProcess.filter(kp => {
      const kpKey = base58.encode(kp.secretKey)
      return !keptWalletSet.has(kpKey)
    })
    const filteredCount = originalCount - walletsToProcess.length
    if (filteredCount > 0) {
      console.log(`   ✅ Filtered out ${filteredCount} kept wallet(s) from gather process`)
    }
  }
  
  // Add DEV buy wallet (this is separate from bundler wallets)
  const buyerKp = Keypair.fromSecretKey(base58.decode(BUYER_WALLET))
  
  // Check if DEV wallet is already in the list (shouldn't be, but be safe)
  const devWalletAlreadyIncluded = walletsToProcess.some(kp => kp.publicKey.equals(buyerKp.publicKey))
  
  // In a 50% sell scenario, DEV wallet should be gathered (it will be sold in remaining wallets sell)
  // But we can gather SOL from it now if it has any
  if (!devWalletAlreadyIncluded) {
    walletsToProcess.push(buyerKp)
    console.log(`Added DEV buy wallet: ${buyerKp.publicKey.toBase58()}`)
  } else {
    console.log(`DEV buy wallet already in list: ${buyerKp.publicKey.toBase58()}`)
  }

  const bundlerWalletCount = walletsToProcess.length - (devWalletAlreadyIncluded ? 0 : 1)
  console.log(`\n📊 GATHERING SUMMARY:`)
  if (shouldSkipKeptWallets) {
    console.log(`   - Bundler wallets to gather from: ${bundlerWalletCount} (kept wallets excluded)`)
  } else {
    console.log(`   - Bundler wallets from current run: ${bundlerWalletCount}`)
  }
  console.log(`   - DEV buy wallet: 1`)
  console.log(`   - Total wallets to process: ${walletsToProcess.length}`)
  
  // Check main wallet balance to ensure it can pay fees
  const mainWalletBalance = await connection.getBalance(mainKp.publicKey)
  console.log(`   - Main wallet balance: ${(mainWalletBalance / 1e9).toFixed(6)} SOL`)
  if (mainWalletBalance < 0.01 * 1e9) {
    console.log(`   ⚠️  WARNING: Main wallet has low balance! May not be able to pay all transaction fees.`)
  }
  
  console.log(`\n🚀 Processing ${walletsToProcess.length} wallets in PARALLEL (max 5 concurrent)...`)

  // Process a single wallet
  const processWallet = async (kp: Keypair, index: number, total: number) => {
    const isDevWallet = kp.publicKey.equals(buyerKp.publicKey)
    const bundlerIndex = isDevWallet ? -1 : index
    const walletLabel = isDevWallet ? "DEV Buy Wallet" : `Bundler Wallet ${bundlerIndex}`
    
    try {
      console.log(`\n[${index + 1}/${total}] 🚀 Starting ${walletLabel}: ${kp.publicKey.toBase58()}`)

      const accountInfo = await connection.getAccountInfo(kp.publicKey)
      // Removed delays - processing in parallel now
      
      const tokenAccounts = await connection.getTokenAccountsByOwner(kp.publicKey, {
        programId: TOKEN_PROGRAM_ID,
      }, "confirmed")
      // Removed delays - processing in parallel now
      
      const accounts: TokenAccount[] = [];

      if (tokenAccounts.value.length > 0) {
        for (const { pubkey, account } of tokenAccounts.value) {
          accounts.push({
            pubkey,
            programId: account.owner,
            accountInfo: SPL_ACCOUNT_LAYOUT.decode(account.data),
          });
        }
        console.log(`[${index + 1}/${total}]   Found ${accounts.length} token account(s)`)
      } else {
        console.log(`[${index + 1}/${total}]   No token accounts found`)
      }

      // Process each token account - SELL FIRST (parallel selling)
      const sellPromises = accounts.map(async (account, j) => {
        const tokenBalance = (await connection.getTokenAccountBalance(account.pubkey)).value

        if (tokenBalance.uiAmount && tokenBalance.uiAmount > 0) {
          let sellAttempts = 0
          const maxSellAttempts = 20 // Increased from 3 to 20 for network resilience
          
          while (sellAttempts < maxSellAttempts) {
            try {
              console.log(`[${index + 1}/${total}]   💰 Selling token: ${account.accountInfo.mint.toBase58()} (${tokenBalance.uiAmount} tokens)`)
              const sellTx = await getSellTxWithJupiter(kp, account.accountInfo.mint, tokenBalance.amount)
              
              if (sellTx == null) {
                throw new Error("Error getting sell tx from Jupiter")
              }
              
              const latestBlockhashForSell = await solanaConnection.getLatestBlockhash()
              const txSellSig = await execute(sellTx, latestBlockhashForSell, false)
              const tokenSellTx = txSellSig ? `https://solscan.io/tx/${txSellSig}` : ''
              console.log(`[${index + 1}/${total}]   ✅✅✅ Sold token: ${tokenSellTx}`)
              return { success: true, account }
            } catch (error: any) {
              sellAttempts++
              const errorMsg = error.message || String(error)
              
              if (errorMsg.includes('429') || errorMsg.includes('Too Many Requests')) {
                const backoffDelay = Math.min(1000 * Math.pow(1.5, Math.floor(sellAttempts / 5)), 5000)
                console.log(`[${index + 1}/${total}]   ⚠️ Rate limited, waiting ${backoffDelay}ms... (attempt ${sellAttempts}/${maxSellAttempts})`)
                await sleep(backoffDelay)
              } else if (errorMsg.includes('fetch failed') || errorMsg.includes('ECONNREFUSED') || errorMsg.includes('ENOTFOUND')) {
                // Network error - retry with exponential backoff
                const backoffDelay = Math.min(1000 * Math.pow(1.3, Math.floor(sellAttempts / 3)), 3000)
                if (sellAttempts % 3 === 0) {
                  console.log(`[${index + 1}/${total}]   ⚠️ Network error connecting to Jupiter API (attempt ${sellAttempts}/${maxSellAttempts}) - retrying in ${backoffDelay}ms...`)
                }
                await sleep(backoffDelay)
              } else {
                // Other errors - shorter delay
                if (sellAttempts % 5 === 0) {
                  console.log(`[${index + 1}/${total}]   ⚠️ Sell attempt ${sellAttempts}/${maxSellAttempts} failed: ${errorMsg.slice(0, 100)}`)
                }
                await sleep(500)
              }
              
              if (sellAttempts >= maxSellAttempts) {
                console.log(`[${index + 1}/${total}]   ❌ Failed to sell token after ${maxSellAttempts} attempts`)
                console.log(`[${index + 1}/${total}]   ⚠️  This might be a network connectivity issue or Jupiter API is down`)
                return { success: false, account }
              }
            }
          }
        }
        return { success: false, account }
      })

      // Wait for all sells to complete (parallel)
      await Promise.all(sellPromises)
      // Removed delay - processing in parallel now

      // Now transfer tokens and close accounts (sequential to avoid conflicts)
      for (let j = 0; j < accounts.length; j++) {
        // NEVER close token accounts for DEV wallet
        if (isDevWallet) {
          console.log(`[${index + 1}/${total}]   ⚠️  Skipping token account closure for DEV wallet`)
          continue
        }
        
        const baseAta = await getAssociatedTokenAddress(accounts[j].accountInfo.mint, mainKp.publicKey)
        const tokenAccount = accounts[j].pubkey
        const tokenBalanceAfterSell = (await connection.getTokenAccountBalance(accounts[j].pubkey)).value
        
        const tokenIxs: TransactionInstruction[] = []
        tokenIxs.push(createAssociatedTokenAccountIdempotentInstruction(mainKp.publicKey, baseAta, mainKp.publicKey, accounts[j].accountInfo.mint))
        
        if (tokenBalanceAfterSell.uiAmount && tokenBalanceAfterSell.uiAmount > 0) {
          tokenIxs.push(createTransferCheckedInstruction(
            tokenAccount, 
            accounts[j].accountInfo.mint, 
            baseAta, 
            kp.publicKey, 
            BigInt(tokenBalanceAfterSell.amount), 
            tokenBalanceAfterSell.decimals
          ))
        }
        tokenIxs.push(createCloseAccountInstruction(tokenAccount, mainKp.publicKey, kp.publicKey))

        if (tokenIxs.length > 1) {
          try {
            const tx = new Transaction().add(
              ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 220_000 }),
              ComputeBudgetProgram.setComputeUnitLimit({ units: 350_000 }),
              ...tokenIxs,
            )
            tx.feePayer = mainKp.publicKey
            tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
            
            const sig = await sendAndConfirmTransaction(connection, tx, [mainKp, kp], { 
              commitment: "confirmed",
              skipPreflight: false
            })
            console.log(`[${index + 1}/${total}]   ✅ Transferred tokens and closed account: https://solscan.io/tx/${sig}`)
          } catch (error: any) {
            if (error.message?.includes('429') || error.message?.includes('Too Many Requests')) {
              console.log(`[${index + 1}/${total}]   ⚠️ Rate limited, waiting 2 seconds...`)
              await sleep(2000)
            } else {
              console.log(`[${index + 1}/${total}]   ⚠️ Error transferring tokens: ${error.message}`)
            }
          }
        }
      }

      // Transfer SOL - ALWAYS check balance, even if accountInfo is null
      const solBal = await connection.getBalance(kp.publicKey)
      console.log(`[${index + 1}/${total}]   💰 Current SOL balance: ${(solBal / 1e9).toFixed(6)} SOL`)
      
      let transferAmount = 0
      // Solana accounts need minimum rent-exempt balance (~0.00089 SOL for basic account)
      // Even though mainKp pays transaction fees, the source account must maintain rent exemption
      const MIN_RENT_EXEMPT = 890_880 // ~0.00089 SOL - minimum rent exempt balance for a basic account
      const ADDITIONAL_BUFFER = 10_000 // Small additional buffer for safety
      const MIN_FEE_RESERVE = MIN_RENT_EXEMPT + ADDITIONAL_BUFFER // ~0.0009 SOL total
      
      if (isDevWallet) {
        const MIN_DEV_BALANCE = 100_000_000 // 0.1 SOL
        transferAmount = solBal > MIN_DEV_BALANCE + MIN_FEE_RESERVE ? solBal - MIN_DEV_BALANCE - MIN_FEE_RESERVE : 0
        if (transferAmount > 0) {
          console.log(`[${index + 1}/${total}]   ⚠️  DEV wallet: Leaving ${(MIN_DEV_BALANCE / 1e9).toFixed(4)} SOL minimum + ${(MIN_FEE_RESERVE / 1e9).toFixed(6)} SOL for rent`)
        } else {
          console.log(`[${index + 1}/${total}]   ⚠️  DEV wallet: Balance too low (${(solBal / 1e9).toFixed(6)} SOL < ${((MIN_DEV_BALANCE + MIN_FEE_RESERVE) / 1e9).toFixed(6)} SOL), skipping transfer`)
        }
      } else {
        // For bundler wallets, leave rent-exempt balance (can't drain to zero)
        transferAmount = solBal > MIN_FEE_RESERVE ? solBal - MIN_FEE_RESERVE : 0
        if (transferAmount <= 0) {
          console.log(`[${index + 1}/${total}]   ⚠️  Balance too low (${(solBal / 1e9).toFixed(6)} SOL <= ${(MIN_FEE_RESERVE / 1e9).toFixed(6)} SOL rent-exempt minimum), skipping transfer`)
        } else {
          console.log(`[${index + 1}/${total}]   💸 Will transfer ${(transferAmount / 1e9).toFixed(6)} SOL, leaving ${(MIN_FEE_RESERVE / 1e9).toFixed(6)} SOL for rent exemption`)
        }
      }
      
      if (transferAmount > 0) {
        let transferAttempts = 0
        const maxTransferAttempts = 5
        let transferSuccess = false
        
        while (transferAttempts < maxTransferAttempts && !transferSuccess) {
          try {
            transferAttempts++
            console.log(`[${index + 1}/${total}]   💸 Attempting SOL transfer (${transferAttempts}/${maxTransferAttempts}): ${(transferAmount / 1e9).toFixed(6)} SOL`)
            
            const solTx = new Transaction().add(
              ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 220_000 }),
              ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
              SystemProgram.transfer({
                fromPubkey: kp.publicKey,
                toPubkey: mainKp.publicKey,
                lamports: transferAmount
              })
            )
            solTx.feePayer = mainKp.publicKey
            // Removed delays - processing in parallel now
            solTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
            
            const sig = await sendAndConfirmTransaction(connection, solTx, [mainKp, kp], { 
              commitment: "confirmed",
              skipPreflight: false
            })
            console.log(`[${index + 1}/${total}]   ✅ ✅ ✅ SUCCESS! Transferred ${(transferAmount / 1e9).toFixed(6)} SOL: https://solscan.io/tx/${sig}`)
            transferSuccess = true
          } catch (error: any) {
            const errorMsg = error.message || String(error)
            if (errorMsg.includes('429') || errorMsg.includes('Too Many Requests')) {
              // Exponential backoff for rate limits
              const backoffDelay = Math.min(3000 * Math.pow(2, transferAttempts - 1), 10000) // Max 10 seconds
              console.log(`[${index + 1}/${total}]   ⚠️ Rate limited, waiting ${backoffDelay / 1000} seconds... (attempt ${transferAttempts}/${maxTransferAttempts})`)
              await sleep(backoffDelay)
            } else if (errorMsg.includes('insufficient funds') || errorMsg.includes('insufficient funds for rent') || errorMsg.includes('0x1')) {
              // Balance might have changed, or we need more buffer - re-check with more conservative reserve
              await sleep(500) // Delay before re-checking balance
              const newBal = await connection.getBalance(kp.publicKey)
              await sleep(300) // Delay after balance check
              console.log(`[${index + 1}/${total}]   ⚠️ Insufficient funds error. Current balance: ${(newBal / 1e9).toFixed(6)} SOL. Recalculating with larger buffer...`)
              
              // Use rent-exempt minimum for retry
              const RETRY_RENT_EXEMPT = 890_880 // Minimum rent exempt balance
              const RETRY_BUFFER = 20_000 // Additional buffer
              const RETRY_FEE_RESERVE = RETRY_RENT_EXEMPT + RETRY_BUFFER // ~0.00091 SOL
              
              if (isDevWallet) {
                const MIN_DEV_BALANCE = 100_000_000
                transferAmount = newBal > MIN_DEV_BALANCE + RETRY_FEE_RESERVE ? newBal - MIN_DEV_BALANCE - RETRY_FEE_RESERVE : 0
              } else {
                transferAmount = newBal > RETRY_FEE_RESERVE ? newBal - RETRY_FEE_RESERVE : 0
              }
              
              if (transferAmount <= 0) {
                console.log(`[${index + 1}/${total}]   ❌ Not enough balance after recalculation (need ${(RETRY_FEE_RESERVE / 1e9).toFixed(6)} SOL for rent exemption), skipping`)
                break
              }
              
              console.log(`[${index + 1}/${total}]   🔄 Retrying with ${(transferAmount / 1e9).toFixed(6)} SOL (leaving ${(RETRY_FEE_RESERVE / 1e9).toFixed(6)} SOL for rent exemption)`)
              await sleep(1000)
            } else {
              console.log(`[${index + 1}/${total}]   ⚠️ Transfer attempt ${transferAttempts}/${maxTransferAttempts} failed: ${errorMsg}`)
              await sleep(2000)
            }
            
            if (transferAttempts >= maxTransferAttempts) {
              console.log(`[${index + 1}/${total}]   ❌ ❌ ❌ FAILED to transfer SOL after ${maxTransferAttempts} attempts!`)
            }
          }
        }
        
        if (!transferSuccess) {
          throw new Error(`Failed to transfer SOL after ${maxTransferAttempts} attempts`)
        }
      }
      
      console.log(`[${index + 1}/${total}]   ✅ ✅ ✅ Completed ${walletLabel} successfully!`)
      
    } catch (error: any) {
      const errorMsg = error.message || String(error)
      console.log(`[${index + 1}/${total}]   ❌ ❌ ❌ ERROR processing ${walletLabel}: ${errorMsg}`)
      if (error.stack) {
        console.log(`[${index + 1}/${total}]   Stack: ${error.stack}`)
      }
      throw error // Re-throw so it's caught by the batch processor
    }
  }

  // Process ALL wallets in parallel for maximum speed
  const results: Array<{ wallet: string, success: boolean, error?: string }> = []
  
  console.log(`⚡ Processing ALL ${walletsToProcess.length} wallets in PARALLEL for maximum speed`)
  
  // Process all wallets simultaneously
  const allPromises = walletsToProcess.map(async (kp, index) => {
    const walletAddr = kp.publicKey.toBase58()
    try {
      await processWallet(kp, index, walletsToProcess.length)
      results.push({ wallet: walletAddr, success: true })
      return { wallet: walletAddr, success: true }
    } catch (error: any) {
      const errorMsg = error.message || String(error)
      results.push({ wallet: walletAddr, success: false, error: errorMsg })
      return { wallet: walletAddr, success: false, error: errorMsg }
    }
  })
  
  await Promise.all(allPromises)
  
  // Print summary
  console.log(`\n${'='.repeat(80)}`)
  console.log(`📊 FINAL SUMMARY`)
  console.log(`${'='.repeat(80)}`)
  const successful = results.filter(r => r.success)
  const failed = results.filter(r => !r.success)
  console.log(`✅ Successfully processed: ${successful.length}/${results.length} wallets`)
  console.log(`❌ Failed: ${failed.length}/${results.length} wallets`)
  
  if (failed.length > 0) {
    console.log(`\n❌ FAILED WALLETS:`)
    failed.forEach((r, idx) => {
      console.log(`   ${idx + 1}. ${r.wallet}`)
      if (r.error) {
        console.log(`      Error: ${r.error}`)
      }
    })
  }
  
  if (successful.length > 0) {
    console.log(`\n✅ SUCCESSFUL WALLETS:`)
    successful.forEach((r, idx) => {
      console.log(`   ${idx + 1}. ${r.wallet}`)
    })
  }
  
  console.log(`${'='.repeat(80)}\n`)
}

// Export main function so it can be called programmatically
export { main as gather }

// Run if called directly
if (require.main === module) {
  main()
}
