# Multi-User Config System

This directory contains the infrastructure for storing environment variables per user (wallet public key) in PostgreSQL.

## Overview

The system allows multiple users to connect their wallets and have their own isolated configuration stored in the database, while maintaining backward compatibility with the existing `.env` file approach.

## Files

- **`user-config-context.ts`** - Context management layer that provides user-scoped config access
- **`user-config-service.ts`** - Database operations for storing/retrieving user configs
- **`../migrations/001_create_user_configs_table.sql`** - Database migration script

## Setup

### 1. Run Database Migration

```bash
# Connect to your PostgreSQL database and run:
psql -d your_database -f migrations/001_create_user_configs_table.sql

# Or use your preferred database client
```

### 2. Ensure DATABASE_URL is Set

Make sure `DATABASE_URL` is set in your `.env` file:

```env
DATABASE_URL=postgresql://user:password@host:port/database
```

## Usage (After Refactoring)

### Setting User Context

```typescript
import { setUserContext, getUserConfig } from './lib/user-config-context';

// When a user connects their wallet
await setUserContext('WalletPublicKey...');

// Now all config reads will use this user's config
const privateKey = getUserConfig('PRIVATE_KEY');
```

### Saving User Config

```typescript
import { saveUserConfig, saveUserConfigs } from './lib/user-config-context';

// Save a single value
await saveUserConfig('TOKEN_NAME', 'My Token');

// Save multiple values
await saveUserConfigs({
  TOKEN_NAME: 'My Token',
  TOKEN_SYMBOL: 'MTK',
  SWAP_AMOUNT: '1.0'
});
```

### Direct Database Access

```typescript
import { getUserConfigFromDB, saveUserConfigToDB } from './lib/user-config-service';

// Get config directly from DB
const config = await getUserConfigFromDB('WalletPublicKey...');

// Save config directly to DB
await saveUserConfigToDB('WalletPublicKey...', {
  TOKEN_NAME: 'My Token'
});
```

## Migration from .env

To migrate an existing `.env` file to a user config:

```typescript
import { migrateEnvToUserConfig } from './lib/user-config-service';

// Migrate .env to a specific wallet
await migrateEnvToUserConfig('WalletPublicKey...', '.env');
```

## Architecture

```
┌─────────────────────────────────────────┐
│         Application Code                │
│  (index.ts, api-server, etc.)          │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│    user-config-context.ts               │
│  - setUserContext()                     │
│  - getUserConfig()                      │
│  - saveUserConfig()                     │
│  (Context + Cache Layer)                │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│    user-config-service.ts               │
│  - getUserConfigFromDB()                │
│  - saveUserConfigToDB()                 │
│  (Database Operations)                  │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│         PostgreSQL Database             │
│    user_configs table                   │
└─────────────────────────────────────────┘
```

## Backward Compatibility

The system maintains full backward compatibility:

1. **If no user context is set**: Falls back to `process.env` (existing `.env` file)
2. **If user config doesn't exist**: Falls back to `process.env`
3. **If database is unavailable**: Falls back to `process.env`

This means existing code continues to work without changes until you're ready to refactor.

## Security Considerations

- **Private Keys**: Currently stored as plain text in JSONB. Consider adding encryption for production.
- **Database Access**: Ensure `DATABASE_URL` is properly secured and not exposed.
- **Wallet Verification**: Always verify wallet signatures before allowing config access.

## Next Steps

1. ✅ Database migration created
2. ✅ Config service created
3. ⏳ Refactor `constants/constants.ts` to use `getUserConfig()`
4. ⏳ Update API server to set user context on wallet connection
5. ⏳ Update `index.ts` to support user context
6. ⏳ Add wallet signature verification

## Testing

After refactoring, test with:

```typescript
// Test 1: No context (should use .env)
const value1 = getUserConfig('TOKEN_NAME'); // Uses process.env

// Test 2: With context (should use DB)
await setUserContext('TestWallet...');
const value2 = getUserConfig('TOKEN_NAME'); // Uses DB

// Test 3: Save and retrieve
await saveUserConfig('TOKEN_NAME', 'Test Token');
const value3 = getUserConfig('TOKEN_NAME'); // Should be 'Test Token'
```
