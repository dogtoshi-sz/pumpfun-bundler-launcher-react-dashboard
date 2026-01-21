/**
 * CLEAN P&L TRACKER
 * 
 * Simple, accurate profit/loss tracking with auto-sell/auto-buy support.
 * 
 * Philosophy:
 * - Record OUR trades when WE execute them (100% accurate)
 * - Track external trades from PumpPortal (for triggers)
 * - Calculate P&L with proper fee accounting
 * - Trigger auto-actions based on configurable parameters
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

// Fee constants
const FEES = {
  PUMP_FEE: 0.01,           // 1% pump.fun fee on buys AND sells
  JITO_TIP: 0.001,          // Jito bundle tip
  PRIORITY_FEE: 0.0005,     // Average priority fee
  BASE_FEE: 0.000005,       // Solana base tx fee
  TOKEN_ACCOUNT: 0.00203,   // One-time rent for token account
};

class PnLTracker extends EventEmitter {
  constructor() {
    super();
    
    // Paths - PnL files go in keys/pnl/ subdirectory
    this.dataDir = path.join(__dirname, '..', 'keys', 'pnl');
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    this.tradesFile = path.join(this.dataDir, 'pnl-trades.json');
    this.configFile = path.join(this.dataDir, 'pnl-config.json');
    
    // Current launch data
    this.currentMint = null;
    this.wallets = new Map();        // address -> { type, label, trades, pnl }
    this.walletsByLabel = new Map(); // label -> address
    
    // External volume tracking (for auto triggers)
    this.externalVolume = {
      buys: 0,
      sells: 0,
      net: 0,  // buys - sells
    };
    
    // Auto-sell configuration per wallet
    this.autoSellConfig = new Map(); // address -> { enabled, triggers }
    
    // Auto-buy configuration
    this.autoBuyConfig = {
      enabled: false,
      walletLabel: null,      // Which wallet to buy with
      triggers: {
        externalVolume: null, // Buy when external volume reaches X SOL
        priceDip: null,       // Buy when price drops X%
      },
      amount: 0,              // SOL amount to buy
      executed: false,        // Has it triggered?
    };
    
    // Sell executor function (set by control-panel)
    this.sellExecutor = null;
    this.buyExecutor = null;
    
    // Cooldowns
    this.lastAutoSellTime = 0;
    this.autoSellCooldownMs = 5000; // 5 second cooldown between auto-sells
    
    // Load saved data
    this.load();
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  /**
   * Initialize tracker for a new launch
   */
  initLaunch(mintAddress, walletsData) {
    console.log(`[PnL] 🚀 Initializing for ${mintAddress.slice(0, 8)}...`);
    
    // Save previous launch if different
    if (this.currentMint && this.currentMint !== mintAddress) {
      this.save();
    }
    
    this.currentMint = mintAddress;
    this.wallets.clear();
    this.walletsByLabel.clear();
    this.externalVolume = { buys: 0, sells: 0, net: 0 };
    
    // Register wallets
    if (walletsData) {
      this.registerWallets(walletsData);
    }
    
    // Load existing trades for this mint
    this.loadTradesForMint(mintAddress);
    
    console.log(`[PnL] ✅ Initialized with ${this.wallets.size} wallets`);
  }

  /**
   * Register wallets from current-run.json data
   */
  registerWallets(data) {
    const addWallet = (address, type, label) => {
      if (!address || address.length < 20) return;
      
      const walletData = {
        address,
        type,
        label,
        trades: [],
        pnl: {
          totalBought: 0,    // SOL spent (including pump fee)
          totalSold: 0,      // SOL received (after pump fee)
          fees: 0,           // Transaction fees
          profit: 0,         // net profit/loss
          tokenBalance: 0,   // Current token balance estimate
        },
      };
      
      this.wallets.set(address.toLowerCase(), walletData);
      this.walletsByLabel.set(label, address.toLowerCase());
      
      console.log(`[PnL]   + ${label}: ${address.slice(0, 8)}...`);
    };

    // DEV wallet
    if (data.devWalletAddress || data.devWallet) {
      addWallet(data.devWalletAddress || data.devWallet, 'DEV', 'DEV');
    }

    // Bundle wallets
    if (data.bundleWalletAddresses) {
      data.bundleWalletAddresses.forEach((addr, i) => {
        addWallet(addr, 'Bundle', `Bundle ${i + 1}`);
      });
    }

    // Holder wallets
    if (data.holderWalletAddresses) {
      data.holderWalletAddresses.forEach((addr, i) => {
        addWallet(addr, 'Holder', `Holder ${i + 1}`);
      });
    }
  }

  // ============================================
  // TRADE RECORDING (THE CORE)
  // ============================================

  /**
   * Record a trade WE executed
   * Call this immediately after successful buy/sell
   */
  recordOurTrade({ wallet, type, solAmount, tokenAmount, signature, timestamp = Date.now() }) {
    const addrLower = wallet?.toLowerCase();
    const walletData = this.wallets.get(addrLower);
    
    if (!walletData) {
      console.warn(`[PnL] ⚠️ Unknown wallet: ${wallet?.slice(0, 8)}...`);
      return null;
    }

    // Calculate actual amounts with fees
    let actualSol = parseFloat(solAmount) || 0;
    let txFee = FEES.BASE_FEE;
    
    // Add appropriate fees based on wallet type
    if (walletData.type === 'DEV' || walletData.type === 'Bundle') {
      txFee += FEES.JITO_TIP;
    } else {
      txFee += FEES.PRIORITY_FEE;
    }

    const trade = {
      type,
      solAmount: actualSol,
      tokenAmount: parseFloat(tokenAmount) || 0,
      signature,
      timestamp,
      txFee,
    };

    // Calculate P&L impact
    if (type === 'buy') {
      // Token account creation on first buy
      if (walletData.pnl.totalBought === 0) {
        txFee += FEES.TOKEN_ACCOUNT;
        trade.txFee = txFee;
      }
      
      // SOL spent = amount + 1% pump fee
      const totalSpent = actualSol * (1 + FEES.PUMP_FEE);
      walletData.pnl.totalBought += totalSpent;
      walletData.pnl.fees += txFee;
      walletData.pnl.tokenBalance += trade.tokenAmount;
      
      console.log(`[PnL] 📥 ${walletData.label} BUY: ${actualSol.toFixed(4)} SOL (+${(actualSol * FEES.PUMP_FEE).toFixed(4)} fee)`);
    } else if (type === 'sell') {
      // SOL received = amount - 1% pump fee
      const totalReceived = actualSol * (1 - FEES.PUMP_FEE);
      walletData.pnl.totalSold += totalReceived;
      walletData.pnl.fees += txFee;
      walletData.pnl.tokenBalance -= trade.tokenAmount;
      
      console.log(`[PnL] 📤 ${walletData.label} SELL: ${actualSol.toFixed(4)} SOL (-${(actualSol * FEES.PUMP_FEE).toFixed(4)} fee)`);
    }

    // Update profit
    walletData.pnl.profit = walletData.pnl.totalSold - walletData.pnl.totalBought - walletData.pnl.fees;
    
    // Store trade
    walletData.trades.push(trade);
    
    // Emit event
    this.emit('trade', {
      wallet: walletData.address,
      label: walletData.label,
      type: walletData.type,
      trade,
      pnl: { ...walletData.pnl },
    });

    // Log P&L
    const emoji = walletData.pnl.profit >= 0 ? '📈' : '📉';
    console.log(`[PnL] ${emoji} ${walletData.label} P&L: ${walletData.pnl.profit >= 0 ? '+' : ''}${walletData.pnl.profit.toFixed(4)} SOL`);

    // Auto-save
    this.save();
    
    return walletData.pnl;
  }

  /**
   * Record an external trade (for auto triggers)
   * Called when PumpPortal detects a trade from non-our wallet
   */
  recordExternalTrade({ type, solAmount }) {
    const sol = parseFloat(solAmount) || 0;
    
    if (type === 'buy') {
      this.externalVolume.buys += sol;
    } else if (type === 'sell') {
      this.externalVolume.sells += sol;
    }
    
    this.externalVolume.net = this.externalVolume.buys - this.externalVolume.sells;
    
    // Check auto-sell triggers
    this.checkAutoSellTriggers();
    
    // Check auto-buy triggers
    this.checkAutoBuyTriggers();
    
    // Emit event
    this.emit('externalVolume', { ...this.externalVolume });
  }

  // ============================================
  // AUTO-SELL SYSTEM
  // ============================================

  /**
   * Configure auto-sell for a wallet
   */
  configureAutoSell(walletLabel, config) {
    const addr = this.walletsByLabel.get(walletLabel);
    if (!addr) {
      console.warn(`[PnL] ⚠️ Unknown wallet label: ${walletLabel}`);
      return false;
    }

    const autoConfig = {
      enabled: config.enabled !== false,
      triggers: {
        // Sell when external net volume reaches X SOL
        externalVolume: config.externalVolume || null,
        
        // Sell when profit reaches X% (e.g., 0.5 = 50% profit)
        profitPercent: config.profitPercent || null,
        
        // Sell when loss reaches X% (e.g., -0.2 = 20% loss)
        stopLoss: config.stopLoss || null,
        
        // Sell after X seconds
        timeSeconds: config.timeSeconds || null,
      },
      percentage: config.percentage || 100, // How much to sell (default 100%)
      triggered: false,
      startTime: Date.now(),
    };

    this.autoSellConfig.set(addr, autoConfig);
    
    console.log(`[PnL] ⚙️ Auto-sell configured for ${walletLabel}:`, autoConfig.triggers);
    
    return true;
  }

  /**
   * Check if any auto-sell triggers should fire
   */
  checkAutoSellTriggers() {
    const now = Date.now();
    
    // Cooldown check
    if (now - this.lastAutoSellTime < this.autoSellCooldownMs) {
      return;
    }

    for (const [addr, config] of this.autoSellConfig) {
      if (!config.enabled || config.triggered) continue;
      
      const wallet = this.wallets.get(addr);
      if (!wallet) continue;

      const triggers = config.triggers;
      let shouldSell = false;
      let reason = '';

      // Check external volume trigger
      if (triggers.externalVolume !== null && this.externalVolume.net >= triggers.externalVolume) {
        shouldSell = true;
        reason = `External volume reached ${this.externalVolume.net.toFixed(2)} SOL`;
      }

      // Check profit target
      if (!shouldSell && triggers.profitPercent !== null && wallet.pnl.totalBought > 0) {
        const profitPercent = wallet.pnl.profit / wallet.pnl.totalBought;
        if (profitPercent >= triggers.profitPercent) {
          shouldSell = true;
          reason = `Profit target reached: ${(profitPercent * 100).toFixed(1)}%`;
        }
      }

      // Check stop loss
      if (!shouldSell && triggers.stopLoss !== null && wallet.pnl.totalBought > 0) {
        const profitPercent = wallet.pnl.profit / wallet.pnl.totalBought;
        if (profitPercent <= triggers.stopLoss) {
          shouldSell = true;
          reason = `Stop loss triggered: ${(profitPercent * 100).toFixed(1)}%`;
        }
      }

      // Check time trigger
      if (!shouldSell && triggers.timeSeconds !== null) {
        const elapsed = (now - config.startTime) / 1000;
        if (elapsed >= triggers.timeSeconds) {
          shouldSell = true;
          reason = `Time limit reached: ${elapsed.toFixed(0)}s`;
        }
      }

      if (shouldSell) {
        this.executeAutoSell(addr, wallet.label, config.percentage, reason);
        config.triggered = true;
        this.lastAutoSellTime = now;
      }
    }
  }

  /**
   * Execute auto-sell
   */
  async executeAutoSell(walletAddr, label, percentage, reason) {
    console.log(`[PnL] 🚨 AUTO-SELL TRIGGERED for ${label}: ${reason}`);
    
    this.emit('autoSellTriggered', {
      wallet: walletAddr,
      label,
      percentage,
      reason,
      timestamp: Date.now(),
    });

    if (this.sellExecutor) {
      try {
        const result = await this.sellExecutor(walletAddr, percentage);
        console.log(`[PnL] ✅ Auto-sell executed for ${label}`);
        
        this.emit('autoSellComplete', {
          wallet: walletAddr,
          label,
          result,
        });
      } catch (error) {
        console.error(`[PnL] ❌ Auto-sell failed for ${label}:`, error.message);
        
        this.emit('autoSellFailed', {
          wallet: walletAddr,
          label,
          error: error.message,
        });
      }
    } else {
      console.warn(`[PnL] ⚠️ No sell executor configured`);
    }
  }

  /**
   * Set the sell executor function
   */
  setSellExecutor(fn) {
    this.sellExecutor = fn;
    console.log(`[PnL] ✅ Sell executor configured`);
  }

  // ============================================
  // AUTO-BUY SYSTEM
  // ============================================

  /**
   * Configure auto-buy
   */
  configureAutoBuy(config) {
    this.autoBuyConfig = {
      enabled: config.enabled !== false,
      walletLabel: config.walletLabel || 'Holder 1',
      triggers: {
        externalVolume: config.externalVolume || null,
        priceDip: config.priceDip || null,
      },
      amount: config.amount || 0.1,
      executed: false,
    };

    console.log(`[PnL] ⚙️ Auto-buy configured:`, this.autoBuyConfig);
  }

  /**
   * Check if auto-buy should trigger
   */
  checkAutoBuyTriggers() {
    if (!this.autoBuyConfig.enabled || this.autoBuyConfig.executed) return;

    const triggers = this.autoBuyConfig.triggers;
    let shouldBuy = false;
    let reason = '';

    // Check external volume trigger
    if (triggers.externalVolume !== null && this.externalVolume.net >= triggers.externalVolume) {
      shouldBuy = true;
      reason = `External volume reached ${this.externalVolume.net.toFixed(2)} SOL`;
    }

    if (shouldBuy) {
      this.executeAutoBuy(reason);
      this.autoBuyConfig.executed = true;
    }
  }

  /**
   * Execute auto-buy
   */
  async executeAutoBuy(reason) {
    console.log(`[PnL] 🚨 AUTO-BUY TRIGGERED: ${reason}`);
    
    const walletAddr = this.walletsByLabel.get(this.autoBuyConfig.walletLabel);
    
    this.emit('autoBuyTriggered', {
      wallet: walletAddr,
      label: this.autoBuyConfig.walletLabel,
      amount: this.autoBuyConfig.amount,
      reason,
      timestamp: Date.now(),
    });

    if (this.buyExecutor) {
      try {
        const result = await this.buyExecutor(walletAddr, this.autoBuyConfig.amount);
        console.log(`[PnL] ✅ Auto-buy executed`);
        
        this.emit('autoBuyComplete', {
          wallet: walletAddr,
          label: this.autoBuyConfig.walletLabel,
          result,
        });
      } catch (error) {
        console.error(`[PnL] ❌ Auto-buy failed:`, error.message);
        
        this.emit('autoBuyFailed', {
          wallet: walletAddr,
          label: this.autoBuyConfig.walletLabel,
          error: error.message,
        });
      }
    }
  }

  /**
   * Set the buy executor function
   */
  setBuyExecutor(fn) {
    this.buyExecutor = fn;
    console.log(`[PnL] ✅ Buy executor configured`);
  }

  // ============================================
  // P&L CALCULATIONS
  // ============================================

  /**
   * Get P&L for a specific wallet
   */
  getWalletPnL(walletLabel) {
    const addr = this.walletsByLabel.get(walletLabel);
    if (!addr) return null;
    
    const wallet = this.wallets.get(addr);
    if (!wallet) return null;
    
    return {
      label: wallet.label,
      type: wallet.type,
      address: wallet.address,
      ...wallet.pnl,
      tradeCount: wallet.trades.length,
    };
  }

  /**
   * Get P&L for all wallets
   */
  getAllWalletsPnL() {
    const result = [];
    
    for (const wallet of this.wallets.values()) {
      result.push({
        label: wallet.label,
        type: wallet.type,
        address: wallet.address,
        ...wallet.pnl,
        tradeCount: wallet.trades.length,
      });
    }
    
    // Sort: DEV, Bundle, Holder
    const order = { DEV: 0, Bundle: 1, Holder: 2 };
    result.sort((a, b) => (order[a.type] || 99) - (order[b.type] || 99));
    
    return result;
  }

  /**
   * Get total P&L across all wallets
   */
  getTotalPnL() {
    let totalBought = 0;
    let totalSold = 0;
    let totalFees = 0;
    
    for (const wallet of this.wallets.values()) {
      totalBought += wallet.pnl.totalBought;
      totalSold += wallet.pnl.totalSold;
      totalFees += wallet.pnl.fees;
    }
    
    return {
      totalBought,
      totalSold,
      totalFees,
      profit: totalSold - totalBought - totalFees,
      walletCount: this.wallets.size,
    };
  }

  /**
   * Get external volume stats
   */
  getExternalVolume() {
    return { ...this.externalVolume };
  }

  /**
   * Get auto-sell config for all wallets
   */
  getAutoSellConfig() {
    const result = {};
    
    for (const [addr, config] of this.autoSellConfig) {
      const wallet = this.wallets.get(addr);
      if (wallet) {
        result[wallet.label] = {
          enabled: config.enabled,
          triggers: config.triggers,
          percentage: config.percentage,
          triggered: config.triggered,
        };
      }
    }
    
    return result;
  }

  // ============================================
  // PERSISTENCE
  // ============================================

  /**
   * Save current data to file
   */
  save() {
    if (!this.currentMint) return;

    const data = {
      mintAddress: this.currentMint,
      savedAt: new Date().toISOString(),
      externalVolume: this.externalVolume,
      wallets: {},
    };

    for (const [addr, wallet] of this.wallets) {
      data.wallets[addr] = {
        address: wallet.address,
        type: wallet.type,
        label: wallet.label,
        trades: wallet.trades,
        pnl: wallet.pnl,
      };
    }

    // Save to mint-specific file
    const mintFile = path.join(this.dataDir, `pnl-${this.currentMint.slice(0, 8)}.json`);
    fs.writeFileSync(mintFile, JSON.stringify(data, null, 2));
    
    console.log(`[PnL] 💾 Saved to ${mintFile}`);
  }

  /**
   * Load saved data
   */
  load() {
    // Try to load from current-run.json to get current mint (in keys/ not keys/pnl/)
    try {
      const keysDir = path.join(__dirname, '..', 'keys');
      const currentRunPath = path.join(keysDir, 'current-run.json');
      if (fs.existsSync(currentRunPath)) {
        const currentRun = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
        if (currentRun.mintAddress) {
          this.loadTradesForMint(currentRun.mintAddress);
        }
      }
    } catch (error) {
      // Ignore - will init fresh
    }
  }

  /**
   * Load trades for a specific mint
   */
  loadTradesForMint(mintAddress) {
    const mintFile = path.join(this.dataDir, `pnl-${mintAddress.slice(0, 8)}.json`);
    
    if (!fs.existsSync(mintFile)) {
      console.log(`[PnL] 📂 No existing data for ${mintAddress.slice(0, 8)}...`);
      return;
    }

    try {
      const data = JSON.parse(fs.readFileSync(mintFile, 'utf8'));
      
      this.currentMint = data.mintAddress;
      this.externalVolume = data.externalVolume || { buys: 0, sells: 0, net: 0 };
      
      // Restore wallet data
      for (const [addr, walletData] of Object.entries(data.wallets)) {
        this.wallets.set(addr, walletData);
        this.walletsByLabel.set(walletData.label, addr);
      }
      
      console.log(`[PnL] 📂 Loaded ${Object.keys(data.wallets).length} wallets for ${mintAddress.slice(0, 8)}...`);
      
      // Log totals
      const totals = this.getTotalPnL();
      console.log(`[PnL] 💰 Total P&L: ${totals.profit >= 0 ? '+' : ''}${totals.profit.toFixed(4)} SOL`);
      
    } catch (error) {
      console.error(`[PnL] ❌ Error loading data:`, error.message);
    }
  }

  /**
   * Reset all data for current mint
   */
  reset() {
    this.wallets.clear();
    this.walletsByLabel.clear();
    this.externalVolume = { buys: 0, sells: 0, net: 0 };
    this.autoSellConfig.clear();
    this.autoBuyConfig.executed = false;
    
    console.log(`[PnL] 🔄 Reset`);
  }
}

// Export singleton
const pnlTracker = new PnLTracker();
module.exports = pnlTracker;
