// Gather SOL from warmed wallets only
import base58 from "bs58"
import fs from "fs"
import path from "path"
import dotenv from "dotenv"
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createTransferCheckedInstruction, getAssociatedTokenAddress } from "@solana/spl-token";
import { loadWarmedWallets } from "../src/wallet-warming-manager"

// CRITICAL: Reload .env file to ensure we get the latest PRIVATE_KEY
const rootEnvPath = path.join(process.cwd(), '.env')
dotenv.config({ path: rootEnvPath, override: true })

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

async function gatherWarmedWallets() {
  console.log("🔥🔥🔥 GATHERING FROM WARMED WALLETS ONLY 🔥🔥🔥\n")
  console.log(`📍 Destination wallet (PRIVATE_KEY): ${mainKp.publicKey.toBase58()}\n`)
  
  // Load all warmed wallets
  const warmedWallets = loadWarmedWallets()
  
  if (warmedWallets.length === 0) {
    console.log("❌ No warmed wallets found in warmed-wallets.json")
    return
  }
  
  console.log(`📦 Found ${warmedWallets.length} warmed wallets\n`)
  
  // Filter wallets that have SOL
  const walletsToProcess: { kp: Keypair, wallet: any }[] = []
  
  for (const wallet of warmedWallets) {
    try {
      const kp = Keypair.fromSecretKey(base58.decode(wallet.privateKey))
      const balance = await connection.getBalance(kp.publicKey)
      if (balance > 100000) { // More than 0.0001 SOL (just rent)
        walletsToProcess.push({ kp, wallet })
      }
    } catch (e) {
      // Skip invalid keys
    }
  }
  
  console.log(`💰 Found ${walletsToProcess.length} warmed wallets with SOL to gather\n`)
  
  if (walletsToProcess.length === 0) {
    console.log("✅ No warmed wallets with SOL found")
    return
  }
  
  // Process all wallets in parallel
  const results = await Promise.all(
    walletsToProcess.map(async ({ kp, wallet }, index) => {
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
          
          // Close any remaining empty token accounts to recover rent
          try {
            const remainingTokenAccounts = await connection.getTokenAccountsByOwner(kp.publicKey, {
              programId: TOKEN_PROGRAM_ID,
            }, "confirmed")
            
            if (remainingTokenAccounts.value.length > 0) {
              let closedCount = 0
              let totalRentRecovered = 0
              
              for (const { pubkey } of remainingTokenAccounts.value) {
                try {
                  const balance = await connection.getTokenAccountBalance(pubkey)
                  
                  // Only close if account is empty (balance is 0)
                  if (balance.value.amount === '0' || balance.value.uiAmount === 0) {
                    const closeIx = createCloseAccountInstruction(
                      pubkey,
                      mainKp.publicKey, // Rent recipient
                      kp.publicKey // Owner
                    )
                    
                    const latestBlockhash = await connection.getLatestBlockhash()
                    const msg = new TransactionMessage({
                      payerKey: mainKp.publicKey,
                      recentBlockhash: latestBlockhash.blockhash,
                      instructions: [closeIx]
                    }).compileToV0Message()
                    
                    const tx = new VersionedTransaction(msg)
                    tx.sign([mainKp, kp])
                    
                    const sig = await connection.sendTransaction(tx, { skipPreflight: false, maxRetries: 3 })
                    await connection.confirmTransaction(sig, 'confirmed')
                    
                    // Estimate rent recovered (~0.002 SOL per token account)
                    const estimatedRent = 2_039_280
                    totalRentRecovered += estimatedRent
                    closedCount++
                    
                    console.log(`   🧹 Closed empty token account, recovered ~${(estimatedRent / 1e9).toFixed(6)} SOL rent`)
                  }
                } catch (closeError: any) {
                  const errorMsg = closeError.message || String(closeError)
                  if (!errorMsg.includes('AccountNotFound') && !errorMsg.includes('no record')) {
                    // Silently skip - account might already be closed or have balance
                  }
                }
              }
              
              if (closedCount > 0) {
                console.log(`   ✅ Closed ${closedCount} empty token account(s), recovered ~${(totalRentRecovered / 1e9).toFixed(6)} SOL rent`)
              }
            }
          } catch (closeAccountsError: any) {
            // Non-critical - just continue
          }
          
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
}

gatherWarmedWallets().catch(console.error)

