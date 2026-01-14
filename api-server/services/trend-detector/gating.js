/**
 * Trend Detector Gating Logic
 * Two-stage filtering: Alive Gate and Conversion Gate
 */

const { heuristicsManager } = require('./heuristics');

/**
 * Check if token passes the Alive Gate
 * Called at 120 seconds after launch
 * 
 * @param {Object} tokenData - Token tracking data
 * @param {number} tokenData.launchedAt - Launch timestamp
 * @param {number} tokenData.firstBuyAt - First buy timestamp
 * @param {number} tokenData.secondBuyerAt - Second unique buyer timestamp
 * @param {number} tokenData.uniqueBuyers - Total unique buyers so far
 * @param {number} tokenData.totalBuys - Total buy transactions
 * @param {number} tokenData.solVolume - Total SOL volume
 * @returns {Object} { passed: boolean, reasons: string[] }
 */
function checkAliveGate(tokenData) {
  const config = heuristicsManager.get().aliveGate;
  
  if (!config.enabled) {
    return { passed: true, reasons: ['Alive gate disabled'] };
  }
  
  const reasons = [];
  let passed = true;
  
  // Check time to first buy
  if (tokenData.firstBuyAt && tokenData.launchedAt) {
    const timeToFirstBuy = (tokenData.firstBuyAt - tokenData.launchedAt) / 1000;
    if (timeToFirstBuy > config.maxTimeToFirstBuy) {
      passed = false;
      reasons.push(`First buy too slow: ${timeToFirstBuy.toFixed(1)}s > ${config.maxTimeToFirstBuy}s`);
    }
  }
  
  // Check time to second unique buyer
  if (tokenData.secondBuyerAt && tokenData.launchedAt) {
    const timeToSecond = (tokenData.secondBuyerAt - tokenData.launchedAt) / 1000;
    if (timeToSecond > config.maxTimeToSecondBuyer) {
      passed = false;
      reasons.push(`Second buyer too slow: ${timeToSecond.toFixed(1)}s > ${config.maxTimeToSecondBuyer}s`);
    }
  }
  
  // Check unique buyers
  if ((tokenData.uniqueBuyers || 0) < config.minUniqueBuyers) {
    passed = false;
    reasons.push(`Low buyers: ${tokenData.uniqueBuyers || 0} < ${config.minUniqueBuyers}`);
  }
  
  // Check total buys
  if ((tokenData.totalBuys || 0) < config.minBuys) {
    passed = false;
    reasons.push(`Low buys: ${tokenData.totalBuys || 0} < ${config.minBuys}`);
  }
  
  // Check volume
  if ((tokenData.solVolume || 0) < config.minSolVolume) {
    passed = false;
    reasons.push(`Low volume: ${(tokenData.solVolume || 0).toFixed(2)} < ${config.minSolVolume} SOL`);
  }
  
  if (passed) {
    reasons.push('All checks passed');
  }
  
  return { passed, reasons };
}

/**
 * Check if token passes the Conversion Gate
 * Called continuously from 3-10 minutes
 * 
 * @param {Object} metrics - Current rolling metrics
 * @param {Object} tokenData - Token tracking data with history
 * @returns {Object} { passed: boolean, warning: boolean, reasons: string[] }
 */
function checkConversionGate(metrics, tokenData) {
  const config = heuristicsManager.get().conversionGate;
  
  if (!config.enabled) {
    return { passed: true, warning: false, reasons: ['Conversion gate disabled'] };
  }
  
  const reasons = [];
  let passed = true;
  let warning = false;
  
  // Check new buyers in last 2 minutes
  const newBuyers2m = metrics.uniqueBuyers60s || 0; // Approximation using 60s window
  if (newBuyers2m < config.minNewBuyersLast2m) {
    warning = true;
    reasons.push(`Slowing buyers: ${newBuyers2m} < ${config.minNewBuyersLast2m} in 2m`);
  }
  
  // Check buy/sell ratio
  if ((metrics.buySellRatio || 0) < config.minBuySellRatio) {
    warning = true;
    reasons.push(`Sell pressure: ratio ${(metrics.buySellRatio || 0).toFixed(2)} < ${config.minBuySellRatio}`);
  }
  
  // Check consecutive negative acceleration
  const negativeAccelCount = tokenData.consecutiveNegativeAccel || 0;
  if (metrics.accelTrades < 0 && metrics.accelVol < 0) {
    tokenData.consecutiveNegativeAccel = negativeAccelCount + 1;
  } else {
    tokenData.consecutiveNegativeAccel = 0;
  }
  
  if (tokenData.consecutiveNegativeAccel >= config.maxConsecutiveNegativeAccel) {
    passed = false;
    reasons.push(`Momentum dying: ${tokenData.consecutiveNegativeAccel}x negative acceleration`);
  }
  
  if (passed && !warning) {
    reasons.push('Momentum sustained');
  }
  
  return { passed, warning, reasons };
}

/**
 * Determine token status based on gates
 * @param {string} currentStatus - Current status
 * @param {Object} aliveResult - Result from checkAliveGate
 * @param {Object} conversionResult - Result from checkConversionGate
 * @param {number} ageMs - Token age in milliseconds
 * @returns {string} New status: 'tracking' | 'candidate' | 'dropped'
 */
function determineStatus(currentStatus, aliveResult, conversionResult, ageMs) {
  const config = heuristicsManager.get();
  const ageSeconds = ageMs / 1000;
  
  // Before alive gate check
  if (ageSeconds < config.aliveGate.checkAtSeconds) {
    return 'tracking';
  }
  
  // At alive gate check
  if (currentStatus === 'tracking' && ageSeconds >= config.aliveGate.checkAtSeconds) {
    if (!aliveResult.passed) {
      return 'dropped';
    }
    // Passed alive gate - now a candidate
    return 'candidate';
  }
  
  // After conversion gate starts
  if (ageSeconds >= config.conversionGate.startAtSeconds) {
    if (!conversionResult.passed) {
      return 'dropped';
    }
  }
  
  return currentStatus === 'tracking' ? 'candidate' : currentStatus;
}

module.exports = { checkAliveGate, checkConversionGate, determineStatus };
