# QuickNode Webhook Setup - Step by Step

## Step 1: Start Your API Server

Make sure your API server is running:
```bash
cd "C:\Users\emilk\Desktop\my-utility\pumpfun bundler"
npm start
# OR if you have a separate API server command:
# node api-server/control-panel-server.js
```

The server should be running on `http://localhost:3001`

## Step 2: Get Your Webhook URL (Choose One)

### Option A: Using ngrok (For Testing)
1. Download ngrok from https://ngrok.com/download
2. Extract and run:
```bash
ngrok http 3001
```
3. Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)
4. Your webhook URL will be: `https://abc123.ngrok.io/api/quicknode-webhook`

### Option B: Using Your Production Server
If you have a public server:
- Webhook URL: `https://yourdomain.com/api/quicknode-webhook`
- Make sure port 3001 is accessible

## Step 3: Configure QuickNode Stream

1. **Go to QuickNode Dashboard**: https://dashboard.quicknode.com
2. **Navigate to Streams** (or create a new stream)
3. **Stream Settings**:
   - **Network**: Solana Mainnet
   - **Dataset**: Block
   - **Stream Destination**: Webhook

4. **Webhook Configuration**:
   - **Webhook URL**: Paste your URL from Step 2
     - Example: `https://abc123.ngrok.io/api/quicknode-webhook`
   - **Method**: POST
   - **Headers**: Leave default (or add auth if needed)

## Step 4: Add Filter Function

1. In QuickNode dashboard, go to **"Modify the stream payload"** section
2. **Copy the entire content** from: `quicknode-stream-perchatgpt`
3. **Paste it** into the filter function editor
4. **Save** the filter

The filter will:
- Parse Pump.fun transactions
- Extract buy/sell events
- Calculate amounts and prices
- Only send Pump.fun trades (filters by program ID)

## Step 5: Test the Setup

1. **Launch a token** (or use existing token)
2. **Make a test trade** (buy or sell)
3. **Check your server logs** - you should see:
   ```
   [QuickNode] 📥 Webhook received
   [QuickNode] ✅ Processed X trade(s) from webhook
   ```
4. **Check your terminal page** - trades should appear automatically

## Step 6: Verify It's Working

- Trades appear in terminal in real-time
- Your wallet trades are marked (FUNDING, DEV, Bundle, Holder)
- Server logs show webhook activity

## Troubleshooting

### Webhook not receiving data
- Check ngrok is running and URL is correct
- Verify webhook URL in QuickNode dashboard
- Check server is running on port 3001
- Check server logs for errors

### Trades not appearing
- Make sure a token is launched (mint address set)
- Check filter function is saved correctly
- Verify the mint address matches
- Check server logs: `[QuickNode] ✅ Processed X trade(s)`

### ngrok connection issues
- Make sure ngrok is running
- Check firewall isn't blocking
- Try restarting ngrok

## Notes

- The webhook automatically filters for your current mint address
- Only Pump.fun trades are processed
- Duplicate transactions are automatically skipped
- Works with both filter formats (detailed and simple)
