// ULTRA-FAST WebSocket tracker - Sub-500ms reaction time
// Follows the guide: parse logs directly, pre-build transactions, fire immediately
// This is a SEPARATE option alongside the existing websocket-tracker.js

const WebSocket = require('ws');
const { PublicKey, Connection, Keypair, VersionedTransaction, ComputeBudgetProgram } = require('@solana/web3.js');
const base58 = require('bs58').default || require('bs58');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

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
    this.transactionsFetched = 0; // Count transactions fetched
    this.processedSignatures = new Set(); // Track processed signatures
    this.pendingTransactions = new Set(); // Track pending transactions
    
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
    
    // Staged sell tracking
    this.stagedSellEnabled = false;
    this.stagedSellStage1Threshold = 5.0;
    this.stagedSellStage2Threshold = 10.0;
    this.stagedSellStage3Threshold = 20.0;
    this.stagedSellStage1Triggered = false;
    this.stagedSellStage2Triggered = false;
    this.stagedSellStage3Triggered = false;
  }

  // Initialize with API key from .env
  initialize() {
    console.log('[WebSocket Ultra-Fast] 🔧 Initializing...');
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
      console.log('[WebSocket Ultra-Fast] ✅ Found .env file');
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
        console.log('[WebSocket Ultra-Fast] ✅ Using WebSocket endpoint from RPC_WEBSOCKET_ENDPOINT');
        console.log(`[WebSocket Ultra-Fast] 📍 WebSocket URL: ${this.wsUrl?.replace(this.apiKey || '', 'API_KEY')}`);
      } else {
        console.error('[WebSocket Ultra-Fast] ❌ No WebSocket endpoint found in .env');
        console.error('[WebSocket Ultra-Fast] Make sure RPC_WEBSOCKET_ENDPOINT or RPC_ENDPOINT is set in .env');
        return false;
      }
      
      // Initialize Connection for sending transactions
      if (this.rpcEndpoint) {
        solanaConnection = new Connection(this.rpcEndpoint, {
          commitment: 'processed' // FASTEST - for sending transactions
        });
        console.log('[WebSocket Ultra-Fast] ✅ Initialized Solana Connection for transaction sending');
        console.log(`[WebSocket Ultra-Fast] 📍 RPC Endpoint: ${this.rpcEndpoint?.replace(/api-key=[^&]+/, 'api-key=API_KEY')}`);
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
  startTracking(mintAddress, ourWallets, autoSell = false, threshold = 0.1, externalBuyThreshold = 1.0, externalBuyWindow = 60000, simulationMode = false, autoSellType = 'rapid-sell', stagedSellConfig = null) {
    console.log('[WebSocket Ultra-Fast] 🔧 startTracking called');
    console.log(`[WebSocket Ultra-Fast] 📍 Mint: ${mintAddress}`);
    console.log(`[WebSocket Ultra-Fast] 📍 Wallets: ${ourWallets.length} addresses`);
    
    if (!this.initialize()) {
      console.error('[WebSocket Ultra-Fast] ❌ Initialize failed - cannot start tracking');
      return false;
    }
    
    console.log('[WebSocket Ultra-Fast] ✅ Initialize succeeded');

    this.currentMintAddress = mintAddress;
    this.updateOurWallets(ourWallets);
    this.autoSellEnabled = autoSell;
    this.externalBuyThreshold = externalBuyThreshold;
    this.externalBuyWindow = externalBuyWindow;
    this.simulationMode = simulationMode;
    this.autoSellType = autoSellType;
    
    // Configure staged sell if enabled
    if (stagedSellConfig && stagedSellConfig.enabled) {
      this.stagedSellEnabled = true;
      this.stagedSellStage1Threshold = stagedSellConfig.stage1Threshold || 5.0;
      this.stagedSellStage2Threshold = stagedSellConfig.stage2Threshold || 10.0;
      this.stagedSellStage3Threshold = stagedSellConfig.stage3Threshold || 20.0;
      console.log('[WebSocket Ultra-Fast] 🎯 Staged sell ENABLED');
      console.log(`[WebSocket Ultra-Fast]   Stage 1: ${this.stagedSellStage1Threshold} SOL (30% of wallets)`);
      console.log(`[WebSocket Ultra-Fast]   Stage 2: ${this.stagedSellStage2Threshold} SOL (30% of wallets)`);
      console.log(`[WebSocket Ultra-Fast]   Stage 3: ${this.stagedSellStage3Threshold} SOL (40% + DEV wallet)`);
    } else {
      this.stagedSellEnabled = false;
    }
    
    // Pre-build sell transactions
    this.prebuildSellTransactions(mintAddress, ourWallets);
    
    // Reset aggregation
    this.externalBuyVolume = 0;
    this.externalBuyStartTime = null;
    this.externalBuyTransactions = [];
    this.sellTriggered = false;
    this.stagedSellStage1Triggered = false;
    this.stagedSellStage2Triggered = false;
    this.stagedSellStage3Triggered = false;
    
    console.log('[WebSocket Ultra-Fast] Starting tracking for mint:', mintAddress);
    console.log('[WebSocket Ultra-Fast] Auto-sell enabled:', autoSell);
    if (this.stagedSellEnabled) {
      console.log('[WebSocket Ultra-Fast] Sell type: STAGED SELL');
    } else {
      console.log('[WebSocket Ultra-Fast] Sell type:', autoSellType);
    }
    console.log('[WebSocket Ultra-Fast] External buy threshold:', externalBuyThreshold, 'SOL (cumulative)');
    const windowSeconds = externalBuyWindow && !isNaN(externalBuyWindow) ? (externalBuyWindow / 1000) : 60;
    console.log('[WebSocket Ultra-Fast] Aggregation window:', windowSeconds, 's');
    
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

    this.ws.on('close', (code, reason) => {
      console.log(`[WebSocket Ultra-Fast] WebSocket closed (code: ${code}, reason: ${reason || 'none'})`);
      this.isConnected = false;
      this.subscriptionId = null;
      // Only reconnect if it wasn't a clean shutdown
      if (code !== 1000) {
        this.attemptReconnect();
      }
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
        console.log(`[WebSocket Ultra-Fast] 📍 Tracking mint: ${this.currentMintAddress}`);
        const walletList = Array.from(this.ourWalletAddresses).slice(0, 3);
        console.log(`[WebSocket Ultra-Fast] 📍 Our wallets (${this.ourWalletAddresses.size}): ${walletList.map(w => w.slice(0, 8) + '...').join(', ')}${this.ourWalletAddresses.size > 3 ? '...' : ''}`);
        return;
      }

      // Handle subscription errors
      if (message.error) {
        console.error(`[WebSocket Ultra-Fast] ❌ Subscription error:`, JSON.stringify(message.error, null, 2));
        return;
      }

      // Handle log notifications
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
            this.fetchAndProcessTransaction(signature, true); // true = priority
          } else {
            // BACKGROUND: Process in parallel without blocking (fire and forget)
            this.fetchAndProcessTransaction(signature, false); // false = background
          }
        }
      }
    } catch (error) {
      console.error('[WebSocket Ultra-Fast] ❌ Error parsing message:', error.message);
    }
  }

  // Fetch transaction (background, non-blocking)
  async fetchAndProcessTransaction(signature, isPriority = false) {
    // Avoid processing the same transaction twice
    if (this.processedSignatures.has(signature) || this.pendingTransactions.has(signature)) {
      return;
    }
    
    // Mark as pending
    this.pendingTransactions.add(signature);
    this.processedSignatures.add(signature);
    
    // Keep only last 1000 signatures
    if (this.processedSignatures.size > 1000) {
      const first = this.processedSignatures.values().next().value;
      this.processedSignatures.delete(first);
    }
    
    // Increment counter
    this.transactionsFetched++;
    if (!solanaConnection) {
      if (this.logsReceived % 100 === 0) {
        console.log(`[WebSocket Ultra-Fast] ⚠️  No Solana connection available`);
      }
      return;
    }
    
    try {
      // Try 'processed' first (fastest), fallback to 'confirmed'
      let tx = null;
      try {
        tx = await solanaConnection.getParsedTransaction(signature, {
          commitment: 'processed',
          maxSupportedTransactionVersion: 0
        });
      } catch (err) {
        try {
          tx = await solanaConnection.getParsedTransaction(signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0
          });
        } catch {
          // Transaction not available yet - this is normal for 'processed' commitment
          return;
        }
      }
      
      if (!tx) {
        return; // Transaction not available yet
      }
      
      if (!tx.meta) {
        // Some transactions don't have meta (e.g., failed transactions) - skip silently
        return;
      }
      
      // Check if this transaction involves our mint address
      const message = tx.transaction.message;
      const accountKeys = message.accountKeys || [];
      
      // Check if mint address is in account keys
      let hasOurMint = false;
      for (const key of accountKeys) {
        let addressStr;
        try {
          if (typeof key === 'string') {
            addressStr = key;
          } else if (key && typeof key === 'object') {
            // Handle PublicKey object or object with pubkey property
            if (key.pubkey) {
              addressStr = typeof key.pubkey === 'string' ? key.pubkey : (key.pubkey.toString ? key.pubkey.toString() : String(key.pubkey));
            } else {
              addressStr = key.toString ? key.toString() : String(key);
            }
          } else {
            addressStr = String(key);
          }
          
          // Ensure addressStr is a string before calling toLowerCase
          if (typeof addressStr !== 'string') {
            addressStr = String(addressStr);
          }
          
          if (addressStr && this.currentMintAddress) {
            const addressLower = addressStr.toLowerCase();
            const mintLower = this.currentMintAddress.toLowerCase();
            if (addressLower === mintLower) {
              hasOurMint = true;
              break;
            }
          }
        } catch (err) {
          // Skip this key if we can't process it
          continue;
        }
      }
      
      // ALSO check token balances (mint might not be in account keys directly)
      if (!hasOurMint && tx.meta && (tx.meta.preTokenBalances || tx.meta.postTokenBalances)) {
        const allTokenBalances = [...(tx.meta.preTokenBalances || []), ...(tx.meta.postTokenBalances || [])];
        for (const balance of allTokenBalances) {
          try {
            if (balance && balance.mint) {
              let mintStr;
              if (typeof balance.mint === 'string') {
                mintStr = balance.mint;
              } else if (balance.mint && typeof balance.mint === 'object') {
                mintStr = balance.mint.toString ? balance.mint.toString() : String(balance.mint);
              } else {
                mintStr = String(balance.mint);
              }
              
              if (typeof mintStr !== 'string') {
                mintStr = String(mintStr);
              }
              
              if (mintStr && this.currentMintAddress) {
                const mintLower = mintStr.toLowerCase();
                const currentMintLower = this.currentMintAddress.toLowerCase();
                if (mintLower === currentMintLower) {
                  hasOurMint = true;
                  break;
                }
              }
            }
          } catch (err) {
            // Skip this balance if we can't process it
            continue;
          }
        }
      }
      
      // Only process if it's our mint - use the SAME logic as standard tracker
      if (hasOurMint) {
        // Convert to same format as standard tracker expects
        const txData = {
          transaction: {
            message: tx.transaction.message,
            signatures: tx.transaction.signatures || [signature]
          },
          meta: tx.meta
        };
        this.processTransaction(txData);
      }
      
      // Remove from pending
      this.pendingTransactions.delete(signature);
    } catch (error) {
      // Remove from pending on error
      this.pendingTransactions.delete(signature);
      
      // Log errors occasionally (not every single one to avoid spam)
      if (this.logsReceived % 100 === 0 || error.message.includes('meta is not defined')) {
        console.error(`[WebSocket Ultra-Fast] ❌ Error fetching transaction:`, error.message);
      }
    }
  }

  // Process transaction to identify buys/sells (EXACT COPY FROM STANDARD TRACKER)
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
              addressStr = typeof key.pubkey === 'string' ? key.pubkey : (key.pubkey.toString ? key.pubkey.toString() : String(key.pubkey));
            } else {
              addressStr = key.toString ? key.toString() : String(key);
            }
          } else {
            addressStr = String(key);
          }
          
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

      // If mint not found in this transaction, skip
      if (!mintInTransaction || !mintAddress) {
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
            if (firstKey.pubkey) {
              walletAddressStr = typeof firstKey.pubkey === 'string' ? firstKey.pubkey : (firstKey.pubkey.toString ? firstKey.pubkey.toString() : String(firstKey.pubkey));
            } else {
              walletAddressStr = firstKey.toString ? firstKey.toString() : String(firstKey);
            }
          } else {
            walletAddressStr = String(firstKey);
          }
          
          if (typeof walletAddressStr !== 'string') {
            walletAddressStr = String(walletAddressStr);
          }
        } catch (err) {
          return;
        }
      }

      if (!walletAddressStr) {
        return;
      }

      // Check if this is one of our wallets
      const isOurWallet = this.ourWalletAddresses.has(walletAddressStr.toLowerCase());

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
        
        const tokenBalanceChange = postTokenBalance - preTokenBalance;
        const rawBalanceChange = Math.abs(preSolBalance - postSolBalance);
        
        const baseFee = 0.000005;
        let estimatedFees = baseFee;
        
        if (rawBalanceChange > 0.01) {
          const estimatedPriorityFee = 0.002;
          const estimatedPumpFunFee = rawBalanceChange * 0.02;
          estimatedFees = baseFee + estimatedPriorityFee + estimatedPumpFunFee;
        } else if (rawBalanceChange > 0.001) {
          const estimatedPriorityFee = 0.001;
          const estimatedPumpFunFee = rawBalanceChange * 0.02;
          estimatedFees = baseFee + estimatedPriorityFee + estimatedPumpFunFee;
        }
        
        if (rawBalanceChange > estimatedFees) {
          solAmount = rawBalanceChange - estimatedFees;
        } else {
          solAmount = rawBalanceChange;
        }
        
        if (rawBalanceChange > 0.01 && solAmount > rawBalanceChange * 0.88) {
          const alternativeAmount = rawBalanceChange * 0.88;
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

      // Log the transaction
      if (isBuy || isSell) {
        const tradeType = isBuy ? 'BUY' : 'SELL';
        const walletType = isOurWallet ? 'OUR WALLET' : 'EXTERNAL';
        const timestamp = Date.now();
        const simTag = this.simulationMode ? ' [SIM]' : '';
        
        console.log(`[WebSocket Ultra-Fast] 🔔 ${tradeType} detected${simTag}: ${walletType} | ${walletAddressStr.slice(0, 8)}... | ${solAmount.toFixed(4)} SOL`);
        
        // AGGREGATE EXTERNAL BUYS/SELLS (NET VOLUME) and trigger when cumulative threshold reached
        // Buys add to volume, sells subtract from volume (net buying pressure)
        // This ensures we only trigger on REAL net buying pressure, not gross volume
        if (!isOurWallet && this.autoSellEnabled && solAmount > 0) {
          // For buys: add positive amount, for sells: add negative amount (subtracts from total)
          const volumeChange = isBuy ? solAmount : -solAmount;
          this.handleExternalBuy(volumeChange, walletAddressStr, timestamp);
        }
      }

    } catch (error) {
      console.error('[WebSocket Ultra-Fast] Error processing transaction:', error);
    }
  }

  // Get wallet's token balance for a specific mint (EXACT COPY FROM STANDARD TRACKER)
  getWalletTokenBalance(balances, walletAddress, mintAddress) {
    if (!balances || !Array.isArray(balances)) return 0;
    
    const walletAddressStr = typeof walletAddress === 'string' ? walletAddress : (walletAddress ? String(walletAddress) : '');
    const mintAddressStr = typeof mintAddress === 'string' ? mintAddress : (mintAddress ? String(mintAddress) : '');
    
    for (const balance of balances) {
      const owner = balance.owner;
      const mint = balance.mint;
      
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

  // Handle external buy/sell - aggregate NET volume and trigger sell
  // solAmount can be positive (buy) or negative (sell) for net volume tracking
  handleExternalBuy(solAmount, walletAddress, timestamp) {
    const now = Date.now();
    
    // Slide window forward if expired - remove old transactions outside the window but keep current volume
    if (this.externalBuyStartTime && (now - this.externalBuyStartTime) > this.externalBuyWindow) {
      // Remove transactions outside the current window
      const windowStart = now - this.externalBuyWindow;
      const oldTransactions = this.externalBuyTransactions.filter(tx => tx.timestamp < windowStart);
      
      // Subtract old transactions from volume to maintain accurate NET volume
      for (const oldTx of oldTransactions) {
        this.externalBuyVolume -= oldTx.amount;
      }
      
      // Remove old transactions from array
      this.externalBuyTransactions = this.externalBuyTransactions.filter(tx => tx.timestamp >= windowStart);
      
      // Update window start time to the oldest remaining transaction, or current time if none
      if (this.externalBuyTransactions.length > 0) {
        this.externalBuyStartTime = Math.min(...this.externalBuyTransactions.map(tx => tx.timestamp));
      } else {
        // No transactions in window, start fresh
        this.externalBuyStartTime = now;
        this.externalBuyVolume = 0;
      }
      
      // Ensure volume never goes below 0 after removing old transactions
      if (this.externalBuyVolume < 0) {
        this.externalBuyVolume = 0;
      }
    }
    
    // Start new window if needed
    if (!this.externalBuyStartTime) {
      this.externalBuyStartTime = now;
      this.externalBuyVolume = 0;
      this.externalBuyTransactions = [];
      this.sellTriggered = false;
      if (this.stagedSellEnabled) {
        this.stagedSellStage1Triggered = false;
        this.stagedSellStage2Triggered = false;
        this.stagedSellStage3Triggered = false;
      }
    }
    
    // Add to cumulative NET volume (buys add, sells subtract)
    this.externalBuyVolume += solAmount;
    // Ensure volume never goes below 0 (can't have negative net buying pressure)
    if (this.externalBuyVolume < 0) {
      this.externalBuyVolume = 0;
    }
    this.externalBuyTransactions.push({
      wallet: walletAddress,
      amount: solAmount,
      timestamp: timestamp
    });
    
    const simTag = this.simulationMode ? ' [SIM]' : '';
    const isSell = solAmount < 0;
    const volumeType = isSell ? 'sell' : 'buy';
    const volumeSign = isSell ? '-' : '+';
    
    // Check staged sell thresholds first (if enabled)
    if (this.stagedSellEnabled) {
      // Stage 1: 30% at 5 SOL
      if (this.externalBuyVolume >= this.stagedSellStage1Threshold && !this.stagedSellStage1Triggered) {
        const timeToTrigger = Date.now() - this.externalBuyStartTime;
        console.log(`[WebSocket Ultra-Fast] 🚨🚨🚨 STAGE 1 THRESHOLD REACHED${simTag}! ${this.externalBuyVolume.toFixed(4)} SOL NET`);
        console.log(`[WebSocket Ultra-Fast] ⚡⚡⚡ TRIGGERING STAGE 1 SELL${simTag} (${timeToTrigger}ms after first buy)...`);
        this.stagedSellStage1Triggered = true;
        if (!this.simulationMode) {
          this.triggerStagedSell('stage1').catch(err => {
            console.error(`[WebSocket Ultra-Fast] ❌ Error triggering stage 1 sell:`, err);
          });
        }
      }
      // Stage 2: 30% at 10 SOL
      else if (this.externalBuyVolume >= this.stagedSellStage2Threshold && !this.stagedSellStage2Triggered) {
        const timeToTrigger = Date.now() - this.externalBuyStartTime;
        console.log(`[WebSocket Ultra-Fast] 🚨🚨🚨 STAGE 2 THRESHOLD REACHED${simTag}! ${this.externalBuyVolume.toFixed(4)} SOL NET`);
        console.log(`[WebSocket Ultra-Fast] ⚡⚡⚡ TRIGGERING STAGE 2 SELL${simTag} (${timeToTrigger}ms after first buy)...`);
        this.stagedSellStage2Triggered = true;
        if (!this.simulationMode) {
          this.triggerStagedSell('stage2').catch(err => {
            console.error(`[WebSocket Ultra-Fast] ❌ Error triggering stage 2 sell:`, err);
          });
        }
      }
      // Stage 3: 40% + DEV at 20 SOL
      else if (this.externalBuyVolume >= this.stagedSellStage3Threshold && !this.stagedSellStage3Triggered) {
        const timeToTrigger = Date.now() - this.externalBuyStartTime;
        console.log(`[WebSocket Ultra-Fast] 🚨🚨🚨 STAGE 3 THRESHOLD REACHED${simTag}! ${this.externalBuyVolume.toFixed(4)} SOL NET`);
        console.log(`[WebSocket Ultra-Fast] ⚡⚡⚡ TRIGGERING STAGE 3 SELL${simTag} (${timeToTrigger}ms after first buy)...`);
        console.log(`[WebSocket Ultra-Fast] ⚡ DEV wallet will be sold LAST in this stage`);
        this.stagedSellStage3Triggered = true;
        if (!this.simulationMode) {
          this.triggerStagedSell('stage3').catch(err => {
            console.error(`[WebSocket Ultra-Fast] ❌ Error triggering stage 3 sell:`, err);
          });
        }
      } else {
        // Show progress for staged sell (NET volume)
        const nextThreshold = !this.stagedSellStage1Triggered ? this.stagedSellStage1Threshold :
                             !this.stagedSellStage2Triggered ? this.stagedSellStage2Threshold :
                             !this.stagedSellStage3Triggered ? this.stagedSellStage3Threshold : null;
        if (nextThreshold) {
          console.log(`[WebSocket Ultra-Fast] 💰 External ${volumeType}${simTag}: ${volumeSign}${Math.abs(solAmount).toFixed(4)} SOL | NET Total: ${this.externalBuyVolume.toFixed(4)}/${nextThreshold.toFixed(4)} SOL (staged sell)`);
        }
      }
    } else {
      // Standard threshold check (non-staged) - NET volume
      console.log(`[WebSocket Ultra-Fast] 💰 External ${volumeType}${simTag}: ${volumeSign}${Math.abs(solAmount).toFixed(4)} SOL | NET Total: ${this.externalBuyVolume.toFixed(4)}/${this.externalBuyThreshold.toFixed(4)} SOL`);
      
      if (this.externalBuyVolume >= this.externalBuyThreshold && !this.sellTriggered) {
        const timeToTrigger = Date.now() - this.externalBuyStartTime;
        console.log(`[WebSocket Ultra-Fast] 🚨🚨🚨 THRESHOLD REACHED${simTag}! ${this.externalBuyVolume.toFixed(4)} SOL NET in external volume`);
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
  }

  // TRIGGER STAGED SELL - Execute specific stage
  triggerStagedSell(stage) {
    console.log(`[WebSocket Ultra-Fast] 🚀🚀🚀 STAGED SELL ${stage.toUpperCase()} TRIGGERED! 🚀🚀🚀`);
    console.log('[WebSocket Ultra-Fast] ⚡⚡⚡ Executing IMMEDIATELY (0ms delay)...');
    
    const scriptDir = path.join(__dirname, '..');
    const mintAddress = this.currentMintAddress;
    
    // Pass mint address, stage, and HIGH priority fee
    const command = `cd "${scriptDir}" && npm run rapid-sell-staged "${mintAddress || ''}" ${stage} high`;
    
    const stageNames = {
      'stage1': 'Stage 1 (30% at 5 SOL)',
      'stage2': 'Stage 2 (30% at 10 SOL)',
      'stage3': 'Stage 3 (40% + DEV at 20 SOL)'
    };
    
    console.log(`[WebSocket Ultra-Fast] 📍 Selling mint: ${mintAddress}`);
    console.log(`[WebSocket Ultra-Fast] 📍 Stage: ${stageNames[stage] || stage}`);
    console.log(`[WebSocket Ultra-Fast] 📍 Priority: HIGH (threshold met - maximum speed!)`);
    
    // Execute IMMEDIATELY - non-blocking, fire and forget
    const childProcess = exec(command, { 
      maxBuffer: 10 * 1024 * 1024,
      cwd: scriptDir,
      env: { ...process.env },
      shell: true,
      detached: true
    });
    
    if (childProcess.unref) {
      childProcess.unref();
    }
    
    childProcess.stdout?.on('data', (data) => {
      process.stdout.write(`[WebSocket Ultra-Fast Staged Sell ${stage}] ${data}`);
    });
    
    childProcess.stderr?.on('data', (data) => {
      process.stderr.write(`[WebSocket Ultra-Fast Staged Sell Error] ${data}`);
    });
    
    childProcess.on('error', (error) => {
      console.error(`[WebSocket Ultra-Fast] ❌ Staged sell ${stage} execution error:`, error);
    });
    
    childProcess.on('exit', (code) => {
      if (code === 0) {
        console.log(`[WebSocket Ultra-Fast] ✅✅✅ STAGED SELL ${stage.toUpperCase()} COMPLETED SUCCESSFULLY!`);
      } else {
        console.error(`[WebSocket Ultra-Fast] ⚠️ Staged sell ${stage} exited with code ${code}`);
      }
    });
    
    console.log(`[WebSocket Ultra-Fast] ✅✅✅ STAGED SELL ${stage.toUpperCase()} PROCESS STARTED!`);
  }

  // TRIGGER INSTANT SELL - Use rapid-sell.ts script (same as standard tracker for reliability)
  // This ensures it reads current-run.json at execution time (when it's actually saved)
  triggerInstantSell() {
    console.log('[WebSocket Ultra-Fast] 🚀🚀🚀 INSTANT SELL TRIGGERED! 🚀🚀🚀');
    console.log('[WebSocket Ultra-Fast] ⚡⚡⚡ Executing IMMEDIATELY (0ms delay)...');
    
    const scriptDir = path.join(__dirname, '..');
    const mintAddress = this.currentMintAddress;
    
    // Determine which sell script to use based on autoSellType
    // 'rapid-sell' = sell all wallets (AUTO_RAPID_SELL)
    // 'rapid-sell-50-percent' = sell 50% of bundler wallets (AUTO_SELL_50_PERCENT)
    const sellType = this.autoSellType || 'rapid-sell'; // Default to rapid-sell
    
    // Pass mint address, 0ms wait, and HIGH priority fee (threshold was met - need speed!)
    const command = `cd "${scriptDir}" && npm run ${sellType} "${mintAddress || ''}" 0 high`;
    
    const sellTypeName = sellType === 'rapid-sell-50-percent' ? '50% of bundler wallets' : 'ALL wallets';
    console.log(`[WebSocket Ultra-Fast] 📍 Selling mint: ${mintAddress}`);
    console.log(`[WebSocket Ultra-Fast] 📍 Sell type: ${sellTypeName}`);
    console.log(`[WebSocket Ultra-Fast] 📍 Priority: HIGH (threshold met - maximum speed!)`);
    
    // Execute IMMEDIATELY - non-blocking, fire and forget (don't wait for completion)
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
      process.stdout.write(`[WebSocket Ultra-Fast Rapid Sell] ${data}`);
    });
    
    childProcess.stderr?.on('data', (data) => {
      process.stderr.write(`[WebSocket Ultra-Fast Rapid Sell Error] ${data}`);
    });
    
    childProcess.on('error', (error) => {
      console.error('[WebSocket Ultra-Fast] ❌ Auto-sell execution error:', error);
    });
    
    childProcess.on('exit', (code) => {
      if (code === 0) {
        console.log('[WebSocket Ultra-Fast] ✅✅✅ RAPID SELL COMPLETED SUCCESSFULLY!');
      } else {
        console.error(`[WebSocket Ultra-Fast] ⚠️ Rapid sell exited with code ${code}`);
      }
    });
    
    console.log('[WebSocket Ultra-Fast] ✅✅✅ INSTANT SELL PROCESS STARTED!');
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

