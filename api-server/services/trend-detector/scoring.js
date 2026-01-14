/**
 * Trend Detector Scoring Engine
 * Computes momentum score (0-100) for tokens based on metrics
 */

const { heuristicsManager } = require('./heuristics');

/**
 * Calculate momentum score for a token based on current metrics
 * @param {Object} metrics - Token metrics
 * @param {number} metrics.uniqueBuyers60s - Unique buyers in last 60s
 * @param {number} metrics.trades60s - Total trades in last 60s
 * @param {number} metrics.solVol60s - SOL volume in last 60s
 * @param {number} metrics.buySellRatio - Buys / Sells ratio
 * @param {number} metrics.accelTrades - Trade acceleration (delta from prev sample)
 * @param {number} metrics.accelVol - Volume acceleration (delta from prev sample)
 * @returns {number} Score from 0-100
 */
function calculateScore(metrics) {
  const config = heuristicsManager.get().scoring;
  let score = 0;

  // 1. Buyers contribution
  const buyersScore = Math.min(
    (metrics.uniqueBuyers60s || 0) * config.buyersWeight,
    config.buyersMax
  );
  score += buyersScore;

  // 2. Trades contribution
  const tradesScore = Math.min(
    (metrics.trades60s || 0) * config.tradesWeight,
    config.tradesMax
  );
  score += tradesScore;

  // 3. Volume contribution
  const volScore = Math.min(
    (metrics.solVol60s || 0) * config.volumeWeight,
    config.volumeMax
  );
  score += volScore;

  // 4. Buy/Sell ratio bonus/penalty
  const ratio = metrics.buySellRatio || 1;
  if (ratio > config.ratioHighThreshold) {
    score += config.ratioHighBonus;
  } else if (ratio > config.ratioMedThreshold) {
    score += config.ratioMedBonus;
  } else if (ratio < config.ratioLowThreshold) {
    score += config.ratioLowPenalty;
  }

  // 5. Acceleration bonus/penalty
  const accelTrades = metrics.accelTrades || 0;
  const accelVol = metrics.accelVol || 0;
  
  if (accelTrades > 0 && accelVol > 0) {
    score += config.accelPositiveBonus;
  } else if (accelTrades < 0 && accelVol < 0) {
    score += config.accelNegativePenalty;
  }

  // Clamp to 0-100
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Calculate metrics from trade history
 * @param {Array} trades - Array of trade objects
 * @param {number} windowMs - Rolling window in milliseconds
 * @param {Object} prevMetrics - Previous sample metrics (for acceleration)
 * @returns {Object} Calculated metrics
 */
function calculateMetrics(trades, windowMs = 60000, prevMetrics = null) {
  const now = Date.now();
  const cutoff = now - windowMs;
  
  // Filter to rolling window
  const recentTrades = trades.filter(t => (t.timestamp || 0) > cutoff);
  
  // Count buys and sells
  const buys = recentTrades.filter(t => t.type === 'buy' || t.txType === 'buy');
  const sells = recentTrades.filter(t => t.type === 'sell' || t.txType === 'sell');
  
  // Unique buyers
  const uniqueBuyers = new Set(
    buys.map(t => t.fullTrader || t.traderPublicKey || t.trader)
  ).size;
  
  // Volume
  const buyVol = buys.reduce((sum, t) => sum + (t.solAmount || 0), 0);
  const sellVol = sells.reduce((sum, t) => sum + (t.solAmount || 0), 0);
  const totalVol = buyVol + sellVol;
  
  // Buy/Sell ratio (avoid division by zero)
  const buySellRatio = sells.length > 0 
    ? (buys.length + 1) / (sells.length + 1)
    : buys.length + 1;
  
  // Calculate acceleration if we have previous metrics
  let accelTrades = 0;
  let accelVol = 0;
  if (prevMetrics) {
    accelTrades = recentTrades.length - (prevMetrics.trades60s || 0);
    accelVol = totalVol - (prevMetrics.solVol60s || 0);
  }
  
  const metrics = {
    trades60s: recentTrades.length,
    buys60s: buys.length,
    sells60s: sells.length,
    uniqueBuyers60s: uniqueBuyers,
    solVol60s: totalVol,
    buyVol60s: buyVol,
    sellVol60s: sellVol,
    buySellRatio,
    accelTrades,
    accelVol,
    timestamp: now,
  };
  
  // Calculate score
  metrics.score = calculateScore(metrics);
  
  return metrics;
}

module.exports = { calculateScore, calculateMetrics };
