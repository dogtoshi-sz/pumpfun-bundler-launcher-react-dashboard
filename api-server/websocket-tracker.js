// Real-time transaction tracker using Helius Enhanced WebSocket
// Ultra-low latency buy/sell detection for auto-sell on external buys

const WebSocket = require('ws');
const { PublicKey, Connection } = require('@solana/web3.js');
const base58 = require('bs58').default || require('bs58');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

// Create Connection for fetching transactions
let solanaConnection = null;

class WebSocketTracker {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.subscriptionId = null;
    this.currentMintAddress = null;
    this.ourWalletAddresses = new Set();
    this.autoSellEnabled = false;
    this.autoSellThreshold = 0.1; // SOL threshold
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000; // Start with 1 second
    this.apiKey = null;
    this.wsUrl = null;
    this.rpcEndpoint = null; // For Connection object
    this.eventListeners = []; // For SSE clients
    this.transactionHistory = []; // Store last 100 transactions
    this.maxHistorySize = 100;
    this.processedSignatures = new Set(); // Track processed transactions to avoid duplicates
    
    // External buy aggregation for threshold-based auto-sell
    this.externalBuyVolume = 0; // Cumulative SOL volume from external buys
    this.externalBuyThreshold = 1.0; // Default: 1 SOL total
    this.externalBuyWindow = 60000; // 60 second window to aggregate buys
    this.externalBuyStartTime = null;
    this.sellTriggered = false; // Prevent multiple triggers
    this.externalBuyTransactions = []; // Track individual buys for logging
    this.simulationMode = false; // Simulation mode - don't actually sell
    this.logsReceived = 0; // Count logs received for debugging
    this.transactionsFetched = 0; // Count transactions fetched
    this.autoSellType = 'rapid-sell'; // 'rapid-sell' or 'rapid-sell-50-percent'
    this.pendingTransactions = new Set(); // Track transactions being fetched
    this.priorityQueue = []; // Priority queue for transactions mentioning our mint
  }

  // Add event listener (for SSE)
  addEventListener(callback) {
    this.eventListeners.push(callback);
    // Send recent history to new listener
    if (this.transactionHistory.length > 0) {
      this.transactionHistory.forEach(tx => {
        try {
          callback(tx);
        } catch (err) {
          console.error('[WebSocket] Error sending history to listener:', err);
        }
      });
    }
  }

  // Remove event listener
  removeEventListener(callback) {
    this.eventListeners = this.eventListeners.filter(cb => cb !== callback);
  }

  // Emit transaction event to all listeners
  emitTransaction(txData) {
    // Add to history
    this.transactionHistory.push(txData);
    if (this.transactionHistory.length > this.maxHistorySize) {
      this.transactionHistory.shift(); // Remove oldest
    }

    // Send to all listeners
    this.eventListeners.forEach(callback => {
      try {
        callback(txData);
      } catch (err) {
        console.error('[WebSocket] Error emitting transaction to listener:', err);
      }
    });
  }

  // Initialize with API key from .env
  initialize() {
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const lines = envContent.split('\n');
      
      // First, try to get RPC_WEBSOCKET_ENDPOINT directly (preferred)
      let wsEndpoint = null;
      lines.forEach(line => {
        const wsMatch = line.match(/^RPC_WEBSOCKET_ENDPOINT=(.*)$/);
        if (wsMatch) {
          wsEndpoint = wsMatch[1].trim();
        }
      });
      
      // Extract RPC_ENDPOINT for Connection object
      lines.forEach(line => {
        const match = line.match(/^RPC_ENDPOINT=(.*)$/);
        if (match) {
          this.rpcEndpoint = match[1].trim();
        }
      });
      
      // If we have a WebSocket endpoint, use it directly
      if (wsEndpoint) {
        this.wsUrl = wsEndpoint;
        // Extract API key for logging
        const apiKeyMatch = wsEndpoint.match(/api-key=([^&]+)/);
        if (apiKeyMatch) {
          this.apiKey = apiKeyMatch[1];
        }
        console.log('[WebSocket] Using WebSocket endpoint from RPC_WEBSOCKET_ENDPOINT');
      } else {
        // Fallback: Extract from RPC_ENDPOINT
        lines.forEach(line => {
          const match = line.match(/^RPC_ENDPOINT=(.*)$/);
          if (match) {
            const rpcUrl = match[1].trim();
            const apiKeyMatch = rpcUrl.match(/api-key=([^&]+)/);
            if (apiKeyMatch) {
              this.apiKey = apiKeyMatch[1];
              // Use standard WebSocket endpoint (more compatible)
              this.wsUrl = `wss://mainnet.helius-rpc.com/?api-key=${this.apiKey}`;
              console.log('[WebSocket] Using Helius Standard WebSocket (extracted from RPC_ENDPOINT)');
            }
          }
        });
      }
      
      // Initialize Connection for fetching transactions
      if (this.rpcEndpoint) {
        // Use 'processed' commitment for fastest possible transaction fetching
        // 'processed' returns immediately when validator sees transaction (faster than 'confirmed')
        solanaConnection = new Connection(this.rpcEndpoint, 'processed');
        console.log('[WebSocket] ✅ Initialized Solana Connection for transaction fetching');
      }
    }

    if (!this.apiKey || !this.wsUrl) {
      console.error('[WebSocket] ERROR: Could not extract Helius API key or WebSocket endpoint from .env');
      console.error('[WebSocket] Make sure RPC_WEBSOCKET_ENDPOINT or RPC_ENDPOINT is set in .env');
      return false;
    }

    return true;
  }

  // Update our wallet addresses (dev + bundler wallets)
  updateOurWallets(walletAddresses) {
    this.ourWalletAddresses = new Set(walletAddresses.map(addr => addr.toLowerCase()));
    console.log(`[WebSocket] Updated our wallets: ${this.ourWalletAddresses.size} addresses`);
    // Log first few wallet addresses for debugging
    const walletList = Array.from(this.ourWalletAddresses).slice(0, 3);
    console.log(`[WebSocket] 🔍 Excluding wallets: ${walletList.map(w => w.slice(0, 8) + '...').join(', ')}${this.ourWalletAddresses.size > 3 ? '...' : ''}`);
  }

  // Start tracking a specific mint address
  startTracking(mintAddress, ourWallets, autoSell = false, threshold = 0.1, externalBuyThreshold = 1.0, externalBuyWindow = 60000, simulationMode = false, autoSellType = 'rapid-sell') {
    if (!this.initialize()) {
      return false;
    }

    this.currentMintAddress = mintAddress;
    this.updateOurWallets(ourWallets);
    this.autoSellEnabled = autoSell;
    this.autoSellThreshold = threshold;
    this.externalBuyThreshold = externalBuyThreshold; // Cumulative threshold
    this.externalBuyWindow = externalBuyWindow; // Time window in ms
    this.simulationMode = simulationMode; // Simulation mode flag
    this.autoSellType = autoSellType; // 'rapid-sell' or 'rapid-sell-50-percent'
    
    // Reset aggregation
    this.externalBuyVolume = 0;
    this.externalBuyStartTime = null;
    this.sellTriggered = false;
    this.externalBuyTransactions = [];

    console.log(`[WebSocket] Starting tracking for mint: ${mintAddress}`);
    console.log(`[WebSocket] Auto-sell enabled: ${autoSell}`);
    console.log(`[WebSocket] External buy threshold: ${externalBuyThreshold} SOL (cumulative)`);
    console.log(`[WebSocket] Aggregation window: ${externalBuyWindow / 1000}s`);
    if (simulationMode) {
      console.log(`[WebSocket] 🧪 SIMULATION MODE - No actual selling will occur`);
    }

    this.connect();
    return true;
  }

  // Stop tracking
  stopTracking() {
    if (this.subscriptionId !== null) {
      this.unsubscribe();
    }
    if (this.ws && this.isConnected) {
      this.ws.close();
    }
    this.currentMintAddress = null;
    console.log('[WebSocket] Stopped tracking');
  }

  // Connect to Helius Enhanced WebSocket
  connect() {
    if (this.ws && this.isConnected) {
      console.log('[WebSocket] Already connected');
      return;
    }

    console.log(`[WebSocket] Connecting to: ${this.wsUrl?.replace(this.apiKey, 'API_KEY')}`);
    
    this.ws = new WebSocket(this.wsUrl);

    this.ws.on('open', () => {
      console.log('[WebSocket] ✅ Connected to Helius Enhanced WebSocket');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
      this.subscribe();
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        // Only log errors, not every message
        if (message.error) {
          console.error(`[WebSocket] ❌ Error:`, message.error);
        }
        this.handleMessage(message);
      } catch (error) {
        console.error('[WebSocket] Error parsing message:', error);
      }
    });

    this.ws.on('error', (error) => {
      console.error('[WebSocket] Error:', error.message);
    });

    this.ws.on('close', () => {
      console.log('[WebSocket] Connection closed');
      this.isConnected = false;
      this.subscriptionId = null;
      this.attemptReconnect();
    });

    // Keep connection alive and show status
    setInterval(() => {
      if (this.ws && this.isConnected) {
        this.ws.ping();
        console.log(`[WebSocket] 💓 Connection alive (${this.subscriptionId ? 'Subscribed' : 'Not subscribed yet'})`);
      }
    }, 30000);
    
    // Show status every 10 seconds (more frequent updates)
    setInterval(() => {
      if (this.isConnected) {
        const simTag = this.simulationMode ? ' [SIM]' : '';
        if (this.externalBuyVolume > 0) {
          console.log(`[WebSocket] 📊 External Buy Volume${simTag}: ${this.externalBuyVolume.toFixed(4)}/${this.externalBuyThreshold.toFixed(4)} SOL`);
        } else {
          // Show that we're still listening (but not spamming)
          const status = this.subscriptionId ? '✅ Subscribed' : '⏳ Waiting for subscription...';
          console.log(`[WebSocket] 👂 ${status}${simTag}... (${this.logsReceived} logs received, ${this.transactionsFetched} transactions checked)`);
        }
      }
    }, 10000);
  }

  // Subscribe to Pump.fun program transactions
  subscribe() {
    if (!this.currentMintAddress) {
      console.error('[WebSocket] No mint address set for subscription');
      return;
    }

    // Helius standard WebSocket doesn't support transactionSubscribe
    // Use logsSubscribe to track transaction logs from Pump.fun program
    // Note: mentions only supports 1 address, so we subscribe to Pump.fun program and filter in code
    const logsSubscribeMessage = {
      jsonrpc: '2.0',
      id: 1,
      method: 'logsSubscribe',
      params: [
        {
          mentions: [PUMP_PROGRAM_ID] // Only 1 address supported - subscribe to all Pump.fun transactions
        },
        {
          commitment: 'confirmed'
        }
      ]
    };

    console.log('[WebSocket] Subscribing to Pump.fun transaction logs...');
    console.log(`[WebSocket] Will filter for mint: ${this.currentMintAddress.slice(0, 8)}... in code`);
    console.log('[WebSocket] Using logsSubscribe (Helius standard endpoint)');
    this.ws.send(JSON.stringify(logsSubscribeMessage));
    
    // Also subscribe to account changes for the mint (for token balance changes)
    setTimeout(() => {
      const accountSubscribeMessage = {
        jsonrpc: '2.0',
        id: 2,
        method: 'accountSubscribe',
        params: [
          this.currentMintAddress,
          {
            encoding: 'jsonParsed',
            commitment: 'confirmed'
          }
        ]
      };
      console.log('[WebSocket] Also subscribing to mint account changes...');
      this.ws.send(JSON.stringify(accountSubscribeMessage));
    }, 1000);
  }

  // Unsubscribe
  unsubscribe() {
    if (this.subscriptionId !== null) {
      const unsubscribeMessage = {
        jsonrpc: '2.0',
        id: 2,
        method: 'transactionUnsubscribe',
        params: [this.subscriptionId]
      };
      this.ws.send(JSON.stringify(unsubscribeMessage));
      this.subscriptionId = null;
      console.log('[WebSocket] Unsubscribed');
    }
  }

  // Handle incoming messages
  handleMessage(message) {
    // Handle subscription confirmation
    if (message.id === 1 && message.result) {
      this.subscriptionId = message.result;
      console.log(`[WebSocket] ✅ Logs subscription confirmed! Subscription ID: ${this.subscriptionId}`);
      console.log(`[WebSocket] 🎯 Now listening for transaction logs on Pump.fun program...`);
      return;
    }
    
    if (message.id === 2 && message.result) {
      console.log(`[WebSocket] ✅ Account subscription confirmed! Subscription ID: ${message.result}`);
      return;
    }

    // Handle errors
    if (message.error) {
      console.error(`[WebSocket] ❌ Error from server:`, JSON.stringify(message.error, null, 2));
      // If logsSubscribe fails, retry with correct parameters
      if (message.id === 1) {
        console.log('[WebSocket] ⚠️  Subscription failed, retrying with correct parameters...');
        // Wait a bit then retry subscription
        setTimeout(() => {
          this.subscribe();
        }, 2000);
      }
      return;
    }

    // Handle log notifications (from logsSubscribe)
    if (message.method === 'logsNotification' && message.params) {
      this.logsReceived++;
      const { result } = message.params;
      if (result && result.value && result.value.signature) {
        const signature = result.value.signature;
        const logs = result.value.logs || [];
        const logsText = logs.join(' ').toLowerCase();
        
        // PRIORITY: Check if logs mention our mint address (instant detection)
        const mintInLogs = this.currentMintAddress && 
          (logsText.includes(this.currentMintAddress.toLowerCase()) || 
           logsText.includes(this.currentMintAddress.slice(0, 8).toLowerCase()));
        
        // If mint is in logs, add to priority queue (process immediately)
        // Otherwise, process in background (non-blocking)
        if (mintInLogs) {
          // PRIORITY: Process immediately (our mint detected in logs)
          // Log first few to verify it's working
          if (this.logsReceived <= 5 || this.logsReceived % 50 === 0) {
            console.log(`[WebSocket] 🎯 Mint detected in logs! Processing priority transaction: ${signature.slice(0, 8)}...`);
          }
          this.fetchTransactionBySignature(signature, true); // true = priority
        } else {
          // BACKGROUND: Process in parallel without blocking (fire and forget)
          this.fetchTransactionBySignature(signature, false); // false = background
        }
      } else {
        // Log occasionally if we're not getting signatures
        if (this.logsReceived % 100 === 0) {
          console.log(`[WebSocket] ⚠️  Log notification received but no signature found. Result:`, result ? 'exists' : 'null');
        }
      }
    }
    
    // Handle account notifications (for mint address changes)
    if (message.method === 'accountNotification' && message.params) {
      const { result } = message.params;
      if (result && result.value) {
        console.log(`[WebSocket] 📥 Received account notification for mint`);
        // Account notifications don't have transaction data directly
        // But we can use this to detect activity and fetch recent transactions
      }
    }
  }
  
  // Try alternative subscription method
  tryAlternativeSubscription() {
    // Use signatureSubscribe to track all transactions (less efficient but works)
    console.log('[WebSocket] Trying signatureSubscribe approach...');
    // Note: This would require tracking specific signatures, which isn't ideal
    // Better to use a different RPC method or upgrade to Enhanced WebSocket
    console.log('[WebSocket] ⚠️  Standard Helius WebSocket has limited transaction subscription support');
    console.log('[WebSocket] 💡 Consider using Helius Enhanced WebSocket (atlas-mainnet) for better transaction tracking');
  }
  
  // Fetch transaction by signature (non-blocking, parallel processing)
  async fetchTransactionBySignature(signature, isPriority = false) {
    if (!solanaConnection) {
      // Log this once to help debug
      if (this.transactionsFetched === 0 && this.logsReceived > 10) {
        console.log(`[WebSocket] ❌ No Solana connection available for fetching transactions!`);
        console.log(`[WebSocket] 🔍 Debug: solanaConnection is null. RPC endpoint: ${this.rpcEndpoint || 'not set'}`);
      }
      return;
    }
    
    // Avoid processing the same transaction twice
    if (this.processedSignatures.has(signature) || this.pendingTransactions.has(signature)) {
      return;
    }
    
    // Mark as pending
    this.pendingTransactions.add(signature);
    this.processedSignatures.add(signature);
    
    // Keep only last 1000 signatures to prevent memory leak
    if (this.processedSignatures.size > 1000) {
      const first = this.processedSignatures.values().next().value;
      this.processedSignatures.delete(first);
    }
    
    // Increment counter immediately so we can see progress
    this.transactionsFetched++;
    
    // For priority transactions (mint detected in logs), process immediately
    // For background transactions, process in parallel without blocking
    const fetchPromise = (async () => {
      try {
        // Try 'confirmed' first (more reliable), then 'processed' as fallback
        // 'confirmed' is more reliable but slightly slower, 'processed' is faster but might not have transaction yet
        let tx = null;
        try {
          // Try 'confirmed' first (most reliable)
          tx = await solanaConnection.getParsedTransaction(signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0
          });
        } catch (confirmedError) {
          // If 'confirmed' fails, try 'processed' (faster but less reliable)
          try {
            tx = await solanaConnection.getParsedTransaction(signature, {
              commitment: 'processed',
              maxSupportedTransactionVersion: 0
            });
          } catch (processedError) {
            // If parsed fails, try regular getTransaction as fallback
            try {
              tx = await solanaConnection.getTransaction(signature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0
              });
            } catch (txError) {
              // All methods failed - transaction might not exist yet
              // For priority transactions, log the error
              if (isPriority) {
                console.log(`[WebSocket] ⚠️  Could not fetch priority transaction ${signature.slice(0, 8)}... (will retry if seen again)`);
              }
              this.pendingTransactions.delete(signature);
              this.processedSignatures.delete(signature);
              return;
            }
          }
        }
        
        // Remove from pending
        this.pendingTransactions.delete(signature);
        
        if (tx && tx.meta) {
          // Convert transaction to the format processTransaction expects
          // Handle both parsed and regular transaction formats
          let txData;
          if (tx.transaction && tx.transaction.message) {
            // Parsed transaction format
            txData = {
              transaction: {
                message: tx.transaction.message,
                signatures: tx.transaction.signatures || [signature]
              },
              meta: tx.meta
            };
          } else if (tx.message) {
            // Regular transaction format
            txData = {
              transaction: {
                message: tx.message,
                signatures: tx.signatures || [signature]
              },
              meta: tx.meta
            };
          } else {
            // Unknown format - skip
            this.processedSignatures.delete(signature);
            return;
          }
          
          // Process immediately (this is where buy detection happens)
          this.processTransaction(txData);
        } else {
          // Transaction not found or invalid
          this.processedSignatures.delete(signature);
        }
      } catch (error) {
        // Remove from pending and processed set on error so we can retry
        this.pendingTransactions.delete(signature);
        this.processedSignatures.delete(signature);
        // Log errors for priority transactions to help debug
        if (isPriority || this.transactionsFetched % 100 === 0) {
          const simTag = this.simulationMode ? ' [SIM]' : '';
          console.log(`[WebSocket] ⚠️  Error fetching transaction${simTag}: ${error.message}`);
        }
      }
    })();
    
    // For priority transactions, wait for completion (blocking)
    // For background transactions, fire and forget (non-blocking)
    if (isPriority) {
      await fetchPromise; // Wait for priority transactions
    }
    // Otherwise, let it run in background (don't await)
  }

  // Process transaction to identify buys/sells
  processTransaction(tx) {
    try {
      if (!tx || !tx.transaction || !tx.transaction.message) {
        return; // Silently skip invalid transactions
      }

      const message = tx.transaction.message;
      const accountKeys = message.accountKeys || [];
      const instructions = message.instructions || [];
      const meta = tx.meta;

      // Find the mint address in account keys
      let mintAddress = null;
      let mintInTransaction = false;
      
      // Check all account keys for our mint
      for (const key of accountKeys) {
        let addressStr;
        try {
          if (typeof key === 'string') {
            addressStr = key;
          } else if (key && typeof key === 'object') {
            // Handle PublicKey object or object with pubkey property
            if (key.pubkey) {
              // If pubkey exists, it might be a PublicKey object or string
              addressStr = typeof key.pubkey === 'string' ? key.pubkey : (key.pubkey.toString ? key.pubkey.toString() : String(key.pubkey));
            } else {
              // Try toString() method
              addressStr = key.toString ? key.toString() : String(key);
            }
          } else {
            addressStr = String(key);
          }
          
          // Ensure addressStr is a string before calling toLowerCase
          if (typeof addressStr !== 'string') {
            addressStr = String(addressStr);
          }
          
          if (addressStr && this.currentMintAddress && 
              addressStr.toLowerCase() === this.currentMintAddress.toLowerCase()) {
            mintAddress = addressStr;
            mintInTransaction = true;
            break;
          }
        } catch (err) {
          // Skip this key if we can't process it
          continue;
        }
      }

      // Also check in token balances
      if (!mintInTransaction && meta && meta.preTokenBalances) {
        for (const balance of meta.preTokenBalances) {
          if (balance.mint && this.currentMintAddress &&
              balance.mint.toLowerCase() === this.currentMintAddress.toLowerCase()) {
            mintAddress = balance.mint;
            mintInTransaction = true;
            break;
          }
        }
      }

      // If mint not found in this transaction, skip (but log occasionally for debugging)
      if (!mintInTransaction || !mintAddress) {
        // Log every 100th transaction that doesn't match to show we're processing
        if (this.transactionsFetched % 100 === 0 && this.transactionsFetched > 0) {
          const simTag = this.simulationMode ? ' [SIM]' : '';
          console.log(`[WebSocket] 🔍 Processed ${this.transactionsFetched} transactions${simTag}, none matched mint ${this.currentMintAddress?.slice(0, 8)}... yet`);
        }
        return;
      }

      // Find the wallet that initiated the transaction (first signer)
      let walletAddressStr = null;
      if (accountKeys.length > 0) {
        try {
          const firstKey = accountKeys[0];
          if (typeof firstKey === 'string') {
            walletAddressStr = firstKey;
          } else if (firstKey && typeof firstKey === 'object') {
            // Handle PublicKey object or object with pubkey property
            if (firstKey.pubkey) {
              // If pubkey exists, it might be a PublicKey object or string
              walletAddressStr = typeof firstKey.pubkey === 'string' ? firstKey.pubkey : (firstKey.pubkey.toString ? firstKey.pubkey.toString() : String(firstKey.pubkey));
            } else {
              // Try toString() method
              walletAddressStr = firstKey.toString ? firstKey.toString() : String(firstKey);
            }
          } else {
            walletAddressStr = String(firstKey);
          }
          
          // Ensure walletAddressStr is a string
          if (typeof walletAddressStr !== 'string') {
            walletAddressStr = String(walletAddressStr);
          }
        } catch (err) {
          // Can't process first key, skip this transaction
          return;
        }
      }

      if (!walletAddressStr) {
        return;
      }

      // Check if this is one of our wallets
      const isOurWallet = this.ourWalletAddresses.has(walletAddressStr.toLowerCase());
      
      // Log wallet detection for debugging (first few transactions)
      if (this.transactionsFetched < 5) {
        console.log(`[WebSocket] 🔍 Wallet ${walletAddressStr.slice(0, 8)}... is ${isOurWallet ? 'OUR WALLET' : 'EXTERNAL'}`);
      }

      // Determine buy/sell by analyzing token balance changes
      let isBuy = false;
      let isSell = false;
      let solAmount = 0;
      let tokenAmount = 0;

      // Get wallet's token balance before and after
      const preTokenBalance = this.getWalletTokenBalance(meta?.preTokenBalances, walletAddressStr, mintAddress);
      const postTokenBalance = this.getWalletTokenBalance(meta?.postTokenBalances, walletAddressStr, mintAddress);
      
      // Get wallet's SOL balance before and after
      let walletIndex = -1;
      for (let i = 0; i < accountKeys.length; i++) {
        const key = accountKeys[i];
        let addr;
        if (typeof key === 'string') {
          addr = key;
        } else if (key && typeof key === 'object') {
          addr = key.pubkey ? (typeof key.pubkey === 'string' ? key.pubkey : (key.pubkey.toString ? key.pubkey.toString() : String(key.pubkey))) : (key.toString ? key.toString() : String(key));
        } else {
          addr = String(key);
        }
        if (addr && typeof addr === 'string' && addr.toLowerCase() === walletAddressStr.toLowerCase()) {
          walletIndex = i;
          break;
        }
      }

      let preSolBalance = 0;
      let postSolBalance = 0;
      if (walletIndex >= 0 && meta && meta.preBalances && meta.postBalances) {
        preSolBalance = (meta.preBalances[walletIndex] || 0) / 1e9;
        postSolBalance = (meta.postBalances[walletIndex] || 0) / 1e9;
        
        // Calculate SOL amount more accurately:
        // The issue: total balance change includes fees and other operations
        // Solution: Use token balance change to estimate actual swap amount
        
        // First, determine if this is a buy or sell based on token balance
        const tokenBalanceChange = postTokenBalance - preTokenBalance;
        const isTokenBuy = tokenBalanceChange > 0;
        
        // Calculate raw balance change
        const rawBalanceChange = Math.abs(preSolBalance - postSolBalance);
        
        // For Pump.fun, transaction fees are typically ~0.000005 SOL
        // But the balance change might include other operations too
        // Use a more conservative approach: if balance change is way too high,
        // it likely includes multiple operations or we're looking at the wrong account
        
        // More accurate fee estimation:
        // - Base Solana transaction fee: ~0.000005 SOL
        // - Priority fees (if using bots like GMGN): can be 0.001-0.005 SOL or more
        // - Pump.fun program fees: typically 1-5% of swap amount
        
        const baseFee = 0.000005; // Standard Solana transaction fee
        
        // Priority fees are the main culprit when using bots (GMGN, etc.)
        // They can range from 0.001 SOL to 0.005+ SOL depending on network congestion
        // For a 0.06 SOL swap with GMGN bot:
        // - Swap: 0.06 SOL
        // - Priority fee: ~0.002 SOL (from GMGN bot)
        // - Base fee: ~0.000005 SOL
        // - Total: ~0.062 SOL
        
        // Estimate fees more accurately:
        // 1. Base transaction fee: ~0.000005 SOL
        // 2. Priority fees: typically 0.001-0.003 SOL for bot transactions
        // 3. Pump.fun fees: ~1-2% of swap amount
        
        let estimatedFees = baseFee;
        
        // Check if this looks like a bot transaction (high priority fees)
        // Bot transactions typically have higher total fees relative to swap amount
        if (rawBalanceChange > 0.01) {
          // For larger swaps, estimate:
          // - Priority fees: ~0.002 SOL (common for GMGN/bot transactions)
          // - Pump.fun fees: ~2% of swap amount
          const estimatedPriorityFee = 0.002; // Common for bot transactions
          const estimatedPumpFunFee = rawBalanceChange * 0.02; // ~2% for Pump.fun
          estimatedFees = baseFee + estimatedPriorityFee + estimatedPumpFunFee;
        } else if (rawBalanceChange > 0.001) {
          // For smaller swaps, priority fees might be lower
          const estimatedPriorityFee = 0.001; // Lower for smaller swaps
          const estimatedPumpFunFee = rawBalanceChange * 0.02;
          estimatedFees = baseFee + estimatedPriorityFee + estimatedPumpFunFee;
        } else {
          // For very small swaps, just use base fee
          estimatedFees = baseFee;
        }
        
        // Calculate SOL amount: balance change minus estimated fees
        if (rawBalanceChange > estimatedFees) {
          solAmount = rawBalanceChange - estimatedFees;
        } else {
          solAmount = rawBalanceChange;
        }
        
        // Additional safety: if the calculated amount still seems too high,
        // it might be that priority fees are even higher (network congestion)
        // For the user's case: 0.067 SOL balance change, 0.06 SOL intended buy
        // That's ~0.007 SOL in fees (11.7%), which matches priority fees + Pump.fun fees
        if (rawBalanceChange > 0.01 && solAmount > rawBalanceChange * 0.88) {
          // If calculated amount is still > 88% of balance change, fees might be higher
          // Use a more aggressive estimate: subtract up to 12% (covers high priority fee cases)
          const alternativeAmount = rawBalanceChange * 0.88; // Assume 12% in fees/other operations
          if (alternativeAmount < solAmount) {
            solAmount = alternativeAmount;
          }
        }
      }

      // Determine buy vs sell based on token balance change
      if (postTokenBalance > preTokenBalance) {
        isBuy = true;
        tokenAmount = postTokenBalance - preTokenBalance;
      } else if (postTokenBalance < preTokenBalance) {
        isSell = true;
        tokenAmount = preTokenBalance - postTokenBalance;
      }

      // Also check if SOL was spent (buy) or received (sell)
      if (!isBuy && !isSell && solAmount > 0) {
        // If SOL decreased significantly, likely a buy
        if (preSolBalance > postSolBalance && solAmount > 0.01) {
          isBuy = true;
        }
      }

      // Log the transaction
      if (isBuy || isSell) {
        const tradeType = isBuy ? 'BUY' : 'SELL';
        const walletType = isOurWallet ? 'OUR WALLET' : 'EXTERNAL';
        const timestamp = Date.now();
        const simTag = this.simulationMode ? ' [SIM]' : '';
        
        console.log(`[WebSocket] 🔔 ${tradeType} detected${simTag}: ${walletType} | ${walletAddressStr.slice(0, 8)}... | ${solAmount.toFixed(4)} SOL | Mint: ${mintAddress.slice(0, 8)}... | ${tokenAmount > 0 ? tokenAmount.toFixed(2) + ' tokens' : ''}`);
        
        // Emit transaction data
        const txData = {
          type: tradeType.toLowerCase(),
          walletAddress: walletAddressStr,
          walletType: walletType,
          solAmount: solAmount,
          tokenAmount: tokenAmount,
          mintAddress: mintAddress,
          timestamp: timestamp,
          isOurWallet: isOurWallet
        };
        this.emitTransaction(txData);
        
        // AGGREGATE EXTERNAL BUYS and trigger when cumulative threshold reached
        if (isBuy && !isOurWallet && this.autoSellEnabled && solAmount > 0) {
          this.handleExternalBuy(solAmount, walletAddressStr, timestamp);
        }
      }

    } catch (error) {
      console.error('[WebSocket] Error processing transaction:', error);
    }
  }

  // Get wallet's token balance for a specific mint
  getWalletTokenBalance(balances, walletAddress, mintAddress) {
    if (!balances || !Array.isArray(balances)) return 0;
    
    // Ensure walletAddress is a string
    const walletAddressStr = typeof walletAddress === 'string' ? walletAddress : (walletAddress ? String(walletAddress) : '');
    const mintAddressStr = typeof mintAddress === 'string' ? mintAddress : (mintAddress ? String(mintAddress) : '');
    
    for (const balance of balances) {
      const owner = balance.owner;
      const mint = balance.mint;
      
      // Ensure both are strings before comparing
      const ownerStr = typeof owner === 'string' ? owner : (owner ? String(owner) : '');
      const mintStr = typeof mint === 'string' ? mint : (mint ? String(mint) : '');
      
      if (mintStr && mintStr.toLowerCase() === mintAddressStr.toLowerCase() &&
          ownerStr && ownerStr.toLowerCase() === walletAddressStr.toLowerCase()) {
        const uiAmount = balance.uiTokenAmount?.uiAmount || balance.uiTokenAmount?.amount || 0;
        return parseFloat(uiAmount) || 0;
      }
    }
    
    return 0;
  }

  // Handle external buy - aggregate and check threshold
  handleExternalBuy(solAmount, walletAddress, timestamp) {
    const now = Date.now();
    
    // Reset window if expired
    if (this.externalBuyStartTime && (now - this.externalBuyStartTime) > this.externalBuyWindow) {
      console.log(`[WebSocket] ⏱️ External buy window expired. Resetting aggregation.`);
      this.externalBuyVolume = 0;
      this.externalBuyStartTime = null;
      this.externalBuyTransactions = [];
      this.sellTriggered = false;
    }
    
    // Start new window if needed
    if (!this.externalBuyStartTime) {
      this.externalBuyStartTime = now;
      this.externalBuyVolume = 0;
      this.externalBuyTransactions = [];
      this.sellTriggered = false;
      console.log(`[WebSocket] 📊 Starting new external buy aggregation window (${this.externalBuyWindow / 1000}s)`);
    }
    
    // Add to cumulative volume
    this.externalBuyVolume += solAmount;
    this.externalBuyTransactions.push({
      wallet: walletAddress,
      amount: solAmount,
      timestamp: timestamp
    });
    
    const timeElapsed = (now - this.externalBuyStartTime) / 1000;
    const remaining = (this.externalBuyWindow - (now - this.externalBuyStartTime)) / 1000;
    const simTag = this.simulationMode ? ' [SIM]' : '';
    
    console.log(`[WebSocket] 💰 External buy${simTag}: +${solAmount.toFixed(4)} SOL | Total: ${this.externalBuyVolume.toFixed(4)}/${this.externalBuyThreshold.toFixed(4)} SOL | Window: ${timeElapsed.toFixed(1)}s / ${this.externalBuyWindow / 1000}s (${remaining > 0 ? remaining.toFixed(1) + 's left' : 'expired'})`);
    
    // Check if threshold reached - TRIGGER INSTANTLY (don't wait for anything)
    if (this.externalBuyVolume >= this.externalBuyThreshold && !this.sellTriggered) {
      const timeToTrigger = Date.now() - this.externalBuyStartTime;
      console.log(`[WebSocket] 🚨🚨🚨 THRESHOLD REACHED${simTag}! ${this.externalBuyVolume.toFixed(4)} SOL in external buys (${this.externalBuyTransactions.length} transactions)`);
      console.log(`[WebSocket] ⚡⚡⚡ TRIGGERING INSTANT RAPID SELL${simTag} (${timeToTrigger}ms after first buy)...`);
      
      // Mark as triggered IMMEDIATELY to prevent duplicate triggers
      this.sellTriggered = true;
      
      // TRIGGER INSTANTLY - don't wait, don't block, fire immediately
      if (this.simulationMode) {
        console.log(`[WebSocket] 🧪 [SIM] Simulation mode - NOT actually selling (would have triggered rapid-sell.ts)`);
      } else {
        // Fire immediately - non-blocking, don't await
        this.triggerAutoSell().catch(err => {
          console.error(`[WebSocket] ❌ Error triggering auto-sell:`, err);
        });
      }
      
      // Reset after triggering
      setTimeout(() => {
        this.externalBuyVolume = 0;
        this.externalBuyStartTime = null;
        this.externalBuyTransactions = [];
        this.sellTriggered = false;
        const resetTag = this.simulationMode ? ' [SIM]' : '';
        console.log(`[WebSocket] ✅ Reset external buy aggregation${resetTag}`);
      }, 5000); // Reset 5 seconds after sell
    }
  }


  // Trigger auto-sell - INSTANT execution, no delays, non-blocking
  triggerAutoSell() {
    if (this.simulationMode) {
      console.log('[WebSocket] 🧪 [SIM] Simulation mode - NOT actually selling');
      return Promise.resolve();
    }
    
    console.log('[WebSocket] 🚀🚀🚀 INSTANT RAPID SELL TRIGGERED - BEATING SNIPER BOTS! 🚀🚀🚀');
    console.log('[WebSocket] ⚡⚡⚡ Executing IMMEDIATELY (0ms delay)...');
    
    const scriptDir = path.join(__dirname, '..');
    const mintAddress = this.currentMintAddress;
    
    // Determine which sell script to use based on autoSellType
    // 'rapid-sell' = sell all wallets (AUTO_RAPID_SELL)
    // 'rapid-sell-50-percent' = sell 50% of bundler wallets (AUTO_SELL_50_PERCENT)
    const sellType = this.autoSellType || 'rapid-sell'; // Default to rapid-sell
    
    // Pass mint address and HIGH priority fee (threshold was met - need speed!)
    const command = `cd "${scriptDir}" && npm run ${sellType} "${mintAddress || ''}" 0 high`;
    
    const sellTypeName = sellType === 'rapid-sell-50-percent' ? '50% of bundler wallets' : 'ALL wallets';
    console.log(`[WebSocket] 📍 Selling mint: ${mintAddress}`);
    console.log(`[WebSocket] 📍 Sell type: ${sellTypeName}`);
    
    // Execute IMMEDIATELY - non-blocking, fire and forget (don't wait for completion)
    return new Promise((resolve, reject) => {
      const childProcess = exec(command, { 
        maxBuffer: 10 * 1024 * 1024,
        cwd: scriptDir,
        env: { ...process.env },
        shell: true,
        detached: true // Detach process for even faster execution
      });
      
      // Unref to allow process to run independently (don't block)
      if (childProcess.unref) {
        childProcess.unref();
      }
      
      // Stream output in real-time for visibility
      childProcess.stdout?.on('data', (data) => {
        process.stdout.write(`[Rapid Sell] ${data}`);
      });
      
      childProcess.stderr?.on('data', (data) => {
        process.stderr.write(`[Rapid Sell Error] ${data}`);
      });
      
      childProcess.on('error', (error) => {
        console.error('[WebSocket] ❌ Auto-sell execution error:', error);
        reject(error);
      });
      
      childProcess.on('exit', (code) => {
        if (code === 0) {
          console.log('[WebSocket] ✅✅✅ RAPID SELL COMPLETED SUCCESSFULLY!');
        } else {
          console.error(`[WebSocket] ⚠️ Rapid sell exited with code ${code}`);
        }
        resolve(); // Resolve immediately (don't block)
      });
      
      // Resolve immediately (don't wait for process to complete)
      // The process runs in background
      resolve();
    });
  }

  // Attempt to reconnect
  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WebSocket] Max reconnect attempts reached. Stopping.');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);
    
    console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
    
    setTimeout(() => {
      if (this.currentMintAddress) {
        this.connect();
      }
    }, delay);
  }
}

// Export singleton instance
const tracker = new WebSocketTracker();
module.exports = tracker;

