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

async function checkBalances() {
  console.log('🔍 Checking intermediary wallet balances...\n');
  
  const filePath = join(__dirname, '..', 'keys', 'intermediary-wallets.json');
  const data = JSON.parse(readFileSync(filePath, 'utf-8')) as IntermediaryWallets;
  
  const allWallets: Array<{ hop: string; index: number; wallet: IntermediaryWallet }> = [];
  
  // Collect all wallets
  for (const [hop, wallets] of Object.entries(data)) {
    if (hop === 'createdAt' || hop === 'lastUsed') continue;
    if (Array.isArray(wallets)) {
      wallets.forEach((wallet, index) => {
        allWallets.push({ hop, index, wallet });
      });
    }
  }
  
  console.log(`Found ${allWallets.length} intermediary wallets\n`);
  
  let totalStuck = 0;
  const walletsWithFunds: Array<{ hop: string; index: number; wallet: IntermediaryWallet; balance: number }> = [];
  
  // Check balances
  for (const { hop, index, wallet } of allWallets) {
    try {
      const publicKey = new PublicKey(wallet.publicKey);
      const balance = await connection.getBalance(publicKey);
      const balanceSol = balance / LAMPORTS_PER_SOL;
      
      if (balanceSol > 0.0001) { // More than just rent
        walletsWithFunds.push({ hop, index, wallet, balance: balanceSol });
        totalStuck += balanceSol;
        console.log(`💰 ${hop}[${index}]: ${wallet.publicKey.slice(0, 8)}...${wallet.publicKey.slice(-6)}`);
        console.log(`   Balance: ${balanceSol.toFixed(6)} SOL`);
        console.log(`   Private Key: ${wallet.privateKey}\n`);
      }
    } catch (error) {
      console.error(`❌ Error checking ${wallet.publicKey}:`, error);
    }
  }
  
  if (walletsWithFunds.length === 0) {
    console.log('✅ No stuck funds found in intermediary wallets!');
    return;
  }
  
  console.log(`\n📊 Summary:`);
  console.log(`   Wallets with funds: ${walletsWithFunds.length}`);
  console.log(`   Total stuck SOL: ${totalStuck.toFixed(6)} SOL\n`);
  
  console.log('💡 To recover funds:');
  console.log('   1. Import the private key into Phantom or another wallet');
  console.log('   2. Send the SOL to your main wallet');
  console.log('   OR use the withdraw script below\n');
  
  return walletsWithFunds;
}

async function withdrawToMainWallet(
  mainWalletPrivateKey: string,
  withdrawFromAll: boolean = false
) {
  console.log('💸 Withdrawing funds from intermediary wallets...\n');
  
  const mainKp = Keypair.fromSecretKey(bs58.decode(mainWalletPrivateKey));
  const mainAddress = mainKp.publicKey.toBase58();
  
  console.log(`Main wallet: ${mainAddress}\n`);
  
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
  
  let totalWithdrawn = 0;
  const rentExemption = 890_880; // ~0.00089 SOL
  
  for (const { hop, index, wallet } of allWallets) {
    try {
      const intermediaryKp = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
      const balance = await connection.getBalance(intermediaryKp.publicKey);
      const balanceSol = balance / LAMPORTS_PER_SOL;
      
      // Only withdraw if there's more than rent exemption
      if (balanceSol > 0.001) {
        const amountToWithdraw = balance - rentExemption - 5000; // Keep rent + small buffer
        
        if (amountToWithdraw > 0) {
          console.log(`💰 Withdrawing from ${hop}[${index}]: ${wallet.publicKey.slice(0, 8)}...`);
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
          
          if (!withdrawFromAll) {
            console.log('💡 Set withdrawFromAll=true to withdraw from all wallets automatically');
            break;
          }
        }
      }
    } catch (error: any) {
      console.error(`❌ Error withdrawing from ${wallet.publicKey}:`, error.message);
    }
  }
  
  if (totalWithdrawn > 0) {
    console.log(`\n✅ Total withdrawn: ${totalWithdrawn.toFixed(6)} SOL`);
  } else {
    console.log('\n⚠️  No funds to withdraw');
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  if (args[0] === 'withdraw') {
    // Withdraw mode: npm run recover-intermediary withdraw [--all]
    // Uses PRIVATE_KEY from .env if not provided
    const mainWalletKey = args[1] || process.env.PRIVATE_KEY;
    
    if (!mainWalletKey) {
      console.error('❌ Error: No main wallet private key provided');
      console.error('   Usage: npm run recover-intermediary withdraw [--all]');
      console.error('   Or set PRIVATE_KEY in .env file');
      process.exit(1);
    }
    
    await withdrawToMainWallet(mainWalletKey, args.includes('--all'));
  } else {
    // Check balances mode (default)
    await checkBalances();
  }
}

main().catch(console.error);

