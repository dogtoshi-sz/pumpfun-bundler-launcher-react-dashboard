# 🔥 Helius Data Stream Setup - Monitor Pump.fun Token Transactions

## 🎯 Goal
Set up Helius to monitor **both past and current transactions** for any pump.fun token.

---

## 📋 Two Approaches

### Option 1: Helius Webhooks (Recommended for Production)
- ✅ Get **past transactions** via API
- ✅ Get **real-time transactions** via webhooks
- ✅ More reliable (server-side)
- ✅ Works even if your app is offline
- ⚠️ Requires Production tier ($299/mo) or higher

### Option 2: Enhanced WebSocket (What You Have Now)
- ✅ Real-time transactions
- ✅ Included in Developer tier ($49/mo)
- ❌ No direct access to past transactions (need to fetch separately)
- ⚠️ Must keep connection open

---

## 🚀 Option 1: Helius Webhooks Setup

### Step 1: Get Your Helius API Key

You already have this in your `.env`:
```
HELIUS_API_KEY=3b5d538f-5257-470c-90e1-1d429b1c48d6
```

### Step 2: Create a Webhook

**For a specific pump.fun token mint address:**

```bash
curl -X POST "https://api.helius.xyz/v0/webhooks?api-key=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "webhookURL": "https://your-server.com/webhook",
    "transactionTypes": ["Any"],
    "accountAddresses": ["TOKEN_MINT_ADDRESS"],
    "webhookType": "enhanced"
  }'
```

**For ALL pump.fun transactions (monitor the program):**

```bash
curl -X POST "https://api.helius.xyz/v0/webhooks?api-key=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "webhookURL": "https://your-server.com/webhook",
    "transactionTypes": ["Any"],
    "accountAddresses": ["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"],
    "webhookType": "enhanced"
  }'
```

**Note:** Replace:
- `YOUR_API_KEY` with your actual API key
- `TOKEN_MINT_ADDRESS` with the pump.fun token mint address
- `https://your-server.com/webhook` with your webhook endpoint URL

### Step 3: Set Up Webhook Endpoint

Create a server endpoint to receive webhook events:

```javascript
// webhook-server.js
const express = require('express');
const app = express();

app.use(express.json());

app.post('/webhook', async (req, res) => {
  const events = req.body;
  
  // Helius sends an array of events
  for (const event of events) {
    // Process each transaction
    const signature = event.signature;
    const timestamp = event.timestamp;
    const type = event.type; // 'TRANSFER', 'SWAP', etc.
    
    // Check if it's a pump.fun transaction
    if (event.source === 'PUMP_FUN' || event.type === 'SWAP') {
      console.log('Pump.fun transaction detected:', {
        signature,
        type,
        timestamp,
        token: event.tokenTransfers?.[0]?.mint,
        amount: event.tokenTransfers?.[0]?.tokenAmount,
        buyer: event.tokenTransfers?.[0]?.fromUserAccount,
        seller: event.tokenTransfers?.[0]?.toUserAccount
      });
      
      // Your logic here (auto-sell, logging, etc.)
    }
  }
  
  res.status(200).send('OK');
});

app.listen(3000, () => {
  console.log('Webhook server running on port 3000');
});
```

### Step 4: Get Past Transactions

Use Helius API to fetch historical transactions:

```javascript
// get-past-transactions.js
const fetch = require('node-fetch');

async function getPastTransactions(mintAddress, limit = 100) {
  const apiKey = 'YOUR_API_KEY';
  
  // Get transaction signatures for the mint address
  const response = await fetch(
    `https://mainnet.helius-rpc.com/?api-key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'my-id',
        method: 'getSignaturesForAddress',
        params: [
          mintAddress,
          { limit }
        ]
      })
    }
  );
  
  const data = await response.json();
  const signatures = data.result.map(tx => tx.signature);
  
  // Get enhanced transaction details
  const transactions = await Promise.all(
    signatures.map(async (sig) => {
      const txResponse = await fetch(
        `https://api.helius.xyz/v0/transactions/${sig}?api-key=${apiKey}`
      );
      return txResponse.json();
    })
  );
  
  return transactions;
}

// Usage
getPastTransactions('YOUR_TOKEN_MINT_ADDRESS', 100)
  .then(txs => {
    console.log(`Found ${txs.length} past transactions`);
    txs.forEach(tx => {
      console.log('Transaction:', tx.signature);
      console.log('Type:', tx.type);
      console.log('Timestamp:', tx.timestamp);
    });
  });
```

---

## 🔌 Option 2: Enhanced WebSocket (Current Setup)

You already have this set up! Here's how to use it for any pump.fun token:

### Monitor Specific Token

```javascript
// monitor-token.js
const WebSocket = require('ws');
const { Connection } = require('@solana/web3.js');

