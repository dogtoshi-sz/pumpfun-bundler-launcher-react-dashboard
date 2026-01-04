# Post-Launch Features with Warmed Wallets

## Overview
This document explains how all post-launch features (trading, collect fees, gather SOL) work with warmed wallets.

---

## ✅ **All Features Work with Warmed Wallets!**

All post-launch features read from `current-run.json`, which contains **both fresh and warmed wallets**. Since warmed wallets are saved to `current-run.json` just like fresh wallets, everything works identically.

---

## 1. **Rapid Sell / Trading** ✅

### How It Works:
**File:** `rapid-sell.ts`

**Wallet Loading:**
1. Reads `current-run.json`
2. Loads `bundleWalletKeys` (bundle wallets - includes warmed)
3. Loads `holderWalletKeys` (holder wallets - includes warmed)
4. Loads `creatorDevWalletKey` (DEV wallet)

**Code Reference:**
```typescript
// Line 92-98: Reads bundleWalletKeys from current-run.json
if (currentRunData.bundleWalletKeys && Array.isArray(currentRunData.bundleWalletKeys)) {
  const bundleWallets = currentRunData.bundleWalletKeys.map((kp: string) => 
    Keypair.fromSecretKey(base58.decode(kp))
  )
  walletsToProcess.push(...bundleWallets)
}

// Line 105-109: Reads holderWalletKeys from current-run.json
if (currentRunData.holderWalletKeys && Array.isArray(currentRunData.holderWalletKeys)) {
  const holderWallets = currentRunData.holderWalletKeys.map((kp: string) => 
    Keypair.fromSecretKey(base58.decode(kp))
  )
  walletsToProcess.push(...holderWallets)
}
```

**Result:** ✅ **Works perfectly!** Warmed wallets are in `current-run.json`, so they're included in rapid sell.

---

## 2. **Collect Fees** ✅

### How It Works:
**File:** `collect-fees.ts`

**Wallet Loading:**
1. Reads `current-run.json`
2. Uses `creatorDevWalletKey` (the DEV wallet that created the token)
3. Falls back to `BUYER_WALLET` from `.env` if not found

**Code Reference:**
```typescript
// Line 83: Reads creatorDevWalletKey from current-run.json
if (currentRunData.creatorDevWalletKey) {
  creatorWallet = Keypair.fromSecretKey(base58.decode(currentRunData.creatorDevWalletKey))
  walletSource = 'current-run.json (auto-created DEV wallet)'
}
```

**Result:** ✅ **Works perfectly!** The DEV wallet (whether fresh or from `BUYER_WALLET`) is always in `current-run.json`.

**Note:** Collect fees only uses the creator/DEV wallet, not bundle/holder wallets. This is correct behavior - fees go to the creator wallet.

---

## 3. **Gather All SOL** ✅ (Fixed!)

### How It Works:
**File:** `gather-all-wallets.ts`

