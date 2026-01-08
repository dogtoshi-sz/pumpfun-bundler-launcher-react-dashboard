import { Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js"
import base58 from "bs58"
import { buyTokenSimple, sellTokenSimple } from "./trading-terminal"
import { RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT } from "./constants"
import { getCachedTrendingTokens } from "./src/fetch-trending-tokens"
import fs from "fs"
import path from "path"

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: "confirmed"
})

// Transfer SOL from one wallet to another
async function transferSol(fromPrivateKey: string, toAddress: string, amountSol: number): Promise<string> {
  const fromKp = Keypair.fromSecretKey(base58.decode(fromPrivateKey))
  const toPubkey = new PublicKey(toAddress)
  
  const amountLamports = Math.floor(amountSol * 1e9)
  
  const latestBlockhash = await connection.getLatestBlockhash('confirmed')
  
  const msg = new TransactionMessage({
    payerKey: fromKp.publicKey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: fromKp.publicKey,
        toPubkey: toPubkey,
        lamports: amountLamports,
      })
    ]
  }).compileToV0Message()
  
  const tx = new VersionedTransaction(msg)
  tx.sign([fromKp])
  
  const signature = await connection.sendTransaction(tx, {
    skipPreflight: true,
    maxRetries: 3
  })
  
  console.log(`   💸 Transfer sent: ${signature}`)
  return signature
}

// Quick wallet warming test: buy/sell multiple times, then transfer to next wallet
async function testWalletWarmer(
  walletPrivateKey: string,
  nextWalletAddress: string,
  cycles: number = 5,
  buyAmountSol: number = 0.01
): Promise<void> {
  const walletKp = Keypair.fromSecretKey(base58.decode(walletPrivateKey))
  const address = walletKp.publicKey.toBase58()
  
  console.log(`\n🔥 Testing wallet warmer: ${address.substring(0, 8)}...${address.substring(address.length - 8)}`)
  
  // Check initial balance
  const initialBalance = await connection.getBalance(walletKp.publicKey)
  const initialBalanceSol = initialBalance / 1e9
  console.log(`   💰 Initial balance: ${initialBalanceSol.toFixed(4)} SOL`)
  
  if (initialBalanceSol < 0.2) {
    console.log(`   ⚠️  Warning: Balance is less than 0.2 SOL. Proceeding anyway...`)
  }
  
  // Get trending tokens
  console.log(`   📡 Fetching trending tokens...`)
  const trendingTokens = await getCachedTrendingTokens(20)
  if (trendingTokens.length === 0) {
    throw new Error('No trending tokens available')
  }
  console.log(`   ✅ Found ${trendingTokens.length} trending tokens`)
  
  // Perform multiple buy/sell cycles
  let successCount = 0
  let failCount = 0
  
  for (let i = 0; i < cycles; i++) {
    const token = trendingTokens[i % trendingTokens.length]
    const tokenMint = token.mint
    
    try {
      console.log(`\n   [Cycle ${i + 1}/${cycles}] Trading ${tokenMint.substring(0, 8)}...`)
      
      // Buy
      console.log(`      💵 Buying ${buyAmountSol} SOL worth...`)
      const buyResult = await buyTokenSimple(
        walletPrivateKey,
        tokenMint,
        buyAmountSol,
        undefined, // No referrer (using Jupiter)
        true, // Use Jupiter
        'low' // Low priority fee
      )
      console.log(`      ✅ Buy: ${buyResult.txUrl}`)
      
      // Minimal delay to let tokens settle (0.5 seconds for super quick execution)
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Sell 100%
      console.log(`      💸 Selling 100%...`)
      const sellResult = await sellTokenSimple(
        walletPrivateKey,
        tokenMint,
        100,
        'low'
      )
      console.log(`      ✅ Sell: ${sellResult.txUrl}`)
      
      successCount++
      
      // Minimal delay between cycles (0.2 seconds for super quick execution)
      if (i < cycles - 1) {
        await new Promise(resolve => setTimeout(resolve, 200))
      }
      
    } catch (error: any) {
      failCount++
      console.log(`      ❌ Cycle ${i + 1} failed: ${error.message}`)
      // Continue with next cycle
    }
  }
  
  console.log(`\n   📊 Results: ${successCount} successful, ${failCount} failed`)
  
  // Check final balance
  const finalBalance = await connection.getBalance(walletKp.publicKey)
  const finalBalanceSol = finalBalance / 1e9
  console.log(`   💰 Final balance: ${finalBalanceSol.toFixed(4)} SOL`)
  
  // Transfer remaining SOL to next wallet (keep 0.01 SOL for fees)
  const transferAmount = Math.max(0, finalBalanceSol - 0.01)
  if (transferAmount > 0.001) {
    console.log(`\n   💸 Transferring ${transferAmount.toFixed(4)} SOL to next wallet...`)
    try {
      await transferSol(walletPrivateKey, nextWalletAddress, transferAmount)
      console.log(`   ✅ Transfer complete!`)
    } catch (error: any) {
      console.log(`   ❌ Transfer failed: ${error.message}`)
    }
  } else {
    console.log(`   ⚠️  Balance too low to transfer (need at least 0.001 SOL after fees)`)
  }
}

// Main test function
async function main() {
  const args = process.argv.slice(2)
  
  if (args.length < 2) {
    console.log('Usage: ts-node test-wallet-warmer.ts <wallet1_private_key> <wallet2_address> [cycles] [buy_amount]')
    console.log('Example: ts-node test-wallet-warmer.ts <key1> <address2> 5 0.01')
    process.exit(1)
  }
  
  const wallet1PrivateKey = args[0]
  const wallet2Address = args[1]
  const cycles = args[2] ? parseInt(args[2]) : 5
  const buyAmount = args[3] ? parseFloat(args[3]) : 0.01
  
  console.log(`\n🚀 WALLET WARMER TEST`)
  console.log(`   Cycles: ${cycles}`)
  console.log(`   Buy amount per cycle: ${buyAmount} SOL`)
  console.log(`   Total estimated cost: ~${(cycles * buyAmount * 1.1).toFixed(4)} SOL (including fees)`)
  
  try {
    await testWalletWarmer(wallet1PrivateKey, wallet2Address, cycles, buyAmount)
    console.log(`\n✅ Test completed!`)
  } catch (error: any) {
    console.error(`\n❌ Test failed: ${error.message}`)
    process.exit(1)
  }
}

// Run if called directly
if (require.main === module) {
  main()
}

export { testWalletWarmer, transferSol }

