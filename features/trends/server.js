/**
 * Pump.fun Trend Detector - Standalone Service
 * 
 * Monitors all new pump.fun token launches and identifies trending tokens
 * based on momentum scoring and heuristics.
 * 
 * Runs independently on port 3003
 * Connect your bundler or other tools via the REST API
 */

require('dotenv').config({ path: '../.env' }); // Use parent .env for keys

const express = require('express');
const cors = require('cors');
const { trendDetector } = require('./services/trend-detector');
const { PumpFunFeed } = require('./services/pumpfun-feed');
const { AIAnalyzer } = require('./services/ai-analyzer');

const app = express();
const PORT = process.env.TREND_DETECTOR_PORT || 3003;

// Initialize AI Analyzer
let aiAnalyzer = null;

// Middleware
app.use(cors());
app.use(express.json());

// SSE clients
const sseClients = new Set();

// ============================================
// API ENDPOINTS
// ============================================

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'trend-detector',
    uptime: process.uptime(),
  });
});

// Get current candidates (top trending tokens)
app.get('/api/candidates', (req, res) => {
  res.json({
    success: true,
    candidates: trendDetector.getCandidates(),
  });
});

// Get all tracked tokens
app.get('/api/tokens', (req, res) => {
  res.json({
    success: true,
    tokens: trendDetector.getTrackedTokens(),
  });
});

// Get specific token details
app.get('/api/tokens/:mint', (req, res) => {
  const details = trendDetector.getTokenDetails(req.params.mint);
  if (!details) {
    return res.status(404).json({ success: false, error: 'Token not found' });
  }
  res.json({ success: true, token: details });
});

// Get service stats
app.get('/api/stats', (req, res) => {
  const stats = trendDetector.getStats();
  if (pumpFunFeed) {
    stats.feed = pumpFunFeed.getStatus();
  }
  res.json({ success: true, stats });
});

// Get heuristics config
app.get('/api/heuristics', (req, res) => {
  res.json({
    success: true,
    heuristics: trendDetector.getHeuristics(),
  });
});

// Update heuristics
app.post('/api/heuristics', (req, res) => {
  const updated = trendDetector.updateHeuristics(req.body);
  res.json({ success: true, heuristics: updated });
});

// Reset heuristics to defaults
app.post('/api/heuristics/reset', (req, res) => {
  const defaults = trendDetector.resetHeuristics();
  res.json({ success: true, heuristics: defaults });
});

// ============================================
// AI ANALYSIS ENDPOINTS
// ============================================

// Get latest AI analysis
app.get('/api/ai/analysis', (req, res) => {
  if (!aiAnalyzer) {
    return res.status(503).json({ success: false, error: 'AI analyzer not available' });
  }
  const analysis = aiAnalyzer.getLatestAnalysis();
  const status = aiAnalyzer.getStatus();
  res.json({ success: true, analysis, status });
});

// Get AI analysis history
app.get('/api/ai/history', (req, res) => {
  if (!aiAnalyzer) {
    return res.status(503).json({ success: false, error: 'AI analyzer not available' });
  }
  res.json({ success: true, history: aiAnalyzer.getHistory() });
});

