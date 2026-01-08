# Wallet Files Reference

## 📁 Active Files (DO NOT ARCHIVE)

These files are actively used by the system:

| File | Purpose | Used By |
|------|---------|---------|
| `data.json` | Bundle wallets (main wallet pool) | `gather-all-wallets.ts`, `index.ts` |
| `current-run.json` | Current active run data (creator/dev, bundle, holder wallets) | `gather-all-wallets.ts`, `index.ts`, `recovery-center.ts` |
| `warmed-wallets.json` | Pre-warmed wallets for launches | `gather-all-wallets.ts`, `gather-warmed-wallets.ts`, `recovery-center.ts` |
| `intermediary-wallets.json` | Intermediary wallets (hop1, hop2, hop3) | `gather-intermediary-funds.ts`, `recovery-center.ts`, drain scripts |
| `mixing-wallets.json` | Mixing wallets for fund distribution | `drain-mixing-wallets.ts` |
| `mint.json` | Mint keypair | `index.ts` |
| `lut.json` | Lookup Table data | Various scripts |
| `pump-addresses.json` | Pump addresses | Various scripts |
| `warmup-tokens.json` | Warmup token data | Various scripts |
| `.jito-cooldown.json` | Jito cooldown tracking | Jito executor |

## 🗄️ Unused Files (Safe to Archive)

These files are **NOT** actively used and can be archived:

| File | Status | Notes |
|------|--------|-------|
| `creator-wallets.json` | ❌ Not Used | Confirmed not referenced in codebase |
| `data-history1.json` | ❌ Old Backup | Historical backup of data.json |
| `data-history2.json` | ❌ Old Backup | Historical backup of data.json |
| `sold-wallets.json` | ❌ Old Data | Old sold wallet records |
| `all-private-keys.txt` | ❌ Backup | Text file backup (not JSON) |

## 📦 Backup Files (Archive After 7 Days)

| Pattern | Count | Action |
|---------|-------|--------|
| `current-run-backup-*.json` | 27+ files | Archive backups older than 7 days |

## 🛠️ Archive Utility

Use the archive utility to clean up old files:

```bash
# Preview what will be archived (dry run)
npm run archive-dry

# Archive unused files and backups older than 7 days
npm run archive

# Archive with custom age threshold (e.g., 3 days)
npm run archive -- --older-than=3

# Skip archiving unused files
npm run archive -- --skip-unused

# Skip archiving backup files
npm run archive -- --skip-backups
```

### Archive Behavior

- **Unused files**: Archived immediately (if `--skip-unused` not specified)
- **Backup files**: Archived if older than specified days (default: 7 days)
- **Active files**: Never archived
- **Archive location**: `keys/archive/YYYY-MM-DD/`

### Recovery

Archived files are moved to `keys/archive/YYYY-MM-DD/` and can be restored if needed.

## 🔍 Recovery Center

The recovery center (`npm run recovery`) scans these active files:
- ✅ `data.json` (DATA wallets)
- ✅ `intermediary-wallets.json` (Intermediary wallets)
- ✅ `warmed-wallets.json` (Warmed wallets)
- ✅ `current-run.json` (Current run wallets)
- ❌ `creator-wallets.json` (NOT scanned - unused)

## 📝 Notes

- Archive regularly to keep the keys directory clean
- Backup files are created automatically during runs
- Old backup files accumulate over time - archive them periodically
- The recovery center only scans active wallet files
