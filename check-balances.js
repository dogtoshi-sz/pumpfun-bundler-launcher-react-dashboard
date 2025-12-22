// READ-ONLY script to check wallet balances - NO TRANSACTIONS
require('dotenv').config();
const base58 = require('bs58');
const { Keypair, Connection } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_ENDPOINT, 'confirmed');

const keysPath = path.join(__dirname, 'keys', 'data.json');
const walletsData = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));

const mainPrivateKey = process.env.PRIVATE_KEY;
const mainKp = Keypair.fromSecretKey(base58.decode(mainPrivateKey));

async function checkBalances() {
  console.log('=== Checking Wallet Balances ===\n');
  console.log(`Main Wallet: ${mainKp.publicKey.toBase58()}`);
  
  try {
    const mainBalance = await connection.getBalance(mainKp.publicKey);
    console.log(`Main Wallet Balance: ${(mainBalance / 1e9).toFixed(4)} SOL\n`);
  } catch (error) {
    console.log(`Error checking main wallet: ${error.message}\n`);
  }

  console.log(`Checking ${walletsData.length} bundler wallets...\n`);
  
  let totalBundlerBalance = 0;
  const walletsWithBalance = [];

  for (let i = 0; i < walletsData.length; i++) {
    try {
      const keypair = Keypair.fromSecretKey(base58.decode(walletsData[i]));
      const address = keypair.publicKey.toBase58();
      
      try {
        const balance = await connection.getBalance(keypair.publicKey);
        const solBalance = balance / 1e9;
        
        if (solBalance > 0.001) { // Only show wallets with meaningful balance
          walletsWithBalance.push({ index: i, address, balance: solBalance });
          totalBundlerBalance += solBalance;
          console.log(`Wallet ${i + 1}: ${address}`);
          console.log(`  Balance: ${solBalance.toFixed(4)} SOL`);
          console.log(`  Solscan: https://solscan.io/account/${address}\n`);
        }
      } catch (error) {
        console.log(`Wallet ${i + 1}: Error checking balance - ${error.message}`);
      }
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.log(`Wallet ${i + 1}: Error decoding private key`);
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Total SOL in bundler wallets: ${totalBundlerBalance.toFixed(4)} SOL`);
  console.log(`Wallets with balance: ${walletsWithBalance.length}`);
  
  if (walletsWithBalance.length > 0) {
    console.log('\n=== Wallets Still Holding SOL ===');
    walletsWithBalance.forEach(w => {
      console.log(`Wallet ${w.index + 1}: ${w.balance.toFixed(4)} SOL`);
      console.log(`  Address: ${w.address}`);
      console.log(`  Link: https://solscan.io/account/${w.address}\n`);
    });
  } else {
    console.log('\nNo bundler wallets found with significant balance.');
    console.log('The missing SOL might be:');
    console.log('1. In transaction fees');
    console.log('2. In failed transactions (check transaction history)');
    console.log('3. Already gathered but not showing yet');
  }
}

checkBalances().catch(console.error);

