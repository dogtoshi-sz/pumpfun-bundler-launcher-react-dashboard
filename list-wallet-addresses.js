// List all wallet addresses for manual checking on Solscan
require('dotenv').config();
const base58 = require('bs58');
const { Keypair } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const keysPath = path.join(__dirname, 'keys', 'data.json');
const walletsData = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));

console.log('='.repeat(80));
console.log('BUNDLER WALLET ADDRESSES');
console.log('='.repeat(80));
console.log(`Total wallets: ${walletsData.length}\n`);

walletsData.forEach((privateKey, i) => {
  try {
    const kp = Keypair.fromSecretKey(base58.decode(privateKey));
    const address = kp.publicKey.toBase58();
    console.log(`Wallet ${i + 1}:`);
    console.log(`  Address: ${address}`);
    console.log(`  Solscan: https://solscan.io/account/${address}`);
    console.log(`  Private Key: ${privateKey}`);
    console.log('');
  } catch (error) {
    console.error(`Error processing wallet ${i + 1}: ${error.message}`);
  }
});

console.log('='.repeat(80));
console.log('INSTRUCTIONS:');
console.log('='.repeat(80));
console.log('1. Copy each Solscan URL above and check the balance manually');
console.log('2. If wallets have SOL, you can:');
console.log('   - Import private key into Phantom/Solflare and send SOL to main wallet');
console.log('   - Run: npm run manual-gather (when RPC is available)');
console.log('3. Check LUT rent: npm run close');
console.log('='.repeat(80));

