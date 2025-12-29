import base58 from "bs58"
import fs from "fs"
import path from "path"
import { sleep } from "./utils"
import { Connection, Keypair, PublicKey, ComputeBudgetProgram } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID } from "@solana/spl-token"
import { SPL_ACCOUNT_LAYOUT, TokenAccount } from "@raydium-io/raydium-sdk"
import { getSellTxWithJupiter } from "./utils/swapOnlyAmm"
import { RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, PRIORITY_FEE_LAMPORTS_HIGH, PRIORITY_FEE_LAMPORTS_MEDIUM, PRIORITY_FEE_LAMPORTS_LOW } from "./constants"

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: "processed"
})

// Rapid sell HOLDER wallets only (bundle wallets should already be sold)
// These wallets are just for holder count, so we can sell them later separately
const rapidSellHolders = async (mintAddress?: string, priorityFee: 'high' | 'medium' | 'low' = 'medium') => {
  const priorityFeeText = priorityFee === 'high' ? 'HIGH' : priorityFee === 'medium' ? 'MEDIUM' : 'LOW'
  const priorityFeeAmount = priorityFee === 'high' ? (PRIORITY_FEE_LAMPORTS_HIGH / 1e9).toFixed(4) : 
                            priorityFee === 'medium' ? (PRIORITY_FEE_LAMPORTS_MEDIUM / 1e9).toFixed(4) : 
                            (PRIORITY_FEE_LAMPORTS_LOW / 1e9).toFixed(4)
  console.log("👥👥👥 SELLING HOLDER WALLETS ONLY 👥👥👥")
  console.log(`⚡ Priority Fee: ${priorityFeeText} (${priorityFeeAmount} SOL)`)
  console.log("⚡ These wallets are just for holder count - selling separately from bundle wallets\n")
  const startTime = Date.now()
  
  // Read current run info
  const currentRunPath = path.join(process.cwd(), 'keys', 'current-run.json')
  let walletsToProcess: Keypair[] = []
  let targetMint: string | null = null
  
  // Check command line argument for mint address
  if (process.argv[2]) {
    targetMint = process.argv[2]
    console.log(`✅ Using mint address from command line: ${targetMint}`)
  }
  
  if (fs.existsSync(currentRunPath)) {
    try {
      const currentRunData = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'))
      
      // Get mint address from parameter or current-run.json
      targetMint = mintAddress || currentRunData.mintAddress || null
      
      // ONLY use holder wallets (bundle wallets should already be sold)
      if (currentRunData.holderWalletKeys && Array.isArray(currentRunData.holderWalletKeys) && currentRunData.holderWalletKeys.length > 0) {
        walletsToProcess = currentRunData.holderWalletKeys.map((kp: string) => Keypair.fromSecretKey(base58.decode(kp)))
        console.log(`✅ Found ${walletsToProcess.length} holder wallets to sell`)
      } else {
        console.log("❌ No holderWalletKeys in current-run.json")
        console.log("   💡 Holder wallets are only available if you used BUNDLE_WALLET_COUNT and HOLDER_WALLET_COUNT")
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
  
  console.log(`🎯 Target mint: ${targetMint}`)
  console.log(`   View on Solscan: https://solscan.io/token/${targetMint}`)
  console.log(`📦 Holder wallets to sell: ${walletsToProcess.length}\n`)
  
  if (walletsToProcess.length === 0) {
    console.log("⚠️  No holder wallets to sell")
    return
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
    return rpcCall()
  }
  
  // Process all holder wallets in parallel
  const sellPromises = walletsToProcess.map(async (kp, index) => {
    const walletAddr = kp.publicKey.toBase58()
    let attempts = 0
    const maxAttempts = 20
    
    while (attempts < maxAttempts) {
      try {
        attempts++
        
        // Get token accounts
        const tokenAccounts = await rateLimitedRpc(() => 
          connection.getTokenAccountsByOwner(kp.publicKey, { programId: TOKEN_PROGRAM_ID }, "processed")
        )
        
        // Find token account for our mint
        let tokenAccount: TokenAccount | null = null
        for (const { pubkey, account } of tokenAccounts.value) {
          try {
            const accountInfo = SPL_ACCOUNT_LAYOUT.decode(account.data as Buffer)
            if (accountInfo.mint.toBase58() === targetMint) {
              tokenAccount = { pubkey, programId: account.owner, accountInfo }
              break
            }
          } catch {
            continue
          }
        }
        
        if (!tokenAccount) {
          if (attempts === 1) {
            console.log(`[${index + 1}/${walletsToProcess.length}] ⏳ Holder wallet ${walletAddr}: No tokens yet (attempt ${attempts}/${maxAttempts})`)
          }
          await sleep(500)
          continue
        }
        
        // Get token balance
        const balance = await rateLimitedRpc(() => 
          connection.getTokenAccountBalance(tokenAccount!.pubkey, "processed")
        )
        
        if (!balance.value.uiAmount || balance.value.uiAmount <= 0) {
          if (attempts === 1) {
            console.log(`[${index + 1}/${walletsToProcess.length}] ⏳ Holder wallet ${walletAddr}: Zero balance (attempt ${attempts}/${maxAttempts})`)
          }
          await sleep(500)
          continue
        }
        
        // Sell tokens
        console.log(`[${index + 1}/${walletsToProcess.length}] 💰 Holder wallet ${walletAddr}: Selling ${balance.value.uiAmount} tokens...`)
        let sellTx = await getSellTxWithJupiter(kp, new PublicKey(targetMint!), balance.value.amount)
        
        if (!sellTx) {
          throw new Error("Failed to get sell transaction from Jupiter")
        }
        
        // Add priority fee
        const priorityFeeLamports = priorityFee === 'high' ? PRIORITY_FEE_LAMPORTS_HIGH : 
                                   priorityFee === 'medium' ? PRIORITY_FEE_LAMPORTS_MEDIUM : 
                                   PRIORITY_FEE_LAMPORTS_LOW
        if (priorityFeeLamports > 0) {
          sellTx.instructions.unshift(
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFeeLamports })
          )
        }
        
        const latestBlockhash = await rateLimitedRpc(() => connection.getLatestBlockhash("processed"))
        sellTx.recentBlockhash = latestBlockhash.blockhash
        
        const signedTx = await kp.signTransaction(sellTx)
        const sig = await rateLimitedRpc(() => connection.sendRawTransaction(signedTx.serialize(), { skipPreflight: false }))
        
        console.log(`[${index + 1}/${walletsToProcess.length}] ✅✅✅ Holder wallet SOLD: https://solscan.io/tx/${sig}`)
        return { success: true, wallet: walletAddr, signature: sig }
      } catch (error: any) {
        if (attempts >= maxAttempts) {
          console.log(`[${index + 1}/${walletsToProcess.length}] ❌ Holder wallet ${walletAddr}: Failed after ${maxAttempts} attempts: ${error.message}`)
          return { success: false, wallet: walletAddr, error: error.message }
        }
        await sleep(500)
      }
    }
    
    return { success: false, wallet: walletAddr, error: "Max attempts reached" }
  })
  
  const results = await Promise.all(sellPromises)
  const successful = results.filter(r => r.success)
  const failed = results.filter(r => !r.success)
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
  console.log(`\n${'='.repeat(80)}`)
  console.log(`📊 HOLDER WALLETS SELL SUMMARY`)
  console.log(`${'='.repeat(80)}`)
  console.log(`✅ Successfully sold: ${successful.length}/${walletsToProcess.length} holder wallets`)
  console.log(`❌ Failed: ${failed.length}/${walletsToProcess.length} holder wallets`)
  console.log(`⏱️  Total time: ${elapsed}s`)
  console.log(`${'='.repeat(80)}\n`)
}

if (require.main === module) {
  const mintAddress = process.argv[2]
  const priorityFee = (process.argv[3] as 'high' | 'medium' | 'low') || 'medium'
  rapidSellHolders(mintAddress, priorityFee).catch(console.error)
}

export { rapidSellHolders }

