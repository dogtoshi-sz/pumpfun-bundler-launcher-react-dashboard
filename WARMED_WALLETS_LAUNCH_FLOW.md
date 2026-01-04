# How Warmed Wallets Work in Token Launches

## Overview
When you select warmed wallets for a launch, the system uses existing wallets from your wallet warming system instead of creating fresh ones. This document explains the complete flow.

---

## 1. **Wallet Selection & Storage**

### Frontend Selection
- You select warmed wallets in the UI modal
- Wallets are assigned to either **Bundle** or **Holder** roles
- Selected wallet addresses are sent to the API server

### API Server Processing
**File Created:** `keys/warmed-wallets-for-launch.json`

When you click "Launch Token", the API server:
1. Loads all warmed wallets from `keys/warmed-wallets.json`
2. Maps selected addresses to their private keys
3. Saves to `keys/warmed-wallets-for-launch.json`:
   ```json
   {
     "bundleWalletKeys": ["base58_private_key_1", "base58_private_key_2", ...],
     "holderWalletKeys": ["base58_private_key_3", ...],
     "bundleWalletAddresses": ["address1", "address2", ...],
     "holderWalletAddresses": ["address3", ...],
     "createdAt": "2024-01-01T00:00:00.000Z"
   }
   ```

**Important:** This file is temporary and only exists during the launch process.

---

## 2. **Launch Process (index.ts)**

### Step 1: Load Warmed Wallets
- `index.ts` checks for `keys/warmed-wallets-for-launch.json`
- If found, loads private keys and creates Keypair objects
- If not found, falls back to creating fresh wallets (normal flow)

### Step 2: Funding Warmed Wallets
**Mixing Wallets: YES, Still Works!**

When funding warmed wallets:
- **If `USE_MIXING_WALLETS=true`**: Uses mixing wallets to fund (breaks connection trail)
  - Main Wallet → Mixing Wallet → Warmed Wallet
- **If `USE_MIXING_WALLETS=false`**: Direct funding from main wallet

**Funding Logic:**
- Checks each wallet's current SOL balance
- Calculates required amount: `swapAmount + 0.01 SOL (buffer)`
- Only funds if balance is insufficient
- Uses `fundExistingWalletWithMixing()` function (same as fresh wallets)

### Step 3: Amount Configuration
**Amounts Work Exactly Like Fresh Wallets:**

- **Bundle Wallets:**
  - Uses `BUNDLE_SWAP_AMOUNTS` if provided (comma-separated)
  - Pads with `SWAP_AMOUNT` if fewer amounts than wallets
  - Trims if more amounts than wallets
  - Falls back to `SWAP_AMOUNT` for all if empty

- **Holder Wallets:**
  - Uses `HOLDER_SWAP_AMOUNTS` if provided
  - Pads with `HOLDER_WALLET_AMOUNT` if needed
  - Same padding/trimming logic as bundle wallets

---

## 3. **Bundle Creation & Execution**

### Bundle Mode (Jito/LilJit)
**Works Identically to Fresh Wallets:**

1. **LUT Creation:** Same as fresh wallets (if not using normal launch)
2. **Buy Instructions:** Created for each warmed bundle wallet
3. **Bundle Assembly:** All transactions bundled together
4. **Submission:** Sent via Jito/LilJit (same as fresh wallets)

**No Difference:** Warmed wallets are treated exactly like fresh wallets in the bundle.

### Normal Launch Mode
- If `USE_NORMAL_LAUNCH=true` and no bundle wallets:
- Skips Jito bundling
- Sends transactions sequentially
- Works the same with warmed wallets

---

## 4. **Wallet Storage After Launch**

### current-run.json
**Saved Immediately After Funding:**

```json
{
  "bundleWalletKeys": ["base58_key_1", "base58_key_2", ...],
  "holderWalletKeys": ["base58_key_3", ...],
  "walletKeys": [...all wallet keys...],
  "creatorDevWalletKey": "base58_dev_key",
  "mintAddress": "token_mint_address",
  "launchStatus": "PENDING",
  "launchStage": "FUNDING_WALLETS",
  ...
}
```

**Important:** Warmed wallets are saved to `current-run.json` just like fresh wallets.

### data.json
**Warmed Wallets Are NOT Added to data.json**

**Key Difference:**
- **Fresh wallets:** Automatically saved to `keys/data.json` via `saveDataToFile()`
- **Warmed wallets:** Already exist in `keys/warmed-wallets.json`, NOT added to `data.json`

**Why?**
- Warmed wallets are managed separately in the wallet warming system
- They already have transaction history, tags, and stats
- Adding them to `data.json` would duplicate them

### warmed-wallets.json
**Unchanged During Launch:**
- Warmed wallets remain in `keys/warmed-wallets.json`
- Their stats, tags, and history are preserved
- The launch doesn't modify this file

