# Wallet Types Explanation: BUYER_WALLET vs Holder Wallets vs Bundle Wallets

## They Are **DIFFERENT** - Here's How:

---

## 1. **BUYER_WALLET (DEV/Creator Wallet)** 👑

**Purpose:**
- **Creates the token** (the token creator/owner)
- **Makes the FIRST buy** (DEV buy - right after token creation)
- **Collects creator fees** (fees from all trades go to this wallet)
- **Is the referrer** for all other wallet buys

**When It Buys:**
- **In the bundle** (if using Jito bundling)
- **Right after token creation** (first transaction in bundle)
- **Order:** Token Creation → DEV Buy → Bundle Wallet Buys

**Configuration:**
- Set via `BUYER_WALLET` in `.env` (optional - can be auto-created)
- Amount set via `BUYER_AMOUNT` in `.env` (default: 1 SOL)

**Storage:**
- Saved as `creatorDevWalletKey` in `current-run.json`
- If set in `.env`, it's a persistent wallet (reused across launches)
- If not set, auto-created like bundle wallets

**Example:**
```
Token Creation → DEV Buy (1 SOL) → Bundle Wallet 1 Buy → Bundle Wallet 2 Buy
     ↑                ↑
  BUYER_WALLET    BUYER_WALLET
```

---

## 2. **Bundle Wallets** 📦

**Purpose:**
- Buy tokens **in the Jito bundle** (atomic execution)
- All bundle wallet buys happen **at the same time** as token creation
- Used for **fast, coordinated buying** right at launch

**When They Buy:**
- **In the bundle** (atomic with token creation)
- **After DEV buy** (but in the same bundle transaction)
- **Order:** Token Creation → DEV Buy → Bundle Wallet 1 Buy → Bundle Wallet 2 Buy → ...

**Configuration:**
- Count set via `BUNDLE_WALLET_COUNT` in `.env`
- Amounts set via `BUNDLE_SWAP_AMOUNTS` (comma-separated) or `SWAP_AMOUNT` (default)

**Storage:**
- Saved as `bundleWalletKeys` in `current-run.json`
- Also saved to `data.json` (if fresh wallets)

**Example:**
```
Bundle Transaction:
  1. Token Creation
  2. DEV Buy (1 SOL)
  3. Bundle Wallet 1 Buy (1 SOL)  ← Bundle wallet
  4. Bundle Wallet 2 Buy (0.5 SOL) ← Bundle wallet
```

---

## 3. **Holder Wallets** 👥

**Purpose:**
- Buy tokens **AFTER the launch** (separately, not in bundle)
- Used to **increase holder count** (makes token look more organic)
- Buy **individually** after bundle is confirmed

**When They Buy:**
- **AFTER bundle is confirmed** (separate transactions)
- **NOT in the bundle** (buy separately)
- **Order:** Token Creation → Bundle Confirms → Holder Wallet 1 Buys → Holder Wallet 2 Buys → ...

**Configuration:**
- Count set via `HOLDER_WALLET_COUNT` in `.env`
- Amounts set via `HOLDER_SWAP_AMOUNTS` (comma-separated) or `HOLDER_WALLET_AMOUNT` (default)

**Storage:**
- Saved as `holderWalletKeys` in `current-run.json`
- Also saved to `data.json` (if fresh wallets)

**Example:**
```
1. Bundle Transaction (Token Creation + DEV Buy + Bundle Buys)
2. Wait for confirmation...
3. Holder Wallet 1 buys separately (1 SOL)  ← Holder wallet
4. Holder Wallet 2 buys separately (1.5 SOL) ← Holder wallet
```

---

## Key Differences Summary

| Feature | BUYER_WALLET (DEV) | Bundle Wallets | Holder Wallets |
|---------|-------------------|----------------|----------------|
| **Role** | Token Creator | Bundle Buyers | Post-Launch Buyers |
| **When They Buy** | First (in bundle) | In bundle | After bundle |
| **Transaction Type** | Part of bundle | Part of bundle | Separate transactions |
| **Purpose** | Create token, collect fees | Fast coordinated buying | Increase holder count |
| **Referrer** | Yes (for all buys) | No (uses DEV as referrer) | No (uses DEV as referrer) |
| **Collects Fees** | ✅ Yes | ❌ No | ❌ No |
| **Bundle Atomic** | ✅ Yes | ✅ Yes | ❌ No |

---

## Complete Launch Flow

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: BUNDLE TRANSACTION (Atomic - All or Nothing)        │
├─────────────────────────────────────────────────────────────┤
│ 1. Token Creation (BUYER_WALLET creates token)              │
│ 2. DEV Buy (BUYER_WALLET buys 1 SOL worth)                  │
│ 3. Bundle Wallet 1 Buy (1 SOL)                              │
│ 4. Bundle Wallet 2 Buy (0.5 SOL)                            │
│ 5. Bundle Wallet 3 Buy (1 SOL)                              │
│                                                              │
│ ✅ All happen atomically - if one fails, all fail           │
└─────────────────────────────────────────────────────────────┘
                       │
                       ▼
              [Wait for Confirmation]
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: HOLDER WALLET BUYS (Separate Transactions)          │
├─────────────────────────────────────────────────────────────┤
│ 1. Holder Wallet 1 buys (1 SOL) - Separate transaction      │
│ 2. Holder Wallet 2 buys (1.5 SOL) - Separate transaction    │
│ 3. Holder Wallet 3 buys (0.5 SOL) - Separate transaction    │
│ 4. Holder Wallet 4 buys (1 SOL) - Separate transaction      │
│                                                              │
│ ✅ Each buy is a separate transaction (not atomic)          │
└─────────────────────────────────────────────────────────────┘
```

---

## Why They're Different

### **BUYER_WALLET (DEV):**
- **Must be the creator** - pump.fun requires the creator to be the payer
- **Collects fees** - all trading fees go to this wallet
- **First buy** - establishes the token and bonding curve

### **Bundle Wallets:**
- **Fast execution** - all buys happen atomically in one bundle
- **Coordinated** - perfect timing for launch
- **Efficient** - single transaction, lower fees

### **Holder Wallets:**
- **Organic growth** - buys happen over time (not all at once)
- **Holder count** - increases the number of holders (looks more legitimate)
- **Separate** - each buy is independent (more natural)

---

## In Your Logs

Looking at your logs:
- ✅ **BUYER_WALLET**: `2HbDoNeCJPN1p3uY3W5K1dpwVahjxK8Ya5NGFFjCZadY` (creates token, makes first buy)
- ✅ **Bundle Wallets**: 2 wallets (buy in bundle with amounts: 1 SOL, 0.5 SOL)
- ✅ **Holder Wallets**: 4 warmed wallets (buy separately after bundle)

**All three types are different and serve different purposes!** 🎯

