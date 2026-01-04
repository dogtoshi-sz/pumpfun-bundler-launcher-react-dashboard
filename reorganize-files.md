# File Reorganization Guide

## ✅ Safe to Reorganize - Here's How

### Files That Cross-Reference (Need Path Updates)

1. **rapid-sell scripts** → `./collect-fees`
   - `rapid-sell.ts`
   - `rapid-sell-remaining.ts`
   - `rapid-sell-50-percent.ts`
   - `rapid-sell-bundled.ts`

2. **Menu scripts** → other root scripts
   - `holder-wallet-menu.ts` → `./trading-terminal`
   - `interactive-menu.ts` → `./volume-maker`, `./gather-last-wallets`
   - `test-wallet-trading.ts` → `./trading-terminal`
   - `run-volume-maker.ts` → `./volume-maker`

3. **API server** → `./trading-terminal`
   - `api-server/call-trading-function.js`

## Proposed Structure

```
scripts/
  ├── gather/
  │   ├── gather.ts
  │   ├── gather-all-wallets.ts
  │   ├── gather-last-wallets.ts
  │   └── gather-sol-only.ts
  │
  ├── sell/
  │   ├── rapid-sell.ts
  │   ├── rapid-sell-holders.ts
  │   ├── rapid-sell-50-percent.ts
  │   ├── rapid-sell-remaining.ts
  │   ├── rapid-sell-staged.ts
  │   └── rapid-sell-bundled.ts
  │
  ├── check/
  │   ├── check-balance.ts
  │   ├── check-bundle-status.ts
  │   ├── check-transactions.ts
  │   └── [all check-*.js files]
  │
  ├── find/
  │   ├── find-creator-wallet.ts
  │   ├── find-dev-wallet.js
  │   └── find-missing-sol.ts
  │
  ├── analyze/
  │   ├── analyze-costs.ts
  │   └── analyze-missing-sol.js
  │
  ├── menu/
  │   ├── menu.ts
  │   ├── master-menu.ts
  │   ├── holder-wallet-menu.ts
  │   └── interactive-menu.ts
  │
  ├── trading/
  │   ├── trading-terminal.ts
  │   ├── trading-terminal-api.js
  │   ├── test-wallet-trading.ts
  │   ├── volume-maker.ts
  │   └── run-volume-maker.ts
  │
  └── utility/
      ├── status.ts
      ├── collect-fees.ts
      ├── closeLut.ts
      ├── oneWalletBundle.ts
      ├── retry-bundle.ts
      ├── start-tracking.ts
      ├── preview-next-address.ts
      ├── generate-pump-addresses.ts
      └── [all .js utility files]
```

## Import Path Updates Needed

### After Moving Files:

1. **rapid-sell scripts** (in `scripts/sell/`):
   ```typescript
   // OLD: import { collectCreatorFees } from "./collect-fees"
   // NEW: import { collectCreatorFees } from "../utility/collect-fees"
   ```

2. **Menu scripts** (in `scripts/menu/`):
   ```typescript
   // OLD: import { buyTokenSimple, sellTokenSimple } from "./trading-terminal"
   // NEW: import { buyTokenSimple, sellTokenSimple } from "../trading/trading-terminal"
   
   // OLD: import { startVolumeMaker } from "./volume-maker"
   // NEW: import { startVolumeMaker } from "../trading/volume-maker"
   
   // OLD: import { gatherLastWallets } from "./gather-last-wallets"
   // NEW: import { gatherLastWallets } from "../gather/gather-last-wallets"
   ```

3. **test-wallet-trading.ts** (in `scripts/trading/`):
   ```typescript
   // OLD: import { ... } from "./trading-terminal"
   // NEW: import { ... } from "./trading-terminal" (same folder, no change)
   ```

4. **run-volume-maker.ts** (in `scripts/trading/`):
   ```typescript
   // OLD: import { startVolumeMaker } from "./volume-maker"
   // NEW: import { startVolumeMaker } from "./volume-maker" (same folder, no change)
   ```

5. **API server** (`api-server/call-trading-function.js`):
   ```javascript
   // OLD: import { ${functionName} } from './trading-terminal'
   // NEW: import { ${functionName} } from '../scripts/trading/trading-terminal'
   ```

## package.json Updates

All scripts need path updates:

```json
{
  "scripts": {
    "start": "ts-node index.ts",
    "single": "ts-node scripts/utility/oneWalletBundle.ts",
    "close": "ts-node scripts/utility/closeLut.ts",
    "gather": "ts-node scripts/gather/gather.ts",
    "gather-sol-only": "ts-node scripts/gather/gather-sol-only.ts",
    "gather-all": "ts-node scripts/gather/gather-all-wallets.ts",
    "gather-last": "ts-node scripts/gather/gather-last-wallets.ts",
    "rapid-sell": "ts-node scripts/sell/rapid-sell.ts",
    "rapid-sell-holders": "ts-node scripts/sell/rapid-sell-holders.ts",
    "rapid-sell-bundled": "ts-node scripts/sell/rapid-sell-bundled.ts",
    "rapid-sell-50-percent": "ts-node scripts/sell/rapid-sell-50-percent.ts",
    "rapid-sell-remaining": "ts-node scripts/sell/rapid-sell-remaining.ts",
    "rapid-sell-staged": "ts-node scripts/sell/rapid-sell-staged.ts",
    "check-bundle": "ts-node scripts/check/check-bundle-status.ts",
    "status": "ts-node scripts/utility/status.ts",
    "check-balance": "ts-node scripts/check/check-balance.ts",
    "volume-maker": "ts-node scripts/trading/run-volume-maker.ts",
    "menu": "ts-node scripts/menu/menu.ts",
    "collect-fees": "ts-node scripts/utility/collect-fees.ts",
    "generate-pump": "ts-node scripts/utility/generate-pump-addresses.ts",
    "track": "ts-node scripts/utility/start-tracking.ts",
    "preview-address": "ts-node scripts/utility/preview-next-address.ts",
    "holder-menu": "ts-node scripts/menu/holder-wallet-menu.ts",
    "master": "ts-node scripts/menu/master-menu.ts",
    "test-wallet": "ts-node scripts/trading/test-wallet-trading.ts",
    "retry-bundle": "ts-node scripts/utility/retry-bundle.ts",
    "find-creator": "ts-node scripts/find/find-creator-wallet.ts"
  }
}
```

## Safety Steps

1. ✅ **Test current setup** - Make sure everything works before moving
2. ✅ **Create backup** - Commit current state to git
3. ✅ **Move files** - Create folders and move files
4. ✅ **Update imports** - Fix all relative import paths
5. ✅ **Update package.json** - Fix all npm script paths
6. ✅ **Test all scripts** - Run each npm script to verify
7. ✅ **Commit changes** - Save organized structure

## Will It Break?

**NO** - As long as we:
- ✅ Update all import paths
- ✅ Update package.json scripts
- ✅ Keep `index.ts` in root
- ✅ Keep `.env` in root
- ✅ Test each script after moving

The bot will work perfectly! All imports use relative paths, so updating them is straightforward.



