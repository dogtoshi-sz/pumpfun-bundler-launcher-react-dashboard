/**
 * Trend Detector Gating Logic
 * Two-stage filtering: Alive Gate and Conversion Gate
 */

const { heuristicsManager } = require('./heuristics');

function checkAliveGate(tokenData) {
  const config = heuristicsManager.get().aliveGate;
  
  if (!config.enabled) {
    return { passed: true, reasons: ['Alive gate disabled'] };
  }
  
  const reasons = [];
  let passed = true;
  
  if (tokenData.firstBuyAt && tokenData.launchedAt) {
    const timeToFirstBuy = (tokenData.firstBuyAt - tokenData.launchedAt) / 1000;
    if (timeToFirstBuy > config.maxTimeToFirstBuy) {
      passed = false;
      reasons.push(`First buy too slow: ${timeToFirstBuy.toFixed(1)}s`);
    }
  }
  
  if (tokenData.secondBuyerAt && tokenData.launchedAt) {
    const timeToSecond = (tokenData.secondBuyerAt - tokenData.launchedAt) / 1000;
    if (timeToSecond > config.maxTimeToSecondBuyer) {
      passed = false;
      reasons.push(`Second buyer too slow: ${timeToSecond.toFixed(1)}s`);
    }
  }
  
  if ((tokenData.uniqueBuyers || 0) < config.minUniqueBuyers) {
    passed = false;
    reasons.push(`Low buyers: ${tokenData.uniqueBuyers || 0} < ${config.minUniqueBuyers}`);
  }
  
  if ((tokenData.totalBuys || 0) < config.minBuys) {
    passed = false;
    reasons.push(`Low buys: ${tokenData.totalBuys || 0} < ${config.minBuys}`);
  }
  
  if ((tokenData.solVolume || 0) < config.minSolVolume) {
    passed = false;
    reasons.push(`Low volume: ${(tokenData.solVolume || 0).toFixed(2)} SOL`);
  }
  
  if (passed) {
    reasons.push('All checks passed');
  }
  
  return { passed, reasons };
}

function checkConversionGate(metrics, tokenData) {
  const config = heuristicsManager.get().conversionGate;
  
  if (!config.enabled) {
    return { passed: true, warning: false, reasons: ['Conversion gate disabled'] };
  }
  
  const reasons = [];
  let passed = true;
  let warning = false;
  
  // STRICT: No activity in 60s = drop immediately
  if ((metrics.trades60s || 0) === 0) {
    passed = false;
    reasons.push('Dead: no trades in 60s');
    return { passed, warning: false, reasons };
  }
  
  // STRICT: Zero buyers in 60s after 3 min = drop
  const newBuyers2m = metrics.uniqueBuyers60s || 0;
  if (newBuyers2m === 0) {
    passed = false;
    reasons.push('Dead: no new buyers in 60s');
    return { passed, warning: false, reasons };
  }
  
  // Warning level: slowing buyers
  if (newBuyers2m < config.minNewBuyersLast2m) {
    warning = true;
    reasons.push(`Slowing buyers: ${newBuyers2m}`);
  }
  
  // STRICT: Heavy sell pressure = drop
  const ratio = metrics.buySellRatio || 0;
  if (ratio < 0.5) {
    passed = false;
    reasons.push(`Dump detected: ratio ${ratio.toFixed(2)}`);
    return { passed, warning: false, reasons };
  }
  
  // Warning level: moderate sell pressure
  if (ratio < config.minBuySellRatio) {
    warning = true;
    reasons.push(`Sell pressure: ratio ${ratio.toFixed(2)}`);
  }
  
  // Track consecutive negative acceleration
  const negativeAccelCount = tokenData.consecutiveNegativeAccel || 0;
  if (metrics.accelTrades < 0 && metrics.accelVol < 0) {
    tokenData.consecutiveNegativeAccel = negativeAccelCount + 1;
  } else {
    tokenData.consecutiveNegativeAccel = 0;
  }
  
  if (tokenData.consecutiveNegativeAccel >= config.maxConsecutiveNegativeAccel) {
    passed = false;
    reasons.push(`Momentum dying: ${tokenData.consecutiveNegativeAccel}x negative accel`);
  }
  
  // STRICT: Score dropped to near zero
  if ((metrics.score || 0) < 5 && tokenData.latestScore > 20) {
    passed = false;
    reasons.push(`Score collapsed: ${metrics.score} (was ${tokenData.latestScore})`);
  }
  
  if (passed && !warning) {
    reasons.push('Momentum sustained');
  }
  
  return { passed, warning, reasons };
}

function determineStatus(currentStatus, aliveResult, conversionResult, ageMs) {
  const config = heuristicsManager.get();
  const ageSeconds = ageMs / 1000;
  
  if (ageSeconds < config.aliveGate.checkAtSeconds) {
    return 'tracking';
  }
  
  if (currentStatus === 'tracking' && ageSeconds >= config.aliveGate.checkAtSeconds) {
    if (!aliveResult.passed) return 'dropped';
    return 'candidate';
  }
  
  if (ageSeconds >= config.conversionGate.startAtSeconds) {
    if (!conversionResult.passed) return 'dropped';
  }
  
  return currentStatus === 'tracking' ? 'candidate' : currentStatus;
}

module.exports = { checkAliveGate, checkConversionGate, determineStatus };
