# Update QuickNode Filter for Your Specific Token

## The Problem
QuickNode is currently sending ALL Pump.fun trades, and we're filtering on our side. This is inefficient and causes delays.

## The Solution
Update QuickNode's filter to ONLY send trades for YOUR specific mint address.

## Steps

1. **Get Your Mint Address**
   - Your current mint: `8NkseRPSnVgmtJD8PJ49Snw5bdJDX1B12ZU8Dc5mpump`
   - (This is shown in your terminal)

2. **Open QuickNode Dashboard**
   - Go to: https://dashboard.quicknode.com
   - Navigate to: Streams → Your Stream → Edit

3. **Update the Filter Function**
   - Open the file: `FILTER_BY_MINT.js`
   - Find this line:
     ```javascript
     const TARGET_MINT_ADDRESS = "YOUR_MINT_ADDRESS_HERE";
     ```
   - Replace `YOUR_MINT_ADDRESS_HERE` with your mint:
     ```javascript
     const TARGET_MINT_ADDRESS = "8NkseRPSnVgmtJD8PJ49Snw5bdJDX1B12ZU8Dc5mpump";
     ```
   - Copy the ENTIRE file content
   - Paste it into QuickNode's "Modify the stream payload" section
   - Save

4. **Result**
   - QuickNode will now ONLY send trades for your specific token
   - No more filtering through other tokens
   - Much faster and more accurate

## When You Launch a New Token

1. Get the new mint address
2. Update `TARGET_MINT_ADDRESS` in `FILTER_BY_MINT.js`
3. Copy and paste the updated filter into QuickNode
4. Save

## Why This Works Better

- ✅ Only processes trades for YOUR token
- ✅ No webhook spam from other tokens
- ✅ Faster processing (no filtering needed)
- ✅ More accurate (no missed trades)
- ✅ Less server load

---

**This is the correct approach - filter at the source (QuickNode) not at the destination (your server).**
