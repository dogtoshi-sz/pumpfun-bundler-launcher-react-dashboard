/**
 * Clean Old Wallet Files (DELETE - Use with caution!)
 * 
 * DELETES old wallet files (mixing-wallets, intermediary-wallets, current-run)
 * while keeping warmed wallets intact.
 * 
 * ⚠️ WARNING: This permanently deletes files. Make sure you've archived them first!
 * 
 * Usage: ts-node scripts/clean-old-wallets.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const keysDir = path.join(process.cwd(), 'keys');

// Files to delete (old wallets and run data that get recycled)
const filesToDelete = [
  'mixing-wallets.json',
  'intermediary-wallets.json',
  'current-run.json',
  'lut.json',        // Lookup Table addresses from previous runs
  'mint.json',       // Mint private keys from previous token launches
];

// Files to keep (warmed wallets are different - they're pre-warmed and reusable)
const filesToKeep = [
  'warmed-wallets.json',
  'warmed-wallets-for-launch.json',
];

function cleanOldWallets() {
  console.log(`\n🧹 Cleaning old wallet files...\n`);
  console.log(`⚠️  WARNING: This will DELETE the following files:`);
  filesToDelete.forEach(f => console.log(`   - ${f}`));
  console.log(`\n✅ The following files will be KEPT:`);
  filesToKeep.forEach(f => console.log(`   - ${f}`));
  console.log(`\n`);

  let deletedCount = 0;
  let skippedCount = 0;

  // Delete old wallet files
  for (const filename of filesToDelete) {
    const filePath = path.join(keysDir, filename);

    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log(`✅ Deleted: ${filename}`);
        deletedCount++;
      } catch (error) {
        console.error(`❌ Failed to delete ${filename}:`, error);
      }
    } else {
      console.log(`⏭️  Skipped (not found): ${filename}`);
      skippedCount++;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Deleted: ${deletedCount} files`);
  console.log(`   ⏭️  Skipped: ${skippedCount} files`);
  console.log(`\n💡 Note: Warmed wallets were kept intact.`);
  console.log(`   You can now start fresh runs without old wallet data.\n`);
}

// Run the cleaning
try {
  cleanOldWallets();
} catch (error) {
  console.error('❌ Error cleaning wallets:', error);
  process.exit(1);
}
