import { Connection, PublicKey } from "@solana/web3.js"
import { RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT } from "./constants"
import fs from "fs"
import path from "path"
import base58 from "bs58"
import { TOKEN_PROGRAM_ID } from "@solana/spl-token"
import { SPL_ACCOUNT_LAYOUT } from "@raydium-io/raydium-sdk"

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: "confirmed"
})

const checkBundleStatus = async () => {
  console.log("🔍 Checking bundle status...\n")
  
  // Read current run info
  const currentRunPath = path.join(process.cwd(), 'keys', 'current-run.json')
  const mintPath = path.join(process.cwd(), 'keys', 'mint.json')
  
  if (!fs.existsSync(currentRunPath)) {
    console.log("❌ No current-run.json found")
    return
  }
  
  if (!fs.existsSync(mintPath)) {
    console.log("❌ No mint.json found")
    return
  }
  
  const currentRunData = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'))
  const mintData = JSON.parse(fs.readFileSync(mintPath, 'utf8'))
  
  const mintAddress = currentRunData.mintAddress || (mintData[0] ? base58.decode(mintData[0]) : null)
  
  if (!mintAddress) {
    console.log("❌ No mint address found")
    return
  }
  
  const mintPubkey = new PublicKey(mintAddress)
  console.log(`🎯 Mint Address: ${mintAddress}`)
  console.log(`   View on Solscan: https://solscan.io/token/${mintAddress}\n`)
  
  // Check if token exists
  console.log("1️⃣  Checking if token exists on-chain...")
  try {
    const mintInfo = await connection.getParsedAccountInfo(mintPubkey, "confirmed")
    if (mintInfo.value && mintInfo.value.data) {
      console.log("   ✅ Token EXISTS on-chain")
      const data = mintInfo.value.data as any
      if (data.parsed && data.parsed.info) {
        console.log(`   Supply: ${data.parsed.info.supply}`)
        console.log(`   Decimals: ${data.parsed.info.decimals}`)
      }
    } else {
      console.log("   ❌ Token does NOT exist on-chain")
      console.log("   The bundle may have failed or is still processing")
      return
    }
  } catch (error: any) {
    console.log(`   ❌ Error checking token: ${error.message}`)
    return
  }
  
  // Check wallets from current run
  console.log("\n2️⃣  Checking wallets from current run...")
  const walletsToCheck: string[] = []
  
  if (currentRunData.walletKeys && Array.isArray(currentRunData.walletKeys)) {
    walletsToCheck.push(...currentRunData.walletKeys)
  }
  
  // Add DEV wallet
  const { BUYER_WALLET } = require("./constants")
  walletsToCheck.push(BUYER_WALLET)
  
  console.log(`   Checking ${walletsToCheck.length} wallets...\n`)
  
  let walletsWithTokens = 0
  let walletsWithoutTokens = 0
  
  for (let i = 0; i < walletsToCheck.length; i++) {
    const walletKey = walletsToCheck[i]
    const walletKp = require("bs58").decode(walletKey)
    const { Keypair } = require("@solana/web3.js")
    const wallet = Keypair.fromSecretKey(walletKp)
    const walletAddr = wallet.publicKey.toBase58()
    
    try {
      const tokenAccounts = await connection.getTokenAccountsByOwner(wallet.publicKey, {
        programId: TOKEN_PROGRAM_ID,
      }, "confirmed")
      
      let hasTokens = false
      for (const { pubkey, account } of tokenAccounts.value) {
        const accountInfo = SPL_ACCOUNT_LAYOUT.decode(account.data)
        if (accountInfo.mint.equals(mintPubkey)) {
          const balance = await connection.getTokenAccountBalance(pubkey, "confirmed")
          if (balance.value.uiAmount && balance.value.uiAmount > 0) {
            hasTokens = true
            const isDev = walletAddr === BUYER_WALLET
            console.log(`   ${hasTokens ? '✅' : '❌'} ${isDev ? 'DEV' : `Wallet ${i}`} (${walletAddr.slice(0, 8)}...): ${balance.value.uiAmount?.toFixed(2)} tokens`)
            walletsWithTokens++
            break
          }
        }
      }
      
      if (!hasTokens) {
        const isDev = walletAddr === BUYER_WALLET
        console.log(`   ❌ ${isDev ? 'DEV' : `Wallet ${i}`} (${walletAddr.slice(0, 8)}...): NO TOKENS`)
        walletsWithoutTokens++
      }
    } catch (error: any) {
      const isDev = walletAddr === BUYER_WALLET
      console.log(`   ⚠️  ${isDev ? 'DEV' : `Wallet ${i}`} (${walletAddr.slice(0, 8)}...): Error - ${error.message}`)
      walletsWithoutTokens++
    }
  }
  
  console.log(`\n📊 Summary:`)
  console.log(`   ✅ Wallets with tokens: ${walletsWithTokens}/${walletsToCheck.length}`)
  console.log(`   ❌ Wallets without tokens: ${walletsWithoutTokens}/${walletsToCheck.length}`)
  
  if (walletsWithoutTokens > 0) {
    console.log(`\n⚠️  WARNING: Some wallets did not receive tokens!`)
    console.log(`   This means the bundle buys may have failed`)
    console.log(`   Possible reasons:`)
    console.log(`   1. Bundle was not included in a block by Jito`)
    console.log(`   2. Transaction failed during execution`)
    console.log(`   3. Insufficient SOL in wallets`)
    console.log(`   4. Bundle was rejected by validators`)
    console.log(`\n   Check the transaction signature on Solscan to see what happened`)
  } else {
    console.log(`\n✅ All wallets received tokens! Bundle was successful!`)
  }
  
  // Try to find the transaction signature
  console.log(`\n3️⃣  Finding transaction signature...`)
  try {
    // Get recent signatures for the mint account
    const signatures = await connection.getSignaturesForAddress(mintPubkey, { limit: 5 })
    if (signatures.length > 0) {
      console.log(`   Found ${signatures.length} recent transaction(s):`)
      for (const sig of signatures) {
        console.log(`   - ${sig.signature}`)
        console.log(`     Block: ${sig.slot}, Status: ${sig.err ? 'FAILED' : 'SUCCESS'}`)
        console.log(`     View: https://solscan.io/tx/${sig.signature}`)
        if (sig.err) {
          console.log(`     Error: ${JSON.stringify(sig.err)}`)
        }
      }
    } else {
      console.log(`   ⚠️  No recent transactions found for mint`)
    }
  } catch (error: any) {
    console.log(`   ⚠️  Error finding transactions: ${error.message}`)
  }
}

checkBundleStatus().catch(console.error)

