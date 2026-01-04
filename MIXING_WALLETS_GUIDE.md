# Mixing Wallets Guide

## What Are Mixing Wallets?

Mixing wallets are **intermediary wallets** that break the on-chain connection trail between your main funding wallet and your operational wallets (DEV, bundle, holder wallets). This prevents "bubble maps" from detecting that all your wallets are connected to the same source.

### How It Works

**Without Mixing Wallets (Direct Funding):**
```
Main Wallet → DEV Wallet
Main Wallet → Bundle Wallet 1
Main Wallet → Bundle Wallet 2
Main Wallet → Holder Wallet 1
```
❌ **Problem:** All wallets are directly connected to the same source (easy to detect)

**With Mixing Wallets (Private Funding):**
```
Main Wallet → Mixing Wallet 1 → DEV Wallet
Main Wallet → Mixing Wallet 2 → Bundle Wallet 1
Main Wallet → Mixing Wallet 3 → Bundle Wallet 2
Main Wallet → Mixing Wallet 1 → Holder Wallet 1
```
✅ **Solution:** Connection trail is broken - wallets appear to come from different sources

## How to Enable Mixing Wallets

### Option 1: Via Frontend Settings

1. Open the frontend application
2. Navigate to **Settings** tab
3. Find **"Use Mixing Wallets (Break Connection Trail)"** checkbox
4. ✅ **Enable it** (checked = enabled)
5. Click **"Save Settings"**

### Option 2: Via .env File

Add or update this line in your `.env` file:
```env
USE_MIXING_WALLETS=true
```

**Default:** `true` (enabled by default for privacy)

## Mixing Wallets File

Mixing wallets are stored in: `keys/mixing-wallets.json`

### File Structure
```json
{
  "wallet1": {
    "publicKey": "DMsVpPToQVFwa5kfuGfbosBX8xKu3bZaRwbYxZpWdjvJ",
    "privateKey": "2mcDvqdfQYtW1C9uqKYN85KyFy9NNCTkLcf2mKrh23rAeY71u4efDWien9LCCghyncvgS6QjUC1Zuadz9m78yaSE"
  },
  "wallet2": {
    "publicKey": "5UPZyPsMCtTcvr48hXrtLkVY4T2stZU4bAdT9Vjyvrs2",
    "privateKey": "3FCn44aqLPaWtWjbWLsGpVXVEWh6X3BodrJUJ925YgAG6zjzwputetKw8DSnC9GB86y9xganU4kC2HLpi1BxCAmW"
  },
  "createdAt": "2025-12-22T00:41:02.342Z",
  "lastUsed": "2025-12-22T01:48:24.281Z"
}
```

### Automatic Creation

If `mixing-wallets.json` doesn't exist or is empty, the system will **automatically create 5 new mixing wallets** on first use and save them to the file.

## Testing Mixing Wallets

### Step 1: Verify Mixing Wallets File

Check if mixing wallets exist:
```bash
# Windows PowerShell
Get-Content "keys\mixing-wallets.json"

# Linux/Mac
cat keys/mixing-wallets.json
```

If the file doesn't exist, it will be created automatically on first launch.

### Step 2: Enable in Frontend

1. Open the frontend
2. Go to **Settings** tab
3. Enable **"Use Mixing Wallets"**
4. Save settings

### Step 3: Launch a Test Token

1. Fill in token details:
   - Token Name
   - Token Symbol
   - Description
   - Image
2. Configure wallets:
   - Set **Bundle Wallet Count** (e.g., 2-3 for testing)
   - Set **Holder Wallet Count** (e.g., 2 for testing)
3. Click **"Launch Token"**

### Step 4: Monitor the Logs

Watch the console output for mixing wallet activity:

**Expected Output:**
```
🔀 Using 5 mixing wallets to break connection trail
🔀 Using mixing wallets to break connection trail...
   🔀 Funding mixer 1/5 with 0.5100 SOL...
   🔀 Routing wallet 1/3 through mixer 1...
   🔀 Routing wallet 2/3 through mixer 2...
   🔀 Routing wallet 3/3 through mixer 3...
✅ Successfully distributed SOL through mixing wallets
💾 Saved 5 mixing wallet(s) to keys/mixing-wallets.json
```

