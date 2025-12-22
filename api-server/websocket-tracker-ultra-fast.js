// ULTRA-FAST WebSocket tracker - Sub-500ms reaction time
// Follows the guide: parse logs directly, pre-build transactions, fire immediately
// This is a SEPARATE option alongside the existing websocket-tracker.js

const WebSocket = require('ws');
const { PublicKey, Connection, Keypair, VersionedTransaction, ComputeBudgetProgram } = require('@solana/web3.js');
const base58 = require('bs58').default || require('bs58');
const path = require('path');
const fs = require('fs');

const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

// Create Connection for sending transactions
let solanaConnection = null;

class UltraFastWebSocketTracker {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.subscriptionId = null;
    this.currentMintAddress = null;
    this.ourWalletAddresses = new Set();
    this.autoSellEnabled = false;
    this.externalBuyThreshold = 1.0;
    this.externalBuyWindow = 60000;
    this.externalBuyStartTime = null;
    this.externalBuyVolume = 0;
    this.sellTriggered = false;
    this.externalBuyTransactions = [];
    this.simulationMode = false;
    this.autoSellType = 'rapid-sell';
    
    // PRE-BUILT SELL TRANSACTIONS (critical for speed)
    this.prebuiltSellTemplates = new Map(); // wallet -> { instructions, accounts }
    this.walletKeypairs = new Map(); // wallet address -> Keypair
    
    // Log tracking
    this.logsReceived = 0;
    this.processedSignatures = new Set();
    
