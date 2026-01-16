import base58 from "bs58"
import fs from "fs"
import path from "path"
import dotenv from "dotenv"
import { readJson, retrieveEnvVariable, getDataDirectory } from "../utils"
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createTransferCheckedInstruction, getAssociatedTokenAddress } from "@solana/spl-token";
import { completeRunTracking, getLatestRecord } from "../lib/profit-loss-tracker";

// CRITICAL: Reload .env file to ensure we get the latest PRIVATE_KEY
// This prevents using stale values from process.env
const rootEnvPath = path.join(process.cwd(), '.env')
dotenv.config({ path: rootEnvPath, override: true })

// Get PRIVATE_KEY directly from process.env (after reload) instead of from constants
// This ensures we use the current value from .env file
const PRIVATE_KEY = process.env.PRIVATE_KEY || ''
if (!PRIVATE_KEY) {
  console.error('❌ PRIVATE_KEY not found in .env file')
  process.exit(1)
}

const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com'
const RPC_WEBSOCKET_ENDPOINT = process.env.RPC_WEBSOCKET_ENDPOINT || ''

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: "confirmed"
})

const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))

async function gatherAllWallets() {
  console.log("💰💰💰 GATHERING FROM ALL WALLETS 💰💰💰\n")
  console.log(`📍 Destination wallet (PRIVATE_KEY): ${mainKp.publicKey.toBase58()}\n`)
  
  const walletsToProcess: Keypair[] = []
  
  // First, add wallets from data.json (bundle wallets)
  const dataPath = path.join(getDataDirectory(), 'data.json')
  if (fs.existsSync(dataPath)) {
    const walletsData = JSON.parse(fs.readFileSync(dataPath, 'utf8'))
    console.log(`📦 Found ${walletsData.length} wallets in data.json`)
    
    for (const privateKey of walletsData) {
      try {
        const kp = Keypair.fromSecretKey(base58.decode(privateKey))
        const balance = await connection.getBalance(kp.publicKey)
        if (balance > 100000) { // More than 0.0001 SOL (just rent)
          walletsToProcess.push(kp)
        }
      } catch (e) {
        // Skip invalid keys
      }
    }
    console.log(`   ✅ Added ${walletsToProcess.length} wallets from data.json with SOL\n`)
  } else {
    console.log(`   ⚠️  data.json not found (no bundle wallets)\n`)
  }
  
  // Also check current-run.json for creator/dev wallet and holder wallets
  const currentRunPath = path.join(process.cwd(), 'keys', 'current-run.json')
  if (fs.existsSync(currentRunPath)) {
    try {
      const currentRunData = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'))
      
      // Add creator/dev wallet (auto-created or from BUYER_WALLET)
      if (currentRunData.creatorDevWalletKey) {
        try {
          const creatorDevWallet = Keypair.fromSecretKey(base58.decode(currentRunData.creatorDevWalletKey))
          const balance = await connection.getBalance(creatorDevWallet.publicKey)
          if (balance > 100000) {
            // Check if already added (shouldn't be, but safety check)
            const alreadyAdded = walletsToProcess.some(kp => kp.publicKey.equals(creatorDevWallet.publicKey))
            if (!alreadyAdded) {
              walletsToProcess.push(creatorDevWallet)
              console.log(`   ✅ Added CREATOR/DEV wallet from current-run.json: ${creatorDevWallet.publicKey.toBase58()}`)
            }
          }
        } catch (e: any) {
          console.log(`   ⚠️  Error adding creator/dev wallet: ${e.message}`)
        }
      }
      
      // Add bundle wallets from current-run.json (includes warmed wallets)
      // PRIORITY: bundleWalletKeys (new format), FALLBACK: walletKeys (old format)
      if (currentRunData.bundleWalletKeys && Array.isArray(currentRunData.bundleWalletKeys)) {
        let bundleCount = 0
        for (const privateKey of currentRunData.bundleWalletKeys) {
          try {
            const kp = Keypair.fromSecretKey(base58.decode(privateKey))
            const balance = await connection.getBalance(kp.publicKey)
            if (balance > 100000) {
              const alreadyAdded = walletsToProcess.some(existing => existing.publicKey.equals(kp.publicKey))
              if (!alreadyAdded) {
                walletsToProcess.push(kp)
                bundleCount++
              }
            }
          } catch (e) {
            // Skip invalid keys
          }
        }
        if (bundleCount > 0) {
          console.log(`   ✅ Added ${bundleCount} bundle wallets from current-run.json (includes warmed wallets)`)
        }
      } else if (currentRunData.walletKeys && Array.isArray(currentRunData.walletKeys)) {
        // Fallback: Use walletKeys (old format - assume all are bundle wallets)
        let bundleCount = 0
        for (const privateKey of currentRunData.walletKeys) {
          try {
            const kp = Keypair.fromSecretKey(base58.decode(privateKey))
            const balance = await connection.getBalance(kp.publicKey)
            if (balance > 100000) {
              const alreadyAdded = walletsToProcess.some(existing => existing.publicKey.equals(kp.publicKey))
              if (!alreadyAdded) {
                walletsToProcess.push(kp)
                bundleCount++
              }
            }
          } catch (e) {
            // Skip invalid keys
          }
        }
        if (bundleCount > 0) {
          console.log(`   ✅ Added ${bundleCount} bundle wallets from current-run.json (old format)`)
        }
      }
      
      // Add holder wallets if they exist
      if (currentRunData.holderWalletKeys && Array.isArray(currentRunData.holderWalletKeys)) {
        let holderCount = 0
        for (const privateKey of currentRunData.holderWalletKeys) {
          try {
            const kp = Keypair.fromSecretKey(base58.decode(privateKey))
            const balance = await connection.getBalance(kp.publicKey)
            if (balance > 100000) {
              const alreadyAdded = walletsToProcess.some(existing => existing.publicKey.equals(kp.publicKey))
              if (!alreadyAdded) {
                walletsToProcess.push(kp)
                holderCount++
              }
            }
          } catch (e) {
            // Skip invalid keys
          }
        }
        if (holderCount > 0) {
          console.log(`   ✅ Added ${holderCount} holder wallets from current-run.json`)
        }
      }
    } catch (e: any) {
      console.log(`   ⚠️  Error reading current-run.json: ${e.message}`)
    }
  }
  
  // Add ALL warmed wallets from warmed-wallets.json
  const warmedWalletsPath = path.join(process.cwd(), 'keys', 'warmed-wallets.json')
  if (fs.existsSync(warmedWalletsPath)) {
    try {
      const warmedData = JSON.parse(fs.readFileSync(warmedWalletsPath, 'utf8'))
      const warmedWallets = warmedData.wallets || []
      console.log(`\n🔥 Found ${warmedWallets.length} warmed wallets in warmed-wallets.json`)
      
      let warmedCount = 0
      for (const wallet of warmedWallets) {
        try {
          const kp = Keypair.fromSecretKey(base58.decode(wallet.privateKey))
          const alreadyAdded = walletsToProcess.some(existing => existing.publicKey.equals(kp.publicKey))
          if (!alreadyAdded) {
            const balance = await connection.getBalance(kp.publicKey)
            if (balance > 100000) { // More than 0.0001 SOL (just rent)
              walletsToProcess.push(kp)
              warmedCount++
            }
          }
        } catch (e) {
          // Skip invalid keys
        }
      }
      if (warmedCount > 0) {
        console.log(`   ✅ Added ${warmedCount} warmed wallets with SOL`)
      } else {
        console.log(`   ℹ️  No warmed wallets have SOL to gather`)
      }
    } catch (e: any) {
      console.log(`   ⚠️  Error reading warmed-wallets.json: ${e.message}`)
    }
  } else {
    console.log(`\n   ℹ️  No warmed-wallets.json found`)
  }
  
  // Fallback: If BUYER_WALLET is set in .env and not already included
  if (process.env.BUYER_WALLET && process.env.BUYER_WALLET.trim() !== '') {
    try {
      const buyerKp = Keypair.fromSecretKey(base58.decode(process.env.BUYER_WALLET))
      const alreadyAdded = walletsToProcess.some(kp => kp.publicKey.equals(buyerKp.publicKey))
      if (!alreadyAdded) {
        const balance = await connection.getBalance(buyerKp.publicKey)
        if (balance > 100000) {
          walletsToProcess.push(buyerKp)
          console.log(`   ✅ Added BUYER_WALLET from .env: ${buyerKp.publicKey.toBase58()}`)
        }
      }
    } catch (e: any) {
      console.log(`   ⚠️  Error adding BUYER_WALLET: ${e.message}`)
    }
  }
  
  console.log(`\n💰 Found ${walletsToProcess.length} total wallets with SOL to gather\n`)
  
  if (walletsToProcess.length === 0) {
    console.log("✅ No wallets with SOL found")
    return
  }
  
  // Process all wallets in parallel
  const results = await Promise.all(
    walletsToProcess.map(async (kp, index) => {
      try {
        const walletAddr = kp.publicKey.toBase58()
        console.log(`[${index + 1}/${walletsToProcess.length}] Processing: ${walletAddr}`)
        
        // Get token accounts
        const tokenAccounts = await connection.getTokenAccountsByOwner(kp.publicKey, {
          programId: TOKEN_PROGRAM_ID,
        })
        
        // Transfer any tokens to funding wallet (PRIVATE_KEY)
        for (const { pubkey, account } of tokenAccounts.value) {
          try {
            const accountInfo = account.data
            // Decode token account to get mint
            const mint = new PublicKey(accountInfo.slice(0, 32))
            const amount = accountInfo.readBigUInt64LE(64)
            
            if (amount > 0n) {
              // Get token balance with decimals
              const tokenBalance = await connection.getTokenAccountBalance(pubkey)
              
              // Transfer tokens to funding wallet (PRIVATE_KEY)
              const mainTokenAccount = await getAssociatedTokenAddress(mint, mainKp.publicKey)
              const latestBlockhash = await connection.getLatestBlockhash()
              
              const transferIx = createTransferCheckedInstruction(
                pubkey,
                mint,
                mainTokenAccount,
                kp.publicKey,
                BigInt(tokenBalance.value.amount),
                tokenBalance.value.decimals
              )
              
              const closeIx = createCloseAccountInstruction(
                pubkey,
                mainKp.publicKey,
                kp.publicKey
              )
              
              // Create ATA for funding wallet (PRIVATE_KEY) if needed
              const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
                mainKp.publicKey,
                mainTokenAccount,
                mainKp.publicKey,
                mint
              )
              
              const msg = new TransactionMessage({
                payerKey: kp.publicKey,
                recentBlockhash: latestBlockhash.blockhash,
                instructions: [createAtaIx, transferIx, closeIx]
              }).compileToV0Message()
              
              const tx = new VersionedTransaction(msg)
              tx.sign([kp, mainKp]) // Sign with both wallets (mainKp pays fees)
              
              const sig = await connection.sendTransaction(tx, { skipPreflight: false, maxRetries: 3 })
              await connection.confirmTransaction(sig, 'confirmed')
              
              console.log(`   ✅ Transferred ${tokenBalance.value.uiAmount} tokens from ${walletAddr}: https://solscan.io/tx/${sig}`)
            }
          } catch (e: any) {
            console.log(`   ⚠️  Error transferring tokens from ${walletAddr}: ${e.message}`)
          }
        }
        
        // Transfer remaining SOL
        const balance = await connection.getBalance(kp.publicKey)
        const rentExempt = 890880 // Minimum rent for account
        const transferAmount = balance - rentExempt - 5000 // Leave rent + small buffer
        
        if (transferAmount > 0) {
          const latestBlockhash = await connection.getLatestBlockhash()
          const transferIx = SystemProgram.transfer({
            fromPubkey: kp.publicKey,
            toPubkey: mainKp.publicKey,
            lamports: transferAmount
          })
          
          const msg = new TransactionMessage({
            payerKey: kp.publicKey,
            recentBlockhash: latestBlockhash.blockhash,
            instructions: [transferIx]
          }).compileToV0Message()
          
          const tx = new VersionedTransaction(msg)
          tx.sign([kp])
          
          const sig = await connection.sendTransaction(tx, { skipPreflight: false, maxRetries: 3 })
          await connection.confirmTransaction(sig, 'confirmed')
          
          console.log(`   ✅ Transferred ${(transferAmount / LAMPORTS_PER_SOL).toFixed(6)} SOL`)
          return { success: true, address: walletAddr, amount: transferAmount }
        }
        
        return { success: true, address: walletAddr, amount: 0 }
      } catch (error: any) {
        console.log(`   ❌ Error: ${error.message}`)
        return { success: false, address: kp.publicKey.toBase58(), error: error.message }
      }
    })
  )
  
  const successful = results.filter(r => r.success)
  const failed = results.filter(r => !r.success)
  const totalRecovered = successful.reduce((sum, r) => sum + (r.amount || 0), 0)
  
  console.log(`\n📊 Summary:`)
  console.log(`   ✅ Successful: ${successful.length}/${walletsToProcess.length}`)
  console.log(`   ❌ Failed: ${failed.length}/${walletsToProcess.length}`)
  console.log(`   💰 Total recovered: ${(totalRecovered / LAMPORTS_PER_SOL).toFixed(6)} SOL`)
  
  if (failed.length > 0) {
    console.log(`\n❌ Failed wallets:`)
    failed.forEach(f => {
      console.log(`   - ${f.address}: ${f.error}`)
    })
  }
  
  // Complete profit/loss tracking if there's an in-progress run
  try {
    const latestRecord = getLatestRecord();
    if (latestRecord && latestRecord.status === 'in_progress') {
      console.log(`\n📊 Completing profit/loss tracking for run: ${latestRecord.id}`)
      await completeRunTracking(connection, mainKp.publicKey, latestRecord.id, 'completed', 'Gather-all completed manually');
    }
  } catch (error: any) {
    console.warn(`[ProfitLoss] Failed to complete tracking after gather-all: ${error.message}`);
  }
}

gatherAllWallets().catch(console.error)

