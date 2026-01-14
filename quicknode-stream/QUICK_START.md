# QuickNode Setup - Quick Start Guide

## ✅ Step 1: Make Sure Your Server is Running

Your API server should be running on port 3001. If not, start it:
```bash
# In your project directory
npm start
# OR if you have a separate API server:
# node api-server/control-panel-server.js
```

## ✅ Step 2: Get Your Webhook URL with ngrok

1. **Download ngrok** (if you don't have it): https://ngrok.com/download
2. **Extract and run ngrok**:
   ```bash
   ngrok http 3001
   ```
3. **Copy the HTTPS URL** from ngrok (looks like: `https://abc123.ngrok.io`)
4. **Your webhook URL is**: `https://abc123.ngrok.io/api/quicknode-webhook`

**Keep ngrok running** - don't close the terminal!

## ✅ Step 3: Go to QuickNode Dashboard

1. Go to: https://dashboard.quicknode.com
2. Log in to your account
3. Navigate to **"Streams"** (or create a new stream)

## ✅ Step 4: Configure the Stream

1. **Stream Settings**:
   - **Network**: `Solana Mainnet`
   - **Dataset**: `Block`
   - **Stream Destination**: `Webhook`

2. **Webhook Configuration**:
   - **Webhook URL**: Paste your ngrok URL + `/api/quicknode-webhook`
     - Example: `https://abc123.ngrok.io/api/quicknode-webhook`
   - **Method**: `POST`
   - **Headers**: Leave default (empty is fine)

## ✅ Step 5: Add the Filter Function

1. In QuickNode, find the section: **"Modify the stream payload"**
2. **Open the file**: `quicknode-stream-perchatgpt` in this folder
3. **Copy ALL the code** (all 250 lines)
4. **Paste it** into the QuickNode filter editor
5. **Save/Apply** the filter

## ✅ Step 6: Test It!

1. **Launch a token** (or use existing token)
2. **Make a test trade** (buy or sell with your wallet)
3. **Check your server terminal** - you should see:
   ```
   [QuickNode] 📥 Webhook received
   [QuickNode] ✅ Processed 1 trade(s) from webhook
   ```
4. **Check your terminal page** - the trade should appear!

## 🎯 That's It!

The webhook will automatically:
- ✅ Filter for Pump.fun transactions only
- ✅ Filter for your current mint address
- ✅ Detect your wallets (FUNDING, DEV, Bundle, Holder)
- ✅ Show trades in real-time

## 🔍 Troubleshooting

**No webhooks received?**
- Check ngrok is still running
- Verify webhook URL in QuickNode is correct
- Make sure server is running on port 3001

**Trades not appearing?**
- Make sure a token is launched (mint address set)
- Check server logs for errors
- Verify filter function was saved correctly

**Need help?** Check the full guide: `SETUP_STEPS.md`
