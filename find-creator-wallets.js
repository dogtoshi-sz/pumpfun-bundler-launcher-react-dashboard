// Find all auto-created creator wallets from backups and data.json
const fs = require('fs');
const path = require('path');
const bs58 = require('bs58').default || require('bs58');
const { Keypair } = require('@solana/web3.js');

const keysDir = path.join(__dirname, 'keys');

console.log('🔍 Finding all auto-created creator wallets...\n');

// 1. Check current-run.json backups
const backupFiles = fs.readdirSync(keysDir)
  .filter(f => f.startsWith('current-run-backup-') && f.endsWith('.json'))
  .sort()
  .reverse(); // Most recent first

console.log('📦 Creator wallets from current-run.json backups:');
const creatorWallets = new Set();

backupFiles.forEach(file => {
  try {
    const backupPath = path.join(keysDir, file);
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    if (backup.creatorDevWalletKey) {
      const kp = Keypair.fromSecretKey(bs58.decode(backup.creatorDevWalletKey));
      const address = kp.publicKey.toBase58();
      creatorWallets.add(backup.creatorDevWalletKey);
      console.log(`   ${address} (from ${file})`);
    }
  } catch (e) {
    // Skip invalid files
  }
});

// 2. Check data.json - creator wallet is usually the first one created
console.log('\n📦 Checking data.json for creator wallets:');
try {
  const dataPath = path.join(keysDir, 'data.json');
  if (fs.existsSync(dataPath)) {
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    if (Array.isArray(data) && data.length > 0) {
      // First wallet in data.json is often the creator wallet
      const firstKey = data[0];
      const kp = Keypair.fromSecretKey(bs58.decode(firstKey));
      console.log(`   First wallet: ${kp.publicKey.toBase58()}`);
      
      // Also check if any match the backups
      data.forEach((key, idx) => {
        if (creatorWallets.has(key)) {
          const kp = Keypair.fromSecretKey(bs58.decode(key));
          console.log(`   ✅ Match found at index ${idx}: ${kp.publicKey.toBase58()}`);
        }
      });
    }
  }
} catch (e) {
  console.error('Error reading data.json:', e.message);
}

// 3. Check current-run.json if it exists
console.log('\n📦 Checking current current-run.json:');
try {
  const currentRunPath = path.join(keysDir, 'current-run.json');
  if (fs.existsSync(currentRunPath)) {
    const currentRun = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
    if (currentRun.creatorDevWalletKey) {
      const kp = Keypair.fromSecretKey(bs58.decode(currentRun.creatorDevWalletKey));
      console.log(`   ${kp.publicKey.toBase58()}`);
    }
  } else {
    console.log('   No current-run.json found');
  }
} catch (e) {
  console.error('Error reading current-run.json:', e.message);
}

console.log('\n✅ Done! Creator wallets are saved in:');
console.log('   1. keys/data.json (as part of wallet array)');
console.log('   2. keys/current-run.json (as creatorDevWalletKey field)');
console.log('   3. keys/current-run-backup-*.json (backups)');