**Wallet Loading (Updated):**
1. Reads `data.json` (fresh bundle wallets
2. Reads `current-run.json`:
   - `bundleWalletKeys` (bundle wallets - **includes warmed wallets!**)
   - `holderWalletKeys` (holder wallets - includes warmed)
   - `creatorDevWalletKey` (DEV wallet)
3. Falls back to `BUYER_WALLET` from `.env` if needed

**Code Reference:**
```typescript
// Line 84-101: Reads bundleWalletKeys from current-run.json
if (currentRunData.bundleWalletKeys && Array.isArray(currentRunData.bundleWalletKeys)) {
  for (const privateKey of currentRunData.bundleWalletKeys) {
    const kp = Keypair.fromSecretKey(base58.decode(privateKey))
    // Add to walletsToProcess
  }
}

// Line 103-120: Reads holderWalletKeys from current-run.json
if (currentRunData.holderWalletKeys && Array.isArray(currentRunData.holderWalletKeys)) {
  for (const privateKey of currentRunData.holderWalletKeys) {
    const kp = Keypair.fromSecretKey(base58.decode(privateKey))
    // Add to walletsToProcess
  }
}
```

**Result:** ✅ **Now works perfectly!** Fixed to read `bundleWalletKeys` from `current-run.json`, so warmed bundle wallets are included.

---

## 4. **Other Trading Scripts**

### rapid-sell-holders.ts
- Reads `holderWalletKeys` from `current-run.json`
- ✅ **Works with warmed holder wallets**

### rapid-sell-50-percent.ts
- Reads `bundleWalletKeys` and `holderWalletKeys` from `current-run.json`
- ✅ **Works with warmed wallets**

### rapid-sell-remaining.ts
- Reads `bundleWalletKeys` and `holderWalletKeys` from `current-run.json`
- ✅ **Works with warmed wallets**

### All Other Rapid Sell Variants
- All read from `current-run.json`
- ✅ **All work with warmed wallets**

---

## Summary Table

| Feature | File | Reads From | Works with Warmed? |
|---------|------|------------|-------------------|
| **Rapid Sell** | `rapid-sell.ts` | `current-run.json` | ✅ Yes |
| **Rapid Sell Holders** | `rapid-sell-holders.ts` | `current-run.json` | ✅ Yes |
| **Rapid Sell 50%** | `rapid-sell-50-percent.ts` | `current-run.json` | ✅ Yes |
| **Rapid Sell Remaining** | `rapid-sell-remaining.ts` | `current-run.json` | ✅ Yes |
| **Collect Fees** | `collect-fees.ts` | `current-run.json` | ✅ Yes |
| **Gather All SOL** | `gather-all-wallets.ts` | `current-run.json` + `data.json` | ✅ Yes (Fixed!) |
| **Gather SOL Only** | `gather-sol-only.ts` | `current-run.json` + `data.json` | ✅ Yes |

---

## Why Everything Works

### Key Point: `current-run.json` Contains Everything

When you launch with warmed wallets:
1. Warmed wallets are saved to `current-run.json` (same as fresh wallets)
2. All post-launch scripts read from `current-run.json`
3. Therefore, all features work with warmed wallets!

### File Structure After Launch:

**current-run.json:**
```json
{
  "bundleWalletKeys": [
    "warmed_wallet_1_private_key",
    "warmed_wallet_2_private_key",
    "fresh_wallet_3_private_key"  // if mixed
  ],
  "holderWalletKeys": [
    "warmed_holder_1_private_key",
    "fresh_holder_2_private_key"  // if mixed
  ],
  "creatorDevWalletKey": "dev_wallet_private_key",
  "mintAddress": "token_mint_address",
  ...
}
```

**data.json:**
```json
[
  "fresh_wallet_1_private_key",  // Only fresh wallets
  "fresh_wallet_2_private_key"
  // Warmed wallets NOT here (they're in warmed-wallets.json)
]
```

---

## Important Notes

### ✅ **Everything Works!**
- All trading scripts work with warmed wallets
- Collect fees works (uses DEV wallet from current-run.json)
- Gather SOL works (reads from current-run.json)

### ⚠️ **No Special Handling Needed**
- Warmed wallets are treated exactly like fresh wallets
- All scripts work automatically
- No configuration changes needed

### 📝 **File Locations**
- **Trading/Rapid Sell:** Reads from `current-run.json` ✅
- **Collect Fees:** Reads from `current-run.json` ✅
- **Gather SOL:** Reads from `current-run.json` + `data.json` ✅

---

## Conclusion

**All post-launch features work perfectly with warmed wallets!** 🎉

The system is designed to work seamlessly because:
1. Warmed wallets are saved to `current-run.json` (same as fresh)
2. All post-launch scripts read from `current-run.json`
3. No special handling or configuration needed

You can use warmed wallets for launches and all trading/collect/gather features will work exactly as they do with fresh wallets! 🚀

