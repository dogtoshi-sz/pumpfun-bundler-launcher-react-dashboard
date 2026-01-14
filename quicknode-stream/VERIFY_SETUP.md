# Verify QuickNode Setup

## Your Webhook URL
```
https://macey-unreposed-imagistically.ngrok-free.dev/api/quicknode-webhook
```

## Checklist

### ✅ 1. ngrok is Running
- Open a terminal
- Run: `ngrok http 3001`
- Should show your ngrok URL (matches above)

### ✅ 2. API Server is Running
- Server should be on port 3001
- Check: `http://localhost:3001` should respond

### ✅ 3. QuickNode Dashboard
1. Go to: https://dashboard.quicknode.com
2. Navigate to: **Streams** → Your Stream → **Edit**
3. Check **Webhook URL** field:
   - Should be: `https://macey-unreposed-imagistically.ngrok-free.dev/api/quicknode-webhook`
   - Method: **POST**
   - Headers: `x-quicknode-token: qnsec_YTMwNzIyMmQtMGFhMS00OTM3LTg2YzktMDMwYjBmOGYzYmQ1`

### ✅ 4. Filter Function
- Should have the code from `FILTER_BY_MINT.js` pasted
- No hardcoded mint address (sends all Pump.fun trades)

### ✅ 5. Stream Status
- Stream should be **Active/Running**
- Check for any errors in QuickNode dashboard

## Test It

1. **Make a test trade** on your token
2. **Check server logs** - should see:
   ```
   [QuickNode] 📥 Webhook received - payload type: array, length: 1
   [QuickNode] 🔍 Handling webhook - currentMint: 8NkseRPS...
   [QuickNode] ✅ Processing trade for 8NkseRPS...
   ```

## If No Logs Appear

1. **Check ngrok is running** - restart if needed
2. **Check QuickNode stream is active** - restart stream if needed
3. **Verify webhook URL in QuickNode** - must match exactly
4. **Check security token** - must match in QuickNode headers

## Common Issues

- **ngrok URL changed** - If you restarted ngrok, update QuickNode with new URL
- **Stream not active** - Restart stream in QuickNode dashboard
- **Webhook URL wrong** - Must be exact match (including `/api/quicknode-webhook`)
- **Security token mismatch** - Check header value matches `.env` file
