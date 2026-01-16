import base58 from "bs58"
import fs from "fs"
import path from "path"
import { Connection, Keypair, PublicKey } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID } from "@solana/spl-token"
import { SPL_ACCOUNT_LAYOUT } from "@raydium-io/raydium-sdk"
import { RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, PRIVATE_KEY, BUYER_WALLET } from "../constants"

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: "confirmed"
})

const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))
const buyerKp = Keypair.fromSecretKey(base58.decode(BUYER_WALLET))

const checkBalance = async () => {
  console.log("💰💰💰 CHECKING WALLET BALANCES 💰💰💰\n")
  
  // Read current run
  const currentRunPath = path.join(process.cwd(), 'keys', 'current-run.json')
  if (!fs.existsSync(currentRunPath)) {
    console.log("❌ No current-run.json found")
    return
  }
  
  const currentRunData = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'))
  const mintAddress = currentRunData.mintAddress
  const walletKeys = currentRunData.walletKeys || []
  const bundleWalletKeys = currentRunData.bundleWalletKeys || []
  const holderWalletKeys = currentRunData.holderWalletKeys || []
  
  console.log(`📊 Current Run Info:`)
  console.log(`   Mint: ${mintAddress || 'N/A'}`)
  console.log(`   Status: ${currentRunData.launchStatus || 'UNKNOWN'}`)
  console.log(`   Total Wallets: ${walletKeys.length}`)
  console.log(`   Bundle Wallets: ${bundleWalletKeys.length}`)
  console.log(`   Holder Wallets: ${holderWalletKeys.length}\n`)
  
  // Check main wallet
  const mainBalance = await connection.getBalance(mainKp.publicKey)
  console.log(`💼 MAIN WALLET: ${mainKp.publicKey.toBase58()}`)
  console.log(`   SOL: ${(mainBalance / 1e9).toFixed(6)} SOL\n`)
  
  // Check DEV wallet
  const devBalance = await connection.getBalance(buyerKp.publicKey)
  console.log(`👤 DEV WALLET: ${buyerKp.publicKey.toBase58()}`)
  console.log(`   SOL: ${(devBalance / 1e9).toFixed(6)} SOL`)
  
  if (mintAddress) {
    try {
      const devTokenAccounts = await connection.getTokenAccountsByOwner(buyerKp.publicKey, {
        programId: TOKEN_PROGRAM_ID,
      })
      const devToken = devTokenAccounts.value.find(acc => {
        try {
          const accountInfo = SPL_ACCOUNT_LAYOUT.decode(acc.account.data as Buffer)
          return accountInfo.mint.toBase58() === mintAddress
        } catch {
          return false
        }
      })
      if (devToken) {
        const balance = await connection.getTokenAccountBalance(devToken.pubkey)
        console.log(`   Tokens: ${balance.value.uiAmount || 0}`)
      } else {
        console.log(`   Tokens: 0`)
      }
    } catch (e) {
      console.log(`   Tokens: Error checking`)
    }
  }
  console.log()
  
  // Check all wallets from current run
  let totalSol = 0
  let totalTokens = 0
  let walletsWithTokens = 0
  let walletsWithSol = 0
  
  console.log(`📦 Checking ${walletKeys.length} wallets from current run...\n`)
  
  for (let i = 0; i < walletKeys.length; i++) {
    const kp = Keypair.fromSecretKey(base58.decode(walletKeys[i]))
    const isBundle = bundleWalletKeys.includes(walletKeys[i])
    const isHolder = holderWalletKeys.includes(walletKeys[i])
    const walletType = isBundle ? 'BUNDLE' : (isHolder ? 'HOLDER' : 'UNKNOWN')
    
    try {
      const solBal = await connection.getBalance(kp.publicKey)
      totalSol += solBal
      if (solBal > 0.001 * 1e9) walletsWithSol++
      
      let tokenBal = 0
      if (mintAddress) {
        try {
          const tokenAccounts = await connection.getTokenAccountsByOwner(kp.publicKey, {
            programId: TOKEN_PROGRAM_ID,
          })
          const tokenAcc = tokenAccounts.value.find(acc => {
            try {
              const accountInfo = SPL_ACCOUNT_LAYOUT.decode(acc.account.data as Buffer)
              return accountInfo.mint.toBase58() === mintAddress
            } catch {
              return false
            }
          })
          if (tokenAcc) {
            const balance = await connection.getTokenAccountBalance(tokenAcc.pubkey)
            tokenBal = balance.value.uiAmount || 0
            totalTokens += tokenBal
            if (tokenBal > 0) walletsWithTokens++
          }
        } catch (e) {
          // No tokens
        }
      }
      
      if (solBal > 0.001 * 1e9 || tokenBal > 0) {
        console.log(`[${i + 1}/${walletKeys.length}] ${walletType} ${kp.publicKey.toBase58().slice(0, 8)}...`)
        console.log(`   SOL: ${(solBal / 1e9).toFixed(6)} SOL`)
        if (mintAddress) {
          console.log(`   Tokens: ${tokenBal.toFixed(2)}`)
        }
        console.log()
      }
    } catch (e) {
      console.log(`[${i + 1}/${walletKeys.length}] ${walletType} ${kp.publicKey.toBase58().slice(0, 8)}... - Error: ${e}`)
    }
  }
  
  console.log(`\n${'='.repeat(80)}`)
  console.log(`📊 SUMMARY`)
  console.log(`${'='.repeat(80)}`)
  console.log(`Main Wallet SOL: ${(mainBalance / 1e9).toFixed(6)} SOL`)
  console.log(`DEV Wallet SOL: ${(devBalance / 1e9).toFixed(6)} SOL`)
  console.log(`Total SOL in wallets: ${(totalSol / 1e9).toFixed(6)} SOL`)
  console.log(`Wallets with SOL (>0.001): ${walletsWithSol}/${walletKeys.length}`)
  if (mintAddress) {
    console.log(`Total Tokens: ${totalTokens.toFixed(2)}`)
    console.log(`Wallets with Tokens: ${walletsWithTokens}/${walletKeys.length}`)
  }
  console.log(`${'='.repeat(80)}\n`)
}

checkBalance().catch(console.error)

