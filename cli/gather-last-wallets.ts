import base58 from "bs58"
import fs from "fs"
import path from "path"
import { retrieveEnvVariable, getDataDirectory } from "../utils/utils"
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID, createCloseAccountInstruction, createTransferCheckedInstruction, getAssociatedTokenAddress } from "@solana/spl-token";
import { SPL_ACCOUNT_LAYOUT, TokenAccount } from "@raydium-io/raydium-sdk";
import { RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, PRIVATE_KEY } from "../constants"

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: "confirmed"
})

const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))

async function gatherLastWallets(count: number = 10) {
  console.log(`💰💰💰 GATHERING FROM LAST ${count} WALLETS IN data.json 💰💰💰\n`)
  
  const dataPath = path.join(getDataDirectory(), 'data.json')
  if (!fs.existsSync(dataPath)) {
    console.log("❌ data.json not found")
    return
  }
  
  const walletsData = JSON.parse(fs.readFileSync(dataPath, 'utf8'))
  console.log(`📦 Total wallets in data.json: ${walletsData.length}`)
  
  // Get last N wallets
  const lastWallets = walletsData.slice(-count)
  console.log(`📦 Gathering from last ${lastWallets.length} wallets\n`)
  
  const walletsToProcess: Keypair[] = lastWallets.map((privateKey: string) => 
    Keypair.fromSecretKey(base58.decode(privateKey))
  )
  
  // Check balances first
  console.log(`🔍 Checking balances...\n`)
  const walletsWithBalance: Array<{ kp: Keypair, balance: number }> = []
  
  for (const kp of walletsToProcess) {
    try {
      const balance = await connection.getBalance(kp.publicKey)
      if (balance > 100000) { // More than 0.0001 SOL (just rent)
        walletsWithBalance.push({ kp, balance })
        console.log(`   ✅ ${kp.publicKey.toBase58().slice(0, 8)}... has ${(balance / 1e9).toFixed(6)} SOL`)
      } else {
        console.log(`   ⚠️  ${kp.publicKey.toBase58().slice(0, 8)}... has ${(balance / 1e9).toFixed(6)} SOL (too low)`)
      }
    } catch (e) {
      console.log(`   ❌ Error checking ${kp.publicKey.toBase58().slice(0, 8)}...`)
    }
  }
  
  console.log(`\n💰 Found ${walletsWithBalance.length} wallets with SOL to gather\n`)
  
  if (walletsWithBalance.length === 0) {
    console.log("✅ No wallets with SOL found")
    return
  }
  
  // Process wallets
  const results = await Promise.all(
    walletsWithBalance.map(async ({ kp, balance }, index) => {
      try {
        const walletAddr = kp.publicKey.toBase58()
        console.log(`[${index + 1}/${walletsWithBalance.length}] Processing: ${walletAddr.slice(0, 8)}...`)
        
        // Get token accounts
        const tokenAccounts = await connection.getTokenAccountsByOwner(kp.publicKey, {
          programId: TOKEN_PROGRAM_ID,
        }, "confirmed")
        
        // Transfer any tokens to main wallet
        for (const { pubkey, account } of tokenAccounts.value) {
          try {
            const accountInfo = SPL_ACCOUNT_LAYOUT.decode(account.data)
            const mint = accountInfo.mint
            const balance = await connection.getTokenAccountBalance(pubkey, "confirmed")
            
            if (balance.value.uiAmount && balance.value.uiAmount > 0) {
              const mainTokenAccount = await getAssociatedTokenAddress(mint, mainKp.publicKey)
              const latestBlockhash = await connection.getLatestBlockhash()
              
              const transferIx = createTransferCheckedInstruction(
                pubkey,
                mint,
                mainTokenAccount,
                kp.publicKey,
                BigInt(balance.value.amount),
                balance.value.decimals
              )
              
              const closeIx = createCloseAccountInstruction(
                pubkey,
                mainKp.publicKey,
                kp.publicKey
              )
              
              const tx = new Transaction().add(
                ComputeBudgetProgram.setComputeUnitLimit({ units: 350_000 }),
                // No priority fee instruction - uses network default (cheapest)
                transferIx,
                closeIx
              )
              tx.feePayer = mainKp.publicKey
              tx.recentBlockhash = latestBlockhash.blockhash
              
              const sig = await sendAndConfirmTransaction(connection, tx, [mainKp, kp], {
                commitment: "confirmed",
                skipPreflight: false
              })
              
              console.log(`   ✅ Transferred ${balance.value.uiAmount} tokens: https://solscan.io/tx/${sig}`)
            }
          } catch (e: any) {
            console.log(`   ⚠️  Error transferring tokens: ${e.message}`)
          }
        }
        
        // Transfer remaining SOL (leave rent-exempt minimum)
        const currentBalance = await connection.getBalance(kp.publicKey)
        const rentExempt = 890880 // Minimum rent for account
        const buffer = 10000 // Small buffer
        const transferAmount = currentBalance > rentExempt + buffer ? currentBalance - rentExempt - buffer : 0
        
        if (transferAmount > 0) {
          const latestBlockhash = await connection.getLatestBlockhash()
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
          solTx.recentBlockhash = latestBlockhash.blockhash
          
          const sig = await sendAndConfirmTransaction(connection, solTx, [mainKp, kp], {
            commitment: "confirmed",
            skipPreflight: false
          })
          
          console.log(`   ✅✅✅ Transferred ${(transferAmount / 1e9).toFixed(6)} SOL: https://solscan.io/tx/${sig}`)
          
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
                    
                    const closeTx = new Transaction().add(
                      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
                      closeIx
                    )
                    closeTx.feePayer = mainKp.publicKey
                    closeTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
                    
                    const closeSig = await sendAndConfirmTransaction(connection, closeTx, [mainKp, kp], {
                      commitment: "confirmed",
                      skipPreflight: false
                    })
                    
                    // Estimate rent recovered (~0.002 SOL per token account)
                    const estimatedRent = 2_039_280
                    totalRentRecovered += estimatedRent
                    closedCount++
                    
                    console.log(`   🧹 Closed empty token account, recovered ~${(estimatedRent / 1e9).toFixed(6)} SOL rent: https://solscan.io/tx/${closeSig}`)
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
        } else {
          console.log(`   ⚠️  Balance too low to transfer (${(currentBalance / 1e9).toFixed(6)} SOL)`)
          return { success: true, address: walletAddr, amount: 0 }
        }
      } catch (error: any) {
        console.log(`   ❌ Error: ${error.message}`)
        return { success: false, address: kp.publicKey.toBase58(), error: error.message }
      }
    })
  )
  
  const successful = results.filter(r => r.success)
  const failed = results.filter(r => !r.success)
  const totalRecovered = successful.reduce((sum, r) => sum + (r.amount || 0), 0)
  
  console.log(`\n${'='.repeat(80)}`)
  console.log(`📊 FINAL SUMMARY`)
  console.log(`${'='.repeat(80)}`)
  console.log(`✅ Successful: ${successful.length}/${walletsWithBalance.length}`)
  console.log(`❌ Failed: ${failed.length}/${walletsWithBalance.length}`)
  console.log(`💰 Total recovered: ${(totalRecovered / 1e9).toFixed(6)} SOL`)
  
  if (failed.length > 0) {
    console.log(`\n❌ Failed wallets:`)
    failed.forEach(f => {
      console.log(`   - ${f.address}: ${f.error}`)
    })
  }
  
  console.log(`${'='.repeat(80)}\n`)
}

// Run if called directly
if (require.main === module) {
  const count = process.argv[2] ? parseInt(process.argv[2]) : 10
  gatherLastWallets(count).catch(console.error)
}

export { gatherLastWallets }

