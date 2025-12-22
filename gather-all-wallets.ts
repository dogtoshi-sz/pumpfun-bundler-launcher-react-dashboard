import base58 from "bs58"
import fs from "fs"
import path from "path"
import { readJson, retrieveEnvVariable, getDataDirectory } from "./utils"
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID, createCloseAccountInstruction, createTransferCheckedInstruction, getAssociatedTokenAddress } from "@solana/spl-token";
import { RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, PRIVATE_KEY } from "./constants"

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: "confirmed"
})

const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))

async function gatherAllWallets() {
  console.log("💰💰💰 GATHERING FROM ALL WALLETS IN data.json 💰💰💰\n")
  
  const dataPath = path.join(getDataDirectory(), 'data.json')
  if (!fs.existsSync(dataPath)) {
    console.log("❌ data.json not found")
    return
  }
  
  const walletsData = JSON.parse(fs.readFileSync(dataPath, 'utf8'))
  console.log(`📦 Found ${walletsData.length} wallets in data.json\n`)
  
  const walletsToProcess: Keypair[] = []
  
  // Add all wallets from data.json
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
  
  console.log(`💰 Found ${walletsToProcess.length} wallets with SOL to gather\n`)
  
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
        
        // Sell/transfer any tokens
        for (const { pubkey, account } of tokenAccounts.value) {
          try {
            const accountInfo = account.data
            // Decode token account to get mint
            const mint = new PublicKey(accountInfo.slice(0, 32))
            const amount = accountInfo.readBigUInt64LE(64)
            
            if (amount > 0n) {
              // Transfer tokens to main wallet
              const mainTokenAccount = await getAssociatedTokenAddress(mint, mainKp.publicKey)
              const latestBlockhash = await connection.getLatestBlockhash()
              
              const transferIx = createTransferCheckedInstruction(
                pubkey,
                mint,
                mainTokenAccount,
                kp.publicKey,
                amount,
                0 // Assume 6 decimals, adjust if needed
              )
              
              const closeIx = createCloseAccountInstruction(
                pubkey,
                mainKp.publicKey,
                kp.publicKey
              )
              
              const msg = new TransactionMessage({
                payerKey: kp.publicKey,
                recentBlockhash: latestBlockhash.blockhash,
                instructions: [transferIx, closeIx]
              }).compileToV0Message()
              
              const tx = new VersionedTransaction(msg)
              tx.sign([kp])
              
              await connection.sendTransaction(tx, { skipPreflight: false, maxRetries: 3 })
              await connection.confirmTransaction(latestBlockhash.blockhash, 'confirmed')
              
              console.log(`   ✅ Transferred tokens from ${walletAddr}`)
            }
          } catch (e) {
            // Skip token errors
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
}

gatherAllWallets().catch(console.error)

