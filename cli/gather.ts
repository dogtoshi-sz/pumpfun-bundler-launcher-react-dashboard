import base58 from "bs58"
import fs from "fs"
import path from "path"
import dotenv from "dotenv"
import { readJson, sleep } from "../utils"
import { ComputeBudgetProgram, Connection, Keypair, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createTransferCheckedInstruction, getAssociatedTokenAddress } from "@solana/spl-token";
import { SPL_ACCOUNT_LAYOUT, TokenAccount } from "@raydium-io/raydium-sdk";
import { getSellTxWithJupiter } from "../utils/swapOnlyAmm";
import { execute } from "../executor/legacy";
import { BUYER_WALLET, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, PRIVATE_KEY } from "../constants";
import { completeRunTracking, getLatestRecord } from "../lib/profit-loss-tracker";

// Ensure .env is loaded
dotenv.config();

export const solanaConnection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT, commitment: "processed"
})

// Use PRIVATE_KEY from constants (already loaded via dotenv)
const connection = new Connection(RPC_ENDPOINT, { commitment: "processed" });

// Validate PRIVATE_KEY before proceeding
if (!PRIVATE_KEY) {
  console.error("❌ PRIVATE_KEY is not set in .env file");
  console.error("   Please add your master wallet private key to .env");
  process.exit(1);
}
const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))