---

## 5. **Mixing Wallets**

### ✅ **YES, Mixing Wallets Still Work!**

**How It Works:**
1. When funding warmed wallets, the system checks `USE_MIXING_WALLETS`
2. If enabled, uses `fundExistingWalletWithMixing()`:
   - Main Wallet → Random Mixing Wallet → Warmed Wallet
   - Breaks on-chain connection trail
   - Prevents bubble map detection

**Example Flow:**
```
Main Wallet (PRIVATE_KEY)
    ↓ (via mixing wallet)
Mixing Wallet #5
    ↓
Warmed Bundle Wallet #1 (from warmed-wallets.json)
```

**Same as Fresh Wallets:**
- Uses the same mixing wallet system
- Same privacy benefits
- Same configuration (`USE_MIXING_WALLETS` env var)

---

## 6. **Complete Flow Diagram**

```
┌─────────────────────────────────────────────────────────────┐
│ 1. USER SELECTS WARMED WALLETS IN UI                        │
│    - Selects wallets from modal                             │
│    - Assigns Bundle/Holder roles                            │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. API SERVER PROCESSES SELECTION                           │
│    - Loads warmed-wallets.json                              │
│    - Maps addresses → private keys                          │
│    - Saves to warmed-wallets-for-launch.json                │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. index.ts LOADS WARMED WALLETS                            │
│    - Reads warmed-wallets-for-launch.json                    │
│    - Creates Keypair objects                                │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. FUNDING WARMED WALLETS                                   │
│    - Checks each wallet's balance                           │
│    - Calculates required amount                             │
│    - Funds via mixing wallets (if enabled)                  │
│    - OR funds directly (if mixing disabled)                 │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. BUNDLE CREATION                                          │
│    - Creates buy instructions for each wallet               │
│    - Builds bundle (same as fresh wallets)                  │
│    - Submits via Jito/LilJit                                │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. SAVE TO current-run.json                                 │
│    - Saves all wallet keys                                  │
│    - Saves mint address                                     │
│    - Updates launch status                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. **Key Differences: Warmed vs Fresh Wallets**

| Aspect | Fresh Wallets | Warmed Wallets |
|--------|--------------|---------------|
| **Creation** | Generated new each launch | Selected from existing pool |
| **Storage (data.json)** | ✅ Saved automatically | ❌ Not saved (already in warmed-wallets.json) |
| **Storage (current-run.json)** | ✅ Saved | ✅ Saved (same) |
| **Storage (warmed-wallets.json)** | ❌ Not used | ✅ Already exists |
| **Mixing Wallets** | ✅ Works | ✅ Works (same) |
| **Bundle Creation** | ✅ Works | ✅ Works (same) |
| **Amount Configuration** | ✅ Works | ✅ Works (same) |
| **Transaction History** | None (new wallets) | Existing history preserved |
| **Tags/Stats** | None | Preserved from warming |

---

## 8. **Benefits of Using Warmed Wallets**

1. **Transaction History:** Wallets already have on-chain activity
2. **Better Privacy:** Wallets look more organic (not brand new)
3. **Reusability:** Use the same wallets across multiple launches
4. **Cost Efficiency:** Don't need to create new wallets each time
5. **Tracking:** All wallet stats preserved in warmed-wallets.json

---

## 9. **Important Notes**

### ⚠️ **Warmed Wallets Are NOT Added to data.json**
- This is intentional to avoid duplication
- Warmed wallets are managed separately
- They're still saved to `current-run.json` for the launch

### ✅ **Mixing Wallets Work the Same**
- Same configuration (`USE_MIXING_WALLETS`)
- Same privacy benefits
- Same funding flow

### ✅ **Bundles Work Identically**
- Same Jito/LilJit submission
- Same LUT creation (if needed)
- Same transaction structure

### ✅ **Amounts Work the Same**
- Same padding/trimming logic
- Same fallback to defaults
- Same configuration options

---

## 10. **File Locations Summary**

| File | Purpose | When Created | Contains |
|------|---------|--------------|----------|
| `keys/warmed-wallets.json` | Wallet warming system | Persistent | All warmed wallets with stats |
| `keys/warmed-wallets-for-launch.json` | Launch temp file | During launch | Selected wallet private keys |
| `keys/current-run.json` | Launch tracking | During launch | All wallet keys for current launch |
| `keys/data.json` | Fresh wallet storage | During launch | Only fresh wallets (not warmed) |

---

## Summary

**Warmed wallets work exactly like fresh wallets in terms of:**
- ✅ Mixing wallet support
- ✅ Bundle creation and submission
- ✅ Amount configuration
- ✅ Funding logic
- ✅ current-run.json storage

**Key difference:**
- ❌ Warmed wallets are NOT added to `data.json` (they're already in `warmed-wallets.json`)

Everything else works identically! 🚀