const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const TOKEN_MINT_ADDRESS = 'YOUR_TOKEN_MINT_ADDRESS'; // The pump.fun token you want to monitor
const HELIUS_API_KEY = 'YOUR_API_KEY';
const WS_URL = `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

const ws = new WebSocket(WS_URL);
const connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`);

// Track processed transactions
const processedSignatures = new Set();

ws.on('open', () => {
  console.log('✅ Connected to Helius WebSocket');
  
  // Subscribe to Pump.fun program logs
  const subscribeMessage = {
    jsonrpc: '2.0',
    id: 1,
    method: 'logsSubscribe',
    params: [
      {
        mentions: [PUMP_PROGRAM_ID] // All pump.fun transactions
      },
      {
        commitment: 'confirmed'
      }
    ]
  };
  
  ws.send(JSON.stringify(subscribeMessage));
  console.log('📡 Subscribed to Pump.fun program logs');
});

ws.on('message', async (data) => {
  try {
    const message = JSON.parse(data.toString());
    
    // Handle subscription confirmation
    if (message.id === 1 && message.result) {
      console.log('✅ Subscription confirmed:', message.result);
      return;
    }
    
    // Handle log notifications
    if (message.method === 'logsNotification' && message.params) {
      const { result } = message.params;
      if (result?.value?.signature) {
        const signature = result.value.signature;
        
        // Avoid processing duplicates
        if (processedSignatures.has(signature)) {
          return;
        }
        processedSignatures.add(signature);
        
        // Fetch full transaction
        try {
          const tx = await connection.getParsedTransaction(signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0
          });
          
          if (tx && tx.meta) {
            // Check if this transaction involves our token
            const accountKeys = tx.transaction.message.accountKeys || [];
            const hasOurToken = accountKeys.some(key => {
              const addr = typeof key === 'string' ? key : key.pubkey?.toString();
              return addr === TOKEN_MINT_ADDRESS;
            });
            
            // Also check token balances
            const tokenBalances = [
              ...(tx.meta.preTokenBalances || []),
              ...(tx.meta.postTokenBalances || [])
            ];
            const hasTokenInBalances = tokenBalances.some(
              bal => bal.mint === TOKEN_MINT_ADDRESS
            );
            
            if (hasOurToken || hasTokenInBalances) {
              console.log('🎯 Transaction for your token:', signature);
              console.log('   Type:', determineTransactionType(tx));
              console.log('   Accounts:', accountKeys.length);
              
              // Process the transaction
              processTransaction(tx, signature);
            }
          }
        } catch (error) {
          console.error('Error fetching transaction:', error.message);
        }
      }
    }
  } catch (error) {
    console.error('Error parsing message:', error);
  }
});

function determineTransactionType(tx) {
  // Analyze transaction to determine if it's a buy or sell
  // Check token balance changes, SOL transfers, etc.
  const meta = tx.meta;
  const preBalances = meta.preBalances || [];
  const postBalances = meta.postBalances || [];
  
  // Simple heuristic: if SOL decreased significantly, likely a buy
  // If SOL increased, likely a sell
  // You can enhance this with more sophisticated logic
  
  return 'UNKNOWN'; // Implement your logic here
}

function processTransaction(tx, signature) {
  // Your transaction processing logic
  // - Log to database
  // - Trigger auto-sell
  // - Update UI
  // - etc.
  console.log('Processing transaction:', signature);
}

ws.on('error', (error) => {
  console.error('WebSocket error:', error);
});

ws.on('close', () => {
  console.log('WebSocket closed, reconnecting...');
  setTimeout(() => {
    // Reconnect logic
    connect();
  }, 1000);
});
```

### Get Past Transactions First

Before starting WebSocket monitoring, fetch past transactions:

```javascript
// get-past-tx-for-token.js
const { Connection, PublicKey } = require('@solana/web3.js');

