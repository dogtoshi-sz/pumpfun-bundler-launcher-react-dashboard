/**
 * Trend Detector Heuristics Configuration
 * All thresholds are editable via the UI
 */

const fs = require('fs');
const path = require('path');

// Default heuristics - can be overridden by saved config
const DEFAULT_HEURISTICS = {
  // ============================================
  // ALIVE GATE - Checked at 120 seconds after launch
  // Token must pass ALL these to continue tracking
  // ============================================
  aliveGate: {
    enabled: true,
    checkAtSeconds: 120,           // When to check (2 minutes after launch)
    minUniqueBuyers: 6,            // Minimum unique wallet addresses that bought
    minBuys: 10,                   // Minimum total buy transactions
    minSolVolume: 2.0,             // Minimum SOL volume in first 2 minutes
    maxTimeToFirstBuy: 45,         // Max seconds to first buy (organic = fast)
    maxTimeToSecondBuyer: 60,      // Max seconds to second unique buyer
  },

  // ============================================
  // CONVERSION GATE - Rolling check from 3-10 minutes
  // Token must maintain momentum to stay as candidate
  // ============================================
  conversionGate: {
    enabled: true,
    startAtSeconds: 180,           // Start checking at 3 minutes
    minNewBuyersLast2m: 4,         // Minimum new unique buyers in rolling 2 min window
    minBuySellRatio: 1.0,          // Buys / Sells must be >= this (1.0 = equal)
    maxConsecutiveNegativeAccel: 2, // Drop if acceleration negative 2x in a row
  },

  // ============================================
  // SCORING WEIGHTS - Used to compute 0-100 score
  // Higher weights = more influence on final score
  // ============================================
  scoring: {
    // Base metrics (linear scaling)
    buyersWeight: 6,               // score += uniqueBuyers60s * weight (max ~35)
    buyersMax: 35,                 // Cap contribution at this value
    
    tradesWeight: 2,               // score += trades60s * weight (max ~25)
    tradesMax: 25,
    
    volumeWeight: 4,               // score += solVol60s * weight (max ~20)
    volumeMax: 20,
    
    // Ratio bonuses
    ratioHighThreshold: 1.8,       // If buySellRatio > this: +ratioHighBonus
    ratioHighBonus: 10,
    ratioMedThreshold: 1.2,        // If buySellRatio > this: +ratioMedBonus
    ratioMedBonus: 5,
    ratioLowThreshold: 0.9,        // If buySellRatio < this: +ratioLowPenalty
    ratioLowPenalty: -10,
    
    // Acceleration bonuses (momentum)
    accelPositiveBonus: 10,        // If trades AND volume accelerating: +bonus
    accelNegativePenalty: -5,      // If trades AND volume decelerating: -penalty
  },

  // ============================================
  // TRACKING SETTINGS
  // ============================================
  tracking: {
    durationMs: 10 * 60 * 1000,    // Track each token for 10 minutes
    sampleIntervalMs: 15 * 1000,   // Sample metrics every 15 seconds
    rollingWindowMs: 60 * 1000,    // 60 second rolling window for metrics
    maxTrackedTokens: 100,         // Max tokens to track simultaneously
    candidateCount: 20,            // Number of top candidates to show
  },

  // ============================================
  // FILTERS - Pre-filter tokens before tracking
  // ============================================
  filters: {
    minInitialLiquidity: 0,        // Min SOL liquidity at launch (0 = any)
    excludeKeywords: [],           // Exclude tokens with these keywords in name
    excludeCreators: [],           // Exclude tokens from these creator addresses
  },
};

// Config file path
const CONFIG_PATH = path.join(__dirname, '..', '..', '..', 'keys', 'trend-heuristics.json');

class HeuristicsManager {
  constructor() {
    this.config = { ...DEFAULT_HEURISTICS };
    this.load();
  }

  // Load config from file (merge with defaults)
  load() {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        this.config = this.deepMerge(DEFAULT_HEURISTICS, saved);
        console.log('[TrendHeuristics] Loaded saved config');
      }
    } catch (err) {
      console.warn('[TrendHeuristics] Failed to load config:', err.message);
    }
    return this.config;
  }

  // Save current config to file
  save() {
    try {
      const dir = path.dirname(CONFIG_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2));
      console.log('[TrendHeuristics] Saved config');
      return true;
    } catch (err) {
      console.error('[TrendHeuristics] Failed to save config:', err.message);
      return false;
    }
  }

  // Get current config
  get() {
    return { ...this.config };
  }

  // Update config (partial update supported)
  update(updates) {
    this.config = this.deepMerge(this.config, updates);
    this.save();
    return this.config;
  }

  // Reset to defaults
  reset() {
    this.config = { ...DEFAULT_HEURISTICS };
    this.save();
    return this.config;
  }

  // Deep merge helper
  deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }
}

// Singleton
const heuristicsManager = new HeuristicsManager();

module.exports = { heuristicsManager, DEFAULT_HEURISTICS };
