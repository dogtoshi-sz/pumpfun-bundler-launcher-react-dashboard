/**
 * Trend Detector Scoring Engine
 * Computes momentum score (0-100) for tokens based on metrics
 */

const { heuristicsManager } = require('./heuristics');

function calculateScore(metrics) {
  const config = heuristicsManager.get().scoring;
  let score = 0;

  // Buyers contribution
  score += Math.min((metrics.uniqueBuyers60s || 0) * config.buyersWeight, config.buyersMax);

  // Trades contribution
  score += Math.min((metrics.trades60s || 0) * config.tradesWeight, config.tradesMax);

  // Volume contribution
  score += Math.min((metrics.solVol60s || 0) * config.volumeWeight, config.volumeMax);

  // Buy/Sell ratio bonus/penalty
  const ratio = metrics.buySellRatio || 1;
  if (ratio > config.ratioHighThreshold) {
    score += config.ratioHighBonus;
  } else if (ratio > config.ratioMedThreshold) {
    score += config.ratioMedBonus;
  } else if (ratio < config.ratioLowThreshold) {
    score += config.ratioLowPenalty;
  }

  // Acceleration bonus/penalty
  if ((metrics.accelTrades || 0) > 0 && (metrics.accelVol || 0) > 0) {
    score += config.accelPositiveBonus;
  } else if ((metrics.accelTrades || 0) < 0 && (metrics.accelVol || 0) < 0) {
    score += config.accelNegativePenalty;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function calculateMetrics(trades, windowMs = 60000, prevMetrics = null) {
  const now = Date.now();
  const cutoff = now - windowMs;
  
  const recentTrades = trades.filter(t => (t.timestamp || 0) > cutoff);
  const buys = recentTrades.filter(t => t.type === 'buy' || t.txType === 'buy');
  const sells = recentTrades.filter(t => t.type === 'sell' || t.txType === 'sell');
  
  const uniqueBuyers = new Set(buys.map(t => t.fullTrader || t.traderPublicKey || t.trader)).size;
  const buyVol = buys.reduce((sum, t) => sum + (t.solAmount || 0), 0);
  const sellVol = sells.reduce((sum, t) => sum + (t.solAmount || 0), 0);
  const totalVol = buyVol + sellVol;
  
  const buySellRatio = sells.length > 0 
    ? (buys.length + 1) / (sells.length + 1)
    : buys.length + 1;
  
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
  
  metrics.score = calculateScore(metrics);
  return metrics;
}

module.exports = { calculateScore, calculateMetrics };
