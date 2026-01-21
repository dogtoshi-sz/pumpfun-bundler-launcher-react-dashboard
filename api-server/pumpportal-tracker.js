// PumpPortal Real-time Trade Tracker
// Uses PumpPortal WebSocket API for accurate buy/sell detection
// Docs: https://pumpportal.fun/data-api/real-time

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

class PumpPortalTracker {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = Infinity; // NEVER stop trying to reconnect
    this.reconnectDelay = 3000;
    this.maxReconnectDelay = 30000; // Cap at 30 seconds
    this.lastPongTime = Date.now();
    this.pingInterval = null;
    this.healthCheckInterval = null;
    
    // Track subscriptions - IMPORTANT: Only use ONE connection
    this.subscribedTokens = new Set();
    this.subscribedAccounts = new Set();
    
    // Trade listeners (SSE connections from frontend)
    this.listeners = [];
    
    // Trade callbacks (for internal services like trend detector)
    this.tradeCallbacks = [];
    
    // Our wallet addresses for highlighting
    this.ourWallets = new Set();
    this.walletTypes = new Map(); // wallet -> type (FUNDING, DEV, Bundle, Holder)
    this.walletLabels = new Map(); // wallet -> label (e.g., "Holder 1", "Holder 2")
    
    // Wallet profit tracking (per wallet)
    this.walletProfits = new Map(); // wallet -> { buys: SOL, sells: SOL, profit: SOL }
    
    // SOL price cache (refresh every 30 seconds)
    this.solPriceCache = { price: 200, lastFetch: 0 };
    this.startSolPriceUpdater();
    
    // Trade cache per mint (in-memory + file persistence)
    this.tradeCache = new Map();
    this.maxTradesPerMint = 500; // Increased for pattern detection
    this.tradeHistoryDir = path.join(__dirname, '..', 'keys', 'trade-history');
    
    // Ensure trade history directory exists
    if (!fs.existsSync(this.tradeHistoryDir)) {
      fs.mkdirSync(this.tradeHistoryDir, { recursive: true });
    }
    
    // Current tracking
    this.currentMintAddress = null;
    
    // Auto-tracking
    this.autoTrackInterval = null;
    this.lastTrackedMint = null;
    
    // Auto-sell system (migrated from live-trades-tracker)
    this.autoSellConfig = new Map(); // Map wallet address -> { threshold, enabled, triggered }
    this.externalNetVolume = 0; // Cumulative NET external volume (buys - sells)
    this.autoSellEnabled = false; // Global toggle
    this.autoSellListeners = []; // Listeners for auto-sell events
    
    // FRONT-RUN PROTECTION: Real-time tracking for instant synchronous checks
    this.externalGrossBuyVolume = 0; // GROSS external buys (not net - ignores sells)
    this.externalGrossBuyTrades = []; // Array of { solAmount, timestamp } for time-windowed tracking
    this.frontRunWindowMs = 30000; // 30 second window for front-run detection
    this.frontRunBlocked = false; // Flag set immediately when threshold exceeded (synchronous check)
    this.frontRunThreshold = 0; // Threshold in SOL (set by launch process)
    
    // MEV Protection settings
    this.mevProtection = {
      enabled: true,
      confirmationDelaySec: 3,
      launchCooldownSec: 5,
      rapidTraderWindowSec: 10,
    };
    this.firstExternalTradeTime = null;
    this.externalTraderHistory = new Map();
    this.pendingSellTriggers = new Map();
    this.cooldownRecheckScheduled = false; // Track if we've scheduled a re-check after cooldown
    
    // Config persistence
    this.configDir = path.join(__dirname, '..', 'keys');
    this.autoSellConfigPath = path.join(this.configDir, 'trade-configs', 'auto-sell-config.json');
    
    // DEDUPLICATION: Track which wallet+mint+type combinations have been recorded
    // Format: "mint:wallet:type" (e.g., "ABC123:XYZ789:buy")
    this.recordedTrades = new Set();
    
