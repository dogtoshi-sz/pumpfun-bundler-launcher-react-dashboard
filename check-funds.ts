import base58 from "bs58"
import fs from "fs"
import path from "path"
import { Connection, Keypair, PublicKey } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID } from "@solana/spl-token"
import { SPL_ACCOUNT_LAYOUT } from "@raydium-io/raydium-sdk"
import { RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, PRIVATE_KEY } from "./constants"

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: "confirmed"
})

const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))

const checkFunds = async () => {
  console.log("💰💰💰 CHECKING WHERE YOUR FUNDS ARE 💰💰💰\n")
  
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
  const creatorDevWalletKey = currentRunData.creatorDevWalletKey
  
  console.log(`📊 Current Run Info:`)
  console.log(`   Mint: ${mintAddress || 'N/A'}`)
  console.log(`   Status: ${currentRunData.launchStatus || 'UNKNOWN'}`)
  console.log(`   Total Wallets: ${walletKeys.length}`)
  console.log(`   Bundle Wallets: ${bundleWalletKeys.length}`)
  console.log(`   Holder Wallets: ${holderWalletKeys.length}\n`)
  
  // Check main wallet
  const mainBalance = await connection.getBalance(mainKp.publicKey)
  console.log(`💼 MAIN FUNDING WALLET: ${mainKp.publicKey.toBase58()}`)
  console.log(`   SOL: ${(mainBalance / 1e9).toFixed(6)} SOL\n`)
  
  // Check DEV/Creator wallet if available
  if (creatorDevWalletKey) {
    try {
      const devKp = Keypair.fromSecretKey(base58.decode(creatorDevWalletKey))
      const devBalance = await connection.getBalance(devKp.publicKey)
      console.log(`👤 DEV/CREATOR WALLET: ${devKp.publicKey.toBase58()}`)
      console.log(`   SOL: ${(devBalance / 1e9).toFixed(6)} SOL`)
      
      if (mintAddress) {
        try {
          const devTokenAccounts = await connection.getTokenAccountsByOwner(devKp.publicKey, {
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
            const tokenAmount = balance.value.uiAmount || 0
            console.log(`   Tokens: ${tokenAmount.toFixed(2)} ${mintAddress.slice(0, 8)}...`)
            console.log(`   Token Account: ${devToken.pubkey.toBase58()}`)
          } else {
            console.log(`   Tokens: 0`)
          }
        } catch (e) {
          console.log(`   Tokens: Error checking - ${e}`)
        }
      }
      console.log()
    } catch (e) {
      console.log(`   ⚠️  Could not decode DEV wallet key: ${e}\n`)
    }
  }
  
  // Check all wallets from current run
  let totalSol = 0
  let totalTokens = 0
  let walletsWithTokens = 0
  let walletsWithSol = 0
  
  console.log(`📦 Checking ${walletKeys.length} wallets from current run...\n`)
  
  for (let i = 0; i < walletKeys.length; i++) {
    try {
      const kp = Keypair.fromSecretKey(base58.decode(walletKeys[i]))
      const isBundle = bundleWalletKeys.includes(walletKeys[i])
      const isHolder = holderWalletKeys.includes(walletKeys[i])
      const walletType = isBundle ? 'BUNDLE' : (isHolder ? 'HOLDER' : 'UNKNOWN')
      
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
        console.log(`[${i + 1}/${walletKeys.length}] ${walletType} ${kp.publicKey.toBase58()}`)
        console.log(`   SOL: ${(solBal / 1e9).toFixed(6)} SOL`)
        if (mintAddress && tokenBal > 0) {
          console.log(`   Tokens: ${tokenBal.toFixed(2)}`)
        }
        console.log()
      }
    } catch (e) {
      console.log(`[${i + 1}/${walletKeys.length}] Error checking wallet: ${e}`)
    }
  }
  
  console.log(`\n${'='.repeat(80)}`)
  console.log(`📊 FUNDS SUMMARY`)
  console.log(`${'='.repeat(80)}`)
  console.log(`Main Wallet SOL: ${(mainBalance / 1e9).toFixed(6)} SOL`)
  if (creatorDevWalletKey) {
    try {
      const devKp = Keypair.fromSecretKey(base58.decode(creatorDevWalletKey))
      const devBalance = await connection.getBalance(devKp.publicKey)
      console.log(`DEV Wallet SOL: ${(devBalance / 1e9).toFixed(6)} SOL`)
    } catch {}
  }
  console.log(`Total SOL in wallets: ${(totalSol / 1e9).toFixed(6)} SOL`)
  console.log(`Wallets with SOL (>0.001): ${walletsWithSol}/${walletKeys.length}`)
  if (mintAddress) {
    console.log(`Total Tokens: ${totalTokens.toFixed(2)}`)
    console.log(`Wallets with Tokens: ${walletsWithTokens}/${walletKeys.length}`)
    console.log(`\n🔗 Token Mint: ${mintAddress}`)
    console.log(`   View on Solscan: https://solscan.io/token/${mintAddress}`)
  }
  console.log(`${'='.repeat(80)}\n`)
}

checkFunds().catch(console.error)

