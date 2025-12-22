const base58 = require('bs58');
const { Keypair } = require('@solana/web3.js');
const fs = require('fs');

const wallets = JSON.parse(fs.readFileSync('keys/data.json', 'utf-8'));

console.log('BUNDLER WALLET ADDRESSES:');
console.log('='.repeat(70));

wallets.forEach((pk, i) => {
  const kp = Keypair.fromSecretKey(base58.decode(pk));
  console.log(`\nWallet ${i + 1}:`);
  console.log(`  ${kp.publicKey.toBase58()}`);
  console.log(`  https://solscan.io/account/${kp.publicKey.toBase58()}`);
});

console.log('\n' + '='.repeat(70));
console.log('Check each address on Solscan to see balances.');

