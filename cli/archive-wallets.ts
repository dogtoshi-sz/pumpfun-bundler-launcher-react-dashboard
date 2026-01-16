import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';

config({ path: join(__dirname, '.env') });

const keysDir = join(__dirname, '..', 'keys');
const archiveDir = join(__dirname, '..', 'keys', 'archive');

// Files that are ACTIVELY USED - DO NOT ARCHIVE
const ACTIVE_FILES = [
  'data.json',
  'current-run.json',
  'warmed-wallets.json',
  'intermediary-wallets.json',
  'mixing-wallets.json',
  'mint.json',
  'lut.json',
  'pump-addresses.json',
  'warmup-tokens.json',
  '.jito-cooldown.json',
];

// Files that are NEVER USED - Safe to archive immediately
const UNUSED_FILES = [
  'creator-wallets.json',  // Confirmed not used
  'data-history1.json',   // Old history
  'data-history2.json',   // Old history
  'sold-wallets.json',    // Old sold wallets
  'all-private-keys.txt', // Text file backup
];

// Pattern for backup files
const BACKUP_PATTERN = /^current-run-backup-\d+\.json$/;

interface ArchiveStats {
  archived: number;
  skipped: number;
  errors: number;
  totalSize: number;
}

function createArchiveDirectory() {
  if (!existsSync(archiveDir)) {
    mkdirSync(archiveDir, { recursive: true });
    console.log(`✅ Created archive directory: ${archiveDir}`);
  }
}

