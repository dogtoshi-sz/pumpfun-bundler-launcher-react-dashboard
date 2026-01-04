import base58 from "bs58"
import fs from "fs"
import path from "path"
import { Connection, PublicKey } from "@solana/web3.js"
import { RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT } from "./constants"

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: "confirmed"
})

const checkMixerFunds = async () => {
  console.log("🔀🔀🔀 CHECKING MIXER WALLET BALANCES 🔀🔀🔀\n")
  
  // Read mixing wallets
  const mixingWalletsPath = path.join(process.cwd(), 'keys', 'mixing-wallets.json')
  if (!fs.existsSync(mixingWalletsPath)) {
    console.log("❌ No mixing-wallets.json found")
    return
  }
  
  const mixingWallets = JSON.parse(fs.readFileSync(mixingWalletsPath, 'utf8'))
  
  console.log(`📊 Found ${Object.keys(mixingWallets).filter(k => k.startsWith('wallet')).length} mixer wallets\n`)
  
  let totalSol = 0
  let walletsWithFunds = 0
  
  // Check each mixer wallet
  for (const [key, wallet] of Object.entries(mixingWallets)) {
    if (key.startsWith('wallet')) {
      try {
        const walletData = wallet as { publicKey: string; privateKey: string }
        const pubkey = new PublicKey(walletData.publicKey)
        const balance = await connection.getBalance(pubkey)
        const balanceSol = balance / 1e9
        
        totalSol += balance
        
        if (balanceSol > 0.0001) { // Show wallets with more than 0.0001 SOL
          walletsWithFunds++
          console.log(`💰 ${key.toUpperCase()}: ${walletData.publicKey}`)
          console.log(`   SOL: ${balanceSol.toFixed(6)} SOL`)
          console.log(`   View: https://solscan.io/account/${walletData.publicKey}`)
          console.log()
        }
      } catch (e) {
        console.log(`❌ Error checking ${key}: ${e}`)
      }
    }
  }
  
  console.log(`\n${'='.repeat(80)}`)
  console.log(`📊 MIXER FUNDS SUMMARY`)
  console.log(`${'='.repeat(80)}`)
  console.log(`Total SOL in mixer wallets: ${(totalSol / 1e9).toFixed(6)} SOL`)
  console.log(`Mixer wallets with funds (>0.0001 SOL): ${walletsWithFunds}`)
  console.log(`Total mixer wallets: ${Object.keys(mixingWallets).filter(k => k.startsWith('wallet')).length}`)
  console.log(`${'='.repeat(80)}\n`)
  
  if (totalSol > 0.001 * 1e9) {
    console.log(`💡 You can drain mixer wallets with: npm run drain-mixers`)
  }
}

checkMixerFunds().catch(console.error)

