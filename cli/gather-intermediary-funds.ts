import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import bs58 from 'bs58';
import { config } from 'dotenv';

// Load .env file
config({ path: join(__dirname, '.env') });

const RPC_URL = process.env.RPC_ENDPOINT || process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');

interface IntermediaryWallet {
  publicKey: string;
  privateKey: string;
}

interface IntermediaryWallets {
  hop1?: IntermediaryWallet[];
  hop2?: IntermediaryWallet[];
  hop3?: IntermediaryWallet[];
  [key: string]: any;
}

async function gatherAllFunds() {
  console.log('💸 Gathering funds from all intermediary wallets...\n');
  
  const mainWalletKey = process.env.PRIVATE_KEY;
  if (!mainWalletKey || mainWalletKey.trim() === '') {
    console.error('❌ Error: PRIVATE_KEY not found in .env file');
    process.exit(1);
  }
  
  const mainKp = Keypair.fromSecretKey(bs58.decode(mainWalletKey.trim()));
  const mainAddress = mainKp.publicKey.toBase58();
  
  console.log(`📍 Destination wallet: ${mainAddress}\n`);
  
  const filePath = join(__dirname, '..', 'keys', 'intermediary-wallets.json');
  const data = JSON.parse(readFileSync(filePath, 'utf-8')) as IntermediaryWallets;
  
  const allWallets: Array<{ hop: string; index: number; wallet: IntermediaryWallet }> = [];
  
  for (const [hop, wallets] of Object.entries(data)) {
    if (hop === 'createdAt' || hop === 'lastUsed') continue;
    if (Array.isArray(wallets)) {
      wallets.forEach((wallet, index) => {
        allWallets.push({ hop, index, wallet });
      });
    }
  }
  
  console.log(`Found ${allWallets.length} intermediary wallets to check\n`);
  
  let totalWithdrawn = 0;
  let successCount = 0;
  let errorCount = 0;
  const rentExemption = 890_880; // ~0.00089 SOL
  
  for (const { hop, index, wallet } of allWallets) {
    try {
      const intermediaryKp = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
      const balance = await connection.getBalance(intermediaryKp.publicKey);
      const balanceSol = balance / LAMPORTS_PER_SOL;
      
      // Only withdraw if there's more than rent exemption + small buffer
      if (balanceSol > 0.001) {
        const amountToWithdraw = balance - rentExemption - 5000; // Keep rent + small buffer
        
        if (amountToWithdraw > 0) {
          console.log(`💰 ${hop}[${index}]: ${wallet.publicKey.slice(0, 8)}...${wallet.publicKey.slice(-6)}`);
          console.log(`   Balance: ${balanceSol.toFixed(6)} SOL`);
          console.log(`   Withdrawing: ${(amountToWithdraw / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
          
          const blockhash = await connection.getLatestBlockhash();
          const transferIx = SystemProgram.transfer({
            fromPubkey: intermediaryKp.publicKey,
            toPubkey: mainKp.publicKey,
            lamports: amountToWithdraw,
          });
          
          const message = new TransactionMessage({
            payerKey: intermediaryKp.publicKey,
            recentBlockhash: blockhash.blockhash,
            instructions: [transferIx],
          }).compileToV0Message();
          
          const transaction = new VersionedTransaction(message);
          transaction.sign([intermediaryKp]);
          
          const signature = await connection.sendTransaction(transaction);
          await connection.confirmTransaction(signature, 'confirmed');
          
          console.log(`   ✅ Success! Tx: https://solscan.io/tx/${signature}\n`);
          totalWithdrawn += amountToWithdraw / LAMPORTS_PER_SOL;
          successCount++;
          
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    } catch (error: any) {
      errorCount++;
      console.error(`❌ Error withdrawing from ${hop}[${index}] ${wallet.publicKey.slice(0, 8)}...: ${error.message}\n`);
    }
  }
  
  console.log(`\n📊 Summary:`);
  console.log(`   Successful withdrawals: ${successCount}`);
  console.log(`   Errors: ${errorCount}`);
  console.log(`   Total withdrawn: ${totalWithdrawn.toFixed(6)} SOL`);
}

gatherAllFunds().catch(console.error);
