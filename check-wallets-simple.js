// Simple wallet checker - shows which wallets have SOL
require('dotenv').config();
const base58 = require('bs58');
const { Keypair, Connection, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_ENDPOINT, 'confirmed');

const keysPath = path.join(__dirname, 'keys', 'data.json');
const walletsData = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));

console.log('Checking bundler wallets...\n');

async function checkWallets() {
  const walletsWithSol = [];
  
  for (let i = 0; i < walletsData.length; i++) {
    try {
      const kp = Keypair.fromSecretKey(base58.decode(walletsData[i]));
      const balance = await connection.getBalance(kp.publicKey);
      const solBal = balance / LAMPORTS_PER_SOL;
      
      if (solBal > 0.001) {
        walletsWithSol.push({
          index: i + 1,
          address: kp.publicKey.toBase58(),
          balance: solBal,
          privateKey: walletsData[i]
        });
        console.log(`✅ Wallet ${i + 1}: ${solBal.toFixed(4)} SOL`);
        console.log(`   Address: ${kp.publicKey.toBase58()}`);
        console.log(`   Solscan: https://solscan.io/account/${kp.publicKey.toBase58()}\n`);
      }
      
      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 200));
    } catch (error) {
      console.error(`Error checking wallet ${i + 1}: ${error.message}`);
    }
  }
  
  if (walletsWithSol.length === 0) {
    console.log('No wallets with SOL found.');
  } else {
    console.log(`\nFound ${walletsWithSol.length} wallets with SOL.`);
    console.log('\nTo gather SOL manually, you can:');
    console.log('1. Use Phantom/Solflare wallet: Import private key');
    console.log('2. Run: npm run manual-gather');
    console.log('3. Use Solana CLI: solana transfer <main-wallet> <amount> --from <wallet-keypair-file>');
  }
}

checkWallets().catch(console.error);

