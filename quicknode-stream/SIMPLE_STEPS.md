# Simple Steps to Update QuickNode Filter

## Step 1: Copy the Filter Code
1. Open the file: `FILTER_BY_MINT.js`
2. Press `Ctrl+A` (select all)
3. Press `Ctrl+C` (copy)

## Step 2: Go to QuickNode
1. Open: https://dashboard.quicknode.com
2. Click "Streams" in the left menu
3. Click on your stream (the one you created earlier)

## Step 3: Update the Filter
1. Scroll down to "Modify the stream payload" section
2. Click in the code box
3. Press `Ctrl+A` (select all existing code)
4. Press `Ctrl+V` (paste the new code from Step 1)
5. Click "Save" or "Update Stream"

## Step 4: Done!
That's it! QuickNode will now ONLY send trades for your token.

---

**Your mint address is already set in the filter file:**
`8NkseRPSnVgmtJD8PJ49Snw5bdJDX1B12ZU8Dc5mpump`

**When you launch a new token:**
1. Get the new mint address
2. Open `FILTER_BY_MINT.js`
3. Change line 7 to the new mint address
4. Copy and paste into QuickNode again
