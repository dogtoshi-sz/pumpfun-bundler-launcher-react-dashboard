/**
 * Comprehensive Debug Logger for API Server
 * Logs ALL requests, responses, WebSocket events, and errors to console AND file
 */

const fs = require('fs');
const path = require('path');

class DebugLogger {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.logToFile = options.logToFile !== false;
    this.logToConsole = options.logToConsole !== false;
    this.logDir = options.logDir || path.join(__dirname, '..', 'logs');
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024; // 10MB
    this.currentLogFile = null;
    this.requestCount = 0;
    
    // Ensure log directory exists
    if (this.logToFile && !fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
    
    // Create new log file on startup
    if (this.logToFile) {
      this.rotateLogFile();
    }
    
    console.log(`[DebugLogger] 🔍 Initialized (file: ${this.logToFile}, console: ${this.logToConsole})`);
  }
  
  rotateLogFile() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    this.currentLogFile = path.join(this.logDir, `api-debug-${timestamp}.log`);
    this.writeToFile(`\n${'='.repeat(80)}\n[${new Date().toISOString()}] New log session started\n${'='.repeat(80)}\n`);
  }
  
  writeToFile(message) {
    if (!this.logToFile || !this.currentLogFile) return;
    
    try {
      // Check file size and rotate if needed
      if (fs.existsSync(this.currentLogFile)) {
        const stats = fs.statSync(this.currentLogFile);
        if (stats.size > this.maxFileSize) {
          this.rotateLogFile();
        }
      }
      
      fs.appendFileSync(this.currentLogFile, message + '\n');
    } catch (e) {
      // Silently fail file writes
    }
  }
  
  formatTimestamp() {
    return new Date().toISOString();
  }
  
  formatObject(obj, maxDepth = 3) {
    try {
      return JSON.stringify(obj, (key, value) => {
        // Hide sensitive data
        if (['privateKey', 'secret', 'password', 'token', 'PRIVATE_KEY'].includes(key)) {
          return '[REDACTED]';
        }
        // Truncate long strings
        if (typeof value === 'string' && value.length > 500) {
          return value.slice(0, 500) + '...[truncated]';
        }
        return value;
      }, 2);
    } catch (e) {
      return `[Object: ${typeof obj}]`;
    }
  }
  
  // Log HTTP request
  // Endpoints that are too noisy for console (still logged to file)
  static QUIET_ENDPOINTS = [
    '/api/holder-wallets',
    '/api/deployer-wallet',
    '/api/current-run',
    '/api/settings',
    '/api/launch-wallet-info',
    '/api/next-pump-address',
    '/api/ai/status',
    '/api/ai/color-schemes',
    '/api/profit-loss',
    '/api/dune/pumpfun-volume',
    '/api/warming-wallets',      // Polling endpoint - very noisy
    '/api/token-info',           // Polling endpoint - noisy
    '/api/live-trades',          // Real-time updates - very noisy
    '/api/market-cap',           // Polling endpoint
    '/api/candidates',           // Trend detector polling
    '/api/tokens',               // Token list polling
    '/api/stats',                // Stats polling
    '/api/stream',               // SSE stream
    '/api/private-funding/status', // Bridge status polling
    '/api/vanity-pool-status',   // Polling endpoint - noisy
    // '/api/candles',           // Removed - using Birdeye charts instead
  ];
  
  logRequest(req) {
    if (!this.enabled) return;
    
    this.requestCount++;
    const reqId = this.requestCount;
    req._debugReqId = reqId;
    req._debugStartTime = Date.now();
    
    const logEntry = {
      timestamp: this.formatTimestamp(),
      type: 'REQUEST',
      reqId,
      method: req.method,
      path: req.path,
      url: req.originalUrl,
      query: Object.keys(req.query || {}).length > 0 ? req.query : undefined,
      body: Object.keys(req.body || {}).length > 0 ? req.body : undefined,
      headers: {
        'content-type': req.headers['content-type'],
        'user-agent': req.headers['user-agent']?.slice(0, 50),
      },
    };
    
    const message = `[${logEntry.timestamp}] ➡️  #${reqId} ${req.method} ${req.originalUrl}`;
    
    // Only log to console if NOT a quiet endpoint
    // Check both req.path and req.originalUrl to catch all variations
    const isQuiet = DebugLogger.QUIET_ENDPOINTS.some(ep => 
      req.path?.startsWith(ep) || req.originalUrl?.startsWith(ep)
    );
    if (this.logToConsole && !isQuiet) {
      console.log(message);
      if (logEntry.body && Object.keys(logEntry.body).length > 0) {
        console.log(`    Body: ${JSON.stringify(logEntry.body).slice(0, 200)}`);
      }
    }
    
    this.writeToFile(`\n${'-'.repeat(60)}\n${message}\n${this.formatObject(logEntry)}`);
    
    return reqId;
  }
  
  // Log HTTP response
  logResponse(req, res, body) {
    if (!this.enabled) return;
    
    const reqId = req._debugReqId || '?';
    const duration = req._debugStartTime ? Date.now() - req._debugStartTime : 0;
    
    const logEntry = {
      timestamp: this.formatTimestamp(),
      type: 'RESPONSE',
      reqId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      bodyPreview: typeof body === 'string' ? body.slice(0, 200) : undefined,
    };
    
    const statusEmoji = res.statusCode < 400 ? '✅' : '❌';
    const message = `[${logEntry.timestamp}] ${statusEmoji} #${reqId} ${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`;
    
    // Only log to console if error OR not a quiet endpoint
    // Check both req.path and req.originalUrl to catch all variations
    const isQuiet = DebugLogger.QUIET_ENDPOINTS.some(ep => 
      req.path?.startsWith(ep) || req.originalUrl?.startsWith(ep)
    );
    const isError = res.statusCode >= 400;
    if (this.logToConsole && (isError || !isQuiet)) {
      console.log(message);
    }
    
    this.writeToFile(`${message}\n${this.formatObject(logEntry)}`);
  }
  
  // Log WebSocket event
  logWebSocket(event, data) {
    if (!this.enabled) return;
    
    const logEntry = {
      timestamp: this.formatTimestamp(),
      type: 'WEBSOCKET',
      event,
      data: data ? this.formatObject(data) : undefined,
    };
    
    const message = `[${logEntry.timestamp}] 🔌 WS: ${event}`;
    
    if (this.logToConsole) {
      console.log(message);
    }
    
    this.writeToFile(`${message}\n${this.formatObject(logEntry)}`);
  }
  
  // Log trade event
  logTrade(trade) {
    if (!this.enabled) return;
    
    const message = `[${this.formatTimestamp()}] 💹 Trade: ${trade.type} ${trade.solAmount?.toFixed(4) || '?'} SOL by ${trade.fullTrader?.slice(0, 8) || '?'}... (${trade.isOurWallet ? 'OURS' : 'external'})`;
    
    if (this.logToConsole) {
      console.log(message);
    }
    
    this.writeToFile(message);
  }
  
  // Log P&L update
  logPnL(data) {
    if (!this.enabled) return;
    
    const message = `[${this.formatTimestamp()}] 💰 P&L Update: Ours(buys=${data.ourBuys?.toFixed(3)}, sells=${data.ourSells?.toFixed(3)}) External(net=${data.externalNet?.toFixed(3)})`;
    
    if (this.logToConsole) {
      console.log(message);
    }
    
    this.writeToFile(message);
  }
  
  // Log error
  logError(context, error) {
    const logEntry = {
      timestamp: this.formatTimestamp(),
      type: 'ERROR',
      context,
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
    };
    
    const message = `[${logEntry.timestamp}] ❌ ERROR in ${context}: ${error.message}`;
    
    console.error(message);
    if (error.stack) {
      console.error(error.stack.split('\n').slice(0, 3).join('\n'));
    }
    
    this.writeToFile(`\n${'!'.repeat(60)}\n${message}\n${this.formatObject(logEntry)}\n${'!'.repeat(60)}`);
  }
  
  // Log custom event
  log(category, message, data) {
    if (!this.enabled) return;
    
    const fullMessage = `[${this.formatTimestamp()}] [${category}] ${message}`;
    
    if (this.logToConsole) {
      console.log(fullMessage);
      if (data) console.log(`    Data: ${JSON.stringify(data).slice(0, 200)}`);
    }
    
    this.writeToFile(`${fullMessage}${data ? '\n' + this.formatObject(data) : ''}`);
  }
  
  // Express middleware
  middleware() {
    return (req, res, next) => {
      // Log request
      this.logRequest(req);
      
      // Track if we've already logged the response (prevent double-logging)
      let responseLogged = false;
      
      // Capture response - only log once
      const originalSend = res.send;
      res.send = (body) => {
        if (!responseLogged) {
          responseLogged = true;
          this.logResponse(req, res, body);
        }
        return originalSend.call(res, body);
      };
      
      const originalJson = res.json;
      res.json = (body) => {
        if (!responseLogged) {
          responseLogged = true;
          this.logResponse(req, res, JSON.stringify(body));
        }
        return originalJson.call(res, body);
      };
      
      next();
    };
  }
  
  // Get current log file path
  getLogFilePath() {
    return this.currentLogFile;
  }
  
  // Get all log files
  getLogFiles() {
    if (!fs.existsSync(this.logDir)) return [];
    return fs.readdirSync(this.logDir)
      .filter(f => f.startsWith('api-debug-') && f.endsWith('.log'))
      .map(f => ({
        name: f,
        path: path.join(this.logDir, f),
        size: fs.statSync(path.join(this.logDir, f)).size,
        modified: fs.statSync(path.join(this.logDir, f)).mtime,
      }))
      .sort((a, b) => b.modified - a.modified);
  }
}

// Singleton instance
const debugLogger = new DebugLogger({
  enabled: true,
  logToFile: true,
  logToConsole: true,
});

module.exports = { DebugLogger, debugLogger };