    // Load saved settings
    this.loadAutoSellConfig();
  }
  
  // =====================================================
  // AUTO-SELL SYSTEM (migrated from live-trades-tracker)
  // =====================================================
  
  saveAutoSellConfig() {
    try {
      const config = {
        autoSellEnabled: this.autoSellEnabled,
        mevProtection: this.mevProtection,
        walletConfigs: {},
        savedAt: new Date().toISOString(),
      };
      
      for (const [addr, settings] of this.autoSellConfig) {
        const walletType = this.walletTypes.get(addr) || this.walletTypes.get(addr.toLowerCase());
        if (walletType) {
          config.walletConfigs[walletType] = {
            threshold: settings.threshold,
            enabled: settings.enabled,
          };
        }
      }
      
      fs.writeFileSync(this.autoSellConfigPath, JSON.stringify(config, null, 2));
      console.log(`[PumpPortal AutoSell] 💾 Saved config`);
    } catch (err) {
      console.error('[PumpPortal AutoSell] Failed to save config:', err.message);
    }
  }
  
  loadAutoSellConfig() {
    try {
      // First, load from JSON config file (legacy/runtime state)
      if (fs.existsSync(this.autoSellConfigPath)) {
        const data = JSON.parse(fs.readFileSync(this.autoSellConfigPath, 'utf8'));
        
        if (typeof data.autoSellEnabled === 'boolean') {
          this.autoSellEnabled = data.autoSellEnabled;
        }
        
        if (data.mevProtection) {
          this.mevProtection = { ...this.mevProtection, ...data.mevProtection };
        }
        
        this.savedWalletConfigs = data.walletConfigs || {};
        console.log(`[PumpPortal AutoSell] 📂 Loaded config from JSON: enabled=${this.autoSellEnabled}`);
      }
      
      // Then, override with .env settings (takes precedence)
      this.loadFromEnv();
      
    } catch (err) {
      console.error('[PumpPortal AutoSell] Failed to load config:', err.message);
      this.savedWalletConfigs = {};
    }
  }
  
  loadFromEnv() {
    try {
      const envPath = path.join(__dirname, '..', '.env');
      if (!fs.existsSync(envPath)) return;
      
      const envContent = fs.readFileSync(envPath, 'utf8');
      const envLines = envContent.split('\n');
      const env = {};
      
      for (const line of envLines) {
        const match = line.match(/^([A-Z_]+)=(.*)$/);
        if (match) {
          env[match[1]] = match[2].trim();
        }
      }
      
      // Load auto-sell settings from .env (override JSON if present)
      if (env.AUTO_SELL_ENABLED !== undefined) {
        this.autoSellEnabled = env.AUTO_SELL_ENABLED === 'true';
        console.log(`[PumpPortal AutoSell] 📂 Loaded from .env: enabled=${this.autoSellEnabled}`);
      }
      
      // Load MEV protection settings from .env
      if (env.AUTO_SELL_MEV_ENABLED !== undefined) {
        this.mevProtection.enabled = env.AUTO_SELL_MEV_ENABLED === 'true';
      }
      if (env.AUTO_SELL_MEV_CONFIRMATION_DELAY !== undefined) {
        this.mevProtection.confirmationDelaySec = parseFloat(env.AUTO_SELL_MEV_CONFIRMATION_DELAY) || 3;
      }
      if (env.AUTO_SELL_MEV_LAUNCH_COOLDOWN !== undefined) {
        this.mevProtection.launchCooldownSec = parseFloat(env.AUTO_SELL_MEV_LAUNCH_COOLDOWN) || 5;
      }
      if (env.AUTO_SELL_MEV_RAPID_WINDOW !== undefined) {
        this.mevProtection.rapidTraderWindowSec = parseFloat(env.AUTO_SELL_MEV_RAPID_WINDOW) || 10;
      }
      
      // Store default threshold for new wallets
      if (env.AUTO_SELL_DEFAULT_THRESHOLD !== undefined) {
        this.defaultThreshold = parseFloat(env.AUTO_SELL_DEFAULT_THRESHOLD) || 1;
      }
      
      console.log(`[PumpPortal AutoSell] 📂 MEV Protection: enabled=${this.mevProtection.enabled}, delay=${this.mevProtection.confirmationDelaySec}s, cooldown=${this.mevProtection.launchCooldownSec}s`);
    } catch (err) {
      console.error('[PumpPortal AutoSell] Failed to load from .env:', err.message);
    }
  }
  
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
    console.log(`[PumpPortal AutoSell] Configured ${walletAddress.slice(0, 8)}... threshold: ${threshold} SOL`);
    
    if (thresholdValue > 0 && !this.autoSellEnabled) {
      this.autoSellEnabled = true;
      console.log(`[PumpPortal AutoSell] ✅ AUTO-ENABLED`);
    }
    
    this.saveAutoSellConfig();
    return this.getAutoSellConfig();
  }
  
  getAutoSellConfig() {
    const config = {};
    for (const [addr, settings] of this.autoSellConfig) {
      config[addr] = { ...settings };
    }
    
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
    console.log(`[PumpPortal AutoSell] Configured ${this.autoSellConfig.size} wallets`);
    
    if (hasThresholds && !this.autoSellEnabled) {
      this.autoSellEnabled = true;
    }
    
    this.saveAutoSellConfig();
    return this.getAutoSellConfig();
  }
  
  setAutoSellEnabled(enabled) {
    this.autoSellEnabled = enabled;
    console.log(`[PumpPortal AutoSell] ${enabled ? '✅ ENABLED' : '❌ DISABLED'}`);
    this.saveAutoSellConfig();
    return this.getAutoSellConfig();
  }
  
  resetAutoSell() {
    this.externalNetVolume = 0;
    for (const [addr, settings] of this.autoSellConfig) {
      settings.triggered = false;
      settings.triggeredAt = null;
      settings.sellResult = null;
    }
    
    this.firstExternalTradeTime = null;
    this.externalTraderHistory.clear();
    
    for (const timeout of this.pendingSellTriggers.values()) {
      clearTimeout(timeout);
    }
    this.pendingSellTriggers.clear();
    
    // Reset front-run protection state
    this.externalGrossBuyVolume = 0;
    this.externalGrossBuyTrades = [];
    this.frontRunBlocked = false;
    this.frontRunThreshold = 0;
    
    console.log('[PumpPortal AutoSell] Reset all states');
    return this.getAutoSellConfig();
  }
  
  // ============================================
  // FRONT-RUN PROTECTION: Synchronous methods
  // ============================================
  
  // Set front-run threshold (called before launch)
  setFrontRunThreshold(threshold) {
    this.frontRunThreshold = threshold || 0;
    this.frontRunBlocked = false; // Reset flag when threshold is set
    this.externalGrossBuyVolume = 0; // Reset volume tracking
    this.externalGrossBuyTrades = []; // Reset trade history
    if (threshold > 0) {
      console.log(`[PumpPortal FrontRun] 🛡️  Front-run protection enabled: threshold = ${threshold} SOL (30s window)`);
    } else {
      console.log(`[PumpPortal FrontRun] ⚠️  Front-run protection disabled (threshold = 0)`);
    }
  }
  
  // Synchronous check: Is front-run blocked? (instant, no async)
  isFrontRunBlocked() {
    // Also check current volume in case flag wasn't set yet (race condition protection)
    if (this.frontRunThreshold > 0 && this.externalGrossBuyVolume >= this.frontRunThreshold) {
      if (!this.frontRunBlocked) {
        this.frontRunBlocked = true; // Set flag now
      }
      return true;
    }
    return this.frontRunBlocked;
  }
  
  // Get current external gross buy volume (for logging)
  getExternalGrossBuyVolume() {
    // Clean up old trades
    const now = Date.now();
    const cutoffTime = now - this.frontRunWindowMs;
    this.externalGrossBuyTrades = this.externalGrossBuyTrades.filter(t => t.timestamp >= cutoffTime);
    this.externalGrossBuyVolume = this.externalGrossBuyTrades.reduce((sum, t) => sum + t.solAmount, 0);
    return this.externalGrossBuyVolume;
  }
  
  setMevProtection(settings) {
    this.mevProtection = { ...this.mevProtection, ...settings };
    console.log('[PumpPortal AutoSell] MEV protection updated:', this.mevProtection);
    this.saveAutoSellConfig();
    return this.mevProtection;
  }
  
  getMevProtection() {
    return { ...this.mevProtection };
  }
  
  trackExternalVolume(trade) {
    // CRITICAL: Re-check wallet ownership against CURRENT wallet list
    // (trade.isOurWallet might be stale if wallet was registered after trade)
    const traderLower = (trade.fullTrader || trade.trader || '').toLowerCase();
    const isCurrentlyOurs = this.ourWallets.has(traderLower);
    const isFundingWallet = trade.walletType === 'FUNDING' || this.walletTypes.get(traderLower) === 'FUNDING';
    
    // Skip our wallets (except funding for testing)
    if (isCurrentlyOurs && !isFundingWallet) {
      // If this was previously counted as external, don't double-track
      return;
    }
    
    const now = Date.now();
    const traderAddr = trade.fullTrader?.toLowerCase();
    
    // ============================================
    // FRONT-RUN PROTECTION: Track GROSS external buys in real-time
    // ============================================
    // This runs IMMEDIATELY when a trade is detected (WebSocket real-time)
    // Sets a flag that can be checked synchronously (no async delay)
    if (trade.type === 'buy' && trade.solAmount > 0) {
      // Add to time-windowed tracking
      this.externalGrossBuyTrades.push({
        solAmount: trade.solAmount,
        timestamp: now
      });
      
      // Remove trades outside the time window
      const cutoffTime = now - this.frontRunWindowMs;
      this.externalGrossBuyTrades = this.externalGrossBuyTrades.filter(t => t.timestamp >= cutoffTime);
      
      // Recalculate gross buy volume (sum of all buys in window)
      this.externalGrossBuyVolume = this.externalGrossBuyTrades.reduce((sum, t) => sum + t.solAmount, 0);
      
      // IMMEDIATELY set flag if threshold exceeded (synchronous, no delay)
      if (this.frontRunThreshold > 0 && this.externalGrossBuyVolume >= this.frontRunThreshold) {
        if (!this.frontRunBlocked) {
          this.frontRunBlocked = true;
          console.log(`[PumpPortal FrontRun] 🚨 BLOCKED: External GROSS buys = ${this.externalGrossBuyVolume.toFixed(4)} SOL >= ${this.frontRunThreshold} SOL threshold`);
          console.log(`[PumpPortal FrontRun] ⚡ Flag set IMMEDIATELY - all holder wallet buys will be skipped`);
        }
      }
    }
    
    if (!this.firstExternalTradeTime) {
      this.firstExternalTradeTime = now;
      console.log(`[PumpPortal AutoSell] 📍 First external trade detected`);
    }
    
    // MEV Protection: Track trader history
    if (this.mevProtection.enabled && traderAddr) {
      if (!this.externalTraderHistory.has(traderAddr)) {
        this.externalTraderHistory.set(traderAddr, []);
      }
      const history = this.externalTraderHistory.get(traderAddr);
      history.push({ type: trade.type, solAmount: trade.solAmount, timestamp: now });
      
      const cutoff = now - 60000;
      while (history.length > 0 && history[0].timestamp < cutoff) {
        history.shift();
      }
      
      const windowMs = this.mevProtection.rapidTraderWindowSec * 1000;
      const recentTrades = history.filter(h => h.timestamp > now - windowMs);
      const hasBuy = recentTrades.some(t => t.type === 'buy');
      const hasSell = recentTrades.some(t => t.type === 'sell');
      
      if (hasBuy && hasSell) {
        const netVolume = recentTrades.reduce((sum, t) => 
          sum + (t.type === 'buy' ? t.solAmount : -t.solAmount), 0);
        if (Math.abs(netVolume) > 0.01) {
          console.log(`[PumpPortal AutoSell] ⚠️ MEV detected: ${traderAddr.slice(0, 8)}...`);
        }
      }
    }
    
    const volumeChange = trade.type === 'buy' ? trade.solAmount : -trade.solAmount;
    this.externalNetVolume += volumeChange;
    
    if (!this.autoSellEnabled || !this.currentMintAddress) return;
    
    // MEV Protection: Launch cooldown
    if (this.mevProtection.enabled) {
      const timeSinceFirst = (now - this.firstExternalTradeTime) / 1000;
      if (timeSinceFirst < this.mevProtection.launchCooldownSec) {
        // Check if any threshold would have been reached (for logging)
        for (const [walletAddr, config] of this.autoSellConfig) {
          if (config.enabled && !config.triggered && this.externalNetVolume >= config.threshold && config.threshold > 0) {
            console.log(`[PumpPortal AutoSell] ⏸️  Threshold reached (${this.externalNetVolume.toFixed(4)} SOL >= ${config.threshold} SOL) but BLOCKED by MEV cooldown (${(this.mevProtection.launchCooldownSec - timeSinceFirst).toFixed(1)}s remaining)`);
          }
        }
        
        // Schedule a re-check after cooldown expires (if not already scheduled)
        if (!this.cooldownRecheckScheduled) {
          const cooldownRemaining = (this.mevProtection.launchCooldownSec - timeSinceFirst) * 1000;
          this.cooldownRecheckScheduled = true;
          setTimeout(() => {
            this.cooldownRecheckScheduled = false;
            // Re-check thresholds after cooldown expires
            this.checkAutoSellThresholds();
          }, cooldownRemaining + 100); // Add 100ms buffer
        }
        
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
    
    // Check thresholds (extracted to separate method so it can be called after cooldown)
    this.checkAutoSellThresholds();
    
    this.notifyAutoSellListeners({
      type: 'volumeUpdate',
      externalNetVolume: this.externalNetVolume,
      trade: trade,
    });
  }
  
  // Check auto-sell thresholds (can be called independently after cooldown expires)
  checkAutoSellThresholds() {
    if (!this.autoSellEnabled || !this.currentMintAddress) return;
    
    // MEV Protection: Launch cooldown check
    if (this.mevProtection.enabled && this.firstExternalTradeTime) {
      const now = Date.now();
      const timeSinceFirst = (now - this.firstExternalTradeTime) / 1000;
      if (timeSinceFirst < this.mevProtection.launchCooldownSec) {
        // Still in cooldown - don't check yet
        return;
      }
    }
    
    // Check thresholds
    for (const [walletAddr, config] of this.autoSellConfig) {
      if (!config.enabled || config.triggered) continue;
      if (this.pendingSellTriggers.has(walletAddr)) continue;
      
      if (this.externalNetVolume >= config.threshold && config.threshold > 0) {
        console.log(`[PumpPortal AutoSell] 🎯 Threshold REACHED for ${walletAddr.slice(0, 8)}... (${this.externalNetVolume.toFixed(4)} SOL >= ${config.threshold} SOL)`);
        
        if (this.mevProtection.enabled && this.mevProtection.confirmationDelaySec > 0) {
          const delayMs = this.mevProtection.confirmationDelaySec * 1000;
          console.log(`[PumpPortal AutoSell] ⏱️ Waiting ${this.mevProtection.confirmationDelaySec}s...`);
          
          const timeout = setTimeout(() => {
            this.pendingSellTriggers.delete(walletAddr);
            
            if (this.externalNetVolume >= config.threshold) {
              console.log(`[PumpPortal AutoSell] ✅ Confirmed!`);
              this.triggerAutoSell(walletAddr, config);
            } else {
              console.log(`[PumpPortal AutoSell] ❌ Cancelled - volume dropped`);
              this.notifyAutoSellListeners({
                type: 'sellCancelled',
                walletAddress: walletAddr,
                reason: 'Volume dropped below threshold',
              });
            }
          }, delayMs);
          
          this.pendingSellTriggers.set(walletAddr, timeout);
        } else {
          this.triggerAutoSell(walletAddr, config);
        }
      }
    }
  }
  
  async triggerAutoSell(walletAddress, config) {
    config.triggered = true;
    config.triggeredAt = Date.now();
    
    console.log(`[PumpPortal AutoSell] 🚀 TRIGGERING SELL for ${walletAddress.slice(0, 8)}...`);
    
    this.notifyAutoSellListeners({
      type: 'sellTriggered',
      walletAddress: walletAddress,
      threshold: config.threshold,
      externalNetVolume: this.externalNetVolume,
    });
    
    try {
      const sellResult = await this.executeAutoSell(walletAddress);
      config.sellResult = sellResult;
      
      this.notifyAutoSellListeners({
        type: 'sellComplete',
        walletAddress: walletAddress,
        result: sellResult,
      });
    } catch (error) {
      console.error(`[PumpPortal AutoSell] ❌ Sell failed:`, error.message);
      config.sellResult = { error: error.message };
      
      this.notifyAutoSellListeners({
        type: 'sellFailed',
        walletAddress: walletAddress,
        error: error.message,
      });
    }
  }
  
  async executeAutoSell(walletAddress) {
    console.log(`[PumpPortal AutoSell] ⚡ Execute sell for ${walletAddress.slice(0, 8)}... (handler not set)`);
    return { success: false, error: 'Sell handler not configured' };
  }
  
  setAutoSellExecutor(callback) {
    this.executeAutoSell = callback;
    console.log('[PumpPortal AutoSell] ✅ Sell executor configured');
  }
  
  addAutoSellListener(callback) {
    this.autoSellListeners.push(callback);
    return () => {
      this.autoSellListeners = this.autoSellListeners.filter(cb => cb !== callback);
    };
  }
  
  notifyAutoSellListeners(event) {
    for (const listener of this.autoSellListeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('[PumpPortal AutoSell] Listener error:', e.message);
      }
    }
  }

  // Start SOL price updater (runs every 30 seconds)
  startSolPriceUpdater() {
    // Fetch immediately
    this.fetchSolPrice();
    
    // Then every 30 seconds
    setInterval(() => {
      this.fetchSolPrice();
    }, 30000);
  }
  
  // Fetch current SOL price from CoinGecko
  async fetchSolPrice() {
    try {
      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', {
        timeout: 5000,
      });
      const price = response.data?.solana?.usd || 0;
      if (price > 0) {
        this.solPriceCache = { price, lastFetch: Date.now() };
        // Only log price updates every 5 minutes to reduce spam
        if (!this._lastPriceLog || Date.now() - this._lastPriceLog > 300000) {
          console.log(`[PumpPortal] 💰 SOL price updated: $${price.toFixed(2)}`);
          this._lastPriceLog = Date.now();
        }
      }
    } catch (error) {
      // Silently fail - use cached price (rate-limit warning to once per minute)
      if (!this._lastPriceWarn || Date.now() - this._lastPriceWarn > 60000) {
        console.warn('[PumpPortal] ⚠️ Failed to fetch SOL price, using cached:', this.solPriceCache.price);
        this._lastPriceWarn = Date.now();
      }
    }
  }
  
  // Get current cached SOL price
  getSolPrice() {
    return this.solPriceCache.price || 200;
  }

  // Initialize connection
  initialize() {
    console.log('[PumpPortal] 🚀 Initializing PumpPortal tracker...');
    this.connect();
    
    // Load wallets IMMEDIATELY on startup (don't wait for new mint detection)
    this.loadWalletsOnStartup();
    
    this.startAutoTracking();
  }
  
  // Load wallets immediately on startup (for existing token runs)
  loadWalletsOnStartup() {
    try {
      const currentRunPath = path.join(__dirname, '..', 'keys', 'current-run.json');
      if (fs.existsSync(currentRunPath)) {
        const data = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
        const mintAddress = data.mintAddress;
        
        if (mintAddress && mintAddress.length > 20) {
          console.log(`[PumpPortal] 📂 Found existing token run: ${mintAddress.slice(0, 8)}...`);
          
          // Load wallets first!
          this.loadOurWallets(data);
          
          // Subscribe to the token
          this.subscribeToToken(mintAddress);
          this.lastTrackedMint = mintAddress;
        }
      }
    } catch (error) {
      console.warn('[PumpPortal] Could not load existing run:', error.message);
    }
  }
  
  // Auto-track new tokens from current-run.json
  startAutoTracking() {
    const currentRunPath = path.join(__dirname, '..', 'keys', 'current-run.json');
    
    // Watch file for changes (instant detection)
    try {
      fs.watchFile(currentRunPath, { interval: 500 }, (curr, prev) => {
        if (curr.mtime !== prev.mtime) {
          console.log('[PumpPortal] 📂 current-run.json changed - reloading wallets...');
          this.reloadFromCurrentRun();
        }
      });
      console.log('[PumpPortal] 👀 Watching current-run.json for changes');
    } catch (e) {
      console.warn('[PumpPortal] Could not watch file:', e.message);
    }
    
    // Also poll every 1 second as backup
    this.autoTrackInterval = setInterval(() => {
      try {
        if (!fs.existsSync(currentRunPath)) return;
        
        const data = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
        const mintAddress = data.mintAddress;
        
        // If we have a new mint address, subscribe
        if (mintAddress && mintAddress.length > 20 && mintAddress !== this.lastTrackedMint) {
          console.log(`[PumpPortal] 🚀 Auto-subscribing to new token: ${mintAddress.slice(0, 8)}...`);
          this.lastTrackedMint = mintAddress;
          
          // Unsubscribe from previous token first (cleanup)
          if (this.currentMintAddress && this.currentMintAddress !== mintAddress) {
            this.unsubscribeFromToken(this.currentMintAddress);
            this.clearCache(this.currentMintAddress);
          }
          
          // Subscribe to new token
          this.subscribeToToken(mintAddress);
          
          // Load our wallets for highlighting
          this.loadOurWallets(data);
          
          // Recalculate P&L immediately
          this.recalculateProfitsFromCache();
        }
      } catch (error) {
        // Silently fail - current-run.json might not be ready
      }
    }, 1000); // Reduced to 1 second
  }
  
  // Reload wallets from current-run.json (called when file changes)
  reloadFromCurrentRun() {
    try {
      const currentRunPath = path.join(__dirname, '..', 'keys', 'current-run.json');
      if (!fs.existsSync(currentRunPath)) return;
      
      const data = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
      
      // Always reload wallets
      this.loadOurWallets(data);
      
      // Map and apply auto-sell configs from launch form if available
      // This ensures configs are connected to wallets even if they weren't applied during creation
      const autoSellConfigPath = path.join(__dirname, '..', 'keys', 'trade-configs', 'launch-auto-sell-config.json');
      if (fs.existsSync(autoSellConfigPath)) {
        const configData = JSON.parse(fs.readFileSync(autoSellConfigPath, 'utf8'));
        const walletAddresses = {
          holderWalletAddresses: data.holderWalletAddresses || [],
          bundleWalletAddresses: data.bundleWalletAddresses || [],
          devWalletAddress: data.devWalletAddress || data.devWallet || data.creatorWalletAddress
        };
        this.mapAndApplyAutoSellConfigs(configData, walletAddresses);
      }
      
      // Recalculate P&L with new wallet list
      this.recalculateProfitsFromCache();
      
      // Subscribe to token if needed
      const mintAddress = data.mintAddress;
      if (mintAddress && mintAddress.length > 20 && mintAddress !== this.lastTrackedMint) {
        this.lastTrackedMint = mintAddress;
        this.subscribeToToken(mintAddress);
        
        // Inject dev buy from current-run.json if not already tracked
        // This ensures Quick Launch dev buys are captured even when they happen before tracking starts
        if (data.devBuyAmount && data.devWalletAddress) {
          this.injectDevBuyFromCurrentRun(data, mintAddress);
        }
      }
    } catch (e) {
      console.warn('[PumpPortal] Error reloading:', e.message);
    }
  }
  
  // Map and apply auto-sell configs from launch form
  // This function maps wallet IDs (like "wallet-1", "bundle-1") to actual addresses
  // and applies the configs to the auto-sell system
  mapAndApplyAutoSellConfigs(configData, walletAddresses) {
    let appliedCount = 0;
    const { holderWalletAddresses = [], bundleWalletAddresses = [], devWalletAddress = null } = walletAddresses;
    
    // Map holder wallet configs
    if (configData.holderWalletAutoSellConfigs) {
      for (const [walletId, config] of Object.entries(configData.holderWalletAutoSellConfigs)) {
        if (!config.enabled || parseFloat(config.threshold) <= 0) continue;
        
        let walletAddress = null;
        
        // Check if walletId is already an address (for warmed wallets)
        if (walletId.length > 40) {
          walletAddress = walletId;
        } else if (walletId.startsWith('wallet-')) {
          // Fresh wallet by index (wallet-1, wallet-2, etc.)
          const index = parseInt(walletId.replace('wallet-', '')) - 1;
          if (index >= 0 && index < holderWalletAddresses.length) {
            walletAddress = holderWalletAddresses[index];
          }
        } else if (walletId.startsWith('holder-new-')) {
          // Additional holder wallet
          const index = parseInt(walletId.replace('holder-new-', '')) - 1;
          if (index >= 0 && index < holderWalletAddresses.length) {
            walletAddress = holderWalletAddresses[index];
          }
        }
        
        if (walletAddress) {
          this.configureAutoSell(walletAddress, config.threshold, config.enabled);
          appliedCount++;
          console.log(`[PumpPortal AutoSell] ✅ Mapped ${walletId} → ${walletAddress.slice(0, 8)}... (threshold: ${config.threshold} SOL)`);
        } else {
          console.warn(`[PumpPortal AutoSell] ⚠️  Could not map wallet ID: ${walletId}`);
        }
      }
    }
    
    // Map bundle wallet configs
    if (configData.bundleWalletAutoSellConfigs) {
      for (const [walletId, config] of Object.entries(configData.bundleWalletAutoSellConfigs)) {
        if (!config.enabled || parseFloat(config.threshold) <= 0) continue;
        
        let walletAddress = null;
        
        // Check if walletId is already an address (for warmed wallets)
        if (walletId.length > 40) {
          walletAddress = walletId;
        } else if (walletId.startsWith('bundle-')) {
          // Bundle wallet by index
          const index = parseInt(walletId.replace('bundle-', '')) - 1;
          if (index >= 0 && index < bundleWalletAddresses.length) {
            walletAddress = bundleWalletAddresses[index];
          }
        }
        
        if (walletAddress) {
          this.configureAutoSell(walletAddress, config.threshold, config.enabled);
          appliedCount++;
          console.log(`[PumpPortal AutoSell] ✅ Mapped ${walletId} → ${walletAddress.slice(0, 8)}... (threshold: ${config.threshold} SOL)`);
        } else {
          console.warn(`[PumpPortal AutoSell] ⚠️  Could not map bundle wallet ID: ${walletId}`);
        }
      }
    }
    
    // Apply DEV wallet config
    if (configData.devAutoSellConfig && devWalletAddress) {
      const devConfig = configData.devAutoSellConfig;
      if (devConfig.enabled && parseFloat(devConfig.threshold) > 0) {
        this.configureAutoSell(devWalletAddress, devConfig.threshold, devConfig.enabled);
        appliedCount++;
        console.log(`[PumpPortal AutoSell] ✅ Mapped DEV wallet → ${devWalletAddress.slice(0, 8)}... (threshold: ${devConfig.threshold} SOL)`);
      }
    }
    
    return appliedCount;
  }
  
  // Apply auto-sell configs from launch form (launch-auto-sell-config.json)
  // Can be called with explicit wallet addresses (for immediate application) or from currentRunData (for delayed application)
  applyLaunchAutoSellConfigs(currentRunData, explicitAddresses = null) {
    try {
      const autoSellConfigPath = path.join(__dirname, '..', 'keys', 'trade-configs', 'launch-auto-sell-config.json');
      if (!fs.existsSync(autoSellConfigPath)) return;
      
      const configData = JSON.parse(fs.readFileSync(autoSellConfigPath, 'utf8'));
      
      // Map wallet IDs/indices to actual addresses
      // Use explicit addresses if provided (for immediate application), otherwise use currentRunData
      const walletAddresses = {
        holderWalletAddresses: explicitAddresses?.holderWalletAddresses || currentRunData?.holderWalletAddresses || [],
        bundleWalletAddresses: explicitAddresses?.bundleWalletAddresses || currentRunData?.bundleWalletAddresses || [],
        devWalletAddress: explicitAddresses?.devWalletAddress || currentRunData?.devWalletAddress || currentRunData?.devWallet || currentRunData?.creatorWalletAddress
      };
      
      const appliedCount = this.mapAndApplyAutoSellConfigs(configData, walletAddresses);
      
      if (appliedCount > 0) {
        console.log(`[PumpPortal AutoSell] ✅ Applied ${appliedCount} auto-sell config(s) from launch form`);
      }
    } catch (e) {
      console.warn('[PumpPortal AutoSell] Failed to apply launch auto-sell configs:', e.message);
    }
  }
  
  // Inject dev buy trade from current-run.json (for Quick Launch mode)
  // This ensures the initial dev buy is captured even if it happened before tracking started
  injectDevBuyFromCurrentRun(data, mintAddress) {
    try {
      // Check multiple field names (devWalletAddress from old format, devWallet from Quick Launch)
      const devWallet = data.devWalletAddress || data.devWallet;
      const devBuyAmount = parseFloat(data.devBuyAmount) || 0;
      const txSig = data.buyTxSignature;
      
      if (!devWallet || devBuyAmount <= 0) return;
      
      // Check if we already have this trade in cache (avoid duplicates)
      const existingTrades = this.tradeCache.get(mintAddress) || [];
      const alreadyExists = existingTrades.some(t => {
        const existingSig = t.fullSignature || t.signature;
        // Match by signature OR by wallet+amount (for synthetic trades)
        return existingSig === txSig || 
          ((t.traderPublicKey || t.fullTrader) === devWallet && 
           (t.txType === 'buy' || t.type === 'buy') && 
           Math.abs(t.solAmount - devBuyAmount) < 0.001);
      });
      
      if (alreadyExists) {
        console.log(`[PumpPortal] 📋 Dev buy already tracked for ${devWallet.slice(0, 8)}...`);
        return;
      }
      
      // Create synthetic trade record for the dev buy
      const fullSig = txSig || `synthetic-devbuy-${Date.now()}`;
      const syntheticTrade = {
        signature: fullSig.slice(0, 8) + '...',
        fullSignature: fullSig,
        mint: mintAddress,
        traderPublicKey: devWallet,
        fullTrader: devWallet,
        trader: devWallet.slice(0, 4) + '...' + devWallet.slice(-4),
        type: 'buy',
        txType: 'buy',
        solAmount: devBuyAmount,
        amount: 0, // Unknown without fetching
        tokenAmount: 0, // Unknown without fetching
        newTokenBalance: 0,
        bondingCurveKey: '',
        vTokensInBondingCurve: 0,
        vSolInBondingCurve: 0,
        marketCapSol: 0,
        marketCap: 0,
        timestamp: data.launchTime ? new Date(data.launchTime).getTime() : Date.now(),
        isOurWallet: true,
        walletType: 'DEV',
        walletLabel: 'DEV',
        injected: true, // Mark as injected from current-run.json
      };
      
      // Add to cache using centralized method (handles deduplication)
      this.addTradeToCache(mintAddress, syntheticTrade);
      
      console.log(`[PumpPortal] 💉 Injected dev buy: ${devBuyAmount} SOL from ${devWallet.slice(0, 8)}...`);
      
      // Update P&L for this wallet
      const addrLower = devWallet.toLowerCase();
      if (this.ourWallets.has(addrLower)) {
        const profits = this.walletProfits.get(addrLower) || { buys: 0, sells: 0, fees: 0, profit: 0 };
        profits.buys += devBuyAmount;
        // Estimate fees (1% pump fee + ~0.0001 SOL priority fee)
        const pumpFee = devBuyAmount * 0.01;
        const priorityFee = 0.0001;
        profits.fees += pumpFee + priorityFee;
        profits.profit = profits.sells - profits.buys - profits.fees;
        this.walletProfits.set(addrLower, profits);
        console.log(`[PumpPortal] 📊 Updated DEV P&L: buys=${profits.buys.toFixed(4)}, fees=${profits.fees.toFixed(4)}, profit=${profits.profit.toFixed(4)}`);
      }
      
      // Save to disk
      this.saveTradeHistory(mintAddress);
      
    } catch (e) {
      console.warn('[PumpPortal] Error injecting dev buy:', e.message);
    }
  }
  
  // Inject any trade manually (used for Jupiter sells which don't appear on PumpPortal WebSocket)
  injectTrade(tradeData) {
    try {
      const { signature, mint, traderPublicKey, txType, solAmount, tokenAmount, timestamp, source } = tradeData;
      
      if (!mint || !traderPublicKey || !txType) {
        console.warn('[PumpPortal] injectTrade missing required fields');
        return;
      }
      
      const mintAddress = mint;
      
      // Check if we already have this trade
      const existingTrades = this.tradeCache.get(mintAddress) || [];
      const alreadyExists = existingTrades.some(t => 
        (t.fullSignature || t.signature) === signature
      );
      
      if (alreadyExists) {
        console.log(`[PumpPortal] 📋 Trade already tracked: ${signature?.slice(0, 12)}...`);
        return;
      }
      
      // Create trade record (consistent with PumpPortal format)
      const fullSig = signature || `injected-${Date.now()}`;
      const trade = {
        signature: fullSig.slice(0, 8) + '...',
        fullSignature: fullSig,
        mint: mintAddress,
        mintAddress: mintAddress,
        traderPublicKey,
        fullTrader: traderPublicKey,
        trader: traderPublicKey?.slice(0, 4) + '...' + traderPublicKey?.slice(-4),
        type: txType,
        txType,
        solAmount: parseFloat(solAmount) || 0,
        amount: parseFloat(tokenAmount) || 0,
        tokenAmount: parseFloat(tokenAmount) || 0,
        newTokenBalance: 0,
        bondingCurveKey: '',
        vTokensInBondingCurve: 0,
        vSolInBondingCurve: 0,
        marketCapSol: 0,
        marketCap: 0,
        timestamp: timestamp || Date.now(),
        isOurWallet: this.ourWallets.has(traderPublicKey?.toLowerCase()),
        walletType: this.walletTypes.get(traderPublicKey?.toLowerCase()) || 'Unknown',
        walletLabel: this.walletLabels.get(traderPublicKey?.toLowerCase()) || 'Unknown',
        injected: true,
        source: source || 'manual',
      };
      
      // Use addTradeToCache for consistency (handles deduplication)
      this.addTradeToCache(mintAddress, trade);
      
      console.log(`[PumpPortal] 💉 Injected ${txType} trade: ${solAmount} SOL from ${traderPublicKey?.slice(0, 8)}... (${source})`);
      
      // Update P&L if this is our wallet
      const addrLower = traderPublicKey?.toLowerCase();
      if (this.ourWallets.has(addrLower)) {
        const profits = this.walletProfits.get(addrLower) || { buys: 0, sells: 0, fees: 0, profit: 0 };
        const sol = parseFloat(solAmount) || 0;
        const TRADING_FEE_PERCENT = 0.01;
        const txFee = 0.0001;
        
        if (txType === 'buy') {
          profits.buys += sol * (1 + TRADING_FEE_PERCENT);
          profits.fees += txFee;
        } else if (txType === 'sell') {
          profits.sells += sol * (1 - TRADING_FEE_PERCENT);
          profits.fees += txFee;
        }
        profits.profit = profits.sells - profits.buys - profits.fees;
        this.walletProfits.set(addrLower, profits);
        console.log(`[PumpPortal] 📊 Updated P&L for ${addrLower.slice(0, 8)}...: profit=${profits.profit.toFixed(4)} SOL`);
      }
      
      // Save to disk
      this.saveTradeHistory(mintAddress);
      
      // Notify listeners (same as regular trade processing)
      this.notifyListeners(trade);
      
    } catch (e) {
      console.warn('[PumpPortal] Error injecting trade:', e.message);
    }
  }
  
  // Load our wallets from current run data (matches LiveTrades logic exactly)
  loadOurWallets(data) {
    console.log('[PumpPortal] 🔄 loadOurWallets called...');
    this.ourWallets.clear();
    this.walletTypes.clear();
    this.walletLabels.clear();
    this.walletProfits.clear(); // Reset profit tracking for new token
    
    // Helper function to derive address from key (base58 or base64) - COPIED FROM LiveTrades
    const deriveAddress = (key, label) => {
      if (!key || typeof key !== 'string') {
        console.warn(`[PumpPortal] ⚠️ Invalid key for ${label}: ${typeof key}`);
        return null;
      }
      try {
        // Handle bs58 v6 export format (same as live-trades-tracker)
        const base58 = require('bs58').default || require('bs58');
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
        const addr = keypair.publicKey.toString();
        console.log(`[PumpPortal] 🔑 Derived ${label}: ${addr.slice(0, 8)}...`);
        return addr;
      } catch (e) {
        console.error(`[PumpPortal] ❌ Error deriving ${label}: ${e.message}`);
        return null;
      }
    };
    
    const addWallet = (address, type) => {
      if (address && typeof address === 'string' && address.length > 20) {
        const addrLower = address.toLowerCase();
        if (!this.ourWallets.has(addrLower)) {
          this.ourWallets.add(addrLower);
          this.walletTypes.set(addrLower, type);
          
          // Auto-number wallets: count how many of this type already exist
          let walletLabel = type;
          if (type === 'Holder' || type === 'Bundle') {
            const existingCount = Array.from(this.walletTypes.values()).filter(t => t === type).length;
            walletLabel = `${type} ${existingCount}`;
          }
          this.walletLabels.set(addrLower, walletLabel);
          
          // Initialize profit tracking (including fees)
          this.walletProfits.set(addrLower, { buys: 0, sells: 0, fees: 0, profit: 0 });
          
          console.log(`[PumpPortal]   Added ${walletLabel}: ${address.slice(0, 8)}...`);
        }
      }
    };
    
    // 1. Load from current-run.json (passed in as data)
    console.log(`[PumpPortal] 📂 Processing current-run.json data...`);
    
    // DEV wallet from creatorDevWalletKey
    if (data.creatorDevWalletKey) {
      addWallet(deriveAddress(data.creatorDevWalletKey, 'DEV-key'), 'DEV');
    }
    if (data.devWalletAddress) {
      addWallet(data.devWalletAddress, 'DEV');
    }
    // Also check 'devWallet' field (used by Quick Launch)
    if (data.devWallet) {
      addWallet(data.devWallet, 'DEV');
    }
    
    // Bundle wallets (auto-numbered: Bundle 1, Bundle 2, etc.)
    if (data.bundleWalletKeys && Array.isArray(data.bundleWalletKeys)) {
      data.bundleWalletKeys.forEach((key, i) => {
        addWallet(deriveAddress(key, `Bundle-key-${i}`), 'Bundle');
      });
    }
    if (data.bundleWalletAddresses && Array.isArray(data.bundleWalletAddresses)) {
      data.bundleWalletAddresses.forEach(addr => addWallet(addr, 'Bundle'));
    }
    
    // Holder wallets (auto-numbered: Holder 1, Holder 2, etc.)
    if (data.holderWalletKeys && Array.isArray(data.holderWalletKeys)) {
      data.holderWalletKeys.forEach((key, i) => {
        addWallet(deriveAddress(key, `Holder-key-${i}`), 'Holder');
      });
    }
    if (data.holderWalletAddresses && Array.isArray(data.holderWalletAddresses)) {
      data.holderWalletAddresses.forEach(addr => addWallet(addr, 'Holder'));
    }
    
    if (data.creatorWalletAddress) {
      addWallet(data.creatorWalletAddress, 'DEV');
    }
    
    // 2. Load from warmed-wallets-for-launch.json
    try {
      const warmedWalletsPath = path.join(this.configDir, 'warmed-wallets-for-launch.json');
      if (fs.existsSync(warmedWalletsPath)) {
        console.log(`[PumpPortal] 📂 Found warmed-wallets-for-launch.json`);
        const warmedData = JSON.parse(fs.readFileSync(warmedWalletsPath, 'utf8'));
        
        if (warmedData.creatorWalletKey) {
          addWallet(deriveAddress(warmedData.creatorWalletKey, 'Warmed-DEV'), 'DEV');
        }
        if (warmedData.creatorWalletAddress) {
          addWallet(warmedData.creatorWalletAddress, 'DEV');
        }
        
        if (warmedData.bundleWalletKeys && Array.isArray(warmedData.bundleWalletKeys)) {
          warmedData.bundleWalletKeys.forEach((key, i) => {
            addWallet(deriveAddress(key, `Warmed-Bundle-${i}`), 'Bundle');
          });
        }
        if (warmedData.bundleWalletAddresses && Array.isArray(warmedData.bundleWalletAddresses)) {
          warmedData.bundleWalletAddresses.forEach(addr => addWallet(addr, 'Bundle'));
        }
        
        if (warmedData.holderWalletKeys && Array.isArray(warmedData.holderWalletKeys)) {
          warmedData.holderWalletKeys.forEach((key, i) => {
            addWallet(deriveAddress(key, `Warmed-Holder-${i}`), 'Holder');
          });
        }
        if (warmedData.holderWalletAddresses && Array.isArray(warmedData.holderWalletAddresses)) {
          warmedData.holderWalletAddresses.forEach(addr => addWallet(addr, 'Holder'));
        }
      }
    } catch (err) {
      console.error(`[PumpPortal] ❌ Error loading warmed wallets: ${err.message}`);
    }
    
    // 3. Load FUNDING wallet from PRIVATE_KEY in .env
    try {
      const envPath = path.join(this.configDir, '..', '.env');
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const match = envContent.match(/^PRIVATE_KEY\s*=\s*["']?([^"'\n]+)["']?/m);
        if (match && match[1]) {
          const privateKey = match[1].trim();
          const fundingAddr = deriveAddress(privateKey, 'FUNDING');
          if (fundingAddr) {
            addWallet(fundingAddr, 'FUNDING');
          }
        } else {
          console.warn(`[PumpPortal] ⚠️ No PRIVATE_KEY found in .env`);
        }
      } else {
        console.warn(`[PumpPortal] ⚠️ .env file not found`);
      }
    } catch (error) {
      console.error('[PumpPortal] ❌ Could not load FUNDING wallet:', error.message);
    }
    
    // Debug logging (same format as LiveTrades)
    const fundingCount = Array.from(this.walletTypes.values()).filter(t => t === 'FUNDING').length;
    const devCount = Array.from(this.walletTypes.values()).filter(t => t === 'DEV').length;
    const bundleCount = Array.from(this.walletTypes.values()).filter(t => t === 'Bundle').length;
    const holderCount = Array.from(this.walletTypes.values()).filter(t => t === 'Holder').length;
    
    console.log(`[PumpPortal] ✅ Loaded ${this.ourWallets.size} wallet(s) for tracking:`);
    if (fundingCount > 0) console.log(`[PumpPortal]   - FUNDING: ${fundingCount}`);
    if (devCount > 0) console.log(`[PumpPortal]   - DEV: ${devCount}`);
    if (bundleCount > 0) console.log(`[PumpPortal]   - Bundle: ${bundleCount}`);
    if (holderCount > 0) console.log(`[PumpPortal]   - Holder: ${holderCount}`);
  }
  
  // Stop auto-tracking
  stopAutoTracking() {
    if (this.autoTrackInterval) {
      clearInterval(this.autoTrackInterval);
      this.autoTrackInterval = null;
    }
  }

  // Connect to PumpPortal WebSocket
  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      console.log('[PumpPortal] Already connected or connecting');
      return;
    }

    console.log('[PumpPortal] 🔌 Connecting to wss://pumpportal.fun/api/data...');
    
    this.ws = new WebSocket('wss://pumpportal.fun/api/data');

    this.ws.on('open', () => {
      console.log('[PumpPortal] ✅ Connected to PumpPortal WebSocket');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.lastPongTime = Date.now();

      // Start ping/pong keepalive
      this.startPingPong();
      
      // Start health check
      this.startHealthCheck();

      // Re-subscribe to any tokens we were tracking
      for (const mint of this.subscribedTokens) {
        this.sendSubscribe('subscribeTokenTrade', [mint]);
      }
      for (const account of this.subscribedAccounts) {
        this.sendSubscribe('subscribeAccountTrade', [account]);
      }
    });
    
    this.ws.on('pong', () => {
      this.lastPongTime = Date.now();
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        console.error('[PumpPortal] Error parsing message:', error.message);
      }
    });

    this.ws.on('error', (error) => {
      console.error('[PumpPortal] ❌ WebSocket error:', error.message);
    });

    this.ws.on('close', () => {
      console.log('[PumpPortal] WebSocket closed');
      this.isConnected = false;
      
      // Stop ping/pong and health check
      this.stopPingPong();
      this.stopHealthCheck();
      
      // ALWAYS reconnect with capped exponential backoff
      this.reconnectAttempts++;
      const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), this.maxReconnectDelay);
      console.log(`[PumpPortal] Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${this.reconnectAttempts})...`);
      setTimeout(() => this.connect(), delay);
    });
  }
  
  // Ping/pong keepalive to detect dead connections
  startPingPong() {
    this.stopPingPong(); // Clear any existing interval
    
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
        
        // Check if we got a pong recently (within 30 seconds)
        const timeSinceLastPong = Date.now() - this.lastPongTime;
        if (timeSinceLastPong > 30000) {
          console.warn('[PumpPortal] ⚠️ No pong received in 30s, reconnecting...');
          this.ws.terminate();
        }
      }
    }, 15000); // Ping every 15 seconds
  }
  
  stopPingPong() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
  
  // Health check to ensure we're connected
  startHealthCheck() {
    this.stopHealthCheck(); // Clear any existing interval
    
    this.healthCheckInterval = setInterval(() => {
      if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        console.warn('[PumpPortal] ⚠️ Health check failed, reconnecting...');
        this.connect();
      }
    }, 60000); // Check every 60 seconds
  }
  
  stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  // Send subscribe message (internal)
  sendSubscribe(method, keys = null) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[PumpPortal] Cannot subscribe - not connected');
      return false;
    }

    const payload = { method };
    if (keys) {
      payload.keys = keys;
    }

    console.log(`[PumpPortal] 📡 Sending: ${JSON.stringify(payload)}`);
    this.ws.send(JSON.stringify(payload));
    return true;
  }

  // Subscribe to token trades
  subscribeToToken(mintAddress) {
    if (!mintAddress) {
      console.error('[PumpPortal] No mint address provided');
      return false;
    }

    // Add to our tracking set
    this.subscribedTokens.add(mintAddress);
    this.currentMintAddress = mintAddress;
    
    // Clear deduplication set for fresh tracking
    // Keep entries for current mint, clear others
    const keysToKeep = [];
    for (const key of this.recordedTrades) {
      if (key.startsWith(mintAddress + ':')) {
        keysToKeep.push(key);
      }
    }
    this.recordedTrades.clear();
    for (const key of keysToKeep) {
      this.recordedTrades.add(key);
    }

    // Initialize cache for this mint - load from disk first!
    if (!this.tradeCache.has(mintAddress)) {
      // Try to load historical trades from disk
      const historicalTrades = this.loadTradeHistory(mintAddress);
      this.tradeCache.set(mintAddress, historicalTrades);
      
      if (historicalTrades.length > 0) {
        // Recalculate P&L from historical trades (using current wallet list)
        this.recalculateProfitsFromCache();
      }
    }

    // Send subscribe if connected
    if (this.isConnected) {
      return this.sendSubscribe('subscribeTokenTrade', [mintAddress]);
    } else {
      console.log('[PumpPortal] Not connected yet, will subscribe when connected');
      return true;
    }
  }

  // Unsubscribe from token trades
  unsubscribeFromToken(mintAddress) {
    if (!mintAddress) return false;

    this.subscribedTokens.delete(mintAddress);

    if (this.isConnected) {
      return this.sendSubscribe('unsubscribeTokenTrade', [mintAddress]);
    }
    return true;
  }

  // Subscribe to account trades
  subscribeToAccount(accountAddress) {
    if (!accountAddress) return false;

    this.subscribedAccounts.add(accountAddress);

    if (this.isConnected) {
      return this.sendSubscribe('subscribeAccountTrade', [accountAddress]);
    }
    return true;
  }

  // Unsubscribe from account trades
  unsubscribeFromAccount(accountAddress) {
    if (!accountAddress) return false;

    this.subscribedAccounts.delete(accountAddress);

    if (this.isConnected) {
      return this.sendSubscribe('unsubscribeAccountTrade', [accountAddress]);
    }
    return true;
  }

  // Handle incoming messages
  handleMessage(message) {
    // PumpPortal sends trade data directly
    if (message.txType) {
      this.handleTrade(message);
    } else if (message.message) {
      // Status/info messages
      console.log(`[PumpPortal] 📨 ${message.message}`);
    } else {
      // Unknown message type - log for debugging
      console.log('[PumpPortal] 📨 Unknown message:', JSON.stringify(message).slice(0, 200));
    }
  }

  // Handle trade message
  handleTrade(trade) {
    // Extract data from PumpPortal format
    const {
      signature,
      mint,
      traderPublicKey,
      txType,        // "buy", "sell", "create", "migrate"
      tokenAmount,   // Could be named differently
      buy,           // Token amount bought
      sell,          // Token amount sold  
      solAmount,     // Primary field name
      sol_amount,    // Alternative field name (snake_case)
      amount,        // Generic amount field
      sol,           // Short name
      vTokensInBondingCurve,
      vSolInBondingCurve,
      marketCapSol,
      pool,
      timestamp,
      newTokenBalance,
    } = trade;
    
    // Get SOL amount from API - check multiple possible field names
    const apiSolAmount = solAmount || sol_amount || amount || sol || 0;
    
    // Debug: Log raw PumpPortal data if amount seems suspiciously low for a buy
    if (txType === 'buy' && apiSolAmount > 0 && apiSolAmount < 0.1) {
      console.log(`[PumpPortal] ⚠️  Low SOL amount detected. Raw trade data:`, JSON.stringify({
        solAmount,
        sol_amount,
        amount,
        sol,
        buy,
        sell,
        tokenAmount,
        txType,
        signature: signature?.slice(0, 12),
        trader: traderPublicKey?.slice(0, 8)
      }, null, 2));
    }

    // Skip non-trade events for now
    if (txType !== 'buy' && txType !== 'sell') {
      console.log(`[PumpPortal] 📋 Event: ${txType} for ${mint?.slice(0, 8)}...`);
      return;
    }
    
    // DEDUPLICATION: Use FULL signature to prevent duplicate trades (same transaction)
    // This allows multiple buys/sells from the same wallet to be tracked correctly
    // Only skip if we've seen this EXACT signature before (same transaction)
    const fullSignature = signature || null;
    const dedupeKey = fullSignature ? `${mint}:${fullSignature}` : `${mint}:${traderPublicKey?.toLowerCase()}:${txType}:${timestamp || Date.now()}:${Math.random()}`;
    
    // Only skip if we've seen this EXACT signature (prevent double-processing same transaction)
    // Different transactions from same wallet will have different signatures = all tracked ✅
    if (fullSignature && this.recordedTrades.has(dedupeKey)) {
      // Already recorded this exact transaction (same signature) - skip duplicate
      console.log(`[PumpPortal] ⏭️  Skipping duplicate transaction (signature: ${fullSignature.slice(0, 12)}...)`);
      return;
    }
    
    // Mark this transaction as recorded
    this.recordedTrades.add(dedupeKey);
    
    // Prevent memory leak: Clean up old entries periodically (keep ALL for current mint, trim others)
    // IMPORTANT: Keep ALL signatures for current mint to prevent duplicates
    // Only clean up entries from OTHER mints (old tokens we're not tracking anymore)
    if (this.recordedTrades.size > 20000) {
      const currentMintKeys = Array.from(this.recordedTrades).filter(k => k.startsWith(`${mint}:`));
      const otherMintKeys = Array.from(this.recordedTrades).filter(k => !k.startsWith(`${mint}:`));
      
      this.recordedTrades.clear();
      // Keep ALL entries for current mint (prevent any duplicates)
      currentMintKeys.forEach(k => this.recordedTrades.add(k));
      // Keep only recent entries for other mints (last 5000 to save memory)
      otherMintKeys.slice(-5000).forEach(k => this.recordedTrades.add(k));
      
      console.log(`[PumpPortal] 🧹 Cleaned up recordedTrades: kept ${currentMintKeys.length} for current mint, ${Math.min(otherMintKeys.length, 5000)} for others`);
    }

    // Calculate token amount (PumpPortal uses 'buy' and 'sell' fields)
    const tokenAmt = txType === 'buy' ? (buy || tokenAmount || 0) : (sell || tokenAmount || 0);

    // Check if this is our wallet
    const traderLower = traderPublicKey?.toLowerCase();
    const isOurWallet = this.ourWallets.has(traderLower);
    const walletType = isOurWallet ? (this.walletTypes.get(traderLower) || 'Unknown') : null;
    const walletLabel = isOurWallet ? (this.walletLabels.get(traderLower) || walletType) : null;
    
    // Track profit for our wallets (with fees applied)
    let walletProfit = null;
    if (isOurWallet && traderLower) {
      const profitData = this.walletProfits.get(traderLower) || { buys: 0, sells: 0, fees: 0, profit: 0 };
      const sol = apiSolAmount;
      
      // Constants for fees (matching frontend calculation)
      const TRADING_FEE_PERCENT = 0.01; // 1% Pump.fun fee on buys and sells
      
      // Solana transaction fees (estimated per transaction)
      // These are costs that reduce your actual balance but aren't tracked in trade amounts
      const JITO_TIP_PER_TX = 0.001;        // From .env JITO_FEE (for bundle transactions)
      const PRIORITY_FEE_PER_TX = 0.001;    // Average priority fee (varies by setting)
      const SOLANA_BASE_FEE = 0.000005;     // Base Solana transaction fee
      const TOKEN_ACCOUNT_RENT = 0.002;     // One-time rent for new token account
      
      // Estimate transaction fee based on wallet type
      let txFee = SOLANA_BASE_FEE;
      if (walletType === 'DEV' || walletType === 'Bundle') {
        // Bundle/Jito transactions
        txFee += JITO_TIP_PER_TX;
      } else if (walletType?.includes('Holder')) {
        // Holder wallets use priority fees
        txFee += PRIORITY_FEE_PER_TX;
      } else {
        // Default to medium priority fee
        txFee += PRIORITY_FEE_PER_TX;
      }
      
      // Add token account creation cost for first buy (one-time)
      const isFirstBuy = txType === 'buy' && profitData.buys === 0;
      if (isFirstBuy) {
        txFee += TOKEN_ACCOUNT_RENT;
      }
      
      if (txType === 'buy') {
        // For buys: add 1% fee + transaction fees
        profitData.buys += sol * (1 + TRADING_FEE_PERCENT);
        profitData.fees += txFee;
      } else if (txType === 'sell') {
        // For sells: subtract 1% fee, add transaction fees
        profitData.sells += sol * (1 - TRADING_FEE_PERCENT);
        profitData.fees += txFee;
      }
      
      // Net P&L = sells - buys - all transaction fees
      profitData.profit = profitData.sells - profitData.buys - profitData.fees;
      this.walletProfits.set(traderLower, profitData);
      walletProfit = profitData.profit;
      
      const profitEmoji = profitData.profit >= 0 ? '📈' : '📉';
      console.log(`[PumpPortal] ${profitEmoji} ${walletLabel} P&L: ${profitData.profit >= 0 ? '+' : ''}${profitData.profit.toFixed(4)} SOL (buys: ${profitData.buys.toFixed(4)}, sells: ${profitData.sells.toFixed(4)}, fees: ${profitData.fees.toFixed(4)})`);
    }

    // Format trade object for frontend
    // IMPORTANT: Store FULL signature (not truncated) for proper deduplication
    const formattedTrade = {
      signature: signature ? (signature.length > 8 ? signature.slice(0, 8) + '...' : signature) : 'unknown',
      fullSignature: signature || null, // Store FULL signature for deduplication
      mintAddress: mint,
      type: txType,  // Already "buy" or "sell" - no parsing needed!
      trader: traderPublicKey?.slice(0, 4) + '...' + traderPublicKey?.slice(-4),
      fullTrader: traderPublicKey,
      solAmount: apiSolAmount,
      amount: tokenAmt,
      tokenAmount: tokenAmt,
      marketCap: marketCapSol ? marketCapSol * this.getSolPrice() : null, // Real-time USD
      marketCapSol: marketCapSol,
      solPrice: this.getSolPrice(), // Include current SOL price
      timestamp: timestamp || Date.now(),
      age: Math.floor((Date.now() - (timestamp || Date.now())) / 60000),
      isOurWallet: isOurWallet,
      walletType: walletType,
      walletLabel: walletLabel, // e.g., "Holder 1", "Holder 2"
      walletProfit: walletProfit, // Current P&L for this wallet
      source: 'pumpportal', // Mark source for comparison
      pool: pool,
      newTokenBalance: newTokenBalance,
    };

    // Log the trade
    const emoji = txType === 'buy' ? '🟢' : '🔴';
    const walletInfo = isOurWallet ? ` [${walletLabel}]` : '';
    
    // Debug: Log raw API data if solAmount is missing
    if (apiSolAmount === 0 && (solAmount === undefined || solAmount === null)) {
      console.log(`[PumpPortal] ⚠️ SELL with 0 solAmount from API. Raw trade data:`, JSON.stringify({
        solAmount,
        sol_amount,
        amount,
        sol,
        txType,
        signature: signature?.slice(0, 8)
      }).slice(0, 300));
    }
    
    console.log(`[PumpPortal] ${emoji} ${txType.toUpperCase()} | ${apiSolAmount.toFixed(4)} SOL | ${traderPublicKey?.slice(0, 8)}...${walletInfo}`);

    // Add to cache
    this.addTradeToCache(mint, formattedTrade);

    // Track external volume for auto-sell
    this.trackExternalVolume(formattedTrade);

    // Notify all listeners
    this.notifyListeners(formattedTrade);
  }

  // Add trade to cache (memory + disk)
  addTradeToCache(mint, trade) {
    if (!mint) return;

    if (!this.tradeCache.has(mint)) {
      this.tradeCache.set(mint, []);
    }

    const cache = this.tradeCache.get(mint);
    
    // Get the full signature for this trade (handle both field names)
    const tradeSig = trade.fullSignature || trade.signature;
    const tradeTrader = trade.fullTrader?.toLowerCase();
    const tradeAmount = trade.solAmount || 0;
    const tradeTimestamp = trade.timestamp || Date.now();
    const tradeType = trade.type;
    
    // ENHANCED DEDUPLICATION: Check by signature first, then by wallet+amount+timestamp
    // This prevents duplicates even when signature format differs (e.g., real vs synthetic)
    const isDuplicate = cache.some(t => {
      // Check by signature (most reliable - exact match)
      if (tradeSig) {
        const existingSig = t.fullSignature || t.signature;
        if (existingSig && existingSig === tradeSig) {
          return true;
        }
      }
      
      // Check by wallet + amount + type + timestamp window (2 minutes)
      // This catches duplicates even if signature format differs (real vs synthetic)
      if (tradeTrader && tradeAmount > 0) {
        const existingTrader = t.fullTrader?.toLowerCase();
        const existingAmount = t.solAmount || 0;
        const existingType = t.type;
        const existingTimestamp = t.timestamp || 0;
        
        if (existingTrader === tradeTrader && 
            existingType === tradeType &&
            Math.abs(existingAmount - tradeAmount) < 0.01 && // Same amount (within 0.01 SOL tolerance)
            Math.abs(existingTimestamp - tradeTimestamp) < 120000) { // Within 2 minutes
          return true;
        }
      }
      
      return false;
    });
    
    if (isDuplicate) {
      // Silent return - duplicate already exists
      return;
    }
    
    // Add to beginning (newest first)
    cache.unshift(trade);

    // Trim to max size
    if (cache.length > this.maxTradesPerMint) {
      cache.length = this.maxTradesPerMint;
    }
    
    // Persist to disk (debounced)
    this.scheduleSaveToFile(mint);
  }
  
  // Bundle buys are now tracked exclusively via PumpPortal WebSocket
  
  // Debounce file saves (save at most every 2 seconds per mint)
  scheduleSaveToFile(mint) {
    if (!this.saveTimers) this.saveTimers = new Map();
    
    // Clear existing timer for this mint
    if (this.saveTimers.has(mint)) {
      clearTimeout(this.saveTimers.get(mint));
    }
    
    // Schedule save in 2 seconds
    const timer = setTimeout(() => {
      this.saveTradeHistory(mint);
      this.saveTimers.delete(mint);
    }, 2000);
    
    this.saveTimers.set(mint, timer);
  }
  
  // Save trade history to file
  saveTradeHistory(mint) {
    try {
      const trades = this.tradeCache.get(mint) || [];
      if (trades.length === 0) return;
      
      const filePath = path.join(this.tradeHistoryDir, `${mint}.json`);
      
      // Save with metadata
      const data = {
        mint: mint,
        savedAt: new Date().toISOString(),
        tradeCount: trades.length,
        trades: trades,
        // Summary stats for quick access
        stats: this.calculateTradeStats(trades),
      };
      
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      console.log(`[PumpPortal] 💾 Saved ${trades.length} trades for ${mint.slice(0, 8)}...`);
    } catch (error) {
      console.error(`[PumpPortal] Error saving trade history:`, error.message);
    }
  }
  
  // Load trade history from file
  loadTradeHistory(mint) {
    try {
      const filePath = path.join(this.tradeHistoryDir, `${mint}.json`);
      
      if (!fs.existsSync(filePath)) {
        return [];
      }
      
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      console.log(`[PumpPortal] 📂 Loaded ${data.tradeCount || data.trades?.length || 0} historical trades for ${mint.slice(0, 8)}...`);
      
      return data.trades || [];
    } catch (error) {
      console.error(`[PumpPortal] Error loading trade history:`, error.message);
      return [];
    }
  }
  
  // Calculate trade stats for pattern detection
  calculateTradeStats(trades) {
    if (!trades || trades.length === 0) return null;
    
    const buys = trades.filter(t => t.type === 'buy');
    const sells = trades.filter(t => t.type === 'sell');
    
    const totalBuyVolume = buys.reduce((sum, t) => sum + (t.solAmount || 0), 0);
    const totalSellVolume = sells.reduce((sum, t) => sum + (t.solAmount || 0), 0);
    
    const ourBuys = buys.filter(t => t.isOurWallet);
    const ourSells = sells.filter(t => t.isOurWallet);
    const externalBuys = buys.filter(t => !t.isOurWallet);
    const externalSells = sells.filter(t => !t.isOurWallet);
    
    return {
      totalTrades: trades.length,
      buyCount: buys.length,
      sellCount: sells.length,
      totalBuyVolume: totalBuyVolume,
      totalSellVolume: totalSellVolume,
      netVolume: totalBuyVolume - totalSellVolume,
      ourBuyCount: ourBuys.length,
      ourSellCount: ourSells.length,
      externalBuyCount: externalBuys.length,
      externalSellCount: externalSells.length,
      externalBuyVolume: externalBuys.reduce((sum, t) => sum + (t.solAmount || 0), 0),
      externalSellVolume: externalSells.reduce((sum, t) => sum + (t.solAmount || 0), 0),
      firstTradeTime: trades[trades.length - 1]?.timestamp,
      lastTradeTime: trades[0]?.timestamp,
    };
  }
  
  // Get trade stats for a mint (optionally filtered by time window)
  getTradeStats(mint, maxAgeSeconds = null) {
    let trades = this.getTrades(mint);
    
    // Filter by time window if specified
    if (maxAgeSeconds && maxAgeSeconds > 0) {
      const now = Date.now();
      const cutoffTime = now - (maxAgeSeconds * 1000);
      trades = trades.filter(t => {
        const tradeTime = t.timestamp || (t.age ? now - (t.age * 60000) : now);
        return tradeTime >= cutoffTime;
      });
    }
    
    return this.calculateTradeStats(trades);
  }
  
  // Recalculate external volume from historical trades (for restoring state after refresh)
  recalculateExternalVolume(trades) {
    // Reset volume
    this.externalNetVolume = 0;
    this.firstExternalTradeTime = null;
    
    // Replay trades (oldest first) to rebuild volume state
    const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);
    
    for (const trade of sortedTrades) {
      // Skip our wallet trades (except FUNDING for testing)
      const isFundingWallet = trade.walletType === 'FUNDING';
      if (trade.isOurWallet && !isFundingWallet) continue;
      
      // Track first external trade time
      if (!this.firstExternalTradeTime) {
        this.firstExternalTradeTime = trade.timestamp;
      }
      
      // Calculate net volume change
      const volumeChange = trade.type === 'buy' ? trade.solAmount : -trade.solAmount;
      this.externalNetVolume += volumeChange;
    }
    
    console.log(`[PumpPortal] 📊 Restored external volume: ${this.externalNetVolume.toFixed(4)} SOL from ${sortedTrades.length} historical trades`);
  }

  // Get cached trades for a mint
  getTrades(mintAddress) {
    if (!mintAddress) {
      return this.tradeCache.get(this.currentMintAddress) || [];
    }
    return this.tradeCache.get(mintAddress) || [];
  }

  // Clear cache for a mint
  clearCache(mintAddress) {
    if (mintAddress) {
      this.tradeCache.delete(mintAddress);
    } else {
      this.tradeCache.clear();
    }
  }

  // Register our wallets for highlighting
  setOurWallets(wallets, walletTypes) {
    const previousSize = this.ourWallets.size;
    this.ourWallets = new Set(wallets.map(w => w.toLowerCase()));
    this.walletTypes = new Map();
    for (const [addr, type] of Object.entries(walletTypes)) {
      this.walletTypes.set(addr.toLowerCase(), type);
    }
    console.log(`[PumpPortal] ✅ Registered ${this.ourWallets.size} wallet(s) for tracking`);
    
    // If wallets changed, recalculate P&L from stored trades
    if (this.ourWallets.size !== previousSize) {
      this.recalculateProfitsFromCache();
    }
  }
  
  // Recalculate all profits from cached trades (for retroactive wallet registration)
  recalculateProfitsFromCache() {
    console.log(`[PumpPortal] 🔄 Recalculating P&L from cached trades (${this.ourWallets.size} wallets registered)...`);
    
    // Reset all profit tracking
    this.walletProfits.clear();
    this.externalNetVolume = 0;
    this.firstExternalTradeTime = null;
    
    // Fee constants
    const TRADING_FEE_PERCENT = 0.01; // 1% Pump.fun fee
    const JITO_TIP_PER_TX = 0.001;        // From .env JITO_FEE
    const PRIORITY_FEE_PER_TX = 0.001;    // Average priority fee
    const SOLANA_BASE_FEE = 0.000005;     // Base Solana fee
    const TOKEN_ACCOUNT_RENT = 0.002;     // One-time rent for new token account
    
    let ourBuys = 0, ourSells = 0, totalFees = 0, externalBuys = 0, externalSells = 0;
    let tradeCount = 0;
    
    // Go through all cached trades for current mint
    if (this.currentMintAddress && this.tradeCache.has(this.currentMintAddress)) {
      const trades = this.tradeCache.get(this.currentMintAddress);
      tradeCount = trades.length;
      
      // Sort by timestamp to process in order
      const sortedTrades = [...trades].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      
      for (const trade of sortedTrades) {
        const traderLower = trade.fullTrader?.toLowerCase() || trade.trader?.toLowerCase();
        if (!traderLower) continue;
        
        const sol = trade.solAmount || 0;
        const txType = trade.txType || trade.type;
        const isOurs = this.ourWallets.has(traderLower);
        const walletType = this.walletTypes.get(traderLower);
        
        if (isOurs) {
          // Track profit for our wallets
          const profitData = this.walletProfits.get(traderLower) || { buys: 0, sells: 0, fees: 0, profit: 0 };
          
          // Estimate transaction fee based on wallet type
          let txFee = SOLANA_BASE_FEE;
          if (walletType === 'DEV' || walletType === 'Bundle') {
            txFee += JITO_TIP_PER_TX;
          } else {
            txFee += PRIORITY_FEE_PER_TX;
          }
          
          // Add token account creation cost for first buy
          const isFirstBuy = txType === 'buy' && profitData.buys === 0;
          if (isFirstBuy) {
            txFee += TOKEN_ACCOUNT_RENT;
          }
          
          if (txType === 'buy') {
            profitData.buys += sol * (1 + TRADING_FEE_PERCENT);
            profitData.fees += txFee;
            ourBuys += sol;
            totalFees += txFee;
          } else if (txType === 'sell') {
            profitData.sells += sol * (1 - TRADING_FEE_PERCENT);
            profitData.fees += txFee;
            ourSells += sol;
            totalFees += txFee;
          }
          
          profitData.profit = profitData.sells - profitData.buys - profitData.fees;
          this.walletProfits.set(traderLower, profitData);
        } else {
          // External trade
          if (!this.firstExternalTradeTime && trade.timestamp) {
            this.firstExternalTradeTime = trade.timestamp;
          }
          if (txType === 'buy') {
            this.externalNetVolume += sol;
            externalBuys += sol;
          } else if (txType === 'sell') {
            this.externalNetVolume -= sol;
            externalSells += sol;
          }
        }
      }
    }
    
    const totalOurProfit = ourSells * (1 - TRADING_FEE_PERCENT) - ourBuys * (1 + TRADING_FEE_PERCENT) - totalFees;
    console.log(`[PumpPortal] ✅ Recalculated ${tradeCount} trades:`);
    console.log(`[PumpPortal]    Ours: buys=${ourBuys.toFixed(3)} sells=${ourSells.toFixed(3)} fees=${totalFees.toFixed(4)} P&L=${totalOurProfit.toFixed(3)}`);
    console.log(`[PumpPortal]    External: buys=${externalBuys.toFixed(3)} sells=${externalSells.toFixed(3)} net=${this.externalNetVolume.toFixed(3)}`);
    
    // Debug: List our wallet P&Ls
    if (this.walletProfits.size > 0) {
      console.log(`[PumpPortal] 💰 Wallet breakdown:`);
      for (const [addr, data] of this.walletProfits) {
        const label = this.walletLabels.get(addr) || addr.slice(0, 8);
        console.log(`[PumpPortal]    ${label}: buys=${data.buys.toFixed(3)} sells=${data.sells.toFixed(3)} fees=${data.fees.toFixed(4)} profit=${data.profit.toFixed(3)}`);
      }
    }
  }
  
  // Get wallet profits for all tracked wallets (including fees)
  getWalletProfits() {
    const result = [];
    for (const [addr, profitData] of this.walletProfits) {
      const label = this.walletLabels.get(addr) || 'Unknown';
      const type = this.walletTypes.get(addr) || 'Unknown';
      result.push({
        address: addr,
        label: label,
        type: type,
        buys: profitData.buys,
        sells: profitData.sells,
        fees: profitData.fees || 0,
        profit: profitData.profit,
      });
    }
    // Sort by label (FUNDING first, then DEV, then Bundle 1, 2, then Holder 1, 2, 3)
    const typeOrder = { 'FUNDING': 0, 'DEV': 1, 'Bundle': 2, 'Holder': 3 };
    result.sort((a, b) => {
      const orderA = typeOrder[a.type] ?? 99;
      const orderB = typeOrder[b.type] ?? 99;
      if (orderA !== orderB) return orderA - orderB;
      return a.label.localeCompare(b.label);
    });
    return result;
  }

  // Add SSE listener
  addListener(res) {
    this.listeners.push(res);
    
    // Send cached trades for current mint
    const trades = this.getTrades(this.currentMintAddress);
    for (const trade of trades) {
      this.sendToListener(res, trade);
    }

    console.log(`[PumpPortal] 👂 Added listener (${this.listeners.length} total)`);
  }

  // Remove SSE listener
  removeListener(res) {
    this.listeners = this.listeners.filter(l => l !== res);
    console.log(`[PumpPortal] 👋 Removed listener (${this.listeners.length} remaining)`);
  }

  // Add trade callback (for internal services)
  addTradeCallback(callback) {
    if (typeof callback === 'function') {
      this.tradeCallbacks.push(callback);
      console.log(`[PumpPortal] 📡 Added trade callback (${this.tradeCallbacks.length} total)`);
    }
  }

  // Remove trade callback
  removeTradeCallback(callback) {
    this.tradeCallbacks = this.tradeCallbacks.filter(cb => cb !== callback);
    console.log(`[PumpPortal] ✖ Removed trade callback (${this.tradeCallbacks.length} remaining)`);
  }

  // Notify all trade callbacks
  notifyTradeCallbacks(trade) {
    for (const callback of this.tradeCallbacks) {
      try {
        callback(trade);
      } catch (err) {
        console.error('[PumpPortal] Trade callback error:', err.message);
      }
    }
  }

  // Notify all listeners
  notifyListeners(trade) {
    for (const res of this.listeners) {
      this.sendToListener(res, trade);
    }
    // Also notify trade callbacks (for internal services like trend detector)
    this.notifyTradeCallbacks(trade);
  }

  // Send to single listener
  sendToListener(res, trade) {
    try {
      res.write(`data: ${JSON.stringify(trade)}\n\n`);
    } catch (error) {
      console.error('[PumpPortal] Error sending to listener:', error.message);
      this.removeListener(res);
    }
  }

  // Get connection status
  getStatus() {
    return {
      connected: this.isConnected,
      subscribedTokens: Array.from(this.subscribedTokens),
      subscribedAccounts: Array.from(this.subscribedAccounts),
      listenersCount: this.listeners.length,
      currentMint: this.currentMintAddress,
      cachedTrades: this.tradeCache.size,
    };
  }

  // Disconnect
  disconnect() {
    this.stopPingPong();
    this.stopHealthCheck();
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.subscribedTokens.clear();
    this.subscribedAccounts.clear();
    console.log('[PumpPortal] 🔌 Disconnected');
  }
}

// Singleton instance
const pumpPortalTracker = new PumpPortalTracker();

module.exports = pumpPortalTracker;
