/**
 * Trend Detector Service
 * Main orchestrator for tracking pump.fun token launches and computing momentum
 */

const { heuristicsManager } = require('./heuristics');
const { calculateScore, calculateMetrics } = require('./scoring');
const { checkAliveGate, checkConversionGate, determineStatus } = require('./gating');

class TrendDetectorService {
  constructor() {
    // Token tracking state
    this.trackedTokens = new Map(); // mint -> tokenData
    this.tokenSamples = new Map();  // mint -> [samples]
    this.candidates = [];           // Top N candidates by score
    
    // Event listeners
    this.listeners = new Set();
    
    // Stats
    this.stats = {
      totalTracked: 0,
      totalDropped: 0,
      totalCandidates: 0,
      startedAt: Date.now(),
    };
    
    // Sampling interval
    this.sampleInterval = null;
    
    console.log('[TrendDetector] Service initialized');
  }

  /**
   * Start tracking a new token
   */
  trackToken(tokenInfo) {
    const { 
      mint, name, symbol, imageUrl, creator, launchedAt,
      twitter, telegram, website, description  // Social links
    } = tokenInfo;
    
    if (!mint) {
      console.warn('[TrendDetector] Cannot track token without mint address');
      return null;
    }
    
    // Check if already tracking
    if (this.trackedTokens.has(mint)) {
      return this.trackedTokens.get(mint);
    }
    
    // Check max tracked tokens
    const config = heuristicsManager.get();
    if (this.trackedTokens.size >= config.tracking.maxTrackedTokens) {
      this.pruneOldestTokens();
    }
    
    // Create token tracking data
    const tokenData = {
      mint,
      name: name || 'Unknown',
      symbol: symbol || '???',
      imageUrl: imageUrl || null,
      creator: creator || null,
      launchedAt: launchedAt || Date.now(),
      status: 'tracking',
      
      // Social links
      twitter: twitter || null,
      telegram: telegram || null,
      website: website || null,
      description: description || null,
      
      // Metrics state
      trades: [],
      uniqueBuyers: 0,
      uniqueBuyerSet: new Set(),
      totalBuys: 0,
      totalSells: 0,
      solVolume: 0,
      latestScore: 0,
      latestMetrics: null,
      
      // Gate tracking
      firstBuyAt: null,
      secondBuyerAt: null,
      aliveGatePassed: null,
      conversionGatePassed: null,
      consecutiveNegativeAccel: 0,
      
      // Metadata
      trackedAt: Date.now(),
      lastSampleAt: null,
      droppedAt: null,
      droppedReason: null,
    };
    
    this.trackedTokens.set(mint, tokenData);
    this.tokenSamples.set(mint, []);
    this.stats.totalTracked++;
    
    // Reduce console spam - only log every 10th token
    if (this.stats.totalTracked % 10 === 0) {
      console.log(`[TrendDetector] Tracking ${this.trackedTokens.size} tokens (${this.stats.totalTracked} total)`);
    }
    
    this.emit('tokenTracked', tokenData);
    return tokenData;
  }

  /**
   * Record a trade for a token
   */
  recordTrade(trade) {
    const mint = trade.mint || trade.mintAddress;
    if (!mint) return;
    
    let tokenData = this.trackedTokens.get(mint);
    
    // Auto-track new tokens on first trade
    if (!tokenData) {
      tokenData = this.trackToken({
        mint,
        name: trade.tokenName,
        symbol: trade.tokenSymbol,
        launchedAt: trade.timestamp,
      });
      if (!tokenData) return;
    }
    
    // Skip if already dropped or too old
    if (tokenData.status === 'dropped') return;
    
    const config = heuristicsManager.get();
    const age = Date.now() - tokenData.launchedAt;
    if (age > config.tracking.durationMs) {
      this.finalizeToken(mint);
      return;
    }
    
    // Record trade
    tokenData.trades.push({
      type: trade.type || trade.txType,
      solAmount: trade.solAmount || 0,
      trader: trade.fullTrader || trade.traderPublicKey || trade.trader,
      timestamp: trade.timestamp || Date.now(),
      signature: trade.signature || trade.fullSignature,
    });
    
    // Trim old trades
    const cutoff = Date.now() - config.tracking.durationMs;
    tokenData.trades = tokenData.trades.filter(t => t.timestamp > cutoff);
    
    // Update aggregates
    const isBuy = trade.type === 'buy' || trade.txType === 'buy';
    if (isBuy) {
      tokenData.totalBuys++;
      tokenData.solVolume += trade.solAmount || 0;
      
      const buyer = trade.fullTrader || trade.traderPublicKey || trade.trader;
      if (buyer && !tokenData.uniqueBuyerSet.has(buyer)) {
        if (tokenData.uniqueBuyerSet.size === 0) {
          tokenData.firstBuyAt = trade.timestamp || Date.now();
        } else if (tokenData.uniqueBuyerSet.size === 1) {
          tokenData.secondBuyerAt = trade.timestamp || Date.now();
        }
        
        tokenData.uniqueBuyerSet.add(buyer);
        tokenData.uniqueBuyers = tokenData.uniqueBuyerSet.size;
      }
    } else {
      tokenData.totalSells++;
    }
    
    this.emit('trade', { mint, trade, tokenData });
  }