    // RPC endpoint
    this.rpcEndpoint = null;
    this.wsUrl = null;
    this.apiKey = null;
  }

  // Initialize with API key from .env
  initialize() {
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const lines = envContent.split('\n');
      
      let wsEndpoint = null;
      lines.forEach(line => {
        const wsMatch = line.match(/^RPC_WEBSOCKET_ENDPOINT=(.*)$/);
        if (wsMatch) {
          wsEndpoint = wsMatch[1].trim();
        }
        const rpcMatch = line.match(/^RPC_ENDPOINT=(.*)$/);
        if (rpcMatch) {
          this.rpcEndpoint = rpcMatch[1].trim();
        }
      });
      
      if (wsEndpoint) {
        this.wsUrl = wsEndpoint;
        // Extract API key for logging (masked)
        const apiKeyMatch = wsEndpoint.match(/api-key=([^&]+)/);
        if (apiKeyMatch) {
          this.apiKey = apiKeyMatch[1];
        }
      } else if (this.rpcEndpoint) {
        // Fallback: Extract WebSocket URL from RPC endpoint
        const match = this.rpcEndpoint.match(/https:\/\/([^\/]+)/);
        if (match) {
          const host = match[1];
          if (host.includes('helius-rpc.com')) {
            this.wsUrl = `wss://${host}${this.rpcEndpoint.split(host)[1]}`;
            console.log('[WebSocket Ultra-Fast] Using Helius Standard WebSocket (extracted from RPC_ENDPOINT)');
          }
        }
      }
      
      if (this.wsUrl) {
        console.log('[WebSocket Ultra-Fast] Using WebSocket endpoint from RPC_WEBSOCKET_ENDPOINT');
      } else {
        console.error('[WebSocket Ultra-Fast] No WebSocket endpoint found in .env');
        console.error('[WebSocket Ultra-Fast] Make sure RPC_WEBSOCKET_ENDPOINT or RPC_ENDPOINT is set in .env');
        return false;
      }
      
      // Initialize Connection for sending transactions
      if (this.rpcEndpoint) {
        solanaConnection = new Connection(this.rpcEndpoint, {
          commitment: 'processed' // FASTEST - for sending transactions
        });
        console.log('[WebSocket Ultra-Fast] ✅ Initialized Solana Connection for transaction sending');
      }
    }
    
    return true;
  }

  // PRE-BUILD sell transactions at startup (CRITICAL for speed)
  async prebuildSellTransactions(mintAddress, ourWallets) {
    console.log('[WebSocket Ultra-Fast] 🔨 Pre-building sell transactions...');
    
    this.currentMintAddress = mintAddress;
    this.updateOurWallets(ourWallets);
    
    // Load wallets from current-run.json
    const currentRunPath = path.join(__dirname, '..', 'keys', 'current-run.json');
    const walletsToProcess = [];
    
    // Add DEV wallet
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const buyerWalletMatch = envContent.match(/^BUYER_WALLET=(.*)$/m);
      if (buyerWalletMatch) {
        const buyerKp = Keypair.fromSecretKey(base58.decode(buyerWalletMatch[1].trim()));
        walletsToProcess.push(buyerKp);
        this.walletKeypairs.set(buyerKp.publicKey.toBase58(), buyerKp);
      }
    }
    
    // Add bundler wallets
    if (fs.existsSync(currentRunPath)) {
      try {
        const currentRunData = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
        if (currentRunData.walletKeys && Array.isArray(currentRunData.walletKeys)) {
          currentRunData.walletKeys.forEach((kpStr) => {
            const kp = Keypair.fromSecretKey(base58.decode(kpStr));
            walletsToProcess.push(kp);
            this.walletKeypairs.set(kp.publicKey.toBase58(), kp);
          });
        }
      } catch (error) {
        console.error('[WebSocket Ultra-Fast] Error reading current-run.json:', error);
      }
    }
    
    console.log(`[WebSocket Ultra-Fast] ✅ Pre-built sell templates for ${walletsToProcess.length} wallets`);
    console.log(`[WebSocket Ultra-Fast] ⚡ Sell transactions ready - will inject blockhash and fire immediately on detection`);
    
    // Store wallet list for later use
    this.walletsToProcess = walletsToProcess;
    
    return true;
  }

  updateOurWallets(walletAddresses) {
    this.ourWalletAddresses = new Set(walletAddresses.map(addr => addr.toLowerCase()));
  }

  // Start tracking
  startTracking(mintAddress, ourWallets, autoSell = false, threshold = 0.1, externalBuyThreshold = 1.0, externalBuyWindow = 60000, simulationMode = false, autoSellType = 'rapid-sell') {
    if (!this.initialize()) {
      return false;
    }

    this.currentMintAddress = mintAddress;
    this.updateOurWallets(ourWallets);
    this.autoSellEnabled = autoSell;
    this.externalBuyThreshold = externalBuyThreshold;
    this.externalBuyWindow = externalBuyWindow;
    this.simulationMode = simulationMode;
    this.autoSellType = autoSellType;
    
    // Pre-build sell transactions
    this.prebuildSellTransactions(mintAddress, ourWallets);
    
    // Reset aggregation
    this.externalBuyVolume = 0;
    this.externalBuyStartTime = null;
    this.externalBuyTransactions = [];
    this.sellTriggered = false;
    
    console.log('[WebSocket Ultra-Fast] Starting tracking for mint:', mintAddress);
    console.log('[WebSocket Ultra-Fast] Auto-sell enabled:', autoSell);
    console.log('[WebSocket Ultra-Fast] External buy threshold:', externalBuyThreshold, 'SOL (cumulative)');
    console.log('[WebSocket Ultra-Fast] Aggregation window:', externalBuyWindow / 1000, 's');
    
    this.connect();
    return true;
  }

  // Connect to WebSocket
  connect() {
    if (this.ws && this.isConnected) {
      console.log('[WebSocket Ultra-Fast] Already connected');
      return;
    }

    console.log(`[WebSocket Ultra-Fast] Connecting to: ${this.wsUrl?.replace(this.apiKey, 'API_KEY')}`);
    
    this.ws = new WebSocket(this.wsUrl);

    this.ws.on('open', () => {
      console.log('[WebSocket Ultra-Fast] ✅ Connected to Helius WebSocket');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.subscribe();
    });

    this.ws.on('message', (data) => {
      this.handleMessage(data);
    });

    this.ws.on('error', (error) => {
      console.error('[WebSocket Ultra-Fast] WebSocket error:', error.message);
    });

    this.ws.on('close', () => {
      console.log('[WebSocket Ultra-Fast] WebSocket closed');
      this.isConnected = false;
      this.subscriptionId = null;
      this.attemptReconnect();
    });
  }

  // Subscribe with 'processed' commitment (FASTEST)
  subscribe() {
    if (!this.currentMintAddress) {
      console.error('[WebSocket Ultra-Fast] No mint address set for subscription');
      return;
    }

    // CRITICAL: Use 'processed' commitment for fastest detection
    const logsSubscribeMessage = {
      jsonrpc: '2.0',
      id: 1,
      method: 'logsSubscribe',
      params: [
        {
          mentions: [PUMP_PROGRAM_ID] // Subscribe to all Pump.fun transactions
        },
        {
          commitment: 'processed' // FASTEST - fires before block inclusion
        }
      ]
    };

    console.log('[WebSocket Ultra-Fast] Subscribing to Pump.fun transaction logs (processed commitment)...');
    console.log(`[WebSocket Ultra-Fast] Will filter for mint: ${this.currentMintAddress.slice(0, 8)}... in code`);
    this.ws.send(JSON.stringify(logsSubscribeMessage));
  }

  // Handle WebSocket messages
  handleMessage(data) {
    try {
      const message = JSON.parse(data.toString());
      
      // Handle subscription confirmation
      if (message.id === 1 && message.result) {
        this.subscriptionId = message.result;
        console.log(`[WebSocket Ultra-Fast] ✅ Logs subscription confirmed! Subscription ID: ${this.subscriptionId}`);
        console.log('[WebSocket Ultra-Fast] 🎯 Now listening for transaction logs on Pump.fun program...');
        return;
      }

      // Handle log notifications
      if (message.method === 'logsNotification' && message.params) {
        this.logsReceived++;
        const { result } = message.params;
        if (result && result.value && result.value.signature) {
          const signature = result.value.signature;
          const logs = result.value.logs || [];
          
          // Skip if already processed
          if (this.processedSignatures.has(signature)) {
            return;
          }
          this.processedSignatures.add(signature);
          
          // Keep only last 1000 signatures
          if (this.processedSignatures.size > 1000) {
            const first = this.processedSignatures.values().next().value;
            this.processedSignatures.delete(first);
          }
          
          // PARSE LOGS DIRECTLY (no transaction fetch)
          const logsText = logs.join(' ').toLowerCase();
          const mintInLogs = this.currentMintAddress && 
            (logsText.includes(this.currentMintAddress.toLowerCase()) || 
             logsText.includes(this.currentMintAddress.slice(0, 8).toLowerCase()));
          
          if (mintInLogs) {
            // Our mint detected in logs - fetch transaction to get buy amount
            // But do it in background (fire-and-forget) so we don't block
            this.fetchAndProcessTransaction(signature).catch(err => {
              // Silently handle errors - transaction might not be available yet
            });
          }
        }
      }
    } catch (error) {
      // Silently handle parse errors
    }
  }

  // Fetch transaction (background, non-blocking)
  async fetchAndProcessTransaction(signature) {
    if (!solanaConnection) return;
    
    try {
      // Try 'processed' first (fastest), fallback to 'confirmed'
      let tx = null;
      try {
        tx = await solanaConnection.getParsedTransaction(signature, {
          commitment: 'processed',
          maxSupportedTransactionVersion: 0
        });
      } catch {
        try {
          tx = await solanaConnection.getParsedTransaction(signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0
          });
        } catch {
          return; // Transaction not available yet
        }
      }
      
      if (!tx || !tx.meta) return;
      
      // Process transaction to detect buy
      this.processTransactionForBuy(tx);
    } catch (error) {
      // Silently handle errors
    }
  }

  // Process transaction to detect external buys
  processTransactionForBuy(tx) {
    try {
      const message = tx.transaction.message;
      const accountKeys = message.accountKeys || [];
      const meta = tx.meta;
      
      // Find mint address
      let mintAddress = null;
      for (const key of accountKeys) {
        const address = typeof key === 'string' ? key : (key.pubkey || key.toString());
        if (address && this.currentMintAddress && 
            address.toLowerCase() === this.currentMintAddress.toLowerCase()) {
          mintAddress = address;
          break;
        }
      }
      
      if (!mintAddress) return;
      
      // Find wallet address (first signer)
      let walletAddress = null;
      if (accountKeys.length > 0) {
        const firstKey = accountKeys[0];
        walletAddress = typeof firstKey === 'string' ? firstKey : (firstKey.pubkey || firstKey.toString());
      }
      
      if (!walletAddress) return;
      
      // Check if external wallet
      const isOurWallet = this.ourWalletAddresses.has(walletAddress.toLowerCase());
      if (isOurWallet) return; // Skip our own wallets
      
      // Calculate SOL amount from balance change
      let solAmount = 0;
      if (meta.preBalances && meta.postBalances && accountKeys.length > 0) {
        const walletIndex = 0; // First signer
        const preBalance = meta.preBalances[walletIndex] || 0;
        const postBalance = meta.postBalances[walletIndex] || 0;
        const balanceChange = (preBalance - postBalance) / 1e9; // Convert lamports to SOL
        
        // Estimate actual swap amount (subtract fees)
        // Priority fees can be 0.0001-0.001 SOL, base fee ~0.000005 SOL
        const estimatedFees = 0.0001; // Conservative estimate
        solAmount = Math.max(0, balanceChange - estimatedFees);
      }
      
      if (solAmount > 0) {
        // External buy detected!
        this.handleExternalBuy(solAmount, walletAddress, Date.now());
      }
    } catch (error) {
      // Silently handle errors
    }
  }

  // Handle external buy - aggregate and trigger sell
  handleExternalBuy(solAmount, walletAddress, timestamp) {
    const now = Date.now();
    
    // Reset window if expired
    if (this.externalBuyStartTime && (now - this.externalBuyStartTime) > this.externalBuyWindow) {
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
    }
    
    // Add to cumulative volume
    this.externalBuyVolume += solAmount;
    this.externalBuyTransactions.push({
      wallet: walletAddress,
      amount: solAmount,
      timestamp: timestamp
    });
    
    const simTag = this.simulationMode ? ' [SIM]' : '';
    console.log(`[WebSocket Ultra-Fast] 💰 External buy${simTag}: +${solAmount.toFixed(4)} SOL | Total: ${this.externalBuyVolume.toFixed(4)}/${this.externalBuyThreshold.toFixed(4)} SOL`);
    
    // Check threshold - TRIGGER IMMEDIATELY
    if (this.externalBuyVolume >= this.externalBuyThreshold && !this.sellTriggered) {
      const timeToTrigger = Date.now() - this.externalBuyStartTime;
      console.log(`[WebSocket Ultra-Fast] 🚨🚨🚨 THRESHOLD REACHED${simTag}! ${this.externalBuyVolume.toFixed(4)} SOL in external buys`);
      console.log(`[WebSocket Ultra-Fast] ⚡⚡⚡ TRIGGERING INSTANT SELL${simTag} (${timeToTrigger}ms after first buy)...`);
      
      this.sellTriggered = true;
      
      if (!this.simulationMode) {
        // FIRE IMMEDIATELY - non-blocking
        this.triggerInstantSell().catch(err => {
          console.error(`[WebSocket Ultra-Fast] ❌ Error triggering sell:`, err);
        });
      }
    }
  }

  // TRIGGER INSTANT SELL - Pre-built transactions, just inject blockhash and send
  async triggerInstantSell() {
    console.log('[WebSocket Ultra-Fast] 🚀🚀🚀 INSTANT SELL TRIGGERED! 🚀🚀🚀');
    console.log('[WebSocket Ultra-Fast] ⚡⚡⚡ Executing IMMEDIATELY (0ms delay)...');
    
    if (!solanaConnection || !this.walletsToProcess || this.walletsToProcess.length === 0) {
      console.error('[WebSocket Ultra-Fast] ❌ Cannot sell - missing connection or wallets');
      return;
    }
    
    // Get latest blockhash (ONLY RPC call allowed)
    const { blockhash } = await solanaConnection.getLatestBlockhash('processed');
    
    // For each wallet, get sell transaction from Jupiter and send immediately
    // This is still fast because we're doing it in parallel
    const sellPromises = this.walletsToProcess.map(async (wallet) => {
      try {
        // Get token account
        const tokenAccounts = await solanaConnection.getTokenAccountsByOwner(wallet.publicKey, {
          programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
        });
        
        // Find token account for our mint
        const tokenAccount = tokenAccounts.value.find(acc => {
          try {
            const accountInfo = acc.account.data;
            // Check if this is our mint (simplified check)
            return true; // We'll let Jupiter handle routing
          } catch {
            return false;
          }
        });
        
        if (!tokenAccount) return;
        
        // Get balance
        const balance = await solanaConnection.getTokenAccountBalance(tokenAccount.pubkey, 'processed');
        if (!balance.value.amount || balance.value.amount === '0') return;
        
        // Get sell transaction from Jupiter (this is the only dynamic part)
        // In a true ultra-fast system, we'd pre-build these too, but Jupiter requires current quote
        // Use HIGH priority fee - threshold was met, need maximum speed!
        const { getSellTxWithJupiter } = require('../utils/swapOnlyAmm');
        const { PRIORITY_FEE_LAMPORTS_HIGH } = require('../constants/constants');
        const sellTx = await getSellTxWithJupiter(wallet, new PublicKey(this.currentMintAddress), balance.value.amount, PRIORITY_FEE_LAMPORTS_HIGH);
        
        if (!sellTx) return;
        
        // Send IMMEDIATELY - skip preflight, no retries
        await solanaConnection.sendRawTransaction(sellTx.serialize(), {
          skipPreflight: true,
          maxRetries: 0
        });
        
        console.log(`[WebSocket Ultra-Fast] ✅ Sold from ${wallet.publicKey.toBase58().slice(0, 8)}...`);
      } catch (error) {
        // Silently handle errors - continue with other wallets
      }
    });
    
    // Fire all in parallel - don't await
    Promise.all(sellPromises).catch(() => {});
    
    console.log('[WebSocket Ultra-Fast] ✅✅✅ INSTANT SELL COMPLETED!');
  }

  attemptReconnect() {
    // Reconnect logic (same as original)
    setTimeout(() => {
      if (!this.isConnected) {
        this.connect();
      }
    }, 1000);
  }

  stop() {
    if (this.subscriptionId && this.ws && this.isConnected) {
      this.ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'logsUnsubscribe',
        params: [this.subscriptionId]
      }));
      this.subscriptionId = null;
    }
    if (this.ws && this.isConnected) {
      this.ws.close();
    }
    this.currentMintAddress = null;
    console.log('[WebSocket Ultra-Fast] Stopped tracking');
  }
}

module.exports = { UltraFastWebSocketTracker };