async function getPastTransactionsForToken(mintAddress) {
  const apiKey = 'YOUR_API_KEY';
  const connection = new Connection(
    `https://mainnet.helius-rpc.com/?api-key=${apiKey}`
  );
  
  const mintPubkey = new PublicKey(mintAddress);
  
  // Get all token accounts for this mint
  const tokenAccounts = await connection.getParsedTokenAccountsByMint(mintPubkey);
  
  console.log(`Found ${tokenAccounts.value.length} token accounts`);
  
  // Get transactions for each token account
  const allTransactions = [];
  
  for (const account of tokenAccounts.value) {
    const owner = account.account.data.parsed.info.owner;
    const signatures = await connection.getSignaturesForAddress(
      new PublicKey(owner),
      { limit: 100 }
    );
    
    // Fetch full transaction details
    for (const sigInfo of signatures) {
      const tx = await connection.getParsedTransaction(sigInfo.signature, {
        maxSupportedTransactionVersion: 0
      });
      
      if (tx && tx.meta) {
        // Check if this transaction involves our mint
        const tokenBalances = [
          ...(tx.meta.preTokenBalances || []),
          ...(tx.meta.postTokenBalances || [])
        ];
        
        const involvesOurToken = tokenBalances.some(
          bal => bal.mint === mintAddress
        );
        
        if (involvesOurToken) {
          allTransactions.push({
            signature: sigInfo.signature,
            timestamp: sigInfo.blockTime,
            transaction: tx
          });
        }
      }
    }
  }
  
  // Sort by timestamp (newest first)
  allTransactions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  
  return allTransactions;
}

// Usage
getPastTransactionsForToken('YOUR_TOKEN_MINT_ADDRESS')
  .then(txs => {
    console.log(`Found ${txs.length} past transactions`);
    txs.forEach(tx => {
      console.log(`\nTransaction: ${tx.signature}`);
      console.log(`Time: ${new Date(tx.timestamp * 1000).toISOString()}`);
    });
  });
```

---

## 🎯 Complete Solution: Monitor Any Pump.fun Token

Here's a complete script that:
1. Gets past transactions
2. Monitors real-time transactions
3. Works for any pump.fun token

```javascript
// monitor-pump-token.js
const WebSocket = require('ws');
const { Connection, PublicKey } = require('@solana/web3.js');
const fs = require('fs');

class PumpTokenMonitor {
  constructor(mintAddress, apiKey) {
    this.mintAddress = mintAddress;
    this.apiKey = apiKey;
    this.ws = null;
    this.connection = new Connection(
      `https://mainnet.helius-rpc.com/?api-key=${apiKey}`
    );
    this.processedSignatures = new Set();
    this.transactionHistory = [];
    this.PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
  }
  
  async initialize() {
    console.log(`🔍 Initializing monitor for token: ${this.mintAddress}`);
    
    // Step 1: Get past transactions
    await this.getPastTransactions();
    
    // Step 2: Start real-time monitoring
    this.startRealTimeMonitoring();
  }
  
  async getPastTransactions(limit = 100) {
    console.log('📜 Fetching past transactions...');
    
    try {
      // Get all token accounts for this mint
      const mintPubkey = new PublicKey(this.mintAddress);
      const tokenAccounts = await this.connection.getParsedTokenAccountsByMint(mintPubkey);
      
      console.log(`Found ${tokenAccounts.value.length} token accounts`);
      
      // Get recent transactions from Pump.fun program
      const pumpProgram = new PublicKey(this.PUMP_PROGRAM_ID);
      const signatures = await this.connection.getSignaturesForAddress(
        pumpProgram,
        { limit: 1000 } // Get more to filter
      );
      
      console.log(`Found ${signatures.length} Pump.fun transactions, filtering...`);
      
      // Fetch and filter transactions
      const relevantTxs = [];
      for (const sigInfo of signatures.slice(0, 100)) { // Limit to avoid rate limits
        try {
          const tx = await this.connection.getParsedTransaction(
            sigInfo.signature,
            { maxSupportedTransactionVersion: 0 }
          );
          
          if (tx && tx.meta) {
            // Check if transaction involves our token
            const accountKeys = tx.transaction.message.accountKeys || [];
            const hasOurToken = accountKeys.some(key => {
              const addr = typeof key === 'string' 
                ? key 
                : (key.pubkey ? key.pubkey.toString() : key.toString());
              return addr === this.mintAddress;
            });
            
            // Also check token balances
            const tokenBalances = [
              ...(tx.meta.preTokenBalances || []),
              ...(tx.meta.postTokenBalances || [])
            ];
            const hasTokenInBalances = tokenBalances.some(
              bal => bal.mint === this.mintAddress
            );
            
            if (hasOurToken || hasTokenInBalances) {
              relevantTxs.push({
                signature: sigInfo.signature,
                timestamp: sigInfo.blockTime,
                transaction: tx
              });
              this.processedSignatures.add(sigInfo.signature);
            }
          }
        } catch (error) {
          // Skip failed fetches
          continue;
        }
      }
      
      // Sort by timestamp
      relevantTxs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      
      console.log(`✅ Found ${relevantTxs.length} past transactions for this token`);
      
      // Process past transactions
      relevantTxs.forEach(tx => {
        this.processTransaction(tx.transaction, tx.signature, tx.timestamp);
      });
      
      this.transactionHistory = relevantTxs;
      
    } catch (error) {
      console.error('Error fetching past transactions:', error);
    }
  }
  
