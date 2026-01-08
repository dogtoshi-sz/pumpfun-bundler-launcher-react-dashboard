// Live Trades Tracker - Real-time transaction feed for trading log
// Uses Helius getTransactionsForAddress API + WebSocket for live updates

const WebSocket = require('ws');
const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
// Handle bs58 v6 export format
const base58 = require('bs58').default || require('bs58');

// Load .env file before initializing (same as control-panel-server.js)
const rootEnvPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(rootEnvPath)) {
  require('dotenv').config({ path: rootEnvPath });
} else {
  require('dotenv').config();
}

class LiveTradesTracker {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.subscriptionId = null;
    this.currentMintAddress = null;
    this.currentBondingCurveAddress = null; // Pump.fun bonding curve (pool) address
    this.wsUrl = null;
    this.rpcEndpoint = null;
    this.connection = null;
    this.trades = []; // Store last 100 trades
    this.maxTrades = 100;
    this.listeners = []; // SSE listeners
    this.processedSignatures = new Set();
    this.pendingTransactions = new Set();
    this.ourWallets = new Set(); // Track our wallet addresses
    this.walletTypes = new Map(); // Map wallet address -> type (DEV, Bundle, Holder)
    this.pollInterval = null; // Polling interval for live updates
    this.lastFetchedSlot = new Map(); // Cache last fetched slot per mint
    this.tradeCache = new Map(); // Cache trades per mint address
    this.currentMarketCap = null; // Current market cap from API
    this.PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
  }
  
  // Derive Pump.fun bonding curve PDA from mint address
  getBondingCurveAddress(mintAddress) {
    try {
      const mintPubkey = new PublicKey(mintAddress);
      // Pump.fun bonding curve PDA: seeds = ["bonding-curve", mint]
      const [bondingCurvePDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("bonding-curve"),
          mintPubkey.toBuffer()
        ],
        this.PUMP_PROGRAM_ID
      );
      return bondingCurvePDA.toBase58();
    } catch (error) {
      console.error('[LiveTrades] Error deriving bonding curve:', error.message);
      return null;
    }
  }

  initialize() {
    // Use process.env (loaded by dotenv in control-panel-server.js)
    this.rpcEndpoint = process.env.RPC_ENDPOINT || null;
    this.wsUrl = process.env.RPC_WEBSOCKET_ENDPOINT || null;
    
    // If WebSocket URL not set but RPC endpoint is Helius, construct it
    if (!this.wsUrl && this.rpcEndpoint && this.rpcEndpoint.includes('helius-rpc.com')) {
      const match = this.rpcEndpoint.match(/https:\/\/([^\/]+)/);
      if (match) {
        const host = match[1];
        const apiKeyMatch = this.rpcEndpoint.match(/api-key=([^&]+)/);
        if (apiKeyMatch) {
          this.wsUrl = `wss://${host}/?api-key=${apiKeyMatch[1]}`;
        } else {
          this.wsUrl = `wss://${host}`;
        }
      }
    }
    
    if (this.rpcEndpoint) {
      this.connection = new Connection(this.rpcEndpoint, 'confirmed');
      console.log(`[LiveTrades] ✅ Initialized with RPC: ${this.rpcEndpoint.replace(/api-key=[^&]+/, 'api-key=***')}`);
    } else {
      console.error('[LiveTrades] ❌ RPC_ENDPOINT not found in environment variables');
    }
    
    if (this.wsUrl) {
      console.log(`[LiveTrades] ✅ WebSocket URL configured: ${this.wsUrl.replace(/api-key=[^&]+/, 'api-key=***')}`);
    } else {
      console.warn('[LiveTrades] ⚠️ RPC_WEBSOCKET_ENDPOINT not found');
    }

    // Load our wallet addresses from current-run.json
    this.loadOurWallets();
  }

  // Load our wallet addresses with types
  loadOurWallets() {
    this.ourWallets.clear(); // Clear existing wallets
    this.walletTypes.clear(); // Clear wallet types
    
    try {
      const currentRunPath = path.join(__dirname, '..', 'keys', 'current-run.json');
      if (fs.existsSync(currentRunPath)) {
        const data = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
        
        // Helper function to derive address from key (base58 or base64)
        const deriveAddress = (key) => {
          try {
            const { Keypair } = require('@solana/web3.js');
            let keypair;
            // Try base58 first (most common for Solana keys)
            try {
              const decoded = base58.decode(key);
              keypair = Keypair.fromSecretKey(decoded);
            } catch (e) {
              // Fallback to base64
              keypair = Keypair.fromSecretKey(Buffer.from(key, 'base64'));
            }
            return keypair.publicKey.toString();
          } catch (e) {
            console.error(`[LiveTrades] Error deriving address from key: ${e.message}`);
            return null;
          }
        };
        
        const addWallet = (address, type) => {
          if (address) {
            const addrLower = address.toLowerCase();
            this.ourWallets.add(addrLower);
            this.walletTypes.set(addrLower, type);
          }
        };
        
        // Add DEV wallet (creatorDevWalletKey)
        if (data.creatorDevWalletKey) {
          const devAddr = deriveAddress(data.creatorDevWalletKey);
          addWallet(devAddr, 'DEV');
        }
        if (data.devWalletAddress) {
          addWallet(data.devWalletAddress, 'DEV');
        }
        
        // Add Bundle wallets
        if (data.bundleWalletKeys && Array.isArray(data.bundleWalletKeys)) {
          data.bundleWalletKeys.forEach(key => {
            const addr = deriveAddress(key);
            addWallet(addr, 'Bundle');
          });
        }
        if (data.bundleWalletAddresses && Array.isArray(data.bundleWalletAddresses)) {
          data.bundleWalletAddresses.forEach(addr => {
            addWallet(addr, 'Bundle');
          });
        }
        
        // Add Holder wallets
        if (data.holderWalletKeys && Array.isArray(data.holderWalletKeys)) {
          data.holderWalletKeys.forEach(key => {
            const addr = deriveAddress(key);
            addWallet(addr, 'Holder');
          });
        }
        if (data.holderWalletAddresses && Array.isArray(data.holderWalletAddresses)) {
          data.holderWalletAddresses.forEach(addr => {
            addWallet(addr, 'Holder');
          });
        }
        
        // Add creator wallet (also DEV)
        if (data.creatorWalletAddress) {
          addWallet(data.creatorWalletAddress, 'DEV');
        }
        
        // Also check walletKeys array (might contain all wallets)
        if (data.walletKeys && Array.isArray(data.walletKeys)) {
          data.walletKeys.forEach(key => {
            const addr = deriveAddress(key);
            // Only add if not already added (to preserve type)
            if (addr && !this.ourWallets.has(addr.toLowerCase())) {
              addWallet(addr, 'Holder'); // Default to Holder if type unknown
            }
          });
        }
        
        // Debug: Log all wallet addresses with types
        const devCount = Array.from(this.walletTypes.values()).filter(t => t === 'DEV').length;
        const bundleCount = Array.from(this.walletTypes.values()).filter(t => t === 'Bundle').length;
        const holderCount = Array.from(this.walletTypes.values()).filter(t => t === 'Holder').length;
        
        console.log(`[LiveTrades] ✅ Loaded ${this.ourWallets.size} our wallet addresses:`);
        console.log(`[LiveTrades]   - DEV: ${devCount}`);
        console.log(`[LiveTrades]   - Bundle: ${bundleCount}`);
        console.log(`[LiveTrades]   - Holder: ${holderCount}`);
        
        if (this.ourWallets.size > 0) {
          const walletList = Array.from(this.ourWallets).slice(0, 5);
          walletList.forEach(addr => {
            const type = this.walletTypes.get(addr) || 'Unknown';
            console.log(`[LiveTrades]   ${type}: ${addr.slice(0, 8)}...`);
          });
        }
      } else {
        console.warn('[LiveTrades] ⚠️ current-run.json not found');
      }
    } catch (error) {
      console.error('[LiveTrades] ❌ Error loading our wallets:', error);
    }
  }

  // Add SSE listener
  addListener(res) {
    this.listeners.push(res);
    // Send recent trades to new listener
    const trades = this.tradeCache.get(this.currentMintAddress) || this.trades;
    trades.forEach(trade => {
      this.sendToListener(res, trade);
    });
  }

  // Remove SSE listener
  removeListener(res) {
    this.listeners = this.listeners.filter(l => l !== res);
  }

  // Send trade to all listeners
  sendToAllListeners(trade) {
    this.listeners.forEach(res => {
      this.sendToListener(res, trade);
    });
  }

  // Send trade to single listener
  sendToListener(res, trade) {
    try {
      if (trade.type === 'initial') {
        res.write(`data: ${JSON.stringify(trade)}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify(trade)}\n\n`);
      }
    } catch (error) {
      console.error('[LiveTrades] Error sending to listener:', error);
      this.removeListener(res);
    }
  }

  // Get current market cap from recent trades (calculated, not from API)
  async getCurrentMarketCap(mintAddress) {
    // Market cap will be calculated from trades, not fetched from API
    // Return null to use calculated market cap from trades
    return null;
  }

  // Start tracking a mint address
  async startTracking(mintAddress) {
    // Reload wallets in case they've changed
    this.loadOurWallets();
    
    // Derive bonding curve (pool) address - this is what we'll track instead of mint
    const bondingCurveAddress = this.getBondingCurveAddress(mintAddress);
    if (!bondingCurveAddress) {
      console.error('[LiveTrades] ❌ Failed to derive bonding curve address');
      return;
    }
    
    console.log(`[LiveTrades] 📍 Mint: ${mintAddress.slice(0, 8)}... → Bonding Curve: ${bondingCurveAddress.slice(0, 8)}...`);
    
    // Fetch current market cap
    const currentMarketCap = await this.getCurrentMarketCap(mintAddress);
    if (currentMarketCap) {
      this.currentMarketCap = currentMarketCap;
    }
    
    // Check cache first
    if (this.tradeCache.has(mintAddress) && this.currentMintAddress === mintAddress) {
      const cachedTrades = this.tradeCache.get(mintAddress);
      this.trades = cachedTrades;
      console.log(`[LiveTrades] Using cached trades for ${mintAddress.slice(0, 8)}... (${cachedTrades.length} trades)`);
      
      // Still start WebSocket for new trades
      this.currentMintAddress = mintAddress;
      this.currentBondingCurveAddress = bondingCurveAddress;
      if (!this.ws || !this.isConnected) {
        this.connect();
      } else {
        this.subscribe();
      }
      return;
    }
    
    this.currentMintAddress = mintAddress;
    this.currentBondingCurveAddress = bondingCurveAddress;
    this.trades = [];
    this.processedSignatures.clear();
    this.loadOurWallets(); // Reload wallets in case they changed
    
    // Fetch recent trade history using bonding curve address (not mint)
    await this.fetchTradeHistory(mintAddress, bondingCurveAddress);
    
    if (!this.ws || !this.isConnected) {
      this.connect();
    } else {
      this.subscribe();
    }
  }

  // Fetch recent trade history using bonding curve address (proper pattern)
  // Step 1: Get signatures from bonding curve (pool) address
  // Step 2: Fetch full transactions for those signatures
  // Step 3: Filter for actual swaps
  async fetchTradeHistory(mintAddress, bondingCurveAddress) {
    if (!this.rpcEndpoint || !this.connection) {
      console.log('[LiveTrades] ❌ No RPC endpoint or connection available for history');
      return;
    }

    try {
      console.log(`[LiveTrades] 🔍 Fetching trade history for bonding curve ${bondingCurveAddress.slice(0, 8)}...`);
      
      // Step 1: Get signatures from bonding curve address (not mint)
      // Fetch ~650 signatures to ensure we get ~500 swaps after filtering
      const bondingCurvePubkey = new PublicKey(bondingCurveAddress);
      let allSignatures = [];
      let before = null;
      const targetSignatures = 650; // Fetch extra to account for non-swap txs
      
      try {
        while (allSignatures.length < targetSignatures) {
          const signatures = await this.connection.getSignaturesForAddress(
            bondingCurvePubkey,
            {
              limit: 100,
              before: before
            },
            'confirmed'
          );
          
          if (signatures.length === 0) break;
          
          allSignatures = allSignatures.concat(signatures.map(s => s.signature));
          before = signatures[signatures.length - 1].signature;
          
          if (signatures.length < 100) break; // No more pages
        }
      } catch (error) {
        console.error(`[LiveTrades] ❌ Error fetching signatures from bonding curve: ${error.message}`);
        console.log(`[LiveTrades] ⚠️ Falling back to mint address for fetching trades...`);
        
        // Fallback: Use mint address if bonding curve fails
        const mintPubkey = new PublicKey(mintAddress);
        allSignatures = [];
        before = null;
        
        while (allSignatures.length < targetSignatures) {
          const signatures = await this.connection.getSignaturesForAddress(
            mintPubkey,
            {
              limit: 100,
              before: before
            },
            'confirmed'
          );
          
          if (signatures.length === 0) break;
          
          allSignatures = allSignatures.concat(signatures.map(s => s.signature));
          before = signatures[signatures.length - 1].signature;
          
          if (signatures.length < 100) break;
        }
      }
      
      console.log(`[LiveTrades] ✅ Found ${allSignatures.length} signatures`);
      
      // Step 2: Fetch full transactions in batches
      const batchSize = 50;
      const transactions = [];
      
      for (let i = 0; i < allSignatures.length; i += batchSize) {
        const batch = allSignatures.slice(i, i + batchSize);
        const txs = await Promise.all(
          batch.map(sig => 
            this.connection.getTransaction(sig, {
              encoding: 'jsonParsed',
              maxSupportedTransactionVersion: 0,
              commitment: 'confirmed'
            })
          )
        );
        
        transactions.push(...txs.filter(tx => tx !== null));
        
        // Small delay to avoid rate limits
        if (i + batchSize < allSignatures.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      console.log(`[LiveTrades] ✅ Fetched ${transactions.length} full transactions`);
      
      // Step 3: Parse and filter for swaps
      const historicalTrades = [];
      
      for (const tx of transactions) {
        if (!tx || !tx.meta || !tx.transaction) continue;
        
        const signature = tx.transaction.signatures?.[0];
        if (!signature || this.processedSignatures.has(signature)) continue;
        
        const blockTime = tx.blockTime || null;
        const tradeResult = this.parseTransaction(tx, signature, blockTime);
        
        if (tradeResult) {
          const tradesToAdd = Array.isArray(tradeResult) ? tradeResult : [tradeResult];
          for (const trade of tradesToAdd) {
            if (trade && trade.timestamp) {
              historicalTrades.push(trade);
              this.processedSignatures.add(signature);
            }
          }
        }
      }
      
      // Sort by timestamp (newest first), then take top 500
      historicalTrades.sort((a, b) => {
        if (b.timestamp !== a.timestamp) {
          return b.timestamp - a.timestamp;
        }
        if (a.slot && b.slot) {
          return b.slot - a.slot;
        }
        return 0;
      });
      
      this.trades = historicalTrades.slice(0, this.maxTrades);
      
      // Cache trades for this mint
      this.tradeCache.set(mintAddress, [...this.trades]);
      
      // Store last fetched slot for incremental updates
      if (transactions.length > 0 && transactions[0].slot) {
        this.lastFetchedSlot.set(mintAddress, transactions[0].slot);
      }
      
      console.log(`[LiveTrades] ✅ Loaded ${this.trades.length} historical trades`);
      
      // Send initial trades to all listeners
      if (this.trades.length > 0) {
        console.log(`[LiveTrades] 📤 Sending ${this.trades.length} initial trades to listeners`);
        this.trades.forEach(trade => {
          this.sendToAllListeners(trade);
        });
      } else {
        console.log(`[LiveTrades] ⚠️ No trades found - token may be new or have no trades yet`);
      }
      
    } catch (error) {
      console.error('[LiveTrades] Error fetching trade history:', error);
      console.error('[LiveTrades] Stack:', error.stack);
    }
  }

  // Stop tracking
  stopTracking() {
    if (this.subscriptionId !== null) {
      this.unsubscribe();
    }
    this.stopPolling();
    this.currentMintAddress = null;
  }

  // Connect to Helius WebSocket
  connect() {
    if (!this.wsUrl) {
      console.error('[LiveTrades] No WebSocket URL configured');
      return;
    }

    if (this.ws && this.isConnected) {
      return;
    }

    console.log('[LiveTrades] Connecting to Helius WebSocket...');
    this.ws = new WebSocket(this.wsUrl);

    this.ws.on('open', () => {
      console.log('[LiveTrades] ✅ Connected to Helius WebSocket');
      this.isConnected = true;
      this.subscribe();
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        console.error('[LiveTrades] Error parsing message:', error);
      }
    });

    this.ws.on('error', (error) => {
      console.error('[LiveTrades] WebSocket error:', error.message);
    });

    this.ws.on('close', () => {
      console.log('[LiveTrades] WebSocket closed, reconnecting...');
      this.isConnected = false;
      this.subscriptionId = null;
      setTimeout(() => this.connect(), 3000);
    });
  }

  // Subscribe to Pump.fun program logs (same as working WebSocket tracker)
  subscribe() {
    if (!this.currentMintAddress) {
      console.error('[LiveTrades] ❌ No mint address set for subscription');
      return;
    }

    try {
      // Subscribe to Pump.fun program (same as working tracker)
      // Note: mentions only supports 1 address, so we subscribe to Pump.fun program and filter in code
      const logsSubscribeMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'logsSubscribe',
        params: [
          {
            mentions: [this.PUMP_PROGRAM_ID.toBase58()] // Subscribe to all Pump.fun transactions
          },
          {
            commitment: 'confirmed'
          }
        ]
      };

      console.log('[LiveTrades] Subscribing to Pump.fun transaction logs...');
      console.log(`[LiveTrades] Will filter for mint: ${this.currentMintAddress.slice(0, 8)}... in code`);
      this.ws.send(JSON.stringify(logsSubscribeMessage));
      
      // Also start polling as backup (only fetch NEW transactions)
      this.startPolling();
    } catch (error) {
      console.error('[LiveTrades] Error subscribing:', error);
      // Fallback to polling only
      this.startPolling();
    }
  }

  // Start polling for NEW transactions only (using slot filter)
  startPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    
    // Poll every 10 seconds for new transactions (reduced frequency to avoid spam)
    this.pollInterval = setInterval(() => {
      this.fetchNewTransactions();
    }, 10000);
    
    console.log('[LiveTrades] Started polling for new transactions (every 10s)');
  }

  // Stop polling
  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  // Fetch only NEW transactions from bonding curve (proper pattern)
  async fetchNewTransactions() {
    if (!this.connection) return;
    
    // Use bonding curve if available, otherwise fallback to mint
    const addressToPoll = this.currentBondingCurveAddress || this.currentMintAddress;
    if (!addressToPoll) return;

    try {
      const addressPubkey = new PublicKey(addressToPoll);
      
      // Get new signatures from address
      const signatures = await this.connection.getSignaturesForAddress(
        addressPubkey,
        {
          limit: 20
        },
        'confirmed'
      );
      
      if (signatures.length === 0) return;
      
      // Filter to only new signatures (not already processed)
      const newSignatures = signatures
        .map(s => s.signature)
        .filter(sig => !this.processedSignatures.has(sig));
      
      if (newSignatures.length === 0) return;
      
      // Fetch full transactions for new signatures
      const transactions = await Promise.all(
        newSignatures.map(sig =>
          this.connection.getTransaction(sig, {
            encoding: 'jsonParsed',
            maxSupportedTransactionVersion: 0,
            commitment: 'confirmed'
          })
        )
      );
      
      let newTradesCount = 0;
      
      // Parse new transactions
      for (const tx of transactions) {
        if (!tx || !tx.meta || !tx.transaction) continue;
        
        const signature = tx.transaction.signatures?.[0];
        if (!signature || this.processedSignatures.has(signature)) continue;
        
        const blockTime = tx.blockTime || null;
        const tradeResult = this.parseTransaction(tx, signature, blockTime);
        
        if (tradeResult) {
          const tradesToAdd = Array.isArray(tradeResult) ? tradeResult : [tradeResult];
          
          for (const trade of tradesToAdd) {
            if (trade && trade.timestamp) {
              this.addTrade(trade);
              newTradesCount++;
            }
          }
          
          this.processedSignatures.add(signature);
          
          // Update last fetched slot
          if (tx.slot) {
            const currentLastSlot = this.lastFetchedSlot.get(this.currentMintAddress);
            if (!currentLastSlot || tx.slot > currentLastSlot) {
              this.lastFetchedSlot.set(this.currentMintAddress, tx.slot);
            }
          }
        }
      }
      
      // Only log if we found new trades
      if (newTradesCount > 0) {
        console.log(`[LiveTrades] ✅ Found ${newTradesCount} new trade(s) from bonding curve`);
      }
    } catch (error) {
      // Silently handle errors for polling
    }
  }

  // Handle WebSocket messages (same pattern as working tracker)
  handleMessage(message) {
    // Handle subscription confirmation
    if (message.id === 1 && message.result) {
      this.subscriptionId = message.result;
      console.log(`[LiveTrades] ✅ Logs subscription confirmed! Subscription ID: ${this.subscriptionId}`);
      console.log(`[LiveTrades] 🎯 Now listening for transaction logs on Pump.fun program...`);
      return;
    }

    // Handle errors
    if (message.error) {
      console.error('[LiveTrades] Error:', message.error);
      return;
    }

    // Handle log notifications (from logsSubscribe) - same as working tracker
    if (message.method === 'logsNotification' && message.params) {
      const { result } = message.params;
      if (result && result.value) {
        const logs = result.value.logs || [];
        const signature = result.value.signature;
        
        // Filter: Check if logs mention our mint address (same as working tracker)
        // This filters out transactions that don't involve our token
        let mentionsOurMint = false;
        if (this.currentMintAddress) {
          const mintLower = this.currentMintAddress.toLowerCase();
          for (const log of logs) {
            if (typeof log === 'string' && log.toLowerCase().includes(mintLower)) {
              mentionsOurMint = true;
              break;
            }
          }
        }
        
        // Only fetch transactions that mention our mint (priority)
        if (mentionsOurMint && signature) {
          this.fetchTransactionBySignature(signature, true); // true = priority
        }
      }
    }
  }

  // Fetch and parse transaction (same pattern as working tracker)
  async fetchTransactionBySignature(signature, isPriority = false) {
    if (!this.connection) {
      return;
    }
    
    // Avoid processing the same transaction twice
    if (this.processedSignatures.has(signature) || this.pendingTransactions.has(signature)) {
      return;
    }
    
    // Mark as pending and processed immediately
    this.pendingTransactions.add(signature);
    this.processedSignatures.add(signature);
    
    // Keep only last 1000 signatures to prevent memory leak
    if (this.processedSignatures.size > 1000) {
      const first = this.processedSignatures.values().next().value;
      this.processedSignatures.delete(first);
    }
    
    // Fetch transaction (same pattern as working tracker)
    const fetchPromise = (async () => {
      try {
        // Try 'confirmed' first (more reliable), then 'processed' as fallback
        let tx = null;
        try {
          tx = await this.connection.getParsedTransaction(signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0
          });
        } catch (confirmedError) {
          // If 'confirmed' fails, try 'processed' (faster but less reliable)
          try {
            tx = await this.connection.getParsedTransaction(signature, {
              commitment: 'processed',
              maxSupportedTransactionVersion: 0
            });
          } catch (processedError) {
            // If parsed fails, try regular getTransaction as fallback
            try {
              tx = await this.connection.getTransaction(signature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0
              });
            } catch (txError) {
              // All methods failed - transaction might not exist yet
              this.pendingTransactions.delete(signature);
              this.processedSignatures.delete(signature);
              return;
            }
          }
        }
        
        // Remove from pending
        this.pendingTransactions.delete(signature);
        
        if (tx && tx.meta) {
          // Convert transaction to the format parseTransaction expects
          let txData;
          if (tx.transaction && tx.transaction.message) {
            // Parsed transaction format
            txData = {
              transaction: {
                message: tx.transaction.message,
                signatures: tx.transaction.signatures || [signature]
              },
              meta: tx.meta,
              blockTime: tx.blockTime,
              slot: tx.slot
            };
          } else if (tx.message) {
            // Regular transaction format
            txData = {
              transaction: {
                message: tx.message,
                signatures: tx.signatures || [signature]
              },
              meta: tx.meta,
              blockTime: tx.blockTime,
              slot: tx.slot
            };
          } else {
            // Unknown format - skip
            this.processedSignatures.delete(signature);
            return;
          }
          
          // Parse transaction
          const blockTime = txData.blockTime || null;
          const tradeResult = this.parseTransaction(txData, signature, blockTime);
          
          if (tradeResult) {
            // Handle both single trade and array of trades
            const tradesToAdd = Array.isArray(tradeResult) ? tradeResult : [tradeResult];
            
            for (const trade of tradesToAdd) {
              if (trade && trade.timestamp) {
                this.addTrade(trade);
              }
            }
          }
        } else {
          // Transaction not found or invalid
          this.processedSignatures.delete(signature);
        }
      } catch (error) {
        // Remove from pending and processed set on error so we can retry
        this.pendingTransactions.delete(signature);
        this.processedSignatures.delete(signature);
      }
    })();
    
    // For priority transactions, wait for completion (blocking)
    // For background transactions, fire and forget (non-blocking)
    if (isPriority) {
      await fetchPromise; // Wait for priority transactions
    }
    // Otherwise, let it run in background (don't await)
  }

  // Parse transaction to extract trade data
  parseTransaction(tx, signature, blockTime) {
    if (!tx.meta || !tx.transaction) return null;
    
    const mintAddress = this.currentMintAddress;
    if (!mintAddress) return null;

    // Filter: Only process transactions that involve swap programs
    // Pump.fun program: 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
    // Jupiter V6: JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4
    // Jupiter V4: JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB
    const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
    const JUPITER_V6_PROGRAM_ID = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
    const JUPITER_V4_PROGRAM_ID = 'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB';
    
    const instructions = tx.transaction.message?.instructions || [];
    const accountKeys = tx.transaction.message?.accountKeys || [];
    
    // Check if transaction involves swap programs
    let hasSwapProgram = false;
    for (const instruction of instructions) {
      let programId = null;
      if (typeof instruction.programId === 'string') {
        programId = instruction.programId;
      } else if (instruction.programIdIndex !== undefined && accountKeys[instruction.programIdIndex]) {
        const key = accountKeys[instruction.programIdIndex];
        programId = typeof key === 'string' ? key : (key.pubkey || key.toString());
      } else if (instruction.program === 'string') {
        programId = instruction.program;
      }
      
      if (programId && (
        programId === PUMP_PROGRAM_ID ||
        programId === JUPITER_V6_PROGRAM_ID ||
        programId === JUPITER_V4_PROGRAM_ID
      )) {
        hasSwapProgram = true;
        break;
      }
    }
    
    // Also check accountKeys for swap programs (some transactions might list them as accounts)
    if (!hasSwapProgram) {
      for (const key of accountKeys) {
        const addr = typeof key === 'string' ? key : (key.pubkey || key.toString());
        if (addr && (
          addr === PUMP_PROGRAM_ID ||
          addr === JUPITER_V6_PROGRAM_ID ||
          addr === JUPITER_V4_PROGRAM_ID
        )) {
          hasSwapProgram = true;
          break;
        }
      }
    }
    
    // Skip if this transaction doesn't involve swap programs
    // But allow if it has significant token balance changes (might be a swap via different method)
    const preTokenBalances = tx.meta.preTokenBalances || [];
    const postTokenBalances = tx.meta.postTokenBalances || [];
    
    // Check if there are significant token balance changes (indicating a swap)
    let hasSignificantTokenChange = false;
    for (const preToken of preTokenBalances) {
      if (preToken.mint === mintAddress) {
        const owner = preToken.owner;
        const preAmount = parseFloat(preToken.uiTokenAmount.uiAmountString || '0');
        
        // Find post balance
        const postToken = postTokenBalances.find(pt => pt.mint === mintAddress && pt.owner === owner);
        const postAmount = postToken ? parseFloat(postToken.uiTokenAmount.uiAmountString || '0') : 0;
        
        const change = Math.abs(postAmount - preAmount);
        if (change > 1000) { // Significant change (more than 1000 tokens)
          hasSignificantTokenChange = true;
          break;
        }
      }
    }
    
    // Only process if it involves swap programs OR has significant token changes
    if (!hasSwapProgram && !hasSignificantTokenChange) {
      return null; // Skip non-swap transactions
    }
    
    // Find token balance changes for our mint
    const trades = [];
    
    // Create a map of account -> token balance
    const accountBalances = new Map();
    
    // Process pre balances
    for (const preToken of preTokenBalances) {
      if (preToken.mint === mintAddress) {
        const owner = preToken.owner;
        const amount = parseFloat(preToken.uiTokenAmount.uiAmountString || '0');
        accountBalances.set(owner, { pre: amount, post: amount });
      }
    }
    
    // Process post balances
    for (const postToken of postTokenBalances) {
      if (postToken.mint === mintAddress) {
        const owner = postToken.owner;
        const amount = parseFloat(postToken.uiTokenAmount.uiAmountString || '0');
        const existing = accountBalances.get(owner) || { pre: 0, post: 0 };
        existing.post = amount;
        accountBalances.set(owner, existing);
      }
    }
    
    // Get the actual trader wallet (transaction signer/fee payer)
    // The first account in accountKeys is typically the fee payer/signer
    let traderAddress = null;
    
    if (accountKeys.length > 0) {
      const firstKey = accountKeys[0];
      if (typeof firstKey === 'string') {
        traderAddress = firstKey;
      } else if (firstKey && typeof firstKey === 'object') {
        traderAddress = firstKey.pubkey ? (typeof firstKey.pubkey === 'string' ? firstKey.pubkey : firstKey.pubkey.toString()) : firstKey.toString();
      }
    }
    
    // If we can't get from first account, try to find a signer account
    if (!traderAddress && accountKeys.length > 0) {
      for (let i = 0; i < Math.min(accountKeys.length, 10); i++) {
        const key = accountKeys[i];
        let addr;
        if (typeof key === 'string') {
          addr = key;
        } else if (key && typeof key === 'object') {
          addr = key.pubkey ? (typeof key.pubkey === 'string' ? key.pubkey : key.pubkey.toString()) : key.toString();
        }
        // Check if this account has SOL balance changes (likely the trader)
        if (addr && tx.meta.preBalances && tx.meta.postBalances && i < tx.meta.preBalances.length) {
          const preSol = tx.meta.preBalances[i] / 1e9;
          const postSol = tx.meta.postBalances[i] / 1e9;
          const solChange = Math.abs(preSol - postSol);
          // If SOL changed significantly (more than just fees), this is likely the trader
          if (solChange > 0.001) {
            traderAddress = addr;
            break;
          }
        }
      }
    }
    
    // Find accounts with balance changes
    for (const [owner, balances] of accountBalances.entries()) {
      const tokenChange = balances.post - balances.pre;
      if (Math.abs(tokenChange) < 0.000001) continue; // Ignore tiny changes
      
      // Find the owner's account index
      let ownerIndex = -1;
      for (let i = 0; i < accountKeys.length; i++) {
        const key = accountKeys[i];
        const addr = typeof key === 'string' ? key : (key.pubkey || key.toString());
        if (addr && addr.toLowerCase() === owner.toLowerCase()) {
          ownerIndex = i;
          break;
        }
      }
      
      // Use traderAddress if we found it, otherwise fall back to token account owner
      const actualTrader = traderAddress || owner;
      
      // Get transaction fee first
      const fee = tx.meta.fee / 1e9;
      
      // Calculate SOL balance change for the trader (not token account owner)
      let preSol = 0;
      let postSol = 0;
      let traderIndex = -1;
      
      // Find trader's account index
      for (let i = 0; i < accountKeys.length; i++) {
        const key = accountKeys[i];
        const addr = typeof key === 'string' ? key : (key.pubkey || key.toString());
        if (addr && addr.toLowerCase() === actualTrader.toLowerCase()) {
          traderIndex = i;
          break;
        }
      }
      
      // Use trader's SOL balance, not token account owner's
      if (traderIndex >= 0 && tx.meta.preBalances && tx.meta.postBalances) {
        preSol = tx.meta.preBalances[traderIndex] / 1e9;
        postSol = tx.meta.postBalances[traderIndex] / 1e9;
      } else if (ownerIndex >= 0 && tx.meta.preBalances && tx.meta.postBalances) {
        // Fallback to token account owner if trader not found
        preSol = tx.meta.preBalances[ownerIndex] / 1e9;
        postSol = tx.meta.postBalances[ownerIndex] / 1e9;
      }
      
      // CRITICAL: Only process if there's a significant SOL balance change (indicating a swap)
      // This filters out token transfers, creation, etc.
      const solChange = Math.abs(preSol - postSol);
      if (solChange < fee * 1.5) {
        // SOL change is less than ~1.5x the fee, likely not a swap
        continue;
      }
      
      // Determine buy/sell based on BOTH token and SOL balance changes
      // BUY: Token balance increases AND SOL balance decreases (spent SOL to get tokens)
      // SELL: Token balance decreases AND SOL balance increases (sold tokens to get SOL)
      const tokenIncreased = tokenChange > 0;
      const solDecreased = preSol > postSol && (preSol - postSol) > fee; // SOL decreased beyond just fees
      const solIncreased = postSol > preSol && (postSol - preSol) > fee; // SOL increased beyond just fees
      
      // Determine direction: use SOL balance change as primary indicator (more reliable)
      let isBuy;
      if (solDecreased && tokenIncreased) {
        // SOL decreased and tokens increased = BUY
        isBuy = true;
      } else if (solIncreased && !tokenIncreased) {
        // SOL increased and tokens decreased = SELL
        isBuy = false;
      } else {
        // Fallback: use token balance change
        // If tokens increased, it's a buy; if decreased, it's a sell
        isBuy = tokenIncreased;
      }
      
      const tokenAmount = Math.abs(tokenChange);
      let solAmount = 0;
      
      // Calculate SOL amount from balance changes, accounting for fees
      if (ownerIndex >= 0 && tx.meta.preBalances && tx.meta.postBalances) {
        if (isBuy) {
          // BUY: SOL decreased (spent SOL to buy tokens)
          // Balance change = swap amount + fees
          // So swap amount = balance change - fees
          const balanceChange = preSol - postSol;
          solAmount = Math.max(0, balanceChange - fee);
        } else {
          // SELL: SOL increased (received SOL from selling tokens)
          // Balance change = swap amount - fees (fees already deducted from received amount)
          // So swap amount = balance change + fees
          const balanceChange = postSol - preSol;
          solAmount = Math.max(0, balanceChange + fee);
        }
      }
      
      // If we still can't get SOL amount, try to find it from instruction data
      if (solAmount === 0 || solAmount < 0.000001) {
        // Look for SOL transfers in the transaction
        const instructions = tx.transaction.message?.instructions || [];
        for (const instruction of instructions) {
          if (instruction.program === 'system' && instruction.parsed && instruction.parsed.type === 'transfer') {
            const transferInfo = instruction.parsed.info;
            if (transferInfo && transferInfo.lamports) {
              const transferSol = transferInfo.lamports / 1e9;
              // If this is a buy and we're sending SOL, or sell and receiving SOL
              if ((isBuy && transferInfo.authority === owner) || (!isBuy && transferInfo.destination === owner)) {
                solAmount = transferSol;
                break;
              }
            }
          }
        }
      }
      
      // Skip if we still don't have a valid SOL amount (but be less strict)
      // Some trades might have very small amounts, so only skip if truly zero
      if (solAmount === 0) {
        // Try to estimate from token amount if SOL amount is zero
        if (tokenAmount > 0) {
          // Very rough estimate: assume price is around current market cap / supply
          const estimatedPrice = this.currentMarketCap ? (this.currentMarketCap / 1000000000) : 0.000001;
          solAmount = tokenAmount * estimatedPrice;
        }
        if (solAmount === 0) {
          return null; // Skip this trade - can't calculate price
        }
      }
      
      // Use current market cap from API if available, otherwise calculate
      let marketCap = this.currentMarketCap;
      if (!marketCap || marketCap === 0) {
        // Fallback: Calculate price per token (in SOL)
        const pricePerToken = tokenAmount > 0 ? solAmount / tokenAmount : 0;
        // Pump.fun tokens have 1B total supply
        const totalSupply = 1000000000; // 1B tokens
        marketCap = pricePerToken * totalSupply;
      }
      
      
      // Get timestamp
      const timestamp = blockTime ? blockTime * 1000 : (tx.blockTime ? tx.blockTime * 1000 : Date.now());
      const age = Math.floor((Date.now() - timestamp) / 60000); // minutes ago
      
      // Check if it's our wallet (case-insensitive comparison)
      // Use actualTrader (transaction signer) instead of owner (token account owner)
      const traderLower = actualTrader.toLowerCase();
      const isOurWallet = this.ourWallets.has(traderLower);
      const walletType = isOurWallet ? (this.walletTypes.get(traderLower) || 'Unknown') : null;
      
      // Debug logging for wallet matching
      if (isOurWallet) {
        console.log(`[LiveTrades] ✅ Found ${walletType} wallet trade: ${traderLower.slice(0, 8)}...`);
      }
      
      trades.push({
        signature: signature.slice(0, 8) + '...',
        fullSignature: signature,
        age: age,
        type: isBuy ? 'buy' : 'sell',
        marketCap: marketCap,
        amount: tokenAmount,
        totalUSD: solAmount * 150, // Approximate USD value (SOL price ~$150)
        gas: fee,
        trader: actualTrader.slice(0, 4) + '...' + actualTrader.slice(-4),
        fullTrader: actualTrader,
        timestamp: timestamp,
        solAmount: solAmount,
        isOurWallet: isOurWallet,
        walletType: walletType, // DEV, Bundle, or Holder
        slot: tx.slot || null
      });
    }
    
    // Return all trades (a transaction can have multiple swaps)
    // Sort by token amount (largest first) so most significant trades are processed first
    if (trades.length === 0) return null;
    
    trades.sort((a, b) => b.amount - a.amount);
    
    // Return all trades as an array (caller will handle array vs single trade)
    return trades;
  }

  // Add trade to list
  addTrade(trade) {
    // Insert trade in correct position (sorted by timestamp, newest first)
    let insertIndex = 0;
    for (let i = 0; i < this.trades.length; i++) {
      if (trade.timestamp > this.trades[i].timestamp) {
        insertIndex = i;
        break;
      }
      insertIndex = i + 1;
    }
    this.trades.splice(insertIndex, 0, trade);
    
    // Keep only the most recent trades
    if (this.trades.length > this.maxTrades) {
      this.trades = this.trades.slice(0, this.maxTrades);
    }
    
    // Sort to ensure correct order (newest first)
    this.trades.sort((a, b) => {
      if (b.timestamp !== a.timestamp) {
        return b.timestamp - a.timestamp;
      }
      if (a.slot && b.slot) {
        return b.slot - a.slot;
      }
      return 0;
    });
    
    // Update cache
    if (this.currentMintAddress) {
      this.tradeCache.set(this.currentMintAddress, [...this.trades]);
    }
    
    // Send to all listeners
    this.sendToAllListeners(trade);
  }

  // Get recent trades
  getTrades() {
    return this.trades;
  }
}

// Singleton instance
const liveTradesTracker = new LiveTradesTracker();
liveTradesTracker.initialize();

module.exports = liveTradesTracker;