// Force immediate AI analysis
app.post('/api/ai/analyze', async (req, res) => {
  if (!aiAnalyzer) {
    return res.status(503).json({ success: false, error: 'AI analyzer not available' });
  }
  try {
    const analysis = await aiAnalyzer.forceAnalyze();
    res.json({ success: true, analysis });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Analyze images of top candidates
app.post('/api/ai/analyze-images', async (req, res) => {
  if (!aiAnalyzer) {
    return res.status(503).json({ success: false, error: 'AI analyzer not available' });
  }
  try {
    const candidates = trendDetector.getCandidates();
    const imageAnalysis = await aiAnalyzer.analyzeImages(candidates);
    res.json({ success: true, imageAnalysis });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get AI status
app.get('/api/ai/status', (req, res) => {
  if (!aiAnalyzer) {
    return res.json({ success: true, status: { enabled: false, reason: 'No API key' } });
  }
  res.json({ success: true, status: aiAnalyzer.getStatus() });
});

// SSE Stream for real-time updates
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // Send initial state
  res.write(`data: ${JSON.stringify({
    type: 'init',
    candidates: trendDetector.getCandidates(),
    stats: trendDetector.getStats(),
  })}\n\n`);
  
  sseClients.add(res);
  
  req.on('close', () => {
    sseClients.delete(res);
  });
});

// Broadcast to all SSE clients
function broadcast(event, data) {
  const message = JSON.stringify({ type: event, ...data });
  for (const client of sseClients) {
    client.write(`data: ${message}\n\n`);
  }
}

// ============================================
// INITIALIZE SERVICES
// ============================================

let pumpFunFeed = null;

// Start trend detector
trendDetector.start();

// Listen for trend detector events
trendDetector.on((event, data) => {
  const now = Date.now();
  switch (event) {
    case 'candidatesUpdated':
      broadcast('candidatesUpdated', { candidates: data.candidates.map(c => ({
        mint: c.mint,
        name: c.name,
        symbol: c.symbol,
        imageUrl: c.imageUrl,
        score: c.latestScore,
        uniqueBuyers: c.uniqueBuyers,
        totalBuys: c.totalBuys,
        totalSells: c.totalSells,
        solVolume: c.solVolume,
        status: c.status,
        ageMs: c.launchedAt ? now - c.launchedAt : 0,
        metrics: c.latestMetrics,
        twitter: c.twitter,
        telegram: c.telegram,
        website: c.website,
        description: c.description,
        creator: c.creator,
      }))});
      break;
    case 'tokenTracked':
      // Only log occasionally to reduce spam
      break;
    case 'aliveGatePassed':
      broadcast('aliveGatePassed', { mint: data.mint, symbol: data.tokenData?.symbol });
      break;
    case 'tokenDropped':
      broadcast('tokenDropped', { mint: data.mint, reason: data.reason });
      break;
  }
});

// Start PumpFun feed
pumpFunFeed = new PumpFunFeed(trendDetector);
pumpFunFeed.start();

// Start AI Analyzer (analyzes every 20 seconds)
aiAnalyzer = new AIAnalyzer(trendDetector);
aiAnalyzer.start(20000); // 20 second intervals

// Listen for AI analysis and broadcast
const originalAnalyze = aiAnalyzer.analyze.bind(aiAnalyzer);
aiAnalyzer.analyze = async function() {
  const result = await originalAnalyze();
  if (result) {
    broadcast('aiAnalysis', { analysis: result });
  }
  return result;
};

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                                                            ║');
  console.log('║   🔍 PUMP.FUN TREND DETECTOR SERVICE                       ║');
  console.log('║      🧠 AI NARRATIVE ANALYSIS ENABLED                      ║');
  console.log('║                                                            ║');
  console.log(`║   Running on: http://localhost:${PORT}                        ║`);
  console.log('║                                                            ║');
  console.log('║   Endpoints:                                               ║');
  console.log('║     GET  /api/candidates  - Top trending tokens            ║');
  console.log('║     GET  /api/tokens      - All tracked tokens             ║');
  console.log('║     GET  /api/stats       - Service statistics             ║');
  console.log('║     GET  /api/stream      - SSE real-time updates          ║');
  console.log('║     GET  /api/ai/analysis - Latest AI narrative analysis   ║');
  console.log('║     POST /api/ai/analyze  - Force AI analysis now          ║');
  console.log('║                                                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[TrendDetector] Shutting down...');
  trendDetector.stop();
  if (pumpFunFeed) pumpFunFeed.stop();
  if (aiAnalyzer) aiAnalyzer.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[TrendDetector] Shutting down...');
  trendDetector.stop();
  if (pumpFunFeed) pumpFunFeed.stop();
  if (aiAnalyzer) aiAnalyzer.stop();
  process.exit(0);
});
