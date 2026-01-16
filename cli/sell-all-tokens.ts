import { Connection, Keypair, PublicKey } from "@solana/web3.js"
import base58 from "bs58"
import { sellTokenSimple, getWalletTokenBalance } from "./trading-terminal"
import { RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT } from "../constants"
import { TOKEN_PROGRAM_ID } from "@solana/spl-token"
import { sleep } from "../utils"

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: "confirmed"
})

// Sell all tokens (99.9%) from a wallet
async function sellAllTokens(walletPrivateKey: string) {
  const walletKp = Keypair.fromSecretKey(base58.decode(walletPrivateKey))
  const address = walletKp.publicKey.toBase58()
  
  console.log(`\n💰 Selling all tokens from wallet: ${address.substring(0, 8)}...${address.substring(address.length - 8)}`)
  
  // Get all token accounts
  const tokenAccounts = await connection.getTokenAccountsByOwner(walletKp.publicKey, {
    programId: TOKEN_PROGRAM_ID,
  })
  
  if (tokenAccounts.value.length === 0) {
    console.log(`   ✅ No token accounts found - wallet is clean!`)
    return
  }
  
  console.log(`   📦 Found ${tokenAccounts.value.length} token account(s)`)
  
  const results: Array<{ mint: string; success: boolean; error?: string }> = []
  
  // Process each token account
  for (let i = 0; i < tokenAccounts.value.length; i++) {
    const { pubkey, account } = tokenAccounts.value[i]
    
    try {
      // Get mint address from token account
      const accountData = account.data
      const mintPubkey = new PublicKey(accountData.slice(0, 32))
      const mintAddress = mintPubkey.toBase58()
      
      // Get token balance
      const tokenBalance = await getWalletTokenBalance(walletPrivateKey, mintAddress)
      
      if (!tokenBalance.hasTokens || tokenBalance.balance === 0) {
        console.log(`   [${i + 1}/${tokenAccounts.value.length}] ${mintAddress.substring(0, 8)}... - No tokens (skipping)`)
        continue
      }
      
      console.log(`\n   [${i + 1}/${tokenAccounts.value.length}] Selling ${mintAddress.substring(0, 8)}...`)
      console.log(`      Balance: ${tokenBalance.balance.toFixed(6)} tokens`)
      
      // Try to sell 99.9% with retries
      let success = false
      let lastError: string | undefined
      const maxRetries = 3
      
      for (let retry = 0; retry < maxRetries; retry++) {
        try {
          if (retry > 0) {
            console.log(`      ⏳ Retry ${retry}/${maxRetries - 1}...`)
            await sleep(2000) // Wait 2 seconds between retries
          }
          
          const result = await sellTokenSimple(
            walletPrivateKey,
            mintAddress,
            99.9, // Sell 99.9%
            'low' // Use lowest priority fee
          )
          
          console.log(`      ✅ Sell successful! ${result.txUrl}`)
          success = true
          break
        } catch (error: any) {
          lastError = error.message
          console.log(`      ❌ Attempt ${retry + 1} failed: ${error.message}`)
          
          // If it's a "no tokens" error, check balance again
          if (error.message.includes('No tokens to sell')) {
            await sleep(1000)
            const newBalance = await getWalletTokenBalance(walletPrivateKey, mintAddress)
            if (newBalance.hasTokens && newBalance.balance > 0) {
              console.log(`      ⏳ Tokens detected, retrying...`)
              continue
            } else {
              console.log(`      ⚠️  Tokens already sold or not available`)
              break
            }
          }
        }
      }
      
      results.push({
        mint: mintAddress,
        success,
        error: success ? undefined : lastError
      })
      
      // Small delay between tokens
      if (i < tokenAccounts.value.length - 1) {
        await sleep(500)
      }
      
    } catch (error: any) {
      console.log(`   ❌ Error processing token account ${i + 1}: ${error.message}`)
      results.push({
        mint: `unknown-${i}`,
        success: false,
        error: error.message
      })
    }
  }
  
  // Summary
  console.log(`\n${'='.repeat(80)}`)
  console.log(`📊 SELL SUMMARY`)
  console.log(`${'='.repeat(80)}`)
  
  const successful = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length
  
  console.log(`✅ Successful: ${successful}`)
  console.log(`❌ Failed: ${failed}`)
  
  if (failed > 0) {
    console.log(`\nFailed tokens:`)
    results.filter(r => !r.success).forEach(r => {
      console.log(`   - ${r.mint.substring(0, 8)}...: ${r.error}`)
    })
  }
  
  console.log(`${'='.repeat(80)}\n`)
}

// Main function
async function main() {
  const args = process.argv.slice(2)
  
  if (args.length < 1) {
    console.log('Usage: ts-node sell-all-tokens.ts <wallet_private_key>')
    console.log('Example: ts-node sell-all-tokens.ts <your_wallet_private_key>')
    process.exit(1)
  }
  
  const walletPrivateKey = args[0]
  
  try {
    await sellAllTokens(walletPrivateKey)
    console.log(`✅ Done!`)
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`)
    process.exit(1)
  }
}

// Run if called directly
if (require.main === module) {
  main()
}

export { sellAllTokens }