### Step 5: Verify Wallets Are Saved

After launch, check that all wallets are saved:

1. **Target Wallets** (DEV, Bundle, Holder): Saved to `keys/data.json`
2. **Mixing Wallets**: Saved to `keys/mixing-wallets.json`

## Wallet Safety - Never Lose Funds

### All Wallets Are Automatically Saved

The system saves **all wallets** to prevent fund loss:

1. **Target Wallets** (`keys/data.json`):
   - DEV wallet (creator/buyer)
   - Bundle wallets
   - Holder wallets
   - Format: Array of base58 private keys

2. **Mixing Wallets** (`keys/mixing-wallets.json`):
   - Intermediary wallets used for routing
   - Format: JSON object with public/private keys
   - Includes `createdAt` and `lastUsed` timestamps

### Backup Strategy

**Recommended:** Regularly backup the `keys/` directory:

```bash
# Windows PowerShell
Copy-Item -Path "keys" -Destination "keys-backup-$(Get-Date -Format 'yyyy-MM-dd')" -Recurse

# Linux/Mac
cp -r keys keys-backup-$(date +%Y-%m-%d)
```

### Recovering Funds

If you need to recover funds from any wallet:

1. **From data.json:**
   ```javascript
   const privateKey = "YOUR_PRIVATE_KEY_FROM_DATA_JSON"
   // Use with Solana wallet tools to recover funds
   ```

2. **From mixing-wallets.json:**
   ```javascript
   const mixingData = require('./keys/mixing-wallets.json')
   const privateKey = mixingData.wallet1.privateKey
   // Use with Solana wallet tools to recover funds
   ```

## How Mixing Works in Detail

### Transaction Flow

For each target wallet (DEV, bundle, holder):

1. **Step 1: Fund Mixing Wallet**
   - Main wallet sends SOL to a random mixing wallet
   - Amount: Target amount + small buffer (0.01 SOL) for fees
   - Random delay: 1-3 seconds between transactions

2. **Step 2: Route to Target**
   - Mixing wallet sends SOL to target wallet
   - Amount: Exact amount needed
   - Connection trail is broken!

### Benefits

✅ **Privacy:** Wallets appear to come from different sources  
✅ **Stealth:** Harder for bubble maps to detect coordination  
✅ **Randomization:** Random delays and wallet selection break patterns  
✅ **Automatic:** No manual configuration needed  

### Performance Impact

- **Slightly slower:** Each wallet requires 2 transactions instead of 1
- **More transactions:** 2x the number of transactions
- **Still fast:** Random delays are only 1-3 seconds
- **Worth it:** Privacy benefit outweighs minor speed cost

## Troubleshooting

### Issue: "No mixing wallets found - funding directly"

**Solution:** The system will automatically create mixing wallets on next launch. Or manually create `keys/mixing-wallets.json` with at least 1 wallet.

### Issue: Mixing wallets not being saved

**Check:**
1. `keys/` directory exists and is writable
2. No file permission errors
3. Check console logs for save errors

### Issue: Want to disable mixing

**Solution:** Set `USE_MIXING_WALLETS=false` in `.env` or uncheck in Settings.

## Best Practices

1. **Keep mixing wallets:** Don't delete `mixing-wallets.json` - reuse them
2. **Backup regularly:** Backup the entire `keys/` directory
3. **Monitor balances:** Check mixing wallet balances occasionally (they may accumulate small amounts)
4. **Use multiple mixers:** System automatically cycles through available mixing wallets

## Summary

- ✅ **Enabled by default** for privacy
- ✅ **Automatic creation** if no mixing wallets exist
- ✅ **All wallets saved** to prevent fund loss
- ✅ **Breaks connection trail** for better privacy
- ✅ **Easy to test** - just launch a token!

