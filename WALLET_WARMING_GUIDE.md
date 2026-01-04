# Wallet Warming Guide

This guide explains how to use the wallet warming system to create trading history for your Holder/Bundle wallets.

## Why Warm Wallets?

Warming wallets creates trading history that makes them look more legitimate and less like bot wallets. This can help with:
- Avoiding detection by anti-bot systems
- Building wallet reputation
- Making wallets appear more natural

## Setup

### 1. Add Token List

Create or edit `keys/warmup-tokens.json` with pump.fun token addresses:

```json
{
  "tokens": [
    "TokenMintAddress1",
    "TokenMintAddress2",
    "TokenMintAddress3"
  ]
}
```

**How to get token addresses:**
- Use DexScreener: Filter by "pump.fun" and copy mint addresses
- Use Birdeye API: Query trending pump.fun tokens
- Manually add known active tokens

### 2. Prepare Wallets

The script will automatically load wallets from `keys/data.json`. Make sure your wallets have:
- Enough SOL for trades (recommended: 0.5-1 SOL per wallet)
- Formula: `(maxBuyAmount * 2) * tradesPerWallet + 0.1 SOL buffer`

Example for 10 trades at 0.05 SOL max:
- `(0.05 * 2) * 10 + 0.1 = 1.1 SOL` per wallet

## Usage

### Basic Usage

```bash
npm run warm-wallets
```

This will:
- Load wallets from `keys/data.json`
- Load tokens from `keys/warmup-tokens.json`
- Process 3 wallets at a time (configurable)
- Do 10 trades per wallet (configurable)
- Use random intervals between trades (30s - 5min)

### Custom Wallets

```bash
npm run warm-wallets -- --wallets "privateKey1,privateKey2,privateKey3"
```

### Configuration via Environment Variables

Add to your `.env` file:

```env
# Number of wallets to process in parallel (default: 3)
WARM_WALLETS_PER_BATCH=3

# Number of trades per wallet (default: 10)
WARM_TRADES_PER_WALLET=10

# Minimum buy amount in SOL (default: 0.01)
WARM_MIN_BUY=0.01

# Maximum buy amount in SOL (default: 0.05)
WARM_MAX_BUY=0.05

# Minimum interval between trades in seconds (default: 30)
WARM_MIN_INTERVAL=30

# Maximum interval between trades in seconds (default: 300 = 5 minutes)
WARM_MAX_INTERVAL=300

# Priority fee level: 'low', 'medium', or 'high' (default: 'low')
WARM_PRIORITY_FEE=low

# Use Jupiter swap (default: true, set to 'false' to disable)
WARM_USE_JUPITER=true
```

## How It Works

1. **Loads wallets** from `keys/data.json` (or provided via CLI)
2. **Loads tokens** from `keys/warmup-tokens.json`
3. **For each wallet:**
   - Picks a random token from the list
   - Buys a random amount (between min/max)
   - Waits 5-30 seconds
   - Sells 80-100% of tokens
   - Waits random interval (30s - 5min) before next trade
4. **Processes in batches** to avoid rate limits
5. **Tracks progress** and shows summary at the end

## Example Output

```
🔥🔥🔥 WALLET WARMING STARTED 🔥🔥🔥
📊 Configuration:
   Wallets: 5
   Trades per wallet: 10
   Buy amount: 0.01-0.05 SOL
   Interval: 30-300s
   Priority fee: low
   Tokens available: 20
   Parallel wallets: 3

📦 Processing batch 1/2

🔥 Warming wallet: ABC12345...XYZ67890
   💰 Balance: 1.2000 SOL (estimated need: 1.1000 SOL)
   📊 Target: 10 trades
   [1/10] Buying 0.0324 SOL of token DEF45678...
   ✅ Buy successful: https://solscan.io/tx/...
   ⏳ Waiting 12.3s before selling...
   💸 Selling 87.5% of tokens...
   ✅ Sell successful: https://solscan.io/tx/...
   ⏸️  Waiting 145.2s before next trade...
   ...
```

## Tips

1. **Start Small**: Test with 1-2 wallets and 3-5 trades first
2. **Monitor Costs**: Each trade costs ~0.0001-0.0005 SOL in fees
3. **Token Selection**: Use active, liquid tokens to avoid slippage
4. **Timing**: Run during active market hours for more natural patterns
5. **Balance**: Keep extra SOL in wallets for unexpected fees

## Troubleshooting

### "No tokens available"
- Make sure `keys/warmup-tokens.json` exists and has valid token addresses
- Check that token addresses are correct Solana mint addresses

### "Insufficient balance"
- Add more SOL to wallets
- Reduce `WARM_MAX_BUY` or `WARM_TRADES_PER_WALLET`

### "Transaction failed"
- Check RPC endpoint is working
- Verify tokens are still active/liquid
- Try increasing `WARM_PRIORITY_FEE` to 'medium' or 'high'

### Rate Limits
- Reduce `WARM_WALLETS_PER_BATCH` (e.g., to 1 or 2)
- Increase intervals between trades

## Cost Estimation

For 10 trades per wallet at 0.05 SOL max:
- Buy costs: 10 × 0.05 = 0.5 SOL
- Sell costs: ~0.5 SOL (slight slippage expected)
- Fees: 10 × 0.0001 = 0.001 SOL (low priority)
- **Total per wallet: ~1.0 SOL**

## Best Practices

1. **Diversify tokens**: Use 10-20 different tokens in your list
2. **Vary amounts**: Random buy amounts look more natural
3. **Random intervals**: Don't use fixed intervals
4. **Mix success/failure**: Some failed trades are normal
5. **Run periodically**: Warm wallets over days/weeks, not all at once

## Integration with Launch System

After warming wallets, they'll have trading history and can be used in your normal launch flow. The warmed wallets will be in `keys/data.json` and can be used as:
- Holder wallets (for holder count)
- Bundle wallets (for Jito bundling)

The warming process doesn't affect wallet eligibility for launches - it just adds history.