const main = async () => {
  const walletsData = readJson()
  
  // Check for --new-only flag (skip warmed wallets, only gather from auto-created wallets)
  const newOnlyMode = process.argv.includes('--new-only') || process.argv.includes('--skip-warmed')
  
  if (newOnlyMode) {
    console.log(`\n🔥 NEW-ONLY MODE: Will SKIP warmed wallets, only gather from auto-created wallets`)
    console.log(`   This preserves your warmed wallets for future launches!\n`)
  }
  
  // Read current run info to know which wallets to gather from
  const currentRunPath = path.join(process.cwd(), 'keys', 'current-run.json')
  let walletsToProcess: Keypair[] = []
  
  // Load warmed wallet addresses to skip (if in new-only mode)
  let warmedWalletAddresses: Set<string> = new Set()
  if (newOnlyMode) {
    const warmedWalletsPath = path.join(process.cwd(), 'keys', 'warmed-wallets-for-launch.json')
    if (fs.existsSync(warmedWalletsPath)) {
      try {
        const warmedData = JSON.parse(fs.readFileSync(warmedWalletsPath, 'utf8'))
        
        // Collect all warmed wallet addresses
        if (warmedData.creatorWalletAddress) {
          warmedWalletAddresses.add(warmedData.creatorWalletAddress.toLowerCase())
        }
        if (warmedData.bundleWalletAddresses && Array.isArray(warmedData.bundleWalletAddresses)) {
          warmedData.bundleWalletAddresses.forEach((addr: string) => warmedWalletAddresses.add(addr.toLowerCase()))
        }
        if (warmedData.holderWalletAddresses && Array.isArray(warmedData.holderWalletAddresses)) {
          warmedData.holderWalletAddresses.forEach((addr: string) => warmedWalletAddresses.add(addr.toLowerCase()))
        }
        
        console.log(`   📋 Found ${warmedWalletAddresses.size} warmed wallets to SKIP:`)
        warmedWalletAddresses.forEach(addr => console.log(`      - ${addr.slice(0, 8)}...${addr.slice(-4)}`))
      } catch (error) {
        console.log(`   ⚠️  Could not read warmed-wallets-for-launch.json: ${error}`)
      }
    } else {
      console.log(`   ⚠️  No warmed-wallets-for-launch.json found - will gather from ALL wallets`)
    }
  }
  
  if (fs.existsSync(currentRunPath)) {
    try {
      const currentRunData = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'))
      
      // NEW: Prioritize bundle wallets if available, fallback to walletKeys
      const launchStatus = currentRunData.launchStatus || (currentRunData.mintAddress ? 'SUCCESS' : 'UNKNOWN')
      console.log(`✅ Found wallet data in current-run.json`)
      console.log(`   Mint: ${currentRunData.mintAddress || 'N/A (launch failed)'}`)
      console.log(`   Launch Status: ${launchStatus}`)
      console.log(`   Timestamp: ${new Date(currentRunData.timestamp).toLocaleString()}`)
      
      if (launchStatus === 'FAILED') {
        console.log(`   ⚠️  This was a FAILED launch - no tokens to sell, just recovering SOL`)
      }
      
      // PRIORITY: Use bundleWalletKeys + holderWalletKeys + creatorDevWalletKey if available (new format)
      if (currentRunData.bundleWalletKeys && Array.isArray(currentRunData.bundleWalletKeys) && currentRunData.bundleWalletKeys.length > 0) {
        const bundleWallets = currentRunData.bundleWalletKeys.map((kp: string) => Keypair.fromSecretKey(base58.decode(kp)))
        walletsToProcess.push(...bundleWallets)
        console.log(`   ✅ Added ${bundleWallets.length} BUNDLE wallets (priority - these have the most SOL/tokens)`)
      }
      
      if (currentRunData.holderWalletKeys && Array.isArray(currentRunData.holderWalletKeys) && currentRunData.holderWalletKeys.length > 0) {
        const holderWallets = currentRunData.holderWalletKeys.map((kp: string) => Keypair.fromSecretKey(base58.decode(kp)))
        walletsToProcess.push(...holderWallets)
        console.log(`   ✅ Added ${holderWallets.length} HOLDER wallets`)
      }
      
      // Add CREATOR/DEV wallet (auto-created or from BUYER_WALLET env)
      if (currentRunData.creatorDevWalletKey) {
        const creatorDevWallet = Keypair.fromSecretKey(base58.decode(currentRunData.creatorDevWalletKey))
        walletsToProcess.push(creatorDevWallet)
        console.log(`   ✅ Added CREATOR/DEV wallet from current-run.json (creates tokens, buys, collects fees)`)
      }
      
      // FALLBACK: Use walletKeys if bundleWalletKeys/holderWalletKeys not available (old format)
      if (walletsToProcess.length === 0 && currentRunData.walletKeys && Array.isArray(currentRunData.walletKeys) && currentRunData.walletKeys.length > 0) {
        walletsToProcess = currentRunData.walletKeys.map((kp: string) => Keypair.fromSecretKey(base58.decode(kp)))
        console.log(`   ⚠️  Using walletKeys (old format - includes all wallets)`)
      }
      
      if (walletsToProcess.length > 0) {
        console.log(`   📦 Total wallets to process: ${walletsToProcess.length}`)
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
  
  // Add DEV buy wallet (FALLBACK: only if not already included from current-run.json)
  // PRIORITY: creatorDevWalletKey from current-run.json (already added above if exists)
  // FALLBACK: BUYER_WALLET from .env (for cases where current-run.json doesn't have creatorDevWalletKey)
  let buyerKp: Keypair | null = null;
  let devWalletAlreadyIncluded = false;
  
  if (BUYER_WALLET && BUYER_WALLET.trim() !== '') {
    try {
      buyerKp = Keypair.fromSecretKey(base58.decode(BUYER_WALLET));
      // Check if DEV wallet is already in the list (by public key)
      devWalletAlreadyIncluded = walletsToProcess.some(kp => kp.publicKey.equals(buyerKp!.publicKey));
      
      if (!devWalletAlreadyIncluded) {
        walletsToProcess.push(buyerKp);
        console.log(`   ✅ Added DEV buy wallet from BUYER_WALLET env var: ${buyerKp.publicKey.toBase58()}`);
      } else {
        console.log(`   ℹ️  DEV wallet already included from current-run.json: ${buyerKp.publicKey.toBase58()}`);
      }
    } catch (error: any) {
      console.log(`   ⚠️  Error adding BUYER_WALLET: ${error.message}`);
    }
  } else {
    // Check if we already have a DEV wallet from current-run.json
    const hasDevWallet = walletsToProcess.length > 0 && 
      (currentRunPath && fs.existsSync(currentRunPath) ? 
        (() => {
          try {
            const currentRunData = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
            return !!currentRunData.creatorDevWalletKey;
          } catch {
            return false;
          }
        })() : false);
    
    if (!hasDevWallet) {
      console.log(`   ⚠️  No DEV wallet found (neither in current-run.json nor BUYER_WALLET env var)`);
    }
  }

  // Filter out warmed wallets if in new-only mode
  if (newOnlyMode && warmedWalletAddresses.size > 0) {
    const originalCount = walletsToProcess.length
    walletsToProcess = walletsToProcess.filter(kp => {
      const addr = kp.publicKey.toBase58().toLowerCase()
      const isWarmed = warmedWalletAddresses.has(addr)
      if (isWarmed) {
        console.log(`   🔥 SKIPPING warmed wallet: ${addr.slice(0, 8)}...${addr.slice(-4)}`)
      }
      return !isWarmed
    })
    const filteredCount = originalCount - walletsToProcess.length
    if (filteredCount > 0) {
      console.log(`\n   ✅ Filtered out ${filteredCount} warmed wallet(s) - they will keep their SOL/tokens!`)
    } else {
      console.log(`\n   ℹ️  No warmed wallets were in the gather list`)
    }
  }

  const bundlerWalletCount = walletsToProcess.length - (devWalletAlreadyIncluded ? 0 : 1)
  console.log(`\n📊 GATHERING SUMMARY:`)
  if (newOnlyMode) {
    console.log(`   🔥 MODE: NEW WALLETS ONLY (warmed wallets preserved)`)
  }
  if (shouldSkipKeptWallets) {
    console.log(`   - Bundler wallets to gather from: ${bundlerWalletCount} (kept wallets excluded)`)
  } else {
    console.log(`   - Auto-created wallets to gather from: ${bundlerWalletCount}`)
  }
  console.log(`   - DEV buy wallet: ${buyerKp ? '1' : '0 (uses auto-created)'}`)
  console.log(`   - Total wallets to process: ${walletsToProcess.length}`)
  
  // Check funding wallet balance (PRIVATE_KEY - this is where all SOL/tokens will be gathered to)
  const fundingWalletBalance = await connection.getBalance(mainKp.publicKey)
  console.log(`   - Funding wallet (PRIVATE_KEY) balance: ${(fundingWalletBalance / 1e9).toFixed(6)} SOL`)
  console.log(`   - All SOL and tokens will be gathered TO this funding wallet`)
  if (fundingWalletBalance < 0.01 * 1e9) {
    console.log(`   ⚠️  WARNING: Funding wallet has low balance! May not be able to pay all transaction fees.`)
  }
  
  console.log(`\n🚀 Processing ${walletsToProcess.length} wallets in PARALLEL (max 5 concurrent)...`)
  console.log(`💰 All funds will be gathered TO: ${mainKp.publicKey.toBase58()} (Funding Wallet - PRIVATE_KEY)`)

  // Process a single wallet
  const processWallet = async (kp: Keypair, index: number, total: number) => {
    const isDevWallet = buyerKp ? kp.publicKey.equals(buyerKp.publicKey) : false
    
    // Determine wallet type for better labeling
    let walletType = "Unknown"
    let walletIndex = index
    if (isDevWallet) {
      walletType = "DEV"
      walletIndex = -1
    } else {
      // Check if this is a bundle wallet or holder wallet
      const currentRunPath = path.join(process.cwd(), 'keys', 'current-run.json')
      if (fs.existsSync(currentRunPath)) {
        try {
          const currentRunData = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'))
          const kpKey = base58.encode(kp.secretKey)
          
          if (currentRunData.bundleWalletKeys && currentRunData.bundleWalletKeys.includes(kpKey)) {
            walletType = "Bundle"
            walletIndex = currentRunData.bundleWalletKeys.indexOf(kpKey) + 1
          } else if (currentRunData.holderWalletKeys && currentRunData.holderWalletKeys.includes(kpKey)) {
            walletType = "Holder"
            walletIndex = currentRunData.holderWalletKeys.indexOf(kpKey) + 1
          } else {
            walletType = "Bundler" // Old format fallback
          }
        } catch (e) {
          walletType = "Bundler" // Fallback
        }
      } else {
        walletType = "Bundler" // Fallback
      }
    }
    
    const walletLabel = isDevWallet ? "DEV Buy Wallet" : `${walletType} Wallet ${walletIndex}`
    
    try {
      console.log(`\n[${index + 1}/${total}] 🚀 Starting ${walletLabel}: ${kp.publicKey.toBase58()}`)

      const accountInfo = await connection.getAccountInfo(kp.publicKey)
      // Removed delays - processing in parallel now
      
      // Check if account actually exists on-chain
      if (!accountInfo) {
        console.log(`[${index + 1}/${total}]   ⚠️  Wallet account does not exist on-chain (never funded/initialized), skipping`)
        return // Skip this wallet entirely
      }
      
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

      // TRANSFER tokens directly to master wallet (don't sell them)
      // Process each token account - TRANSFER tokens to master wallet
      for (let j = 0; j < accounts.length; j++) {
        const account = accounts[j]
        const tokenBalance = (await connection.getTokenAccountBalance(account.pubkey)).value
        
        if (tokenBalance.uiAmount && tokenBalance.uiAmount > 0) {
          try {
            console.log(`[${index + 1}/${total}]   💰 Transferring token: ${account.accountInfo.mint.toBase58()} (${tokenBalance.uiAmount} tokens) to funding wallet`)
            
            // NEVER close token accounts for DEV wallet (keep them for future use)
            const shouldCloseAccount = !isDevWallet
            
            const baseAta = await getAssociatedTokenAddress(account.accountInfo.mint, mainKp.publicKey)
            const tokenAccount = account.pubkey
            
            const tokenIxs: TransactionInstruction[] = []
            // Create ATA for funding wallet (PRIVATE_KEY) if it doesn't exist
            tokenIxs.push(createAssociatedTokenAccountIdempotentInstruction(mainKp.publicKey, baseAta, mainKp.publicKey, account.accountInfo.mint))
            
            // Transfer tokens to funding wallet (PRIVATE_KEY)
            tokenIxs.push(createTransferCheckedInstruction(
              tokenAccount, 
              account.accountInfo.mint, 
              baseAta, 
              kp.publicKey, 
              BigInt(tokenBalance.amount), 
              tokenBalance.decimals
            ))
            
            // Close the token account (unless it's DEV wallet)
            if (shouldCloseAccount) {
              tokenIxs.push(createCloseAccountInstruction(tokenAccount, mainKp.publicKey, kp.publicKey))
            } else {
              console.log(`[${index + 1}/${total}]   ⚠️  Keeping token account open for DEV wallet`)
            }

            const tx = new Transaction().add(
              ComputeBudgetProgram.setComputeUnitLimit({ units: 350_000 }),
              // No priority fee instruction - uses network default (cheapest)
              ...tokenIxs,
            )
            tx.feePayer = mainKp.publicKey
            tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
            
            const sig = await sendAndConfirmTransaction(connection, tx, [mainKp, kp], { 
              commitment: "confirmed",
              skipPreflight: false
            })
            console.log(`[${index + 1}/${total}]   ✅✅✅ Transferred ${tokenBalance.uiAmount} tokens to funding wallet: https://solscan.io/tx/${sig}`)
          } catch (error: any) {
            const errorMsg = error.message || String(error)
            if (errorMsg.includes('429') || errorMsg.includes('Too Many Requests')) {
              console.log(`[${index + 1}/${total}]   ⚠️ Rate limited, waiting 2 seconds...`)
              await sleep(2000)
            } else {
              console.log(`[${index + 1}/${total}]   ⚠️ Error transferring tokens: ${errorMsg}`)
            }
          }
        }
      }

      // Transfer SOL - Account existence already verified above
      const solBal = await connection.getBalance(kp.publicKey, "confirmed")
      console.log(`[${index + 1}/${total}]   💰 Current SOL balance: ${(solBal / 1e9).toFixed(6)} SOL`)
      
      let transferAmount = 0
      // Solana accounts need minimum rent-exempt balance (~0.00089 SOL for basic account)
      // Even though mainKp pays transaction fees, the source account must maintain rent exemption
      const MIN_RENT_EXEMPT = 890_880 // ~0.00089 SOL - minimum rent exempt balance for a basic account
      const ADDITIONAL_BUFFER = 10_000 // Small additional buffer for safety
      const MIN_FEE_RESERVE = MIN_RENT_EXEMPT + ADDITIONAL_BUFFER // ~0.0009 SOL total
      
      // For ALL wallets (including DEV), only leave rent-exempt balance (can't withdraw to zero)
      // Gather maximum SOL - only leave what's required for rent exemption
      transferAmount = solBal > MIN_FEE_RESERVE ? solBal - MIN_FEE_RESERVE : 0
      if (transferAmount <= 0) {
        console.log(`[${index + 1}/${total}]   ⚠️  Balance too low (${(solBal / 1e9).toFixed(6)} SOL <= ${(MIN_FEE_RESERVE / 1e9).toFixed(6)} SOL rent-exempt minimum), skipping transfer`)
      } else {
        const walletType = isDevWallet ? 'DEV wallet' : 'Bundler wallet'
        console.log(`[${index + 1}/${total}]   💸 ${walletType}: Will transfer ${(transferAmount / 1e9).toFixed(6)} SOL, leaving ${(MIN_FEE_RESERVE / 1e9).toFixed(6)} SOL for rent exemption`)
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
              ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
              // No priority fee instruction - uses network default (cheapest)
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
              
              // For ALL wallets (including DEV), only leave rent-exempt balance
              transferAmount = newBal > RETRY_FEE_RESERVE ? newBal - RETRY_FEE_RESERVE : 0
              
              if (transferAmount <= 0) {
                console.log(`[${index + 1}/${total}]   ❌ Not enough balance after recalculation (need ${(RETRY_FEE_RESERVE / 1e9).toFixed(6)} SOL for rent exemption), skipping`)
                break
              }
              
              console.log(`[${index + 1}/${total}]   🔄 Retrying with ${(transferAmount / 1e9).toFixed(6)} SOL (leaving ${(RETRY_FEE_RESERVE / 1e9).toFixed(6)} SOL for rent exemption)`)
              await sleep(1000)
            } else if (errorMsg.includes('no record of a prior credit') || errorMsg.includes('AccountNotFound')) {
              console.log(`[${index + 1}/${total}]   ❌ Account does not exist on-chain (never funded/initialized). Skipping this wallet.`)
              break // Stop retrying - account doesn't exist
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
      
      // Close any remaining empty token accounts to recover rent
      // This recovers ~0.002 SOL per empty token account
      try {
        const remainingTokenAccounts = await connection.getTokenAccountsByOwner(kp.publicKey, {
          programId: TOKEN_PROGRAM_ID,
        }, "confirmed")
        
        if (remainingTokenAccounts.value.length > 0) {
          let closedCount = 0
          let totalRentRecovered = 0
          
          for (const { pubkey, account } of remainingTokenAccounts.value) {
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
                closeTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
                
                const sig = await sendAndConfirmTransaction(connection, closeTx, [mainKp, kp], {
                  commitment: "confirmed",
                  skipPreflight: false
                })
                
                // Estimate rent recovered (~0.002 SOL per token account)
                const estimatedRent = 2_039_280 // Typical rent for token account
                totalRentRecovered += estimatedRent
                closedCount++
                
                console.log(`[${index + 1}/${total}]   🧹 Closed empty token account, recovered ~${(estimatedRent / 1e9).toFixed(6)} SOL rent: https://solscan.io/tx/${sig}`)
              }
            } catch (closeError: any) {
              const errorMsg = closeError.message || String(closeError)
              if (!errorMsg.includes('AccountNotFound') && !errorMsg.includes('no record')) {
                console.log(`[${index + 1}/${total}]   ⚠️  Could not close token account ${pubkey.toBase58()}: ${errorMsg}`)
              }
            }
          }
          
          if (closedCount > 0) {
            console.log(`[${index + 1}/${total}]   ✅ Closed ${closedCount} empty token account(s), recovered ~${(totalRentRecovered / 1e9).toFixed(6)} SOL rent`)
          }
        }
      } catch (closeAccountsError: any) {
        // Non-critical - just log and continue
        console.log(`[${index + 1}/${total}]   ⚠️  Could not check/close remaining token accounts: ${closeAccountsError.message || closeAccountsError}`)
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
  
  // Complete profit/loss tracking if there's an in-progress run
  try {
    const latestRecord = getLatestRecord();
    if (latestRecord && latestRecord.status === 'in_progress') {
      const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY));
      await completeRunTracking(connection, mainKp.publicKey, latestRecord.id, 'completed', 'Gather completed manually');
    }
  } catch (error: any) {
    console.warn(`[ProfitLoss] Failed to complete tracking after gather: ${error.message}`);
  }
}

// Export main function so it can be called programmatically
export { main as gather }

// Run if called directly
if (require.main === module) {
  main()
}
