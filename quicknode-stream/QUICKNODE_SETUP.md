# QuickNode Stream Webhook Setup Guide

## Overview
This guide will help you set up QuickNode stream webhook to receive real-time Pump.fun trade data.

## Step 1: Get Your Webhook URL

Your webhook endpoint is:
```
http://YOUR_SERVER_IP:3001/api/quicknode-webhook
```

**For local development**, use ngrok to expose your local server:
```bash
ngrok http 3001
# Use the ngrok URL: https://xxxx.ngrok.io/api/quicknode-webhook
```

**For production**, use your public server URL:
```
https://yourdomain.com/api/quicknode-webhook
```

**Important**: The webhook must be accessible from the internet for QuickNode to send data.

## Step 2: Configure QuickNode Stream

1. Go to QuickNode Dashboard → Streams
2. Create a new stream or edit existing one
3. Configure:
   - **Network**: Solana Mainnet
   - **Dataset**: Block
   - **Stream Destination**: Webhook
   - **Webhook URL**: `http://YOUR_SERVER/api/quicknode-webhook`
   - **Custom Headers** (Security - Recommended):
     - Header Name: `x-quicknode-token`
     - Header Value: `qnsec_YTMwNzIyMmQtMGFhMS00OTM3LTg2YzktMDMwYjBmOGYzYmQ1`
     - This token is stored in your `.env` file as `QUICKNODE_SECURITY_TOKEN`
     - The server will reject webhook requests without this token

## Step 3: Add Filter Function

In QuickNode's "Modify the stream payload" section, paste the filter function from:
- `quicknode-stream-perchatgpt` (recommended - more detailed)
- OR `finalpayload` (simpler version)

The filter function will:
- Parse Pump.fun transactions
- Extract buy/sell events
- Calculate SOL amounts, token amounts, prices
- Filter for Pump.fun program ID: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`

## Step 4: Test the Webhook

1. Make sure your API server is running
2. Launch a token (or use existing token)
3. The webhook will automatically filter for the current mint address
4. Check server logs for `[QuickNode] 📥 Webhook received` messages

## Step 5: Verify Integration

- Trades should appear in the terminal automatically
- Check console logs: `[QuickNode] ✅ Processed X trade(s) from webhook`
- Trades from your wallets will be marked with wallet type (FUNDING, DEV, Bundle, Holder)

## Troubleshooting

### Webhook not receiving data
- Check that your server is accessible from the internet
- Verify the webhook URL in QuickNode dashboard
- Check server logs for errors

### Trades not appearing
- Ensure a token is launched (mint address set)
- Check that the filter function is correctly pasted
- Verify the mint address matches in QuickNode filter

### Too many webhooks
- The filter should only send Pump.fun transactions
- Consider adding additional filtering in the filter function if needed

## Filter Function Location

Use the filter from: `quicknode-stream-perchatgpt`

This provides:
- Buy/sell detection using discriminators
- SOL and token amount calculations
- Price and market cap estimates
- Big buy detection

## Notes

- The webhook automatically filters for the current mint address
- Duplicate transactions are automatically skipped
- The system integrates with existing live trades tracker
- Wallet detection works automatically (FUNDING, DEV, Bundle, Holder)
