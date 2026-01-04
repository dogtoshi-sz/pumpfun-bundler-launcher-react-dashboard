const base58 = require('bs58');
const { Keypair } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, 'keys', 'data.json');
const currentRunPath = path.join(__dirname, 'keys', 'current-run.json');

const allWallets = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const currentRun = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));

// Get all bundle and holder wallet public keys
const bundlePubKeys = (currentRun.bundleWalletKeys || []).map(pk => {
  const kp = Keypair.fromSecretKey(base58.decode(pk));
  return kp.publicKey.toBase58();
});

const holderPubKeys = (currentRun.holderWalletKeys || []).map(pk => {
  const kp = Keypair.fromSecretKey(base58.decode(pk));
  return kp.publicKey.toBase58();
});

const allUsedPubKeys = new Set([...bundlePubKeys, ...holderPubKeys]);

console.log('='.repeat(80));
console.log('DEV/Creator Wallet (used for token creation and DEV buy)');
console.log('='.repeat(80));

// Find the DEV wallet - it's in data.json but not in bundle/holder wallets
// Since DEV wallet is created FIRST, it should be one of the last wallets added
// Check from the end backwards
let found = false;
for (let i = allWallets.length - 1; i >= 0; i--) {
  const pk = allWallets[i];
  try {
    const kp = Keypair.fromSecretKey(base58.decode(pk));
    const pubKey = kp.publicKey.toBase58();
    
    if (!allUsedPubKeys.has(pubKey)) {
      console.log('\n✅ Found DEV wallet:');
      console.log(`   Address: ${pubKey}`);
      console.log(`   Private Key: ${pk}`);
      console.log(`   Solscan: https://solscan.io/account/${pubKey}`);
      found = true;
      break;
    }
  } catch (e) {
    // Skip invalid keys
  }
}

if (!found) {
  console.log('\n⚠️  DEV wallet not found in data.json');
  console.log('   It may have been created in a previous launch.');
  console.log('   Check the launch logs for the DEV wallet address.');
}

console.log('\n' + '='.repeat(80));



