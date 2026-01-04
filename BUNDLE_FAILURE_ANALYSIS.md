# Bundle Failure Analysis: Auto-Created DEV Wallet vs Same Wallet

## The Problem

When `BUYER_WALLET` is **empty** (auto-created), the bundle fails. When `BUYER_WALLET` is set to the **same as PRIVATE_KEY**, it works fine.

## Key Differences

### When BUYER_WALLET = PRIVATE_KEY (Same Wallet) ✅
- **DEV wallet**: Uses the main wallet (PRIVATE_KEY)
- **Funding**: Main wallet already has SOL, no transfer needed
- **Bundle submission**: Uses `mainKp` (PRIVATE_KEY) - same wallet
- **Result**: Works perfectly

### When BUYER_WALLET is Empty (Auto-Created) ❌
- **DEV wallet**: New wallet created via `distributeSol()`
- **Funding**: Receives `BUYER_AMOUNT + 0.1 SOL` buffer
  - Example: If `BUYER_AMOUNT = 0.5`, wallet gets `0.6 SOL`
- **Bundle submission**: Still uses `mainKp` (PRIVATE_KEY) - **NOT the DEV wallet**
- **Result**: Bundle fails

## What Wallet Submits the Bundle?

**Answer**: The `mainKp` (PRIVATE_KEY wallet) always submits the bundle.

Looking at `index.ts` line 665:
```typescript
const result = await executeJitoTx(transactions, mainKp, commitment, latestBlockhash)
```

The `executeJitoTx` function receives `mainKp` as the `payer` parameter, which is used for bundle submission.

## How Much SOL is Sent to Auto-Created DEV Wallet?

**Answer**: `BUYER_AMOUNT + 0.1 SOL` buffer

From `index.ts` lines 119-124:
```typescript
const buyerAmount = Number(process.env.BUYER_AMOUNT || '0.1');
const devRequiredAmount = buyerAmount + 0.1 // BUYER_AMOUNT + 0.1 SOL buffer
const devWalletResult = await distributeSol(connection, mainKp, 1, [devRequiredAmount])
```

So if `BUYER_AMOUNT = 0.5`, the DEV wallet gets `0.6 SOL`.

## Why Might the Bundle Fail?

### Potential Issues:

1. **Insufficient SOL for DEV Buy Transaction**
   - DEV buy transaction uses `buyerKp` as payer (line 477)
   - Needs: `BUYER_AMOUNT` (0.5 SOL) + priority fees + transaction fees
   - Priority fee: `5,000,000 units * 20,000 microLamports = 0.1 SOL`
   - Total needed: ~0.6 SOL (which matches the funding)
   - **But**: The wallet might need more for rent exemption or other fees

2. **Transaction Signing Issue**
   - DEV buy transaction is signed by `buyerKp` (line 487)
   - If `buyerKp` doesn't have enough SOL, the transaction will fail during simulation

3. **Bundle Validation**
   - Jito validates all transactions in the bundle before accepting it
   - If the DEV buy transaction fails simulation, the entire bundle is rejected

## The Real Issue

The problem is likely that **0.1 SOL buffer is not enough** for:
- Priority fees (0.1 SOL for compute budget)
- Transaction base fees (~0.000005 SOL)
- Rent exemption (if needed)
- Safety margin

When the wallet is the same as PRIVATE_KEY, it has plenty of SOL, so fees aren't an issue.

## Solution

Increase the buffer from `0.1 SOL` to `0.15 SOL` or `0.2 SOL` to ensure the auto-created DEV wallet has enough SOL for all fees.