  /**
   * Sample metrics for all tracked tokens
   */
  sampleAll() {
    const config = heuristicsManager.get();
    const now = Date.now();
    
    for (const [mint, tokenData] of this.trackedTokens) {
      if (tokenData.status === 'dropped') continue;
      
      const age = now - tokenData.launchedAt;
      
      if (age > config.tracking.durationMs) {
        this.finalizeToken(mint);
        continue;
      }
      
      // Calculate metrics
      const prevMetrics = tokenData.latestMetrics;
      const metrics = calculateMetrics(
        tokenData.trades,
        config.tracking.rollingWindowMs,
        prevMetrics
      );
      
      tokenData.latestMetrics = metrics;
      tokenData.latestScore = metrics.score;
      tokenData.lastSampleAt = now;
      
      // Store sample
      const samples = this.tokenSamples.get(mint) || [];
      samples.push({ ...metrics, sampledAt: now, ageMs: age });
      if (samples.length > 40) samples.shift();
      this.tokenSamples.set(mint, samples);
      
      // Check gates
      const ageSeconds = age / 1000;
      
      // Fast-track: tokens with >10 buyers and >2 SOL volume are clearly alive
      const fastTrackEligible = tokenData.uniqueBuyers >= 10 && tokenData.solVolume >= 2;
      
      if (tokenData.aliveGatePassed === null && (ageSeconds >= config.aliveGate.checkAtSeconds || fastTrackEligible)) {
        const aliveResult = checkAliveGate(tokenData);
        
        if (fastTrackEligible && !aliveResult.passed) {
          console.log(`[TrendDetector] ⚡ ${tokenData.symbol} FAST-TRACKED: ${tokenData.uniqueBuyers} buyers, ${tokenData.solVolume.toFixed(2)} SOL`);
          aliveResult.passed = true;
          aliveResult.reasons = ['Fast-tracked: exceptional metrics'];
        }
        
        tokenData.aliveGatePassed = aliveResult.passed;
        tokenData.aliveGateReasons = aliveResult.reasons;
        
        if (!aliveResult.passed) {
          this.dropToken(mint, aliveResult.reasons.join('; '));
          continue;
        }
        
        tokenData.status = 'candidate';
        this.stats.totalCandidates++;
        console.log(`[TrendDetector] ✅ ${tokenData.symbol} → CANDIDATE (${tokenData.uniqueBuyers} buyers, ${tokenData.solVolume.toFixed(2)} SOL)`);
        this.emit('aliveGatePassed', { mint, tokenData, reasons: aliveResult.reasons });
      }
      
      // Conversion gate check (after 3 minutes)
      if (tokenData.status === 'candidate' && ageSeconds >= config.conversionGate.startAtSeconds) {
        const convResult = checkConversionGate(metrics, tokenData);
        tokenData.conversionGatePassed = convResult.passed;
        tokenData.conversionGateWarning = convResult.warning;
        
        if (!convResult.passed) {
          this.dropToken(mint, convResult.reasons.join('; '));
          continue;
        }
      }
    }
    
    this.updateCandidates();
  }

  dropToken(mint, reason) {
    const tokenData = this.trackedTokens.get(mint);
    if (!tokenData) return;
    
    tokenData.status = 'dropped';
    tokenData.droppedAt = Date.now();
    tokenData.droppedReason = reason;
    this.stats.totalDropped++;
    
    // Only log drops for candidates (reduce spam)
    if (tokenData.aliveGatePassed) {
      console.log(`[TrendDetector] ❌ Dropped ${tokenData.symbol}: ${reason}`);
    }
    this.emit('tokenDropped', { mint, tokenData, reason });
  }

