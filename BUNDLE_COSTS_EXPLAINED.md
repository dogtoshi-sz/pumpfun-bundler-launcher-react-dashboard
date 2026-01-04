# Bundle Costs Explained

## The Confusion: 0.1 SOL vs Bundle Cost

The **0.1 SOL** I mentioned is **NOT the bundle submission cost**. It's the **priority fee** for the DEV buy transaction.

## Actual Costs Breakdown

### 1. Bundle Submission Cost (JITO_FEE)
- **Amount**: `0.001 SOL` (from `.env`: `JITO_FEE=0.001`)
- **Paid to**: Jito tip accounts (randomly selected from a list)
- **When**: Included in the token creation transaction
- **Who pays**: The `mainKp` (PRIVATE_KEY wallet)
- **Location**: `src/main.ts` line 86

```typescript
SystemProgram.transfer({
  fromPubkey: mainKp.publicKey,
  toPubkey: jitoFeeWallet,
  lamports: Math.floor(JITO_FEE * 10 ** 9), // 0.001 SOL
})
```

### 2. Priority Fees (Per Transaction)
Each transaction in the bundle pays priority fees to validators:

#### DEV Buy Transaction Priority Fee:
- **Compute Units**: 5,000,000
- **Price per Unit**: 20,000 microLamports
- **Calculation**: 
  - 20,000 microLamports = 20,000 / 1,000,000 = 0.02 lamports per unit
  - 5,000,000 units × 0.02 lamports = 100,000 lamports
  - 100,000 lamports / 1,000,000,000 = **0.0001 SOL**
- **Who pays**: The `buyerKp` (DEV wallet)
- **Purpose**: Ensures fast transaction processing

#### Bundle Wallet Buy Transactions Priority Fee:
- **Same as DEV**: 0.0001 SOL per transaction
- **Who pays**: Each bundle wallet

### 3. Base Transaction Fees
- **Amount**: ~0.000005 SOL per transaction
- **Paid to**: Validators
- **Who pays**: Transaction signer

## Total Costs

### When Launching Normally:
1. **JITO_FEE**: 0.001 SOL (paid by main wallet)
2. **Priority Fees**: ~0.0001 SOL per buy transaction (paid by each wallet)
3. **Base Fees**: ~0.000005 SOL per transaction

**Total Bundle Submission Cost**: **0.001 SOL** (just the JITO_FEE)

The priority fees are separate and paid by each wallet for their own transactions.

## Why 0.1 SOL Buffer Was Needed

The 0.1 SOL buffer I mentioned was actually a **safety margin**, not the actual cost. The real costs are:
- Buy amount: 0.5 SOL (BUYER_AMOUNT)
- Priority fee: ~0.0001 SOL
- Base fees: ~0.000005 SOL
- **Total needed**: ~0.500105 SOL

But I increased the buffer to 0.15 SOL to account for:
- Rent exemption (if needed): ~0.001 SOL
- Safety margin: ~0.05 SOL
- Future fee increases

## Summary

- **Bundle submission cost**: 0.001 SOL (JITO_FEE) - always the same
- **Priority fees**: ~0.0001 SOL per transaction - paid by each wallet
- **The 0.1 SOL** was a buffer estimate, not the actual bundle cost

