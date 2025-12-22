// Script to decode wallet addresses from private keys - READ ONLY, NO TRANSACTIONS
const base58 = require('bs58');
const { Keypair } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const keysPath = path.join(__dirname, 'keys', 'data.json');
const walletsData = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));

console.log('=== Wallet Addresses (Where Your SOL Was Distributed) ===\n');
console.log(`Total wallets: ${walletsData.length}\n`);

walletsData.forEach((privateKeyBase58, index) => {
  try {
    const keypair = Keypair.fromSecretKey(base58.decode(privateKeyBase58));
    console.log(`Wallet ${index + 1}: ${keypair.publicKey.toBase58()}`);
  } catch (error) {
    console.log(`Wallet ${index + 1}: Error decoding`);
  }
});

console.log('\n=== Main Wallet (Where SOL Should Be Collected To) ===');
const mainPrivateKey = '57nysjUdPKkwbdEXGaAVU1EH6P4fEiveLnGbnvXZHEdCkC4wf7pmnaxBVxdSzNxYdKq2nhPC57JN4RHAfsJDWE6B';
try {
  const mainKp = Keypair.fromSecretKey(base58.decode(mainPrivateKey));
  console.log(`Main Wallet: ${mainKp.publicKey.toBase58()}`);
} catch (error) {
  console.log('Error decoding main wallet');
}

console.log('\n=== Summary ===');
console.log('SOL was distributed TO the 12 wallets above');
console.log('The gather script collects SOL FROM those wallets BACK to your main wallet');
console.log('Check these addresses on Solscan to see current balances');