  finalizeToken(mint) {
    const tokenData = this.trackedTokens.get(mint);
    if (!tokenData) return;
    
    if (tokenData.status === 'candidate') {
      console.log(`[TrendDetector] 🏁 ${tokenData.symbol} complete (score: ${tokenData.latestScore})`);
      this.emit('tokenFinalized', { mint, tokenData });
    }
    tokenData.finalized = true;
  }

  pruneOldestTokens() {
    const sortedTokens = Array.from(this.trackedTokens.entries())
      .sort((a, b) => a[1].trackedAt - b[1].trackedAt);
    
    const toRemove = Math.ceil(sortedTokens.length * 0.1);
    for (let i = 0; i < toRemove; i++) {
      const [mint] = sortedTokens[i];
      this.trackedTokens.delete(mint);
      this.tokenSamples.delete(mint);
    }
  }

  updateCandidates() {
    const config = heuristicsManager.get();
    
    this.candidates = Array.from(this.trackedTokens.values())
      .filter(t => t.status === 'candidate' && !t.finalized)
      .sort((a, b) => b.latestScore - a.latestScore)
      .slice(0, config.tracking.candidateCount);
    
    this.emit('candidatesUpdated', { candidates: this.candidates });
  }

  start() {
    if (this.sampleInterval) return;
    
    const config = heuristicsManager.get();
    this.sampleInterval = setInterval(
      () => this.sampleAll(),
      config.tracking.sampleIntervalMs
    );
    
    console.log('[TrendDetector] Service started');
    this.emit('started');
  }

  stop() {
    if (this.sampleInterval) {
      clearInterval(this.sampleInterval);
      this.sampleInterval = null;
    }
    console.log('[TrendDetector] Service stopped');
    this.emit('stopped');
  }

  getCandidates() {
    const now = Date.now();
    return this.candidates.map(t => ({
      mint: t.mint,
      name: t.name,
      symbol: t.symbol,
      imageUrl: t.imageUrl,
      score: t.latestScore,
      uniqueBuyers: t.uniqueBuyers,
      totalBuys: t.totalBuys,
      totalSells: t.totalSells,
      solVolume: t.solVolume,
      status: t.status,
      ageMs: t.launchedAt ? now - t.launchedAt : 0,
      launchedAt: t.launchedAt,
      metrics: t.latestMetrics,
      twitter: t.twitter,
      telegram: t.telegram,
      website: t.website,
      description: t.description,
      creator: t.creator,
    }));
  }

  getTrackedTokens() {
    const now = Date.now();
    return Array.from(this.trackedTokens.values()).map(t => ({
      mint: t.mint,
      name: t.name,
      symbol: t.symbol,
      imageUrl: t.imageUrl,
      score: t.latestScore,
      status: t.status,
      ageMs: t.launchedAt ? now - t.launchedAt : 0,
      uniqueBuyers: t.uniqueBuyers,
      solVolume: t.solVolume,
      totalBuys: t.totalBuys,
      totalSells: t.totalSells,
      // Social links
      twitter: t.twitter,
      telegram: t.telegram,
      website: t.website,
      description: t.description,
      creator: t.creator,
    }));
  }

  getTokenDetails(mint) {
    const tokenData = this.trackedTokens.get(mint);
    if (!tokenData) return null;
    
    const samples = this.tokenSamples.get(mint) || [];
    return {
      ...tokenData,
      uniqueBuyerSet: undefined,
      trades: tokenData.trades.slice(-50),
      samples: samples.slice(-20),
    };
  }

  getHeuristics() {
    return heuristicsManager.get();
  }

  updateHeuristics(updates) {
    return heuristicsManager.update(updates);
  }

  resetHeuristics() {
    return heuristicsManager.reset();
  }

  getStats() {
    return {
      ...this.stats,
      currentlyTracking: this.trackedTokens.size,
      currentCandidates: this.candidates.length,
      uptimeMs: Date.now() - this.stats.startedAt,
    };
  }

  on(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  emit(event, data) {
    for (const listener of this.listeners) {
      try {
        listener(event, data);
      } catch (e) {
        console.error('[TrendDetector] Listener error:', e.message);
      }
    }
  }
}

const trendDetector = new TrendDetectorService();

module.exports = { trendDetector, TrendDetectorService };
