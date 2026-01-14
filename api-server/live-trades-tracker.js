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

// Extract Helius API key from RPC endpoint
function getHeliusApiKey(rpcEndpoint) {
  if (!rpcEndpoint) return null;
  const match = rpcEndpoint.match(/api-key=([^&]+)/);
  return match ? match[1] : null;
}

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
    this.testWallets = new Set(); // Track manually added test wallets (temporary)
    this.pollInterval = null; // Polling interval for live updates
    this.lastFetchedSlot = new Map(); // Cache last fetched slot per mint
    this.tradeCache = new Map(); // Cache trades per mint address
    this.currentMarketCap = null; // Current market cap from API
    this.PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
    this.autoStartInterval = null; // Interval for checking current-run.json
    this.lastCheckedMint = null; // Track last mint we started tracking
    
    // Config persistence paths
    this.configDir = path.join(__dirname, '..', 'keys');
    this.autoSellConfigPath = path.join(this.configDir, 'auto-sell-config.json');
    
    // Per-wallet auto-sell system
    this.autoSellConfig = new Map(); // Map wallet address -> { threshold: number, enabled: boolean, triggered: boolean }
    this.externalNetVolume = 0; // Cumulative NET external volume (buys - sells)
    this.autoSellEnabled = false; // Global toggle for auto-sell system
    this.autoSellListeners = []; // Listeners for auto-sell events
    
    // MEV Protection settings
    this.mevProtection = {
      enabled: true,
      confirmationDelaySec: 3,       // Wait X seconds after threshold reached, then re-check
      launchCooldownSec: 5,          // Don't auto-sell for X seconds after first external trade
      rapidTraderWindowSec: 10,      // If wallet buys AND sells within X seconds, ignore both
    };
    this.firstExternalTradeTime = null; // Track first external trade time
    this.externalTraderHistory = new Map(); // Map trader address -> [{type, solAmount, timestamp}, ...]
    this.pendingSellTriggers = new Map(); // Map wallet address -> timeout for delayed confirmation
    
    // Load saved settings on startup
    this.loadAutoSellConfig();
  }
  
  // Save auto-sell config to file
  saveAutoSellConfig() {
    try {
      const config = {
        autoSellEnabled: this.autoSellEnabled,
        mevProtection: this.mevProtection,
        walletConfigs: {},
        savedAt: new Date().toISOString(),
      };
      
      // Save wallet-specific thresholds (by wallet type, not address since addresses change per run)
      for (const [addr, settings] of this.autoSellConfig) {
        const walletType = this.walletTypes.get(addr) || this.walletTypes.get(addr.toLowerCase());
        if (walletType) {
          // Save by type for template configs (e.g., "DEV", "Bundle_0", "Holder_1")
          config.walletConfigs[walletType] = {
            threshold: settings.threshold,
            enabled: settings.enabled,
          };
        }
      }
      
      fs.writeFileSync(this.autoSellConfigPath, JSON.stringify(config, null, 2));
      console.log(`[AutoSell] 💾 Saved config: ${Object.keys(config.walletConfigs).length} wallet types`);
    } catch (err) {
      console.error('[AutoSell] Failed to save config:', err.message);
    }
  }
  
  // Load auto-sell config from file
  loadAutoSellConfig() {
    try {
      if (fs.existsSync(this.autoSellConfigPath)) {
        const data = JSON.parse(fs.readFileSync(this.autoSellConfigPath, 'utf8'));
        
        // Restore global settings
        if (typeof data.autoSellEnabled === 'boolean') {
          this.autoSellEnabled = data.autoSellEnabled;
        }
        
        // Restore MEV protection settings
        if (data.mevProtection) {
          this.mevProtection = { ...this.mevProtection, ...data.mevProtection };
        }
        
        // Store template configs for later when wallets are registered
        this.savedWalletConfigs = data.walletConfigs || {};
        
        console.log(`[AutoSell] 📂 Loaded config: enabled=${this.autoSellEnabled}, MEV delay=${this.mevProtection.confirmationDelaySec}s, ${Object.keys(this.savedWalletConfigs).length} wallet templates`);
      }
    } catch (err) {
      console.error('[AutoSell] Failed to load config:', err.message);
      this.savedWalletConfigs = {};
    }
  }
  
  // Apply saved config to a newly registered wallet
  applySavedConfigToWallet(walletAddress, walletType) {
    if (this.savedWalletConfigs && this.savedWalletConfigs[walletType]) {
      const saved = this.savedWalletConfigs[walletType];
      this.autoSellConfig.set(walletAddress.toLowerCase(), {
        threshold: saved.threshold || 0,
        enabled: saved.enabled !== false,
        triggered: false,
        triggeredAt: null,
        sellResult: null,
      });
      console.log(`[AutoSell] Applied saved config to ${walletType}: threshold=${saved.threshold} SOL`);
    }
  }
  
  // Configure auto-sell for a specific wallet
  configureAutoSell(walletAddress, threshold, enabled = true) {
    const addr = walletAddress.toLowerCase();
    const thresholdValue = parseFloat(threshold) || 0;
    this.autoSellConfig.set(addr, {
      threshold: thresholdValue,
      enabled: enabled,
      triggered: false,
      triggeredAt: null,
      sellResult: null,
    });
    console.log(`[AutoSell] Configured wallet ${walletAddress.slice(0, 8)}... threshold: ${threshold} SOL, enabled: ${enabled}`);
    
    // Auto-enable if threshold is set
    if (thresholdValue > 0 && !this.autoSellEnabled) {
      this.autoSellEnabled = true;
      console.log(`[AutoSell] ✅ AUTO-ENABLED (threshold configured)`);
    }
    
    // Save config to persist between sessions
    this.saveAutoSellConfig();
    
    return this.getAutoSellConfig();
  }
  
  // Get all auto-sell configurations
  getAutoSellConfig() {
    const config = {};
    for (const [addr, settings] of this.autoSellConfig) {
      config[addr] = { ...settings };
    }
    
    // Check if in cooldown
    let inCooldown = false;
    let cooldownRemaining = 0;
    if (this.mevProtection.enabled && this.firstExternalTradeTime) {
      const timeSinceFirst = (Date.now() - this.firstExternalTradeTime) / 1000;
      if (timeSinceFirst < this.mevProtection.launchCooldownSec) {
        inCooldown = true;
        cooldownRemaining = this.mevProtection.launchCooldownSec - timeSinceFirst;
      }
    }
    
    return {
      wallets: config,
      externalNetVolume: this.externalNetVolume,
      enabled: this.autoSellEnabled,
      mevProtection: this.mevProtection,
      inCooldown: inCooldown,
      cooldownRemaining: cooldownRemaining,
      pendingSells: Array.from(this.pendingSellTriggers.keys()),
    };
  }
  
  // Set auto-sell configs from an object (for bulk configuration)
  setAutoSellConfigs(configs) {
    this.autoSellConfig.clear();
    let hasThresholds = false;
    for (const [addr, settings] of Object.entries(configs)) {
      const threshold = parseFloat(settings.threshold) || 0;
      if (threshold > 0) hasThresholds = true;
      this.autoSellConfig.set(addr.toLowerCase(), {
        threshold: threshold,
        enabled: settings.enabled !== false,
        triggered: false,
        triggeredAt: null,
        sellResult: null,
      });
    }
    console.log(`[AutoSell] Configured ${this.autoSellConfig.size} wallets for auto-sell`);
    
    // Auto-enable if any thresholds are set
    if (hasThresholds && !this.autoSellEnabled) {
      this.autoSellEnabled = true;
      console.log(`[AutoSell] ✅ AUTO-ENABLED (thresholds configured)`);
    }
    
    // Save config to persist between sessions
    this.saveAutoSellConfig();
    
    return this.getAutoSellConfig();
  }
  
  // Enable/disable global auto-sell
  setAutoSellEnabled(enabled) {
    this.autoSellEnabled = enabled;
    console.log(`[AutoSell] ${enabled ? '✅ ENABLED' : '❌ DISABLED'}`);
    
    // Save config to persist between sessions
    this.saveAutoSellConfig();
    
    return this.getAutoSellConfig();
  }
  
  // Reset auto-sell state (for new token runs)
  resetAutoSell() {
    this.externalNetVolume = 0;
    for (const [addr, settings] of this.autoSellConfig) {
      settings.triggered = false;
      settings.triggeredAt = null;
      settings.sellResult = null;
    }
    
    // Clear MEV protection state
    this.firstExternalTradeTime = null;
    this.externalTraderHistory.clear();
    
    // Clear any pending sell triggers
    for (const timeout of this.pendingSellTriggers.values()) {
      clearTimeout(timeout);
    }
    this.pendingSellTriggers.clear();
    
    console.log('[AutoSell] Reset all auto-sell states (including MEV protection)');
    return this.getAutoSellConfig();
  }
  
  // Configure MEV protection settings
  setMevProtection(settings) {
    this.mevProtection = {
      ...this.mevProtection,
      ...settings,
    };
    console.log('[AutoSell] MEV protection updated:', this.mevProtection);
    
    // Save config to persist between sessions
    this.saveAutoSellConfig();
    
    return this.mevProtection;
  }
  
  // Get MEV protection settings
  getMevProtection() {
    return { ...this.mevProtection };
  }
  
  // Track external volume and check thresholds (with MEV protection)
  trackExternalVolume(trade) {
    // Only track non-wallet trades
    // BUT: FUNDING wallet trades count as EXTERNAL for testing auto-sell
    // (User can buy with funding wallet to test auto-sell triggers)
    const isFundingWallet = trade.walletType === 'FUNDING';
    if (trade.isOurWallet && !isFundingWallet) return;
    
    const now = Date.now();
    const traderAddr = trade.fullTrader?.toLowerCase();
    
    // Track first external trade time (for launch cooldown)
    if (!this.firstExternalTradeTime) {
      this.firstExternalTradeTime = now;
      console.log(`[AutoSell] 📍 First external trade detected, cooldown starts...`);
    }
    
    // MEV Protection: Track trader history for rapid buy/sell detection
    if (this.mevProtection.enabled && traderAddr) {
      if (!this.externalTraderHistory.has(traderAddr)) {
        this.externalTraderHistory.set(traderAddr, []);
      }
      const history = this.externalTraderHistory.get(traderAddr);
      history.push({ type: trade.type, solAmount: trade.solAmount, timestamp: now });
      
      // Keep only recent history (last 60 seconds)
      const cutoff = now - 60000;
      while (history.length > 0 && history[0].timestamp < cutoff) {
        history.shift();
      }
      
      // Check for rapid buy/sell pattern (MEV bot signature)
      const windowMs = this.mevProtection.rapidTraderWindowSec * 1000;
      const recentTrades = history.filter(h => h.timestamp > now - windowMs);
      const hasBuy = recentTrades.some(t => t.type === 'buy');
      const hasSell = recentTrades.some(t => t.type === 'sell');
      
      if (hasBuy && hasSell) {
        // This trader bought AND sold within the window - likely MEV bot
        // Net out their trades instead of counting them
        const netVolume = recentTrades.reduce((sum, t) => 
          sum + (t.type === 'buy' ? t.solAmount : -t.solAmount), 0);
        
        // Only log if significant
        if (Math.abs(netVolume) > 0.01) {
          console.log(`[AutoSell] ⚠️ MEV detected: ${traderAddr.slice(0, 8)}... rapid buy+sell, net: ${netVolume.toFixed(4)} SOL`);
        }
        
        // Recalculate external volume from net position instead of counting this trade
        // Skip this trade's direct effect on volume since we're netting
        // (The volume was already added/subtracted, so we let it stand but don't trigger)
      }
    }
    
    // Calculate net volume change (buys add, sells subtract)
    const volumeChange = trade.type === 'buy' ? trade.solAmount : -trade.solAmount;
    this.externalNetVolume += volumeChange;
    
    // Don't trigger if disabled or no mint address
    if (!this.autoSellEnabled || !this.currentMintAddress) return;
    
    // MEV Protection: Launch cooldown check
    if (this.mevProtection.enabled) {
      const timeSinceFirst = (now - this.firstExternalTradeTime) / 1000;
      if (timeSinceFirst < this.mevProtection.launchCooldownSec) {
        console.log(`[AutoSell] ⏳ In launch cooldown (${timeSinceFirst.toFixed(1)}s / ${this.mevProtection.launchCooldownSec}s)`);
        // Still notify listeners but don't trigger
        this.notifyAutoSellListeners({
          type: 'volumeUpdate',
          externalNetVolume: this.externalNetVolume,
          trade: trade,
          inCooldown: true,
          cooldownRemaining: this.mevProtection.launchCooldownSec - timeSinceFirst,
        });
        return;
      }
    }
    
    // Check each wallet's threshold
    for (const [walletAddr, config] of this.autoSellConfig) {
      if (!config.enabled || config.triggered) continue;
      if (this.pendingSellTriggers.has(walletAddr)) continue; // Already pending confirmation
      
      // Check if threshold is met
      if (this.externalNetVolume >= config.threshold && config.threshold > 0) {
        console.log(`[AutoSell] 🎯 Threshold REACHED for ${walletAddr.slice(0, 8)}... | ${this.externalNetVolume.toFixed(4)} SOL >= ${config.threshold} SOL`);
        
        // MEV Protection: Confirmation delay
        if (this.mevProtection.enabled && this.mevProtection.confirmationDelaySec > 0) {
          const delayMs = this.mevProtection.confirmationDelaySec * 1000;
          console.log(`[AutoSell] ⏱️ Waiting ${this.mevProtection.confirmationDelaySec}s for confirmation...`);
          
          // Store the volume at trigger time
          const triggerVolume = this.externalNetVolume;
          
          const timeout = setTimeout(() => {
            this.pendingSellTriggers.delete(walletAddr);
            
            // Re-check if volume is still above threshold
            if (this.externalNetVolume >= config.threshold) {
              console.log(`[AutoSell] ✅ Confirmed! Volume still ${this.externalNetVolume.toFixed(4)} >= ${config.threshold} SOL after ${this.mevProtection.confirmationDelaySec}s`);
              this.triggerAutoSell(walletAddr, config);
            } else {
              console.log(`[AutoSell] ❌ Cancelled! Volume dropped to ${this.externalNetVolume.toFixed(4)} < ${config.threshold} SOL (MEV likely dumped)`);
              this.notifyAutoSellListeners({
                type: 'sellCancelled',
                walletAddress: walletAddr,
                reason: 'Volume dropped below threshold after MEV protection delay',
                triggerVolume: triggerVolume,
                currentVolume: this.externalNetVolume,
              });
            }
          }, delayMs);
          
          this.pendingSellTriggers.set(walletAddr, timeout);
        } else {
          // No delay, trigger immediately
          this.triggerAutoSell(walletAddr, config);
        }
      }
    }
    
    // Notify listeners of volume update
    this.notifyAutoSellListeners({
      type: 'volumeUpdate',
      externalNetVolume: this.externalNetVolume,
      trade: trade,
    });
  }
  
  // Trigger auto-sell for a wallet
  async triggerAutoSell(walletAddress, config) {
    config.triggered = true;
    config.triggeredAt = Date.now();
    
    console.log(`[AutoSell] 🚀 TRIGGERING SELL for ${walletAddress.slice(0, 8)}...`);
    
    // Notify listeners that sell is being triggered
    this.notifyAutoSellListeners({
      type: 'sellTriggered',
      walletAddress: walletAddress,
      threshold: config.threshold,
      externalNetVolume: this.externalNetVolume,
    });
    
    // Execute the sell (will be handled by control-panel-server)
    try {
      const sellResult = await this.executeAutoSell(walletAddress);
      config.sellResult = sellResult;
      
      this.notifyAutoSellListeners({
        type: 'sellComplete',
        walletAddress: walletAddress,
        result: sellResult,
      });
    } catch (error) {
      console.error(`[AutoSell] ❌ Sell failed for ${walletAddress.slice(0, 8)}...:`, error.message);
      config.sellResult = { error: error.message };
      
      this.notifyAutoSellListeners({
        type: 'sellFailed',
        walletAddress: walletAddress,
        error: error.message,
      });
    }
  }
  
  // Execute auto-sell (to be called by control-panel-server via callback)
  async executeAutoSell(walletAddress) {
    // This will be overridden by control-panel-server to actually execute the sell
    console.log(`[AutoSell] ⚡ Execute sell for ${walletAddress.slice(0, 8)}... (handler not set)`);
    return { success: false, error: 'Sell handler not configured' };
  }
  
  // Set the sell execution callback
  setAutoSellExecutor(callback) {
    this.executeAutoSell = callback;
    console.log('[AutoSell] ✅ Sell executor configured');
  }
  
  // Add listener for auto-sell events
  addAutoSellListener(callback) {
    this.autoSellListeners.push(callback);
    return () => {
      this.autoSellListeners = this.autoSellListeners.filter(cb => cb !== callback);
    };
  }
  
  // Notify all auto-sell listeners
  notifyAutoSellListeners(event) {
    for (const listener of this.autoSellListeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('[AutoSell] Listener error:', e.message);
      }
    }
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
      // WebSocket URL configured (using QuickNode for live trades, Helius only for historical)
    // console.log(`[LiveTrades] ✅ WebSocket URL configured: ${this.wsUrl.replace(/api-key=[^&]+/, 'api-key=***')}`);
    } else {
      console.warn('[LiveTrades] ⚠️ RPC_WEBSOCKET_ENDPOINT not found');
    }

    // Load our wallet addresses from current-run.json
    this.loadOurWallets();
    
    // Auto-start tracking when token is launched (monitor current-run.json)
    this.startAutoTracking();
  }
  
  // Auto-start tracking when current-run.json is created/updated with mint address
  startAutoTracking() {
    // Check every 2 seconds for new token launches
    this.autoStartInterval = setInterval(async () => {
      try {
        const currentRunPath = path.join(__dirname, '..', 'keys', 'current-run.json');
        if (!fs.existsSync(currentRunPath)) {
          return; // No current-run.json yet
        }
        
        const data = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
        const mintAddress = data.mintAddress;
        
        // If we have a mint address and we're not already tracking it, start tracking
        if (mintAddress && mintAddress !== this.lastCheckedMint) {
          // Check if mint address is valid (not empty, proper length)
          if (mintAddress.length > 20 && mintAddress !== this.currentMintAddress) {
            // Auto-start tracking for newly launched token (QuickNode webhook handles live trades)
            // console.log(`[LiveTrades] 🚀 Auto-starting tracking for newly launched token: ${mintAddress.slice(0, 8)}...`);
            this.lastCheckedMint = mintAddress;
            // Start tracking (for historical data only - QuickNode handles live trades)
            await this.startTracking(mintAddress);
            // console.log(`[LiveTrades] ✅ Auto-tracking started! QuickNode webhook will catch all trades.`);
          }
        }
      } catch (error) {
        // Silently fail - current-run.json might not be ready yet
      }
    }, 2000); // Check every 2 seconds
  }
  
  // Stop auto-tracking (cleanup)
  stopAutoTracking() {
    if (this.autoStartInterval) {
      clearInterval(this.autoStartInterval);
      this.autoStartInterval = null;
    }
  }

  // Load our wallet addresses with types
  loadOurWallets() {
    this.ourWallets.clear(); // Clear existing wallets
    this.walletTypes.clear(); // Clear wallet types
    
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
        
        // Apply saved auto-sell config for this wallet type
        this.applySavedConfigToWallet(addrLower, type);
      }
    };
    
    try {
      const currentRunPath = path.join(__dirname, '..', 'keys', 'current-run.json');
      if (fs.existsSync(currentRunPath)) {
        const data = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
        
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
        
        // Load auto-buy results (for tracking actual buy prices)
        // This is used by auto-sell to know the price each wallet bought at
        if (data.autoBuyResults && data.autoBuyResults.successfulBuys) {
          console.log(`[LiveTrades] 📊 Loading auto-buy results for ${data.autoBuyResults.successfulBuys.length} wallet(s)...`);
          
          for (const buyResult of data.autoBuyResults.successfulBuys) {
            const addr = buyResult.address?.toLowerCase();
            if (addr) {
              // Store buy info in autoSellConfig
              const existingConfig = this.autoSellConfig.get(addr) || {};
              this.autoSellConfig.set(addr, {
                ...existingConfig,
                buyAmount: buyResult.buyAmount, // SOL spent to buy
                buySignature: buyResult.signature,
                buyTimestamp: buyResult.timestamp,
                actualBuyPrice: buyResult.buyAmount // For auto-sell reference
              });
              console.log(`[LiveTrades]   💰 Wallet ${addr.slice(0, 8)}... bought for ${buyResult.buyAmount} SOL`);
            }
          }
          
          // Store skipped wallets info (front-run protection triggered)
          if (data.autoBuyResults.skippedWallets && data.autoBuyResults.skippedWallets.length > 0) {
            console.log(`[LiveTrades]   ⚠️  ${data.autoBuyResults.skippedWallets.length} wallet(s) skipped due to front-run protection (threshold: ${data.autoBuyResults.frontRunThreshold} SOL)`);
          }
        }
      }
      
      // Also load from warmed-wallets-for-launch.json (for warmed wallet runs)
      const warmedWalletsPath = path.join(__dirname, '..', 'keys', 'warmed-wallets-for-launch.json');
      if (fs.existsSync(warmedWalletsPath)) {
        try {
          const warmedData = JSON.parse(fs.readFileSync(warmedWalletsPath, 'utf8'));
          console.log(`[LiveTrades] 📂 Found warmed-wallets-for-launch.json, loading wallets...`);
          
          // Add creator/DEV wallet
          if (warmedData.creatorWalletKey) {
            const devAddr = deriveAddress(warmedData.creatorWalletKey);
            if (devAddr && !this.ourWallets.has(devAddr.toLowerCase())) {
              addWallet(devAddr, 'DEV');
            }
          }
          if (warmedData.creatorWalletAddress) {
            addWallet(warmedData.creatorWalletAddress, 'DEV');
          }
          
          // Add bundle wallets
          if (warmedData.bundleWalletKeys && Array.isArray(warmedData.bundleWalletKeys)) {
            warmedData.bundleWalletKeys.forEach(key => {
              const addr = deriveAddress(key);
              if (addr && !this.ourWallets.has(addr.toLowerCase())) {
                addWallet(addr, 'Bundle');
              }
            });
          }
          if (warmedData.bundleWalletAddresses && Array.isArray(warmedData.bundleWalletAddresses)) {
            warmedData.bundleWalletAddresses.forEach(addr => {
              if (!this.ourWallets.has(addr.toLowerCase())) {
                addWallet(addr, 'Bundle');
              }
            });
          }
          
          // Add holder wallets
          if (warmedData.holderWalletKeys && Array.isArray(warmedData.holderWalletKeys)) {
            warmedData.holderWalletKeys.forEach(key => {
              const addr = deriveAddress(key);
              if (addr && !this.ourWallets.has(addr.toLowerCase())) {
                addWallet(addr, 'Holder');
              }
            });
          }
          if (warmedData.holderWalletAddresses && Array.isArray(warmedData.holderWalletAddresses)) {
            warmedData.holderWalletAddresses.forEach(addr => {
              if (!this.ourWallets.has(addr.toLowerCase())) {
                addWallet(addr, 'Holder');
              }
            });
          }
          
          console.log(`[LiveTrades] ✅ Loaded warmed wallets for tracking`);
        } catch (error) {
          console.error('[LiveTrades] ⚠️ Error loading warmed wallets:', error.message);
        }
      }
      
      // ALWAYS add funding wallet (PRIVATE_KEY from .env) - this is the main funding wallet
      try {
        const rootEnvPath = path.join(__dirname, '..', '.env');
        if (fs.existsSync(rootEnvPath)) {
          require('dotenv').config({ path: rootEnvPath });
        } else {
          require('dotenv').config();
        }
        
        const PRIVATE_KEY = process.env.PRIVATE_KEY;
        if (PRIVATE_KEY && PRIVATE_KEY.trim() !== '') {
          const fundingAddr = deriveAddress(PRIVATE_KEY.trim());
          if (fundingAddr) {
            addWallet(fundingAddr, 'FUNDING');
            console.log(`[LiveTrades] ✅ Added funding wallet: ${fundingAddr.slice(0, 8)}...`);
          }
        }
      } catch (error) {
        console.warn('[LiveTrades] ⚠️ Could not load funding wallet from PRIVATE_KEY:', error.message);
      }
      
      // Debug: Log all wallet addresses with types
      const fundingCount = Array.from(this.walletTypes.values()).filter(t => t === 'FUNDING').length;
      const devCount = Array.from(this.walletTypes.values()).filter(t => t === 'DEV').length;
      const bundleCount = Array.from(this.walletTypes.values()).filter(t => t === 'Bundle').length;
      const holderCount = Array.from(this.walletTypes.values()).filter(t => t === 'Holder').length;
      
      console.log(`[LiveTrades] ✅ Loaded ${this.ourWallets.size} our wallet addresses:`);
      if (fundingCount > 0) console.log(`[LiveTrades]   - FUNDING: ${fundingCount}`);
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
    } catch (error) {
      console.error('[LiveTrades] ❌ Error loading our wallets:', error);
    }
  }

  // Add test wallets manually (for testing - temporary, not saved)
  addTestWallets(walletAddresses) {
    if (!Array.isArray(walletAddresses)) {
      walletAddresses = [walletAddresses];
    }
    
    let addedCount = 0;
    walletAddresses.forEach(addr => {
      if (addr && typeof addr === 'string') {
        const addrLower = addr.toLowerCase().trim();
        if (addrLower.length > 0) {
          this.ourWallets.add(addrLower);
          this.testWallets.add(addrLower);
          this.walletTypes.set(addrLower, 'TEST'); // Mark as TEST type
          addedCount++;
        }
      }
    });
    
    console.log(`[LiveTrades] ✅ Added ${addedCount} test wallet(s) for testing`);
    if (addedCount > 0) {
      console.log(`[LiveTrades] 📝 Test wallets (${this.testWallets.size} total):`);
      Array.from(this.testWallets).slice(0, 5).forEach(addr => {
        console.log(`[LiveTrades]   TEST: ${addr.slice(0, 8)}...`);
      });
    }
    
    return addedCount;
  }

  // Remove test wallets (clear all test wallets)
  clearTestWallets() {
    const count = this.testWallets.size;
    this.testWallets.forEach(addr => {
      this.ourWallets.delete(addr);
      this.walletTypes.delete(addr);
    });
    this.testWallets.clear();
    console.log(`[LiveTrades] 🗑️ Cleared ${count} test wallet(s)`);
    return count;
  }

  // Get list of test wallets
  getTestWallets() {
    return Array.from(this.testWallets);
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

  // Cache SOL price (refresh every 60 seconds)
  solPriceCache = { price: 0, lastFetch: 0 };
  
  // Fetch current SOL price from CoinGecko
  async getSolPrice() {
    const now = Date.now();
    // Use cache if less than 60 seconds old
    if (this.solPriceCache.price > 0 && (now - this.solPriceCache.lastFetch) < 60000) {
      return this.solPriceCache.price;
    }
    
    try {
      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      const price = response.data?.solana?.usd || 0;
      if (price > 0) {
        this.solPriceCache = { price, lastFetch: now };
        // Only log price updates every 5 minutes to reduce spam
        if (!this._lastPriceLog || Date.now() - this._lastPriceLog > 300000) {
          console.log(`[LiveTrades] 💰 SOL price: $${price.toFixed(2)}`);
          this._lastPriceLog = Date.now();
        }
      }
      return price || 200; // Fallback to $200
    } catch (error) {
      // Rate-limit warning to once per minute
      if (!this._lastPriceWarn || Date.now() - this._lastPriceWarn > 60000) {
        console.error('[LiveTrades] ⚠️ Failed to fetch SOL price:', error.message);
        this._lastPriceWarn = Date.now();
      }
      return this.solPriceCache.price || 200; // Use cached or fallback
    }
  }
  
  // Get current market cap by reading bonding curve account
  async getCurrentMarketCap(mintAddress) {
    try {
      if (!this.connection || !this.currentBondingCurveAddress) {
        return null;
      }
      
      const bondingCurvePubkey = new PublicKey(this.currentBondingCurveAddress);
      const accountInfo = await this.connection.getAccountInfo(bondingCurvePubkey);
      
      if (!accountInfo || !accountInfo.data) {
        console.log('[LiveTrades] ⚠️ Could not fetch bonding curve account');
        return null;
      }
      
      // Parse bonding curve data
      // Pump.fun bonding curve layout:
      // 8 bytes: discriminator
      // 8 bytes: virtualTokenReserves (u64)
      // 8 bytes: virtualSolReserves (u64)
      // 8 bytes: realTokenReserves (u64)
      // 8 bytes: realSolReserves (u64)
      // 8 bytes: tokenTotalSupply (u64)
      // 1 byte: complete (bool)
      
      const data = accountInfo.data;
      if (data.length < 49) {
        console.log('[LiveTrades] ⚠️ Bonding curve data too short');
        return null;
      }
      
      // Read u64 values (little endian)
      const virtualTokenReserves = Number(data.readBigUInt64LE(8));
      const virtualSolReserves = Number(data.readBigUInt64LE(16));
      
      // Calculate price using virtual reserves (pump.fun formula)
      // virtualSolReserves is in lamports (9 decimals)
      // virtualTokenReserves is raw (6 decimals)
      const virtualSolInSOL = virtualSolReserves / 1e9;
      const virtualTokens = virtualTokenReserves / 1e6;
      
      // Price per token in SOL
      const pricePerTokenSOL = virtualSolInSOL / virtualTokens;
      
      // Market cap = price * 1B total supply
      const totalSupply = 1_000_000_000;
      const marketCapSOL = pricePerTokenSOL * totalSupply;
      
      // Get real SOL price from CoinGecko
      const solPrice = await this.getSolPrice();
      const marketCapUSD = marketCapSOL * solPrice;
      
      console.log(`[LiveTrades] 📊 Market Cap: ${marketCapSOL.toFixed(2)} SOL × $${solPrice.toFixed(0)} = $${marketCapUSD.toFixed(0)}`);
      
      return marketCapUSD;
    } catch (error) {
      console.error('[LiveTrades] ❌ Error fetching market cap:', error.message);
      return null;
    }
  }
  
  // Refresh market cap periodically
  async refreshMarketCap() {
    if (!this.currentMintAddress) return;
    
    const marketCap = await this.getCurrentMarketCap(this.currentMintAddress);
    if (marketCap && marketCap > 0) {
      this.currentMarketCap = marketCap;
    }
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
    
    // Check cache first - but only use if it has trades
    if (this.tradeCache.has(mintAddress) && this.currentMintAddress === mintAddress) {
      const cachedTrades = this.tradeCache.get(mintAddress);
      // Only use cache if it has trades (don't cache empty results)
      if (cachedTrades && cachedTrades.length > 0) {
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
      } else {
        console.log(`[LiveTrades] Cache exists but is empty, refetching...`);
        // Clear empty cache and continue to fetch
        this.tradeCache.delete(mintAddress);
      }
    }
    
    this.currentMintAddress = mintAddress;
    this.currentBondingCurveAddress = bondingCurveAddress;
    this.trades = [];
    this.processedSignatures.clear();
    this.loadOurWallets(); // Reload wallets in case they changed
    
    // Skip historical fetch - Helius tier limits make it unreliable
    // Live trades will be caught by WebSocket subscription to bonding curve
    console.log(`[LiveTrades] ⏭️ Skipping historical fetch - using Helius WebSocket for live trades`);
    
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
      console.log(`[LiveTrades] 📍 Mint: ${mintAddress.slice(0, 8)}...`);
      console.log(`[LiveTrades] 📍 Bonding Curve: ${bondingCurveAddress}`);
      
      // Step 1: Get signatures - try BOTH bonding curve AND mint address
      // Bonding curve has pool transactions, mint address has token transfers
      // We need both to catch all swaps
      const bondingCurvePubkey = new PublicKey(bondingCurveAddress);
      const mintPubkey = new PublicKey(mintAddress);
      let allSignatures = new Set(); // Use Set to avoid duplicates
      let before = null;
      const targetSignatures = 1000; // Increased from 650 to ensure we get 100+ trades
      
      // Method 1: Fetch from bonding curve (pool transactions)
      try {
        console.log(`[LiveTrades] 🔍 Fetching signatures from bonding curve...`);
        let pageCount = 0;
        before = null;
        while (allSignatures.size < targetSignatures) {
          const signatures = await this.connection.getSignaturesForAddress(
            bondingCurvePubkey,
            {
              limit: 100,
              before: before
            },
            'confirmed'
          );
          
          if (signatures.length === 0) {
            console.log(`[LiveTrades] No more signatures from bonding curve (page ${pageCount + 1})`);
            break;
          }
          
          pageCount++;
          signatures.forEach(s => allSignatures.add(s.signature));
          before = signatures[signatures.length - 1].signature;
          
          console.log(`[LiveTrades] Bonding curve page ${pageCount}: Found ${signatures.length} signatures (total unique: ${allSignatures.size})`);
          
          if (signatures.length < 100) break; // No more pages
          
          // Small delay between pages to avoid rate limits
          if (allSignatures.size < targetSignatures) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      } catch (error) {
        console.error(`[LiveTrades] ❌ Error fetching signatures from bonding curve: ${error.message}`);
      }
      
      // Method 2: Also fetch from mint address (token transfers/transactions)
      try {
        console.log(`[LiveTrades] 🔍 Also fetching signatures from mint address...`);
        let pageCount = 0;
        before = null;
        const initialSize = allSignatures.size;
        while (allSignatures.size < targetSignatures) {
          const signatures = await this.connection.getSignaturesForAddress(
            mintPubkey,
            {
              limit: 100,
              before: before
            },
            'confirmed'
          );
          
          if (signatures.length === 0) {
            console.log(`[LiveTrades] No more signatures from mint (page ${pageCount + 1})`);
            break;
          }
          
          pageCount++;
          signatures.forEach(s => allSignatures.add(s.signature));
          before = signatures[signatures.length - 1].signature;
          
          console.log(`[LiveTrades] Mint page ${pageCount}: Found ${signatures.length} signatures (total unique: ${allSignatures.size})`);
          
          if (signatures.length < 100) break; // No more pages
          
          // Small delay between pages
          if (allSignatures.size < targetSignatures) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        console.log(`[LiveTrades] ✅ Added ${allSignatures.size - initialSize} new signatures from mint address`);
      } catch (error) {
        console.error(`[LiveTrades] ❌ Error fetching signatures from mint: ${error.message}`);
      }
      
      // Convert Set to Array
      allSignatures = Array.from(allSignatures);
      console.log(`[LiveTrades] ✅ Found ${allSignatures.length} total unique signatures`);
      
      // Step 2: Fetch full transactions using Helius RPC (faster & more reliable)
      const heliusApiKey = getHeliusApiKey(this.rpcEndpoint);
      const useHeliusEnhanced = heliusApiKey && this.rpcEndpoint.includes('helius-rpc.com');
      
      const batchSize = 50; // Conservative batch size
      const transactions = [];
      
      console.log(`[LiveTrades] ${useHeliusEnhanced ? '🚀 Using Helius RPC' : '📡 Using standard RPC'} for transaction fetching`);
      
      for (let i = 0; i < allSignatures.length; i += batchSize) {
        const batch = allSignatures.slice(i, i + batchSize);
        
        // Use Helius's recommended approach: getTransaction with jsonParsed encoding
        // Following Helius Developer tier documentation exactly
        const txs = await Promise.all(
          batch.map(async (sig, idx) => {
            try {
              // Try multiple methods to fetch transaction (some may work better for different transaction ages)
              let tx = null;
              
              // Method 1: Try with jsonParsed encoding and maxSupportedTransactionVersion
              try {
                tx = await this.connection.getTransaction(sig, {
                  encoding: 'jsonParsed',
                  maxSupportedTransactionVersion: 0,
                  commitment: 'confirmed'
                });
              } catch (error1) {
                // Method 2: Try without maxSupportedTransactionVersion (for older transactions)
                try {
                  tx = await this.connection.getTransaction(sig, {
                    encoding: 'jsonParsed',
                    commitment: 'confirmed'
                  });
                } catch (error2) {
                  // Method 3: Try with finalized commitment (might have older data)
                  try {
                    tx = await this.connection.getTransaction(sig, {
                      encoding: 'jsonParsed',
                      commitment: 'finalized'
                    });
                  } catch (error3) {
                    // All methods failed - transaction likely too old or invalid
                    if (idx < 3) {
                      console.log(`[LiveTrades] ⚠️ Transaction ${sig.slice(0, 8)}... not available (likely too old)`);
                    }
                    return null;
                  }
                }
              }
              
              // Validate and normalize transaction structure before returning
              if (tx && tx.transaction && tx.transaction.message) {
                // Normalize accountKeys if needed (handle both string and object formats)
                // Some RPCs return accountKeys as objects with pubkey property, others as strings
                if (tx.transaction.message.accountKeys && Array.isArray(tx.transaction.message.accountKeys)) {
                  tx.transaction.message.accountKeys = tx.transaction.message.accountKeys.map(key => {
                    if (typeof key === 'string') return key;
                    if (key && typeof key === 'object') {
                      // Handle { pubkey: string } format
                      if (key.pubkey) return typeof key.pubkey === 'string' ? key.pubkey : key.pubkey.toString();
                      // Handle other object formats
                      return key.toString();
                    }
                    return key;
                  });
                }
                
                // Ensure innerInstructions structure is valid (some may be undefined)
                if (tx.meta && tx.meta.innerInstructions) {
                  tx.meta.innerInstructions = tx.meta.innerInstructions.filter(inner => 
                    inner && inner.instructions && Array.isArray(inner.instructions)
                  );
                }
                
                return tx;
              }
              
              if (!tx && idx < 3) {
                // Log first few failures - these are likely old transactions not in cache
                console.log(`[LiveTrades] ⚠️ Transaction ${sig.slice(0, 8)}... not available (likely too old)`);
              }
              return null;
            } catch (error) {
              if (idx < 3) {
                // Log first few errors for debugging (but don't spam)
                const errorMsg = error.message || String(error);
                // Only log if it's not a validation/structure error (those are expected for old txs)
                if (!errorMsg.includes('Expected a') && !errorMsg.includes('path:')) {
                  console.error(`[LiveTrades] ❌ Error fetching ${sig.slice(0, 8)}...: ${errorMsg}`);
                }
              }
              return null;
            }
          })
        );
        const validTxs = txs.filter(tx => tx !== null);
        transactions.push(...validTxs);
        if (validTxs.length < batch.length && i === 0) {
          // Log if first batch has failures
          console.log(`[LiveTrades] ⚠️ First batch: ${validTxs.length}/${batch.length} transactions fetched successfully`);
          if (validTxs.length === 0) {
            console.log(`[LiveTrades] 💡 All transactions returned null - this might indicate:`);
            console.log(`[LiveTrades]   1. Transactions are too old (not in recent block history)`);
            console.log(`[LiveTrades]   2. RPC endpoint doesn't have full transaction history`);
            console.log(`[LiveTrades]   3. Signatures might be invalid`);
          }
        }
        
        if (false) { // Removed else block - using same method for all
          // Standard RPC method
          const txs = await Promise.all(
            batch.map(sig => 
              this.connection.getTransaction(sig, {
                encoding: 'jsonParsed',
                maxSupportedTransactionVersion: 0,
                commitment: 'confirmed'
              }).catch(() => null)
            )
          );
          transactions.push(...txs.filter(tx => tx !== null));
        }
        
        // Progress logging
        if ((i + batchSize) % 200 === 0 || i + batchSize >= allSignatures.length) {
          console.log(`[LiveTrades] 📥 Fetched ${Math.min(i + batchSize, allSignatures.length)}/${allSignatures.length} transactions...`);
        }
        
        // Small delay to avoid rate limits (less needed with Helius)
        if (i + batchSize < allSignatures.length) {
          await new Promise(resolve => setTimeout(resolve, useHeliusEnhanced ? 50 : 100));
        }
      }
      
      console.log(`[LiveTrades] ✅ Fetched ${transactions.length} full transactions from ${allSignatures.length} signatures`);
      
      // If we got 0 transactions but have signatures, try using Helius's parseTransaction API
      // This might work better for historical transactions
      if (transactions.length === 0 && allSignatures.length > 0 && heliusApiKey) {
        console.log(`[LiveTrades] ⚠️ Got 0 transactions via RPC - trying Helius parseTransaction API...`);
        
        // Try Helius's parseTransaction API for a few signatures
        const testBatch = allSignatures.slice(0, Math.min(10, allSignatures.length));
        for (const sig of testBatch) {
          try {
            const response = await axios.get(
              `https://api.helius.xyz/v0/transactions/${sig}?api-key=${heliusApiKey}`,
              { timeout: 5000 }
            );
            if (response.data && response.data.transaction) {
              // Helius returns different format - we'd need to convert
              // For now, just log that we found it
              console.log(`[LiveTrades] ✅ Found transaction via Helius API: ${sig.slice(0, 8)}...`);
              // Note: Helius Enhanced API format is different, would need conversion
              // For now, continue with RPC method
            }
          } catch (error) {
            // Continue
          }
        }
        
        console.log(`[LiveTrades] 💡 Note: Helius Developer tier may have limited historical access`);
        // QuickNode webhook will catch new trades in real-time going forward
        // console.log(`[LiveTrades] 💡 WebSocket will catch new trades in real-time going forward`);
      }
      
      // Step 3: Parse and filter for swaps
      const historicalTrades = [];
      let parsedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;
      
      for (const tx of transactions) {
        // Extra safety checks for transaction structure
        if (!tx || !tx.meta || !tx.transaction) continue;
        if (!tx.transaction.message) continue; // Skip malformed transactions
        
        const signature = tx.transaction.signatures?.[0];
        if (!signature || this.processedSignatures.has(signature)) continue;
        
        const blockTime = tx.blockTime || null;
        
        // Wrap in try-catch to handle parsing errors gracefully
        try {
          const tradeResult = this.parseTransaction(tx, signature, blockTime);
          
          if (tradeResult) {
            const tradesToAdd = Array.isArray(tradeResult) ? tradeResult : [tradeResult];
            let addedCount = 0;
            for (const trade of tradesToAdd) {
              if (trade && trade.timestamp) {
                historicalTrades.push(trade);
                this.processedSignatures.add(signature);
                addedCount++;
              }
            }
            if (addedCount > 0) {
              parsedCount++;
            } else {
              skippedCount++;
            }
          } else {
            skippedCount++;
          }
        } catch (parseError) {
          // Skip transactions that can't be parsed (don't crash entire fetch)
          errorCount++;
          if (errorCount <= 5) { // Only log first 5 errors to avoid spam
            console.error(`[LiveTrades] Skipping transaction ${signature.slice(0, 8)}...: ${parseError.message}`);
          }
          continue;
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
      
      // Ensure we have at least 100 trades if available (increase maxTrades temporarily)
      const originalMaxTrades = this.maxTrades;
      this.maxTrades = Math.max(100, originalMaxTrades); // At least 100 trades
      this.trades = historicalTrades.slice(0, this.maxTrades);
      this.maxTrades = originalMaxTrades; // Restore original
      
      // Cache trades for this mint
      this.tradeCache.set(mintAddress, [...this.trades]);
      
      // Store last fetched slot for incremental updates
      if (transactions.length > 0 && transactions[0].slot) {
        this.lastFetchedSlot.set(mintAddress, transactions[0].slot);
      }
      
      console.log(`[LiveTrades] ✅ Loaded ${this.trades.length} historical trades`);
      console.log(`[LiveTrades] 📊 Parsing stats: ${parsedCount} parsed, ${skippedCount} skipped, ${errorCount} errors`);
      
      // Send initial trades to all listeners
      if (this.trades.length > 0) {
        console.log(`[LiveTrades] 📤 Sending ${this.trades.length} initial trades to listeners`);
        this.trades.forEach(trade => {
          this.sendToAllListeners(trade);
        });
      } else {
        console.log(`[LiveTrades] ⚠️ No trades found after parsing ${transactions.length} transactions`);
        console.log(`[LiveTrades] 💡 This could mean:`);
        console.log(`[LiveTrades]   1. Token has no trades yet`);
        console.log(`[LiveTrades]   2. Trades are too small (filtered out)`);
        console.log(`[LiveTrades]   3. Bonding curve address derivation failed`);
        console.log(`[LiveTrades]   4. Transaction parsing is too strict`);
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

    console.log('[LiveTrades] 🔌 Connecting to Helius WebSocket...');
    this.ws = new WebSocket(this.wsUrl);

    this.ws.on('open', () => {
      console.log('[LiveTrades] ✅ Connected to Helius WebSocket');
      this.isConnected = true;
      // Small delay to ensure WebSocket is fully ready before subscribing
      setTimeout(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.subscribe();
        } else {
          console.error('[LiveTrades] ⚠️ WebSocket not ready after open event');
        }
      }, 100);
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        // DEBUG: Log all incoming WebSocket messages
        if (message.method) {
          console.log(`[LiveTrades] 📨 WS Message: ${message.method}`);
        } else if (message.result !== undefined) {
          console.log(`[LiveTrades] 📨 WS Response: id=${message.id}, result=${JSON.stringify(message.result).slice(0, 50)}`);
        }
        this.handleMessage(message);
      } catch (error) {
        console.error('[LiveTrades] Error parsing message:', error);
      }
    });

    this.ws.on('error', (error) => {
      console.error('[LiveTrades] WebSocket error:', error.message);
    });

    this.ws.on('close', () => {
      // WebSocket closed (Helius - historical data only, QuickNode handles live trades)
      // console.log('[LiveTrades] WebSocket closed, reconnecting...');
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

    // Ensure WebSocket is fully open before subscribing
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[LiveTrades] ⚠️ WebSocket not open, readyState:', this.ws?.readyState);
      // Retry after a short delay
      setTimeout(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.subscribe();
        } else {
          console.error('[LiveTrades] ❌ WebSocket still not ready, falling back to polling only');
          this.startPolling();
        }
      }, 200);
      return;
    }

    try {
      // Subscribe to THIS TOKEN's bonding curve address ONLY
      // This way we only get transactions for our specific token, not all pump.fun trades
      if (!this.currentBondingCurveAddress) {
        console.error('[LiveTrades] ❌ No bonding curve address set - cannot subscribe');
        this.startPolling();
        return;
      }
      
      console.log(`[LiveTrades] 🎯 Subscribing to bonding curve: ${this.currentBondingCurveAddress}`);
      console.log(`[LiveTrades] 🎯 This will ONLY track trades for mint: ${this.currentMintAddress?.slice(0, 8)}...`);
      
      const logsSubscribeMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'logsSubscribe',
        params: [
          {
            mentions: [this.currentBondingCurveAddress] // Subscribe to THIS TOKEN's bonding curve ONLY!
          },
          {
            commitment: 'confirmed'
          }
        ]
      };

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
    
    // Started polling for new transactions (Helius - historical data only, QuickNode handles live)
    // console.log('[LiveTrades] Started polling for new transactions (every 10s)');
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
        if (!tx.transaction.message) continue; // Skip malformed transactions
        
        const signature = tx.transaction.signatures?.[0];
        if (!signature || this.processedSignatures.has(signature)) continue;
        
        const blockTime = tx.blockTime || null;
        
        // Wrap in try-catch to handle parsing errors gracefully
        try {
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
        } catch (parseError) {
          // Skip transactions that can't be parsed
          console.error(`[LiveTrades] Skipping new trade ${signature.slice(0, 8)}...: ${parseError.message}`);
          this.processedSignatures.add(signature); // Mark as processed to avoid retry
          continue;
        }
      }
      
      // Only log if we found new trades (Helius polling - historical data only, QuickNode handles live)
      // if (newTradesCount > 0) {
      //   console.log(`[LiveTrades] ✅ Found ${newTradesCount} new trade(s) from bonding curve`);
      // }
    } catch (error) {
      // Silently handle errors for polling
    }
  }

  // Handle WebSocket messages (same pattern as working tracker)
  handleMessage(message) {
    // Handle subscription confirmation
    if (message.id === 1 && message.result) {
      this.subscriptionId = message.result;
      // Logs subscription confirmed (Helius - historical data only, QuickNode handles live)
      // console.log(`[LiveTrades] ✅ Logs subscription confirmed! Subscription ID: ${this.subscriptionId}`);
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
        
        // DEBUG: Log that we received a notification
        console.log(`[LiveTrades] 📩 logsNotification received! Sig: ${signature?.slice(0, 16)}... Logs: ${logs.length}`);
        
        // Since we subscribed to the bonding curve address directly,
        // ALL notifications we receive are for our token - no filtering needed!
        if (signature) {
          console.log(`[LiveTrades] 🔔 Trade detected! Fetching: ${signature.slice(0, 16)}...`);
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
        
        console.log(`[LiveTrades] 📦 Fetched transaction: ${signature.slice(0, 16)}... - has meta: ${!!tx?.meta}, has tx.transaction: ${!!tx?.transaction}, has tx.message: ${!!tx?.message}`);
        
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
            console.log(`[LiveTrades] ❌ Unknown transaction format - skipping. Keys: ${Object.keys(tx).join(', ')}`);
            this.processedSignatures.delete(signature);
            return;
          }
          
          console.log(`[LiveTrades] ✅ Transaction format recognized, parsing...`);
          
          // Parse transaction
          const blockTime = txData.blockTime || null;
          let tradeResult = null;
          try {
            tradeResult = this.parseTransaction(txData, signature, blockTime);
            console.log(`[LiveTrades] 🔍 Parse result: ${tradeResult ? (Array.isArray(tradeResult) ? tradeResult.length + ' trades' : '1 trade') : 'null (no trade detected)'}`);
          } catch (parseError) {
            console.error(`[LiveTrades] ❌ Parse error: ${parseError.message}`);
            console.error(parseError.stack);
          }
          
          if (tradeResult) {
            // Handle both single trade and array of trades
            const tradesToAdd = Array.isArray(tradeResult) ? tradeResult : [tradeResult];
            
            for (const trade of tradesToAdd) {
              if (trade && trade.timestamp) {
                console.log(`[LiveTrades] ➕ Adding trade: ${trade.type} | ${trade.solAmount} SOL | ${trade.isOurWallet ? '🎯 ' + trade.walletType : 'external'}`);
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
    // Safely check for required fields
    if (!tx || !tx.meta || !tx.transaction) return null;
    
    // Additional safety checks for transaction structure
    if (!tx.transaction.message) return null;
    
    const mintAddress = this.currentMintAddress;
    if (!mintAddress) return null;

    // Filter: Only process transactions that involve swap programs
    // Pump.fun program: 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
    // Jupiter V6: JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4
    // Jupiter V4: JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB
    const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
    const JUPITER_V6_PROGRAM_ID = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
    const JUPITER_V4_PROGRAM_ID = 'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB';
    
    // Safely get instructions and accountKeys with fallbacks
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
    // Safely get token balances
    const preTokenBalances = (tx.meta && Array.isArray(tx.meta.preTokenBalances)) ? tx.meta.preTokenBalances : [];
    const postTokenBalances = (tx.meta && Array.isArray(tx.meta.postTokenBalances)) ? tx.meta.postTokenBalances : [];
    
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
        if (addr && 
            tx.meta.preBalances && Array.isArray(tx.meta.preBalances) && 
            tx.meta.postBalances && Array.isArray(tx.meta.postBalances) && 
            i < tx.meta.preBalances.length && 
            i < tx.meta.postBalances.length) {
          const preSol = (tx.meta.preBalances[i] || 0) / 1e9;
          const postSol = (tx.meta.postBalances[i] || 0) / 1e9;
          const solChange = Math.abs(preSol - postSol);
          // If SOL changed significantly (more than just fees), this is likely the trader
          if (solChange > 0.001) {
            traderAddress = addr;
            break;
          }
        }
      }
    }
    
    // Only process ONE trade per transaction - the actual trader (not the bonding curve)
    // Skip accounts that are the bonding curve (pool)
    if (!traderAddress) {
      // console.log('[LiveTrades] ⚠️ Could not find trader address');
      return null;
    }
    
    // Find the trader's token balance change
    // Strategy: The bonding curve has HUGE token balances (millions), traders have smaller amounts
    // Also: bonding curve token change is OPPOSITE to trader's token change
    let tokenChange = 0;
    let owner = null;
    let candidates = [];
    
    for (const [accountOwner, balances] of accountBalances.entries()) {
      const change = balances.post - balances.pre;
      if (Math.abs(change) < 0.000001) continue; // Ignore tiny changes
      
      candidates.push({
        owner: accountOwner,
        change,
        preBalance: balances.pre,
        postBalance: balances.post
      });
    }
    
    // CRITICAL: Filter OUT the bonding curve - it's the pool, not a trader
    // The bonding curve's token change is OPPOSITE to the trader's, so including it causes buy/sell inversion
    const bondingCurveLower = this.currentBondingCurveAddress?.toLowerCase();
    const traderCandidates = candidates.filter(c => {
      const ownerLower = c.owner.toLowerCase();
      // Exclude bonding curve
      if (bondingCurveLower && ownerLower === bondingCurveLower) {
        return false;
      }
      return true;
    });
    
    // First priority: find account that matches trader address (fee payer)
    const traderLower = traderAddress.toLowerCase();
    for (const c of traderCandidates) {
      const accountLower = c.owner.toLowerCase();
      if (accountLower === traderLower || c.owner.includes(traderAddress.slice(0, 8))) {
        tokenChange = c.change;
        owner = c.owner;
        break;
      }
    }
    
    // If not found by address match, take the one with largest absolute change (actual trader)
    if (!owner && traderCandidates.length > 0) {
      // Sort by absolute change - the trader typically has the significant token movement
      traderCandidates.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
      const traderCandidate = traderCandidates[0];
      tokenChange = traderCandidate.change;
      owner = traderCandidate.owner;
    }
    
    if (!owner || Math.abs(tokenChange) < 0.000001) {
      // console.log('[LiveTrades] ⚠️ No token balance change found for trader');
      return null;
    }
    
    const actualTrader = traderAddress;
    
    // Log token balance detection for debugging
    console.log(`[LiveTrades] 📊 Token detection: trader=${actualTrader.slice(0, 8)}..., tokenChange=${tokenChange > 0 ? '+' : ''}${tokenChange.toFixed(2)}, owner=${owner?.slice(0, 8)}...`);
    
    // Get transaction fee first
    const fee = tx.meta.fee / 1e9;
    
    // Calculate SOL balance change for the trader (not token account owner)
    let preSol = 0;
    let postSol = 0;
    let traderIndex = -1;
    
    // Find trader's account index
    for (let i = 0; i < accountKeys.length; i++) {
      const key = accountKeys[i];
      let addr = null;
      if (typeof key === 'string') {
        addr = key;
      } else if (key && typeof key === 'object') {
        addr = key.pubkey || (key.toBase58 ? key.toBase58() : null) || (typeof key.toString === 'function' && key.toString() !== '[object Object]' ? key.toString() : null);
      }
      if (addr && typeof addr === 'string' && actualTrader && typeof actualTrader === 'string' && addr.toLowerCase() === actualTrader.toLowerCase()) {
        traderIndex = i;
        break;
      }
    }
    
    // Use trader's SOL balance
    if (traderIndex >= 0 && 
        tx.meta.preBalances && Array.isArray(tx.meta.preBalances) && 
        tx.meta.postBalances && Array.isArray(tx.meta.postBalances) &&
        traderIndex < tx.meta.preBalances.length && 
        traderIndex < tx.meta.postBalances.length) {
      preSol = (tx.meta.preBalances[traderIndex] || 0) / 1e9;
      postSol = (tx.meta.postBalances[traderIndex] || 0) / 1e9;
    }
    
    // If trader not found by address, try to find by SOL balance change pattern
    // For sells: look for account that received SOL (balance increased)
    // For buys: look for account that paid SOL (balance decreased)
    if (traderIndex < 0 && tx.meta.preBalances && tx.meta.postBalances && accountKeys.length > 0) {
      let bestMatch = { index: -1, change: 0 };
      
      for (let i = 0; i < Math.min(accountKeys.length, tx.meta.preBalances.length); i++) {
        const preSolI = (tx.meta.preBalances[i] || 0) / 1e9;
        const postSolI = (tx.meta.postBalances[i] || 0) / 1e9;
        const change = postSolI - preSolI;
        
        // Skip bonding curve
        const key = accountKeys[i];
        let addr = null;
        if (typeof key === 'string') {
          addr = key;
        } else if (key && typeof key === 'object') {
          addr = key.pubkey || (key.toBase58 ? key.toBase58() : null) || (typeof key.toString === 'function' && key.toString() !== '[object Object]' ? key.toString() : null);
        }
        // Ensure addr is a string before calling toLowerCase
        if (addr && typeof addr === 'string' && this.currentBondingCurveAddress && addr.toLowerCase() === this.currentBondingCurveAddress.toLowerCase()) {
          continue;
        }
        
        // For sells: look for positive change (received SOL)
        // For buys: look for negative change (paid SOL)
        if (tokenChange < 0 && change > fee + 0.001) {
          // SELL: trader received SOL
          if (change > bestMatch.change) {
            bestMatch = { index: i, change: change };
          }
        } else if (tokenChange > 0 && change < -fee - 0.001) {
          // BUY: trader paid SOL
          if (Math.abs(change) > Math.abs(bestMatch.change)) {
            bestMatch = { index: i, change: change };
          }
        }
      }
      
      if (bestMatch.index >= 0) {
        traderIndex = bestMatch.index;
        preSol = (tx.meta.preBalances[traderIndex] || 0) / 1e9;
        postSol = (tx.meta.postBalances[traderIndex] || 0) / 1e9;
        console.log(`[LiveTrades] 🔍 Found trader by balance pattern: index=${traderIndex}, change=${bestMatch.change.toFixed(6)} SOL`);
      }
    }
    
    // Check for valid balance changes
    const solChange = Math.abs(preSol - postSol);
    if (solChange === 0 && tokenChange === 0) {
      return null;
    }
    
    // Determine buy/sell based on token and SOL balance changes
    // BUY: Token balance increases (trader RECEIVES tokens, PAYS SOL)
    // SELL: Token balance decreases (trader SELLS tokens, RECEIVES SOL)
    const tokenIncreased = tokenChange > 0;
    const tokenDecreased = tokenChange < 0;
    const solDecreased = preSol > postSol && (preSol - postSol) > fee;
    const solIncreased = postSol > preSol && (postSol - preSol) > fee;
    
    // More robust detection with logging for debugging
    let isBuy;
    
    // PRIMARY RULE: Token balance change is the MOST reliable indicator
    // - If trader's tokens INCREASED → they BOUGHT
    // - If trader's tokens DECREASED → they SOLD
    if (tokenIncreased && tokenDecreased) {
      // This shouldn't happen, but if it does, use SOL direction
      console.log(`[LiveTrades] ⚠️ Conflicting token change detected: ${tokenChange}`);
      isBuy = solDecreased;
    } else if (tokenIncreased) {
      // Tokens increased = trader received tokens = BUY
      // Sanity check: SOL should have decreased (trader paid)
      if (solIncreased) {
        console.log(`[LiveTrades] ⚠️ Mismatch: tokens+${tokenChange.toFixed(2)} but SOL+${(postSol - preSol).toFixed(6)} - forcing BUY based on tokens`);
      }
      isBuy = true;
    } else if (tokenDecreased) {
      // Tokens decreased = trader lost tokens = SELL
      // Sanity check: SOL should have increased (trader received payment)
      if (solDecreased) {
        console.log(`[LiveTrades] ⚠️ Mismatch: tokens${tokenChange.toFixed(2)} but SOL-${(preSol - postSol).toFixed(6)} - forcing SELL based on tokens`);
      }
      isBuy = false;
    } else {
      // No token change - this might be a fee or other transaction
      console.log(`[LiveTrades] ⚠️ No significant token change, using SOL direction`);
      isBuy = solDecreased;
    }
    
    // Debug log for suspicious transactions
    if ((isBuy && solIncreased && (postSol - preSol) > 0.01) || (!isBuy && solDecreased && (preSol - postSol) > 0.01)) {
      console.log(`[LiveTrades] 🔍 Potential misclassification: type=${isBuy ? 'BUY' : 'SELL'}, tokenChange=${tokenChange.toFixed(2)}, solChange=${(postSol - preSol).toFixed(6)}, sig=${signature.slice(0, 8)}...`);
    }
    
    const tokenAmount = Math.abs(tokenChange);
    
    // Calculate SOL amount from balance change
    let solAmount = 0;
    
    // If we found the trader's index, use that balance
    // For sells, we need to be more lenient - trader might have 0 SOL before selling
    if (traderIndex >= 0) {
      if (isBuy) {
        // BUY: Trader pays SOL, so preSol > postSol
        if (preSol > 0 && postSol >= 0) {
          solAmount = Math.max(0, (preSol - postSol) - fee);
        }
      } else {
        // SELL: Trader receives SOL, so postSol > preSol
        // Don't require preSol to be non-zero - trader might have started with 0
        const solReceived = postSol - preSol;
        if (solReceived > 0) {
          // For sells, the trader receives SOL
          // The net amount received is (postSol - preSol), but we want gross (before fees)
          // Fee is deducted from what they receive, so gross = net + fee
          solAmount = solReceived + fee;
          console.log(`[LiveTrades] 💰 SELL calc: preSol=${preSol.toFixed(6)}, postSol=${postSol.toFixed(6)}, received=${solReceived.toFixed(6)}, fee=${fee.toFixed(6)}, gross=${solAmount.toFixed(6)}`);
        } else if (solReceived <= 0 && postSol > 0) {
          // Edge case: trader received SOL but calculation shows 0 or negative
          // This can happen if preSol wasn't tracked correctly
          // Use postSol as minimum estimate (they definitely received at least this much)
          solAmount = Math.max(postSol, fee * 2); // At least 2x fee as minimum
          console.log(`[LiveTrades] ⚠️ SELL edge case: using postSol=${postSol.toFixed(6)} as minimum, calculated=${solAmount.toFixed(6)}`);
        }
      }
    }
    
    // Fallback: find account that received SOL (for sells) or paid SOL (for buys)
    if (solAmount === 0 && tx.meta.preBalances && tx.meta.postBalances && accountKeys.length > 0) {
      if (isBuy) {
        // For buys, find account that paid SOL (balance decreased)
        for (let i = 0; i < Math.min(accountKeys.length, tx.meta.preBalances.length); i++) {
          const preSolI = (tx.meta.preBalances[i] || 0) / 1e9;
          const postSolI = (tx.meta.postBalances[i] || 0) / 1e9;
          const change = preSolI - postSolI;
          if (change > fee + 0.001) { // Significant change (more than fee)
            solAmount = Math.max(0, change - fee);
            break;
          }
        }
      } else {
        // For sells, find account that received SOL (balance increased)
        // Skip bonding curve
        for (let i = 0; i < Math.min(accountKeys.length, tx.meta.preBalances.length); i++) {
          const key = accountKeys[i];
          let addr = null;
          if (typeof key === 'string') {
            addr = key;
          } else if (key && typeof key === 'object') {
            addr = key.pubkey || (key.toBase58 ? key.toBase58() : null) || (typeof key.toString === 'function' && key.toString() !== '[object Object]' ? key.toString() : null);
          }
          // Skip bonding curve
        // Ensure addr is a string before calling toLowerCase
        if (addr && typeof addr === 'string' && this.currentBondingCurveAddress && addr.toLowerCase() === this.currentBondingCurveAddress.toLowerCase()) {
          continue;
        }
          
          const preSolI = (tx.meta.preBalances[i] || 0) / 1e9;
          const postSolI = (tx.meta.postBalances[i] || 0) / 1e9;
          const change = postSolI - preSolI;
          if (change > fee + 0.001) { // Significant change (more than fee)
            // For sells: gross amount = net received + fee
            solAmount = change + fee;
            console.log(`[LiveTrades] 💰 SELL fallback: account[${i}], preSol=${preSolI.toFixed(6)}, postSol=${postSolI.toFixed(6)}, change=${change.toFixed(6)}, fee=${fee.toFixed(6)}, gross=${solAmount.toFixed(6)}`);
            break;
          }
        }
      }
    }
    
    // Debug log for SOL calculation
    console.log(`[LiveTrades] 💰 SOL calc: type=${isBuy ? 'BUY' : 'SELL'}, traderIndex=${traderIndex}, preSol=${preSol.toFixed(6)}, postSol=${postSol.toFixed(6)}, fee=${fee.toFixed(6)}, result=${solAmount.toFixed(6)}`);
    
    // For sells, if we still have 0, try multiple fallback methods
    if (solAmount === 0 && !isBuy && tokenAmount > 0) {
      // Method 1: Estimate from token amount and market cap
      if (this.currentMarketCap && this.currentMarketCap > 0) {
        const solPrice = this.solPriceCache?.price || 200;
        const marketCapSOL = this.currentMarketCap / solPrice;
        const pricePerToken = marketCapSOL / 1000000000; // 1B supply
        solAmount = tokenAmount * pricePerToken;
        console.log(`[LiveTrades] 💰 Estimated SOL from market cap: ${solAmount.toFixed(6)} SOL (pricePerToken=${pricePerToken.toFixed(9)})`);
      }
      
      // Method 2: If still 0, use a reasonable minimum based on token amount
      if (solAmount === 0) {
        // Very rough estimate: assume at least 0.0001 SOL per million tokens
        solAmount = Math.max(0.0001, (tokenAmount / 1000000) * 0.0001);
        console.log(`[LiveTrades] ⚠️ Using token-based SOL estimate: ${solAmount.toFixed(6)} SOL`);
      }
    }
    
    // Skip if no valid amounts at all
    if (solAmount === 0 && tokenAmount === 0) {
      return null;
    }
    
    // Final fallback: minimum SOL estimate for display (only if we have tokens but no SOL)
    if (solAmount === 0 && tokenAmount > 0) {
      solAmount = 0.0001; // Increased from 0.00001 to be more visible
      console.log(`[LiveTrades] ⚠️ Using absolute minimum SOL estimate: ${solAmount.toFixed(6)} SOL`);
    }
    
    // Calculate market cap (in USD)
    let marketCap = this.currentMarketCap;
    if (!marketCap || marketCap === 0) {
      const pricePerToken = tokenAmount > 0 ? solAmount / tokenAmount : 0;
      const marketCapSOL = pricePerToken * 1000000000; // 1B supply
      const solPrice = this.solPriceCache?.price || 200;
      marketCap = marketCapSOL * solPrice; // Convert to USD using cached price
    }
    
    // Get timestamp
    const timestamp = blockTime ? blockTime * 1000 : (tx.blockTime ? tx.blockTime * 1000 : Date.now());
    const age = Math.floor((Date.now() - timestamp) / 60000);
    
    // Check if it's our wallet
    const traderAddrLower = actualTrader.toLowerCase();
    const isOurWallet = this.ourWallets.has(traderAddrLower);
    const walletType = isOurWallet ? (this.walletTypes.get(traderAddrLower) || 'Unknown') : null;
    
    // Log our wallet trades
    if (isOurWallet) {
      console.log(`[LiveTrades] ✅ ${walletType} trade: ${isBuy ? 'BUY' : 'SELL'} | ${solAmount.toFixed(6)} SOL | ${tokenAmount.toFixed(0)} tokens`);
    }
    
    // Refresh market cap after trade (async, don't wait)
    this.refreshMarketCap().catch(() => {});
    
    // Return single trade (not array since we only process one per transaction now)
    return {
      signature: signature.slice(0, 8) + '...',
      fullSignature: signature,
      age: age,
      type: isBuy ? 'buy' : 'sell',
      marketCap: marketCap,
      amount: tokenAmount,
      totalUSD: solAmount * 150,
      gas: fee,
      trader: actualTrader.slice(0, 4) + '...' + actualTrader.slice(-4),
      fullTrader: actualTrader,
      timestamp: timestamp,
      solAmount: solAmount,
      isOurWallet: isOurWallet,
      walletType: walletType,
      slot: tx.slot || null
    };
  }

  // Add trade to list
  addTrade(trade) {
    console.log(`[LiveTrades] 📥 addTrade called: ${trade.type} | ${trade.solAmount} SOL | listeners: ${this.listeners.length}`);
    
    // Filter by mint address if current mint is set
    // This allows QuickNode to send all trades, but we only process ones for our mint
    if (this.currentMintAddress && trade.mintAddress) {
      const tradeMintLower = trade.mintAddress.toLowerCase().trim();
      const currentMintLower = this.currentMintAddress.toLowerCase().trim();
      if (tradeMintLower !== currentMintLower) {
        // Skip trades for other mints
        console.log(`[LiveTrades] ⏭️ Skipping trade - mint mismatch`);
        return;
      }
    }
    
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
    
    // Track external volume for auto-sell
    this.trackExternalVolume(trade);
    
    // Record trade in launch tracker (for history and PnL)
    try {
      const { getLaunchTracker } = require('./launch-tracker');
      const tracker = getLaunchTracker();
      tracker.recordTrade(trade);
    } catch (err) {
      // Silently ignore if tracker not available
    }
    
    // Send to all listeners
    console.log(`[LiveTrades] 📤 Sending trade to ${this.listeners.length} listener(s)`);
    this.sendToAllListeners(trade);
  }

  // Get recent trades
  getTrades() {
    return this.trades;
  }
}

// Singleton instance
const liveTradesTracker = new LiveTradesTracker();

// NOTE: Disabled Helius WebSocket - using PumpPortal tracker instead (pumpportal-tracker.js)
// liveTradesTracker.initialize();
// If you need historical fetch or test wallets, call initialize() manually

module.exports = liveTradesTracker;
