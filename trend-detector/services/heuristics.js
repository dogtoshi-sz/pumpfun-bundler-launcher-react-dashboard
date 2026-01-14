/**
 * Trend Detector Heuristics Configuration
 * All thresholds are editable via the API
 */

const fs = require('fs');
const path = require('path');

// Default heuristics
const DEFAULT_HEURISTICS = {
  aliveGate: {
    enabled: true,
    checkAtSeconds: 120,
    minUniqueBuyers: 6,
    minBuys: 10,
    minSolVolume: 2.0,
    maxTimeToFirstBuy: 45,
    maxTimeToSecondBuyer: 60,
  },
  conversionGate: {
    enabled: true,
    startAtSeconds: 180,
    minNewBuyersLast2m: 4,
    minBuySellRatio: 1.0,
    maxConsecutiveNegativeAccel: 2,
  },
  scoring: {
    buyersWeight: 6,
    buyersMax: 35,
    tradesWeight: 2,
    tradesMax: 25,
    volumeWeight: 4,
    volumeMax: 20,
    ratioHighThreshold: 1.8,
    ratioHighBonus: 10,
    ratioMedThreshold: 1.2,
    ratioMedBonus: 5,
    ratioLowThreshold: 0.9,
    ratioLowPenalty: -10,
    accelPositiveBonus: 10,
    accelNegativePenalty: -5,
  },
  tracking: {
    durationMs: 10 * 60 * 1000,
    sampleIntervalMs: 15 * 1000,
    rollingWindowMs: 60 * 1000,
    maxTrackedTokens: 100,
    candidateCount: 20,
  },
  filters: {
    minInitialLiquidity: 0,
    excludeKeywords: [],
    excludeCreators: [],
  },
};

// Config file path - store in parent keys folder
const CONFIG_PATH = path.join(__dirname, '..', '..', 'keys', 'trend-heuristics.json');

class HeuristicsManager {
  constructor() {
    this.config = { ...DEFAULT_HEURISTICS };
    this.load();
  }

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

  get() {
    return { ...this.config };
  }

  update(updates) {
    this.config = this.deepMerge(this.config, updates);
    this.save();
    return this.config;
  }

  reset() {
    this.config = { ...DEFAULT_HEURISTICS };
    this.save();
    return this.config;
  }

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

const heuristicsManager = new HeuristicsManager();

module.exports = { heuristicsManager, DEFAULT_HEURISTICS };
