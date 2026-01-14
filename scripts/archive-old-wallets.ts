/**
 * Archive Old Wallet Files
 * 
 * Archives old wallet files (mixing-wallets, intermediary-wallets, current-run)
 * while keeping warmed wallets intact.
 * 
 * Usage: ts-node scripts/archive-old-wallets.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const keysDir = path.join(process.cwd(), 'keys');
const archiveDir = path.join(keysDir, 'archive');

// Files to archive (old wallets and run data that get recycled)
const filesToArchive = [
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

function archiveOldWallets() {
  // Create archive directory if it doesn't exist
  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
    console.log(`✅ Created archive directory: ${archiveDir}`);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const archiveSubDir = path.join(archiveDir, `archive-${timestamp}`);
  fs.mkdirSync(archiveSubDir, { recursive: true });

  console.log(`\n📦 Archiving old wallet files to: ${archiveSubDir}\n`);

  let archivedCount = 0;
  let skippedCount = 0;

  // Archive old wallet files
  for (const filename of filesToArchive) {
    const sourcePath = path.join(keysDir, filename);
    const destPath = path.join(archiveSubDir, filename);

    if (fs.existsSync(sourcePath)) {
      try {
        fs.copyFileSync(sourcePath, destPath);
        console.log(`✅ Archived: ${filename}`);
        archivedCount++;
      } catch (error) {
        console.error(`❌ Failed to archive ${filename}:`, error);
      }
    } else {
      console.log(`⏭️  Skipped (not found): ${filename}`);
      skippedCount++;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Archived: ${archivedCount} files`);
  console.log(`   ⏭️  Skipped: ${skippedCount} files`);
  console.log(`   📁 Archive location: ${archiveSubDir}`);
  console.log(`\n💡 Note: Warmed wallets (${filesToKeep.join(', ')}) were kept intact.`);
  console.log(`   You can now start fresh runs without old wallet data.\n`);
}

// Run the archiving
try {
  archiveOldWallets();
} catch (error) {
  console.error('❌ Error archiving wallets:', error);
  process.exit(1);
}
