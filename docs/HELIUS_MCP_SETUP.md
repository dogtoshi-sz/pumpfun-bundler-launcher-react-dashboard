# ⚡ Helius Integration & Feature Guide

## What is Helius?

**Helius** is a powerful Solana RPC provider with enhanced APIs for blockchain data, real-time streaming, and transaction parsing. Your project is ALREADY using Helius - this guide explains how to leverage it fully!

---

## 🎯 What You're Currently Using

### Real-Time Blockchain Queries
- Get token balances and metadata
- Fetch transaction history
- Analyze NFT collections
- Query account information
- Get token prices and market data
- Monitor wallet activities
- Track program interactions

### Use Cases for Your Project
- **Token Monitoring:** Track your launched tokens in real-time
- **Wallet Analysis:** Monitor holder wallet activities
- **Transaction Debugging:** Debug failed transactions instantly
- **Market Data:** Get live price feeds for your tokens
- **Portfolio Tracking:** Monitor all wallet holdings
- **Transaction History:** Analyze trading patterns

---

## 📋 Prerequisites

1. **Helius API Key**
   - Sign up at: https://helius.dev
   - Free tier available (100K credits/month)
   - Upgrade for more requests

2. **Claude Desktop or Cursor IDE**
   - MCP works with Claude Desktop app
   - Also works with Cursor IDE (you're already using it!)

3. **Node.js**
   - Version 18+ required
   - You already have this installed

---

## 🚀 Setup Instructions

### Step 1: Get Your Helius API Key

1. Go to https://helius.dev
2. Sign up for a free account
3. Create a new project
4. Copy your API key (looks like: `your-api-key-here`)
5. Keep it secure!

### Step 2: Install Helius MCP Server

**Option A: Via NPM (Recommended)**

```bash
npm install -g @helius-labs/helius-mcp-server
```

**Option B: From Source**

```bash
git clone https://github.com/helius-labs/helius-mcp-server.git
cd helius-mcp-server
npm install
npm run build
```

### Step 3: Configure MCP in Cursor

**For Cursor IDE:**

1. **Open Cursor Settings**
   - Press `Ctrl + ,` (or `Cmd + ,` on Mac)
   - Or go to: Settings → Extensions → MCP

2. **Add MCP Server Configuration**

Create or edit: `%APPDATA%\Cursor\User\globalStorage\mcp-config.json`

```json
{
  "mcpServers": {
    "helius": {
      "command": "npx",
      "args": [
        "-y",
        "@helius-labs/helius-mcp-server"
      ],
      "env": {
        "HELIUS_API_KEY": "your-helius-api-key-here"
      }
    }
  }
}
```

**For Claude Desktop:**

Edit: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "helius": {
      "command": "npx",
      "args": [
        "-y",
        "@helius-labs/helius-mcp-server"
      ],
      "env": {
        "HELIUS_API_KEY": "your-helius-api-key-here"
      }
    }
  }
}
```

### Step 4: Restart Cursor/Claude

1. Close Cursor/Claude completely
2. Reopen it
3. MCP server should auto-connect

---

## 🔧 Configuration Options

### Environment Variables

```json
{
  "env": {
    "HELIUS_API_KEY": "your-api-key",
    "HELIUS_NETWORK": "mainnet-beta",  // or "devnet"
    "HELIUS_RATE_LIMIT": "100",        // requests per minute
    "HELIUS_TIMEOUT": "30000"          // ms
  }
}
```

### Advanced Configuration

```json
{
  "mcpServers": {
    "helius": {
      "command": "npx",
      "args": ["-y", "@helius-labs/helius-mcp-server"],
      "env": {
        "HELIUS_API_KEY": "your-api-key",
        "HELIUS_NETWORK": "mainnet-beta",
        "HELIUS_WEBHOOKS_ENABLED": "true",
        "HELIUS_ENHANCED_TRANSACTIONS": "true"
      }
    }
  }
}
```

---

## 📝 Available MCP Tools

Once set up, you can use these tools directly in your AI assistant:

### 1. Get Token Balance

```
Can you check the SOL balance of this wallet: [wallet_address]?
```

### 2. Get Transaction History

```
Show me the last 10 transactions for wallet: [wallet_address]
```

### 3. Get Token Metadata

```
Get token information for mint: [token_mint_address]
```

### 4. Get Token Price

```
What's the current price of token: [token_mint]?
```

### 5. Get NFT Holdings

```
Show me all NFTs owned by: [wallet_address]
```

### 6. Analyze Transaction

```
Analyze this transaction: [transaction_signature]
```

### 7. Get Program Accounts

```
List all accounts owned by program: [program_id]
```

---

## 💡 Example Usage Scenarios

### Scenario 1: Monitor Your Launched Token

**You:** "Check the current holders and trading volume for my token [mint_address]"

**Claude with Helius MCP:** 
- Fetches token account data
- Shows holder count
- Calculates trading volume
- Shows recent transactions

### Scenario 2: Debug Failed Transaction

**You:** "Why did this transaction fail? [transaction_signature]"

**Claude with Helius MCP:**
- Retrieves full transaction details
- Shows error logs
- Identifies failed instructions
- Suggests fixes

### Scenario 3: Wallet Portfolio Tracking

**You:** "Show me the complete portfolio for wallet: [address]"

**Claude with Helius MCP:**
- Lists all token holdings
- Shows SOL balance
- Displays NFTs
- Calculates total value

### Scenario 4: Real-Time Monitoring

**You:** "Alert me when this wallet [address] makes a transaction"

**Claude with Helius MCP:**
- Sets up webhook monitoring
- Watches for transactions
- Notifies on activity

---

## 🎯 Integration with Your Project

### Use Case 1: Post-Launch Monitoring

After launching a token, use MCP to:

```
"Monitor my token [mint] for the next hour:
- Track holder count
- Watch for large buys/sells
- Calculate trading volume
- Show price movements"
```

### Use Case 2: Holder Wallet Analysis

```
"Analyze my holder wallets:
- Show balances for all wallets in holder-wallets.json
- Check for any stuck transactions
- List token holdings
- Calculate total portfolio value"
```

### Use Case 3: Transaction Debugging

```
"Debug my bundle transaction:
- Transaction: [sig]
- Why did it fail?
- Which wallet had issues?
- How to fix it?"
```

### Use Case 4: Market Research

```
"Research similar tokens:
- Find tokens with similar market cap
- Show their trading patterns
- Analyze holder distribution
- Compare launch strategies"
```

---

## 🔍 Verification Steps

After setup, verify MCP is working:

### Test 1: Simple Balance Check

```
Ask Claude: "What is the SOL balance of: So11111111111111111111111111111111111111112?"
```

Should return: WSOL token information

### Test 2: Transaction Lookup

```
Ask Claude: "Get details for transaction: [recent_solana_tx_sig]"
```

Should return: Full transaction details

### Test 3: Token Metadata

```
Ask Claude: "Get token info for: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
```

Should return: USDC token metadata

---

## ⚠️ Common Issues & Fixes

### Issue 1: "MCP Server Not Found"

**Solution:**
```bash
# Reinstall the MCP server
npm install -g @helius-labs/helius-mcp-server

