import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { RPC_ENDPOINT } from "./constants";

const connection = new Connection(RPC_ENDPOINT, "confirmed");

async function checkTransactions() {
  const mainWallet = "FEYAuf9BzbPPcKtECLDtSLTVh6i4Niu7587UBLTCUU6V";
  const pubkey = new PublicKey(mainWallet);
  
  console.log("🔍 Checking recent transactions...\n");
  console.log(`Wallet: ${mainWallet}\n`);
  
  // Get recent signatures
  const signatures = await connection.getSignaturesForAddress(pubkey, { limit: 50 });
  
  console.log(`📋 Recent Transactions (last 50):\n`);
  
  let totalOut = 0;
  let totalIn = 0;
  
  for (const sig of signatures.slice(0, 20)) {
    try {
      const tx = await connection.getParsedTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0
      });
      
      if (!tx) continue;
      
      const date = new Date(sig.blockTime! * 1000).toLocaleString();
      const preBalance = tx.meta?.preBalances?.[0] || 0;
      const postBalance = tx.meta?.postBalances?.[0] || 0;
      const balanceChange = (postBalance - preBalance) / LAMPORTS_PER_SOL;
      
      if (balanceChange < 0) {
        totalOut += Math.abs(balanceChange);
      } else {
        totalIn += balanceChange;
      }
      
      // Check if this is a token creation or large transaction
      const fee = (tx.meta?.fee || 0) / LAMPORTS_PER_SOL;
      
      if (Math.abs(balanceChange) > 0.01 || fee > 0.001) {
        console.log(`📅 ${date}`);
        console.log(`   Signature: ${sig.signature.slice(0, 16)}...`);
        console.log(`   Balance Change: ${balanceChange > 0 ? '+' : ''}${balanceChange.toFixed(6)} SOL`);
        console.log(`   Fee: ${fee.toFixed(6)} SOL`);
        
        // Check for token creation
        if (tx.transaction.message.instructions.some((ix: any) => 
          ix.programId?.toString().includes('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P') // Pump.fun program
        )) {
          console.log(`   🎯 PUMP.FUN TOKEN CREATION`);
        }
        
        // Check for large transfers
        if (Math.abs(balanceChange) > 1) {
          console.log(`   ⚠️  LARGE TRANSACTION`);
        }
        
        console.log(`   Link: https://solscan.io/tx/${sig.signature}\n`);
      }
    } catch (e) {
      // Skip errors
    }
  }
  
  console.log(`\n📊 Summary:`);
  console.log(`   Total Out: ${totalOut.toFixed(6)} SOL`);
  console.log(`   Total In: ${totalIn.toFixed(6)} SOL`);
  console.log(`   Net: ${(totalIn - totalOut).toFixed(6)} SOL`);
  
  // Get current balance
  const currentBalance = await connection.getBalance(pubkey);
  console.log(`\n💰 Current Balance: ${(currentBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
}

checkTransactions().catch(console.error);

