# Exact Values for QuickNode Setup

## ✅ Your Webhook URL

```
https://macey-unreposed-imagistically.ngrok-free.dev/api/quicknode-webhook
```

**Copy this EXACT URL** and paste it into QuickNode's "Webhook URL" field.

---

## ✅ Filter Function

**Open the file**: `COPY_THIS_TO_QUICKNODE.js`

**Copy ALL the code** (all 250 lines) and paste it into QuickNode's "Modify the stream payload" section.

---

## QuickNode Dashboard Steps

1. **Go to**: https://dashboard.quicknode.com
2. **Navigate to**: Streams → Create/Edit Stream
3. **Stream Settings**:
   - Network: **Solana Mainnet**
   - Dataset: **Block**
   - Destination: **Webhook**

4. **Webhook Configuration**:
   - Webhook URL: `https://macey-unreposed-imagistically.ngrok-free.dev/api/quicknode-webhook`
   - Method: **POST**
   - **Headers** (IMPORTANT - Add security token):
     - Click "Add Header" or "Custom Headers"
     - Header Name: `x-quicknode-token`
     - Header Value: `qnsec_YTMwNzIyMmQtMGFhMS00OTM3LTg2YzktMDMwYjBmOGYzYmQ1`
     - This prevents unauthorized webhook requests

5. **Modify the stream payload**:
   - Click on "Modify the stream payload" section
   - Open `COPY_THIS_TO_QUICKNODE.js` file
   - Select ALL (Ctrl+A)
   - Copy (Ctrl+C)
   - Paste into QuickNode's code editor
   - Click **Save/Apply**

6. **Start the Stream**:
   - Click "Start Stream" or "Save"
   - Stream should be active

---

## Test It

1. **Launch a token** (or use existing)
2. **Make a test trade**
3. **Check server logs** - should see:
   ```
   [QuickNode] 📥 Webhook received
   [QuickNode] ✅ Processed 1 trade(s) from webhook
   ```
4. **Check terminal page** - trade should appear!

---

## Important Notes

- ✅ Keep ngrok running (don't close the terminal)
- ✅ Keep your API server running on port 3001
- ✅ The filter automatically filters for Pump.fun transactions only
- ✅ The webhook automatically filters for your current mint address
- ✅ Your wallet trades will be marked (FUNDING, DEV, Bundle, Holder)

---

## If ngrok URL Changes

If you restart ngrok, you'll get a new URL. Just update the webhook URL in QuickNode dashboard with the new ngrok URL.