# Verify installation
npx @helius-labs/helius-mcp-server --version
```

### Issue 2: "API Key Invalid"

**Solution:**
1. Check your API key at https://helius.dev
2. Make sure no extra spaces in config
3. Verify the key is active
4. Check for quotation marks around the key

### Issue 3: "Connection Timeout"

**Solution:**
```json
{
  "env": {
    "HELIUS_API_KEY": "your-key",
    "HELIUS_TIMEOUT": "60000"  // Increase timeout
  }
}
```

### Issue 4: "Rate Limit Exceeded"

**Solution:**
1. Upgrade your Helius plan
2. Add rate limiting in config:
```json
{
  "env": {
    "HELIUS_RATE_LIMIT": "50"  // Lower rate
  }
}
```

### Issue 5: "Cursor Not Recognizing MCP"

**Solution:**
1. Make sure config file is in correct location
2. Restart Cursor completely
3. Check Cursor version (needs latest)
4. Look for MCP icon in Cursor status bar

---

## 📊 Rate Limits & Pricing

### Free Tier
- **100,000 credits/month**
- ~100,000 basic requests
- Perfect for testing

### Developer Tier ($49/month)
- **1,000,000 credits/month**
- Enhanced transaction parsing
- Webhook support

### Production Tier ($299/month)
- **10,000,000 credits/month**
- Priority support
- Custom rate limits

### Enterprise
- Custom pricing
- Dedicated infrastructure
- SLA guarantees

---

## 🛠️ Advanced Features

### Webhooks (Paid Plans)

Monitor wallet activity in real-time:

```json
{
  "env": {
    "HELIUS_WEBHOOKS_ENABLED": "true",
    "HELIUS_WEBHOOK_URL": "https://your-endpoint.com/webhook"
  }
}
```

### Enhanced Transactions (Paid Plans)

Get human-readable transaction descriptions:

```json
{
  "env": {
    "HELIUS_ENHANCED_TRANSACTIONS": "true"
  }
}
```

### Custom RPC Endpoints

Use specific Solana clusters:

```json
{
  "env": {
    "HELIUS_RPC_URL": "https://mainnet.helius-rpc.com/?api-key=YOUR_KEY"
  }
}
```

---

## 📚 Useful Commands for Your Workflow

### Daily Operations

```bash
# Check your token's stats
"Show stats for token: [your_mint]"

