# Profit/Loss UI Setup Guide

## Overview

A comprehensive profit/loss tracking UI has been created that shows:
- Token information (name, symbol, image, links)
- Financial data (balance before/after, profit/loss)
- Launch settings used for each run
- Pattern analysis to identify best launch strategies

## Access the UI

### Option 1: Standalone Page

Visit: `http://localhost:3001/profit-loss`

This is a standalone page that shows all profit/loss data with analysis.

### Option 2: Integrate into Control Panel

If you have an existing control panel, you can add a tab that loads this data.

## Features

### 📊 Statistics Dashboard
- Cumulative Profit/Loss (all-time)
- Total Runs
- Successful vs Failed launches
- Average Profit/Loss per run

### 🎯 Launch Records
Each record shows:
- **Token Info**: Name, symbol, image, links (Twitter, Telegram, Website, Pump.fun, Solscan)
- **Financials**: Balance before, balance after, profit/loss
- **Launch Strategy**: 
  - Creator wallet source (warmed/env/auto-created)
  - Used warmed wallets (yes/no)
  - Bundle wallet count
  - Holder wallet count
- **Buy Amounts**:
  - DEV buy amount
  - Bundle amounts (per wallet)
  - Holder wallet amount
  - Total bundle SOL
- **Features**: Which auto-features were enabled

### 🔍 Pattern Analysis

The UI automatically analyzes patterns to help identify best launch strategies:

1. **Warmed vs Fresh Wallets** - Compare performance
2. **Creator Wallet Source** - Warmed vs Env vs Auto-created
3. **DEV Buy Amount Ranges** - Low/Medium/High buy amounts
4. **Bundle Wallet Count** - Few vs Many bundle wallets
5. **Auto Features** - Impact of auto rapid sell, etc.

Each pattern shows:
- Number of launches using that pattern
- Average profit/loss for that pattern
- Helps identify what works best!

## Data Captured

The system automatically captures:

### Wallet Configuration
- `usedWarmedWallets` - Did we use warmed wallets?
- `creatorWalletSource` - Where creator wallet came from
- `bundleWalletCount` - Number of bundle wallets
- `holderWalletCount` - Number of holder wallets

### Buy Amounts
- `devBuyAmount` - Creator wallet buy amount
- `bundleSwapAmounts` - Array of bundle wallet amounts
- `holderWalletAmount` - Holder wallet amount

### Feature Flags
- `autoRapidSell` - Auto rapid sell enabled?
- `autoSell50Percent` - Auto sell 50% enabled?
- `autoSellStaged` - Staged sell enabled?
- `autoGather` - Auto gather enabled?
- `websocketTracking` - WebSocket tracking enabled?
- `websocketUltraFastMode` - Ultra-fast mode enabled?
- `useMixingWallets` - Mixing wallets enabled?
- `useMultiIntermediary` - Multi-intermediary system enabled?

### Token Info
- `tokenImageUrl` - Token image path/URL
- `twitter` - Twitter handle
- `telegram` - Telegram link
- `website` - Website URL
- `description` - Token description

## Example Analysis Questions

The pattern analysis helps answer:

1. **Do warmed wallets perform better?**
   - Compare "Warmed Wallets" vs "Fresh Wallets" patterns

2. **What's the best DEV buy amount?**
   - Compare Low/Medium/High DEV buy patterns

3. **Does creator wallet source matter?**
   - Compare Warmed Creator vs Env Creator vs Auto Creator

4. **How many bundle wallets is optimal?**
   - Compare Low/Medium/High bundle count patterns

5. **Do auto features help?**
   - Compare Auto Rapid Sell ON vs OFF

## API Endpoint

The data is also available via API:

```bash
GET http://localhost:3001/api/profit-loss
```

Returns:
```json
{
  "success": true,
  "data": {
    "records": [...],
    "cumulativeProfitLoss": 5.2,
    "lastUpdated": "2025-01-07T10:35:00.000Z"
  }
}
```

## Auto-Refresh

The UI automatically refreshes every 30 seconds to show latest data.

## Next Steps

1. **Launch tokens** - Tracking starts automatically
2. **View patterns** - After 2+ completed launches, patterns will appear
3. **Optimize** - Use pattern analysis to identify best launch strategies
4. **Iterate** - Try different strategies and compare results

## Tips for Better Analysis

- Launch at least 5-10 tokens to get meaningful pattern data
- Try different strategies (warmed vs fresh, different buy amounts, etc.)
- Compare patterns side-by-side to see what works best
- Focus on patterns with multiple launches (more reliable)

## Future Enhancements

Potential additions:
- Export to CSV
- Filter by date range
- Filter by token
- Chart visualization
- More detailed statistics
- ROI percentage calculations
- Win rate analysis