function getFileAge(filePath: string): number {
  const stats = statSync(filePath);
  return Date.now() - stats.mtimeMs;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function formatAge(ms: number): string {
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h`;
}

async function archiveFiles(options: {
  archiveUnused: boolean;
  archiveBackups: boolean;
  archiveBackupsOlderThanDays: number;
  dryRun: boolean;
}): Promise<ArchiveStats> {
  const stats: ArchiveStats = {
    archived: 0,
    skipped: 0,
    errors: 0,
    totalSize: 0,
  };

  if (!existsSync(keysDir)) {
    console.error(`❌ Keys directory not found: ${keysDir}`);
    return stats;
  }

  createArchiveDirectory();

  const files = readdirSync(keysDir);
  const now = Date.now();

  // Create dated archive subdirectory
  const dateStr = new Date().toISOString().split('T')[0];
  const datedArchiveDir = join(archiveDir, dateStr);
  if (!options.dryRun && !existsSync(datedArchiveDir)) {
    mkdirSync(datedArchiveDir, { recursive: true });
  }

  console.log(`\n📦 Archiving files...`);
  console.log(`   Archive directory: ${datedArchiveDir}`);
  console.log(`   Mode: ${options.dryRun ? 'DRY RUN (no files will be moved)' : 'LIVE'}\n`);

  for (const file of files) {
    const filePath = join(keysDir, file);
    const fileStats = statSync(filePath);
    const fileSize = fileStats.size;
    const age = getFileAge(filePath);

    // Skip directories
    if (fileStats.isDirectory()) {
      continue;
    }

    // Skip active files
    if (ACTIVE_FILES.includes(file)) {
      console.log(`⏭️  SKIP (active): ${file} (${formatFileSize(fileSize)})`);
      stats.skipped++;
      continue;
    }

    // Archive unused files
    if (options.archiveUnused && UNUSED_FILES.includes(file)) {
      const archivePath = join(datedArchiveDir, file);
      console.log(`📦 ARCHIVE (unused): ${file} (${formatFileSize(fileSize)}, age: ${formatAge(age)})`);
      
      if (!options.dryRun) {
        try {
          const content = readFileSync(filePath);
          writeFileSync(archivePath, content);
          // Note: We'll delete after confirming archive worked
          stats.archived++;
          stats.totalSize += fileSize;
        } catch (error: any) {
          console.error(`   ❌ Error archiving ${file}: ${error.message}`);
          stats.errors++;
        }
      } else {
        stats.archived++;
        stats.totalSize += fileSize;
      }
      continue;
    }

    // Archive backup files
    if (options.archiveBackups && BACKUP_PATTERN.test(file)) {
      const ageDays = age / (1000 * 60 * 60 * 24);
      
      if (ageDays >= options.archiveBackupsOlderThanDays) {
        const archivePath = join(datedArchiveDir, file);
        console.log(`📦 ARCHIVE (backup): ${file} (${formatFileSize(fileSize)}, age: ${formatAge(age)})`);
        
        if (!options.dryRun) {
          try {
            const content = readFileSync(filePath);
            writeFileSync(archivePath, content);
            stats.archived++;
            stats.totalSize += fileSize;
          } catch (error: any) {
            console.error(`   ❌ Error archiving ${file}: ${error.message}`);
            stats.errors++;
          }
        } else {
          stats.archived++;
          stats.totalSize += fileSize;
        }
        continue;
      } else {
        console.log(`⏭️  SKIP (too recent): ${file} (age: ${formatAge(age)})`);
        stats.skipped++;
        continue;
      }
    }

    // Unknown file - skip
    console.log(`❓ UNKNOWN: ${file} (${formatFileSize(fileSize)}) - not archived`);
    stats.skipped++;
  }

  // Delete archived files after successful archive
  if (!options.dryRun && stats.archived > 0) {
    console.log(`\n🗑️  Removing archived files from keys directory...`);
    for (const file of files) {
      if (UNUSED_FILES.includes(file) && options.archiveUnused) {
        try {
          const filePath = join(keysDir, file);
          if (existsSync(filePath)) {
            require('fs').unlinkSync(filePath);
            console.log(`   ✅ Deleted: ${file}`);
          }
        } catch (error: any) {
          console.error(`   ❌ Error deleting ${file}: ${error.message}`);
        }
      }
      if (BACKUP_PATTERN.test(file) && options.archiveBackups) {
        const filePath = join(keysDir, file);
        const age = getFileAge(filePath);
        const ageDays = age / (1000 * 60 * 60 * 24);
        if (ageDays >= options.archiveBackupsOlderThanDays) {
          try {
            if (existsSync(filePath)) {
              require('fs').unlinkSync(filePath);
              console.log(`   ✅ Deleted: ${file}`);
            }
          } catch (error: any) {
            console.error(`   ❌ Error deleting ${file}: ${error.message}`);
          }
        }
      }
    }
  }

  return stats;
}

function showSummary() {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 WALLET FILE STATUS`);
  console.log(`${'='.repeat(80)}\n`);

  console.log(`✅ ACTIVE FILES (never archived):`);
  ACTIVE_FILES.forEach(file => {
    const filePath = join(keysDir, file);
    if (existsSync(filePath)) {
      const stats = statSync(filePath);
      const age = getFileAge(filePath);
      console.log(`   • ${file} (${formatFileSize(stats.size)}, modified ${formatAge(age)} ago)`);
    } else {
      console.log(`   • ${file} (not found)`);
    }
  });

  console.log(`\n🗄️  UNUSED FILES (safe to archive):`);
  UNUSED_FILES.forEach(file => {
    const filePath = join(keysDir, file);
    if (existsSync(filePath)) {
      const stats = statSync(filePath);
      const age = getFileAge(filePath);
      console.log(`   • ${file} (${formatFileSize(stats.size)}, age: ${formatAge(age)})`);
    }
  });

  // Count backup files
  if (existsSync(keysDir)) {
    const files = readdirSync(keysDir);
    const backups = files.filter(f => BACKUP_PATTERN.test(f));
    if (backups.length > 0) {
      console.log(`\n📦 BACKUP FILES (${backups.length} found):`);
      backups.slice(0, 5).forEach(file => {
        const filePath = join(keysDir, file);
        const stats = statSync(filePath);
        const age = getFileAge(filePath);
        console.log(`   • ${file} (${formatFileSize(stats.size)}, age: ${formatAge(age)})`);
      });
      if (backups.length > 5) {
        console.log(`   ... and ${backups.length - 5} more`);
      }
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-d');
  const archiveUnused = !args.includes('--skip-unused');
  const archiveBackups = !args.includes('--skip-backups');
  const olderThanDays = parseInt(args.find(arg => arg.startsWith('--older-than='))?.split('=')[1] || '7');

  console.log(`\n${'='.repeat(80)}`);
  console.log(`🗄️  WALLET ARCHIVE UTILITY`);
  console.log(`${'='.repeat(80)}`);

  showSummary();

  if (dryRun) {
    console.log(`\n⚠️  DRY RUN MODE - No files will be moved or deleted\n`);
  }

  const stats = await archiveFiles({
    archiveUnused,
    archiveBackups,
    archiveBackupsOlderThanDays: olderThanDays,
    dryRun,
  });

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 ARCHIVE SUMMARY`);
  console.log(`${'='.repeat(80)}`);
  console.log(`   ✅ Archived: ${stats.archived} files`);
  console.log(`   ⏭️  Skipped: ${stats.skipped} files`);
  console.log(`   ❌ Errors: ${stats.errors} files`);
  console.log(`   💾 Total Size: ${formatFileSize(stats.totalSize)}`);
  console.log(`\n   Archive location: ${join(archiveDir, new Date().toISOString().split('T')[0])}`);
  console.log();
}

main().catch(console.error);
