# File Organization Plan

## Safe Reorganization Structure

### Keep in Root (Critical Files)
- `index.ts` - Main entry point
- `package.json` - NPM scripts
- `.env` - Environment variables
- `tsconfig.json`, `tsconfig.base.json`, `tsconfig.ts-node.json` - TypeScript configs
- `.gitignore` - Git ignore rules
- `CONTROL-PANEL-GUIDE.md` - Documentation

### Proposed Folder Structure

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
  │   ├── check-balances.js
  │   ├── check-each-wallet.js
  │   ├── check-lut-rent.js
  │   ├── check-lut-simple.js
  │   ├── check-wallets.js
  │   └── check-wallets-simple.js
  │
  ├── find/
  │   ├── find-creator-wallet.ts
  │   ├── find-dev-wallet.js
  │   ├── find-missing-sol.ts
  │   └── find-missing-sol.js
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
  │   └── volume-maker.ts
  │
  ├── utility/
  │   ├── status.ts
  │   ├── collect-fees.ts
  │   ├── closeLut.ts
  │   ├── oneWalletBundle.ts
  │   ├── retry-bundle.ts
  │   ├── start-tracking.ts
  │   ├── preview-next-address.ts
  │   ├── generate-pump-addresses.ts
  │   ├── run-volume-maker.ts
  │   ├── show-keys.js
  │   ├── get-addresses.js
  │   ├── list-wallet-addresses.js
  │   └── manual-gather.js
```

## What Needs to be Updated

1. **package.json** - Update all script paths
2. **Import statements** - Check for any cross-references between moved files
3. **API server** - Check if it references any moved files

## Safety Checklist

- ✅ Keep `index.ts` in root (main entry point)
- ✅ Keep `package.json` in root (npm scripts)
- ✅ Keep `.env` in root (environment variables)
- ✅ Update all `package.json` script paths
- ✅ Check for relative imports between moved files
- ✅ Test all npm scripts after moving