  startRealTimeMonitoring() {
    console.log('🔴 Starting real-time monitoring...');
    
    const wsUrl = `wss://mainnet.helius-rpc.com/?api-key=${this.apiKey}`;
    this.ws = new WebSocket(wsUrl);
    
    this.ws.on('open', () => {
      console.log('✅ Connected to Helius WebSocket');
      
      // Subscribe to Pump.fun program logs
      const subscribeMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'logsSubscribe',
        params: [
          {
            mentions: [this.PUMP_PROGRAM_ID]
          },
          {
            commitment: 'confirmed'
          }
        ]
      };
      
      this.ws.send(JSON.stringify(subscribeMessage));
    });
    
    this.ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.id === 1 && message.result) {
          console.log('✅ Subscribed to Pump.fun logs');
          return;
        }
        
        if (message.method === 'logsNotification' && message.params) {
          const { result } = message.params;
          if (result?.value?.signature) {
            const signature = result.value.signature;
            
            if (this.processedSignatures.has(signature)) {
              return;
            }
            
            // Fetch and check transaction
            try {
              const tx = await this.connection.getParsedTransaction(signature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0
              });
              
              if (tx && tx.meta) {
                // Check if involves our token
                const accountKeys = tx.transaction.message.accountKeys || [];
                const hasOurToken = accountKeys.some(key => {
                  const addr = typeof key === 'string'
                    ? key
                    : (key.pubkey ? key.pubkey.toString() : key.toString());
                  return addr === this.mintAddress;
                });
                
                const tokenBalances = [
                  ...(tx.meta.preTokenBalances || []),
                  ...(tx.meta.postTokenBalances || [])
                ];
                const hasTokenInBalances = tokenBalances.some(
                  bal => bal.mint === this.mintAddress
                );
                
                if (hasOurToken || hasTokenInBalances) {
                  this.processedSignatures.add(signature);
                  this.processTransaction(tx, signature, Math.floor(Date.now() / 1000));
                }
              }
            } catch (error) {
              // Transaction might not be available yet
            }
          }
        }
      } catch (error) {
        console.error('Error handling message:', error);
      }
    });
    
    this.ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
    
    this.ws.on('close', () => {
      console.log('WebSocket closed, reconnecting in 5s...');
      setTimeout(() => {
        this.startRealTimeMonitoring();
      }, 5000);
    });
  }
  
  processTransaction(tx, signature, timestamp) {
    const timestampDate = timestamp 
      ? new Date(timestamp * 1000).toISOString()
      : new Date().toISOString();
    
    console.log(`\n🎯 Transaction detected: ${signature}`);
    console.log(`   Time: ${timestampDate}`);
    console.log(`   Token: ${this.mintAddress}`);
    
    // Analyze transaction type
    const meta = tx.meta;
    const accountKeys = tx.transaction.message.accountKeys || [];
    
    // Determine if buy or sell
    // (Implement your logic here based on token balance changes, SOL transfers, etc.)
    
    // Add to history
    this.transactionHistory.push({
      signature,
      timestamp: timestamp || Math.floor(Date.now() / 1000),
      transaction: tx
    });
    
    // Keep only last 1000
    if (this.transactionHistory.length > 1000) {
      this.transactionHistory.shift();
    }
    
    // Your custom logic here
    // - Save to database
    // - Trigger auto-sell
    // - Update UI
    // - etc.
  }
  
  getHistory() {
    return this.transactionHistory;
  }
  
  stop() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

// Usage
const mintAddress = process.argv[2] || 'YOUR_TOKEN_MINT_ADDRESS';
const apiKey = process.argv[3] || 'YOUR_API_KEY';

const monitor = new PumpTokenMonitor(mintAddress, apiKey);
monitor.initialize();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Stopping monitor...');
  monitor.stop();
  process.exit(0);
});
```

---

## 🚀 Quick Start

1. **Install dependencies:**
```bash
npm install ws @solana/web3.js
```

2. **Run the monitor:**
```bash
node monitor-pump-token.js YOUR_TOKEN_MINT_ADDRESS YOUR_API_KEY
```

3. **It will:**
   - Fetch past transactions
   - Start monitoring real-time transactions
   - Log all transactions for that token

---

## 📝 Notes

- **Webhooks** require Production tier ($299/mo) or higher
- **WebSocket** works with Developer tier ($49/mo) - what you have now
- For **past transactions**, you need to fetch them via API (included in your plan)
- **Rate limits**: Be mindful of Helius credit usage when fetching past transactions

---

## 🔗 Resources

- Helius Webhooks Docs: https://docs.helius.dev/webhooks
- Helius WebSocket Docs: https://docs.helius.dev/websockets
- Helius API Reference: https://docs.helius.dev/api-reference
