import { Connection, PublicKey, Keypair } from "@solana/web3.js"
import base58 from "bs58"
import fs from "fs"
import path from "path"
import dotenv from 'dotenv';
dotenv.config({ override: true });

import { PRIVATE_KEY, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, BUYER_AMOUNT } from "../constants"

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: "confirmed"
})

async function findCreatorWallet() {
  console.log("🔍 Finding Creator/DEV Wallet...\n")
  
  // Check if BUYER_WALLET is set in .env
  const env = dotenv.config().parsed || {}
  const buyerWallet = env.BUYER_WALLET?.trim()
  
  if (buyerWallet && buyerWallet !== '') {
    console.log("✅ Found BUYER_WALLET in .env:")
    console.log(`   Address: ${buyerWallet}`)
    try {
      const kp = base58.decode(buyerWallet)
      const pubkey = new PublicKey(kp.slice(32))
      console.log(`   Public Key: ${pubkey.toBase58()}`)
      const balance = await connection.getBalance(pubkey)
      console.log(`   Balance: ${(balance / 1e9).toFixed(4)} SOL`)
      return
    } catch (error) {
      console.log(`   ⚠️  Invalid private key format`)
    }
  }
  
  console.log("⚠️  BUYER_WALLET not set in .env - wallet was auto-created\n")
  
  // Check current-run.json for creatorDevWalletKey
  const currentRunPath = path.join(process.cwd(), 'keys', 'current-run.json')
  if (fs.existsSync(currentRunPath)) {
    try {
      const currentRun = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'))
      if (currentRun.creatorDevWalletKey) {
        console.log("✅ Found creatorDevWalletKey in current-run.json:")
        const kp = Keypair.fromSecretKey(base58.decode(currentRun.creatorDevWalletKey))
        console.log(`   Address: ${kp.publicKey.toBase58()}`)
        const balance = await connection.getBalance(kp.publicKey)
        console.log(`   Balance: ${(balance / 1e9).toFixed(4)} SOL`)
        console.log(`   Private Key: ${currentRun.creatorDevWalletKey}`)
        return
      }
      
      // If not found, suggest checking terminal logs
      console.log("⚠️  creatorDevWalletKey not found in current-run.json")
      console.log("   This means the creator wallet was auto-created but not saved.")
      console.log("   The wallet WAS created and funded, but the private key was lost.\n")
    } catch (error) {
      console.log(`   ⚠️  Error reading current-run.json: ${error.message}`)
    }
  }
  
  console.log("🔍 Creator wallet not found in current-run.json")
  console.log("   Attempting to find it by checking recent transactions...\n")
  
  // Try to find it by checking recent transactions from main wallet
  const mainKp = base58.decode(PRIVATE_KEY)
  const mainPubkey = new PublicKey(mainKp.slice(32))
  
  console.log(`📋 Checking recent transactions from main wallet: ${mainPubkey.toBase58()}`)
  
  try {
    // Get recent signatures
    const signatures = await connection.getSignaturesForAddress(mainPubkey, { limit: 50 })
    
    // Look for transfer transactions that match BUYER_AMOUNT + buffer
    const expectedAmount = Math.floor((BUYER_AMOUNT + 0.01) * 10 ** 9)
    const tolerance = 0.001 * 10 ** 9 // 0.001 SOL tolerance
    
    console.log(`   Looking for transfers of ~${(expectedAmount / 1e9).toFixed(4)} SOL...\n`)
    
    for (const sig of signatures) {
      try {
        const tx = await connection.getTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0
        })
        
        if (!tx || !tx.transaction) continue
        
        // Check if this is a transfer transaction
        const instructions = tx.transaction.message.instructions
        for (const ix of instructions) {
          if ('programId' in ix && ix.programId.equals(new PublicKey('11111111111111111111111111111111'))) {
            // System program instruction
            const data = ix.data
            if (data && data.length > 0) {
              // Check if this looks like a transfer (amount matches)
              // We'll check the transaction's post balances
              if (tx.meta && tx.meta.postBalances) {
                const preBalances = tx.meta.preBalances || []
                const postBalances = tx.meta.postBalances
                
                // Find accounts that received SOL
                for (let i = 0; i < postBalances.length; i++) {
                  const diff = postBalances[i] - (preBalances[i] || 0)
                  if (diff > 0 && Math.abs(diff - expectedAmount) < tolerance) {
                    // Found a transfer matching the expected amount
                    const accountKey = tx.transaction.message.accountKeys[i]
                    if (accountKey && !accountKey.equals(mainPubkey)) {
                      console.log(`✅ Found potential creator wallet!`)
                      console.log(`   Address: ${accountKey.toBase58()}`)
                      const balance = await connection.getBalance(accountKey)
                      console.log(`   Current Balance: ${(balance / 1e9).toFixed(4)} SOL`)
                      console.log(`   Transaction: https://solscan.io/tx/${sig.signature}`)
                      console.log(`   ⚠️  Note: This is the PUBLIC KEY. The private key was auto-generated and not saved.`)
                      console.log(`   💡 You'll need to check terminal logs from the failed launch to find the private key.`)
                      return
                    }
                  }
                }
              }
            }
          }
        }
      } catch (error) {
        // Skip failed transaction fetches
        continue
      }
    }
    
    console.log("❌ Could not find creator wallet in recent transactions")
    console.log("\n💡 Suggestions:")
    console.log("   1. Check your terminal logs from the failed launch")
    console.log("   2. Look for lines like: 'CREATOR/DEV_WALLET: Auto-creating new wallet'")
    console.log("   3. The address should be printed there")
    console.log("   4. If you find the address, you can manually add it to current-run.json")
    
  } catch (error) {
    console.error("❌ Error searching transactions:", error.message)
  }
}

findCreatorWallet().catch(console.error)

