# LUT (Address Lookup Table) and Bundling Explained

## What is LUT?

**LUT (Address Lookup Table)** is a Solana feature that stores frequently-used addresses in a table, then references them by **index** instead of the full 32-byte address.

### Why Use LUT?

**Without LUT:**
- Each address in a transaction = **32 bytes**
- Example: A buy transaction might need 15+ addresses
- Total: 15 × 32 = **480 bytes** just for addresses!

**With LUT:**
- Each address reference = **1 byte** (just the index)
- Same 15 addresses = **15 bytes** (plus the LUT itself)
- **Savings: ~465 bytes per transaction!**

## How LUT Works in This System

### Step 1: Create the LUT
- Creates an empty lookup table on-chain
- Costs ~0.001-0.002 SOL (rent for the account)
- Takes ~15 seconds to become active

### Step 2: Add Addresses to LUT
The system adds addresses in batches:

1. **Wallet Addresses**: All bundle wallets, DEV wallet, holder wallets
2. **ATAs (Associated Token Accounts)**: Token accounts for each wallet
3. **Global Volume Accumulators**: pump.fun accounts that track trading volume per user
4. **Static Addresses**: Program IDs, system accounts, pump.fun accounts (bonding curve, fee config, etc.)

### Step 3: Use LUT in Transactions
- All buy transactions reference the LUT
- Instead of including full addresses, they use 1-byte indices
- This allows more transactions to fit in a bundle

## What Are Global Volume Accumulators?

**Global Volume Accumulators** are pump.fun-specific accounts that:
- Track trading volume per user/wallet
- Used by pump.fun to calculate fees, rewards, or statistics
- Each wallet has its own volume accumulator account
- These accounts are added to the LUT so they can be efficiently referenced

**Why add them?**
- Buy transactions need to update these accounts
- Without LUT, each accumulator address = 32 bytes
- With LUT, each = 1 byte
- Saves significant space in transactions

## Is This For Bundling?

**YES!** The LUT is **critical** for bundling because:

### Transaction Size Limits
- Solana transactions have a **1232 byte limit**
- Without LUT, a single buy transaction might be 600-800 bytes
- With LUT, the same transaction might be 200-300 bytes
- **This allows 2-3x more transactions per bundle!**

### Bundle Efficiency
- **More transactions per bundle** = More buys executed together
- **Smaller transactions** = Faster processing
- **Lower fees** = Less compute units needed

### Example:
**Without LUT:**
- Bundle wallet buy transaction: ~700 bytes
- Max transactions per bundle: ~1-2 (hitting size limits)

**With LUT:**
- Bundle wallet buy transaction: ~250 bytes
- Max transactions per bundle: ~4-5 (much more efficient!)

## The Process

1. **Create LUT** → Store it on-chain (~15s wait)
2. **Add addresses** → Wallet addresses, ATAs, volume accumulators, static addresses
3. **Create transactions** → All transactions reference LUT by index
4. **Bundle transactions** → Smaller size = more fit in bundle
5. **Submit bundle** → Jito processes the entire bundle together

## Cost

- **LUT Creation**: ~0.001-0.002 SOL (one-time per launch)
- **LUT Extension**: ~0.0001 SOL per extension (multiple extensions needed)
- **Total LUT Cost**: ~0.002-0.003 SOL per launch

## Benefits

✅ **Smaller transactions** = More fit in bundle  
✅ **Faster execution** = Less compute units  
✅ **Lower fees** = More efficient  
✅ **Better bundling** = More buys executed together  

## Summary

- **LUT** = Address Lookup Table (reduces transaction size)
- **Volume Accumulators** = pump.fun accounts that track user trading volume
- **Purpose** = Enable efficient bundling by reducing transaction size
- **Result** = More transactions per bundle, faster execution, lower costs

