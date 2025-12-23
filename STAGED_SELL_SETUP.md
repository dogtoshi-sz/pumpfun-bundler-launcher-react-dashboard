# Staged Sell Setup Guide

## How Rounding Works

The staged sell uses `Math.ceil()` which **rounds UP** to ensure you always sell at least the configured percentage:

**Examples:**
- 30% of 7 wallets = 2.1 → **sells 3 wallets** (rounds up)
- 30% of 10 wallets = 3.0 → **sells 3 wallets**
- 30% of 11 wallets = 3.3 → **sells 4 wallets** (rounds up)

This ensures you never sell less than your configured percentage, even with odd wallet counts.

## Required .env Configuration

### ✅ MUST BE ENABLED:
```env
# Enable staged sell
AUTO_SELL_STAGED="true"

# WebSocket tracking is REQUIRED for staged sell
WEBSOCKET_TRACKING_ENABLED=true

# Ultra-fast mode recommended for best performance
WEBSOCKET_ULTRA_FAST_MODE=true
```

### ❌ MUST BE DISABLED (to avoid conflicts):
```env
# These are mutually exclusive - only ONE can be enabled at a time
AUTO_RAPID_SELL="false"        # Disable - conflicts with staged sell
AUTO_SELL_50_PERCENT="false"   # Disable - conflicts with staged sell
```

### ⚙️ Staged Sell Configuration:
```env
# Stage 1: Sell X% of biggest wallets at Y SOL volume
STAGED_SELL_STAGE1_THRESHOLD=5      # SOL volume to trigger stage 1
STAGED_SELL_STAGE1_PERCENTAGE=30    # Percentage of wallets to sell

# Stage 2: Sell X% of next biggest wallets at Y SOL volume
STAGED_SELL_STAGE2_THRESHOLD=10     # SOL volume to trigger stage 2
STAGED_SELL_STAGE2_PERCENTAGE=30    # Percentage of wallets to sell

# Stage 3: Sell remaining X% + DEV wallet at Y SOL volume
STAGED_SELL_STAGE3_THRESHOLD=20     # SOL volume to trigger stage 3
STAGED_SELL_STAGE3_PERCENTAGE=40    # Percentage of remaining wallets (DEV always included)
```

## Complete Example Configuration

```env
# ============================================
# STAGED SELL CONFIGURATION
# ============================================

# Enable staged sell (MUST be true)
AUTO_SELL_STAGED="true"

# Disable other auto-sell methods (MUST be false)
AUTO_RAPID_SELL="false"
AUTO_SELL_50_PERCENT="false"

# WebSocket tracking (REQUIRED - must be true)
WEBSOCKET_TRACKING_ENABLED=true
WEBSOCKET_ULTRA_FAST_MODE=true

# Staged sell thresholds and percentages
STAGED_SELL_STAGE1_THRESHOLD=5
STAGED_SELL_STAGE1_PERCENTAGE=30
STAGED_SELL_STAGE2_THRESHOLD=10
STAGED_SELL_STAGE2_PERCENTAGE=30
STAGED_SELL_STAGE3_THRESHOLD=20
STAGED_SELL_STAGE3_PERCENTAGE=40

# WebSocket aggregation window (how long to track cumulative volume)
WEBSOCKET_EXTERNAL_BUY_WINDOW=60  # 60 seconds
```

## How It Works

1. **Stage 1**: When cumulative external buys reach `STAGED_SELL_STAGE1_THRESHOLD` SOL, sells `STAGED_SELL_STAGE1_PERCENTAGE%` of the **biggest wallets** (sorted by buy amount).

2. **Stage 2**: When cumulative external buys reach `STAGED_SELL_STAGE2_THRESHOLD` SOL, sells `STAGED_SELL_STAGE2_PERCENTAGE%` of the **next biggest wallets** (after stage 1).

3. **Stage 3**: When cumulative external buys reach `STAGED_SELL_STAGE3_THRESHOLD` SOL, sells the **remaining wallets** + **DEV wallet** (DEV always sells LAST in stage 3).

## Priority System

The code checks in this order (first match wins):
1. `AUTO_SELL_STAGED` (highest priority)
2. `AUTO_SELL_50_PERCENT`
3. `AUTO_RAPID_SELL` (lowest priority)

If `AUTO_SELL_STAGED=true`, the other two are automatically ignored.

## Verification

When you run `npm start`, you should see:
```
📋 CONFIGURATION VALUES FROM .ENV:
   AUTO_SELL_STAGED: true
   AUTO_RAPID_SELL: false
   AUTO_SELL_50_PERCENT: false
   WEBSOCKET_TRACKING_ENABLED: true
   WEBSOCKET_ULTRA_FAST_MODE: true

🌐🌐🌐 STARTING WEBSOCKET TRACKING... 🌐🌐🌐
   Auto-Sell: STAGED SELL
     Stage 1: 30% at 5 SOL
     Stage 2: 30% at 10 SOL
     Stage 3: 40% + DEV at 20 SOL
```

## Customization Examples

### Aggressive Early Exit (sell more, faster):
```env
STAGED_SELL_STAGE1_THRESHOLD=2
STAGED_SELL_STAGE1_PERCENTAGE=50
STAGED_SELL_STAGE2_THRESHOLD=5
STAGED_SELL_STAGE2_PERCENTAGE=30
STAGED_SELL_STAGE3_THRESHOLD=10
STAGED_SELL_STAGE3_PERCENTAGE=20
```

### Conservative (hold longer, sell gradually):
```env
STAGED_SELL_STAGE1_THRESHOLD=10
STAGED_SELL_STAGE1_PERCENTAGE=20
STAGED_SELL_STAGE2_THRESHOLD=20
STAGED_SELL_STAGE2_PERCENTAGE=30
STAGED_SELL_STAGE3_THRESHOLD=50
STAGED_SELL_STAGE3_PERCENTAGE=50
```