# Monitor holder wallets
"Check balances for these wallets: [wallet1, wallet2, wallet3]"

# Debug transaction
"Why did this tx fail: [signature]"

# Price check
"What's the current price of: [token_mint]"
```

### Launch Day

```bash
# Pre-launch check
"Is my DEV wallet funded? [dev_wallet_address]"

# Post-launch monitoring
"Monitor [token_mint] for the next hour - show all transactions"

# Holder analysis
"Show holder distribution for: [token_mint]"

# Volume tracking
"Calculate 24h volume for: [token_mint]"
```

### Portfolio Management

```bash
# Check all holdings
"Show portfolio for: [main_wallet]"

# Track profits
"Calculate P&L for wallet: [wallet] since [date]"

# Find opportunities
"Show top gainers in the last 24h"
```

---

## 🔗 Additional Resources

### Official Documentation
- **Helius Docs**: https://docs.helius.dev
- **MCP Docs**: https://docs.helius.dev/mcp
- **API Reference**: https://docs.helius.dev/api-reference

### GitHub
- **Helius MCP Server**: https://github.com/helius-labs/helius-mcp-server
- **Issues/Support**: https://github.com/helius-labs/helius-mcp-server/issues

### Support
- **Discord**: https://discord.gg/helius
- **Twitter**: @heliuslabs
- **Email**: support@helius.dev

---

## ✅ Setup Checklist

- [ ] Sign up for Helius account
- [ ] Get API key
- [ ] Install MCP server (`npm install -g @helius-labs/helius-mcp-server`)
- [ ] Create/edit MCP config file
- [ ] Add API key to config
- [ ] Restart Cursor/Claude
- [ ] Test with simple balance query
- [ ] Verify connection works
- [ ] Bookmark this guide for reference

---

## 🎉 You're Ready!

Once set up, you can ask your AI assistant to:
- Monitor your tokens in real-time
- Debug transactions instantly
- Track wallet activities
- Get market insights
- Analyze on-chain data

All without leaving your IDE! 🚀

---

**Last Updated**: January 2026
