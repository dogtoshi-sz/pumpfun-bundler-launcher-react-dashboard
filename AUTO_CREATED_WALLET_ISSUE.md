# Auto-Created DEV Wallet Bundle Failure Analysis

## The Problem

When `BUYER_WALLET` is **empty** (auto-created), the bundle is submitted but **not included on-chain**.
When `BUYER_WALLET = PRIVATE_KEY` (same wallet), it works fine.

## Key Differences

### When BUYER_WALLET = PRIVATE_KEY (Same Wallet) ✅
- **DEV wallet**: Uses main wallet (PRIVATE_KEY)
- **Wallet state**: Established, has transaction history
- **Balance**: Plenty of SOL, no funding needed
- **Token creation**: Uses established wallet as creator
- **Result**: Bundle included successfully

### When BUYER_WALLET is Empty (Auto-Created) ❌
- **DEV wallet**: Newly created via `distributeSol()`
- **Wallet state**: Brand new, no transaction history
- **Balance**: Funded with `BUYER_AMOUNT + 0.15 SOL`
- **Token creation**: Uses newly created wallet as creator
- **Result**: Bundle submitted but NOT included on-chain

## Possible Causes

### 1. Wallet Not Fully Settled
- Newly created wallet might need time to "settle" on-chain
- Funding transaction might not be fully confirmed
- **Fix**: Added 2-second delay + balance verification after wallet creation

### 2. Pump.fun Validation
- Pump.fun might validate creator wallet has minimum history/state
- New wallets might be flagged or rejected
- Creator wallet might need to be "warmed up"

### 3. Bundle Transaction Ordering
- Token creation uses `buyerKp.publicKey` as creator
- But transaction is signed by `mainKp` (payer) and `mintKp`
- Newly created wallet might not be recognized as valid creator

### 4. Rate Limiting (Most Likely)
- Logs show lots of 429 rate limit errors
- Bundle might be getting rejected due to rate limits
- But why would it work with same wallet?

## Current Status

The bundle is being **submitted successfully** (gets a signature), but **not included in a block**. This suggests:
- Bundle passes initial validation
- But validators reject it during inclusion
- Or rate limiting prevents inclusion

## Next Steps to Debug

1. **Check transaction on Solscan**: See why the bundle transaction failed
2. **Add more logging**: Log wallet state before token creation
3. **Verify wallet balance**: Ensure wallet has enough SOL after creation
4. **Check LUT inclusion**: Verify DEV wallet is properly in LUT
5. **Compare bundle signatures**: See if there's a difference in bundle structure

## Potential Fixes

1. ✅ **Added delay after wallet creation** (2 seconds + balance check)
2. **Consider warming up wallet**: Send a small transaction to establish history
3. **Increase buffer**: Maybe 0.15 SOL isn't enough for all fees
4. **Check if creator needs to sign**: Maybe `buyerKp` needs to sign token creation?

