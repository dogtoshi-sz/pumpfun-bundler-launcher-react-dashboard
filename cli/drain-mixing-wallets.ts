import { Connection, Keypair, SystemProgram, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, PublicKey } from "@solana/web3.js";
import * as fs from 'fs';
import * as path from 'path';
import base58 from 'bs58';
import dotenv from 'dotenv';
import { retrieveEnvVariable } from '../utils';

// Load .env
dotenv.config();

const RPC_ENDPOINT = retrieveEnvVariable('RPC_ENDPOINT', process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com', false);
const PRIVATE_KEY = retrieveEnvVariable('PRIVATE_KEY', '', true);

// Load mixing wallets from file
const loadMixingWallets = (): Keypair[] => {
  try {
    const mixingPath = path.join(process.cwd(), 'keys', 'mixing-wallets.json');
    if (fs.existsSync(mixingPath)) {
      const data = JSON.parse(fs.readFileSync(mixingPath, 'utf8'));
      const wallets: Keypair[] = [];
      for (const key in data) {
        if (key !== 'createdAt' && key !== 'lastUsed' && data[key]?.privateKey) {
          try {
            wallets.push(Keypair.fromSecretKey(base58.decode(data[key].privateKey)));
          } catch (e) {
            console.log(`⚠️  Skipping invalid wallet: ${key}`);
          }
        }
      }
      return wallets;
    }
  } catch (e) {
    console.error('Error loading mixing wallets:', e);
  }
  return [];
};

// Execute transaction
const execute = async (tx: VersionedTransaction, blockhash: any, retries: number = 3): Promise<string | null> => {
  for (let i = 0; i < retries; i++) {
    try {
      const connection = new Connection(RPC_ENDPOINT, 'confirmed');
      const signature = await connection.sendTransaction(tx, { skipPreflight: false, maxRetries: 3 });
      await connection.confirmTransaction(signature, 'confirmed');
      return signature;
    } catch (error: any) {
      if (i === retries - 1) {
        console.error(`Transaction failed after ${retries} retries:`, error.message);
        return null;
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  return null;
};

async function drainMixingWallets() {
  try {
    console.log('🔍 Loading mixing wallets...');
    const mixingWallets = loadMixingWallets();
    
    if (mixingWallets.length === 0) {
      console.log('❌ No mixing wallets found in keys/mixing-wallets.json');
      return;
    }
    
    console.log(`✅ Found ${mixingWallets.length} mixing wallet(s)`);
    
    // Load main wallet
    const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY));
    console.log(`💰 Main wallet: ${mainKp.publicKey.toBase58()}`);
    
    const connection = new Connection(RPC_ENDPOINT, 'confirmed');
    
    // Get main wallet balance
    const mainBalance = await connection.getBalance(mainKp.publicKey);
    console.log(`📊 Main wallet balance: ${(mainBalance / 1e9).toFixed(6)} SOL\n`);
    
    // Get minimum balance for rent exemption (more accurate than hardcoded value)
    const rentExemptMin = await connection.getMinimumBalanceForRentExemption(0);
    // Leave extra buffer for transaction fees (compute budget + base fee)
    const feeBuffer = 10_000; // Buffer for transaction fees
    const minBalanceToKeep = rentExemptMin + feeBuffer;
    
    let totalRecovered = 0;
    let successCount = 0;
    let failedCount = 0;
    
    // Process each mixing wallet
    for (let i = 0; i < mixingWallets.length; i++) {
      const mixer = mixingWallets[i];
      const mixerPubkey = mixer.publicKey.toBase58();
      
      try {
        const balance = await connection.getBalance(mixer.publicKey);
        const availableBalance = balance > minBalanceToKeep ? balance - minBalanceToKeep : 0;
        
        if (availableBalance <= 0) {
          console.log(`⏭️  Mixer ${i + 1}/${mixingWallets.length} (${mixerPubkey.slice(0, 8)}...): No recoverable SOL (balance: ${(balance / 1e9).toFixed(6)} SOL, min required: ${(minBalanceToKeep / 1e9).toFixed(6)} SOL)`);
          continue;
        }
        
        console.log(`💸 Draining mixer ${i + 1}/${mixingWallets.length} (${mixerPubkey.slice(0, 8)}...${mixerPubkey.slice(-8)})`);
        console.log(`   Balance: ${(balance / 1e9).toFixed(6)} SOL`);
        console.log(`   Recoverable: ${(availableBalance / 1e9).toFixed(6)} SOL`);
        console.log(`   Keeping: ${(minBalanceToKeep / 1e9).toFixed(6)} SOL (rent + fees)`);
        
        const blockhash = await connection.getLatestBlockhash('confirmed');
        const drainTx = new TransactionMessage({
          payerKey: mixer.publicKey,
          recentBlockhash: blockhash.blockhash,
          instructions: [
            ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
            SystemProgram.transfer({
              fromPubkey: mixer.publicKey,
              toPubkey: mainKp.publicKey,
              lamports: availableBalance
            })
          ]
        }).compileToV0Message();
        
        const drainV0 = new VersionedTransaction(drainTx);
        drainV0.sign([mixer]);
        
        const signature = await execute(drainV0, blockhash, 3);
        
        if (signature) {
          console.log(`   ✅ Success! Signature: ${signature}`);
          console.log(`   🔗 https://solscan.io/tx/${signature}\n`);
          totalRecovered += availableBalance;
          successCount++;
        } else {
          console.log(`   ❌ Failed to drain mixer\n`);
          failedCount++;
        }
        
        // Small delay between transactions
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error: any) {
        console.log(`   ❌ Error draining mixer: ${error.message}\n`);
        failedCount++;
      }
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 DRAIN SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Successfully drained: ${successCount} wallet(s)`);
    console.log(`❌ Failed: ${failedCount} wallet(s)`);
    console.log(`💰 Total recovered: ${(totalRecovered / 1e9).toFixed(6)} SOL`);
    
    // Get final main wallet balance
    const finalBalance = await connection.getBalance(mainKp.publicKey);
    console.log(`\n💰 Main wallet balance after drain: ${(finalBalance / 1e9).toFixed(6)} SOL`);
    console.log(`📈 Balance increase: ${((finalBalance - mainBalance) / 1e9).toFixed(6)} SOL`);
    
  } catch (error: any) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

// Run the drain
drainMixingWallets()
  .then(() => {
    console.log('\n✅ Drain complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });

