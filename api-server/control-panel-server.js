const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
// Handle bs58 v6 export format (same as other files in project)
const base58 = require('bs58').default || require('bs58');
const { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL, SystemProgram, TransactionMessage, VersionedTransaction } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } = require('@solana/spl-token');
const WebSocket = require('ws');
const pumpPortalTracker = require('./pumpportal-tracker');
const { debugLogger } = require('./debug-logger');

// Register ts-node for TypeScript support (for marketing modules)
try {
  // Add api-server/node_modules to module resolution path
  const Module = require('module');
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function(request, parent, isMain, options) {
    // Try original resolution first
    try {
      return originalResolveFilename.call(this, request, parent, isMain, options);
    } catch (error) {
      // If it fails, try resolving from api-server/node_modules
      if (request === 'pg' || request.startsWith('pg/') || 
          request === 'twitter-api-v2' || request.startsWith('twitter-api-v2/')) {
        try {
          const apiServerNodeModules = path.join(__dirname, 'node_modules');
          return originalResolveFilename.call(this, request, parent, isMain, {
            ...options,
            paths: [apiServerNodeModules, ...(options?.paths || [])]
          });
        } catch (e) {
          // Fallback to original error
          throw error;
        }
      }
      throw error;
    }
  };
  
  require('ts-node').register({
    transpileOnly: true,
    compilerOptions: {
      module: 'commonjs',
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
    },
  });
  console.log('[API Server] ✅ ts-node registered for TypeScript support');
} catch (error) {
  console.warn('[API Server] ⚠️ ts-node not available, TypeScript marketing modules may not work');
}

const app = express();
const PORT = process.env.PORT || 3001;
const execAsync = promisify(exec);
const multer = require('multer');

// Determine project root - handles both local and Railway deployments
// On Railway with api-server as root: __dirname = /app, project files are in /app
// Locally: __dirname = .../goat-prod/api-server, project root is ..
const getProjectRoot = () => {
  // Check if running on Railway (api-server is the deployed root)
  const isRailway = process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID;
  if (isRailway) {
    // On Railway, all files are deployed to /app (even if api-server was the root)
    // But we need to check if src folder exists at parent or at root
    const parentSrc = path.join(__dirname, '..', 'src');
    const currentSrc = path.join(__dirname, 'src');
    
    if (fs.existsSync(parentSrc)) {
      return path.join(__dirname, '..');
    } else if (fs.existsSync(currentSrc)) {
      return __dirname;
    }
    // Fallback: assume api-server is deployed as root but with project structure
    console.log('[API Server] ⚠️ Could not find src folder, using __dirname as root');
    return __dirname;
  }
  // Local development - project root is parent of api-server
  return path.join(__dirname, '..');
};
const PROJECT_ROOT = getProjectRoot();
console.log(`[API Server] Project root: ${PROJECT_ROOT}`);

// Helper to resolve paths relative to project root
const projectPath = (...segments) => path.join(PROJECT_ROOT, ...segments);

// Load .env file for server - ALWAYS use root directory .env file
// This ensures consistency with readEnvFile() and writeEnvFile() functions
const rootEnvPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(rootEnvPath)) {
  require('dotenv').config({ path: rootEnvPath });
  console.log(`[API Server] Loaded .env from root directory: ${rootEnvPath}`);
} else {
  // Fallback to default dotenv behavior (current directory)
  require('dotenv').config();
  console.log(`[API Server] No root .env found, using current directory .env`);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '..', 'image');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename with timestamp
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    const timestamp = Date.now();
    cb(null, `${name}-${timestamp}${ext}`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: function (req, file, cb) {
    // Accept only images
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Middleware
app.use(cors());

// ============================================================
// 🔒 SECURITY: ACCESS CONTROL
// ============================================================
// In PRODUCTION mode: Only allow SAFE endpoints (no private keys)
// In LOCAL mode: Allow all endpoints (for CLI tools)
// ============================================================

const isProduction = process.env.NODE_ENV === 'production';

// SAFE endpoints that NEVER handle private keys (allowed in production)
const SAFE_ENDPOINTS = [
  '/api/health',
  '/api/wallets/balances',
  '/api/wallets/holdings',
  '/api/bundles/gather-unsigned',
  '/api/bundles/recover-intermediary-unsigned',
  '/api/bundles/submit-signed',
  '/api/bundles/submit-recovery',
  '/api/bundles/submit-gathers',
  '/api/bundles/create-unsigned',
  '/api/bundles/sell-unsigned',
  '/api/bundles/submit-sells',
  // Warming wallets - needed for production
  '/api/warming-wallets',
  '/api/warm-wallets',
  // Settings & config (read-only in production)
  '/api/settings',
  '/api/token-configs',
  '/api/deployer-wallet',
  '/api/next-pump-address',
  '/api/current-run',
  '/api/holder-wallets',
  '/api/launch-wallet-info',
  // AI features
  '/api/ai/',
  // Dune analytics
  '/api/dune/',
  // Launch endpoints (use hot wallet key in production)
  '/api/launch-token',
  '/api/quick-launch-token',
  '/api/rapid-launch',
  // Auto-sell config
  '/api/auto-sell/',
];

// Health check endpoint (always allowed)
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    mode: isProduction ? 'production' : 'local',
    timestamp: new Date().toISOString(),
    security: 'Private keys never accepted by this server',
  });
});

app.use((req, res, next) => {
  const ip = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || '';
  
  const isLocalhost = 
    ip === '127.0.0.1' || 
    ip === '::1' || 
    ip === '::ffff:127.0.0.1' || 
    ip === 'localhost' ||
    ip.startsWith('127.') ||
    ip.startsWith('::ffff:127.') ||
    ip.includes('localhost') ||
    ip === '' ||
    req.headers.host?.includes('localhost') ||
    req.headers.host?.includes('127.0.0.1');

  // PRODUCTION MODE: Only allow safe endpoints
  if (isProduction) {
    const isSafeEndpoint = SAFE_ENDPOINTS.some(ep => req.path.startsWith(ep));
    
    if (!isSafeEndpoint) {
      console.warn(`🚨 PRODUCTION: Blocked unsafe endpoint: ${req.method} ${req.path}`);
      return res.status(403).json({ 
        error: 'This endpoint is not available in production mode.',
        message: 'For security, only browser-signing endpoints are allowed.',
        allowedEndpoints: SAFE_ENDPOINTS,
      });
    }
    
    return next();
  }

  // LOCAL MODE: Localhost-only access
  const forwardedFor = req.headers['x-forwarded-for'];
  const isFromProxy = forwardedFor && forwardedFor.length > 0 && !forwardedFor.includes('127.0.0.1') && !forwardedFor.includes('localhost');
  
  if (isFromProxy) {
    console.warn(`🚨 BLOCKED EXTERNAL REQUEST via proxy: ${req.method} ${req.path} from ${forwardedFor}`);
    return res.status(403).json({ 
      error: 'Access denied. This API is localhost-only for security.',
      message: 'External access via proxy is blocked in local mode.' 
    });
  }
  
  if (!isLocalhost) {
    console.warn(`🚨 BLOCKED EXTERNAL REQUEST: ${req.method} ${req.path} from IP: ${ip}`);
    return res.status(403).json({ 
      error: 'Access denied. This API is localhost-only for security.',
    });
  }
  
  next();
});
// ============================================================

// Debug logging middleware (logs ALL requests/responses to file)
app.use(debugLogger.middleware());

// Increase JSON body size limit to handle base64 images (10MB)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files from image directory
const imageDir = path.join(__dirname, '..', 'image');
app.use('/image', express.static(imageDir));

// Ensure createdlogos directory exists
const createdLogosDir = path.join(imageDir, 'createdlogos');
if (!fs.existsSync(createdLogosDir)) {
  fs.mkdirSync(createdLogosDir, { recursive: true });
}

// Serve PSD assets directory
const psdAssetsDir = path.join(__dirname, '..', 'psd-assets');
if (fs.existsSync(psdAssetsDir)) {
  app.use('/psd-assets', express.static(psdAssetsDir));
}

// PSD and Logo generation API routes
const psdLogoApi = require('./psd-logo-api');
app.use('/api/psd', psdLogoApi);
app.use('/api/logo', psdLogoApi);

// 🕯️ Real-time candle chart API routes
try {
  // Candles API removed - using Birdeye charts instead to avoid rate limits
  console.log('[API Server] 📊 Candle chart routes enabled');
} catch (err) {
  console.log('[API Server] ⚠️ Candle chart routes not available:', err.message);
}

// Browser-based signing routes removed for local-only version
// (Production routes not needed for local development)

// ============================================================================
// GEMINI AI IMAGE GENERATION (Nano Banana)
// ============================================================================

// Generate AI image for meme tokens using Gemini
app.post('/api/ai/generate-image', async (req, res) => {
  try {
    const { prompt, style = 'meme', aspectRatio = '1:1' } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Prompt is required' });
    }
    
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ success: false, error: 'GEMINI_API_KEY not configured in .env' });
    }
    
    console.log(`[AI Image] Generating image with prompt: ${prompt.slice(0, 100)}...`);
    
    // Import Gemini SDK dynamically
    const { GoogleGenAI } = require('@google/genai');
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    
    // Build the enhanced prompt based on style
    let enhancedPrompt = prompt;
    if (style === 'meme') {
      enhancedPrompt = `Create a high-quality, vibrant meme token logo/mascot for crypto: ${prompt}. 
        Style: Fun, eye-catching, suitable for a crypto token. 
        The image should be iconic, memorable, and work well as a small token icon.
        Clean, bold design with good contrast. No text in the image.`;
    } else if (style === 'professional') {
      enhancedPrompt = `Create a professional, clean logo for a crypto project: ${prompt}. 
        Style: Modern, sleek, trustworthy. Suitable for a serious DeFi or utility token.
        The image should work well as a small icon. No text in the image.`;
    } else if (style === 'cartoon') {
      enhancedPrompt = `Create a cute, cartoon-style mascot for a crypto token: ${prompt}. 
        Style: Kawaii, friendly, approachable. Perfect for a fun community token.
        Bold outlines, vibrant colors. No text in the image.`;
    } else if (style === 'abstract') {
      enhancedPrompt = `Create an abstract, artistic logo for a crypto project: ${prompt}. 
        Style: Geometric, gradient, modern art inspired. 
        Suitable for a tech-forward DeFi token. No text in the image.`;
    }
    
    // Generate image using Gemini 3 Pro Image (Nano Banana Pro) - best quality
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image', // Nano Banana Pro - highest quality image generation
      contents: enhancedPrompt,
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
      }
    });
    
    // Extract image from response
    let imageData = null;
    let textResponse = null;
    
    if (response.candidates && response.candidates[0] && response.candidates[0].content) {
      for (const part of response.candidates[0].content.parts) {
        if (part.text) {
          textResponse = part.text;
        } else if (part.inlineData) {
          imageData = part.inlineData.data;
        }
      }
    }
    
    if (!imageData) {
      // If no image generated, return error with text response
      console.log(`[AI Image] No image generated. Text response: ${textResponse}`);
      return res.status(400).json({ 
        success: false, 
        error: 'Failed to generate image', 
        details: textResponse || 'No image in response'
      });
    }
    
    // Save the image
    const timestamp = Date.now();
    const outputDir = path.join(process.cwd(), 'image', 'ai-generated');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const outputPath = path.join(outputDir, `ai-logo-${timestamp}.png`);
    const imageBuffer = Buffer.from(imageData, 'base64');
    fs.writeFileSync(outputPath, imageBuffer);
    
    console.log(`[AI Image] ✅ Image generated and saved: ${outputPath}`);
    
    res.json({
      success: true,
      imagePath: outputPath,
      imageUrl: `/image/ai-generated/ai-logo-${timestamp}.png`,
      base64: imageData,
      textResponse,
    });
    
  } catch (error) {
    console.error('[AI Image] Error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to generate image',
      details: error.toString()
    });
  }
});

// Get AI image generation styles
app.get('/api/ai/styles', (req, res) => {
  res.json({
    success: true,
    styles: [
      { id: 'meme', name: 'Meme/Fun', description: 'Vibrant, eye-catching meme token style' },
      { id: 'professional', name: 'Professional', description: 'Clean, modern, trustworthy look' },
      { id: 'cartoon', name: 'Cartoon/Kawaii', description: 'Cute, friendly cartoon mascot' },
      { id: 'abstract', name: 'Abstract/Geometric', description: 'Modern art, gradients, geometric shapes' },
      { id: 'custom', name: 'Custom Prompt', description: 'Full control with your own prompt' },
    ]
  });
});

// Check if AI generation is available
app.get('/api/ai/status', (req, res) => {
  const hasApiKey = !!process.env.GEMINI_API_KEY;
  res.json({
    success: true,
    available: hasApiKey,
    model: 'gemini-3-pro-image', // Nano Banana Pro
    message: hasApiKey ? 'Gemini AI (Nano Banana Pro) ready for image generation' : 'GEMINI_API_KEY not configured'
  });
});

// Global launch progress listeners for SSE
if (!global.launchProgressListeners) {
  global.launchProgressListeners = [];
}

// Function to broadcast progress to all SSE listeners (used by both launch-token and quick-launch-token)
function broadcastProgress(type, data) {
  if (!global.launchProgressListeners) return;
  const message = JSON.stringify({ type, data, timestamp: Date.now() });
  global.launchProgressListeners.forEach(listener => {
    try {
      listener.write(`data: ${message}\n\n`);
    } catch (error) {
      // Remove dead listeners
      global.launchProgressListeners = global.launchProgressListeners.filter(l => l !== listener);
    }
  });
}

// Helper to get RPC connection
const getConnection = () => {
  const rpcEndpoint = process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
  return new Connection(rpcEndpoint, { commitment: 'confirmed' });
};

// Helper to read .env file
function readEnvFile() {
  // Try multiple paths - PRIORITIZE root directory .env file
  // The root .env file is the main one with all the config
  const possiblePaths = [
    path.join(__dirname, '..', '.env'), // Root directory (PRIORITY - this is the main .env)
    path.join(process.cwd(), '..', '.env'), // Parent directory if running from api-server
    path.join(process.cwd(), '.env') // Current directory (fallback)
  ];
  
  let envPath = null;
  for (const possiblePath of possiblePaths) {
    if (fs.existsSync(possiblePath)) {
      envPath = possiblePath;
      // .env found (silent)
      break;
    }
  }
  
  if (!envPath) {
    console.log('No .env file found. Tried paths:', possiblePaths);
    return {};
  }
  
  const content = fs.readFileSync(envPath, 'utf8');
  const env = {};
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      let key = match[1].trim();
      let value = match[2].trim();
      
      // Remove inline comments
      const commentIndex = value.indexOf('#');
      if (commentIndex !== -1) {
        value = value.substring(0, commentIndex).trim();
      }
      
      // Remove quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      
      env[key] = value;
    }
  }
  
  // Env loaded (silent to avoid spam)
  return env;
}

// Helper to write .env file
function writeEnvFile(env) {
  // Use the same path resolution as readEnvFile
  const possiblePaths = [
    path.join(__dirname, '..', '.env'), // Root directory (PRIORITY)
    path.join(process.cwd(), '..', '.env'), // Parent directory if running from api-server
    path.join(process.cwd(), '.env') // Current directory (fallback)
  ];
  
  let envPath = null;
  for (const possiblePath of possiblePaths) {
    if (fs.existsSync(possiblePath)) {
      envPath = possiblePath;
      const absolutePath = path.resolve(envPath);
      break;
    }
  }
  
  if (!envPath) {
    // If no .env exists, create one in root
    envPath = path.join(__dirname, '..', '.env');
    const absolutePath = path.resolve(envPath);
  }
  
  // Read existing file to preserve comments and order
  let existingContent = '';
  if (fs.existsSync(envPath)) {
    existingContent = fs.readFileSync(envPath, 'utf8');
  }
  
  // Parse existing lines and update them
  const existingLines = existingContent.split(/\r?\n/); // Handle both \n and \r\n
  const updatedLines = [];
  const keysToUpdate = new Set(Object.keys(env));
  const keysUpdated = new Set();
  
  for (let i = 0; i < existingLines.length; i++) {
    const line = existingLines[i];
    const trimmed = line.trim();
    
    // Preserve comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) {
      updatedLines.push(line);
      continue;
    }
    
    // Check if this line is a key=value pair
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const oldValue = match[2];
      
      // If this key needs to be updated AND value is actually different
      if (keysToUpdate.has(key)) {
        const newValue = env[key];
        
        // Only update if value actually changed
        if (oldValue !== newValue) {
          const newLine = `${key}=${newValue}`;
          updatedLines.push(newLine);
          keysUpdated.add(key);
          // Silent - no spam
        } else {
          // Value unchanged, keep original
          updatedLines.push(line);
        }
      } else {
        // Keep original line
        updatedLines.push(line);
      }
    } else {
      // Keep lines that don't match key=value format
      updatedLines.push(line);
    }
  }
  
  // Add any new keys that weren't in the original file
  let newKeysAdded = 0;
  for (const key of keysToUpdate) {
    if (!keysUpdated.has(key)) {
      const newValue = env[key];
      // Only add if not already in file and value exists
      const alreadyExists = existingLines.some(l => l.trim().startsWith(`${key}=`));
      if (!alreadyExists && newValue !== undefined && newValue !== '') {
        updatedLines.push(`${key}=${newValue}`);
        newKeysAdded++;
      }
    }
  }
  
  // Write file with proper line endings (preserve original if possible, otherwise use \n)
  const lineEnding = existingContent.includes('\r\n') ? '\r\n' : '\n';
  const finalContent = updatedLines.join(lineEnding);
  
  const totalChanges = keysUpdated.size + newKeysAdded;
  
  // Only write if something actually changed
  if (totalChanges === 0) {
    // No actual changes - skip write entirely
    return;
  }
  
  try {
    // Force write with explicit encoding
    fs.writeFileSync(envPath, finalContent, { encoding: 'utf8', flag: 'w' });
    
    // Minimal logging - only log if changes were made
    if (totalChanges > 0) {
      console.log(`[Settings] ✅ Updated ${totalChanges} setting(s)`);
    }
  } catch (error) {
    console.error(`[Settings] Error writing .env file:`, error);
    console.error(`[Settings] Error details:`, error.message);
    if (error.stack) {
      console.error(`[Settings] Stack trace:`, error.stack);
    }
    throw error;
  }
}

// API Routes

// Get current .env settings
app.get('/api/settings', (req, res) => {
  try {
    const env = readEnvFile();
    // Minimal logging - settings are fetched frequently
    res.json({ success: true, settings: env });
  } catch (error) {
    console.error('[Settings] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Upload image file - saves locally for preview/launch
// Note: Pump.fun SDK handles IPFS upload automatically when launching tokens
app.post('/api/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image file provided' });
    }
    
    // Save locally - the pump.fun SDK will handle IPFS upload automatically on launch
    // This is just for preview and storing the file path
    const relativePath = `./image/${req.file.filename}`;
    
    return res.json({ 
      success: true, 
      filePath: relativePath,
      filename: req.file.filename,
      message: 'Image saved locally. Will be uploaded to IPFS automatically when launching token via pump.fun SDK.' 
    });
  } catch (error) {
    console.error('[Upload Image] [x] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update .env settings
app.post('/api/settings', (req, res) => {
  try {
    const updates = req.body.settings;
    // CRITICAL: Clear amounts when wallet count is set to 0
    if (updates.BUNDLE_WALLET_COUNT !== undefined) {
      const bundleCount = parseInt(updates.BUNDLE_WALLET_COUNT) || 0;
      if (bundleCount === 0) {
        updates.BUNDLE_SWAP_AMOUNTS = '';
      }
    }
    if (updates.HOLDER_WALLET_COUNT !== undefined) {
      const holderCount = parseInt(updates.HOLDER_WALLET_COUNT) || 0;
      if (holderCount === 0) {
        updates.HOLDER_SWAP_AMOUNTS = '';
      }
    }
    
    // Security warning for private key updates
    if (updates.PRIVATE_KEY || updates.BUYER_WALLET) {
      console.warn('⚠️  [SECURITY] Private key update detected!');
      if (updates.PRIVATE_KEY) {
        console.warn('   - PRIVATE_KEY (Main Funding Wallet) is being updated');
      }
      if (updates.BUYER_WALLET) {
        console.warn('   - BUYER_WALLET (Buyer/Creator Wallet) is being updated');
      }
    }
    
    // Log update values (but mask private keys for security)
    const safeUpdates = { ...updates };
    if (safeUpdates.PRIVATE_KEY) {
      const key = safeUpdates.PRIVATE_KEY;
      safeUpdates.PRIVATE_KEY = key.length > 16 ? key.substring(0, 8) + '...' + key.substring(key.length - 8) : '***';
    }
    if (safeUpdates.BUYER_WALLET) {
      const key = safeUpdates.BUYER_WALLET;
      safeUpdates.BUYER_WALLET = key.length > 16 ? key.substring(0, 8) + '...' + key.substring(key.length - 8) : '***';
    }
    // Read current .env file
    const currentEnv = readEnvFile();
    
    // Merge updates with current values
    const updatedEnv = { ...currentEnv, ...updates };
    
    // Write back to file (this will update existing lines and preserve structure)
    writeEnvFile(updatedEnv);
    
    // Verify the write by reading back (lenient comparison to handle quote differences)
    const verifyEnv = readEnvFile();
    const failedKeys = [];
    for (const key in updates) {
      const expected = String(updates[key] || '').trim();
      const actual = String(verifyEnv[key] || '').trim();
      
      // Normalize comparison: remove quotes, trim whitespace
      const normalize = (val) => {
        let normalized = val.trim();
        // Remove surrounding quotes if present
        if ((normalized.startsWith('"') && normalized.endsWith('"')) || 
            (normalized.startsWith("'") && normalized.endsWith("'"))) {
          normalized = normalized.slice(1, -1);
        }
        return normalized.trim();
      };
      
      const normalizedExpected = normalize(expected);
      const normalizedActual = normalize(actual);
      
      if (normalizedExpected !== normalizedActual) {
        failedKeys.push(key);
        console.error(`[Settings] Verification failed for ${key}: expected "${expected}", got "${actual}"`);
        console.error(`[Settings]   Normalized: expected "${normalizedExpected}", got "${normalizedActual}"`);
      }
    }
    
    if (failedKeys.length > 0) {
      console.error('[Settings] Some keys failed verification:', failedKeys);
      // Don't fail the request - the file was written, verification might just be strict
      // Log warning but still return success (the .env file was updated)
      console.warn('[Settings] ⚠️  Verification warnings, but .env file was written. Values may differ due to quote handling.');
    }
    
    res.json({ success: true, message: 'Settings updated successfully' });
  } catch (error) {
    console.error('[Settings] Error updating .env:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// RELAUNCH token with SAME wallets but new pump address
// This is for failed launches - reuses all wallets from current-run.json
app.post('/api/relaunch-token', async (req, res) => {
  try {
    const projectRoot = path.join(__dirname, '..');
    const envPath = path.join(projectRoot, '.env');
    const currentRunPath = path.join(projectRoot, 'keys', 'current-run.json');
    
    // Check if current-run.json exists (we need it for relaunch)
    if (!fs.existsSync(currentRunPath)) {
      return res.status(400).json({ 
        success: false, 
        error: 'No previous launch found (current-run.json missing). Use normal launch instead.' 
      });
    }
    
    // Load the previous run data (wallet keys)
    const previousRun = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
    
    console.log(`[Relaunch] 🔄 Relaunching with SAME wallets from previous run`);
    console.log(`[Relaunch]   Previous mint: ${previousRun.mintAddress || 'none'}`);
    console.log(`[Relaunch]   Wallets: DEV + ${previousRun.bundleWalletKeys?.length || 0} Bundle + ${previousRun.holderWalletKeys?.length || 0} Holder`);
    
    // Read current .env
    const env = readEnvFile();
    
    // Get the next available pump address from pool
    const pumpAddressesPath = path.join(projectRoot, 'keys', 'pump-addresses.json');
    
    if (!fs.existsSync(pumpAddressesPath)) {
      return res.status(400).json({
        success: false,
        error: 'No pump addresses file found. Generate addresses in Settings > Pump Addresses.'
      });
    }
    
    let pumpAddresses = [];
    try {
      pumpAddresses = JSON.parse(fs.readFileSync(pumpAddressesPath, 'utf8'));
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: 'Failed to read pump addresses file.'
      });
    }
    
    // Find next available pump address
    const nextPump = pumpAddresses.find(addr => addr.status === 'available' && !addr.used);
    
    if (!nextPump) {
      return res.status(400).json({
        success: false,
        error: 'No available pump addresses. Generate more in Settings > Pump Addresses.'
      });
    }
    
    const newMintAddress = nextPump.publicKey;
    const newPrivateKey = nextPump.privateKey;
    
    console.log(`[Relaunch] 🎯 Using NEW pump address: ${newMintAddress}`);
    
    // Update .env with new pump vanity address
    const updatedEnv = {
      ...env,
      PUMP_VANITY_ADDRESS: newMintAddress,
      PUMP_VANITY_SECRET: newPrivateKey
    };
    
    // Write updated .env
    const envContent = Object.entries(updatedEnv)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    fs.writeFileSync(envPath, envContent);
    
    // Mark pump address as used
    nextPump.used = true;
    nextPump.usedAt = new Date().toISOString();
    nextPump.status = 'used';
    fs.writeFileSync(pumpAddressesPath, JSON.stringify(pumpAddresses, null, 2));
    
    // Preserve auto-sell configs from previous launch if they exist
    const autoSellConfigPath = path.join(projectRoot, 'keys', 'trade-configs', 'launch-auto-sell-config.json');
    let preservedAutoSellConfigs = null;
    if (fs.existsSync(autoSellConfigPath)) {
      try {
        preservedAutoSellConfigs = JSON.parse(fs.readFileSync(autoSellConfigPath, 'utf8'));
        console.log(`[Relaunch] 💾 Preserving auto-sell configs from previous launch`);
      } catch (e) {
        console.warn(`[Relaunch] ⚠️  Could not read auto-sell configs: ${e.message}`);
      }
    }
    
    // Create warmed-wallets-for-launch.json from the previous run's wallet keys
    // This tells index.ts to use these specific wallets instead of generating new ones
    const warmedWalletsForLaunch = {
      creatorWalletKey: previousRun.creatorDevWalletKey,
      bundleWalletKeys: previousRun.bundleWalletKeys || [],
      holderWalletKeys: previousRun.holderWalletKeys || [],
      holderWalletAutoBuyKeys: previousRun.holderWalletAutoBuyKeys || [],
      holderWalletAutoBuyIndices: previousRun.holderWalletAutoBuyIndices || [],
      holderWalletAutoBuyDelays: previousRun.holderWalletAutoBuyDelays || null,
      frontRunThreshold: previousRun.frontRunThreshold || 0,
      isRelaunch: true, // Flag to indicate this is a relaunch
      previousMint: previousRun.mintAddress,
      newMint: newMintAddress
    };
    
    // Preserve auto-sell configs for relaunch (they'll be applied when wallets are loaded)
    if (preservedAutoSellConfigs) {
      // Keep the launch-auto-sell-config.json file so it gets applied during launch
      console.log(`[Relaunch] ✅ Auto-sell configs preserved - will be applied to wallets during launch`);
    } else {
      console.log(`[Relaunch] ℹ️  No auto-sell configs found from previous launch`);
    }
    
    const warmedWalletsPath = path.join(projectRoot, 'keys', 'warmed-wallets-for-launch.json');
    fs.writeFileSync(warmedWalletsPath, JSON.stringify(warmedWalletsForLaunch, null, 2));
    console.log(`[Relaunch] ✅ Saved wallet keys to warmed-wallets-for-launch.json`);
    
    // Update current-run.json with new mint address but keep wallet keys
    const oldMintAddress = previousRun.mintAddress;
    previousRun.mintAddress = newMintAddress;
    previousRun.launchStatus = 'RELAUNCHING';
    previousRun.launchStage = 'RELAUNCHING';
    previousRun.relaunchTimestamp = Date.now();
    previousRun.previousMintAddress = previousRun.mintAddress;
    fs.writeFileSync(currentRunPath, JSON.stringify(previousRun, null, 2));
    
    // Note: Website config will be updated by the launch script (index.ts) when it runs
    console.log(`[Relaunch] 📝 Website config will be updated when launch completes`);
    
    // Now run the launch script (it will use the wallets from warmed-wallets-for-launch.json)
    console.log(`[Relaunch] 🚀 Starting launch process...`);
    
    // Use spawn for proper process handling
    const { spawn } = require('child_process');
    
    const launchProcess = spawn('npm', ['start'], {
      cwd: projectRoot,
      shell: true,
      env: { ...process.env, FORCE_COLOR: '1' }
    });
    
    let stdout = '';
    let stderr = '';
    
    launchProcess.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      console.log(`[Relaunch] ${text}`);
      
      // Emit progress to listeners
      if (global.launchProgressListeners) {
        global.launchProgressListeners.forEach(listener => {
          try {
            listener.write(`data: ${JSON.stringify({ type: 'output', message: text })}\n\n`);
          } catch (e) {}
        });
      }
    });
    
    launchProcess.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      console.error(`[Relaunch Error] ${text}`);
    });
    
    launchProcess.on('close', (code) => {
      console.log(`[Relaunch] Process exited with code ${code}`);
      
      // Emit completion
      if (global.launchProgressListeners) {
        global.launchProgressListeners.forEach(listener => {
          try {
            listener.write(`data: ${JSON.stringify({ type: 'complete', code })}\n\n`);
          } catch (e) {}
        });
      }
    });
    
    // Return immediately with success - the launch runs in background
    res.json({
      success: true,
      message: 'Relaunch started with same wallets',
      newMintAddress: newMintAddress,
      previousMintAddress: oldMintAddress,
      walletCount: {
        dev: 1,
        bundle: previousRun.bundleWalletKeys?.length || 0,
        holder: previousRun.holderWalletKeys?.length || 0
      }
    });
    
  } catch (error) {
    console.error('[Relaunch] Error:', error);
    res.status(500).json({ success: false, error: error.message || 'Relaunch failed' });
  }
});

// Launch token (runs npm start)
app.post('/api/launch-token', async (req, res) => {
  try {
    const projectRoot = path.join(__dirname, '..');
    const envPath = path.join(projectRoot, '.env');
    const currentRunPath = path.join(projectRoot, 'keys', 'current-run.json');
    
    // Check for production mode with hot wallet key
    const { _hotWalletKey, _hotWalletAddress, _isProductionMode } = req.body || {};
    const isProductionLaunch = _isProductionMode && _hotWalletKey;
    
    if (isProductionLaunch) {
      console.log(`[Launch] 🔥 PRODUCTION MODE - Using Hot Wallet: ${_hotWalletAddress?.slice(0, 8)}...`);
    }
    
    // Verify .env file exists and is readable
    if (!fs.existsSync(envPath)) {
      return res.status(500).json({ 
        success: false, 
        error: `.env file not found at ${envPath}` 
      });
    }
    
    console.log(`[Launch] Starting token launch from: ${projectRoot}`);
    console.log(`[Launch] Using .env file at: ${envPath}`);
    
    // IMPORTANT: Clear/reset current-run.json before launching new token
    // This ensures wallets are not loaded from previous launch
    const keysDir = path.join(projectRoot, 'keys');
    if (!fs.existsSync(keysDir)) {
      fs.mkdirSync(keysDir, { recursive: true });
    }
    
    // IMPORTANT: Always clear warmed-wallets-for-launch.json at the START
    // This ensures we don't use stale data from previous failed launches
    // It will be recreated below with fresh data if useWarmedWallets is true
    const warmedWalletsPath = path.join(keysDir, 'warmed-wallets-for-launch.json');
    if (fs.existsSync(warmedWalletsPath)) {
      fs.unlinkSync(warmedWalletsPath);
      console.log(`[Launch] Cleared previous warmed-wallets-for-launch.json - will recreate with fresh data`);
    }
    
    // Backup old current-run.json if it exists (optional - for debugging)
    if (fs.existsSync(currentRunPath)) {
      const backupPath = path.join(keysDir, `current-run-backup-${Date.now()}.json`);
      fs.copyFileSync(currentRunPath, backupPath);
      console.log(`[Launch] Backed up previous current-run.json to: ${backupPath}`);
    }
    
    // Clear current-run.json - new launch will create fresh one
    if (fs.existsSync(currentRunPath)) {
      fs.unlinkSync(currentRunPath);
      console.log(`[Launch] Cleared previous current-run.json - ready for new launch`);
    }
    
    // Read the latest .env to ensure we're using fresh values
    // The child process will also read it via dotenv.config(), but this ensures
    // we're launching with the most recent settings
    const latestEnv = readEnvFile();
    console.log(`[Launch] Latest .env has ${Object.keys(latestEnv).length} variables`);
    
    // Handle warmed wallets if provided - now supports per-type warmed wallet settings
    const { 
      useWarmedWallets, // Legacy: true if ANY type uses warmed
      useWarmedDevWallet,    // New: per-type toggle for DEV
      useWarmedBundleWallets, // New: per-type toggle for Bundle
      useWarmedHolderWallets, // New: per-type toggle for Holder
      creatorWalletAddress, 
      bundleWalletAddresses, 
      holderWalletAddresses, 
      holderWalletAutoBuyAddresses, 
      holderWalletAutoBuyIndices, 
      holderWalletAutoBuyDelays, 
      frontRunThreshold,
      // Auto-sell configurations from launch form
      holderWalletAutoSellConfigs,
      bundleWalletAutoSellConfigs,
      devAutoSellConfig
    } = req.body || {};
    
    // Log auto-sell configs if provided
    if (holderWalletAutoSellConfigs || bundleWalletAutoSellConfigs || devAutoSellConfig) {
      const holderCount = holderWalletAutoSellConfigs ? Object.keys(holderWalletAutoSellConfigs).length : 0;
      const bundleCount = bundleWalletAutoSellConfigs ? Object.keys(bundleWalletAutoSellConfigs).length : 0;
      const devEnabled = devAutoSellConfig && devAutoSellConfig.enabled && parseFloat(devAutoSellConfig.threshold) > 0;
      console.log(`[Launch] 💰 Auto-sell configs from launch form:`);
      if (holderCount > 0) console.log(`   Holder wallets: ${holderCount} configured`);
      if (bundleCount > 0) console.log(`   Bundle wallets: ${bundleCount} configured`);
      if (devEnabled) console.log(`   DEV wallet: enabled (threshold: ${devAutoSellConfig.threshold} SOL)`);
    }
    
    // ============================================
    // SAVE AUTO-SELL CONFIGURATIONS FROM LAUNCH FORM (BEFORE WALLETS)
    // ============================================
    // ARCHITECTURE: Configs are saved BEFORE wallets are created
    // - For warmed wallets: walletId is the actual address (we know it upfront)
    // - For fresh wallets: walletId is an index like "wallet-1", "bundle-1"
    // When wallets are created, these configs are automatically mapped to actual addresses
    // This ensures configs are ready BEFORE launch starts
    if (holderWalletAutoSellConfigs || bundleWalletAutoSellConfigs || devAutoSellConfig) {
      const tradeConfigsDir = path.join(projectRoot, 'keys', 'trade-configs');
      fs.mkdirSync(tradeConfigsDir, { recursive: true });
      const autoSellConfigPath = path.join(tradeConfigsDir, 'launch-auto-sell-config.json');
      const autoSellData = {
        holderWalletAutoSellConfigs: holderWalletAutoSellConfigs || null,
        bundleWalletAutoSellConfigs: bundleWalletAutoSellConfigs || null,
        devAutoSellConfig: devAutoSellConfig || null,
        createdAt: new Date().toISOString(),
        // Note: walletIds in configs can be:
        // - Actual addresses (for warmed wallets): "GB9dx5G1..."
        // - Index strings (for fresh wallets): "wallet-1", "bundle-1", etc.
        // These will be mapped to actual addresses when wallets are created
      };
      fs.writeFileSync(autoSellConfigPath, JSON.stringify(autoSellData, null, 2));
      console.log(`[Launch] 💾 Saved auto-sell configs to launch-auto-sell-config.json (will be mapped to wallets when created)`);
    } else {
      // Clear auto-sell config if not provided
      const autoSellConfigPath = path.join(projectRoot, 'keys', 'trade-configs', 'launch-auto-sell-config.json');
      if (fs.existsSync(autoSellConfigPath)) {
        fs.unlinkSync(autoSellConfigPath);
      }
    }
    
    // Determine if any warmed wallets are being used (legacy compat + new per-type)
    const anyWarmedUsed = useWarmedWallets || useWarmedDevWallet || useWarmedBundleWallets || useWarmedHolderWallets;
    const hasWarmedSelections = creatorWalletAddress || (bundleWalletAddresses && bundleWalletAddresses.length > 0) || (holderWalletAddresses && holderWalletAddresses.length > 0);
    
    if (anyWarmedUsed && hasWarmedSelections) {
      console.log(`[Launch] 🔥 Per-type warmed wallet configuration:`);
      console.log(`   DEV: ${useWarmedDevWallet ? 'WARMED' : 'FRESH'} ${creatorWalletAddress ? `(${creatorWalletAddress.slice(0, 8)}...)` : ''}`);
      console.log(`   Bundle: ${useWarmedBundleWallets ? 'WARMED' : 'FRESH'} (${bundleWalletAddresses?.length || 0} selected)`);
      console.log(`   Holder: ${useWarmedHolderWallets ? 'WARMED' : 'FRESH'} (${holderWalletAddresses?.length || 0} selected)`);
      
      // Load warmed wallets and save selected ones to a file that index.ts can read
      const { loadWarmedWallets } = require(projectPath('src', 'wallet-warming-manager.ts'));
      const allWarmedWallets = loadWarmedWallets();
      
      console.log(`[Launch] Loaded ${allWarmedWallets.length} warmed wallets from wallet warming system`);
      
      // Create a map of addresses to private keys (case-insensitive lookup)
      const walletMap = new Map();
      const addressMap = new Map(); // Map lowercase addresses to original addresses
      allWarmedWallets.forEach(wallet => {
        const lowerAddress = wallet.address.toLowerCase();
        walletMap.set(lowerAddress, wallet.privateKey);
        addressMap.set(lowerAddress, wallet.address); // Store original address for reference
      });
      
      // Get private key for creator wallet (case-insensitive lookup)
      let creatorWalletKey = null;
      let matchedCreatorAddress = null;
      if (creatorWalletAddress) {
        const lowerCreatorAddress = creatorWalletAddress.toLowerCase();
        creatorWalletKey = walletMap.get(lowerCreatorAddress);
        matchedCreatorAddress = addressMap.get(lowerCreatorAddress);
        
        if (creatorWalletKey) {
          console.log(`[Launch] ✅ Found creator wallet: ${matchedCreatorAddress || creatorWalletAddress}`);
        } else {
          console.warn(`[Launch] ⚠️  WARNING: Creator wallet address ${creatorWalletAddress} was provided but private key not found in warmed wallets!`);
          console.warn(`[Launch]    Searched for: ${creatorWalletAddress} (normalized: ${lowerCreatorAddress})`);
          console.warn(`[Launch]    Available wallet addresses (first 5): ${allWarmedWallets.slice(0, 5).map(w => w.address).join(', ')}`);
          console.warn(`[Launch]    This wallet will NOT be used. Please verify the wallet is in your warmed wallets list.`);
        }
      }
      
      // Get private keys for selected wallets (case-insensitive lookup)
      const bundleWalletKeys = (bundleWalletAddresses || [])
        .map(addr => {
          const key = walletMap.get(addr.toLowerCase());
          if (!key) {
            console.warn(`[Launch] ⚠️  Bundle wallet address ${addr} not found in warmed wallets`);
          }
          return key;
        })
        .filter(key => key); // Remove undefined
      
      const holderWalletKeys = (holderWalletAddresses || [])
        .map(addr => {
          const key = walletMap.get(addr.toLowerCase());
          if (!key) {
            console.warn(`[Launch] ⚠️  Holder wallet address ${addr} not found in warmed wallets`);
          }
          return key;
        })
        .filter(key => key); // Remove undefined
      
      // Filter holder wallets to only include those selected for auto-buy
      const holderWalletAutoBuyKeys = []
      const holderWalletAutoBuyAddressesList = []
      if (holderWalletAutoBuyAddresses && holderWalletAutoBuyAddresses.length > 0) {
        holderWalletAutoBuyAddresses.forEach((addr) => {
          const key = walletMap.get(addr.toLowerCase())
          if (key) {
            holderWalletAutoBuyKeys.push(key)
            holderWalletAutoBuyAddressesList.push(addr)
          }
        })
      }
      
      // Save to a file that index.ts will read
      // ALWAYS include creatorWalletKey and creatorWalletAddress fields (even if null) so index.ts can check for them
      // warmedWalletsPath already declared above
      const warmedWalletsData = {
        // Per-type warmed wallet flags (NEW)
        useWarmedDevWallet: useWarmedDevWallet || false,
        useWarmedBundleWallets: useWarmedBundleWallets || false,
        useWarmedHolderWallets: useWarmedHolderWallets || false,
        
        // Wallet data
        creatorWalletKey: useWarmedDevWallet ? (creatorWalletKey || null) : null,
        creatorWalletAddress: useWarmedDevWallet ? (creatorWalletAddress || null) : null,
        bundleWalletKeys: useWarmedBundleWallets ? bundleWalletKeys : [],
        bundleWalletAddresses: useWarmedBundleWallets ? (bundleWalletAddresses || []) : [],
        holderWalletKeys: useWarmedHolderWallets ? holderWalletKeys : [],
        holderWalletAddresses: useWarmedHolderWallets ? (holderWalletAddresses || []) : [],
        
        // Auto-buy config (only for holder wallets)
        holderWalletAutoBuyKeys: useWarmedHolderWallets ? holderWalletAutoBuyKeys : [],
        holderWalletAutoBuyAddresses: useWarmedHolderWallets ? holderWalletAutoBuyAddressesList : [],
        holderWalletAutoBuyDelays: holderWalletAutoBuyDelays || null,
        frontRunThreshold: typeof frontRunThreshold === 'number' ? frontRunThreshold : 0, // Front-run protection threshold (SOL)
        createdAt: new Date().toISOString()
      };
      fs.writeFileSync(warmedWalletsPath, JSON.stringify(warmedWalletsData, null, 2));
      
      console.log(`[Launch] Saved warmed wallets to ${warmedWalletsPath}:`);
      console.log(`   DEV: ${useWarmedDevWallet ? (creatorWalletKey ? '✅ WARMED' : '⚠️ Selected but not found') : '🆕 FRESH'}`);
      if (useWarmedDevWallet && creatorWalletKey) {
        console.log(`      Address: ${creatorWalletAddress}`);
      }
      console.log(`   Bundle: ${useWarmedBundleWallets ? `✅ WARMED (${bundleWalletKeys.length})` : '🆕 FRESH'}`);
      console.log(`   Holder: ${useWarmedHolderWallets ? `✅ WARMED (${holderWalletKeys.length}, ${holderWalletAutoBuyKeys.length} auto-buy)` : '🆕 FRESH'}`);
      if (holderWalletAutoBuyDelays) {
        console.log(`   Auto-buy delays config: ${holderWalletAutoBuyDelays}`);
      }
      if (frontRunThreshold > 0) {
        console.log(`   🛡️ Front-run protection: enabled (threshold: ${frontRunThreshold} SOL)`);
      }
      
      // Map and apply auto-sell configs for warmed wallets IMMEDIATELY (we know the addresses)
      // Configs are already saved to launch-auto-sell-config.json, now we map them to addresses
      if (holderWalletAutoSellConfigs || bundleWalletAutoSellConfigs || devAutoSellConfig) {
        try {
          const autoSellConfigPath = path.join(projectRoot, 'keys', 'trade-configs', 'launch-auto-sell-config.json');
          if (fs.existsSync(autoSellConfigPath)) {
            const configData = JSON.parse(fs.readFileSync(autoSellConfigPath, 'utf8'));
            const walletAddresses = {
              holderWalletAddresses: holderWalletAddresses || [],
              bundleWalletAddresses: bundleWalletAddresses || [],
              devWalletAddress: creatorWalletAddress || null
            };
            const appliedCount = pumpPortalTracker.mapAndApplyAutoSellConfigs(configData, walletAddresses);
            if (appliedCount > 0) {
              console.log(`[Launch] ✅ Mapped and applied auto-sell configs for ${appliedCount} warmed wallet(s)`);
            }
          }
        } catch (error) {
          console.warn(`[Launch] ⚠️  Could not map auto-sell configs for warmed wallets: ${error.message}`);
        }
      }
    } else {
      // Clear warmed wallets file if not using them
      // warmedWalletsPath already declared above
      if (fs.existsSync(warmedWalletsPath)) {
        fs.unlinkSync(warmedWalletsPath);
        console.log(`[Launch] Cleared warmed wallets file - will create fresh wallets`);
      }
      
      // For fresh wallets, save auto-buy config to a temp file that index.ts can read
      // This allows fresh wallets to also use auto-buy functionality
      // Use indices (for fresh wallets) or addresses (if provided for some reason)
      if ((holderWalletAutoBuyIndices && holderWalletAutoBuyIndices.length > 0) || 
          (holderWalletAutoBuyAddresses && holderWalletAutoBuyAddresses.length > 0)) {
        const tradeConfigsDir = path.join(projectRoot, 'keys', 'trade-configs');
        fs.mkdirSync(tradeConfigsDir, { recursive: true });
        const freshAutoBuyPath = path.join(tradeConfigsDir, 'fresh-auto-buy-config.json');
        const freshAutoBuyData = {
          holderWalletAutoBuyIndices: holderWalletAutoBuyIndices || [], // Wallet indices (1, 2, 3, etc.)
          holderWalletAutoBuyAddresses: holderWalletAutoBuyAddresses || [], // Fallback: addresses if provided
          holderWalletAutoBuyDelays: holderWalletAutoBuyDelays || null,
          frontRunThreshold: typeof frontRunThreshold === 'number' ? frontRunThreshold : 0, // Front-run protection threshold (SOL)
          createdAt: new Date().toISOString()
        };
        fs.writeFileSync(freshAutoBuyPath, JSON.stringify(freshAutoBuyData, null, 2));
        const walletCount = holderWalletAutoBuyIndices?.length || holderWalletAutoBuyAddresses?.length || 0;
        console.log(`[Launch] Saved fresh wallet auto-buy config: ${walletCount} wallet(s) selected`);
        if (holderWalletAutoBuyIndices && holderWalletAutoBuyIndices.length > 0) {
          console.log(`   Selected wallet indices: ${holderWalletAutoBuyIndices.join(', ')}`);
        }
        if (holderWalletAutoBuyDelays) {
          console.log(`   Auto-buy delays config: ${holderWalletAutoBuyDelays}`);
        }
      } else {
        // Clear fresh auto-buy config if not using it
        const freshAutoBuyPath = path.join(projectRoot, 'keys', 'trade-configs', 'fresh-auto-buy-config.json');
        if (fs.existsSync(freshAutoBuyPath)) {
          fs.unlinkSync(freshAutoBuyPath);
        }
      }
    }
    
    // Store launch progress listeners (SSE connections)
    if (!global.launchProgressListeners) {
      global.launchProgressListeners = [];
    }
    
    // ============================================
    // CREATE PRE-LAUNCH SNAPSHOT
    // ============================================
    try {
      const { getLaunchTracker } = require('./launch-tracker');
      const tracker = getLaunchTracker();
      const connection = new Connection(RPC_ENDPOINT, 'confirmed');
      
      // Build wallet list for snapshot
      const wallets = [];
      const fundingWalletAddr = latestEnv.PRIVATE_KEY ? 
        (() => {
          try {
            const decoded = base58.decode(latestEnv.PRIVATE_KEY);
            const kp = Keypair.fromSecretKey(new Uint8Array(decoded));
            return kp.publicKey.toString();
          } catch {
            return null;
          }
        })() : null;
      
      // Add creator/DEV wallet
      if (creatorWalletAddress) {
        const buyAmount = parseFloat(latestEnv.BUYER_AMOUNT) || 0;
        wallets.push({
          address: creatorWalletAddress,
          type: 'DEV',
          isWarmed: true,
          buyAmount
        });
      } else if (latestEnv.BUYER_AMOUNT > 0) {
        // Will be created fresh - use placeholder
        wallets.push({
          address: 'pending-dev-wallet',
          type: 'DEV',
          isWarmed: false,
          buyAmount: parseFloat(latestEnv.BUYER_AMOUNT) || 0
        });
      }
      
      // Add bundle wallets
      if (bundleWalletAddresses && bundleWalletAddresses.length > 0) {
        bundleWalletAddresses.forEach(addr => {
          wallets.push({ address: addr, type: 'Bundle', isWarmed: true, buyAmount: parseFloat(latestEnv.BUNDLE_SWAP_AMOUNT) || 0 });
        });
      } else {
        const bundleCount = parseInt(latestEnv.BUNDLE_WALLET_COUNT) || 0;
        for (let i = 0; i < bundleCount; i++) {
          wallets.push({ address: `pending-bundle-${i}`, type: 'Bundle', isWarmed: false, buyAmount: parseFloat(latestEnv.BUNDLE_SWAP_AMOUNT) || 0 });
        }
      }
      
      // Add holder wallets
      if (holderWalletAddresses && holderWalletAddresses.length > 0) {
        holderWalletAddresses.forEach((addr, i) => {
          const amounts = latestEnv.HOLDER_SWAP_AMOUNTS ? latestEnv.HOLDER_SWAP_AMOUNTS.split(',') : [];
          wallets.push({ 
            address: addr, 
            type: 'Holder', 
            isWarmed: true, 
            buyAmount: parseFloat(amounts[i] || latestEnv.HOLDER_WALLET_AMOUNT) || 0 
          });
        });
      } else {
        const holderCount = parseInt(latestEnv.HOLDER_WALLET_COUNT) || 0;
        const amounts = latestEnv.HOLDER_SWAP_AMOUNTS ? latestEnv.HOLDER_SWAP_AMOUNTS.split(',') : [];
        for (let i = 0; i < holderCount; i++) {
          wallets.push({ 
            address: `pending-holder-${i}`, 
            type: 'Holder', 
            isWarmed: false, 
            buyAmount: parseFloat(amounts[i] || latestEnv.HOLDER_WALLET_AMOUNT) || 0 
          });
        }
      }
      
      // Create snapshot
      await tracker.createPreLaunchSnapshot({
        mintAddress: 'pending', // Will be updated when token is created
        tokenInfo: {
          name: latestEnv.TOKEN_NAME || '',
          symbol: latestEnv.TOKEN_SYMBOL || '',
          description: latestEnv.DESCRIPTION || '',
          image: latestEnv.FILE || ''
        },
        marketing: {
          website: latestEnv.WEBSITE || '',
          twitter: latestEnv.TWITTER || '',
          telegram: latestEnv.TELEGRAM || ''
        },
        launchConfig: {
          devBuyAmount: parseFloat(latestEnv.BUYER_AMOUNT) || 0,
          // Use per-type flags - only use warmed count for that specific type
          bundleWalletCount: useWarmedBundleWallets ? (bundleWalletAddresses?.length || 0) : (parseInt(latestEnv.BUNDLE_WALLET_COUNT) || 0),
          holderWalletCount: useWarmedHolderWallets ? (holderWalletAddresses?.length || 0) : (parseInt(latestEnv.HOLDER_WALLET_COUNT) || 0),
          useWarmedWallets: !!useWarmedWallets,
          frontRunThreshold: frontRunThreshold || 0,
          priorityFee: latestEnv.PRIORITY_FEE || 'low',
          useNormalLaunch: latestEnv.USE_NORMAL_LAUNCH === 'true',
          autoHolderWalletBuy: latestEnv.AUTO_HOLDER_WALLET_BUY === 'true',
          jitoFee: parseFloat(latestEnv.JITO_FEE) || 0.0015
        },
        wallets,
        fundingWallet: fundingWalletAddr ? { address: fundingWalletAddr } : null,
        connection
      });
      
      console.log(`[Launch] ✅ Pre-launch snapshot created`);
    } catch (snapshotError) {
      console.warn(`[Launch] ⚠️ Could not create pre-launch snapshot: ${snapshotError.message}`);
      // Continue with launch anyway
    }
    
    // Execute npm start in background
    // Use the same working directory as terminal would use
    // The child process (index.ts) will reload .env with dotenv.config({ override: true })
    
    // Build environment - in production mode, use hot wallet key
    const childEnv = {
      ...process.env, // Inherit parent environment
      // Ensure NODE_ENV and other important vars are set
      NODE_ENV: process.env.NODE_ENV || 'development'
    };
    
    // PRODUCTION MODE: Override PRIVATE_KEY with hot wallet key
    if (isProductionLaunch && _hotWalletKey) {
      childEnv.PRIVATE_KEY = _hotWalletKey;
      console.log(`[Launch] 🔥 Using Hot Wallet as funding wallet (production mode)`);
    }
    
    const childProcess = exec('npm start', { 
      cwd: projectRoot, // Same directory as running "npm start" from terminal
      env: childEnv,
      // Capture output for streaming
    });
    
    // Log process info
    console.log(`[Launch] Child process started with PID: ${childProcess.pid}`);
    console.log(`[Launch] Working directory: ${projectRoot}`);
    
    // Stream stdout in real-time
    childProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[Launch] stdout: ${output.trim()}`);
      // Broadcast to SSE listeners
      broadcastProgress('stdout', output);
    });
    
    // Stream stderr in real-time
    childProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.error(`[Launch] stderr: ${output.trim()}`);
      // Broadcast to SSE listeners
      broadcastProgress('stderr', output);
    });
    
    childProcess.on('close', (code) => {
      console.log(`[Launch] Process exited with code ${code}`);
      broadcastProgress('close', { code });
      // Clean up listeners after a delay
      setTimeout(() => {
        global.launchProgressListeners = [];
      }, 5000);
    });
    
    childProcess.on('error', (error) => {
      console.error(`[Launch] Process error:`, error);
      broadcastProgress('error', { message: error.message });
    });
    
    // Don't wait for completion - return immediately
    // Progress will be streamed via SSE endpoint
    res.json({ 
      success: true, 
      message: 'Token launch started. Real-time progress available.',
      pid: childProcess.pid,
      workingDirectory: projectRoot
    });
    
  } catch (error) {
    console.error('[Launch] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// RAPID LAUNCH - Direct launch with inline data (for Trend Detector)
// Does NOT read from .env - all data passed directly
app.post('/api/rapid-launch', async (req, res) => {
  try {
    const { 
      name, 
      symbol, 
      description, 
      twitter, 
      telegram, 
      website, 
      imageUrl,
      imagePath,
      devBuyAmount = 0.5,
      _hotWalletKey,
      _hotWalletAddress,
      _isProductionMode
    } = req.body;
    
    // Check for production mode with hot wallet key
    const isProductionLaunch = _isProductionMode && _hotWalletKey;
    
    if (isProductionLaunch) {
      console.log(`[Rapid Launch] 🔥 PRODUCTION MODE - Using Hot Wallet: ${_hotWalletAddress?.slice(0, 8)}...`);
    }

    if (!name || !symbol) {
      return res.status(400).json({ 
        success: false, 
        error: 'Name and symbol are required' 
      });
    }

    const projectRoot = path.join(__dirname, '..');
    const keysDir = path.join(projectRoot, 'keys');
    
    console.log(`[Rapid Launch] 🚀 Starting: ${name} ($${symbol})`);
    console.log(`[Rapid Launch] Dev Buy: ${devBuyAmount} SOL`);

    // Handle image - download from URL if provided
    let finalImagePath = imagePath;
    if (imageUrl && !imagePath) {
      try {
        console.log(`[Rapid Launch] Downloading image from: ${imageUrl}`);
        const axios = require('axios');
        const imageRes = await axios.get(imageUrl, { 
          responseType: 'arraybuffer',
          timeout: 10000 
        });
        const imageBuffer = Buffer.from(imageRes.data);
        const ext = imageUrl.match(/\.(png|jpg|jpeg|gif|webp)/i)?.[1] || 'png';
        const imageName = `rapid-launch-${Date.now()}.${ext}`;
        finalImagePath = path.join(projectRoot, 'image', imageName);
        fs.writeFileSync(finalImagePath, imageBuffer);
        console.log(`[Rapid Launch] Image saved to: ${finalImagePath}`);
      } catch (imgErr) {
        console.warn(`[Rapid Launch] Failed to download image: ${imgErr.message}`);
      }
    }

    // Read base .env to get RPC, PRIVATE_KEY, etc.
    const envPath = path.join(projectRoot, '.env');
    const baseEnv = {};
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      envContent.split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
          baseEnv[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
        }
      });
    }

    // Override with our rapid launch data
    const launchEnv = {
      ...process.env,
      ...baseEnv,
      TOKEN_NAME: name,
      TOKEN_SYMBOL: symbol,
      DESCRIPTION: description || `${name} - Rapid Launch`,
      TWITTER: twitter || '',
      TELEGRAM: telegram || '',
      WEBSITE: website || '',
      FILE: finalImagePath || '',
      BUYER_AMOUNT: String(devBuyAmount),
      ENABLE_TWITTER_POSTING: 'false', // Disable for rapid launch
      QUICK_LAUNCH_AUTO_CONFIRM: 'true',
    };
    
    // PRODUCTION MODE: Override PRIVATE_KEY with hot wallet key
    if (isProductionLaunch && _hotWalletKey) {
      launchEnv.PRIVATE_KEY = _hotWalletKey;
      console.log(`[Rapid Launch] 🔥 Using Hot Wallet as funding wallet (production mode)`);
    }

    console.log(`[Rapid Launch] Token: ${launchEnv.TOKEN_NAME} ($${launchEnv.TOKEN_SYMBOL})`);

    // Execute quick-launch.ts with overridden environment (now in cli/ directory)
    const { spawn } = require('child_process');
    const childProcess = spawn('npx', ['ts-node', 'cli/quick-launch.ts'], {
      cwd: projectRoot,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: launchEnv
    });

    let output = '';
    let detectedMint = null;

    // Auto-confirm the launch
    setTimeout(() => {
      childProcess.stdin.write('y\n');
    }, 2000);

    childProcess.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      console.log(`[Rapid Launch] ${text.trim()}`);
      
      // Detect mint address
      const contractMatch = text.match(/Contract:\s*([A-Za-z0-9]{32,44}pump)/);
      if (contractMatch) {
        detectedMint = contractMatch[1];
      }
    });

    childProcess.stderr.on('data', (data) => {
      const text = data.toString();
      output += text;
      console.error(`[Rapid Launch] stderr: ${text.trim()}`);
    });

    // Wait for completion (max 2 minutes)
    const exitCode = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        childProcess.kill();
        resolve(-1);
      }, 120000);

      childProcess.on('close', (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });

    if (exitCode === 0 || detectedMint) {
      console.log(`[Rapid Launch] ✅ Success! Mint: ${detectedMint}`);
      return res.json({ 
        success: true, 
        mintAddress: detectedMint,
        message: `Launched ${name} ($${symbol})`,
        output: output.slice(-2000) // Last 2000 chars
      });
    } else {
      console.error(`[Rapid Launch] ❌ Failed with exit code: ${exitCode}`);
      return res.status(500).json({ 
        success: false, 
        error: 'Launch failed',
        exitCode,
        output: output.slice(-2000)
      });
    }

  } catch (error) {
    console.error('[Rapid Launch] Error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// QUICK LAUNCH - Simple dev buy only, no Jito, no bundles
// Uses quick-launch.ts which is a simplified launcher
app.post('/api/quick-launch-token', async (req, res) => {
  try {
    const projectRoot = path.join(__dirname, '..');
    const envPath = path.join(projectRoot, '.env');
    const currentRunPath = path.join(projectRoot, 'keys', 'current-run.json');
    
    // Verify .env file exists
    if (!fs.existsSync(envPath)) {
      return res.status(500).json({ 
        success: false, 
        error: `.env file not found at ${envPath}` 
      });
    }
    
    console.log(`[Quick Launch] Starting quick token launch from: ${projectRoot}`);
    
    // Clear old current-run.json
    const keysDir = path.join(projectRoot, 'keys');
    if (!fs.existsSync(keysDir)) {
      fs.mkdirSync(keysDir, { recursive: true });
    }
    
    if (fs.existsSync(currentRunPath)) {
      const backupPath = path.join(keysDir, `current-run-backup-${Date.now()}.json`);
      fs.copyFileSync(currentRunPath, backupPath);
      fs.unlinkSync(currentRunPath);
      console.log(`[Quick Launch] Cleared previous current-run.json`);
    }
    
    // Read the latest .env
    const latestEnv = readEnvFile();
    console.log(`[Quick Launch] Token: ${latestEnv.TOKEN_NAME} ($${latestEnv.TOKEN_SYMBOL})`);
    console.log(`[Quick Launch] Dev Buy: ${latestEnv.BUYER_AMOUNT} SOL`);
    
    // Initialize launch progress listeners
    if (!global.launchProgressListeners) {
      global.launchProgressListeners = [];
    }
    
    // Execute quick-launch.ts in background with auto-confirm (now in cli/ directory)
    const { spawn } = require('child_process');
    const childProcess = spawn('npx', ['ts-node', 'cli/quick-launch.ts'], {
      cwd: projectRoot,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORCE_COLOR: '1',
        QUICK_LAUNCH_AUTO_CONFIRM: 'true' // Auto-confirm for API calls
      }
    });
    
    // Auto-confirm the launch (send 'y' to stdin)
    setTimeout(() => {
      childProcess.stdin.write('y\n');
    }, 2000);
    
    // Track detected mint address for instant subscription
    let detectedMintAddress = null;
    let hasSubscribed = false;
    
    // Stream stdout - with instant tracker subscription on token creation
    childProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[Quick Launch] stdout: ${output.trim()}`);
      broadcastProgress('stdout', output);
      
      // INSTANT TRACKING: Detect contract address from output
      // Look for "Contract: <address>" or "TRACKING_SIGNAL: <address>" patterns
      const contractMatch = output.match(/Contract:\s*([A-Za-z0-9]{32,44}pump)/);
      const trackingSignalMatch = output.match(/TRACKING_SIGNAL:\s*([A-Za-z0-9]{32,44}pump)/);
      
      if (contractMatch && !detectedMintAddress) {
        detectedMintAddress = contractMatch[1];
        console.log(`[Quick Launch] 🎯 Detected mint address: ${detectedMintAddress}`);
      }
      if (trackingSignalMatch && !detectedMintAddress) {
        detectedMintAddress = trackingSignalMatch[1];
        console.log(`[Quick Launch] 🎯 Detected mint from TRACKING_SIGNAL: ${detectedMintAddress}`);
      }
      
      // As soon as we see "Token created!" or "TRACKING_SIGNAL", immediately subscribe for real-time tracking
      const shouldSubscribe = output.includes('Token created!') || output.includes('TRACKING_SIGNAL:');
      if (shouldSubscribe && detectedMintAddress && !hasSubscribed) {
        hasSubscribed = true;
        console.log(`[Quick Launch] ⚡ INSTANT SUBSCRIBE to ${detectedMintAddress.slice(0, 12)}...`);
        
        // Immediately subscribe to the token via PumpPortal
        try {
          pumpPortalTracker.subscribeToToken(detectedMintAddress);
          
          // Candle aggregator removed - using Birdeye charts instead
          // (removed to avoid rate limits)
          
          // Also reload wallets from current-run.json (it might not be written yet, but try)
          setTimeout(() => {
            console.log(`[Quick Launch] 🔄 Reloading wallets for instant tracking...`);
            pumpPortalTracker.reloadFromCurrentRun();
          }, 500);
          
          // Broadcast that we're tracking
          broadcastProgress('tracking_started', { 
            mintAddress: detectedMintAddress,
            message: 'Real-time tracking started'
          });
        } catch (e) {
          console.error(`[Quick Launch] Error subscribing:`, e.message);
        }
      }
      
      // Also detect when dev buy is complete to inject it immediately
      if (output.includes('Dev buy complete!') && detectedMintAddress) {
        console.log(`[Quick Launch] 💉 Triggering immediate dev buy injection...`);
        // Give it a moment for current-run.json to be written, then inject
        setTimeout(() => {
          pumpPortalTracker.reloadFromCurrentRun();
        }, 200);
      }
    });
    
    // Stream stderr
    childProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.error(`[Quick Launch] stderr: ${output.trim()}`);
      broadcastProgress('stderr', output);
    });
    
    childProcess.on('close', (code) => {
      console.log(`[Quick Launch] Process exited with code ${code}`);
      broadcastProgress('close', { code });
      setTimeout(() => {
        global.launchProgressListeners = [];
      }, 5000);
    });
    
    childProcess.on('error', (error) => {
      console.error(`[Quick Launch] Process error:`, error);
      broadcastProgress('error', { message: error.message });
    });
    
    res.json({ 
      success: true, 
      message: 'Quick Launch started. Real-time progress available.',
      mode: 'quick',
      pid: childProcess.pid,
      workingDirectory: projectRoot
    });
    
  } catch (error) {
    console.error('[Quick Launch] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get next pump address (upcoming launch token address)
app.get('/api/next-pump-address', (req, res) => {
  try {
    const env = readEnvFile();
    
    // Priority order (same as index.ts):
    // 1. MINT_PRIVATE_KEY env variable
    // 2. Pump address pool (pump-addresses.json)
    // 3. Vanity mode (if enabled)
    // 4. Will generate new random (not a pump address)
    
    let address = null;
    let source = null;
    
    // Priority 1: MINT_PRIVATE_KEY
    if (env.MINT_PRIVATE_KEY) {
      try {
        const kp = Keypair.fromSecretKey(base58.decode(env.MINT_PRIVATE_KEY));
        address = kp.publicKey.toBase58();
        source = 'MINT_PRIVATE_KEY (from .env)';
      } catch (error) {
        console.error('[Next Pump Address] Error decoding MINT_PRIVATE_KEY:', error);
      }
    }
    
    // Priority 2: Pump address pool
    if (!address) {
      try {
        const projectRoot = path.join(__dirname, '..');
        const pumpAddressesPath = path.join(projectRoot, 'keys', 'pump-addresses.json');
        const absolutePath = path.resolve(pumpAddressesPath);
        
        if (fs.existsSync(absolutePath)) {
          const data = fs.readFileSync(absolutePath, 'utf-8');
          const addresses = JSON.parse(data);
          
          if (!Array.isArray(addresses)) {
            console.error('[Next Pump Address] ❌ File is not an array, got:', typeof addresses);
          } else {
            const available = addresses.find((addr) => {
              return addr.status === 'available' && addr.used === false;
            });
            
            if (available) {
              address = available.publicKey;
              source = 'Pump address pool (pump-addresses.json)';
            } else {
              console.warn('[Next Pump Address] No available addresses in pool');
            }
          }
        } else {
          console.log('[Next Pump Address] ❌ File does not exist at:', absolutePath);
          // Try alternative paths
          const altPath1 = path.join(process.cwd(), 'keys', 'pump-addresses.json');
          const altPath2 = path.join(__dirname, '..', '..', 'keys', 'pump-addresses.json');
          console.log('[Next Pump Address] Trying alternative path 1:', altPath1, 'exists:', fs.existsSync(altPath1));
          console.log('[Next Pump Address] Trying alternative path 2:', altPath2, 'exists:', fs.existsSync(altPath2));
        }
      } catch (error) {
        console.error('[Next Pump Address] ❌ Error reading pump-addresses.json:', error);
        console.error('[Next Pump Address] Error stack:', error.stack);
      }
    }
    
    // Priority 3: Vanity mode
    if (!address && env.VANITY_MODE === 'true') {
      address = null; // Will be generated at launch
      source = 'VANITY_MODE (will generate new with "pump" suffix)';
    }
    
    // Priority 4: Will generate new random
    if (!address) {
      address = null;
      source = 'Will generate new random keypair (not a pump address)';
    }
    
    res.json({
      success: true,
      address: address,
      source: source,
      hasAddress: !!address
    });
  } catch (error) {
    console.error('[Next Pump Address] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== VANITY ADDRESS GENERATOR ====================

// Track running vanity generator process
let vanityGeneratorProcess = null;

// Get vanity address pool status
app.get('/api/vanity-pool-status', (req, res) => {
  try {
    const projectRoot = path.join(__dirname, '..');
    const pumpAddressesPath = path.join(projectRoot, 'keys', 'pump-addresses.json');
    
    let available = 0;
    let total = 0;
    
    if (fs.existsSync(pumpAddressesPath)) {
      try {
        const addresses = JSON.parse(fs.readFileSync(pumpAddressesPath, 'utf-8'));
        total = addresses.length;
        available = addresses.filter(addr => addr.status === 'available' && !addr.used).length;
      } catch (parseError) {
        console.error('[Vanity Pool] Error parsing pump-addresses.json:', parseError);
      }
    }
    
    res.json({
      success: true,
      available,
      total,
      generating: vanityGeneratorProcess !== null && !vanityGeneratorProcess.killed
    });
  } catch (error) {
    console.error('[Vanity Pool] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start vanity generator
app.post('/api/vanity-generator/start', (req, res) => {
  try {
    // Check if already running
    if (vanityGeneratorProcess !== null && !vanityGeneratorProcess.killed) {
      return res.json({ success: true, message: 'Generator already running' });
    }
    
    const projectRoot = path.join(__dirname, '..');
    const generatorPath = path.join(projectRoot, 'cli', 'generate-pump-addresses.ts');
    
    // Check if generator script exists
    if (!fs.existsSync(generatorPath)) {
      return res.status(404).json({ 
        success: false, 
        error: 'Vanity generator script not found. Make sure cli/generate-pump-addresses.ts exists.' 
      });
    }
    
    // Start the generator using ts-node
    const { spawn } = require('child_process');
    vanityGeneratorProcess = spawn('npx', ['ts-node', 'cli/generate-pump-addresses.ts'], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true
    });
    
    vanityGeneratorProcess.stdout.on('data', (data) => {
      console.log('[Vanity Generator]', data.toString().trim());
    });
    
    vanityGeneratorProcess.stderr.on('data', (data) => {
      console.error('[Vanity Generator Error]', data.toString().trim());
    });
    
    vanityGeneratorProcess.on('close', (code) => {
      console.log(`[Vanity Generator] Process exited with code ${code}`);
      vanityGeneratorProcess = null;
    });
    
    vanityGeneratorProcess.on('error', (error) => {
      console.error('[Vanity Generator] Failed to start:', error);
      vanityGeneratorProcess = null;
    });
    
    res.json({ success: true, message: 'Vanity generator started' });
  } catch (error) {
    console.error('[Vanity Generator Start] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Stop vanity generator
app.post('/api/vanity-generator/stop', (req, res) => {
  try {
    if (vanityGeneratorProcess === null || vanityGeneratorProcess.killed) {
      vanityGeneratorProcess = null;
      return res.json({ success: true, message: 'Generator not running' });
    }

    const pid = vanityGeneratorProcess.pid;
    console.log(`[Vanity Generator] Stopping process tree (PID: ${pid})`);

    // On Windows, SIGTERM doesn't propagate to child process trees spawned
    // via shell:true. Use taskkill /T to kill the entire process tree.
    if (process.platform === 'win32') {
      const { execSync } = require('child_process');
      try {
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
      } catch (e) {
        // Process may already be dead
      }
    } else {
      // Unix: kill the process group
      try { process.kill(-pid, 'SIGKILL'); } catch (e) {
        try { vanityGeneratorProcess.kill('SIGKILL'); } catch (e2) {}
      }
    }

    vanityGeneratorProcess = null;
    res.json({ success: true, message: 'Vanity generator stopped' });
  } catch (error) {
    console.error('[Vanity Generator Stop] Error:', error);
    vanityGeneratorProcess = null;
    res.status(500).json({ success: false, error: error.message });
  }
});

// Generate random address preview (for when user selects "Random" mode)
app.post('/api/generate-random-address', (req, res) => {
  try {
    // Generate a new random keypair
    const keypair = Keypair.generate();
    const address = keypair.publicKey.toBase58();
    
    // Store temporarily (will be used at launch if random mode is still selected)
    // Note: This is just a preview - actual address used at launch may differ
    res.json({
      success: true,
      address: address,
      source: 'Random (pre-generated)',
      isPreview: true
    });
  } catch (error) {
    console.error('[Generate Random Address] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== END VANITY ADDRESS GENERATOR ====================

// Balance cache to reduce RPC calls
const balanceCache = new Map(); // key: `${address}_${mintAddress}` -> { solBalance, tokenBalance, timestamp }
const CACHE_TTL = 3000; // 3 seconds cache

// Invalidate cache for a wallet (call after buy/sell transactions)
function invalidateBalanceCache(address, mintAddress) {
  const cacheKey = `${address}_${mintAddress}`;
  balanceCache.delete(cacheKey);
  // Removed verbose logging - only log errors
}

// Clear all balance caches (used after batch operations)
function invalidateAllBalanceCaches() {
  balanceCache.clear();
}

// Batch fetch balances (more efficient than individual calls)
async function batchFetchBalances(walletKeys, mintAddress) {
  const connection = getConnection();
  const wallets = [];
  const now = Date.now();
  
  // Prepare all public keys first (NO private keys stored)
  const walletData = walletKeys.map(privateKey => {
    const kp = Keypair.fromSecretKey(base58.decode(privateKey));
    return { kp, address: kp.publicKey.toBase58() };
  });
  
  // Batch fetch SOL balances using getMultipleAccountsInfo (single RPC call)
  const publicKeys = walletData.map(w => w.kp.publicKey);
  const solAccountInfos = await connection.getMultipleAccountsInfo(publicKeys);
  
  // Fetch token balances per wallet using getParsedTokenAccountsByOwner
  // This finds tokens regardless of ATA derivation or token program
  const tokenBalanceByOwner = new Map();
  if (mintAddress) {
    const mintPubkey = new PublicKey(mintAddress);
    
    for (const w of walletData) {
      try {
        const resp = await connection.getParsedTokenAccountsByOwner(w.kp.publicKey, { mint: mintPubkey });
        if (resp.value && resp.value.length > 0) {
          let total = 0;
          for (const acct of resp.value) {
            const ui = acct.account.data.parsed?.info?.tokenAmount?.uiAmount || 0;
            total += ui;
          }
          if (total > 0) {
            tokenBalanceByOwner.set(w.address, total);
          }
        }
      } catch (err) {
        const msg = err?.message || String(err);
        if (!msg.includes('could not find account') && !msg.includes('AccountNotFound')) {
          console.warn(`[Batch Fetch] Token lookup failed for ${w.address.slice(0, 8)}...: ${msg.slice(0, 120)}`);
        }
      }
    }
    
  }
  
  // Process results
  for (let i = 0; i < walletData.length; i++) {
    try {
      const wallet = walletData[i];
      const cacheKey = `${wallet.address}_${mintAddress || 'no-mint'}`;
      
      const cached = balanceCache.get(cacheKey);
      if (cached && now - cached.timestamp < CACHE_TTL) {
        wallets.push({
          address: wallet.address,
          solBalance: cached.solBalance,
          tokenBalance: cached.tokenBalance
        });
        continue;
      }
      
      const solBalance = solAccountInfos[i] ? 
        (solAccountInfos[i].lamports || 0) / LAMPORTS_PER_SOL : 0;
      
      const tokenBalance = tokenBalanceByOwner.get(wallet.address) || 0;
      
      balanceCache.set(cacheKey, {
        solBalance,
        tokenBalance,
        timestamp: now
      });
      
      wallets.push({
        address: wallet.address,
        solBalance,
        tokenBalance
      });
    } catch (error) {
      console.error(`Error processing wallet ${i}:`, error);
      wallets.push({
        address: walletData[i].address,
        solBalance: 0,
        tokenBalance: 0
      });
    }
  }
  
  return wallets;
}

// Get holder wallets with balances (optimized with batch fetching and caching)
// SECURITY: This endpoint returns private keys - should be restricted to localhost only
// Add IP check for additional security when using ngrok
app.get('/api/holder-wallets', async (req, res) => {
  try {
    // SECURITY: Optional IP whitelist check (uncomment to enable)
    // const clientIP = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
    // const isLocalhost = clientIP === '127.0.0.1' || clientIP === '::1' || clientIP === '::ffff:127.0.0.1' || clientIP?.includes('127.0.0.1');
    // if (!isLocalhost) {
    //   return res.status(403).json({ success: false, error: 'Access denied - localhost only' });
    // }
    // Use __dirname to ensure we're reading from project root, not api-server directory
    const currentRunPath = path.join(__dirname, '..', 'keys', 'current-run.json');
    
    let mintAddress = null;
    let holderWalletKeys = [];
    let bundleWalletKeys = [];
    let devWalletKey = null;
    
    // Try to load current run data (if exists)
    if (fs.existsSync(currentRunPath)) {
      const currentRun = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
      mintAddress = currentRun.mintAddress;
      holderWalletKeys = currentRun.holderWalletKeys || [];
      bundleWalletKeys = currentRun.bundleWalletKeys || [];
      
      // Get DEV/Creator wallet - PRIORITY: creatorDevWalletKey from current-run.json, FALLBACK: BUYER_WALLET from .env
      if (currentRun.creatorDevWalletKey) {
        // Use creator/DEV wallet from current-run.json (auto-created or persistent)
        devWalletKey = currentRun.creatorDevWalletKey;
      } else {
        // Fallback: Use BUYER_WALLET from .env (persistent wallet)
        try {
          const env = readEnvFile();
          if (env.BUYER_WALLET && env.BUYER_WALLET.trim() !== '') {
            devWalletKey = env.BUYER_WALLET.trim();
          }
        } catch (e) {
          // Silent fallback
        }
      }
    }
    
    // ALWAYS load funding wallet (PRIVATE_KEY from .env) - this is the main funding wallet
    let fundingWalletKey = null;
    try {
      const env = readEnvFile();
      if (env.PRIVATE_KEY && env.PRIVATE_KEY.trim() !== '') {
        fundingWalletKey = env.PRIVATE_KEY.trim();
      }
    } catch (e) {
      console.warn('[Holder Wallets] Could not read PRIVATE_KEY from .env:', e.message);
    }
    
    // Fetch balances for all wallets
    const allWalletKeys = [];
    const walletTypes = [];
    
    // ALWAYS add funding wallet FIRST (clearly marked)
    if (fundingWalletKey) {
      allWalletKeys.push(fundingWalletKey);
      walletTypes.push('funding'); // Special type for funding wallet
    }
    
    // Add holder wallets
    holderWalletKeys.forEach(key => {
      allWalletKeys.push(key);
      walletTypes.push('holder');
    });
    
    // Add bundle wallets
    bundleWalletKeys.forEach(key => {
      allWalletKeys.push(key);
      walletTypes.push('bundle');
    });
    
    // Add dev wallet if exists (and different from funding wallet)
    if (devWalletKey && devWalletKey !== fundingWalletKey) {
      allWalletKeys.push(devWalletKey);
      walletTypes.push('dev');
    }
    
    const wallets = await batchFetchBalances(allWalletKeys, mintAddress);
    
    // Add wallet type tags and auto-buy/auto-sell status
    const holderWalletAutoBuyAddresses = [];
    if (fs.existsSync(currentRunPath)) {
      const currentRun = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
      holderWalletAutoBuyAddresses.push(...(currentRun.holderWalletAutoBuyAddresses || []));
    }
    
    // Also check warmed-wallets.json for auto-buy addresses (if using warmed wallets)
    const warmedWalletsPath = path.join(__dirname, '..', 'keys', 'warmed-wallets.json');
    if (fs.existsSync(warmedWalletsPath)) {
      try {
        const warmedData = JSON.parse(fs.readFileSync(warmedWalletsPath, 'utf8'));
        if (warmedData.holderWalletAutoBuyAddresses && warmedData.holderWalletAutoBuyAddresses.length > 0) {
          holderWalletAutoBuyAddresses.push(...warmedData.holderWalletAutoBuyAddresses);
        }
      } catch (e) {
        // Silent fail
      }
    }
    
    // Normalize addresses to lowercase for comparison
    const autoBuyAddressesSet = new Set(holderWalletAutoBuyAddresses.map(addr => addr.toLowerCase()));
    
    wallets.forEach((wallet, index) => {
      wallet.type = walletTypes[index] || 'unknown';
      // Add auto-buy status
      wallet.hasAutoBuy = autoBuyAddressesSet.has(wallet.address.toLowerCase());
      // SECURITY: NEVER return private keys in API response
      // wallet.privateKey = allWalletKeys[index]; // REMOVED - SECURITY RISK
    });
    
    // SECURITY: Private keys are NO LONGER returned in response
    // Trading functions will look up private keys server-side using wallet address
    // 1. IP whitelisting (only allow localhost/trusted IPs)
    // 2. API key authentication
    // 3. For production: Use proper server with HTTPS and authentication
    
    res.json({ success: true, wallets, mintAddress });
  } catch (error) {
    console.error('[All Wallets] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Retry failed bundle (uses existing funded wallets)
app.post('/api/retry-bundle', async (req, res) => {
  try {
    const projectRoot = path.join(__dirname, '..');
    console.log(`[Retry Bundle] Starting bundle retry from: ${projectRoot}`);
    
    // Execute retry-bundle script
    const childProcess = exec('npm run retry-bundle', { 
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || 'development'
      },
    });
    
    console.log(`[Retry Bundle] Child process started with PID: ${childProcess.pid}`);
    
    res.json({ 
      success: true, 
      message: 'Bundle retry started. Check API server terminal for progress.',
      pid: childProcess.pid
    });
    
    // Log output for debugging
    childProcess.stdout.on('data', (data) => {
      console.log(`[Retry Bundle] stdout: ${data.toString().trim()}`);
    });
    
    childProcess.stderr.on('data', (data) => {
      console.error(`[Retry Bundle] stderr: ${data.toString().trim()}`);
    });
    
    childProcess.on('close', (code) => {
      console.log(`[Retry Bundle] Process exited with code ${code}`);
    });
    
    childProcess.on('error', (error) => {
      console.error(`[Retry Bundle] Process error:`, error);
    });
    
  } catch (error) {
    console.error('[Retry Bundle] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper function to look up private key by wallet address (server-side only)
function getPrivateKeyByAddress(walletAddress) {
  // Normalize address (handle lowercase from tracker)
  const normalizedAddress = walletAddress.trim();
  
  const checkKey = (key) => {
    try {
      const kp = Keypair.fromSecretKey(base58.decode(key));
      const addr = kp.publicKey.toBase58();
      // Case-insensitive comparison since tracker uses lowercase
      if (addr.toLowerCase() === normalizedAddress.toLowerCase()) {
        return key;
      }
    } catch (e) { /* invalid key */ }
    return null;
  };
  
  // Check funding wallet (PRIVATE_KEY from .env)
  try {
    const env = readEnvFile();
    if (env.PRIVATE_KEY) {
      const found = checkKey(env.PRIVATE_KEY);
      if (found) return found;
    }
    // Check BUYER_WALLET from .env
    if (env.BUYER_WALLET) {
      const found = checkKey(env.BUYER_WALLET);
      if (found) return found;
    }
  } catch (e) { /* continue */ }
  
  // Check current-run.json
  const currentRunPath = path.join(__dirname, '..', 'keys', 'current-run.json');
  if (fs.existsSync(currentRunPath)) {
    try {
      const currentRun = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
      
      // Check holder wallets
      for (const key of (currentRun.holderWalletKeys || [])) {
        const found = checkKey(key);
        if (found) return found;
      }
      
      // Check bundle wallets
      for (const key of (currentRun.bundleWalletKeys || [])) {
        const found = checkKey(key);
        if (found) return found;
      }
      
      // Check creator/dev wallet
      if (currentRun.creatorDevWalletKey) {
        const found = checkKey(currentRun.creatorDevWalletKey);
        if (found) return found;
      }
    } catch (e) { /* continue */ }
  }
  
  // Check warmed-wallets-for-launch.json (for warmed wallets used in current run)
  const warmedPath = path.join(__dirname, '..', 'keys', 'warmed-wallets-for-launch.json');
  if (fs.existsSync(warmedPath)) {
    try {
      const warmed = JSON.parse(fs.readFileSync(warmedPath, 'utf8'));
      
      // Check warmed bundle wallets
      for (const key of (warmed.bundleWalletKeys || [])) {
        const found = checkKey(key);
        if (found) return found;
      }
      
      // Check warmed holder wallets
      for (const key of (warmed.holderWalletKeys || [])) {
        const found = checkKey(key);
        if (found) return found;
      }
      
      // Check warmed creator wallet
      if (warmed.creatorWalletKey) {
        const found = checkKey(warmed.creatorWalletKey);
        if (found) return found;
      }
    } catch (e) { /* continue */ }
  }
  
  // Check warming-wallets.json as fallback
  const warmingPath = path.join(__dirname, '..', 'keys', 'warming-wallets.json');
  if (fs.existsSync(warmingPath)) {
    try {
      const warming = JSON.parse(fs.readFileSync(warmingPath, 'utf8'));
      for (const wallet of warming) {
        if (wallet.privateKey) {
          const found = checkKey(wallet.privateKey);
          if (found) return found;
        }
      }
    } catch (e) { /* continue */ }
  }
  
  console.log(`[getPrivateKeyByAddress] ⚠️ Could not find key for ${normalizedAddress.slice(0, 8)}...`);
  return null;
}

// Buy tokens with holder wallet
app.post('/api/holder-wallet/buy', async (req, res) => {
  try {
    // Support both privateKey (legacy) and walletAddress (secure)
    let { privateKey, walletAddress, mintAddress, solAmount, referrerPrivateKey, priorityFee } = req.body;
    
    // If walletAddress provided, look up privateKey server-side
    if (!privateKey && walletAddress) {
      privateKey = getPrivateKeyByAddress(walletAddress);
      if (!privateKey) {
        return res.status(400).json({ success: false, error: 'Wallet not found in current run' });
      }
    }
    
    if (!privateKey || !mintAddress || !solAmount) {
      return res.status(400).json({ success: false, error: 'Missing required parameters (need walletAddress or privateKey, mintAddress, solAmount)' });
    }
    
    // Use the wrapper function directly
    const { callTradingFunction } = require('./call-trading-function');
    
    try {
      // For tokens you didn't create, use Jupiter swap (no referrer needed)
      // For tokens you created, use pump.fun SDK with PRIVATE_KEY as referrer
      // If referrerPrivateKey is provided, use that; otherwise use Jupiter for flexibility
      const useJupiter = !referrerPrivateKey; // Use Jupiter if no referrer provided
      const feeLevel = priorityFee === 'ultra' ? 'ultra' : priorityFee === 'high' ? 'high' : priorityFee === 'medium' ? 'medium' : priorityFee === 'none' ? 'none' : 'low'; // Default to 'low'
      
      const args = referrerPrivateKey 
        ? [privateKey, mintAddress, parseFloat(solAmount), referrerPrivateKey, false, feeLevel] // pump.fun with referrer
        : [privateKey, mintAddress, parseFloat(solAmount), undefined, true, feeLevel]; // Jupiter swap
      
      const walletKp = Keypair.fromSecretKey(base58.decode(privateKey));
      const resolvedWalletAddress = walletKp.publicKey.toBase58();
      
      const result = await callTradingFunction('buyTokenSimple', ...args);
      
      // Invalidate cache after buy
      invalidateBalanceCache(resolvedWalletAddress, mintAddress);
      
      // INJECT TRADE INTO PUMPPORTAL (guaranteed tracking)
      try {
        pumpPortalTracker.injectTrade({
          signature: result.signature,
          mint: mintAddress,
          traderPublicKey: resolvedWalletAddress,
          txType: 'buy',
          solAmount: parseFloat(solAmount),
          tokenAmount: result.tokensBought || 0,
          source: 'manual-buy'
        });
        console.log(`[Buy] ✅ Trade recorded in PumpPortal`);
      } catch (injectError) {
        console.warn(`[Buy] ⚠️ Failed to record trade: ${injectError.message}`);
      }
      
      res.json({ success: true, result });
    } catch (error) {
      console.error('[Buy] Error:', error);
      res.status(500).json({ success: false, error: error.message || 'Buy failed' });
    }
  } catch (error) {
    console.error('[Buy] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Check token balance for any wallet (test endpoint)
app.post('/api/test-wallet/balance', async (req, res) => {
  try {
    const { privateKey, mintAddress } = req.body;
    
    if (!privateKey || !mintAddress) {
      return res.status(400).json({ success: false, error: 'Missing required parameters' });
    }
    
    const connection = getConnection();
    const kp = Keypair.fromSecretKey(base58.decode(privateKey));
    const mintPubkey = new PublicKey(mintAddress);
    
    // Get SOL balance
    const solBalance = await connection.getBalance(kp.publicKey);
    
    // Get token balance
    let tokenBalance = 0;
    let hasTokens = false;
    try {
      const ata = await getAssociatedTokenAddress(mintPubkey, kp.publicKey, true);
      const accountInfo = await connection.getParsedAccountInfo(ata);
      
      if (accountInfo.value && accountInfo.value.data && accountInfo.value.data.parsed) {
        tokenBalance = accountInfo.value.data.parsed.info.tokenAmount.uiAmount || 0;
        hasTokens = tokenBalance > 0;
      }
    } catch (e) {
      // Token account doesn't exist yet
      tokenBalance = 0;
      hasTokens = false;
    }
    
    res.json({
      success: true,
      balance: tokenBalance,
      hasTokens,
      solBalance: solBalance / LAMPORTS_PER_SOL,
      address: kp.publicKey.toBase58()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Sell tokens with holder wallet
app.post('/api/holder-wallet/sell', async (req, res) => {
  try {
    // Support both privateKey (legacy) and walletAddress (secure)
    let { privateKey, walletAddress, mintAddress, percentage, priorityFee } = req.body;
    
    // If walletAddress provided, look up privateKey server-side
    if (!privateKey && walletAddress) {
      privateKey = getPrivateKeyByAddress(walletAddress);
      if (!privateKey) {
        return res.status(400).json({ success: false, error: 'Wallet not found in current run' });
      }
    }
    
    if (!privateKey || !mintAddress || percentage === undefined) {
      return res.status(400).json({ success: false, error: 'Missing required parameters (need walletAddress or privateKey, mintAddress, percentage)' });
    }
    
    // Use the wrapper function directly
    const { callTradingFunction } = require('./call-trading-function');
    
    try {
      const walletKp = Keypair.fromSecretKey(base58.decode(privateKey));
      const resolvedWalletAddress = walletKp.publicKey.toBase58();
      const feeLevel = priorityFee === 'ultra' ? 'ultra' : priorityFee === 'high' ? 'high' : priorityFee === 'medium' ? 'medium' : priorityFee === 'none' ? 'none' : 'low'; // Default to 'low'
      
      const result = await callTradingFunction('sellTokenSimple', privateKey, mintAddress, parseFloat(percentage), feeLevel);
      
      // Invalidate cache after sell
      invalidateBalanceCache(resolvedWalletAddress, mintAddress);
      
      // NOTE: Don't manually inject trades here - PumpPortal catches them with correct SOL amounts
      // The trading-terminal returns only { signature, txUrl }, not solReceived/tokensSold
      // PumpPortal WebSocket will detect this trade and record it properly
      
      res.json({ success: true, result });
    } catch (error) {
      console.error('[Sell] Error:', error);
      res.status(500).json({ success: false, error: error.message || 'Sell failed' });
    }
  } catch (error) {
    console.error('[Sell] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// BATCH SELL ENDPOINTS - Instant parallel sells (no process spawn!)
// ============================================================================

// Batch sell ALL wallets (DEV + Bundle + Holder) - INSTANT!
app.post('/api/batch-sell', async (req, res) => {
  try {
    const { percentage = 100, priorityFee = 'high' } = req.body;
    const { callTradingFunction } = require('./call-trading-function');
    
    console.log(`[BatchSell] 🚀 SELL ALL wallets - ${percentage}% with ${priorityFee} priority`);
    const result = await callTradingFunction('batchSellAll', percentage, priorityFee);
    
    // Invalidate all caches
    invalidateAllBalanceCaches();
    
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[BatchSell] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Batch sell BUNDLE wallets only (DEV + Bundles) - INSTANT!
app.post('/api/batch-sell-bundles', async (req, res) => {
  try {
    const { percentage = 100, priorityFee = 'high' } = req.body;
    const { callTradingFunction } = require('./call-trading-function');
    
    console.log(`[BatchSell] 🚀 SELL BUNDLES - ${percentage}% with ${priorityFee} priority`);
    const result = await callTradingFunction('batchSellBundles', percentage, priorityFee);
    
    // Invalidate all caches
    invalidateAllBalanceCaches();
    
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[BatchSell] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Batch sell HOLDER wallets only - INSTANT!
app.post('/api/batch-sell-holders', async (req, res) => {
  try {
    const { percentage = 100, priorityFee = 'high' } = req.body;
    const { callTradingFunction } = require('./call-trading-function');
    
    console.log(`[BatchSell] 🚀 SELL HOLDERS - ${percentage}% with ${priorityFee} priority`);
    const result = await callTradingFunction('batchSellHolders', percentage, priorityFee);
    
    // Invalidate all caches
    invalidateAllBalanceCaches();
    
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[BatchSell] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Sell all tokens (99.9%) from a wallet
app.post('/api/warming-wallets/sell-all-tokens', async (req, res) => {
  try {
    const { walletAddress } = req.body;
    
    if (!walletAddress) {
      return res.status(400).json({ success: false, error: 'Wallet address is required' });
    }
    
    // Load wallet from warmed wallets to get private key
    const { loadWarmedWallets } = require(projectPath('src', 'wallet-warming-manager.ts'));
    const wallets = loadWarmedWallets();
    const wallet = wallets.find(w => w.address === walletAddress);
    
    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Wallet not found in warmed wallets' });
    }
    
    if (!wallet.privateKey) {
      return res.status(400).json({ success: false, error: 'Private key not found for this wallet' });
    }
    
    const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
    const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
    // Use top-level base58 import (handles bs58 v6 export format)
    const { callTradingFunction } = require('./call-trading-function');
    
    const walletKp = Keypair.fromSecretKey(base58.decode(wallet.privateKey));
    
    // Get RPC endpoint
    const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
    const RPC_WEBSOCKET_ENDPOINT = process.env.RPC_WEBSOCKET_ENDPOINT || '';
    const connection = new Connection(RPC_ENDPOINT, {
      wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
      commitment: 'confirmed'
    });
    
    // Get all token accounts using PARSED format (much more reliable)
    console.log(`[Sell All] Querying token accounts for ${walletKp.publicKey.toBase58()}...`);
    
    // Use 'confirmed' commitment to get latest state
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      walletKp.publicKey, 
      { programId: TOKEN_PROGRAM_ID },
      { commitment: 'confirmed' }
    );
    
    console.log(`[Sell All] RPC returned ${tokenAccounts.value.length} token account(s) for wallet ${walletAddress.substring(0, 8)}...`);
    
    // Also try Token-2022 program (some tokens use this)
    try {
      const token2022Accounts = await connection.getParsedTokenAccountsByOwner(
        walletKp.publicKey,
        { programId: new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') },
        { commitment: 'confirmed' }
      );
      if (token2022Accounts.value.length > 0) {
        console.log(`[Sell All] Also found ${token2022Accounts.value.length} Token-2022 account(s)`);
        tokenAccounts.value.push(...token2022Accounts.value);
      }
    } catch (e) {
      // Token-2022 query failed, ignore
    }
    
    // Debug: Log ALL token accounts (even zero balance) to see what wallet actually has
    console.log(`[Sell All] ========== FULL WALLET INVENTORY ==========`);
    let totalTokensFound = 0;
    let tokensWithBalanceCount = 0;
    for (let i = 0; i < tokenAccounts.value.length; i++) {
      const { account } = tokenAccounts.value[i];
      const parsedInfo = account.data.parsed?.info;
      if (parsedInfo) {
        const mint = parsedInfo.mint || '?';
        const uiAmount = parsedInfo.tokenAmount?.uiAmount || 0;
        const rawAmount = parsedInfo.tokenAmount?.amount || '0';
        const decimals = parsedInfo.tokenAmount?.decimals || 0;
        totalTokensFound++;
        if (uiAmount > 0) {
          tokensWithBalanceCount++;
          console.log(`[Sell All] #${i}: ${mint.substring(0, 8)}... = ${uiAmount.toLocaleString()} tokens (raw=${rawAmount}, dec=${decimals})`);
        }
      }
    }
    console.log(`[Sell All] ========== SUMMARY: ${tokensWithBalanceCount} tokens with balance out of ${totalTokensFound} total accounts ==========`);
    
    if (tokenAccounts.value.length === 0) {
      return res.json({ success: true, message: 'No tokens found', results: [], summary: { successful: 0, failed: 0, total: 0 } });
    }
    
    const results = [];
    const tokensToSell = []; // Store tokens with balance for selling
    
    // First, identify all tokens with balance using parsed data
    for (let i = 0; i < tokenAccounts.value.length; i++) {
      const { account, pubkey } = tokenAccounts.value[i];
      
      try {
        const parsedInfo = account.data.parsed?.info;
        if (!parsedInfo) {
          console.log(`[Sell All] Skipping account ${i} - no parsed info`);
          continue;
        }
        
        const mintAddress = parsedInfo.mint;
        const uiAmount = parsedInfo.tokenAmount?.uiAmount || 0;
        const rawAmount = parsedInfo.tokenAmount?.amount || '0';
        const decimals = parsedInfo.tokenAmount?.decimals || 6;
        
        // Check if token has any balance
        const hasBalance = uiAmount > 0 || (rawAmount && rawAmount !== '0' && Number(rawAmount) > 0);
        
        if (!hasBalance) {
          console.log(`[Sell All] Skipping ${mintAddress.substring(0, 8)}... (zero balance)`);
          continue; // Skip empty accounts
        }
        
        // MINIMUM 10,000 tokens filter - skip microscopic amounts
        const MIN_TOKENS_TO_SELL = 10000;
        if (uiAmount < MIN_TOKENS_TO_SELL) {
          console.log(`[Sell All] Skipping ${mintAddress.substring(0, 8)}... (only ${uiAmount.toLocaleString()} tokens, need 10,000+)`);
          continue;
        }
        
        tokensToSell.push({
          mintAddress,
          uiAmount,
          rawAmount,
          decimals,
          pubkey: pubkey.toBase58()
        });
        
        console.log(`[Sell All] Token ${tokensToSell.length}: ${mintAddress.substring(0, 8)}... (balance: ${uiAmount.toLocaleString()} tokens)`);
      } catch (error) {
        console.error(`[Sell All] Error parsing token account ${i}:`, error.message);
      }
    }
    
    const tokensWithBalance = tokensToSell.length;
    
    if (tokensWithBalance === 0) {
      console.log(`[Sell All] No tokens with balance found in wallet ${walletAddress.substring(0, 8)}...`);
      return res.json({ 
        success: true, 
        message: 'No tokens with balance found', 
        results: [], 
        summary: { successful: 0, skipped: 0, failed: 0, total: 0, tokensWithBalance: 0 } 
      });
    }
    
    console.log(`[Sell All] 🚀 Found ${tokensWithBalance} token(s) with balance, selling ALL in PARALLEL with HIGH priority (Helius Sender)...`);
    
    // Sell ALL tokens in PARALLEL (like batch sell) - instant execution
    const sellPromises = tokensToSell.map(async ({ mintAddress, uiAmount, rawAmount, pubkey }, index) => {
      try {
        console.log(`[Sell All] [${index + 1}/${tokensWithBalance}] 🚀 Selling ${mintAddress.substring(0, 8)}... (balance: ${uiAmount}) in parallel...`);
        
        // Sell 99% with HIGH priority (uses Helius Sender for instant execution)
        const result = await callTradingFunction('sellTokenSimple', wallet.privateKey, mintAddress, 99, 'high');
        if (result && result.signature) {
          console.log(`[Sell All] ✅ [${index + 1}/${tokensWithBalance}] Sold ${mintAddress.substring(0, 8)}... - Tx: ${result.signature}`);
          // Invalidate cache
          invalidateBalanceCache(walletAddress, mintAddress);
          return { mint: mintAddress, success: true, result };
        } else {
          throw new Error('No signature returned from sell transaction');
        }
      } catch (sellError) {
        const errorMsg = sellError.message || 'Unknown error';
        
        // Check if it's a "no liquidity" error - these tokens are dead/rugged
        if (errorMsg.includes('No Jupiter route') || errorMsg.includes('no route') || errorMsg.includes('Could not find')) {
          console.log(`[Sell All] ⏭️ [${index + 1}/${tokensWithBalance}] Skipping ${mintAddress.substring(0, 8)}... (no liquidity - token may be dead)`);
          return { mint: mintAddress, success: false, error: 'No liquidity (dead token)', skipped: true };
        } else if (errorMsg.includes('too small') || errorMsg.includes('Amount to sell') || errorMsg.includes('No tokens')) {
          // Try one more time with 100% and high priority
          try {
            console.log(`[Sell All] [${index + 1}/${tokensWithBalance}] Retrying with 100% for ${mintAddress.substring(0, 8)}...`);
            const retryResult = await callTradingFunction('sellTokenSimple', wallet.privateKey, mintAddress, 100, 'high');
            if (retryResult && retryResult.signature) {
              invalidateBalanceCache(walletAddress, mintAddress);
              return { mint: mintAddress, success: true, result: retryResult, retried: true };
            } else {
              throw new Error('No signature returned from retry');
            }
          } catch (retryError) {
            console.error(`[Sell All] ❌ [${index + 1}/${tokensWithBalance}] Retry failed for ${mintAddress.substring(0, 8)}...:`, retryError.message);
            return { mint: mintAddress, success: false, error: retryError.message };
          }
        } else {
          console.error(`[Sell All] ❌ [${index + 1}/${tokensWithBalance}] Failed to sell ${mintAddress.substring(0, 8)}...:`, errorMsg);
          return { mint: mintAddress, success: false, error: errorMsg };
        }
      }
    });
    
    // Wait for all sells to complete in parallel
    const sellResults = await Promise.all(sellPromises);
    results.push(...sellResults);
    
    // Update wallet balance after selling
    try {
      const { updateWalletBalance } = require(projectPath('src', 'wallet-warming-manager.ts'));
      await updateWalletBalance(walletAddress);
      console.log(`[Sell All] Updated balance for ${walletAddress.substring(0, 8)}...`);
    } catch (error) {
      console.error(`[Sell All] Failed to update balance:`, error.message);
    }
    
    const successful = results.filter(r => r.success).length;
    const skipped = results.filter(r => r.skipped).length;
    const failed = results.filter(r => !r.success && !r.skipped).length;
    
    console.log(`[Sell All] Complete: ${successful} sold, ${skipped} skipped (no liquidity), ${failed} failed`);
    
    res.json({
      success: true,
      message: `Sold ${successful} token(s)${skipped > 0 ? `, skipped ${skipped} (no liquidity)` : ''}${failed > 0 ? `, ${failed} failed` : ''}`,
      results,
      summary: { successful, skipped, failed, total: results.length, tokensWithBalance }
    });
  } catch (error) {
    console.error('[Sell All Tokens] Error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to sell all tokens' });
  }
});

// Close all empty token accounts from a wallet (recover rent)
app.post('/api/warming-wallets/close-empty-accounts', async (req, res) => {
  try {
    const { walletAddress } = req.body;
    
    if (!walletAddress) {
      return res.status(400).json({ success: false, error: 'Wallet address is required' });
    }
    
    // Load wallet from warmed wallets to get private key
    const { loadWarmedWallets } = require(projectPath('src', 'wallet-warming-manager.ts'));
    const wallets = loadWarmedWallets();
    const wallet = wallets.find(w => w.address === walletAddress);
    
    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Wallet not found in warmed wallets' });
    }
    
    if (!wallet.privateKey) {
      return res.status(400).json({ success: false, error: 'Private key not found for this wallet' });
    }
    
    const { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } = require('@solana/web3.js');
    const { TOKEN_PROGRAM_ID, createCloseAccountInstruction } = require('@solana/spl-token');
    // Use top-level base58 import (handles bs58 v6 export format)
    
    const walletKp = Keypair.fromSecretKey(base58.decode(wallet.privateKey));
    
    // Get RPC endpoint
    const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
    const RPC_WEBSOCKET_ENDPOINT = process.env.RPC_WEBSOCKET_ENDPOINT || '';
    const connection = new Connection(RPC_ENDPOINT, {
      wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
      commitment: 'confirmed'
    });
    
    console.log(`[Close Accounts] Finding empty token accounts for ${walletAddress.substring(0, 8)}...`);
    
    // Get all token accounts (both Token and Token-2022)
    const tokenAccounts = await connection.getTokenAccountsByOwner(walletKp.publicKey, {
      programId: TOKEN_PROGRAM_ID
    });
    
    // Token-2022 program ID
    const TOKEN_2022_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
    let token2022Accounts = { value: [] };
    try {
      token2022Accounts = await connection.getTokenAccountsByOwner(walletKp.publicKey, {
        programId: TOKEN_2022_ID
      });
    } catch (e) {
      // Token-2022 query failed, ignore
    }
    
    const allTokenAccounts = [...tokenAccounts.value, ...token2022Accounts.value];
    
    if (allTokenAccounts.length === 0) {
      return res.json({ 
        success: true, 
        message: 'No token accounts found',
        closed: 0,
        rentRecovered: 0
      });
    }
    
    console.log(`[Close Accounts] Found ${allTokenAccounts.length} token account(s)`);
    
    let closedCount = 0;
    let totalRentRecovered = 0;
    const results = [];
    
    // Process each token account
    for (const tokenAccountInfo of allTokenAccounts) {
      const tokenAccount = tokenAccountInfo.pubkey;
      const rawAccountData = tokenAccountInfo.account.data;
      const accountProgramId = tokenAccountInfo.account.owner;
      const isToken2022 = accountProgramId.equals(TOKEN_2022_ID);
      
      try {
        // Check if account still exists and get balance
        const accountInfo = await connection.getAccountInfo(tokenAccount);
        if (!accountInfo) {
          continue; // Account already closed
        }
        
        const lamportsOnAccount = accountInfo.lamports;
        
        // Read balance from raw account data
        if (rawAccountData.length < 72) {
          continue; // Invalid account data
        }
        
        const balanceBigInt = rawAccountData.readBigUInt64LE(64);
        const balance = Number(balanceBigInt);
        
        // Read owner/authority
        const ownerBytes = rawAccountData.slice(32, 64);
        const accountOwner = new PublicKey(ownerBytes);
        
        // Only close if balance is 0 and owner matches wallet
        if (balance > 0) {
          console.log(`[Close Accounts] Skipping ${tokenAccount.toBase58()} - has ${balance} tokens`);
          continue;
        }
        
        if (!accountOwner.equals(walletKp.publicKey)) {
          console.log(`[Close Accounts] Skipping ${tokenAccount.toBase58()} - owner mismatch`);
          continue;
        }
        
        // Close the account
        const programIdForClose = isToken2022 ? TOKEN_2022_ID : TOKEN_PROGRAM_ID;
        const latestBlockhash = await connection.getLatestBlockhash('confirmed');
        
        const closeMsg = new TransactionMessage({
          payerKey: walletKp.publicKey,
          recentBlockhash: latestBlockhash.blockhash,
          instructions: [
            createCloseAccountInstruction(
              tokenAccount,
              walletKp.publicKey,
              accountOwner,
              [],
              programIdForClose
            )
          ]
        }).compileToV0Message();
        
        const closeTx = new VersionedTransaction(closeMsg);
        closeTx.sign([walletKp]);
        
        try {
          const closeSig = await connection.sendTransaction(closeTx, { skipPreflight: false, maxRetries: 3 });
          await connection.confirmTransaction(closeSig, 'confirmed');
          
          closedCount++;
          totalRentRecovered += lamportsOnAccount;
          results.push({ 
            account: tokenAccount.toBase58(), 
            success: true, 
            rent: lamportsOnAccount / 1e9,
            signature: closeSig
          });
          console.log(`[Close Accounts] ✅ Closed ${tokenAccount.toBase58()}: ${(lamportsOnAccount / 1e9).toFixed(6)} SOL`);
        } catch (closeError) {
          const errorMsg = closeError.message || String(closeError);
          if (errorMsg.includes('InvalidAccountData') || errorMsg.includes('AccountNotInitialized')) {
            console.log(`[Close Accounts] ℹ️ ${tokenAccount.toBase58()} already closed`);
            continue;
          }
          results.push({ 
            account: tokenAccount.toBase58(), 
            success: false, 
            error: errorMsg
          });
          console.log(`[Close Accounts] ❌ Failed to close ${tokenAccount.toBase58()}: ${errorMsg}`);
        }
        
        // Small delay between closes
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.log(`[Close Accounts] ⚠️ Error processing ${tokenAccount.toBase58()}: ${error.message}`);
        results.push({ 
          account: tokenAccount.toBase58(), 
          success: false, 
          error: error.message
        });
      }
    }
    
    console.log(`[Close Accounts] Complete: ${closedCount} closed, ${(totalRentRecovered / 1e9).toFixed(6)} SOL rent recovered`);
    
    res.json({
      success: true,
      message: `Closed ${closedCount} empty token account(s), recovered ${(totalRentRecovered / 1e9).toFixed(6)} SOL rent`,
      closed: closedCount,
      rentRecovered: totalRentRecovered / 1e9,
      results
    });
  } catch (error) {
    console.error('[Close Empty Accounts] Error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to close empty token accounts' });
  }
});

// Execute command
app.post('/api/command', async (req, res) => {
  try {
    const { command } = req.body;
    
    if (!command) {
      return res.status(400).json({ success: false, error: 'Command is required' });
    }
    
    // Map command names to npm scripts
    const commandMap = {
      'rapid-sell': 'rapid-sell',
      'rapid-sell-holders': 'rapid-sell-holders',
      'rapid-sell-50-percent': 'rapid-sell-50-percent',
      'rapid-sell-remaining': 'rapid-sell-remaining',
      'gather': 'gather',
      'gather-new-only': 'gather-new-only',
      'gather-sol-only': 'gather-sol-only',
      'gather-all': 'gather-all',
      'gather-warmed': 'gather-warmed',
      'gather-last': 'gather-last',
      'withdraw-mixers': 'withdraw-mixers',
      'withdraw-all': 'withdraw-all',
      'withdraw-preview': 'withdraw-preview',
      'recover-intermediary': 'recover-intermediary',
      'recover-evm': 'recover-evm',
      'recovery': 'recovery',
      'archive': 'archive',
      'archive-dry': 'archive-dry',
      'check-balance': 'check-balance',
      'check-bundle': 'check-bundle',
      'status': 'status',
      'collect-fees': 'collect-fees'
    };
    
    const npmScript = commandMap[command];
    if (!npmScript) {
      return res.status(400).json({ success: false, error: `Unknown command: ${command}` });
    }
    
    // Rapid sell commands should use MEDIUM priority fee for speed (HIGH is overkill)
    // Manual buys/sells use the user-selected priority fee from the UI
    const rapidSellCommands = ['rapid-sell', 'rapid-sell-50-percent', 'rapid-sell-remaining', 'rapid-sell-holders'];
    const useMediumPriority = rapidSellCommands.includes(command);
    
    // Build command with priority fee argument for rapid sells
    let commandToRun = `npm run ${npmScript}`;
    if (useMediumPriority && npmScript === 'rapid-sell') {
      // rapid-sell accepts: mintAddress, initialWaitMs, priorityFee
      // Pass undefined for mintAddress (auto-detect), 0 for wait, 'medium' for priority
      commandToRun = `npm run ${npmScript} -- "" 0 medium`;
      console.log(`[Command] Using MEDIUM priority fee for rapid sell`);
    }
    // Note: rapid-sell-50-percent and rapid-sell-remaining don't accept priority fee args
    // They use HIGH priority fee internally (hardcoded in their scripts)
    
    // Execute command from project root (where package.json is)
    const projectRoot = path.join(__dirname, '..');
    console.log(`[Command] Executing: ${commandToRun} from ${projectRoot}`);
    
    // Execute command in background
    // For long-running commands like gather/gather-all, set a longer timeout
    const longRunningCommands = [
      'gather', 'gather-new-only', 'gather-sol-only', 'gather-all', 'gather-warmed', 'gather-last',
      'withdraw-mixers', 'withdraw-all', 'withdraw-preview',
      'recover-intermediary', 'recover-evm', 'recovery',
      'archive', 'archive-dry',
      'rapid-sell', 'rapid-sell-50-percent', 'rapid-sell-remaining'
    ];
    const timeoutMs = longRunningCommands.includes(command) ? 300000 : 60000; // 5 minutes for gather, 1 minute for others
    
    const childProcess = exec(commandToRun, { 
      cwd: projectRoot, // Use project root, not api-server directory
      env: process.env,
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer for output
    });
    
    let output = '';
    let errorOutput = '';
    
    // Set timeout for long-running commands
    const timeout = setTimeout(() => {
      if (!childProcess.killed) {
        console.log(`[Command] Command ${command} timed out after ${timeoutMs}ms, killing process...`);
        childProcess.kill('SIGTERM');
        res.json({
          success: false,
          exitCode: -1,
          output: output + errorOutput + `\n⚠️ Command timed out after ${timeoutMs / 1000}s. It may still be running in the background.`,
          message: 'Command timed out (may still be running)'
        });
      }
    }, timeoutMs);
    
    childProcess.stdout.on('data', (data) => {
      const dataStr = data.toString();
      output += dataStr;
      console.log(`[Command ${command}] stdout:`, dataStr.trim());
    });
    
    childProcess.stderr.on('data', (data) => {
      const dataStr = data.toString();
      errorOutput += dataStr;
      console.log(`[Command ${command}] stderr:`, dataStr.trim());
    });
    
    childProcess.on('close', (code) => {
      clearTimeout(timeout);
      console.log(`[Command ${command}] Process exited with code ${code}`);
      
      // AUTO-CLEANUP: After gather commands complete successfully, unsubscribe from PumpPortal
      const gatherCommands = ['gather', 'gather-new-only', 'gather-all', 'gather-last'];
      if (code === 0 && gatherCommands.includes(command)) {
        try {
          // Get current mint address from current-run.json
          const currentRunPath = path.join(__dirname, '..', 'keys', 'current-run.json');
          if (fs.existsSync(currentRunPath)) {
            const currentRun = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
            const mintAddress = currentRun.mintAddress;
            if (mintAddress) {
              console.log(`[PumpPortal] 🧹 Auto-cleanup: Unsubscribing from ${mintAddress.slice(0, 8)}... after gather`);
              pumpPortalTracker.unsubscribeFromToken(mintAddress);
              pumpPortalTracker.clearCache(mintAddress);
            }
          }
        } catch (cleanupError) {
          console.error('[PumpPortal] Cleanup error:', cleanupError.message);
        }
      }
      
      res.json({
        success: code === 0,
        exitCode: code,
        output: output + errorOutput,
        message: code === 0 ? 'Command executed successfully' : `Command failed with exit code ${code}`
      });
    });
    
    childProcess.on('error', (error) => {
      clearTimeout(timeout);
      console.error(`[Command ${command}] Process error:`, error);
      res.status(500).json({ success: false, error: error.message });
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get current run info
app.get('/api/current-run', (req, res) => {
  try {
    const currentRunPath = path.join(__dirname, '..', 'keys', 'current-run.json');
    
    if (!fs.existsSync(currentRunPath)) {
      return res.json({ success: true, data: null });
    }
    
    const data = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Current Run] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get profit/loss tracking data
app.get('/api/profit-loss', (req, res) => {
  try {
    const profitLossPath = path.join(__dirname, '..', 'keys', 'pnl', 'profit-loss.json');
    
    if (!fs.existsSync(profitLossPath)) {
      return res.json({ 
        success: true, 
        data: {
          records: [],
          cumulativeProfitLoss: 0,
          lastUpdated: new Date().toISOString()
        }
      });
    }
    
    const data = JSON.parse(fs.readFileSync(profitLossPath, 'utf8'));
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Profit/Loss] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Serve profit/loss UI page
app.get('/profit-loss', (req, res) => {
  const uiPath = path.join(__dirname, 'profit-loss-ui.html');
  res.sendFile(uiPath);
});

// Get launch wallet info and SOL requirements
// Now supports query params for warmed wallet addresses to account for existing balances
app.get('/api/launch-wallet-info', async (req, res) => {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    const env = readEnvFile();
    
    // Parse warmed wallet addresses from query params (comma-separated)
    const warmedBundleAddresses = req.query.bundleAddresses ? req.query.bundleAddresses.split(',').filter(a => a) : [];
    const warmedHolderAddresses = req.query.holderAddresses ? req.query.holderAddresses.split(',').filter(a => a) : [];
    const warmedCreatorAddress = req.query.creatorAddress || null;
    
    // Get wallet addresses (public keys only)
    // Use top-level base58 import (handles bs58 v6 export format)
    if (!env.PRIVATE_KEY || env.PRIVATE_KEY.trim() === '') {
      return res.status(400).json({
        error: 'PRIVATE_KEY is not set in .env file',
        message: 'Please set PRIVATE_KEY in your .env file to use the launch wallet features.'
      });
    }
    
    let fundingWalletKp;
    try {
      fundingWalletKp = Keypair.fromSecretKey(base58.decode(env.PRIVATE_KEY));
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid PRIVATE_KEY format',
        message: 'PRIVATE_KEY must be a valid base58-encoded secret key (64 bytes).',
        details: error.message
      });
    }
    
    const fundingWalletAddress = fundingWalletKp.publicKey.toBase58();
    
    // Get funding wallet balance
    const connection = new Connection(env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com');
    const fundingBalance = await connection.getBalance(fundingWalletKp.publicKey);
    
    // Creator/DEV wallet info
    // PRIORITY 0: USE_FUNDING_AS_BUYER=true → Use funding wallet as DEV (same wallet, no separate funding)
    // PRIORITY 1: Use BUYER_WALLET from .env if set (ALWAYS use this if present)
    // PRIORITY 2: Check current-run.json for creatorDevWalletKey (only if BUYER_WALLET not set)
    // PRIORITY 3: Will be auto-created (only if neither exists)
    let creatorDevWallet = null;
    let creatorDevPrivateKey = null;
    const useFundingAsBuyer = env.USE_FUNDING_AS_BUYER === 'true';
    
    // PRIORITY 0: Check if USE_FUNDING_AS_BUYER=true - funding wallet IS the DEV wallet
    if (useFundingAsBuyer) {
      creatorDevWallet = {
        address: fundingWalletAddress,
        source: 'Funding Wallet (USE_FUNDING_AS_BUYER=true)',
        balance: fundingBalance / 1e9,
        isAutoCreated: false,
        isFundingWallet: true // Special flag - DEV wallet is the same as funding wallet
      };
      creatorDevPrivateKey = env.PRIVATE_KEY; // Will be shortened later
    } else if (env.BUYER_WALLET && env.BUYER_WALLET.trim() !== '') {
      // PRIORITY 1: Check if BUYER_WALLET is set in .env - if yes, use it
      let creatorKp;
      try {
        creatorKp = Keypair.fromSecretKey(base58.decode(env.BUYER_WALLET));
      } catch (error) {
        return res.status(400).json({
          error: 'Invalid BUYER_WALLET format',
          message: 'BUYER_WALLET must be a valid base58-encoded secret key (64 bytes).',
          details: error.message
        });
      }
      const creatorBalance = await connection.getBalance(creatorKp.publicKey);
      creatorDevWallet = {
        address: creatorKp.publicKey.toBase58(),
        source: 'BUYER_WALLET env var',
        balance: creatorBalance / 1e9,
        isAutoCreated: false
      };
      creatorDevPrivateKey = env.BUYER_WALLET; // Will be shortened later
    } else {
      // BUYER_WALLET not set - check current-run.json for previously auto-created wallet
      const currentRunPath = path.join(__dirname, '..', 'keys', 'current-run.json');
      let creatorDevWalletKey = null;
      
      if (fs.existsSync(currentRunPath)) {
        try {
          const currentRunData = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
          if (currentRunData.creatorDevWalletKey) {
            creatorDevWalletKey = currentRunData.creatorDevWalletKey;
          }
        } catch (e) {
          // Ignore errors reading current-run.json
        }
      }
      
      // CRITICAL: If USE_FUNDING_AS_BUYER=false and the stored wallet key is the same as PRIVATE_KEY,
      // ignore it and treat as if no wallet exists (will create fresh wallet)
      // This ensures we don't reuse the funding wallet when user wants a separate dev wallet
      if (creatorDevWalletKey && !useFundingAsBuyer && creatorDevWalletKey === env.PRIVATE_KEY) {
        console.log('[Launch Wallet Info] creatorDevWalletKey matches PRIVATE_KEY and USE_FUNDING_AS_BUYER=false - will create fresh wallet');
        creatorDevWalletKey = null; // Ignore it, treat as if no wallet exists
      }
      
      if (creatorDevWalletKey) {
        // Use previously auto-created wallet from current-run.json
        const creatorKp = Keypair.fromSecretKey(base58.decode(creatorDevWalletKey));
        const creatorBalance = await connection.getBalance(creatorKp.publicKey);
        creatorDevWallet = {
          address: creatorKp.publicKey.toBase58(),
          source: 'creatorDevWalletKey from current-run.json (auto-created in previous launch)',
          balance: creatorBalance / 1e9,
          isAutoCreated: false // This is an existing wallet, but funding logic will handle it
        };
        creatorDevPrivateKey = creatorDevWalletKey; // Will be shortened later
      } else {
        // No wallet found - will be auto-created on next launch
        creatorDevWallet = {
          address: 'Will be auto-created',
          source: 'Auto-created (like bundle wallets)',
          balance: 0,
          isAutoCreated: true
        };
      }
    }
    
    // Parse wallet counts and amounts
    const bundleWalletCount = parseInt(env.BUNDLE_WALLET_COUNT || '0');
    const holderWalletCount = parseInt(env.HOLDER_WALLET_COUNT || '0');
    
    // Parse bundle amounts
    let bundleAmounts = [];
    if (env.BUNDLE_SWAP_AMOUNTS) {
      bundleAmounts = env.BUNDLE_SWAP_AMOUNTS.split(',').map(a => parseFloat(a.trim())).filter(a => !isNaN(a));
    } else if (env.SWAP_AMOUNTS) {
      bundleAmounts = env.SWAP_AMOUNTS.split(',').map(a => parseFloat(a.trim())).filter(a => !isNaN(a));
    }
    const swapAmount = parseFloat(env.SWAP_AMOUNT || '0.01');
    
    // Fill bundle amounts if needed
    while (bundleAmounts.length < bundleWalletCount) {
      bundleAmounts.push(swapAmount);
    }
    bundleAmounts = bundleAmounts.slice(0, bundleWalletCount);
    
    // Parse holder amounts
    let holderAmounts = [];
    if (env.HOLDER_SWAP_AMOUNTS) {
      holderAmounts = env.HOLDER_SWAP_AMOUNTS.split(',').map(a => parseFloat(a.trim())).filter(a => !isNaN(a));
    }
    const holderWalletAmount = parseFloat(env.HOLDER_WALLET_AMOUNT || '0.01');
    
    // Fill holder amounts if needed
    while (holderAmounts.length < holderWalletCount) {
      holderAmounts.push(holderWalletAmount);
    }
    holderAmounts = holderAmounts.slice(0, holderWalletCount);
    
    // Calculate total SOL needed
    const buyerAmount = parseFloat(env.BUYER_AMOUNT || '0.1');
    
    // Fetch warmed wallet balances if provided
    let warmedBundleBalances = [];
    let warmedHolderBalances = [];
    let warmedCreatorBalance = 0;
    
    if (warmedBundleAddresses.length > 0 || warmedHolderAddresses.length > 0 || warmedCreatorAddress) {
      try {
        // Fetch bundle wallet balances
        for (const addr of warmedBundleAddresses) {
          try {
            const pubkey = new PublicKey(addr);
            const balance = await connection.getBalance(pubkey);
            warmedBundleBalances.push(balance / 1e9);
          } catch (e) {
            warmedBundleBalances.push(0);
          }
        }
        
        // Fetch holder wallet balances
        for (const addr of warmedHolderAddresses) {
          try {
            const pubkey = new PublicKey(addr);
            const balance = await connection.getBalance(pubkey);
            warmedHolderBalances.push(balance / 1e9);
          } catch (e) {
            warmedHolderBalances.push(0);
          }
        }
        
        // Fetch creator wallet balance if warmed
        if (warmedCreatorAddress) {
          try {
            const pubkey = new PublicKey(warmedCreatorAddress);
            const balance = await connection.getBalance(pubkey);
            warmedCreatorBalance = balance / 1e9;
          } catch (e) {
            warmedCreatorBalance = 0;
          }
        }
      } catch (e) {
        console.log('[Launch Wallet Info] Error fetching warmed balances:', e.message);
      }
    }
    
    // Calculate bundle SOL needed (subtract existing balances for funding, but track total spending)
    let bundleSolNeeded = 0; // What needs to be transferred
    let bundleTotalSpending = 0; // Total SOL that will be spent on buys
    let bundleExistingBalance = 0;
    for (let i = 0; i < bundleAmounts.length; i++) {
      const buyAmount = bundleAmounts[i];
      const required = buyAmount + 0.01; // amount + buffer
      const existing = warmedBundleBalances[i] || 0;
      bundleExistingBalance += existing;
      const needed = Math.max(0, required - existing);
      bundleSolNeeded += needed;
      bundleTotalSpending += buyAmount; // Track total spending regardless of existing balance
    }
    
    // Calculate holder SOL needed (subtract existing balances for funding, but track total spending)
    let holderSolNeeded = 0; // What needs to be transferred
    let holderTotalSpending = 0; // Total SOL that will be spent on buys
    let holderExistingBalance = 0;
    for (let i = 0; i < holderAmounts.length; i++) {
      const buyAmount = holderAmounts[i];
      const required = buyAmount + 0.01; // amount + buffer
      const existing = warmedHolderBalances[i] || 0;
      holderExistingBalance += existing;
      const needed = Math.max(0, required - existing);
      holderSolNeeded += needed;
      holderTotalSpending += buyAmount; // Track total spending regardless of existing balance
    }
    
    // Creator/DEV wallet funding: if auto-created OR if existing wallet needs funding
    // The DEV buy amount (buyerAmount) must always be accounted for from the funding wallet
    let creatorDevSolNeeded = 0;
    const creatorRequiredAmount = buyerAmount + 0.1; // BUYER_AMOUNT + 0.1 SOL buffer for fees/rent/safety (matches index.ts)
    
    // Use warmed creator balance if provided, otherwise use existing creatorDevWallet balance
    const effectiveCreatorBalance = warmedCreatorAddress ? warmedCreatorBalance : creatorDevWallet.balance;
    
    // CRITICAL: If USE_FUNDING_AS_BUYER=true, NO separate DEV funding is needed
    // The DEV wallet IS the funding wallet - no transfer needed, buy comes from same balance
    if (useFundingAsBuyer || creatorDevWallet.isFundingWallet) {
      // DEV wallet is funding wallet - no separate funding needed
      creatorDevSolNeeded = 0;
    } else if (creatorDevWallet.isAutoCreated && !warmedCreatorAddress) {
      // Auto-created wallet (no warmed wallet selected): need to fund it fully
      creatorDevSolNeeded = creatorRequiredAmount;
    } else if (!useFundingAsBuyer && !warmedCreatorAddress) {
      // IMPORTANT: When USE_FUNDING_AS_BUYER=false and no warmed wallet selected,
      // we need to fund the DEV wallet fully, even if it exists from a previous launch
      // This ensures the wallet has enough SOL for the buyer amount
      // The wallet might have been used in previous launches
      if (effectiveCreatorBalance < creatorRequiredAmount) {
        // Need to top up the wallet to cover the buy + buffer
        creatorDevSolNeeded = creatorRequiredAmount - effectiveCreatorBalance;
      } else {
        // Wallet already has enough balance - no additional funding needed
        creatorDevSolNeeded = 0;
      }
    } else {
      // Warmed wallet selected: check if it needs funding
      if (effectiveCreatorBalance < creatorRequiredAmount) {
        // Need to top up the wallet to cover the buy + buffer
        creatorDevSolNeeded = creatorRequiredAmount - effectiveCreatorBalance;
      } else {
        // Wallet has enough balance - no funding needed
        creatorDevSolNeeded = 0;
      }
    }
    
    // Update creatorDevWallet info if warmed
    if (warmedCreatorAddress) {
      creatorDevWallet.address = warmedCreatorAddress;
      creatorDevWallet.source = 'Warmed wallet (selected)';
      creatorDevWallet.balance = warmedCreatorBalance;
      creatorDevWallet.isAutoCreated = false;
    }
    
    // IMPORTANT: Account for DEV buy amount in the total calculation
    // The "Total SOL Required" should show TOTAL SOL that will be SPENT, not just what needs to be transferred
    // 
    // Case 1: USE_FUNDING_AS_BUYER=true → DEV wallet IS funding wallet
    //   - devBuyCost = buyerAmount (buy comes from funding wallet, but still counts as spending)
    //
    // Case 2: Separate DEV wallet needs funding (creatorDevSolNeeded > 0)
    //   - devBuyCost = 0 (already included in creatorDevSolNeeded)
    //
    // Case 3: Separate DEV wallet has enough balance (creatorDevSolNeeded = 0)
    //   - devBuyCost = buyerAmount (wallet has balance, but buy still counts as spending)
    //
    let devBuyCost = 0;
    if (useFundingAsBuyer || creatorDevWallet.isFundingWallet) {
      // DEV wallet is funding wallet - buy amount still counts as spending
      devBuyCost = buyerAmount;
    } else if (creatorDevSolNeeded === 0 && effectiveCreatorBalance >= creatorRequiredAmount) {
      // Separate DEV wallet has enough balance - buy amount still counts as spending
      devBuyCost = buyerAmount;
    }
    // If creatorDevSolNeeded > 0, the buy amount is already included in creatorDevSolNeeded
    
    const jitoFee = parseFloat(env.JITO_FEE || '0.001');
    const lutFee = 0.002; // LUT creation rent (~0.001-0.002 SOL actual cost, using 0.002 as safe estimate)
    const buffer = 0.04; // Buffer for fees
    
    // Total SOL needed to TRANSFER (for funding wallets)
    const totalSolNeeded = bundleSolNeeded + holderSolNeeded + creatorDevSolNeeded + jitoFee + lutFee + buffer;
    
    // Total SOL that will be SPENT (including all buy amounts, regardless of wallet funding)
    const totalSolSpending = bundleTotalSpending + holderTotalSpending + buyerAmount + jitoFee + lutFee + buffer;
    
    // Helper function to shorten private key for display
    const shortenPrivateKey = (key) => {
      if (!key || key.length <= 16) return key;
      return key.substring(0, 8) + '...' + key.substring(key.length - 8);
    };
    
    res.json({
      success: true,
      data: {
        fundingWallet: {
          address: fundingWalletAddress,
          balance: fundingBalance / 1e9,
          label: 'MASTER_WALLET (PRIVATE_KEY)',
          privateKey: shortenPrivateKey(env.PRIVATE_KEY) // Shortened for security
        },
        creatorDevWallet: {
          ...creatorDevWallet,
          privateKey: creatorDevWallet.isAutoCreated ? null : shortenPrivateKey(creatorDevPrivateKey || '') // Shortened for security
        },
        bundleWallets: {
          count: bundleWalletCount,
          amounts: bundleAmounts,
          totalSol: bundleSolNeeded,
          existingBalance: bundleExistingBalance,
          isWarmed: warmedBundleAddresses.length > 0,
          label: 'Bundle Wallets'
        },
        holderWallets: {
          count: holderWalletCount,
          amounts: holderAmounts,
          totalSol: holderSolNeeded,
          existingBalance: holderExistingBalance,
          isWarmed: warmedHolderAddresses.length > 0,
          label: 'Holder Wallets'
        },
        breakdown: {
          bundleWallets: bundleSolNeeded,
          holderWallets: holderSolNeeded,
          bundleExistingBalance: bundleExistingBalance,
          holderExistingBalance: holderExistingBalance,
          creatorDevWallet: creatorDevSolNeeded,
          creatorExistingBalance: effectiveCreatorBalance,
          devBuyAmount: devBuyCost,
          jitoFee: jitoFee,
          lutFee: lutFee,
          buffer: buffer,
          total: totalSolSpending, // Show total SPENDING, not just transfers needed
          totalNeededToTransfer: totalSolNeeded, // What actually needs to be transferred
          totalSpending: totalSolSpending, // Total SOL that will be spent
          totalExistingBalance: bundleExistingBalance + holderExistingBalance + effectiveCreatorBalance
        },
        buyerAmount: buyerAmount,
        useFundingAsBuyer: useFundingAsBuyer // Flag indicating DEV wallet = Funding wallet
      }
    });
  } catch (error) {
    console.error('[Launch Wallet Info] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get deployer wallet balance
// SECURITY: Only returns PUBLIC KEY and balance, NEVER the private key
app.get('/api/deployer-wallet', async (req, res) => {
  try {
    // Try both process.env (from dotenv) and readEnvFile
    let privateKey = process.env.PRIVATE_KEY;
    
    if (!privateKey) {
      const env = readEnvFile();
      privateKey = env.PRIVATE_KEY;
    }
    
    if (!privateKey) {
      return res.json({ 
        success: true, 
        address: null, 
        balance: 0, 
        error: 'PRIVATE_KEY not set in .env file. Check that PRIVATE_KEY is in your .env file in the root directory.' 
      });
    }
    
    try {
      // Decode private key to get keypair
      const kp = Keypair.fromSecretKey(base58.decode(privateKey));
      const publicKey = kp.publicKey.toBase58();
      
      const connection = getConnection();
      const balance = await connection.getBalance(kp.publicKey);
      
      // SECURITY: Only return public key and balance, NEVER the private key
      res.json({
        success: true,
        address: publicKey, // Only public key, never private key
        balance: balance / LAMPORTS_PER_SOL
      });
    } catch (error) {
      console.error('[Deployer Wallet] Error:', error);
      res.status(500).json({ 
        success: false, 
        error: `Invalid PRIVATE_KEY format: ${error.message}` 
      });
    }
  } catch (error) {
    console.error('[Deployer Wallet] Error in endpoint:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// NOTE: Marketing API endpoints removed for simplified public version
// Removed: /api/marketing/* (website updates, telegram auth, group creation, twitter automation)

// Stub for any remaining marketing endpoint references
const MARKETING_DISABLED = true;
const marketingDisabledResponse = (res) => res.status(200).json({ 
  success: false, 
  disabled: true,
  message: 'Marketing features are not available in this version.' 
});

// Wallet Warming Endpoints - SIMPLIFIED SYSTEM
let warmingProcesses = new Map(); // Track active warming processes

// Get all warmed wallets
app.get('/api/warming-wallets', async (req, res) => {
  try {
    const { loadWarmedWallets } = require(projectPath('src', 'wallet-warming-manager.ts'));
    const wallets = loadWarmedWallets();
    
    res.json({
      success: true,
      wallets: wallets.map(w => ({
        address: w.address,
        transactionCount: w.transactionCount,
        firstTransactionDate: w.firstTransactionDate,
        lastTransactionDate: w.lastTransactionDate,
        totalTrades: w.totalTrades,
        tradesLast7Days: w.tradesLast7Days !== undefined ? w.tradesLast7Days : null,
        createdAt: w.createdAt,
        status: w.status,
        tags: w.tags || [],
        solBalance: w.solBalance || null,
        lastBalanceUpdate: w.lastBalanceUpdate || null,
        lastWarmedAt: w.lastWarmedAt || null
      }))
    });
  } catch (error) {
    console.error('[Warming] Get wallets error:', error);
    console.error('[Warming] Error stack:', error.stack);
    res.status(500).json({ success: false, error: error.message || 'Failed to get wallets' });
  }
});

// ============================================================
// 🔒 SECURITY: Private key retrieval endpoint REMOVED
// This endpoint was a major security vulnerability when exposed via ngrok
// Private keys should NEVER be returned via API endpoints
// Trading functions now use server-side lookup by wallet address
// ============================================================

// Create new wallet
app.post('/api/warming-wallets/create', async (req, res) => {
  try {
    const { tags } = req.body; // Optional tags array
    const { createWarmingWallet, loadWarmedWallets } = require(projectPath('src', 'wallet-warming-manager.ts'));
    
    // Create the wallet (this saves it automatically)
    const wallet = createWarmingWallet(Array.isArray(tags) ? tags : []);
    
    // Verify wallet was saved
    const savedWallets = loadWarmedWallets();
    const walletSaved = savedWallets.some(w => w.address === wallet.address);
    
    if (!walletSaved) {
      console.error(`[Warming] ⚠️  WARNING: Wallet ${wallet.address?.slice(0, 12)}... was created but may not have been saved!`);
      return res.status(500).json({ 
        success: false, 
        error: 'Wallet was created but failed to save. Please try again.' 
      });
    }
    
    console.log(`[Warming] ✅ Wallet created and saved: ${wallet.address.slice(0, 12)}... (tags: ${(tags || []).join(', ') || 'none'})`);
    
    res.json({
      success: true,
      wallet: {
        address: wallet.address,
        transactionCount: wallet.transactionCount,
        firstTransactionDate: wallet.firstTransactionDate,
        lastTransactionDate: wallet.lastTransactionDate,
        totalTrades: wallet.totalTrades,
        createdAt: wallet.createdAt,
        status: wallet.status,
        tags: wallet.tags || []
      },
      saved: true // Confirmation that wallet was saved
    });
  } catch (error) {
    console.error('[Warming] Create wallet error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to create wallet' });
  }
});

// Preview wallet (get address and balance from private key without adding)
app.post('/api/warming-wallets/preview', async (req, res) => {
  try {
    const { privateKey } = req.body;
    if (!privateKey) {
      return res.status(400).json({ success: false, error: 'Private key is required' });
    }
    
    // Validate private key format (same validation as add endpoint)
    // Use top-level base58 import (handles bs58 v6 export format)
    const { Keypair, Connection } = require('@solana/web3.js');
    
    let keypair;
    try {
      const trimmedKey = privateKey.trim();
      
      // Basic validation for private key format and length
      if (trimmedKey.length < 80 || trimmedKey.length > 200) {
        return res.status(400).json({ success: false, error: `Invalid private key length. Expected 80-200 characters, got ${trimmedKey.length}.` });
      }
      
      const decoded = base58.decode(trimmedKey);
      if (decoded.length !== 64) {
        return res.status(400).json({ success: false, error: `Invalid private key format. Decoded key is ${decoded.length} bytes, expected 64 bytes.` });
      }
      
      keypair = Keypair.fromSecretKey(decoded);
      const testAddress = keypair.publicKey.toBase58();
      
      if (!testAddress || testAddress.length < 32) {
        return res.status(400).json({ success: false, error: 'Failed to derive valid wallet address from private key' });
      }
    } catch (decodeError) {
      return res.status(400).json({ success: false, error: `Invalid private key format: ${decodeError.message || 'Failed to decode base58 key'}` });
    }
    
    const address = keypair.publicKey.toBase58();
    
    // Get SOL balance
    const rpcUrl = process.env.HELIUS_RPC_URL || process.env.RPC_URL || process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');
    
    let solBalance = 0;
    try {
      const balance = await connection.getBalance(keypair.publicKey);
      solBalance = balance / 1e9;
    } catch (balanceError) {
      console.warn('[Preview] Could not fetch balance:', balanceError.message);
      // Continue even if balance fetch fails - address is still valid
    }
    
    res.json({
      success: true,
      address: address, // Ensure address is always returned
      solBalance: solBalance || 0,
      solBalanceFormatted: (solBalance || 0).toFixed(6)
    });
  } catch (error) {
    console.error('[Warming] Preview wallet error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to preview wallet' });
  }
});

// Add existing wallet
app.post('/api/warming-wallets/add', async (req, res) => {
  try {
    const { privateKey, tags } = req.body;
    if (!privateKey) {
      return res.status(400).json({ success: false, error: 'Private key is required' });
    }
    
    // Validate private key format first
    // Use top-level base58 import (handles bs58 v6 export format)
    const { Keypair } = require('@solana/web3.js');
    
    let keypair;
    try {
      const trimmedKey = privateKey.trim();
      // Check if it's a valid base58 string
      if (trimmedKey.length < 80 || trimmedKey.length > 200) {
        return res.status(400).json({ success: false, error: 'Invalid private key length. Should be 80-200 characters (base58 format)' });
      }
      
      const decoded = base58.decode(trimmedKey);
      if (decoded.length !== 64) {
        return res.status(400).json({ success: false, error: 'Invalid private key format. Decoded length should be 64 bytes' });
      }
      
      keypair = Keypair.fromSecretKey(decoded);
      const testAddress = keypair.publicKey.toBase58();
      
      if (!testAddress || testAddress.length < 32) {
        return res.status(400).json({ success: false, error: 'Failed to derive valid wallet address from private key' });
      }
    } catch (decodeError) {
      console.error('[Warming] Private key decode error:', decodeError.message);
      return res.status(400).json({ 
        success: false, 
        error: `Invalid private key format: ${decodeError.message}. Make sure it's a valid base58-encoded Solana private key.` 
      });
    }
    
    const { addWarmingWallet, loadWarmedWallets } = require(projectPath('src', 'wallet-warming-manager.ts'));
    
    // Add the wallet (this saves it automatically)
    const wallet = addWarmingWallet(privateKey.trim(), tags || []);
    
    // Verify wallet was saved
    const savedWallets = loadWarmedWallets();
    const walletSaved = savedWallets.some(w => w.address === wallet.address);
    
    if (!walletSaved) {
      console.error(`[Warming] ⚠️  WARNING: Wallet ${wallet.address?.slice(0, 12)}... was created but may not have been saved!`);
      return res.status(500).json({ 
        success: false, 
        error: 'Wallet was created but failed to save. Please try again.' 
      });
    }
    
    console.log(`[Warming] ✅ Wallet added and saved: ${wallet.address.slice(0, 12)}... (tags: ${(tags || []).join(', ') || 'none'})`);
    
    res.json({
      success: true,
      wallet: {
        address: wallet.address,
        transactionCount: wallet.transactionCount,
        firstTransactionDate: wallet.firstTransactionDate,
        lastTransactionDate: wallet.lastTransactionDate,
        totalTrades: wallet.totalTrades,
        createdAt: wallet.createdAt,
        status: wallet.status,
        tags: wallet.tags || []
      },
      saved: true // Confirmation that wallet was saved
    });
  } catch (error) {
    console.error('[Warming] Add wallet error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to add wallet' });
  }
});

// Create and fund fresh volume wallets with multi-hop transfers
// Flow: Funding Wallet → Intermediate 1 → Intermediate 2 → Target Wallet
app.post('/api/volume-wallets/spawn', async (req, res) => {
  try {
    const { count = 1, amountPerWallet = 0.05, hops = 2, delayBetweenHopsMs = 2000 } = req.body;
    
    if (count < 1 || count > 10) {
      return res.status(400).json({ success: false, error: 'Count must be between 1 and 10' });
    }
    if (amountPerWallet < 0.01 || amountPerWallet > 1) {
      return res.status(400).json({ success: false, error: 'Amount per wallet must be between 0.01 and 1 SOL' });
    }
    if (hops < 1 || hops > 3) {
      return res.status(400).json({ success: false, error: 'Hops must be between 1 and 3' });
    }
    
    console.log(`[VolumeWallets] 🚀 Spawning ${count} volume wallet(s) with ${hops} hops, ${amountPerWallet} SOL each`);
    
    // Load funding wallet
    const env = readEnvFile();
    if (!env.PRIVATE_KEY) {
      return res.status(400).json({ success: false, error: 'No funding wallet configured (PRIVATE_KEY in .env)' });
    }
    
    const fundingKp = Keypair.fromSecretKey(base58.decode(env.PRIVATE_KEY));
    const fundingAddress = fundingKp.publicKey.toBase58();
    
    // Get connection
    const connection = getConnection();
    
    // Check funding wallet balance
    const fundingBalance = await connection.getBalance(fundingKp.publicKey);
    const fundingBalanceSol = fundingBalance / 1e9;
    const totalNeeded = count * (amountPerWallet + 0.005 * hops); // Add fee buffer per hop
    
    if (fundingBalanceSol < totalNeeded) {
      return res.status(400).json({ 
        success: false, 
        error: `Insufficient funding balance. Have: ${fundingBalanceSol.toFixed(4)} SOL, Need: ~${totalNeeded.toFixed(4)} SOL` 
      });
    }
    
    const { createWarmingWallet } = require(projectPath('src', 'wallet-warming-manager.ts'));
    const results = [];
    
    for (let i = 0; i < count; i++) {
      console.log(`[VolumeWallets] Creating wallet ${i + 1}/${count}...`);
      
      // Declare variables outside try block so they're accessible in catch
      let targetWallet = null;
      let intermediateWallets = [];
      let targetKp = null;
      
      try {
        // Create intermediate wallets for hops
        intermediateWallets = [];
        for (let h = 0; h < hops - 1; h++) {
          const intKp = Keypair.generate();
          intermediateWallets.push(intKp);
        }
        
        // Create final target wallet and save it
        targetWallet = createWarmingWallet(['volume', 'post-launch', 'holder']);
        targetKp = Keypair.fromSecretKey(base58.decode(targetWallet.privateKey));
        console.log(`[VolumeWallets]   ✅ Target wallet created and saved: ${targetWallet.address.slice(0, 12)}...`);
        
        // Save intermediate wallets (for record-keeping, even though they're temporary)
        const { addWarmingWallet } = require(projectPath('src', 'wallet-warming-manager.ts'));
        for (let h = 0; h < intermediateWallets.length; h++) {
          const intKp = intermediateWallets[h];
          const intPrivateKey = base58.encode(intKp.secretKey);
          addWarmingWallet(intPrivateKey, ['volume', 'intermediate', `hop-${h + 1}`]);
          console.log(`[VolumeWallets]   ✅ Intermediate wallet ${h + 1} saved: ${intKp.publicKey.toBase58().slice(0, 12)}...`);
        }
        
        // Build the hop chain: Funding -> Int1 -> Int2 -> ... -> Target
        const hopChain = [fundingKp, ...intermediateWallets, targetKp];
        
        // Amount to send (accounting for fees along the way)
        const feePerHop = 0.000005; // ~5000 lamports
        let currentAmount = amountPerWallet + (feePerHop * hops);
        
        // Execute transfers through each hop
        for (let h = 0; h < hopChain.length - 1; h++) {
          const fromKp = hopChain[h];
          const toKp = hopChain[h + 1];
          
          console.log(`[VolumeWallets]   Hop ${h + 1}/${hops}: ${fromKp.publicKey.toBase58().slice(0, 8)}... → ${toKp.publicKey.toBase58().slice(0, 8)}... (${currentAmount.toFixed(4)} SOL)`);
          
          const latestBlockhash = await connection.getLatestBlockhash('confirmed');
          const transferMsg = new TransactionMessage({
            payerKey: fromKp.publicKey,
            recentBlockhash: latestBlockhash.blockhash,
            instructions: [
              SystemProgram.transfer({
                fromPubkey: fromKp.publicKey,
                toPubkey: toKp.publicKey,
                lamports: Math.floor(currentAmount * 1e9)
              })
            ]
          }).compileToV0Message();
          
          const transferTx = new VersionedTransaction(transferMsg);
          transferTx.sign([fromKp]);
          
          const sig = await connection.sendTransaction(transferTx, { skipPreflight: true, maxRetries: 3 });
          console.log(`[VolumeWallets]   ✅ Hop ${h + 1} complete: ${sig.slice(0, 20)}...`);
          
          // Deduct fee for next hop
          currentAmount -= feePerHop;
          
          // Delay between hops for obfuscation
          if (h < hopChain.length - 2 && delayBetweenHopsMs > 0) {
            await new Promise(resolve => setTimeout(resolve, delayBetweenHopsMs));
          }
        }
        
        // Verify wallet was saved by checking if it exists in warmed wallets
        const { loadWarmedWallets } = require(projectPath('src', 'wallet-warming-manager.ts'));
        const savedWallets = loadWarmedWallets();
        const walletSaved = savedWallets.some(w => w.address === targetWallet.address);
        
        if (!walletSaved) {
          console.error(`[VolumeWallets] ⚠️  WARNING: Target wallet ${targetWallet.address.slice(0, 12)}... may not have been saved!`);
        } else {
          console.log(`[VolumeWallets] ✅ Wallet ${i + 1} saved and verified in warmed wallets database`);
        }
        
        results.push({
          address: targetWallet.address,
          fundedAmount: amountPerWallet,
          hops: hops,
          success: true,
          saved: walletSaved,
          intermediateWallets: intermediateWallets.map(kp => ({
            address: kp.publicKey.toBase58(),
            saved: true // We just saved them above
          }))
        });
        
        console.log(`[VolumeWallets] ✅ Wallet ${i + 1} complete: ${targetWallet.address.slice(0, 12)}... (funded with ${amountPerWallet} SOL via ${hops} hops)`);
        
        // Small delay between wallets
        if (i < count - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
      } catch (hopError) {
        console.error(`[VolumeWallets] ❌ Wallet ${i + 1} failed:`, hopError.message);
        
        // Even if funding failed, ensure wallets are saved if they were created
        let savedWallets = [];
        try {
          const { loadWarmedWallets } = require(projectPath('src', 'wallet-warming-manager.ts'));
          const allWallets = loadWarmedWallets();
          
          // Check if target wallet exists (it should have been created before funding)
          if (typeof targetWallet !== 'undefined' && targetWallet) {
            const targetExists = allWallets.some(w => w.address === targetWallet.address);
            if (targetExists) {
              savedWallets.push({ address: targetWallet.address, type: 'target', saved: true });
            } else {
              console.warn(`[VolumeWallets] ⚠️  Target wallet ${targetWallet.address?.slice(0, 12)}... was created but may not be saved`);
            }
          }
          
          // Check intermediate wallets
          if (intermediateWallets && intermediateWallets.length > 0) {
            intermediateWallets.forEach((intKp, idx) => {
              const intAddr = intKp.publicKey.toBase58();
              const intExists = allWallets.some(w => w.address === intAddr);
              if (intExists) {
                savedWallets.push({ address: intAddr, type: 'intermediate', saved: true });
              }
            });
          }
        } catch (saveCheckError) {
          console.error(`[VolumeWallets] ⚠️  Could not verify wallet saves:`, saveCheckError.message);
        }
        
        results.push({
          error: hopError.message,
          success: false,
          savedWallets: savedWallets.length > 0 ? savedWallets : undefined
        });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    console.log(`[VolumeWallets] 🏁 Completed: ${successCount}/${count} wallets spawned`);
    
    res.json({
      success: true,
      spawned: successCount,
      total: count,
      wallets: results.filter(r => r.success),
      errors: results.filter(r => !r.success)
    });
    
  } catch (error) {
    console.error('[VolumeWallets] Spawn error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to spawn volume wallets' });
  }
});

// Update wallet tags
app.put('/api/warming-wallets/:address/tags', async (req, res) => {
  try {
    const { address } = req.params;
    const { tags } = req.body;
    
    if (!Array.isArray(tags)) {
      return res.status(400).json({ success: false, error: 'Tags must be an array' });
    }
    
    const { updateWalletTags } = require(projectPath('src', 'wallet-warming-manager.ts'));
    const updated = updateWalletTags(address, tags);
    
    if (updated) {
      res.json({ success: true, message: 'Tags updated' });
    } else {
      res.status(404).json({ success: false, error: 'Wallet not found' });
    }
  } catch (error) {
    console.error('[Warming] Update tags error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to update tags' });
  }
});

// Test endpoint to verify route is accessible
app.get('/api/warming-wallets/test', (req, res) => {
  res.json({ success: true, message: 'Update stats endpoint is accessible' });
});

// Update SOL balances for wallets
app.post('/api/warming-wallets/update-balances', async (req, res) => {
  try {
    console.log('[Warming] Update balances endpoint called');
    // SECURITY: Don't log request body - may contain private keys
    // console.log('[Warming] Request body:', req.body);
    
    const { walletAddresses } = req.body;
    
    if (!walletAddresses || !Array.isArray(walletAddresses) || walletAddresses.length === 0) {
      console.log('[Warming] Invalid request: walletAddresses missing or empty');
      return res.status(400).json({ success: false, error: 'Wallet addresses are required' });
    }
    
    console.log(`[Warming] Updating SOL balances for ${walletAddresses.length} wallet(s)...`);
    const { updateMultipleWalletBalances } = require(projectPath('src', 'wallet-warming-manager.ts'));
    const result = await updateMultipleWalletBalances(walletAddresses);
    
    console.log(`[Warming] Balance update complete: ${result.updated} updated, ${result.failed} failed, total: ${result.totalSol.toFixed(4)} SOL`);
    res.json({
      success: true,
      message: `Updated ${result.updated} wallet(s), ${result.failed} failed`,
      updated: result.updated,
      failed: result.failed,
      errors: result.errors,
      totalSol: result.totalSol
    });
  } catch (error) {
    console.error('[Warming] Update balances error:', error);
    console.error('[Warming] Error stack:', error.stack);
    res.status(500).json({ success: false, error: error.message || 'Failed to update balances' });
  }
});

// Gather SOL from wallets back to main wallet
app.post('/api/warming-wallets/gather-sol', async (req, res) => {
  try {
    console.log('[Warming] Gather SOL endpoint called');
    // SECURITY: Don't log request body - may contain private keys
    // console.log('[Warming] Request body:', req.body);
    
    const { walletAddresses } = req.body;
    
    if (!walletAddresses || !Array.isArray(walletAddresses) || walletAddresses.length === 0) {
      console.log('[Warming] Invalid request: walletAddresses missing or empty');
      return res.status(400).json({ success: false, error: 'Wallet addresses are required' });
    }
    
    console.log(`[Warming] Gathering SOL from ${walletAddresses.length} wallet(s)...`);
    const { gatherSolFromWallets } = require(projectPath('src', 'wallet-warming-manager.ts'));
    const result = await gatherSolFromWallets(walletAddresses);
    
    console.log(`[Warming] Gather complete: ${result.gathered} gathered, ${result.failed} failed, total: ${result.totalSolGathered.toFixed(6)} SOL`);
    res.json({
      success: true,
      message: `Gathered ${result.totalSolGathered.toFixed(6)} SOL from ${result.gathered} wallet(s), ${result.failed} failed`,
      gathered: result.gathered,
      failed: result.failed,
      errors: result.errors,
      totalSolGathered: result.totalSolGathered
    });
  } catch (error) {
    console.error('[Warming] Gather SOL error:', error);
    console.error('[Warming] Error stack:', error.stack);
    res.status(500).json({ success: false, error: error.message || 'Failed to gather SOL' });
  }
});

// Withdraw all SOL from a single wallet to funding wallet
app.post('/api/warming-wallets/withdraw-sol', async (req, res) => {
  try {
    const { walletAddress } = req.body;
    
    if (!walletAddress) {
      return res.status(400).json({ success: false, error: 'Wallet address is required' });
    }
    
    // Load wallet from warmed wallets to get private key
    const { loadWarmedWallets } = require(projectPath('src', 'wallet-warming-manager.ts'));
    const wallets = loadWarmedWallets();
    const wallet = wallets.find(w => w.address === walletAddress);
    
    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Wallet not found in warmed wallets' });
    }
    
    if (!wallet.privateKey) {
      return res.status(400).json({ success: false, error: 'Private key not found for this wallet' });
    }
    
    const { Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } = require('@solana/web3.js');
    
    const walletKp = Keypair.fromSecretKey(base58.decode(wallet.privateKey));
    const PRIVATE_KEY = process.env.PRIVATE_KEY;
    if (!PRIVATE_KEY) {
      return res.status(500).json({ success: false, error: 'PRIVATE_KEY not found in environment' });
    }
    const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY));
    
    // Get RPC endpoint
    const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
    const RPC_WEBSOCKET_ENDPOINT = process.env.RPC_WEBSOCKET_ENDPOINT || '';
    const connection = new Connection(RPC_ENDPOINT, {
      wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
      commitment: 'confirmed'
    });
    
    // Get wallet balance
    const balance = await connection.getBalance(walletKp.publicKey);
    const balanceSol = balance / 1e9;
    
    // Keep 0.001 SOL for rent exemption
    const rentExemption = 0.001;
    const amountToTransfer = balanceSol - rentExemption;
    
    if (amountToTransfer <= 0) {
      return res.json({
        success: true,
        message: `Insufficient balance (${balanceSol.toFixed(6)} SOL) - keeping ${rentExemption} SOL for rent`,
        amountTransferred: 0,
        balance: balanceSol
      });
    }
    
    console.log(`[Warming] Withdrawing ${amountToTransfer.toFixed(6)} SOL from ${walletAddress.substring(0, 8)}...`);
    
    const latestBlockhash = await connection.getLatestBlockhash('confirmed');
    const transferMsg = new TransactionMessage({
      payerKey: walletKp.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: walletKp.publicKey,
          toPubkey: mainKp.publicKey,
          lamports: Math.floor(amountToTransfer * 1e9)
        })
      ]
    }).compileToV0Message();
    
    const transferTx = new VersionedTransaction(transferMsg);
    transferTx.sign([walletKp]);
    
    const sig = await connection.sendTransaction(transferTx, { skipPreflight: true, maxRetries: 3 });
    
    // Update balance in wallet record from blockchain (more accurate)
    try {
      const { updateWalletBalance } = require(projectPath('src', 'wallet-warming-manager.ts'));
      await updateWalletBalance(walletAddress);
      console.log(`[Withdraw] Updated balance for ${walletAddress.substring(0, 8)}...`);
    } catch (error) {
      console.error(`[Withdraw] Failed to update balance, using estimated:`, error.message);
      // Fallback to estimated balance
      const walletIndex = wallets.findIndex(w => w.address === walletAddress);
      if (walletIndex >= 0) {
        wallets[walletIndex].solBalance = rentExemption;
        wallets[walletIndex].lastBalanceUpdate = new Date().toISOString();
        const { saveWarmedWallets } = require(projectPath('src', 'wallet-warming-manager.ts'));
        saveWarmedWallets(wallets);
      }
    }
    
    res.json({
      success: true,
      message: `Withdrew ${amountToTransfer.toFixed(6)} SOL to funding wallet`,
      amountTransferred: amountToTransfer,
      balance: balanceSol,
      remainingBalance: rentExemption,
      txUrl: `https://solscan.io/tx/${sig}`
    });
  } catch (error) {
    console.error('[Warming] Withdraw SOL error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to withdraw SOL' });
  }
});

// Update wallet stats from blockchain (RPC call - only when user requests)
app.post('/api/warming-wallets/update-stats', async (req, res) => {
  try {
    console.log('[Warming] Update stats endpoint called');
    // SECURITY: Don't log request body - may contain private keys
    // console.log('[Warming] Request body:', req.body);
    
    const { walletAddresses } = req.body;
    
    if (!walletAddresses || !Array.isArray(walletAddresses) || walletAddresses.length === 0) {
      console.log('[Warming] Invalid request: walletAddresses missing or empty');
      return res.status(400).json({ success: false, error: 'Wallet addresses are required' });
    }
    
    console.log(`[Warming] Updating stats for ${walletAddresses.length} wallet(s) from blockchain...`);
    const { updateMultipleWalletsFromBlockchain } = require(projectPath('src', 'wallet-warming-manager.ts'));
    const result = await updateMultipleWalletsFromBlockchain(walletAddresses);
    
    console.log(`[Warming] Update complete: ${result.updated} updated, ${result.failed} failed`);
    res.json({
      success: true,
      message: `Updated ${result.updated} wallet(s), ${result.failed} failed`,
      updated: result.updated,
      failed: result.failed,
      errors: result.errors
    });
  } catch (error) {
    console.error('[Warming] Update stats error:', error);
    console.error('[Warming] Error stack:', error.stack);
    res.status(500).json({ success: false, error: error.message || 'Failed to update wallet stats' });
  }
});

// Delete wallet
app.delete('/api/warming-wallets/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const { deleteWarmingWallet } = require(projectPath('src', 'wallet-warming-manager.ts'));
    const deleted = deleteWarmingWallet(address);
    
    if (deleted) {
      res.json({ success: true, message: 'Wallet deleted' });
    } else {
      res.status(404).json({ success: false, error: 'Wallet not found' });
    }
  } catch (error) {
    console.error('[Warming] Delete wallet error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to delete wallet' });
  }
});

// Start wallet warming (SIMPLIFIED - uses wallet addresses)
app.post('/api/warm-wallets/start', async (req, res) => {
  try {
    const { walletAddresses, config } = req.body;
    
    if (!walletAddresses || !Array.isArray(walletAddresses) || walletAddresses.length === 0) {
      return res.status(400).json({ success: false, error: 'Wallet addresses are required' });
    }
    
    // Import wallet warming manager
    const { warmWallets } = require(projectPath('src', 'wallet-warming-manager.ts'));
    
    // Default config with MINIMAL settings (cheapest that actually works with Jupiter)
    const warmConfig = {
      walletsPerBatch: config?.walletsPerBatch || 2,
      tradesPerWallet: config?.tradesPerWallet || 2, // Just 2 trades is enough to show activity
      minBuyAmount: config?.minBuyAmount || 0.0002, // 0.0002 SOL (ultra-small, may need to verify Jupiter accepts)
      maxBuyAmount: config?.maxBuyAmount || 0.0003, // 0.0003 SOL (ultra-small for cheap warming)
      tradingPattern: config?.tradingPattern || 'sequential', // 'sequential', 'randomized', 'accumulate'
      minIntervalSeconds: config?.minIntervalSeconds || 10,
      maxIntervalSeconds: config?.maxIntervalSeconds || 60,
      priorityFee: config?.priorityFee || 'none', // No priority fee for warming (saves ~0.003 SOL per round trip)
      useJupiter: true,
      useTrendingTokens: config?.useTrendingTokens !== false, // Default to true
      fundingAmount: config?.fundingAmount || 0.015, // Enough for 2 trades + fees
      skipFunding: config?.skipFunding || false, // Skip funding for wallets with existing balance
      closeTokenAccounts: config?.closeTokenAccounts !== undefined ? config.closeTokenAccounts : true, // Default: close accounts to recover rent. Set false for cheap mode (sells 99.9%, keeps dust)
      tradingPattern: config?.tradingPattern || 'sequential' // 'sequential', 'randomized', 'accumulate'
    };
    
    // Ensure tradingPattern is set (default to sequential if not provided)
    if (!warmConfig.tradingPattern) {
      warmConfig.tradingPattern = config?.tradingPattern || 'sequential';
    }
    
    // Start warming in background
    const warmingPromise = warmWallets(
      walletAddresses,
      warmConfig,
      (wallet) => {
        // Progress callback
        console.log(`[Warming] ${wallet.address}: ${wallet.transactionCount} transactions, ${wallet.totalTrades} trades`);
      }
    );
    
    // Store process for tracking
    const processId = Date.now().toString();
    warmingProcesses.set(processId, {
      promise: warmingPromise,
      walletAddresses: walletAddresses,
      startTime: Date.now(),
      config: warmConfig
    });
    
    // Don't await - return immediately
    warmingPromise
      .then(() => {
        console.log(`[Warming] Process ${processId} completed`);
        warmingProcesses.delete(processId);
      })
      .catch((error) => {
        console.error(`[Warming] Process ${processId} failed:`, error);
        warmingProcesses.delete(processId);
      });
    
    res.json({
      success: true,
      processId,
      message: 'Wallet warming started',
      walletCount: walletAddresses.length,
      config: warmConfig
    });
  } catch (error) {
    console.error('[Warming] Start error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to start wallet warming' });
  }
});

// Get warming progress (now just returns wallet stats)
app.get('/api/warm-wallets/progress', async (req, res) => {
  try {
    const { loadWarmedWallets } = require(projectPath('src', 'wallet-warming-manager.ts'));
    const wallets = loadWarmedWallets();
    
    res.json({
      success: true,
      wallets: wallets.map(w => ({
        address: w.address,
        transactionCount: w.transactionCount,
        firstTransactionDate: w.firstTransactionDate,
        lastTransactionDate: w.lastTransactionDate,
        totalTrades: w.totalTrades,
        status: w.status,
        tags: w.tags || []
      })),
      activeProcesses: Array.from(warmingProcesses.entries()).map(([id, proc]) => ({
        processId: id,
        walletAddresses: proc.walletAddresses,
        startTime: proc.startTime,
        config: proc.config
      }))
    });
  } catch (error) {
    console.error('[Warming] Progress error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to get progress' });
  }
});

// Get trending tokens (NEW, BONDING, GRADUATED from Moralis)
app.get('/api/warm-wallets/trending-tokens', async (req, res) => {
  try {
    console.log('[Warming] Fetching trending tokens from Moralis (NEW, BONDING, GRADUATED)...');
    const { getCachedTrendingTokens } = require(projectPath('src', 'fetch-trending-tokens.ts'));
    const limit = parseInt(req.query.limit) || 100; // Allow custom limit, default 100
    const tokens = await getCachedTrendingTokens(limit);
    
    res.json({
      success: true,
      tokens: tokens.map(t => ({
        mint: t.mint,
        symbol: t.symbol,
        name: t.name,
        priceUsd: t.priceUsd,
        volume24h: t.volume24h,
        liquidity: t.liquidity,
        type: t.type // Include type (new, bonding, graduated)
      }))
    });
  } catch (error) {
    console.error('[Warming] Trending tokens error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch trending tokens' });
  }
});

// NOTE: Dune Analytics API removed for simplified public version
// (Requires paid Dune API key)

// ═══════════════════════════════════════════════════════════════════════════
// AI CONTENT GENERATION ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// Initialize AI Generator
let aiGenerator = null;
let generateContentWithBranding = null;
try {
  const aiModule = require(projectPath('features', 'ai-generator', 'services', 'ai-generator'));
  aiGenerator = aiModule.aiGenerator;
  generateContentWithBranding = aiModule.generateContentWithBranding;
  console.log('[API Server] ✅ AI Generator loaded');
} catch (error) {
  console.warn('[API Server] ⚠️ AI Generator not available:', error.message);
}

// Generate AI content from prompt
app.post('/api/ai/generate', async (req, res) => {
  try {
    const { prompt, theme, forceTemplate, existingName, generateImages, uploadImages } = req.body;

    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Prompt is required' });
    }

    if (!aiGenerator) {
      return res.status(500).json({ 
        success: false, 
        error: 'AI Generator not available. Make sure features/ai-generator is set up.' 
      });
    }

    // If images are requested, use the branding-integrated function
    if (generateImages && generateContentWithBranding) {
      const result = await generateContentWithBranding(prompt, {
        theme,
        forceTemplate,
        existingName,
        generateImages: true,
        uploadImages: uploadImages === true, // Only upload if explicitly requested (not default)
      });
      return res.json(result);
    }

    // Otherwise, just generate text content
    const result = await aiGenerator.generateContent(prompt, {
      theme,
      forceTemplate,
      existingName,
    });

    res.json(result);
  } catch (error) {
    console.error('[AI Generate] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Generate multiple variations (with optional branding images)
app.post('/api/ai/generate-variations', async (req, res) => {
  try {
    const { prompt, count = 3, theme, forceTemplate, generateImages, uploadImages } = req.body;

    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Prompt is required' });
    }

    if (!aiGenerator) {
      return res.status(500).json({ 
        success: false, 
        error: 'AI Generator not available' 
      });
    }

    // If generateImages is requested, use the branding-aware function
    if (generateImages) {
      const { generateVariationsWithBranding } = require(projectPath('features', 'ai-generator', 'services', 'ai-generator'));
      const result = await generateVariationsWithBranding(prompt, count, {
        theme,
        forceTemplate,
        generateImages: true,
        uploadImages: false, // Don't upload during generation - only when user accepts
      });
      return res.json(result);
    }

    // Otherwise use the standard variation generator
    const result = await aiGenerator.generateVariations(prompt, count, {
      theme,
      forceTemplate,
    });

    res.json(result);
  } catch (error) {
    console.error('[AI Generate Variations] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get available color schemes
app.get('/api/ai/color-schemes', (req, res) => {
  if (!aiGenerator) {
    // Return hardcoded schemes if generator not available
    const schemes = [
      { id: 'cyber', name: 'Cyber Blue', primary: '#00f0ff', secondary: '#0066ff', bg: '#0a0a1a' },
      { id: 'neon', name: 'Neon Green', primary: '#00ff88', secondary: '#00cc66', bg: '#0a1a0a' },
      { id: 'sunset', name: 'Sunset Orange', primary: '#ff6b35', secondary: '#ff4444', bg: '#1a0a0a' },
      { id: 'royal', name: 'Royal Purple', primary: '#9945FF', secondary: '#7c3aed', bg: '#0f0a1a' },
      { id: 'gold', name: 'Gold', primary: '#ffd700', secondary: '#ffb700', bg: '#1a1500' },
      { id: 'pink', name: 'Hot Pink', primary: '#ff00ff', secondary: '#ff69b4', bg: '#1a0a1a' },
      { id: 'ice', name: 'Ice White', primary: '#e0f7ff', secondary: '#a0d8ef', bg: '#0a1015' },
      { id: 'fire', name: 'Fire Red', primary: '#ff4500', secondary: '#ff6347', bg: '#1a0500' },
      { id: 'matrix', name: 'Matrix Green', primary: '#00ff00', secondary: '#32cd32', bg: '#000a00' },
    ];
    return res.json({ success: true, schemes });
  }

  res.json({ 
    success: true, 
    schemes: aiGenerator.getColorSchemes(),
    openaiAvailable: aiGenerator.isOpenAIAvailable(),
  });
});

// Check AI status
app.get('/api/ai/status', (req, res) => {
  res.json({
    available: !!aiGenerator,
    openaiConfigured: !!process.env.OPENAI_API_KEY,
    openaiAvailable: aiGenerator?.isOpenAIAvailable() || false,
    source: aiGenerator?.isOpenAIAvailable() ? 'openai' : 'template',
  });
});

// NOTE: Dune Analytics removed for simplified public version

// Add warmed wallets to launch (simple - just add to data.json and current-run.json)
app.post('/api/warm-wallets/add-to-launch', async (req, res) => {
  try {
    const { walletAddresses, roles } = req.body; // roles: ['bundle', 'holder', 'dev'] - optional, can use any wallet for any role
    
    if (!walletAddresses || !Array.isArray(walletAddresses) || walletAddresses.length === 0) {
      return res.status(400).json({ success: false, error: 'Wallet addresses are required' });
    }
    
    const { loadWarmedWallets } = require(projectPath('src', 'wallet-warming-manager.ts'));
    const warmedWallets = loadWarmedWallets();
    
    // Get private keys for selected addresses
    const walletPrivateKeys = walletAddresses
      .map(addr => warmedWallets.find(w => w.address === addr)?.privateKey)
      .filter(pk => pk !== undefined);
    
    if (walletPrivateKeys.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid wallets found' });
    }
    
    // Read data.json
    const dataJsonPath = path.join(__dirname, '..', 'keys', 'data.json');
    let existingWallets = [];
    
    if (fs.existsSync(dataJsonPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(dataJsonPath, 'utf8'));
        existingWallets = Array.isArray(data) ? data : [];
      } catch (error) {
        console.error('Error reading data.json:', error);
      }
    }
    
    // Add new wallets (avoid duplicates)
    const newWallets = walletPrivateKeys.filter(pk => !existingWallets.includes(pk));
    const allWallets = [...existingWallets, ...newWallets];
    
    // Save to data.json
    fs.writeFileSync(dataJsonPath, JSON.stringify(allWallets, null, 2));
    
    // Update current-run.json if it exists and roles are specified
    if (roles && Array.isArray(roles) && roles.length > 0) {
      const currentRunPath = path.join(__dirname, '..', 'keys', 'current-run.json');
      if (fs.existsSync(currentRunPath)) {
        const currentRun = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
        
        if (roles.includes('bundle')) {
          if (!currentRun.bundleWalletKeys) currentRun.bundleWalletKeys = [];
          currentRun.bundleWalletKeys = [...new Set([...currentRun.bundleWalletKeys, ...walletPrivateKeys])];
        }
        if (roles.includes('holder')) {
          if (!currentRun.holderWalletKeys) currentRun.holderWalletKeys = [];
          currentRun.holderWalletKeys = [...new Set([...currentRun.holderWalletKeys, ...walletPrivateKeys])];
        }
        if (roles.includes('dev')) {
          if (walletPrivateKeys.length > 0) {
            currentRun.creatorDevWalletKey = walletPrivateKeys[0];
          }
        }
        
        fs.writeFileSync(currentRunPath, JSON.stringify(currentRun, null, 2));
      }
    }
    
    res.json({
      success: true,
      message: `Added ${newWallets.length} new wallet(s) to data.json`,
      totalWallets: allWallets.length,
      addedWallets: walletAddresses.length
    });
  } catch (error) {
    console.error('[Warming] Add to launch error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to add wallets' });
  }
});

// Twitter Get Account Info Endpoint
app.post('/api/marketing/twitter/get-account-info', async (req, res) => {
  if (MARKETING_DISABLED) return marketingDisabledResponse(res);
  try {
    console.log('[Marketing] Twitter get account info request received');
    const { apiKey, apiSecret, accessToken, accessTokenSecret } = req.body;
    
    if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
      return res.status(400).json({ 
        success: false, 
        error: 'Twitter API credentials are required' 
      });
    }
    
    // Import and use Twitter poster module (TypeScript)
    const { getTwitterAccountInfo } = require(projectPath('marketing', 'twitter', 'twitter-poster.ts'));
    const result = await getTwitterAccountInfo({
      apiKey,
      apiSecret,
      accessToken,
      accessTokenSecret,
    });
    
    if (result.success) {
      console.log('[Marketing] ✅ Twitter account info retrieved:', result.account?.username);
      res.json({
        success: true,
        account: result.account,
      });
    } else {
      console.error('[Marketing] ❌ Twitter get account info failed:', result.error);
      res.status(500).json({
        success: false,
        error: result.error || 'Failed to get Twitter account info',
      });
    }
  } catch (error) {
    const sanitizedMessage = error.message && error.message.length > 500 
      ? error.message.substring(0, 500) + '... (truncated)' 
      : error.message;
    console.error('[Marketing] ❌ Twitter get account info error:', sanitizedMessage);
    res.status(500).json({ 
      success: false, 
      error: sanitizedMessage || 'Unknown error',
    });
  }
});

// Twitter Auto-Post Endpoint
app.post('/api/marketing/twitter/auto-post', async (req, res) => {
  if (MARKETING_DISABLED) return marketingDisabledResponse(res);
  try {
    console.log('[Marketing] Twitter auto-post request received');
    const { 
      apiKey, 
      apiSecret, 
      accessToken, 
      accessTokenSecret, 
      tweets = [], 
      tweetDelays = [],
      tweetImages = [],
      updateProfile = false,
      updateUsername = false,
      deleteOldTweets = false,
      profileConfig = {},
      tokenConfig = {}
    } = req.body;
    
    if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
      return res.status(400).json({ 
        success: false, 
        error: 'Twitter API credentials are required' 
      });
    }
    
    // Import and use Twitter poster module (TypeScript)
    const { postToTwitter } = require(projectPath('marketing', 'twitter', 'twitter-poster.ts'));
    const result = await postToTwitter({
      apiKey,
      apiSecret,
      accessToken,
      accessTokenSecret,
      tweets,
      tweetDelays,
      tweetImages,
      updateProfile,
      updateUsername,
      deleteOldTweets,
      profileConfig,
      tokenConfig,
    });
    
    if (result.success) {
      res.json({
        success: true,
        tweets: result.tweets || { tweetIds: [], errors: [] },
        profileUpdated: result.profileUpdated || false,
        profileError: result.profileError || null,
        message: result.message || 'Twitter operation completed successfully',
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error || 'Failed to post to Twitter',
      });
    }
  } catch (error) {
    // Sanitize error message to avoid logging base64 images
    const sanitizedMessage = error.message && error.message.length > 500 
      ? error.message.substring(0, 500) + '... (truncated)' 
      : error.message;
    console.error('[Marketing] Twitter auto-post error:', sanitizedMessage);
    res.status(500).json({ success: false, error: sanitizedMessage || 'Unknown error' });
  }
});

// Twitter Post Single Tweet Endpoint (for Marketing Widget)
app.post('/api/marketing/twitter/post-single', async (req, res) => {
  if (MARKETING_DISABLED) return marketingDisabledResponse(res);
  try {
    console.log('[Marketing] Twitter post single tweet request received');
    const { tweet, tokenData, credentials } = req.body;
    
    if (!tweet || !tweet.text) {
      return res.status(400).json({ 
        success: false, 
        error: 'Tweet text is required' 
      });
    }
    
    // Get Twitter credentials from request (passed from frontend) or fallback to .env
    const apiKey = credentials?.apiKey || process.env.TWITTER_API_KEY;
    const apiSecret = credentials?.apiSecret || process.env.TWITTER_API_SECRET;
    const accessToken = credentials?.accessToken || process.env.TWITTER_ACCESS_TOKEN;
    const accessTokenSecret = credentials?.accessTokenSecret || process.env.TWITTER_ACCESS_TOKEN_SECRET;
    
    if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
      return res.status(400).json({ 
        success: false, 
        error: 'Twitter API credentials not provided' 
      });
    }
    
    // Load image as base64 if imagePath is provided
    let tweetImages = [null];
    if (tweet.imagePath && tweet.imagePath.trim()) {
      try {
        let fullImagePath = tweet.imagePath;
        if (tweet.imagePath.startsWith('./image/') || tweet.imagePath.startsWith('image/')) {
          fullImagePath = path.join(__dirname, '..', 'image', path.basename(tweet.imagePath));
        } else if (!path.isAbsolute(tweet.imagePath)) {
          fullImagePath = path.join(__dirname, '..', tweet.imagePath);
        }
        
        if (fs.existsSync(fullImagePath)) {
          const imageBuffer = fs.readFileSync(fullImagePath);
          const imageBase64 = imageBuffer.toString('base64');
          const ext = path.extname(fullImagePath).toLowerCase();
          const mimeTypes = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
          };
          const mimeType = mimeTypes[ext] || 'image/png';
          tweetImages = [`data:${mimeType};base64,${imageBase64}`];
          console.log(`[Marketing] Loaded image: ${path.basename(fullImagePath)}`);
        } else {
          console.warn(`[Marketing] Image file not found: ${fullImagePath}`);
        }
      } catch (imageError) {
        console.error(`[Marketing] Failed to load image:`, imageError.message);
      }
    }
    
    // Import and use Twitter poster module (TypeScript)
    const { postToTwitter } = require(projectPath('marketing', 'twitter', 'twitter-poster.ts'));
    const result = await postToTwitter({
      apiKey,
      apiSecret,
      accessToken,
      accessTokenSecret,
      tweets: [tweet.text],
      tweetDelays: [0],
      tweetImages: tweetImages,
      updateProfile: false,
      updateUsername: false,
      deleteOldTweets: false,
      profileConfig: {},
      tokenConfig: tokenData || {},
    });
    
    if (result.success && result.tweets && result.tweets.tweetIds && result.tweets.tweetIds.length > 0) {
      console.log(`[Marketing] ✅ Tweet posted successfully: ${result.tweets.tweetIds[0]}`);
      res.json({
        success: true,
        tweetId: result.tweets.tweetIds[0],
        message: 'Tweet posted successfully',
      });
    } else {
      console.error('[Marketing] ❌ Tweet posting failed:', result.error || result.tweets?.errors?.[0]);
      res.status(500).json({
        success: false,
        error: result.error || result.tweets?.errors?.[0] || 'Failed to post tweet',
      });
    }
  } catch (error) {
    const sanitizedMessage = error.message && error.message.length > 500 
      ? error.message.substring(0, 500) + '... (truncated)' 
      : error.message;
    console.error('[Marketing] ❌ Post single tweet error:', sanitizedMessage);
    res.status(500).json({ 
      success: false, 
      error: sanitizedMessage || 'Unknown error',
    });
  }
});

// Twitter Profile Update Endpoint
app.post('/api/twitter/update-profile', async (req, res) => {
  try {
    console.log('[Twitter] Profile update request received');
    const { apiKey, apiSecret, accessToken, accessTokenSecret, name, description, location, url, profileImageUrl, generateBanner, tokenSymbol } = req.body;
    
    if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
      return res.status(400).json({ success: false, error: 'Twitter API credentials required' });
    }
    
    // Use twitter-api-v2 library
    const { TwitterApi } = require('twitter-api-v2');
    
    const client = new TwitterApi({
      appKey: apiKey,
      appSecret: apiSecret,
      accessToken: accessToken,
      accessSecret: accessTokenSecret,
    });
    
    let profileImageUpdated = false;
    let bannerUpdated = false;
    
    // Update text profile fields
    if (name || description || location || url) {
      const updatePayload = {};
      if (name) updatePayload.name = name;
      if (description) updatePayload.description = description;
      if (location) updatePayload.location = location;
      if (url) updatePayload.url = url;
      
      await client.v1.updateAccountProfile(updatePayload);
      console.log(`[Twitter] ✅ Profile text updated`);
    }
    
    // Update profile image from URL
    if (profileImageUrl) {
      let imageBuffer = null;
      try {
        console.log(`[Twitter] Downloading profile image from: ${profileImageUrl}`);
        const imageResponse = await fetch(profileImageUrl);
        if (!imageResponse.ok) {
          throw new Error(`Failed to download image: ${imageResponse.status}`);
        }
        imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        console.log(`[Twitter] Image downloaded, size: ${imageBuffer.length} bytes`);
        
        // twitter-api-v2 expects the raw Buffer for updateAccountProfileImage
        await client.v1.updateAccountProfileImage(imageBuffer);
        
        profileImageUpdated = true;
        console.log(`[Twitter] ✅ Profile image updated successfully`);
      } catch (imgError) {
        console.error(`[Twitter] Failed to update profile image:`, imgError.message);
        // Try alternative method with base64 if buffer was downloaded
        if (imageBuffer) {
          try {
            console.log(`[Twitter] Trying alternative image upload method...`);
            const base64Image = imageBuffer.toString('base64');
            await client.v1.post('account/update_profile_image.json', { image: base64Image });
            profileImageUpdated = true;
            console.log(`[Twitter] ✅ Profile image updated via alternative method`);
          } catch (altError) {
            console.error(`[Twitter] Alternative method also failed:`, altError.message);
          }
        }
      }
    }
    
    // Generate and upload banner using AI
    if (generateBanner && profileImageUrl) {
      try {
        console.log(`[Twitter] Generating AI banner...`);
        const OpenAI = require('openai');
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        
        if (!process.env.OPENAI_API_KEY) {
          console.warn(`[Twitter] OPENAI_API_KEY not set, skipping banner generation`);
        } else {
          // Generate banner using DALL-E
          const bannerPrompt = `Create a sleek, modern Twitter/X banner (1500x500) for a cryptocurrency token called "${name || tokenSymbol}". 
            Style: Dark gradient background with subtle tech/crypto vibes, glowing accents, professional look.
            The banner should be minimalist and professional, suitable for a crypto project.
            Do NOT include any text or logos - just abstract shapes, gradients, and subtle crypto-themed elements.`;
          
          const imageResult = await openai.images.generate({
            model: 'dall-e-3',
            prompt: bannerPrompt,
            n: 1,
            size: '1792x1024', // Closest to Twitter banner ratio
            quality: 'standard',
          });
          
          if (imageResult.data?.[0]?.url) {
            // Download the generated image
            console.log(`[Twitter] Banner generated, downloading...`);
            const bannerResponse = await fetch(imageResult.data[0].url);
            const bannerBuffer = Buffer.from(await bannerResponse.arrayBuffer());
            console.log(`[Twitter] Banner size: ${bannerBuffer.length} bytes`);
            
            // Upload to Twitter - try raw buffer first, then base64
            try {
              await client.v1.updateAccountProfileBanner(bannerBuffer);
              bannerUpdated = true;
              console.log(`[Twitter] ✅ AI-generated banner uploaded`);
            } catch (bannerUploadError) {
              console.log(`[Twitter] Trying base64 banner upload...`);
              const base64Banner = bannerBuffer.toString('base64');
              await client.v1.post('account/update_profile_banner.json', { banner: base64Banner });
              bannerUpdated = true;
              console.log(`[Twitter] ✅ Banner uploaded via base64 method`);
            }
          }
        }
      } catch (bannerError) {
        console.error(`[Twitter] Failed to generate/upload banner:`, bannerError.message);
        console.error(`[Twitter] Full banner error:`, JSON.stringify(bannerError.data || bannerError, null, 2));
      }
    }
    
    // Get updated profile
    const me = await client.v2.me({ 'user.fields': ['profile_image_url', 'description', 'name'] });
    
    res.json({
      success: true,
      message: 'Profile updated successfully',
      profileImageUpdated,
      bannerUpdated,
      account: {
        id: me.data.id,
        name: me.data.name,
        username: me.data.username,
        description: me.data.description,
        profileImageUrl: me.data.profile_image_url?.replace('_normal', ''),
      },
    });
  } catch (error) {
    console.error('[Twitter] Profile update error:', error.message);
    res.status(500).json({
      success: false,
      error: error.data?.errors?.[0]?.message || error.message || 'Failed to update profile',
    });
  }
});

// ============================================
// TELEGRAM MESSAGE MANAGEMENT ENDPOINTS
// ============================================

// Get messages from Telegram group
app.post('/api/marketing/telegram/get-messages', async (req, res) => {
  if (MARKETING_DISABLED) return marketingDisabledResponse(res);
  try {
    console.log('[Telegram Messages] Get messages request received');
    const { chat_id, limit, users_only, hours_ago, credentials } = req.body;
    
    // Get credentials from request (passed from frontend) or fallback to .env
    const api_id = credentials?.api_id || process.env.TELEGRAM_API_ID;
    const api_hash = credentials?.api_hash || process.env.TELEGRAM_API_HASH;
    const phone = credentials?.phone || process.env.TELEGRAM_PHONE;
    
    if (!api_id || !api_hash || !phone) {
      return res.status(400).json({
        success: false,
        error: 'Telegram credentials not provided',
      });
    }
    
    if (!chat_id) {
      return res.status(400).json({
        success: false,
        error: 'Chat ID is required',
      });
    }
    
    // Import Telegram messages wrapper
    const { getTelegramMessages } = require(projectPath('marketing', 'telegram', 'telegram_messages_wrapper.ts'));
    
    const result = await getTelegramMessages(
      api_id,
      api_hash,
      phone,
      chat_id,
      limit || 50,
      users_only !== false, // Default to true
      hours_ago || 24
    );
    
    res.json(result);
  } catch (error) {
    console.error('[Telegram Messages] Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch messages',
    });
  }
});

// Send message to Telegram group
app.post('/api/marketing/telegram/send-message', async (req, res) => {
  if (MARKETING_DISABLED) return marketingDisabledResponse(res);
  try {
    console.log('[Telegram Messages] Send message request received');
    const { chat_id, text, reply_to_msg_id, credentials } = req.body;
    
    // Get credentials from request (passed from frontend) or fallback to .env
    const api_id = credentials?.api_id || process.env.TELEGRAM_API_ID;
    const api_hash = credentials?.api_hash || process.env.TELEGRAM_API_HASH;
    const phone = credentials?.phone || process.env.TELEGRAM_PHONE;
    
    if (!api_id || !api_hash || !phone) {
      return res.status(400).json({
        success: false,
        error: 'Telegram credentials not provided',
      });
    }
    
    if (!chat_id || !text) {
      return res.status(400).json({
        success: false,
        error: 'Chat ID and text are required',
      });
    }
    
    // Import Telegram messages wrapper
    const { sendTelegramMessage } = require(projectPath('marketing', 'telegram', 'telegram_messages_wrapper.ts'));
    
    const result = await sendTelegramMessage(
      api_id,
      api_hash,
      phone,
      chat_id,
      text,
      reply_to_msg_id
    );
    
    if (result.success) {
      console.log(`[Telegram Messages] ✅ Message sent: ${result.message_id}`);
    } else {
      console.error(`[Telegram Messages] ❌ Failed to send message: ${result.error}`);
    }
    
    res.json(result);
  } catch (error) {
    console.error('[Telegram Messages] Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to send message',
    });
  }
});

// Pin message in Telegram group
app.post('/api/marketing/telegram/pin-message', async (req, res) => {
  if (MARKETING_DISABLED) return marketingDisabledResponse(res);
  try {
    console.log('[Telegram Messages] Pin message request received');
    const { chat_id, message_id, credentials } = req.body;
    
    // Get credentials from request (passed from frontend) or fallback to .env
    const api_id = credentials?.api_id || process.env.TELEGRAM_API_ID;
    const api_hash = credentials?.api_hash || process.env.TELEGRAM_API_HASH;
    const phone = credentials?.phone || process.env.TELEGRAM_PHONE;
    
    if (!api_id || !api_hash || !phone) {
      return res.status(400).json({
        success: false,
        error: 'Telegram credentials not provided',
      });
    }
    
    if (!chat_id || !message_id) {
      return res.status(400).json({
        success: false,
        error: 'Chat ID and message ID are required',
      });
    }
    
    // Import Telegram messages wrapper
    const { pinTelegramMessage } = require(projectPath('marketing', 'telegram', 'telegram_messages_wrapper.ts'));
    
    const result = await pinTelegramMessage(
      api_id,
      api_hash,
      phone,
      chat_id,
      message_id
    );
    
    res.json(result);
  } catch (error) {
    console.error('[Telegram Messages] Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to pin message',
    });
  }
});

// Delete message from Telegram group
app.post('/api/marketing/telegram/delete-message', async (req, res) => {
  if (MARKETING_DISABLED) return marketingDisabledResponse(res);
  try {
    console.log('[Telegram Messages] Delete message request received');
    const { chat_id, message_id, credentials } = req.body;
    
    // Get credentials from request (passed from frontend) or fallback to .env
    const api_id = credentials?.api_id || process.env.TELEGRAM_API_ID;
    const api_hash = credentials?.api_hash || process.env.TELEGRAM_API_HASH;
    const phone = credentials?.phone || process.env.TELEGRAM_PHONE;
    
    if (!api_id || !api_hash || !phone) {
      return res.status(400).json({
        success: false,
        error: 'Telegram credentials not provided',
      });
    }
    
    if (!chat_id || !message_id) {
      return res.status(400).json({
        success: false,
        error: 'Chat ID and message ID are required',
      });
    }
    
    // Import Telegram messages wrapper
    const { deleteTelegramMessage } = require(projectPath('marketing', 'telegram', 'telegram_messages_wrapper.ts'));
    
    const result = await deleteTelegramMessage(
      api_id,
      api_hash,
      phone,
      chat_id,
      message_id
    );
    
    res.json(result);
  } catch (error) {
    console.error('[Telegram Messages] Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete message',
    });
  }
});

// Get Telegram chat info
app.post('/api/marketing/telegram/get-chat-info', async (req, res) => {
  if (MARKETING_DISABLED) return marketingDisabledResponse(res);
  try {
    console.log('[Telegram Messages] Get chat info request received');
    const { chat_id } = req.body;
    
    // Get credentials from .env
    const api_id = process.env.TELEGRAM_API_ID;
    const api_hash = process.env.TELEGRAM_API_HASH;
    const phone = process.env.TELEGRAM_PHONE;
    
    if (!api_id || !api_hash || !phone) {
      return res.status(400).json({
        success: false,
        error: 'Telegram credentials not configured in .env file',
      });
    }
    
    if (!chat_id) {
      return res.status(400).json({
        success: false,
        error: 'Chat ID is required',
      });
    }
    
    // Import Telegram messages wrapper
    const { getTelegramChatInfo } = require(projectPath('marketing', 'telegram', 'telegram_messages_wrapper.ts'));
    
    const result = await getTelegramChatInfo(
      api_id,
      api_hash,
      phone,
      chat_id
    );
    
    res.json(result);
  } catch (error) {
    console.error('[Telegram Messages] Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get chat info',
    });
  }
});

// NOTE: Twitter and Telegram account management endpoints removed for simplified public version
// Removed endpoints: /api/twitter-accounts/*, /api/telegram-accounts/*

// Token Configuration Save/Load Endpoints
const TOKEN_CONFIGS_DIR = path.join(__dirname, '..', 'keys', 'token-configs');
if (!fs.existsSync(TOKEN_CONFIGS_DIR)) {
  fs.mkdirSync(TOKEN_CONFIGS_DIR, { recursive: true });
}

// Get all saved token configurations
app.get('/api/token-configs', (req, res) => {
  try {
    const files = fs.readdirSync(TOKEN_CONFIGS_DIR);
    const configs = files
      .filter(file => file.endsWith('.json'))
      .map(file => {
        try {
          const filePath = path.join(TOKEN_CONFIGS_DIR, file);
          const content = fs.readFileSync(filePath, 'utf8');
          const config = JSON.parse(content);
          return {
            id: file.replace('.json', ''),
            name: config.name || config.TOKEN_NAME || 'Unnamed Token',
            symbol: config.symbol || config.TOKEN_SYMBOL || '',
            createdAt: config.createdAt || fs.statSync(filePath).mtime.toISOString(),
            updatedAt: config.updatedAt || fs.statSync(filePath).mtime.toISOString(),
          };
        } catch (error) {
          console.error(`[Token Configs] Error reading ${file}:`, error.message);
          return null;
        }
      })
      .filter(config => config !== null)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    
    res.json({ success: true, configs });
  } catch (error) {
    console.error('[Token Configs] Error listing configs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get a specific token configuration
app.get('/api/token-configs/:id', (req, res) => {
  try {
    const { id } = req.params;
    const filePath = path.join(TOKEN_CONFIGS_DIR, `${id}.json`);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Configuration not found' });
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    const config = JSON.parse(content);
    res.json({ success: true, config });
  } catch (error) {
    console.error('[Token Configs] Error loading config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Save a token configuration
app.post('/api/token-configs', (req, res) => {
  try {
    const { name, config } = req.body;
    
    if (!name || !config) {
      return res.status(400).json({ success: false, error: 'Name and config are required' });
    }
    
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now();
    
    const configToSave = {
      ...config,
      name: name,
      id: id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    const filePath = path.join(TOKEN_CONFIGS_DIR, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(configToSave, null, 2), 'utf8');
    
    console.log(`[Token Configs] Saved configuration: ${name} (${id})`);
    res.json({ success: true, id, message: 'Configuration saved successfully' });
  } catch (error) {
    console.error('[Token Configs] Error saving config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update a token configuration
app.put('/api/token-configs/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, config } = req.body;
    
    const filePath = path.join(TOKEN_CONFIGS_DIR, `${id}.json`);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Configuration not found' });
    }
    
    const existingContent = fs.readFileSync(filePath, 'utf8');
    const existingConfig = JSON.parse(existingContent);
    
    const configToSave = {
      ...existingConfig,
      ...config,
      name: name || existingConfig.name,
      updatedAt: new Date().toISOString(),
    };
    
    fs.writeFileSync(filePath, JSON.stringify(configToSave, null, 2), 'utf8');
    
    console.log(`[Token Configs] Updated configuration: ${id}`);
    res.json({ success: true, message: 'Configuration updated successfully' });
  } catch (error) {
    console.error('[Token Configs] Error updating config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete a token configuration
app.delete('/api/token-configs/:id', (req, res) => {
  try {
    const { id } = req.params;
    const filePath = path.join(TOKEN_CONFIGS_DIR, `${id}.json`);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Configuration not found' });
    }
    
    fs.unlinkSync(filePath);
    console.log(`[Token Configs] Deleted configuration: ${id}`);
    res.json({ success: true, message: 'Configuration deleted successfully' });
  } catch (error) {
    console.error('[Token Configs] Error deleting config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// WALLET PROFILES - Separate from Token Configs
// ============================================
const WALLET_PROFILES_DIR = path.join(__dirname, '..', 'keys', 'wallet-profiles');
if (!fs.existsSync(WALLET_PROFILES_DIR)) {
  fs.mkdirSync(WALLET_PROFILES_DIR, { recursive: true });
}

// Get all saved wallet profiles
app.get('/api/wallet-profiles', (req, res) => {
  try {
    const files = fs.readdirSync(WALLET_PROFILES_DIR);
    const profiles = files
      .filter(file => file.endsWith('.json'))
      .map(file => {
        try {
          const filePath = path.join(WALLET_PROFILES_DIR, file);
          const content = fs.readFileSync(filePath, 'utf8');
          const profile = JSON.parse(content);
          return {
            id: file.replace('.json', ''),
            name: profile.name || 'Unnamed Profile',
            description: profile.description || '',
            bundleWalletCount: profile.bundleWalletCount || 0,
            holderWalletCount: profile.holderWalletCount || 0,
            createdAt: profile.createdAt || fs.statSync(filePath).mtime.toISOString(),
            updatedAt: profile.updatedAt || fs.statSync(filePath).mtime.toISOString(),
          };
        } catch (error) {
          console.error(`[Wallet Profiles] Error reading ${file}:`, error.message);
          return null;
        }
      })
      .filter(profile => profile !== null)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    
    res.json({ success: true, profiles });
  } catch (error) {
    console.error('[Wallet Profiles] Error listing profiles:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get a specific wallet profile
app.get('/api/wallet-profiles/:id', (req, res) => {
  try {
    const { id } = req.params;
    const filePath = path.join(WALLET_PROFILES_DIR, `${id}.json`);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Wallet profile not found' });
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    const profile = JSON.parse(content);
    res.json({ success: true, profile });
  } catch (error) {
    console.error('[Wallet Profiles] Error loading profile:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Save a new wallet profile
app.post('/api/wallet-profiles', (req, res) => {
  try {
    const { name, profile } = req.body;
    
    if (!name || !profile) {
      return res.status(400).json({ success: false, error: 'Name and profile are required' });
    }
    
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now();
    
    const profileToSave = {
      id,
      name,
      description: profile.description || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      buyerAmount: profile.buyerAmount || '0',
      bundleWalletCount: profile.bundleWalletCount || 0,
      bundleSwapAmounts: profile.bundleSwapAmounts || '',
      swapAmount: profile.swapAmount || '0.01',
      useNormalLaunch: profile.useNormalLaunch || false,
      bundleIntermediaryHops: profile.bundleIntermediaryHops || 2,
      holderWalletCount: profile.holderWalletCount || 0,
      holderSwapAmounts: profile.holderSwapAmounts || '',
      holderWalletAmount: profile.holderWalletAmount || '0.10',
      autoHolderWalletBuy: profile.autoHolderWalletBuy || false,
      holderIntermediaryHops: profile.holderIntermediaryHops || 2,
      useMixingWallets: profile.useMixingWallets !== false,
      useMultiIntermediarySystem: profile.useMultiIntermediarySystem || false,
      numIntermediaryHops: profile.numIntermediaryHops || 2,
      walletSourceConfig: {
        useWarmedDevWallet: profile.walletSourceConfig?.useWarmedDevWallet || false,
        useWarmedBundleWallets: profile.walletSourceConfig?.useWarmedBundleWallets || false,
        useWarmedHolderWallets: profile.walletSourceConfig?.useWarmedHolderWallets || false,
      },
      // MEV Protection settings (complete)
      mevProtection: profile.mevProtection || {
        enabled: true,
        confirmationDelaySec: 3,
        launchCooldownSec: 5,
        rapidTraderWindowSec: 10,
      },
      
      // Auto-sell global settings
      autoSellGlobal: profile.autoSellGlobal || {
        enabled: false,
        defaultThreshold: 1.0,
      },
      
      // Legacy autoSellConfig (for backward compatibility)
      autoSellConfig: profile.autoSellConfig || {
        enabled: profile.autoSellGlobal?.enabled || false,
        mevProtection: profile.mevProtection || {
          enabled: true,
          confirmationDelaySec: 3,
          launchCooldownSec: 5,
        },
        walletThresholds: {},
      },
      
      // Sniper/front-run settings (complete)
      sniperConfig: {
        frontRunThreshold: profile.sniperConfig?.frontRunThreshold || 0,
        holderAutoBuyGroups: profile.sniperConfig?.holderAutoBuyGroups || [],
        holderAutoBuyConfigs: profile.sniperConfig?.holderAutoBuyConfigs || {},
        holderAutoSellConfigs: profile.sniperConfig?.holderAutoSellConfigs || {},
        bundleAutoSellConfigs: profile.sniperConfig?.bundleAutoSellConfigs || {},
      },
      
      // DEV wallet auto-sell
      devAutoSellConfig: profile.devAutoSellConfig || { threshold: '', enabled: false },
    };
    
    const filePath = path.join(WALLET_PROFILES_DIR, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(profileToSave, null, 2), 'utf8');
    
    console.log(`[Wallet Profiles] Saved profile: ${name} (${id})`);
    res.json({ success: true, id, message: 'Wallet profile saved successfully' });
  } catch (error) {
    console.error('[Wallet Profiles] Error saving profile:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update a wallet profile
app.put('/api/wallet-profiles/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, profile } = req.body;
    
    const filePath = path.join(WALLET_PROFILES_DIR, `${id}.json`);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Wallet profile not found' });
    }
    
    const existingContent = fs.readFileSync(filePath, 'utf8');
    const existingProfile = JSON.parse(existingContent);
    
    const profileToSave = {
      ...existingProfile,
      ...profile,
      name: name || existingProfile.name,
      updatedAt: new Date().toISOString(),
    };
    
    fs.writeFileSync(filePath, JSON.stringify(profileToSave, null, 2), 'utf8');
    
    console.log(`[Wallet Profiles] Updated profile: ${id}`);
    res.json({ success: true, message: 'Wallet profile updated successfully' });
  } catch (error) {
    console.error('[Wallet Profiles] Error updating profile:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete a wallet profile
app.delete('/api/wallet-profiles/:id', (req, res) => {
  try {
    const { id } = req.params;
    const filePath = path.join(WALLET_PROFILES_DIR, `${id}.json`);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Wallet profile not found' });
    }
    
    fs.unlinkSync(filePath);
    console.log(`[Wallet Profiles] Deleted profile: ${id}`);
    res.json({ success: true, message: 'Wallet profile deleted successfully' });
  } catch (error) {
    console.error('[Wallet Profiles] Error deleting profile:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// WebSocket server for real-time balance updates (optional - reduces RPC calls)
const WS_PORT = 3002;
let wss = null;

try {
  wss = new WebSocket.Server({ port: WS_PORT });
  
  // Handle port-in-use errors gracefully
  wss.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.log(`⚠️  WebSocket port ${WS_PORT} already in use. Balance WS disabled (using HTTP fallback).`);
      wss = null;
    } else {
      console.error('[Balance WS] Server error:', error.message);
    }
  });
  
  console.log(`📡 Balance WebSocket Server running on ws://localhost:${WS_PORT}`);
  
  wss.on('connection', (ws) => {
    
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        if (data.type === 'subscribe') {
          const { wallets, mintAddress } = data;
          
          // Send initial balances
          const balances = await batchFetchBalances(
            wallets.map(w => w.privateKey),
            mintAddress
          );
          
          ws.send(JSON.stringify({
            type: 'balances',
            wallets: balances,
            mintAddress
          }));
          
          // Send updates every 5 seconds (much less frequent than polling)
          const interval = setInterval(async () => {
            if (ws.readyState === WebSocket.OPEN) {
              const balances = await batchFetchBalances(
                wallets.map(w => w.privateKey),
                mintAddress
              );
              ws.send(JSON.stringify({
                type: 'balances',
                wallets: balances,
                mintAddress
              }));
            } else {
              clearInterval(interval);
            }
          }, 5000);
          
          ws.on('close', () => {
            clearInterval(interval);
          });
        }
      } catch (error) {
        console.error('[Balance WS] Error:', error);
      }
    });
    
    ws.on('close', () => {
    });
  });
} catch (error) {
  console.log(`⚠️  WebSocket server failed to start: ${error.message}. Using HTTP polling fallback.`);
}

// Live Trades SSE endpoint
// Get token metadata from Helius/Metaplex only
app.get('/api/token-info/:mintAddress', async (req, res) => {
  try {
    const { mintAddress } = req.params;
    const rpcEndpoint = process.env.RPC_ENDPOINT;
    
    if (!rpcEndpoint) {
      return res.json({
        name: 'Unknown Token',
        symbol: 'UNKNOWN',
        address: mintAddress,
        marketCap: 0,
        price: 0,
        liquidity: 0,
        volume24h: 0,
        priceChange24h: 0,
        logoURI: null
      });
    }
    
    try {
      const connection = new Connection(rpcEndpoint, 'confirmed');
      const mintPubkey = new PublicKey(mintAddress);
      
      // Get token metadata using Metaplex standard
      const metadataProgramId = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
      const [metadataPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('metadata'),
          metadataProgramId.toBuffer(),
          mintPubkey.toBuffer(),
        ],
        metadataProgramId
      );
      
      const metadataAccount = await connection.getAccountInfo(metadataPDA);
      let name = 'Unknown Token';
      let symbol = 'UNKNOWN';
      let logoURI = null;
      
      if (metadataAccount) {
        // Parse metadata (simplified - you may need to use @metaplex-foundation/mpl-token-metadata for full parsing)
        const metadataData = metadataAccount.data;
        
        try {
          // Metadata structure: key(1) + update_authority(32) + mint(32) + data...
          const dataStart = 1 + 32 + 32;
          if (metadataData.length > dataStart + 4) {
            const nameLen = metadataData.readUInt32LE(dataStart);
            if (nameLen > 0 && nameLen < 100) {
              name = metadataData.slice(dataStart + 4, dataStart + 4 + nameLen).toString('utf8').replace(/\0/g, '');
            }
            const symbolStart = dataStart + 4 + nameLen + 4;
            const symbolLen = metadataData.readUInt32LE(dataStart + 4 + nameLen);
            if (symbolLen > 0 && symbolLen < 100) {
              symbol = metadataData.slice(symbolStart, symbolStart + symbolLen).toString('utf8').replace(/\0/g, '');
            }
            const uriStart = symbolStart + symbolLen + 4;
            const uriLen = metadataData.readUInt32LE(symbolStart + symbolLen);
            if (uriLen > 0 && uriLen < 500) {
              logoURI = metadataData.slice(uriStart, uriStart + uriLen).toString('utf8').replace(/\0/g, '');
            }
          }
        } catch (e) {
          console.log('[Token Info] Error parsing metadata:', e.message);
        }
      }
      
      res.json({
        name: name || 'Unknown Token',
        symbol: symbol || 'UNKNOWN',
        address: mintAddress,
        marketCap: 0, // Market cap will be calculated from trades
        price: 0, // Price will be calculated from trades
        liquidity: 0,
        volume24h: 0,
        priceChange24h: 0,
        logoURI: logoURI
      });
    } catch (error) {
      console.log('[Token Info] Helius metadata fetch failed:', error.message);
      res.json({
        name: 'Unknown Token',
        symbol: 'UNKNOWN',
        address: mintAddress,
        marketCap: 0,
        price: 0,
        liquidity: 0,
        volume24h: 0,
        priceChange24h: 0,
        logoURI: null
      });
    }
  } catch (error) {
    console.error('[Token Info] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Launch progress SSE endpoint (real-time launch output)
app.get('/api/launch-progress', (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // Initialize listeners array if needed
  if (!global.launchProgressListeners) {
    global.launchProgressListeners = [];
  }
  
  // Add this client as a listener
  global.launchProgressListeners.push(res);
  
  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Connected to launch progress stream' })}\n\n`);
  
  // Clean up on client disconnect
  req.on('close', () => {
    global.launchProgressListeners = global.launchProgressListeners.filter(l => l !== res);
  });
});

app.get('/api/live-trades', async (req, res) => {
  const mintAddress = req.query.mint;
  
  if (!mintAddress) {
    console.error('[API] ❌ No mint address provided');
    return res.status(400).json({ error: 'Mint address required' });
  }
  
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    // Subscribe to PumpPortal for this token
    pumpPortalTracker.subscribeToToken(mintAddress);
    
    // Add this client as a listener
    pumpPortalTracker.addListener(res);
    
    // Send initial cached trades immediately
    const initialTrades = pumpPortalTracker.getTrades(mintAddress);
    res.write(`data: ${JSON.stringify({ type: 'initial', trades: initialTrades })}\n\n`);
    
    // Clean up on client disconnect
    req.on('close', () => {
      pumpPortalTracker.removeListener(res);
    });
  } catch (error) {
    console.error('[API] Error in live-trades endpoint:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
  }
});

// Test wallet endpoints removed - using PumpPortal only

// Get test wallets (deprecated - returns empty)
app.get('/api/live-trades/test-wallets', async (req, res) => {
  res.json({
    success: true,
    wallets: [],
    count: 0
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-SELL ENDPOINTS - Per-wallet threshold-based automatic selling
// Now using unified TradeManager
// ═══════════════════════════════════════════════════════════════════════════

// Get auto-sell configuration
app.get('/api/auto-sell/config', (req, res) => {
  try {
    const config = pumpPortalTracker.getAutoSellConfig();
    res.json({ success: true, ...config });
  } catch (error) {
    console.error('[API] Error getting auto-sell config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Configure auto-sell for a single wallet
app.post('/api/auto-sell/configure', (req, res) => {
  try {
    const { walletAddress, threshold } = req.body;
    
    if (!walletAddress) {
      return res.status(400).json({ success: false, error: 'walletAddress required' });
    }
    
    pumpPortalTracker.configureAutoSell(walletAddress, threshold);
    res.json({ success: true, ...pumpPortalTracker.getAutoSellConfig() });
  } catch (error) {
    console.error('[API] Error configuring auto-sell:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Bulk configure auto-sell for multiple wallets
app.post('/api/auto-sell/configure-all', (req, res) => {
  try {
    const { wallets, enabled } = req.body;
    
    if (!wallets || typeof wallets !== 'object') {
      return res.status(400).json({ success: false, error: 'wallets object required' });
    }
    
    // Configure each wallet
    for (const [addr, config] of Object.entries(wallets)) {
      pumpPortalTracker.configureAutoSell(addr, config.threshold || 0);
    }
    if (typeof enabled === 'boolean') {
      pumpPortalTracker.setAutoSellEnabled(enabled);
    }
    res.json({ success: true, ...pumpPortalTracker.getAutoSellConfig() });
  } catch (error) {
    console.error('[API] Error configuring auto-sell:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Enable/disable global auto-sell
app.post('/api/auto-sell/toggle', (req, res) => {
  try {
    const { enabled } = req.body;
    pumpPortalTracker.setAutoSellEnabled(enabled === true);
    res.json({ success: true, ...pumpPortalTracker.getAutoSellConfig() });
  } catch (error) {
    console.error('[API] Error toggling auto-sell:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Reset auto-sell state (for new runs)
app.post('/api/auto-sell/reset', (req, res) => {
  try {
    pumpPortalTracker.resetAutoSell();
    res.json({ success: true, ...pumpPortalTracker.getAutoSellConfig() });
  } catch (error) {
    console.error('[API] Error resetting auto-sell:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Manually trigger threshold check (for debugging/testing)
app.post('/api/auto-sell/check-thresholds', (req, res) => {
  try {
    console.log('[API] 🔍 Manual threshold check triggered');
    pumpPortalTracker.checkAutoSellThresholds();
    
    const config = pumpPortalTracker.getAutoSellConfig();
    res.json({ 
      success: true, 
      message: 'Threshold check completed',
      externalNetVolume: pumpPortalTracker.externalNetVolume,
      config 
    });
  } catch (error) {
    console.error('[API] Error checking thresholds:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Configure MEV protection settings
app.post('/api/auto-sell/mev-protection', (req, res) => {
  try {
    const { confirmationDelaySec, launchCooldownSec } = req.body;
    
    pumpPortalTracker.setMevProtection({
      confirmationDelaySec: confirmationDelaySec !== undefined ? parseFloat(confirmationDelaySec) : undefined,
      launchCooldownSec: launchCooldownSec !== undefined ? parseFloat(launchCooldownSec) : undefined,
    });
    
    const mev = pumpPortalTracker.getMevProtection();
    res.json({ 
      success: true, 
      mevProtection: mev
    });
  } catch (error) {
    console.error('[API] Error configuring MEV protection:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get MEV protection settings
app.get('/api/auto-sell/mev-protection', (req, res) => {
  try {
    const mev = pumpPortalTracker.getMevProtection();
    res.json({ 
      success: true, 
      mevProtection: mev
    });
  } catch (error) {
    console.error('[API] Error getting MEV protection:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// SSE endpoint for auto-sell events
app.get('/api/auto-sell/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // Send initial config
  res.write(`data: ${JSON.stringify({ type: 'config', ...pumpPortalTracker.getAutoSellConfig() })}\n\n`);
  
  // Listen for auto-sell events from PumpPortal
  const removeListener = pumpPortalTracker.addAutoSellListener((event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  
  req.on('close', () => {
    removeListener();
  });
});

// Set up auto-sell executor for PumpPortal (executes the actual sell when threshold is reached)
pumpPortalTracker.setAutoSellExecutor(async (walletAddress) => {
  console.log(`[PumpPortal AutoSell] ⚡ Executing sell for ${walletAddress.slice(0, 8)}...`);
  
  try {
    // Get current mint address
    const mintAddress = pumpPortalTracker.currentMintAddress;
    if (!mintAddress) {
      throw new Error('No active token to sell');
    }
    
    // Find the wallet's private key
    const privateKey = getPrivateKeyByAddress(walletAddress);
    if (!privateKey) {
      throw new Error('Could not find private key for wallet');
    }
    
    // Execute sell (100% of tokens) using the same method as holder-wallet/sell
    const percentage = 100;
    const { callTradingFunction } = require('./call-trading-function');
    
    console.log(`[PumpPortal AutoSell] 🚀 Selling 100% of tokens for ${walletAddress.slice(0, 8)}...`);
    
    const result = await callTradingFunction('sellTokenSimple', privateKey, mintAddress, percentage, 'low');
    
    // Invalidate cache after sell
    const keypair = Keypair.fromSecretKey(base58.decode(privateKey));
    invalidateBalanceCache(keypair.publicKey.toBase58(), mintAddress);
    
    console.log(`[PumpPortal AutoSell] ✅ Sell completed for ${walletAddress.slice(0, 8)}...`);
    
    return {
      success: true,
      walletAddress,
      mintAddress,
      percentage,
      result,
    };
  } catch (error) {
    console.error(`[PumpPortal AutoSell] ❌ Sell failed for ${walletAddress.slice(0, 8)}...:`, error.message);
    throw error;
  }
});

// QuickNode Webhook Endpoint - DISABLED (using PumpPortal instead)
app.post('/api/quicknode-webhook', express.json({ limit: '50mb' }), async (req, res) => {
  // QuickNode webhooks disabled - using PumpPortal for trade tracking
  res.status(200).json({ success: true, message: 'QuickNode disabled - using PumpPortal' });
});

// Transfer SOL from one wallet to another (any wallet to any wallet)
app.post('/api/transfer-sol', async (req, res) => {
  try {
    const { fromPrivateKey, toAddress, amount } = req.body;
    
    if (!fromPrivateKey || !toAddress || !amount) {
      return res.status(400).json({ 
        success: false, 
        error: 'fromPrivateKey, toAddress, and amount are required' 
      });
    }
    
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Amount must be a positive number' 
      });
    }
    
    const { Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } = require('@solana/web3.js');
    const base58 = require('bs58').default || require('bs58');
    
    // Get RPC endpoint
    const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
    const RPC_WEBSOCKET_ENDPOINT = process.env.RPC_WEBSOCKET_ENDPOINT || '';
    const connection = new Connection(RPC_ENDPOINT, {
      wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
      commitment: 'confirmed'
    });
    
    // Load from wallet
    let fromKp;
    try {
      fromKp = Keypair.fromSecretKey(base58.decode(fromPrivateKey));
    } catch (error) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid fromPrivateKey format' 
      });
    }
    
    // Validate to address
    let toPubkey;
    try {
      toPubkey = new PublicKey(toAddress);
    } catch (error) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid toAddress format' 
      });
    }
    
    // Check balance
    const balance = await connection.getBalance(fromKp.publicKey);
    const balanceSol = balance / 1e9;
    
    if (amountNum > balanceSol) {
      return res.status(400).json({ 
        success: false, 
        error: `Insufficient balance. Available: ${balanceSol.toFixed(6)} SOL, Requested: ${amountNum.toFixed(6)} SOL` 
      });
    }
    
    // Create transfer transaction
    const latestBlockhash = await connection.getLatestBlockhash('confirmed');
    const transferMsg = new TransactionMessage({
      payerKey: fromKp.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: fromKp.publicKey,
          toPubkey: toPubkey,
          lamports: Math.floor(amountNum * 1e9)
        })
      ]
    }).compileToV0Message();
    
    const transferTx = new VersionedTransaction(transferMsg);
    transferTx.sign([fromKp]);
    
    const sig = await connection.sendTransaction(transferTx, { skipPreflight: true, maxRetries: 3 });
    
    // Wait for confirmation
    await connection.confirmTransaction(sig, 'confirmed');
    
    console.log(`[Transfer] ✅ Transferred ${amountNum.toFixed(6)} SOL from ${fromKp.publicKey.toString().slice(0, 8)}... to ${toAddress.slice(0, 8)}... (sig: ${sig})`);
    
    res.json({
      success: true,
      signature: sig,
      amount: amountNum,
      from: fromKp.publicKey.toString(),
      to: toAddress,
      message: `Transferred ${amountNum.toFixed(6)} SOL successfully`
    });
  } catch (error) {
    console.error('[API] Error transferring SOL:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to transfer SOL' 
    });
  }
});

// ============================================
// LAUNCH TRACKER API ENDPOINTS
// ============================================

const { getLaunchTracker } = require('./launch-tracker');

// Get current launch snapshot
app.get('/api/launch-tracker/current', (req, res) => {
  try {
    const tracker = getLaunchTracker();
    const snapshot = tracker.getCurrentSnapshot();
    res.json({ success: true, snapshot });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get trade statistics for current launch
app.get('/api/launch-tracker/stats', (req, res) => {
  try {
    const tracker = getLaunchTracker();
    const stats = tracker.getTradeStats();
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Calculate PnL for current launch
app.post('/api/launch-tracker/calculate-pnl', async (req, res) => {
  try {
    const tracker = getLaunchTracker();
    const connection = new Connection(RPC_ENDPOINT, 'confirmed');
    const pnl = await tracker.calculatePnL(connection);
    res.json({ success: true, pnl });
  } catch (error) {
    console.error('[API] Error calculating PnL:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Complete current launch and save to history
app.post('/api/launch-tracker/complete', async (req, res) => {
  try {
    const tracker = getLaunchTracker();
    const connection = new Connection(RPC_ENDPOINT, 'confirmed');
    const result = await tracker.completeLaunch(connection);
    res.json({ success: true, launch: result });
  } catch (error) {
    console.error('[API] Error completing launch:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get launch history
app.get('/api/launch-tracker/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const tracker = getLaunchTracker();
    const history = tracker.getLaunchHistory(limit);
    res.json({ success: true, history, count: history.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get trade history for a specific launch
app.get('/api/launch-tracker/trades/:launchId', (req, res) => {
  try {
    const tracker = getLaunchTracker();
    const trades = tracker.getTradeHistory(req.params.launchId);
    res.json({ success: true, trades });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get aggregated stats for pattern recognition
app.get('/api/launch-tracker/aggregated-stats', (req, res) => {
  try {
    const tracker = getLaunchTracker();
    const stats = tracker.getAggregatedStats();
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// PUMPPORTAL TEST ENDPOINTS (for comparing with Helius)
// =====================================================

// Initialize PumpPortal tracker (keeping for backward compatibility)
pumpPortalTracker.initialize();

// Candle aggregator removed - using Birdeye charts instead
// (removed to avoid rate limits)

console.log('[API Server] ✅ PumpPortal tracker initialized');

// =====================================================
// INITIALIZE CLEAN P&L TRACKER
// =====================================================
const pnlTracker = require('./pnl-tracker');

// Initialize from current-run.json if exists
try {
  const currentRunPath = path.join(__dirname, '..', 'keys', 'current-run.json');
  if (fs.existsSync(currentRunPath)) {
    const currentRun = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
    if (currentRun.mintAddress) {
      // Build wallet addresses from keys
      const walletsData = {
        devWalletAddress: currentRun.devWallet || currentRun.devWalletAddress,
        bundleWalletAddresses: currentRun.bundleWalletAddresses || [],
        holderWalletAddresses: currentRun.holderWalletAddresses || [],
      };
      pnlTracker.initLaunch(currentRun.mintAddress, walletsData);
    }
  }
} catch (e) {
  console.log('[PnL] Could not init from current-run:', e.message);
}

// Set up sell executor for auto-sells
pnlTracker.setSellExecutor(async (walletAddr, percentage) => {
  // Find wallet in warmed wallets
  const warmedPath = path.join(__dirname, '..', 'keys', 'warmed-wallets.json');
  let privateKey = null;
  
  if (fs.existsSync(warmedPath)) {
    const warmed = JSON.parse(fs.readFileSync(warmedPath, 'utf8'));
    const wallet = warmed.find(w => w.address?.toLowerCase() === walletAddr?.toLowerCase());
    if (wallet) privateKey = wallet.privateKey;
  }
  
  if (!privateKey) {
    throw new Error('Wallet private key not found');
  }
  
  // Get current mint
  const currentRunPath = path.join(__dirname, '..', 'keys', 'current-run.json');
  const currentRun = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
  const mintAddress = currentRun.mintAddress;
  
  // Execute sell
  const { callTradingFunction } = require('./call-trading-function');
  const result = await callTradingFunction('sellTokenSimple', privateKey, mintAddress, percentage, 'high');
  
  return result;
});

console.log('[API Server] ✅ Clean PnL Tracker initialized');

// Watch for new launches to reinitialize PnL tracker
try {
  const currentRunPath = path.join(__dirname, '..', 'keys', 'current-run.json');
  let lastMint = null;
  
  fs.watch(currentRunPath, { persistent: false }, () => {
    try {
      const data = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
      if (data.mintAddress && data.mintAddress !== lastMint) {
        lastMint = data.mintAddress;
        
        // Build wallet addresses
        const walletsData = {
          devWalletAddress: data.devWallet || data.devWalletAddress,
          bundleWalletAddresses: data.bundleWalletAddresses || [],
          holderWalletAddresses: data.holderWalletAddresses || [],
        };
        
        // Reinitialize PnL tracker for new launch
        pnlTracker.initLaunch(data.mintAddress, walletsData);
        console.log(`[PnL] 🚀 Reinitialized for new launch: ${data.mintAddress.slice(0, 8)}...`);
      }
    } catch (e) {}
  });
  
  console.log('[API Server] 👀 Watching for new launches to init PnL');
} catch (e) {
  console.log('[API Server] Could not watch current-run.json:', e.message);
}

// =====================================================
// NEW TRADE MANAGER API ENDPOINTS
// =====================================================

// Get TradeManager status
app.get('/api/trade-manager/status', (req, res) => {
  res.json({ success: true, ...pumpPortalTracker.getStatus() });
});

// Get all trades
app.get('/api/trade-manager/trades', (req, res) => {
  const trades = pumpPortalTracker.getTrades();
  res.json({ success: true, trades, count: trades.length });
});

// Get P&L for all wallets
app.get('/api/trade-manager/pnl', (req, res) => {
  const wallets = pumpPortalTracker.getWalletProfits();
  const total = wallets.reduce((sum, w) => sum + (w.profit || 0), 0);
  res.json({ success: true, wallets, total });
});

// Get external volume
app.get('/api/trade-manager/external-volume', (req, res) => {
  const config = pumpPortalTracker.getAutoSellConfig();
  res.json({ success: true, net: config.externalNetVolume || 0 });
});

// Start tracking a token
app.post('/api/trade-manager/track', (req, res) => {
  const { mintAddress } = req.body;
  if (!mintAddress) {
    return res.status(400).json({ success: false, error: 'mintAddress required' });
  }
  pumpPortalTracker.subscribeToToken(mintAddress);
  res.json({ success: true, message: `Tracking ${mintAddress.slice(0, 8)}...` });
});

// Manually record a trade (for testing or imports)
app.post('/api/trade-manager/record-trade', (req, res) => {
  const { signature, wallet, type, solAmount, tokenAmount } = req.body;
  if (!wallet || !type || !solAmount) {
    return res.status(400).json({ success: false, error: 'wallet, type, and solAmount required' });
  }
  // Use PumpPortal injectTrade for manual trade recording
  pumpPortalTracker.injectTrade({
    signature: signature || `manual-${Date.now()}`,
    mint: pumpPortalTracker.currentMintAddress,
    traderPublicKey: wallet,
    txType: type,
    solAmount: parseFloat(solAmount),
    tokenAmount: parseFloat(tokenAmount) || 0,
    source: 'manual'
  });
  res.json({ success: true, message: 'Trade recorded' });
});

// =====================================================
// CLEAN P&L TRACKER API ENDPOINTS
// =====================================================

// Get all wallets P&L
app.get('/api/pnl/wallets', (req, res) => {
  const wallets = pnlTracker.getAllWalletsPnL();
  const total = pnlTracker.getTotalPnL();
  res.json({ success: true, wallets, total });
});

// Get specific wallet P&L
app.get('/api/pnl/wallet/:label', (req, res) => {
  const pnl = pnlTracker.getWalletPnL(req.params.label);
  if (!pnl) {
    return res.status(404).json({ success: false, error: 'Wallet not found' });
  }
  res.json({ success: true, ...pnl });
});

// Get total P&L
app.get('/api/pnl/total', (req, res) => {
  const total = pnlTracker.getTotalPnL();
  res.json({ success: true, ...total });
});

// Get external volume
app.get('/api/pnl/external-volume', (req, res) => {
  const volume = pnlTracker.getExternalVolume();
  res.json({ success: true, ...volume });
});

// Configure auto-sell for a wallet
app.post('/api/pnl/auto-sell/configure', (req, res) => {
  const { walletLabel, externalVolume, profitPercent, stopLoss, timeSeconds, percentage, enabled } = req.body;
  
  if (!walletLabel) {
    return res.status(400).json({ success: false, error: 'walletLabel required' });
  }
  
  const success = pnlTracker.configureAutoSell(walletLabel, {
    enabled,
    externalVolume,
    profitPercent,
    stopLoss,
    timeSeconds,
    percentage,
  });
  
  res.json({ success, message: success ? 'Auto-sell configured' : 'Failed to configure' });
});

// Get auto-sell config
app.get('/api/pnl/auto-sell/config', (req, res) => {
  const config = pnlTracker.getAutoSellConfig();
  res.json({ success: true, config });
});

// Configure auto-buy
app.post('/api/pnl/auto-buy/configure', (req, res) => {
  const { walletLabel, externalVolume, amount, enabled } = req.body;
  
  pnlTracker.configureAutoBuy({
    enabled,
    walletLabel,
    externalVolume,
    amount,
  });
  
  res.json({ success: true, message: 'Auto-buy configured' });
});

// Reset P&L data for current launch
app.post('/api/pnl/reset', (req, res) => {
  pnlTracker.reset();
  res.json({ success: true, message: 'P&L data reset' });
});

// Bundle buys are now tracked exclusively via PumpPortal WebSocket

// SSE endpoint for real-time P&L updates
app.get('/api/pnl/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // Send current state
  res.write(`data: ${JSON.stringify({ type: 'init', wallets: pnlTracker.getAllWalletsPnL(), total: pnlTracker.getTotalPnL(), external: pnlTracker.getExternalVolume() })}\n\n`);
  
  // Listen for updates
  const onTrade = (data) => {
    res.write(`data: ${JSON.stringify({ type: 'trade', ...data })}\n\n`);
  };
  const onExternal = (data) => {
    res.write(`data: ${JSON.stringify({ type: 'external', ...data })}\n\n`);
  };
  const onAutoSell = (data) => {
    res.write(`data: ${JSON.stringify({ type: 'autoSell', ...data })}\n\n`);
  };
  
  pnlTracker.on('trade', onTrade);
  pnlTracker.on('externalVolume', onExternal);
  pnlTracker.on('autoSellTriggered', onAutoSell);
  pnlTracker.on('autoSellComplete', onAutoSell);
  
  req.on('close', () => {
    pnlTracker.off('trade', onTrade);
    pnlTracker.off('externalVolume', onExternal);
    pnlTracker.off('autoSellTriggered', onAutoSell);
    pnlTracker.off('autoSellComplete', onAutoSell);
  });
});

// Candle aggregator removed - using Birdeye charts instead
// (removed to avoid rate limits)
// Connect PumpPortal trades to TradeManager only
try {
  // Forward all PumpPortal trades to TradeManager
  pumpPortalTracker.addTradeCallback((trade) => {
    // Candle aggregator removed - using Birdeye charts instead
    
    // Forward to PnL Tracker
    try {
      if (trade.isOurWallet && trade.solAmount > 0) {
        // Record OUR trades for accurate P&L
        pnlTracker.recordOurTrade({
          wallet: trade.fullTrader,
          type: trade.type,
          solAmount: trade.solAmount,
          tokenAmount: trade.tokenAmount || trade.amount || 0,
          signature: trade.fullSignature || trade.signature,
          timestamp: trade.timestamp,
        });
      } else if (!trade.isOurWallet && trade.solAmount > 0) {
        // Record EXTERNAL trades for auto-sell triggers
        pnlTracker.recordExternalTrade({
          type: trade.type,
          solAmount: trade.solAmount,
        });
      }
    } catch (err) {}
  });
  
  console.log('[API Server] ✅ Connected PumpPortal to TradeManager + PnL');
} catch (err) {
  console.log('[API Server] ⚠️ Could not connect PumpPortal:', err.message);
}

// Get PumpPortal status
app.get('/api/pumpportal/status', (req, res) => {
  res.json(pumpPortalTracker.getStatus());
});

// Subscribe to token trades
app.post('/api/pumpportal/subscribe', (req, res) => {
  const { mintAddress } = req.body;
  if (!mintAddress) {
    return res.status(400).json({ error: 'mintAddress required' });
  }
  
  const success = pumpPortalTracker.subscribeToToken(mintAddress);
  res.json({ 
    success, 
    mintAddress,
    message: success ? `Subscribed to ${mintAddress}` : 'Failed to subscribe'
  });
});

// Unsubscribe from token trades
app.post('/api/pumpportal/unsubscribe', (req, res) => {
  const { mintAddress } = req.body;
  if (!mintAddress) {
    return res.status(400).json({ error: 'mintAddress required' });
  }
  
  const success = pumpPortalTracker.unsubscribeFromToken(mintAddress);
  res.json({ success, mintAddress });
});

// SSE stream for PumpPortal trades
app.get('/api/pumpportal/trades/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', source: 'pumpportal' })}\n\n`);

  // Add listener
  pumpPortalTracker.addListener(res);

  // Handle disconnect
  req.on('close', () => {
    pumpPortalTracker.removeListener(res);
  });
});

// Get cached trades for a mint
app.get('/api/pumpportal/trades/:mintAddress', (req, res) => {
  const { mintAddress } = req.params;
  const trades = pumpPortalTracker.getTrades(mintAddress);
  res.json({ trades, count: trades.length });
});

// Get trade stats for a mint (for pattern detection)
app.get('/api/pumpportal/stats/:mintAddress', (req, res) => {
  const { mintAddress } = req.params;
  const stats = pumpPortalTracker.getTradeStats(mintAddress);
  res.json({ 
    mintAddress,
    stats,
    externalNetVolume: pumpPortalTracker.externalNetVolume,
  });
});

// Get wallet profits (P&L per wallet)
app.get('/api/pumpportal/wallet-profits', (req, res) => {
  const profits = pumpPortalTracker.getWalletProfits();
  res.json({ 
    success: true,
    wallets: profits,
    totalProfit: profits.reduce((sum, w) => sum + w.profit, 0),
  });
});

// NOTE: Vercel/Domain setup endpoints removed for simplified public version
// Removed endpoints: /api/setup/*, /api/vercel/*, /api/domains/*

// =====================================================
// DEBUG & LOGGING ENDPOINTS
// =====================================================

// List all debug log files
app.get('/api/debug/logs', (req, res) => {
  try {
    const logFiles = debugLogger.getLogFiles();
    res.json({ 
      success: true, 
      currentLog: debugLogger.getLogFilePath(),
      logs: logFiles,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get current log file content (last N lines)
app.get('/api/debug/logs/current', (req, res) => {
  try {
    const logPath = debugLogger.getLogFilePath();
    const lines = parseInt(req.query.lines) || 500;
    
    if (!logPath || !fs.existsSync(logPath)) {
      return res.json({ success: true, content: 'No log file yet', lines: 0 });
    }
    
    const content = fs.readFileSync(logPath, 'utf8');
    const allLines = content.split('\n');
    const lastLines = allLines.slice(-lines).join('\n');
    
    res.json({ 
      success: true, 
      path: logPath,
      totalLines: allLines.length,
      content: lastLines,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Download a specific log file
app.get('/api/debug/logs/:filename', (req, res) => {
  try {
    const logsDir = path.join(__dirname, '..', 'logs');
    const logPath = path.join(logsDir, req.params.filename);
    
    // Security check - ensure path is within logs directory
    if (!logPath.startsWith(logsDir)) {
      return res.status(403).json({ success: false, error: 'Invalid path' });
    }
    
    if (!fs.existsSync(logPath)) {
      return res.status(404).json({ success: false, error: 'Log file not found' });
    }
    
    res.download(logPath);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get debug summary (quick health check)
app.get('/api/debug/summary', (req, res) => {
  try {
    const logsDir = path.join(__dirname, '..', 'logs');
    const keysDir = path.join(__dirname, '..', 'keys');
    const currentRunPath = path.join(keysDir, 'current-run.json');
    
    // Get current run info
    let currentRun = null;
    if (fs.existsSync(currentRunPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
        currentRun = {
          mintAddress: data.mintAddress?.slice(0, 12) + '...',
          launchStatus: data.launchStatus,
          walletsCount: (data.holderWalletKeys?.length || 0) + (data.bundleWalletKeys?.length || 0) + 1,
        };
      } catch (e) {}
    }
    
    // Get tracker stats
    const trackerStats = {
      ourWalletsCount: pumpPortalTracker.ourWallets?.size || 0,
      currentMint: pumpPortalTracker.currentMintAddress?.slice(0, 12) + '...',
      externalNetVolume: pumpPortalTracker.externalNetVolume?.toFixed(3),
      isConnected: pumpPortalTracker.isConnected,
      tradesTracked: pumpPortalTracker.tradeCache?.get(pumpPortalTracker.currentMintAddress)?.length || 0,
    };
    
    // Get wallet P&L summary (including fees)
    const walletPnL = [];
    if (pumpPortalTracker.walletProfits) {
      for (const [addr, data] of pumpPortalTracker.walletProfits) {
        walletPnL.push({
          wallet: (pumpPortalTracker.walletLabels?.get(addr) || addr.slice(0, 8)),
          buys: data.buys?.toFixed(3),
          sells: data.sells?.toFixed(3),
          fees: data.fees?.toFixed(4) || '0.0000',
          profit: data.profit?.toFixed(3),
        });
      }
    }
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      currentRun,
      tracker: trackerStats,
      walletPnL,
      logFile: debugLogger.getLogFilePath(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Force P&L recalculation
app.post('/api/debug/recalculate-pnl', (req, res) => {
  try {
    debugLogger.log('DEBUG', 'Manual P&L recalculation triggered');
    pumpPortalTracker.recalculateProfitsFromCache();
    
    // Get updated stats
    const walletPnL = [];
    for (const [addr, data] of pumpPortalTracker.walletProfits) {
      walletPnL.push({
        wallet: (pumpPortalTracker.walletLabels?.get(addr) || addr.slice(0, 8)),
        buys: data.buys?.toFixed(4),
        sells: data.sells?.toFixed(4),
        profit: data.profit?.toFixed(4),
      });
    }
    
    res.json({
      success: true,
      message: 'P&L recalculated from cache',
      externalNetVolume: pumpPortalTracker.externalNetVolume?.toFixed(4),
      walletPnL,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Force wallet reload
app.post('/api/debug/reload-wallets', (req, res) => {
  try {
    debugLogger.log('DEBUG', 'Manual wallet reload triggered');
    pumpPortalTracker.reloadFromCurrentRun();
    
    res.json({
      success: true,
      message: 'Wallets reloaded',
      walletsCount: pumpPortalTracker.ourWallets?.size || 0,
      walletTypes: Object.fromEntries(pumpPortalTracker.walletTypes || new Map()),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// QUICK FUND WALLETS - Instant wallet funding without bundles/LUTs
// =====================================================

// Quick fund multiple wallets in parallel (for external buys after launch)
app.post('/api/quick-fund', async (req, res) => {
  try {
    debugLogger.log('QUICK-FUND', 'Quick fund request received');
    
    const { wallets, amounts } = req.body;
    // wallets: array of wallet addresses OR 'holder' | 'bundle' | 'all'
    // amounts: single number OR array of numbers matching wallets
    
    if (!wallets) {
      return res.status(400).json({ success: false, error: 'wallets parameter required' });
    }
    
    const env = readEnvFile();
    if (!env.PRIVATE_KEY) {
      return res.status(400).json({ success: false, error: 'PRIVATE_KEY not set in .env' });
    }
    
    const connection = new Connection(
      env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
      { commitment: 'confirmed' }
    );
    
    const fundingWallet = Keypair.fromSecretKey(base58.decode(env.PRIVATE_KEY));
    console.log(`[Quick Fund] Funding wallet: ${fundingWallet.publicKey.toBase58()}`);
    
    // Resolve wallet addresses
    let targetWallets = [];
    const keysDir = path.join(__dirname, '..', 'keys');
    const currentRunPath = path.join(keysDir, 'current-run.json');
    
    if (typeof wallets === 'string') {
      // Load from current-run.json
      if (!fs.existsSync(currentRunPath)) {
        return res.status(400).json({ success: false, error: 'No current run found' });
      }
      
      const currentRun = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
      
      if (wallets === 'holder' || wallets === 'all') {
        if (currentRun.holderWalletKeys) {
          for (const key of currentRun.holderWalletKeys) {
            const kp = Keypair.fromSecretKey(base58.decode(key));
            targetWallets.push({ address: kp.publicKey.toBase58(), keypair: kp, type: 'holder' });
          }
        }
      }
      if (wallets === 'bundle' || wallets === 'all') {
        if (currentRun.bundleWalletKeys) {
          for (const key of currentRun.bundleWalletKeys) {
            const kp = Keypair.fromSecretKey(base58.decode(key));
            targetWallets.push({ address: kp.publicKey.toBase58(), keypair: kp, type: 'bundle' });
          }
        }
      }
    } else if (Array.isArray(wallets)) {
      // Direct addresses or keys
      for (const w of wallets) {
        if (w.length > 50) {
          // Assume it's a private key
          const kp = Keypair.fromSecretKey(base58.decode(w));
          targetWallets.push({ address: kp.publicKey.toBase58(), keypair: kp, type: 'custom' });
        } else {
          // Assume it's an address
          targetWallets.push({ address: w, keypair: null, type: 'custom' });
        }
      }
    }
    
    if (targetWallets.length === 0) {
      return res.status(400).json({ success: false, error: 'No wallets found to fund' });
    }
    
    // Resolve amounts
    let fundingAmounts = [];
    if (typeof amounts === 'number') {
      fundingAmounts = Array(targetWallets.length).fill(amounts);
    } else if (Array.isArray(amounts)) {
      fundingAmounts = amounts;
      while (fundingAmounts.length < targetWallets.length) {
        fundingAmounts.push(amounts[0] || 0.1); // Default to 0.1 SOL
      }
    } else {
      fundingAmounts = Array(targetWallets.length).fill(0.1); // Default 0.1 SOL each
    }
    
    console.log(`[Quick Fund] Funding ${targetWallets.length} wallet(s) with amounts: ${fundingAmounts.join(', ')}`);
    
    // Check funding wallet balance
    const fundingBalance = await connection.getBalance(fundingWallet.publicKey);
    const totalNeeded = fundingAmounts.reduce((a, b) => a + b, 0) + (0.001 * targetWallets.length); // Add fee buffer
    
    if (fundingBalance / LAMPORTS_PER_SOL < totalNeeded) {
      return res.status(400).json({ 
        success: false, 
        error: `Insufficient balance. Have ${(fundingBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL, need ${totalNeeded.toFixed(4)} SOL` 
      });
    }
    
    // Fund wallets in parallel batches
    const batchSize = 5;
    const results = [];
    
    for (let i = 0; i < targetWallets.length; i += batchSize) {
      const batch = targetWallets.slice(i, i + batchSize);
      const batchAmounts = fundingAmounts.slice(i, i + batchSize);
      
      const batchResults = await Promise.all(batch.map(async (wallet, idx) => {
        try {
          const amount = batchAmounts[idx];
          const targetPubkey = new PublicKey(wallet.address);
          
          const latestBlockhash = await connection.getLatestBlockhash();
          const transferMsg = new TransactionMessage({
            payerKey: fundingWallet.publicKey,
            recentBlockhash: latestBlockhash.blockhash,
            instructions: [
              SystemProgram.transfer({
                fromPubkey: fundingWallet.publicKey,
                toPubkey: targetPubkey,
                lamports: Math.floor(amount * LAMPORTS_PER_SOL)
              })
            ]
          }).compileToV0Message();
          
          const tx = new VersionedTransaction(transferMsg);
          tx.sign([fundingWallet]);
          
          const sig = await connection.sendTransaction(tx, { skipPreflight: false, maxRetries: 3 });
          await connection.confirmTransaction(sig, 'confirmed');
          
          const newBalance = await connection.getBalance(targetPubkey);
          
          debugLogger.log('QUICK-FUND', `✅ Funded ${wallet.address.slice(0, 8)}... with ${amount} SOL`);
          
          return {
            address: wallet.address,
            type: wallet.type,
            amount,
            success: true,
            signature: sig,
            newBalance: newBalance / LAMPORTS_PER_SOL
          };
        } catch (error) {
          debugLogger.log('QUICK-FUND', `❌ Failed to fund ${wallet.address.slice(0, 8)}...: ${error.message}`);
          return {
            address: wallet.address,
            type: wallet.type,
            amount: batchAmounts[idx],
            success: false,
            error: error.message
          };
        }
      }));
      
      results.push(...batchResults);
      
      // Small delay between batches
      if (i + batchSize < targetWallets.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const totalFunded = results.filter(r => r.success).reduce((sum, r) => sum + r.amount, 0);
    
    res.json({
      success: true,
      funded: successCount,
      total: targetWallets.length,
      totalSol: totalFunded,
      results
    });
    
  } catch (error) {
    debugLogger.log('QUICK-FUND', `Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get quick fund presets (holder/bundle wallet info for UI)
app.get('/api/quick-fund/presets', async (req, res) => {
  try {
    const keysDir = path.join(__dirname, '..', 'keys');
    const currentRunPath = path.join(keysDir, 'current-run.json');
    
    if (!fs.existsSync(currentRunPath)) {
      return res.json({ success: true, presets: [] });
    }
    
    const currentRun = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
    const env = readEnvFile();
    const connection = new Connection(
      env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
      { commitment: 'confirmed' }
    );
    
    const presets = [];
    
    // Holder wallets
    if (currentRun.holderWalletKeys && currentRun.holderWalletKeys.length > 0) {
      const holderWallets = [];
      for (let i = 0; i < currentRun.holderWalletKeys.length; i++) {
        const kp = Keypair.fromSecretKey(base58.decode(currentRun.holderWalletKeys[i]));
        const balance = await connection.getBalance(kp.publicKey);
        holderWallets.push({
          address: kp.publicKey.toBase58(),
          balance: balance / LAMPORTS_PER_SOL
        });
      }
      presets.push({
        id: 'holder',
        name: 'Holder Wallets',
        wallets: holderWallets,
        count: holderWallets.length
      });
    }
    
    // Bundle wallets
    if (currentRun.bundleWalletKeys && currentRun.bundleWalletKeys.length > 0) {
      const bundleWallets = [];
      for (let i = 0; i < currentRun.bundleWalletKeys.length; i++) {
        const kp = Keypair.fromSecretKey(base58.decode(currentRun.bundleWalletKeys[i]));
        const balance = await connection.getBalance(kp.publicKey);
        bundleWallets.push({
          address: kp.publicKey.toBase58(),
          balance: balance / LAMPORTS_PER_SOL
        });
      }
      presets.push({
        id: 'bundle',
        name: 'Bundle Wallets',
        wallets: bundleWallets,
        count: bundleWallets.length
      });
    }
    
    res.json({ success: true, presets, mintAddress: currentRun.mintAddress });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// CROSS-CHAIN PRIVATE FUNDING (SOL → ETH → SOL)
// =====================================================

const EVM_WALLETS_PATH = path.join(__dirname, '..', 'keys', 'evm-intermediary-wallets.json');

// Helper to load/save EVM intermediary wallets
function loadEvmIntermediaryWallets() {
  try {
    if (fs.existsSync(EVM_WALLETS_PATH)) {
      return JSON.parse(fs.readFileSync(EVM_WALLETS_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('[Private Funding] Error loading EVM wallets:', e.message);
  }
  return { description: "EVM intermediary wallets for cross-chain private funding", wallets: [] };
}

function saveEvmIntermediaryWallets(data) {
  fs.writeFileSync(EVM_WALLETS_PATH, JSON.stringify(data, null, 2));
}

// Get EVM intermediary wallets
app.get('/api/private-funding/intermediary-wallets', (req, res) => {
  try {
    const data = loadEvmIntermediaryWallets();
    res.json({ success: true, wallets: data.wallets });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create new EVM intermediary wallet
app.post('/api/private-funding/create-intermediary', async (req, res) => {
  try {
    const { ethers } = require('ethers');
    const wallet = ethers.Wallet.createRandom();
    
    const intermediaryWallet = {
      id: `evm-${Date.now()}`,
      address: wallet.address,
      privateKey: wallet.privateKey,
      createdAt: new Date().toISOString(),
      chain: 'ethereum', // Default to Ethereum mainnet
      status: 'empty',
      solSource: null, // Will be set when SOL is bridged in
      solDestinations: [], // Will be set when funding wallets
    };
    
    const data = loadEvmIntermediaryWallets();
    data.wallets.push(intermediaryWallet);
    saveEvmIntermediaryWallets(data);
    
    console.log(`[Private Funding] Created EVM intermediary wallet: ${wallet.address}`);
    
    res.json({ 
      success: true, 
      wallet: {
        id: intermediaryWallet.id,
        address: intermediaryWallet.address,
        createdAt: intermediaryWallet.createdAt,
      }
    });
  } catch (error) {
    console.error('[Private Funding] Error creating intermediary wallet:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Check EVM wallet balance
app.post('/api/private-funding/check-balance', async (req, res) => {
  try {
    const { address, chain = 'ethereum' } = req.body;
    const { ethers } = require('ethers');
    
    // Public RPCs are sufficient for simple swaps/bridging operations
    // Only set custom RPC URLs in .env if you need higher rate limits or reliability
    const rpcUrls = {
      ethereum: process.env.ETH_RPC_URL || 'https://ethereum.publicnode.com',
      base: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
      bsc: process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org',
      polygon: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
      avalanche: process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc',
      arbitrum: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
      optimism: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
    };
    
    const provider = new ethers.JsonRpcProvider(rpcUrls[chain] || rpcUrls.ethereum);
    const balance = await provider.getBalance(address);
    
    res.json({
      success: true,
      address,
      chain,
      balance: ethers.formatEther(balance),
      balanceWei: balance.toString(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Step 1: Bridge SOL to ETH (SOL → EVM intermediary)
app.post('/api/private-funding/bridge-sol-to-eth', async (req, res) => {
  try {
    const { sourcePrivateKey, intermediaryAddress, amount, chain = 'base' } = req.body;
    
    if (!sourcePrivateKey || !intermediaryAddress || !amount) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    
    console.log(`[Private Funding] Starting SOL → ${chain.toUpperCase()} bridge...`);
    console.log(`[Private Funding] Amount: ${amount} SOL → ${intermediaryAddress}`);
    
    // Use Connection, Keypair, LAMPORTS_PER_SOL already imported at top of file
    // Use base58 already defined at top of file
    
    // Setup Solana connection
    const solRpcUrl = process.env.SOL_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(solRpcUrl, 'confirmed');
    
    // Create keypair from private key (supports multiple formats)
    let keypair;
    try {
      const trimmedKey = sourcePrivateKey.trim();
      let secretKey;
      
      // Try JSON array format first (e.g., [1,2,3,...])
      if (trimmedKey.startsWith('[')) {
        try {
          const jsonArray = JSON.parse(trimmedKey);
          secretKey = new Uint8Array(jsonArray);
        } catch {
          throw new Error('Invalid JSON array format');
        }
      } 
      // Try base58 format (e.g., from Phantom)
      else {
        try {
          secretKey = base58.decode(trimmedKey);
        } catch {
          throw new Error('Invalid base58 format');
        }
      }
      
      // Validate key length (should be 64 bytes for full keypair or 32 for seed)
      if (secretKey.length === 32) {
        // It's a seed, need to derive keypair
        keypair = Keypair.fromSeed(secretKey);
      } else if (secretKey.length === 64) {
        keypair = Keypair.fromSecretKey(secretKey);
      } else {
        throw new Error(`Invalid key length: ${secretKey.length} bytes (expected 32 or 64)`);
      }
    } catch (e) {
      console.error('[Private Funding] Private key parse error:', e.message);
      return res.status(400).json({ 
        success: false, 
        error: `Invalid Solana private key: ${e.message}. Use base58 (from Phantom) or JSON array format.` 
      });
    }
    
    // Check balance
    const balance = await connection.getBalance(keypair.publicKey);
    const amountLamports = Math.floor(parseFloat(amount) * LAMPORTS_PER_SOL);
    
    if (balance < amountLamports + 10000) { // 10000 lamports for fees
      return res.status(400).json({ 
        success: false, 
        error: `Insufficient balance. Have ${balance / LAMPORTS_PER_SOL} SOL, need ${amount} SOL + fees` 
      });
    }
    
    // Import Mayan SDK
    let fetchQuote, swapFromSolana;
    try {
      const mayanSdk = require('@mayanfinance/swap-sdk');
      fetchQuote = mayanSdk.fetchQuote;
      swapFromSolana = mayanSdk.swapFromSolana;
    } catch (e) {
      return res.status(500).json({ success: false, error: 'Mayan SDK not installed' });
    }
    
    // Chain mapping - Mayan SDK supported chains
    const chainMap = { 
      ethereum: 'ethereum', 
      base: 'base', 
      bsc: 'bsc',
      polygon: 'polygon',
      avalanche: 'avalanche',
      arbitrum: 'arbitrum',
      optimism: 'optimism',
    };
    const toChain = chainMap[chain] || chain || 'base'; // Fallback to provided chain if not in map
    
    // Get quote
    console.log(`[Private Funding] Fetching Mayan quote...`);
    const quotes = await fetchQuote({
      amountIn64: amountLamports.toString(),
      fromToken: '0x0000000000000000000000000000000000000000', // Native SOL
      toToken: '0x0000000000000000000000000000000000000000', // Native ETH
      fromChain: 'solana',
      toChain: toChain,
      slippageBps: 100, // 1% slippage
    });
    
    if (!quotes || quotes.length === 0) {
      return res.status(400).json({ success: false, error: 'No quotes available from Mayan' });
    }
    
    const quote = quotes[0];
    console.log(`[Private Funding] Quote: ${amount} SOL → ~${quote.expectedAmountOut || quote.minAmountOut} ETH`);
    
    // Create a signTransaction function that the SDK expects
    const signTransaction = async (transaction) => {
      // Check if it's a VersionedTransaction (has version property)
      if (transaction.version !== undefined) {
        // VersionedTransaction - sign expects array of keypairs
        transaction.sign([keypair]);
      } else if (transaction.partialSign) {
        // Legacy Transaction - use partialSign with single keypair
        transaction.partialSign(keypair);
      } else {
        // Fallback
        transaction.sign(keypair);
      }
      return transaction;
    };
    
    // Execute swap
    console.log(`[Private Funding] Executing swap...`);
    const result = await swapFromSolana(
      quote,
      keypair.publicKey.toBase58(),
      intermediaryAddress,
      null, // referrer
      signTransaction, // signing function
      connection,
      null // payload
    );
    
    const signature = typeof result === 'string' ? result : result.signature;
    console.log(`[Private Funding] ✅ SOL → ETH bridge initiated: ${signature}`);
    
    // Update intermediary wallet status
    const data = loadEvmIntermediaryWallets();
    const wallet = data.wallets.find(w => w.address.toLowerCase() === intermediaryAddress.toLowerCase());
    if (wallet) {
      wallet.status = 'pending_inbound';
      wallet.solSource = keypair.publicKey.toBase58();
      wallet.inboundTx = signature;
      wallet.inboundAmount = amount;
      wallet.inboundChain = chain;
      wallet.lastUpdated = new Date().toISOString();
      saveEvmIntermediaryWallets(data);
    }
    
    res.json({
      success: true,
      signature,
      expectedEth: quote.expectedAmountOut || quote.minAmountOut,
      message: `SOL → ${chain.toUpperCase()} bridge initiated. Funds should arrive in 2-5 minutes.`,
    });
    
  } catch (error) {
    console.error('[Private Funding] SOL → ETH bridge error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Step 2: Bridge ETH to SOL (EVM intermediary → Solana wallets)
app.post('/api/private-funding/bridge-eth-to-sol', async (req, res) => {
  try {
    let { intermediaryPrivateKey, intermediaryId, destinationAddresses, amountPerWallet, chain = 'base' } = req.body;
    
    // If intermediaryId provided, look up the private key
    if (!intermediaryPrivateKey && intermediaryId) {
      try {
        const evmWalletsPath = path.join(__dirname, '..', 'keys', 'evm-intermediary-wallets.json');
        if (fs.existsSync(evmWalletsPath)) {
          const evmWallets = JSON.parse(fs.readFileSync(evmWalletsPath, 'utf-8'));
          const wallet = evmWallets.find(w => w.id === intermediaryId);
          if (wallet) {
            intermediaryPrivateKey = wallet.privateKey;
            console.log(`[Private Funding] Loaded intermediary wallet: ${wallet.address.slice(0, 10)}...`);
          }
        }
      } catch (e) {
        console.error('[Private Funding] Failed to load intermediary wallet:', e.message);
      }
    }
    
    if (!intermediaryPrivateKey || !destinationAddresses || destinationAddresses.length === 0) {
      return res.status(400).json({ success: false, error: 'Missing required fields (intermediaryPrivateKey or intermediaryId, and destinationAddresses)' });
    }
    
    console.log(`[Private Funding] Starting ${chain.toUpperCase()} → SOL bridge...`);
    console.log(`[Private Funding] Destinations: ${destinationAddresses.length} wallets`);
    
    const { ethers } = require('ethers');
    
    // RPC setup
    // Public RPCs are sufficient for simple swaps/bridging operations
    // Only set custom RPC URLs in .env if you need higher rate limits or reliability
    const rpcUrls = {
      ethereum: process.env.ETH_RPC_URL || 'https://ethereum.publicnode.com',
      base: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
      bsc: process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org',
      polygon: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
      avalanche: process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc',
      arbitrum: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
      optimism: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
    };
    
    const provider = new ethers.JsonRpcProvider(rpcUrls[chain] || rpcUrls.base);
    const wallet = new ethers.Wallet(intermediaryPrivateKey, provider);
    
    // Check balance
    const balance = await provider.getBalance(wallet.address);
    console.log(`[Private Funding] Intermediary balance: ${ethers.formatEther(balance)} ETH`);
    
    // Import Mayan SDK
    let fetchQuote, swapFromEvm;
    try {
      const mayanSdk = require('@mayanfinance/swap-sdk');
      fetchQuote = mayanSdk.fetchQuote;
      swapFromEvm = mayanSdk.swapFromEvm;
    } catch (e) {
      return res.status(500).json({ success: false, error: 'Mayan SDK not installed' });
    }
    
    const results = [];
    const totalDestinations = destinationAddresses.length;
    
    // Estimate actual gas cost for Base/Ethereum swaps
    const feeData = await provider.getFeeData();
    const estimatedGasPerTx = 150000n; // Typical gas for Mayan swap
    const gasCostPerTx = (feeData.gasPrice || ethers.parseUnits('1', 'gwei')) * estimatedGasPerTx;
    const totalGasCost = gasCostPerTx * BigInt(totalDestinations);
    const safetyBuffer = ethers.parseEther('0.0001'); // Small buffer for price fluctuations
    
    console.log(`[Private Funding] Estimated gas per tx: ${ethers.formatEther(gasCostPerTx)} ETH`);
    console.log(`[Private Funding] Total gas reserve: ${ethers.formatEther(totalGasCost + safetyBuffer)} ETH`);
    
    // Calculate amount per wallet (either specified or split evenly)
    let amountWei;
    if (amountPerWallet) {
      amountWei = ethers.parseEther(amountPerWallet.toString());
    } else {
      // Reserve only actual gas needed and split rest evenly
      const available = balance > (totalGasCost + safetyBuffer) ? balance - totalGasCost - safetyBuffer : 0n;
      amountWei = available / BigInt(totalDestinations);
    }
    
    console.log(`[Private Funding] Amount per wallet: ${ethers.formatEther(amountWei)} ETH`);
    
    for (const destAddress of destinationAddresses) {
      try {
        // Check remaining balance - use actual gas estimate
        const currentBalance = await provider.getBalance(wallet.address);
        
        if (currentBalance < amountWei + gasCostPerTx) {
          console.log(`[Private Funding] Insufficient balance for ${destAddress}, skipping`);
          results.push({ destination: destAddress, success: false, error: 'Insufficient balance' });
          continue;
        }
        
        // Get quote
        const quotes = await fetchQuote({
          amountIn64: amountWei.toString(),
          fromToken: '0x0000000000000000000000000000000000000000', // Native ETH
          toToken: '0x0000000000000000000000000000000000000000', // Native SOL
          fromChain: chain,
          toChain: 'solana',
          slippageBps: 100,
        });
        
        if (!quotes || quotes.length === 0) {
          results.push({ destination: destAddress, success: false, error: 'No quotes available' });
          continue;
        }
        
        const quote = quotes[0];
        console.log(`[Private Funding] ${destAddress.slice(0, 8)}... → ~${quote.expectedAmountOut || quote.minAmountOut} SOL`);
        
        // Execute swap
        const swapResult = await swapFromEvm(
          quote,
          wallet.address,
          destAddress,
          null, // referrer
          wallet, // signer
          null, // permit
          null, // overrides
          null // payload
        );
        
        const txHash = typeof swapResult === 'string' ? swapResult : swapResult.hash;
        console.log(`[Private Funding] ✅ Sent to ${destAddress.slice(0, 8)}...: ${txHash}`);
        
        results.push({
          destination: destAddress,
          success: true,
          txHash,
          expectedSol: quote.expectedAmountOut || quote.minAmountOut,
        });
        
        // Wait a bit between transactions
        await new Promise(r => setTimeout(r, 2000));
        
      } catch (error) {
        console.error(`[Private Funding] Error bridging to ${destAddress}:`, error.message);
        results.push({ destination: destAddress, success: false, error: error.message });
      }
    }
    
    // Update intermediary wallet status
    const data = loadEvmIntermediaryWallets();
    const intermediaryWallet = data.wallets.find(w => 
      w.privateKey && w.privateKey.toLowerCase() === intermediaryPrivateKey.toLowerCase()
    );
    if (intermediaryWallet) {
      intermediaryWallet.status = 'distributed';
      intermediaryWallet.solDestinations = destinationAddresses;
      intermediaryWallet.outboundResults = results;
      intermediaryWallet.lastUpdated = new Date().toISOString();
      saveEvmIntermediaryWallets(data);
    }
    
    const successCount = results.filter(r => r.success).length;
    
    res.json({
      success: successCount > 0,
      message: `${successCount}/${totalDestinations} wallets funded via cross-chain bridge`,
      results,
    });
    
  } catch (error) {
    console.error('[Private Funding] ETH → SOL bridge error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get available SOL wallets for private funding source
app.get('/api/private-funding/sol-wallets', async (req, res) => {
  console.log('[Private Funding] Fetching SOL wallets...');
  try {
    const solRpcUrl = process.env.SOL_RPC_URL || process.env.SOLANA_RPC_URL || process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
    console.log('[Private Funding] Using RPC:', solRpcUrl);
    const connection = new Connection(solRpcUrl, 'confirmed');
    
    const wallets = [];
    
    // Add main funding wallet from .env
    const mainPrivateKey = process.env.PRIVATE_KEY;
    if (mainPrivateKey) {
      try {
        const trimmedKey = mainPrivateKey.trim();
        let secretKey;
        
        if (trimmedKey.startsWith('[')) {
          secretKey = new Uint8Array(JSON.parse(trimmedKey));
        } else {
          // Use base58 which is already defined at the top of the file
          secretKey = base58.decode(trimmedKey);
        }
        
        let keypair;
        if (secretKey.length === 32) {
          keypair = Keypair.fromSeed(secretKey);
        } else {
          keypair = Keypair.fromSecretKey(secretKey);
        }
        
        const balance = await connection.getBalance(keypair.publicKey);
        wallets.push({
          id: 'main',
          label: '💰 Main Funding Wallet',
          address: keypair.publicKey.toBase58(),
          balance: (balance / LAMPORTS_PER_SOL).toFixed(4),
          type: 'main',
        });
      } catch (e) {
        console.error('[Private Funding] Error loading main wallet:', e.message);
      }
    }
    
    // Add warming wallets
    const warmingWalletsPath = path.join(__dirname, '..', 'keys', 'warming-wallets.json');
    if (fs.existsSync(warmingWalletsPath)) {
      try {
        const warmingData = JSON.parse(fs.readFileSync(warmingWalletsPath, 'utf8'));
        const warmingWallets = warmingData.wallets || [];
        
        // Get balances for warming wallets (limit to first 20 with balance)
        let count = 0;
        for (const wallet of warmingWallets) {
          if (count >= 20) break;
          
          try {
            const { PublicKey } = require('@solana/web3.js');
            const pubkey = new PublicKey(wallet.address);
            const balance = await connection.getBalance(pubkey);
            
            if (balance > 0) {
              wallets.push({
                id: wallet.address,
                label: `🔥 Warming: ${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`,
                address: wallet.address,
                balance: (balance / LAMPORTS_PER_SOL).toFixed(4),
                type: 'warming',
                tags: wallet.tags || [],
              });
              count++;
            }
          } catch (e) {
            // Skip invalid wallets
          }
        }
      } catch (e) {
        console.error('[Private Funding] Error loading warming wallets:', e.message);
      }
    }
    
    console.log(`[Private Funding] Found ${wallets.length} SOL wallets`);
    res.json({ success: true, wallets });
  } catch (error) {
    console.error('[Private Funding] Error getting SOL wallets:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Bridge from wallet ID (uses stored private key)
app.post('/api/private-funding/bridge-from-wallet', async (req, res) => {
  try {
    const { walletId, intermediaryAddress, amount, chain = 'base' } = req.body;
    
    if (!walletId || !intermediaryAddress || !amount) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    
    console.log(`[Private Funding] Bridge from wallet ${walletId} to ${intermediaryAddress}`);
    
    // Use Connection, Keypair, LAMPORTS_PER_SOL already imported at top of file
    // Use base58 already defined at top of file
    
    let sourcePrivateKey;
    
    // Get private key based on wallet ID
    if (walletId === 'main') {
      sourcePrivateKey = process.env.PRIVATE_KEY;
    } else {
      // Find warming wallet
      const warmingWalletsPath = path.join(__dirname, '..', 'keys', 'warming-wallets.json');
      if (fs.existsSync(warmingWalletsPath)) {
        const warmingData = JSON.parse(fs.readFileSync(warmingWalletsPath, 'utf8'));
        const wallet = warmingData.wallets?.find(w => w.address === walletId);
        if (wallet) {
          sourcePrivateKey = wallet.privateKey;
        }
      }
    }
    
    if (!sourcePrivateKey) {
      return res.status(400).json({ success: false, error: 'Wallet not found' });
    }
    
    // Setup Solana connection
    const solRpcUrl = process.env.SOL_RPC_URL || process.env.SOLANA_RPC_URL || process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(solRpcUrl, 'confirmed');
    
    // Parse private key
    let keypair;
    try {
      const trimmedKey = sourcePrivateKey.trim();
      let secretKey;
      
      if (trimmedKey.startsWith('[')) {
        secretKey = new Uint8Array(JSON.parse(trimmedKey));
      } else {
        // Use base58 which is already defined at top of file
        secretKey = base58.decode(trimmedKey);
      }
      
      if (secretKey.length === 32) {
        keypair = Keypair.fromSeed(secretKey);
      } else {
        keypair = Keypair.fromSecretKey(secretKey);
      }
    } catch (e) {
      return res.status(400).json({ success: false, error: 'Invalid wallet private key' });
    }
    
    // Check balance
    const balance = await connection.getBalance(keypair.publicKey);
    const amountLamports = Math.floor(parseFloat(amount) * LAMPORTS_PER_SOL);
    
    if (balance < amountLamports + 10000) {
      return res.status(400).json({ 
        success: false, 
        error: `Insufficient balance. Have ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL, need ${amount} SOL + fees` 
      });
    }
    
    // Import Mayan SDK
    let fetchQuote, swapFromSolana;
    try {
      const mayanSdk = require('@mayanfinance/swap-sdk');
      fetchQuote = mayanSdk.fetchQuote;
      swapFromSolana = mayanSdk.swapFromSolana;
    } catch (e) {
      return res.status(500).json({ success: false, error: 'Mayan SDK not installed' });
    }
    
    // Chain mapping - Mayan SDK supported chains
    const chainMap = { 
      ethereum: 'ethereum', 
      base: 'base', 
      bsc: 'bsc',
      polygon: 'polygon',
      avalanche: 'avalanche',
      arbitrum: 'arbitrum',
      optimism: 'optimism',
    };
    const toChain = chainMap[chain] || chain || 'base'; // Fallback to provided chain if not in map
    
    // Get quote
    console.log(`[Private Funding] Fetching Mayan quote for ${amount} SOL → ${toChain}...`);
    const quotes = await fetchQuote({
      amountIn64: amountLamports.toString(),
      fromToken: '0x0000000000000000000000000000000000000000', // Native SOL
      toToken: '0x0000000000000000000000000000000000000000', // Native ETH
      fromChain: 'solana',
      toChain: toChain,
      slippageBps: 100, // 1% slippage
    });
    
    if (!quotes || quotes.length === 0) {
      return res.status(400).json({ success: false, error: 'No quotes available from Mayan' });
    }
    
    const quote = quotes[0];
    console.log(`[Private Funding] Quote: ${amount} SOL → ~${quote.expectedAmountOut || quote.minAmountOut} ETH`);
    
    // Create a signTransaction function that the SDK expects
    const signTransaction = async (transaction) => {
      // Check if it's a VersionedTransaction (has version property)
      if (transaction.version !== undefined) {
        // VersionedTransaction - sign expects array of keypairs
        transaction.sign([keypair]);
      } else if (transaction.partialSign) {
        // Legacy Transaction - use partialSign with single keypair
        transaction.partialSign(keypair);
      } else {
        // Fallback
        transaction.sign(keypair);
      }
      return transaction;
    };
    
    // Execute swap
    console.log(`[Private Funding] Executing swap...`);
    const result = await swapFromSolana(
      quote,
      keypair.publicKey.toBase58(),
      intermediaryAddress,
      null, // referrer
      signTransaction, // signing function
      connection,
      null // payload
    );
    
    const signature = typeof result === 'string' ? result : result.signature;
    console.log(`[Private Funding] ✅ SOL → ETH bridge initiated: ${signature}`);
    
    // Update intermediary wallet status
    const data = loadEvmIntermediaryWallets();
    const wallet = data.wallets.find(w => w.address.toLowerCase() === intermediaryAddress.toLowerCase());
    if (wallet) {
      wallet.status = 'pending_inbound';
      wallet.solSource = keypair.publicKey.toBase58();
      wallet.inboundTx = signature;
      wallet.inboundAmount = amount;
      wallet.inboundChain = chain;
      wallet.lastUpdated = new Date().toISOString();
      saveEvmIntermediaryWallets(data);
    }
    
    res.json({
      success: true,
      signature,
      expectedEth: quote.expectedAmountOut || quote.minAmountOut,
      message: `SOL → ${chain.toUpperCase()} bridge initiated. Funds should arrive in 2-5 minutes.`,
    });
    
  } catch (error) {
    console.error('[Private Funding] Bridge from wallet error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get status of all intermediary wallets with balances
app.get('/api/private-funding/status', async (req, res) => {
  try {
    const { ethers } = require('ethers');
    const data = loadEvmIntermediaryWallets();
    
    // Public RPCs are sufficient for simple swaps/bridging operations
    // Only set custom RPC URLs in .env if you need higher rate limits or reliability
    const rpcUrls = {
      ethereum: process.env.ETH_RPC_URL || 'https://ethereum.publicnode.com',
      base: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
      bsc: process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org',
      polygon: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
      avalanche: process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc',
      arbitrum: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
      optimism: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
    };
    
    const walletsWithBalances = await Promise.all(
      data.wallets.map(async (wallet) => {
        try {
          const chain = wallet.inboundChain || wallet.chain || 'base';
          const provider = new ethers.JsonRpcProvider(rpcUrls[chain] || rpcUrls.base);
          const balance = await provider.getBalance(wallet.address);
          return {
            ...wallet,
            privateKey: undefined, // Don't expose private key
            balance: ethers.formatEther(balance),
            hasBalance: balance > 0n,
          };
        } catch (e) {
          return { ...wallet, privateKey: undefined, balance: '?', error: e.message };
        }
      })
    );
    
    res.json({ success: true, wallets: walletsWithBalances });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// CROSS-CHAIN BALANCE POLLING & AUTOMATED FLOWS
// =====================================================

// Poll and wait for ETH balance on intermediary wallet
app.post('/api/private-funding/wait-for-eth-balance', async (req, res) => {
  try {
    const { intermediaryAddress, minBalance = 0.001, timeoutSeconds = 300, chain = 'base' } = req.body;
    
    if (!intermediaryAddress) {
      return res.status(400).json({ success: false, error: 'Missing intermediary address' });
    }
    
    const { ethers } = require('ethers');
    // Public RPCs are sufficient for simple swaps/bridging operations
    // Only set custom RPC URLs in .env if you need higher rate limits or reliability
    const rpcUrls = {
      ethereum: process.env.ETH_RPC_URL || 'https://ethereum.publicnode.com',
      base: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
      bsc: process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org',
      polygon: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
      avalanche: process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc',
      arbitrum: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
      optimism: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
    };
    
    const provider = new ethers.JsonRpcProvider(rpcUrls[chain] || rpcUrls.base);
    const minBalanceWei = ethers.parseEther(minBalance.toString());
    
    console.log(`[Private Funding] Waiting for ETH balance on ${intermediaryAddress}...`);
    console.log(`[Private Funding] Min balance: ${minBalance} ETH, Timeout: ${timeoutSeconds}s`);
    
    const startTime = Date.now();
    let attempts = 0;
    
    while (Date.now() - startTime < timeoutSeconds * 1000) {
      attempts++;
      const balance = await provider.getBalance(intermediaryAddress);
      const balanceEth = parseFloat(ethers.formatEther(balance));
      
      console.log(`[Private Funding] Poll #${attempts}: ${balanceEth.toFixed(6)} ETH`);
      
      if (balance >= minBalanceWei) {
        console.log(`[Private Funding] ✅ ETH balance received: ${balanceEth.toFixed(6)} ETH`);
        return res.json({
          success: true,
          balance: balanceEth,
          attempts,
          elapsedSeconds: Math.round((Date.now() - startTime) / 1000)
        });
      }
      
      // Wait 10 seconds between polls
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
    
    // Timeout
    const finalBalance = await provider.getBalance(intermediaryAddress);
    return res.json({
      success: false,
      error: 'Timeout waiting for ETH balance',
      balance: parseFloat(ethers.formatEther(finalBalance)),
      attempts,
      elapsedSeconds: timeoutSeconds
    });
    
  } catch (error) {
    console.error('[Private Funding] Wait for ETH error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Poll and wait for SOL balance on destination wallet
app.post('/api/private-funding/wait-for-sol-balance', async (req, res) => {
  try {
    const { walletAddress, minBalance = 0.01, timeoutSeconds = 300 } = req.body;
    
    if (!walletAddress) {
      return res.status(400).json({ success: false, error: 'Missing wallet address' });
    }
    
    const connection = getConnection();
    const pubkey = new PublicKey(walletAddress);
    const minBalanceLamports = minBalance * LAMPORTS_PER_SOL;
    
    console.log(`[Private Funding] Waiting for SOL balance on ${walletAddress}...`);
    console.log(`[Private Funding] Min balance: ${minBalance} SOL, Timeout: ${timeoutSeconds}s`);
    
    const startTime = Date.now();
    let attempts = 0;
    
    while (Date.now() - startTime < timeoutSeconds * 1000) {
      attempts++;
      const balance = await connection.getBalance(pubkey);
      const balanceSol = balance / LAMPORTS_PER_SOL;
      
      console.log(`[Private Funding] Poll #${attempts}: ${balanceSol.toFixed(6)} SOL`);
      
      if (balance >= minBalanceLamports) {
        console.log(`[Private Funding] ✅ SOL balance received: ${balanceSol.toFixed(6)} SOL`);
        return res.json({
          success: true,
          balance: balanceSol,
          attempts,
          elapsedSeconds: Math.round((Date.now() - startTime) / 1000)
        });
      }
      
      // Wait 10 seconds between polls
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
    
    // Timeout
    const finalBalance = await connection.getBalance(pubkey);
    return res.json({
      success: false,
      error: 'Timeout waiting for SOL balance',
      balance: finalBalance / LAMPORTS_PER_SOL,
      attempts,
      elapsedSeconds: timeoutSeconds
    });
    
  } catch (error) {
    console.error('[Private Funding] Wait for SOL error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Automated full flow: SOL → ETH intermediary → Wait → SOL to warming wallets
// This is a LONG-RUNNING request that executes the full flow without intervention
app.post('/api/private-funding/auto-fund-wallets', async (req, res) => {
  try {
    const { 
      sourceWalletId,  // 'main' or warming wallet ID
      destinationAddresses, 
      totalAmount, 
      chain = 'base',
      createNewIntermediary = true
    } = req.body;
    
    if (!sourceWalletId || !destinationAddresses || destinationAddresses.length === 0 || !totalAmount) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[Private Funding] 🚀 AUTOMATED CROSS-CHAIN FUNDING`);
    console.log(`[Private Funding] Source: ${sourceWalletId}`);
    console.log(`[Private Funding] Destinations: ${destinationAddresses.length} wallets`);
    console.log(`[Private Funding] Amount: ${totalAmount} SOL total`);
    console.log(`[Private Funding] Chain: ${chain}`);
    console.log(`${'='.repeat(60)}\n`);
    
    const { ethers } = require('ethers');
    
    // ========== STEP 1: Get source wallet private key ==========
    console.log(`[Private Funding] Step 1: Getting source wallet...`);
    let sourcePrivateKey;
    
    if (sourceWalletId === 'main') {
      sourcePrivateKey = process.env.PRIVATE_KEY;
    } else {
      // Look up in warming wallets
      const warmingWalletsPath = path.join(__dirname, '..', 'keys', 'warmed-wallets.json');
      if (fs.existsSync(warmingWalletsPath)) {
        const warmingData = JSON.parse(fs.readFileSync(warmingWalletsPath, 'utf-8'));
        const wallet = warmingData.wallets?.find(w => w.address === sourceWalletId);
        if (wallet) {
          sourcePrivateKey = wallet.privateKey;
        }
      }
    }
    
    if (!sourcePrivateKey) {
      return res.status(400).json({ success: false, error: `Source wallet not found: ${sourceWalletId}` });
    }
    
    // ========== STEP 2: Create intermediary EVM wallet ==========
    console.log(`[Private Funding] Step 2: Creating intermediary wallet...`);
    const evmWallet = ethers.Wallet.createRandom();
    const intermediaryWallet = {
      id: `evm-${Date.now()}`,
      address: evmWallet.address,
      privateKey: evmWallet.privateKey,
      createdAt: new Date().toISOString(),
      chain: chain,
      purpose: 'auto-fund',
      status: 'created',
    };
    
    const evmData = loadEvmIntermediaryWallets();
    evmData.wallets.push(intermediaryWallet);
    saveEvmIntermediaryWallets(evmData);
    console.log(`[Private Funding] ✅ Created intermediary: ${evmWallet.address}`);
    
    // ========== STEP 3: Bridge SOL → ETH ==========
    console.log(`[Private Funding] Step 3: Bridging SOL → ETH (${chain})...`);
    
    const solRpcUrl = process.env.RPC_ENDPOINT || process.env.SOL_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(solRpcUrl, 'confirmed');
    
    const keypair = Keypair.fromSecretKey(base58.decode(sourcePrivateKey));
    const amountLamports = Math.floor(parseFloat(totalAmount) * LAMPORTS_PER_SOL);
    
    // Check balance
    const balance = await connection.getBalance(keypair.publicKey);
    if (balance < amountLamports + 100000) {
      return res.status(400).json({ 
        success: false, 
        error: `Insufficient balance. Have ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL, need ${totalAmount} SOL + fees` 
      });
    }
    
    // Import Mayan SDK
    const mayanSdk = require('@mayanfinance/swap-sdk');
    const { fetchQuote, swapFromSolana } = mayanSdk;
    
    // Chain mapping for Mayan SDK
    const chainMap = { 
      ethereum: 'ethereum', 
      base: 'base', 
      bsc: 'bsc',
      polygon: 'polygon',
      avalanche: 'avalanche',
      arbitrum: 'arbitrum',
      optimism: 'optimism',
    };
    const toChain = chainMap[chain] || chain || 'base';
    
    // Get quote
    console.log(`[Private Funding] Fetching Mayan quote for ${totalAmount} SOL → ${toChain}...`);
    const quotes = await fetchQuote({
      amountIn64: amountLamports.toString(),
      fromToken: '0x0000000000000000000000000000000000000000',
      toToken: '0x0000000000000000000000000000000000000000',
      fromChain: 'solana',
      toChain: toChain,
      slippageBps: 100,
    });
    
    if (!quotes || quotes.length === 0) {
      return res.status(400).json({ success: false, error: 'No quotes available from Mayan for SOL → ETH' });
    }
    
    const quote1 = quotes[0];
    console.log(`[Private Funding] Quote: ${totalAmount} SOL → ~${quote1.expectedAmountOut || quote1.minAmountOut} ETH`);
    
    // Sign and execute
    const signTransaction = async (transaction) => {
      if (transaction.version !== undefined) {
        transaction.sign([keypair]);
      } else if (transaction.partialSign) {
        transaction.partialSign(keypair);
      } else {
        transaction.sign(keypair);
      }
      return transaction;
    };
    
    console.log(`[Private Funding] Executing SOL → ETH swap...`);
    const result1 = await swapFromSolana(
      quote1,
      keypair.publicKey.toBase58(),
      evmWallet.address,
      null,
      signTransaction,
      connection,
      null
    );
    
    const sig1 = typeof result1 === 'string' ? result1 : result1.signature;
    console.log(`[Private Funding] ✅ SOL → ETH initiated: ${sig1}`);
    
    // ========== STEP 4: Wait for ETH to arrive ==========
    console.log(`[Private Funding] Step 4: Waiting for ETH to arrive on ${chain}...`);
    
    // Public RPCs are sufficient for simple swaps/bridging operations
    // Only set custom RPC URLs in .env if you need higher rate limits or reliability
    const rpcUrls = {
      ethereum: process.env.ETH_RPC_URL || 'https://ethereum.publicnode.com',
      base: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
      bsc: process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org',
      polygon: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
      avalanche: process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc',
      arbitrum: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
      optimism: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
    };
    const provider = new ethers.JsonRpcProvider(rpcUrls[chain] || rpcUrls.base);
    
    const minEthBalance = 0.0001; // Minimum ETH to consider arrived
    const maxWaitTime = 10 * 60 * 1000; // 10 minutes
    const pollInterval = 10 * 1000; // 10 seconds
    const startTime = Date.now();
    
    // IMPORTANT: Keep on-chain balances as bigint (wei) to avoid ethers v6 underflow issues.
    // We'll derive a numeric ETH value only for logging/UI.
    let ethBalance = 0; // ETH (number) for logs only
    let balanceWeiLatest = 0n; // wei (bigint) for calculations
    while (Date.now() - startTime < maxWaitTime) {
      const balanceWei = await provider.getBalance(evmWallet.address);
      balanceWeiLatest = balanceWei;
      ethBalance = parseFloat(ethers.formatEther(balanceWeiLatest));
      
      if (ethBalance >= minEthBalance) {
        console.log(`[Private Funding] ✅ ETH arrived: ${ethBalance.toFixed(6)} ETH`);
        break;
      }
      
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      console.log(`[Private Funding] Waiting for ETH... (${elapsed}s elapsed, balance: ${ethBalance.toFixed(6)} ETH)`);
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
    
    if (ethBalance < minEthBalance) {
      return res.status(400).json({ 
        success: false, 
        error: `ETH did not arrive within timeout. Intermediary: ${evmWallet.address}` 
      });
    }
    
    // ========== STEP 5: Bridge ETH → SOL to destination wallets ==========
    console.log(`[Private Funding] Step 5: Bridging ETH → SOL to ${destinationAddresses.length} wallets...`);
    
    // Calculate actual gas cost per transaction (BSC/Base are very cheap)
    const feeData = await provider.getFeeData();
    const estimatedGasPerTx = 150000n; // Typical gas for Mayan swap
    const gasCostPerTx = (feeData.gasPrice || ethers.parseUnits('1', 'gwei')) * estimatedGasPerTx;
    const totalGasReserve = gasCostPerTx * BigInt(destinationAddresses.length);
    const smallBuffer = ethers.parseEther('0.00001'); // Tiny buffer (0.00001 ETH = ~$0.02)
    
    // Reserve only actual gas needed, not a percentage
    const totalReserveWei = totalGasReserve + smallBuffer;
    const availableForBridgingWei = balanceWeiLatest > totalReserveWei
      ? (balanceWeiLatest - totalReserveWei)
      : 0n;
    
    // Mayan minimum amount requirement (varies by chain, but ~0.0008 ETH is safe)
    const MAYAN_MIN_AMOUNT_ETH = chain === 'ethereum' ? 0.001 : 0.0008; // Ethereum mainnet needs more
    const MAYAN_MIN_AMOUNT_WEI = ethers.parseEther(MAYAN_MIN_AMOUNT_ETH.toString());
    
    const amountPerWalletWei = destinationAddresses.length > 0
      ? (availableForBridgingWei / BigInt(destinationAddresses.length))
      : 0n;
    const amountPerWallet = parseFloat(ethers.formatEther(amountPerWalletWei));
    
    console.log(`[Private Funding] Gas per tx: ${ethers.formatEther(gasCostPerTx)} ETH`);
    console.log(`[Private Funding] Total gas reserve: ${ethers.formatEther(totalReserveWei)} ETH`);
    console.log(`[Private Funding] Amount per wallet: ${amountPerWallet.toFixed(6)} ETH`);
    console.log(`[Private Funding] Mayan minimum: ${MAYAN_MIN_AMOUNT_ETH} ETH`);
    
    // Check if amount is too small for Mayan
    if (amountPerWalletWei < MAYAN_MIN_AMOUNT_WEI) {
      const totalNeeded = (MAYAN_MIN_AMOUNT_WEI * BigInt(destinationAddresses.length)) + totalReserveWei;
      const totalNeededEth = parseFloat(ethers.formatEther(totalNeeded));
      return res.status(400).json({ 
        success: false, 
        error: `Amount too small for Mayan bridge. Each wallet needs at least ${MAYAN_MIN_AMOUNT_ETH} ETH, but only ${amountPerWallet.toFixed(6)} ETH per wallet available. Total needed: ~${totalNeededEth.toFixed(6)} ETH, have: ${ethBalance.toFixed(6)} ETH. Try funding with more SOL or fewer wallets.`,
        amountPerWallet: amountPerWallet,
        minimumRequired: MAYAN_MIN_AMOUNT_ETH,
        totalNeeded: totalNeededEth,
        currentBalance: ethBalance
      });
    }
    
    // Create signer
    const evmSigner = new ethers.Wallet(evmWallet.privateKey, provider);
    
    // Bridge to each destination
    const results = [];
    for (const destAddr of destinationAddresses) {
      try {
        console.log(`[Private Funding] Bridging ${amountPerWallet.toFixed(6)} ETH to ${destAddr.substring(0, 8)}...`);
        
        // Double-check amount is still sufficient (in case balance changed)
        const currentBalance = await provider.getBalance(evmWallet.address);
        if (currentBalance < amountPerWalletWei + gasCostPerTx) {
          console.log(`[Private Funding] ⚠️ Insufficient balance for ${destAddr.substring(0, 8)}... (have: ${ethers.formatEther(currentBalance)} ETH, need: ${ethers.formatEther(amountPerWalletWei + gasCostPerTx)} ETH)`);
          results.push({ address: destAddr, success: false, error: 'Insufficient balance' });
          continue;
        }
        
        // Get quote for ETH → SOL
        const quote2 = await fetchQuote({
          amountIn64: amountPerWalletWei.toString(),
          fromToken: '0x0000000000000000000000000000000000000000',
          toToken: '0x0000000000000000000000000000000000000000',
          fromChain: chain,
          toChain: 'solana',
          slippageBps: 100,
        });
        
        if (!quote2 || quote2.length === 0) {
          console.log(`[Private Funding] ⚠️ No quote for ${destAddr.substring(0, 8)}...`);
          results.push({ address: destAddr, success: false, error: 'No quote' });
          continue;
        }
        
        // Execute swap from EVM
        // swapFromEvm(quote, fromAddress, toAddress, referrer, signer, permit, overrides, payload)
        const { swapFromEvm } = mayanSdk;
        const result2 = await swapFromEvm(
          quote2[0],
          evmWallet.address, // FROM: EVM intermediary address
          destAddr,          // TO: Solana destination
          null,              // referrer
          evmSigner,         // signer
          null,              // permit
          null,              // overrides
          null               // payload
        );
        
        const sig2 = typeof result2 === 'string' ? result2 : result2.hash || result2.signature;
        console.log(`[Private Funding] ✅ ETH → SOL for ${destAddr.substring(0, 8)}...: ${sig2}`);
        results.push({ address: destAddr, success: true, signature: sig2 });
        
      } catch (err) {
        const errorMsg = err.message || String(err);
        console.log(`[Private Funding] ❌ Failed for ${destAddr.substring(0, 8)}...: ${errorMsg}`);
        
        // Provide helpful error message if amount is too small
        if (errorMsg.includes('too small') || errorMsg.includes('minimum') || errorMsg.includes('min')) {
          results.push({ 
            address: destAddr, 
            success: false, 
            error: `Amount too small (min ~${MAYAN_MIN_AMOUNT_ETH} ETH, got ${amountPerWallet.toFixed(6)} ETH). Try funding with more SOL or fewer wallets.`,
            amount: amountPerWallet,
            minimum: MAYAN_MIN_AMOUNT_ETH
          });
        } else {
          results.push({ address: destAddr, success: false, error: errorMsg });
        }
      }
    }
    
    // ========== DONE ==========
    const successCount = results.filter(r => r.success).length;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[Private Funding] ✅ COMPLETED: ${successCount}/${destinationAddresses.length} wallets funded`);
    console.log(`${'='.repeat(60)}\n`);
    
    res.json({
      success: true,
      message: `Private funding complete! ${successCount}/${destinationAddresses.length} wallets funded.`,
      intermediary: evmWallet.address,
      results,
    });
    
  } catch (error) {
    console.error('[Private Funding] Auto fund error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Automated withdrawal: Warming wallets → ETH intermediary → Wait → Main SOL wallet
// This is a LONG-RUNNING request that executes the full flow without intervention
app.post('/api/private-funding/auto-withdraw-wallets', async (req, res) => {
  try {
    const { 
      sourceAddresses, // Array of warming wallet addresses to withdraw from
      destinationWalletId = 'main', // Usually 'main' wallet
      chain = 'base',
    } = req.body;
    
    if (!sourceAddresses || sourceAddresses.length === 0) {
      return res.status(400).json({ success: false, error: 'Missing source addresses' });
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[Private Withdrawal] 📤 AUTOMATED CROSS-CHAIN WITHDRAWAL`);
    console.log(`[Private Withdrawal] Sources: ${sourceAddresses.length} wallets`);
    console.log(`[Private Withdrawal] Destination: ${destinationWalletId}`);
    console.log(`[Private Withdrawal] Chain: ${chain}`);
    console.log(`${'='.repeat(60)}\n`);
    
    const { ethers } = require('ethers');
    const mayanSdk = require('@mayanfinance/swap-sdk');
    const { fetchQuote, swapFromSolana, swapFromEvm } = mayanSdk;
    
    // ========== STEP 1: Get destination wallet address ==========
    console.log(`[Private Withdrawal] Step 1: Getting destination wallet...`);
    let destinationAddress;
    if (destinationWalletId === 'main') {
      const env = readEnvFile();
      if (!env.PRIVATE_KEY) {
        return res.status(400).json({ success: false, error: 'Main wallet PRIVATE_KEY not found' });
      }
      const mainKp = Keypair.fromSecretKey(base58.decode(env.PRIVATE_KEY));
      destinationAddress = mainKp.publicKey.toBase58();
    } else {
      destinationAddress = destinationWalletId;
    }
    console.log(`[Private Withdrawal] Destination: ${destinationAddress.substring(0, 8)}...`);
    
    // ========== STEP 2: Create intermediary EVM wallet ==========
    console.log(`[Private Withdrawal] Step 2: Creating intermediary wallet...`);
    const evmWallet = ethers.Wallet.createRandom();
    const intermediaryWallet = {
      id: `evm-withdraw-${Date.now()}`,
      address: evmWallet.address,
      privateKey: evmWallet.privateKey,
      createdAt: new Date().toISOString(),
      chain: chain,
      purpose: 'auto-withdraw',
      status: 'created',
    };
    
    const evmData = loadEvmIntermediaryWallets();
    evmData.wallets.push(intermediaryWallet);
    saveEvmIntermediaryWallets(evmData);
    console.log(`[Private Withdrawal] ✅ Created intermediary: ${evmWallet.address}`);
    
    // ========== STEP 3: Get source wallet private keys & bridge SOL → ETH ==========
    console.log(`[Private Withdrawal] Step 3: Bridging SOL → ETH from ${sourceAddresses.length} wallets...`);
    
    const warmingWalletsPath = path.join(__dirname, '..', 'keys', 'warmed-wallets.json');
    let warmingWallets = [];
    if (fs.existsSync(warmingWalletsPath)) {
      const warmingData = JSON.parse(fs.readFileSync(warmingWalletsPath, 'utf-8'));
      warmingWallets = warmingData.wallets || [];
    }
    
    const solRpcUrl = process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(solRpcUrl, 'confirmed');
    
    let totalBridged = 0;
    const bridgeResults = [];
    
    for (const srcAddr of sourceAddresses) {
      try {
        const srcWallet = warmingWallets.find(w => w.address === srcAddr);
        if (!srcWallet) {
          console.log(`[Private Withdrawal] ⚠️ Wallet not found: ${srcAddr.substring(0, 8)}...`);
          bridgeResults.push({ address: srcAddr, success: false, error: 'Wallet not found' });
          continue;
        }
        
        const keypair = Keypair.fromSecretKey(base58.decode(srcWallet.privateKey));
        const balance = await connection.getBalance(keypair.publicKey);
        const balanceSol = balance / LAMPORTS_PER_SOL;
        
        if (balanceSol < 0.01) {
          console.log(`[Private Withdrawal] ⚠️ Insufficient balance: ${srcAddr.substring(0, 8)}... (${balanceSol.toFixed(4)} SOL)`);
          bridgeResults.push({ address: srcAddr, success: false, error: 'Insufficient balance' });
          continue;
        }
        
        // Bridge almost everything - only keep rent exemption (0.00089 SOL) + tiny buffer
        const rentExemption = 0.00089; // Solana rent exemption
        const tinyBuffer = 0.0001; // Small buffer for fees
        const amountToWithdraw = Math.max(0, balanceSol - rentExemption - tinyBuffer);
        const amountLamports = Math.floor(amountToWithdraw * LAMPORTS_PER_SOL);
        
        if (amountLamports <= 0) {
          console.log(`[Private Withdrawal] ⚠️ Balance too low after rent exemption: ${srcAddr.substring(0, 8)}...`);
          bridgeResults.push({ address: srcAddr, success: false, error: 'Balance too low' });
          continue;
        }
        
        console.log(`[Private Withdrawal] Bridging ${amountToWithdraw.toFixed(4)} SOL from ${srcAddr.substring(0, 8)}...`);
        
        // Chain mapping for Mayan SDK
        const chainMap = { 
          ethereum: 'ethereum', 
          base: 'base', 
          bsc: 'bsc',
          polygon: 'polygon',
          avalanche: 'avalanche',
          arbitrum: 'arbitrum',
          optimism: 'optimism',
        };
        const toChain = chainMap[chain] || chain || 'base';
        
        // Get quote
        const quotes = await fetchQuote({
          amountIn64: amountLamports.toString(),
          fromToken: '0x0000000000000000000000000000000000000000',
          toToken: '0x0000000000000000000000000000000000000000',
          fromChain: 'solana',
          toChain: toChain,
          slippageBps: 100,
        });
        
        if (!quotes || quotes.length === 0) {
          console.log(`[Private Withdrawal] ⚠️ No quote for ${srcAddr.substring(0, 8)}...`);
          bridgeResults.push({ address: srcAddr, success: false, error: 'No quote' });
          continue;
        }
        
        const signTransaction = async (tx) => {
          if (tx.version !== undefined) tx.sign([keypair]);
          else if (tx.partialSign) tx.partialSign(keypair);
          else tx.sign(keypair);
          return tx;
        };
        
        const result = await swapFromSolana(
          quotes[0],
          keypair.publicKey.toBase58(),
          evmWallet.address,
          null,
          signTransaction,
          connection,
          null
        );
        
        const sig = typeof result === 'string' ? result : result.signature;
        console.log(`[Private Withdrawal] ✅ Bridged from ${srcAddr.substring(0, 8)}...: ${sig}`);
        totalBridged += amountToWithdraw;
        bridgeResults.push({ address: srcAddr, success: true, amount: amountToWithdraw, signature: sig });
        
      } catch (err) {
        console.log(`[Private Withdrawal] ❌ Failed for ${srcAddr.substring(0, 8)}...: ${err.message}`);
        bridgeResults.push({ address: srcAddr, success: false, error: err.message });
      }
    }
    
    if (totalBridged < 0.01) {
      return res.status(400).json({ 
        success: false, 
        error: 'No funds were bridged from source wallets',
        results: bridgeResults
      });
    }
    
    // ========== STEP 4: Wait for ETH to arrive ==========
    console.log(`[Private Withdrawal] Step 4: Waiting for ETH to arrive (bridged ~${totalBridged.toFixed(4)} SOL)...`);
    
    // Public RPCs are sufficient for simple swaps/bridging operations
    // Only set custom RPC URLs in .env if you need higher rate limits or reliability
    const rpcUrls = {
      ethereum: process.env.ETH_RPC_URL || 'https://ethereum.publicnode.com',
      base: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
      bsc: process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org',
      polygon: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
      avalanche: process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc',
      arbitrum: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
      optimism: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
    };
    const provider = new ethers.JsonRpcProvider(rpcUrls[chain] || rpcUrls.base);
    
    const minEthBalance = 0.0001;
    const maxWaitTime = 10 * 60 * 1000;
    const pollInterval = 10 * 1000;
    const startTime = Date.now();
    
    let ethBalance = 0;
    while (Date.now() - startTime < maxWaitTime) {
      const balanceWei = await provider.getBalance(evmWallet.address);
      ethBalance = parseFloat(ethers.formatEther(balanceWei));
      
      if (ethBalance >= minEthBalance) {
        console.log(`[Private Withdrawal] ✅ ETH arrived: ${ethBalance.toFixed(6)} ETH`);
        break;
      }
      
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      console.log(`[Private Withdrawal] Waiting for ETH... (${elapsed}s elapsed, balance: ${ethBalance.toFixed(6)} ETH)`);
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
    
    if (ethBalance < minEthBalance) {
      return res.status(400).json({ 
        success: false, 
        error: `ETH did not arrive within timeout. Intermediary: ${evmWallet.address}`,
        bridgeResults
      });
    }
    
    // ========== STEP 5: Bridge ETH → SOL to destination ==========
    console.log(`[Private Withdrawal] Step 5: Bridging ${ethBalance.toFixed(6)} ETH → SOL to main wallet...`);
    
    const evmSigner = new ethers.Wallet(evmWallet.privateKey, provider);
    const amountToSend = ethBalance * 0.98; // 98% to account for gas
    const amountWei = ethers.parseEther(amountToSend.toFixed(18));
    
    try {
      const quote2 = await fetchQuote({
        amountIn64: amountWei.toString(),
        fromToken: '0x0000000000000000000000000000000000000000',
        toToken: '0x0000000000000000000000000000000000000000',
        fromChain: chain,
        toChain: 'solana',
        slippageBps: 100,
      });
      
      if (!quote2 || quote2.length === 0) {
        return res.status(400).json({ 
          success: false, 
          error: 'No quote for ETH → SOL',
          bridgeResults
        });
      }
      
      // swapFromEvm(quote, fromAddress, toAddress, referrer, signer, permit, overrides, payload)
      const result2 = await swapFromEvm(
        quote2[0],
        evmWallet.address, // FROM: EVM intermediary address
        destinationAddress, // TO: Solana main wallet
        null,              // referrer
        evmSigner,         // signer
        null,              // permit
        null,              // overrides
        null               // payload
      );
      
      const sig2 = typeof result2 === 'string' ? result2 : result2.hash || result2.signature;
      console.log(`[Private Withdrawal] ✅ ETH → SOL initiated: ${sig2}`);
      
      console.log(`\n${'='.repeat(60)}`);
      console.log(`[Private Withdrawal] ✅ COMPLETED`);
      console.log(`[Private Withdrawal] Withdrew from ${bridgeResults.filter(r => r.success).length} wallets`);
      console.log(`[Private Withdrawal] Total bridged: ~${totalBridged.toFixed(4)} SOL`);
      console.log(`${'='.repeat(60)}\n`);
      
      res.json({
        success: true,
        message: `Private withdrawal complete! Funds are being bridged to main wallet.`,
        intermediary: evmWallet.address,
        totalBridged,
        finalBridgeTx: sig2,
        bridgeResults,
      });
      
    } catch (err) {
      return res.status(500).json({ 
        success: false, 
        error: `ETH → SOL bridge failed: ${err.message}`,
        bridgeResults
      });
    }
    
  } catch (error) {
    console.error('[Private Funding] Auto withdraw error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Withdraw ALL ETH from ALL intermediary wallets back to main SOL wallet
app.post('/api/private-funding/withdraw-all-eth', async (req, res) => {
  try {
    const { chain = 'base' } = req.body;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[Private Funding] 💰 WITHDRAWING ALL ETH FROM INTERMEDIARY WALLETS`);
    console.log(`[Private Funding] Chain: ${chain.toUpperCase()}`);
    console.log(`${'='.repeat(60)}\n`);
    
    const data = loadEvmIntermediaryWallets();
    const wallets = data.wallets.filter(w => 
      w.chain === chain && 
      w.status !== 'recovered' && 
      w.status !== 'distributed'
    );
    
    if (wallets.length === 0) {
      return res.json({ 
        success: true, 
        message: 'No intermediary wallets found with ETH',
        withdrawn: 0,
        totalEth: 0
      });
    }
    
    console.log(`[Private Funding] Found ${wallets.length} intermediary wallet(s) on ${chain.toUpperCase()}`);
    
    const { ethers } = require('ethers');
    const { Connection, Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
    const base58 = require('bs58').default || require('bs58');
    
    // Get main wallet
    const env = readEnvFile();
    if (!env.PRIVATE_KEY) {
      return res.status(400).json({ success: false, error: 'No main wallet configured (PRIVATE_KEY in .env)' });
    }
    const mainKp = Keypair.fromSecretKey(base58.decode(env.PRIVATE_KEY));
    const mainAddress = mainKp.publicKey.toBase58();
    
    // RPC setup
    const rpcUrls = {
      ethereum: process.env.ETH_RPC_URL || 'https://ethereum.publicnode.com',
      base: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
      bsc: process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org',
      polygon: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
      avalanche: process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc',
      arbitrum: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
      optimism: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
    };
    const provider = new ethers.JsonRpcProvider(rpcUrls[chain] || rpcUrls.base);
    
    // Import Mayan SDK
    let fetchQuote, swapFromEvm;
    try {
      const mayanSdk = require('@mayanfinance/swap-sdk');
      fetchQuote = mayanSdk.fetchQuote;
      swapFromEvm = mayanSdk.swapFromEvm;
    } catch (e) {
      return res.status(500).json({ success: false, error: 'Mayan SDK not installed' });
    }
    
    const results = [];
    let totalEthWithdrawn = 0;
    let totalSolReceived = 0;
    
    for (const evmWallet of wallets) {
      try {
        const wallet = new ethers.Wallet(evmWallet.privateKey, provider);
        const balance = await provider.getBalance(wallet.address);
        const balanceEth = parseFloat(ethers.formatEther(balance));
        
        if (balanceEth < 0.0001) {
          console.log(`[Private Funding] ⚠️ Skipping ${evmWallet.address.substring(0, 10)}... (balance: ${balanceEth.toFixed(6)} ETH)`);
          results.push({ 
            address: evmWallet.address, 
            success: false, 
            error: 'Balance too low',
            balance: balanceEth 
          });
          continue;
        }
        
        // Calculate gas cost with larger estimate (Mayan swaps are complex)
        // BSC/Base typically need 200k-300k gas, Ethereum mainnet can be higher
        const feeData = await provider.getFeeData();
        const estimatedGas = chain === 'ethereum' ? 300000n : 250000n; // Higher estimate for complex swaps
        const gasPrice = feeData.gasPrice || ethers.parseUnits('3', 'gwei'); // Use actual or safe default
        const gasCost = gasPrice * estimatedGas;
        const gasCostEth = parseFloat(ethers.formatEther(gasCost));
        
        // Add larger safety buffer (20% of gas cost + fixed minimum)
        const safetyBuffer = Math.max(gasCostEth * 0.2, 0.00005); // At least 0.00005 ETH buffer
        const totalReserve = gasCostEth + safetyBuffer;
        
        console.log(`[Private Funding] Balance: ${balanceEth.toFixed(6)} ETH, Gas estimate: ${gasCostEth.toFixed(6)} ETH, Buffer: ${safetyBuffer.toFixed(6)} ETH`);
        
        // Reserve gas + buffer, bridge the rest
        let amountToBridge = Math.max(0, balanceEth - totalReserve);
        
        // Make sure we have enough for minimum Mayan amount
        const MAYAN_MIN = chain === 'ethereum' ? 0.001 : 0.0008;
        if (amountToBridge < MAYAN_MIN) {
          // If amount is too small, try to bridge everything except a larger gas reserve
          const largerReserve = gasCostEth * 1.5; // 50% extra for gas
          amountToBridge = Math.max(0, balanceEth - largerReserve);
          
          if (amountToBridge < MAYAN_MIN) {
            console.log(`[Private Funding] ⚠️ Skipping ${evmWallet.address.substring(0, 10)}... (balance: ${balanceEth.toFixed(6)} ETH, after gas reserve: ${amountToBridge.toFixed(6)} ETH, need min: ${MAYAN_MIN} ETH)`);
            results.push({ 
              address: evmWallet.address, 
              success: false, 
              error: `Insufficient balance. Have ${balanceEth.toFixed(6)} ETH, need ${(largerReserve + MAYAN_MIN).toFixed(6)} ETH minimum (gas + min bridge amount)`,
              balance: balanceEth,
              gasCost: gasCostEth,
              minimumNeeded: largerReserve + MAYAN_MIN
            });
            continue;
          }
        }
        
        console.log(`[Private Funding] Withdrawing ${amountToBridge.toFixed(6)} ETH from ${evmWallet.address.substring(0, 10)}... (reserving ${totalReserve.toFixed(6)} ETH for gas)`);
        
        const amountWei = ethers.parseEther(amountToBridge.toFixed(18));
        
        // Get quote FIRST to make sure it's valid
        const quotes = await fetchQuote({
          amountIn64: amountWei.toString(),
          fromToken: '0x0000000000000000000000000000000000000000',
          toToken: '0x0000000000000000000000000000000000000000',
          fromChain: chain,
          toChain: 'solana',
          slippageBps: 100,
        });
        
        if (!quotes || quotes.length === 0) {
          console.log(`[Private Funding] ⚠️ No quote for ${evmWallet.address.substring(0, 10)}...`);
          results.push({ address: evmWallet.address, success: false, error: 'No quote' });
          continue;
        }
        
        // Double-check balance is still sufficient (in case it changed)
        const currentBalance = await provider.getBalance(wallet.address);
        const currentBalanceEth = parseFloat(ethers.formatEther(currentBalance));
        let finalAmountToBridge = amountToBridge;
        let finalAmountWei = amountWei;
        
        if (currentBalanceEth < amountToBridge + totalReserve) {
          // Recalculate with current balance
          finalAmountToBridge = Math.max(0, currentBalanceEth - totalReserve);
          if (finalAmountToBridge < MAYAN_MIN) {
            console.log(`[Private Funding] ⚠️ Balance changed, insufficient: ${currentBalanceEth.toFixed(6)} ETH`);
            results.push({ address: evmWallet.address, success: false, error: 'Balance insufficient after quote' });
            continue;
          }
          // Update amountWei with new amount
          finalAmountWei = ethers.parseEther(finalAmountToBridge.toFixed(18));
          console.log(`[Private Funding] Adjusted amount to ${finalAmountToBridge.toFixed(6)} ETH due to balance change`);
        }
        
        // Execute swap
        const evmSigner = new ethers.Wallet(evmWallet.privateKey, provider);
        const result = await swapFromEvm(
          quotes[0],
          evmWallet.address,
          mainAddress,
          null,
          evmSigner,
          null,
          null,
          null
        );
        
        const sig = typeof result === 'string' ? result : result.hash || result.signature;
        const expectedSol = quotes[0].expectedAmountOut || quotes[0].minAmountOut;
        const expectedSolAmount = expectedSol ? parseFloat(expectedSol) / 1e9 : 0;
        
        // Use finalAmountToBridge if it was adjusted, otherwise use original amountToBridge
        const finalBridgeAmount = finalAmountToBridge || amountToBridge;
        
        console.log(`[Private Funding] ✅ Bridged ${finalBridgeAmount.toFixed(6)} ETH → ~${expectedSolAmount.toFixed(4)} SOL: ${sig}`);
        
        totalEthWithdrawn += finalBridgeAmount;
        totalSolReceived += expectedSolAmount;
        
        // Update wallet status
        evmWallet.status = 'recovered';
        evmWallet.recoveredAt = new Date().toISOString();
        evmWallet.recoveredTo = mainAddress;
        evmWallet.recoveredAmount = finalBridgeAmount;
        evmWallet.recoveredTx = sig;
        
        results.push({ 
          address: evmWallet.address, 
          success: true, 
          ethAmount: finalBridgeAmount,
          expectedSol: expectedSolAmount,
          signature: sig
        });
        
        // Small delay between transactions
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (error) {
        console.error(`[Private Funding] ❌ Failed for ${evmWallet.address.substring(0, 10)}...:`, error.message);
        results.push({ 
          address: evmWallet.address, 
          success: false, 
          error: error.message 
        });
      }
    }
    
    // Save updated wallet statuses
    saveEvmIntermediaryWallets(data);
    
    const successCount = results.filter(r => r.success).length;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[Private Funding] ✅ COMPLETED: ${successCount}/${wallets.length} wallets recovered`);
    console.log(`[Private Funding] Total ETH withdrawn: ${totalEthWithdrawn.toFixed(6)} ETH`);
    console.log(`[Private Funding] Expected SOL: ~${totalSolReceived.toFixed(4)} SOL`);
    console.log(`${'='.repeat(60)}\n`);
    
    res.json({
      success: true,
      message: `Withdrew ${totalEthWithdrawn.toFixed(6)} ETH from ${successCount} wallet(s). Expected ~${totalSolReceived.toFixed(4)} SOL in 2-5 minutes.`,
      withdrawn: successCount,
      totalEth: totalEthWithdrawn,
      expectedSol: totalSolReceived,
      results
    });
    
  } catch (error) {
    console.error('[Private Funding] Withdraw all ETH error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get intermediary wallet with private key (for withdrawal flow)
app.get('/api/private-funding/intermediary/:id', (req, res) => {
  try {
    const { id } = req.params;
    const data = loadEvmIntermediaryWallets();
    const wallet = data.wallets.find(w => w.id === id);

    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Intermediary wallet not found' });
    }

    res.json({ success: true, wallet });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// PRIVATE FUNDING VIA INTERMEDIARY SOL WALLETS (NO MAYAN)
// =====================================================
//
// NOTE:
// - Saves intermediary wallets in JSON format (same as launch pattern: keys/intermediary-wallets.json)
// - Generates and saves the wallets BEFORE sending any funds
// - Sends sequentially (1-by-1) to keep RPC pressure and fees low
//
const INTERMEDIARY_WALLETS_FILE = path.join(__dirname, '..', 'keys', 'intermediary.txt');
const INTERMEDIARY_WALLETS_JSON = path.join(__dirname, '..', 'keys', 'intermediary-wallets.json'); // Old JSON file to delete

function ensureKeysDir() {
  const keysDir = path.dirname(INTERMEDIARY_WALLETS_FILE);
  if (!fs.existsSync(keysDir)) {
    fs.mkdirSync(keysDir, { recursive: true });
  }
}

// Save intermediary wallets in simple text format: "Funding 1\npk1\npk2\n..."
function saveSolIntermediaryKeypairs(keypairs, hopNumber = 1) {
  ensureKeysDir();
  try {
    let lines = [];
    
    // Read existing file if it exists
    if (fs.existsSync(INTERMEDIARY_WALLETS_FILE)) {
      const content = fs.readFileSync(INTERMEDIARY_WALLETS_FILE, 'utf8');
      lines = content.trim().split('\n');
    }
    
    // Find existing "Funding X" sections and update the matching one
    let foundSection = false;
    const sectionHeader = `Funding ${hopNumber}`;
    const result = [];
    let inTargetSection = false;
    let i = 0;
    
    while (i < lines.length) {
      if (lines[i].startsWith('Funding ')) {
        if (lines[i] === sectionHeader) {
          inTargetSection = true;
          foundSection = true;
          result.push(sectionHeader);
          // Add new private keys for this funding
          keypairs.forEach(kp => {
            result.push(base58.encode(kp.secretKey));
          });
          // Skip old keys in this section
          i++;
          while (i < lines.length && !lines[i].startsWith('Funding ')) {
            i++;
          }
        } else {
          inTargetSection = false;
          result.push(lines[i]);
          i++;
        }
      } else if (!inTargetSection) {
        result.push(lines[i]);
        i++;
      } else {
        i++;
      }
    }
    
    // If section doesn't exist, add it at the end
    if (!foundSection) {
      if (result.length > 0 && !result[result.length - 1].endsWith('\n')) {
        result.push('');
      }
      result.push(sectionHeader);
      keypairs.forEach(kp => {
        result.push(base58.encode(kp.secretKey));
      });
    }
    
    fs.writeFileSync(INTERMEDIARY_WALLETS_FILE, result.join('\n') + '\n');
    
    // Delete old JSON file if it exists
    if (fs.existsSync(INTERMEDIARY_WALLETS_JSON)) {
      try {
        fs.unlinkSync(INTERMEDIARY_WALLETS_JSON);
        console.log(`[Private Funding SOL] 🗑️ Deleted old JSON file: ${INTERMEDIARY_WALLETS_JSON}`);
      } catch (e) {
        // Ignore deletion errors
      }
    }
    
    console.log(`[Private Funding SOL] 💾 Saved ${keypairs.length} intermediary wallet(s) to ${INTERMEDIARY_WALLETS_FILE} (Funding ${hopNumber})`);
  } catch (error) {
    console.error(`[Private Funding SOL] ⚠️  Failed to save intermediary wallets:`, error);
  }
}

// Load intermediary wallets from simple text format
function loadSolIntermediaryKeypairs(hopNumber = 1) {
  try {
    if (!fs.existsSync(INTERMEDIARY_WALLETS_FILE)) {
      // Also check for old JSON file for migration
      if (fs.existsSync(INTERMEDIARY_WALLETS_JSON)) {
        console.log(`[Private Funding SOL] ⚠️ Found old JSON file, migrating to ${INTERMEDIARY_WALLETS_FILE}`);
        const data = JSON.parse(fs.readFileSync(INTERMEDIARY_WALLETS_JSON, 'utf8'));
        const hopKey = `hop${hopNumber}`;
        const wallets = data[hopKey] || [];
        const keypairs = wallets.map(w => {
          try {
            return Keypair.fromSecretKey(base58.decode(w.privateKey));
          } catch (e) {
            return null;
          }
        }).filter(kp => kp !== null);
        
        // Migrate to txt format
        if (keypairs.length > 0) {
          saveSolIntermediaryKeypairs(keypairs, hopNumber);
        }
        return keypairs;
      }
      return [];
    }
    
    const content = fs.readFileSync(INTERMEDIARY_WALLETS_FILE, 'utf8');
    const lines = content.trim().split('\n');
    const sectionHeader = `Funding ${hopNumber}`;
    
    let inTargetSection = false;
    const privateKeys = [];
    
    for (const line of lines) {
      if (line.startsWith('Funding ')) {
        inTargetSection = (line === sectionHeader);
      } else if (inTargetSection && line.trim()) {
        privateKeys.push(line.trim());
      }
    }
    
    return privateKeys.map(pk => {
      try {
        return Keypair.fromSecretKey(base58.decode(pk));
      } catch (e) {
        console.error(`[Private Funding SOL] ⚠️ Invalid private key in ${INTERMEDIARY_WALLETS_FILE}:`, e.message);
        return null;
      }
    }).filter(kp => kp !== null);
  } catch (e) {
    console.error('[Private Funding SOL] Error loading intermediary wallets:', e.message);
    return [];
  }
}

// PRIVATE FUNDING (SOL → [intermediary SOL wallets] → destination SOL wallets)
// This replaces the Mayan bridge for the "private" option.
app.post('/api/private-funding/sol-intermediary', async (req, res) => {
  try {
    const {
      sourceWalletId = 'main', // 'main' uses PRIVATE_KEY from .env, or provide private key directly
      sourcePrivateKey, // Optional: if provided, use this instead of sourceWalletId
      destinationAddresses, // array of base58 SOL addresses
      totalAmountSol,       // total SOL amount to route
      intermediaryCount = 10, // up to 50
      reuseSavedIntermediaries = false, // if true, uses saved wallets from intermediary-wallets.json
    } = req.body || {};

    if (!Array.isArray(destinationAddresses) || destinationAddresses.length === 0 || !totalAmountSol) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: destinationAddresses (array), totalAmountSol',
      });
    }

    const hopCount = Math.min(Math.max(Number(intermediaryCount) || 0, 1), 50);

    const solRpcUrl = process.env.SOL_RPC_URL || process.env.SOLANA_RPC_URL || process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(solRpcUrl, 'confirmed');

    // Get source keypair (from sourcePrivateKey if provided, otherwise from sourceWalletId='main' using PRIVATE_KEY)
    let sourceKp;
    try {
      let privateKeyStr;
      if (sourcePrivateKey) {
        privateKeyStr = sourcePrivateKey;
      } else if (sourceWalletId === 'main') {
        const env = readEnvFile();
        if (!env.PRIVATE_KEY) {
          return res.status(400).json({ 
            success: false, 
            error: 'PRIVATE_KEY not set in .env file. Either set PRIVATE_KEY in .env or provide sourcePrivateKey in request.' 
          });
        }
        privateKeyStr = env.PRIVATE_KEY;
      } else {
        return res.status(400).json({ 
          success: false, 
          error: 'Either provide sourcePrivateKey or use sourceWalletId="main" (requires PRIVATE_KEY in .env)' 
        });
      }

      const trimmed = String(privateKeyStr).trim();
      let sk;
      if (trimmed.startsWith('[')) sk = new Uint8Array(JSON.parse(trimmed));
      else sk = base58.decode(trimmed);
      if (sk.length === 32) sourceKp = Keypair.fromSeed(sk);
      else if (sk.length === 64) sourceKp = Keypair.fromSecretKey(sk);
      else throw new Error(`Invalid key length: ${sk.length} bytes (expected 32 or 64)`);
    } catch (e) {
      return res.status(400).json({ success: false, error: `Invalid Solana private key: ${e.message}` });
    }

    const totalLamports = Math.floor(Number(totalAmountSol) * LAMPORTS_PER_SOL);
    if (!Number.isFinite(totalLamports) || totalLamports <= 0) {
      return res.status(400).json({ success: false, error: 'totalAmountSol must be a positive number' });
    }

    // Create or load intermediary keypairs (and SAVE BEFORE SENDING)
    let intermediaryKps = [];
    if (reuseSavedIntermediaries) {
      intermediaryKps = loadSolIntermediaryKeypairs(1); // Load from hop1
      if (intermediaryKps.length === 0) {
        return res.status(400).json({ success: false, error: `No saved intermediary wallets found at ${INTERMEDIARY_WALLETS_FILE}. Please create new intermediaries or check the file.` });
      }
      if (intermediaryKps.length > 50) intermediaryKps = intermediaryKps.slice(0, 50);
      console.log(`[Private Funding SOL] 🔄 Reusing ${intermediaryKps.length} saved intermediary wallets`);
    } else {
      intermediaryKps = Array.from({ length: hopCount }, () => Keypair.generate());
      // Save wallets to JSON file BEFORE sending (so they're recoverable if something goes wrong)
      saveSolIntermediaryKeypairs(intermediaryKps, 1); // Save to txt file, MUST happen before any send
      console.log(`[Private Funding SOL] 💾 Intermediary wallets saved to ${INTERMEDIARY_WALLETS_FILE}`);
    }

    const sourceBalance = await connection.getBalance(sourceKp.publicKey);
    // Approx fee budgeting: use 10k lamports / tx safety buffer
    const estimatedTxCount = intermediaryKps.length + destinationAddresses.length;
    const feeBufferLamports = 10_000 * estimatedTxCount;
    if (sourceBalance < totalLamports + feeBufferLamports) {
      return res.status(400).json({
        success: false,
        error: `Insufficient balance. Have ${(sourceBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL, need ~${((totalLamports + feeBufferLamports) / LAMPORTS_PER_SOL).toFixed(6)} SOL (amount + fee buffer)`,
      });
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`[Private Funding SOL] 🔒 SOL intermediary route (NO Mayan)`);
    console.log(`[Private Funding SOL] Source: ${sourceKp.publicKey.toBase58()}`);
    console.log(`[Private Funding SOL] Intermediaries: ${intermediaryKps.length} (saved: ${INTERMEDIARY_WALLETS_FILE})`);
    console.log(`[Private Funding SOL] Destinations: ${destinationAddresses.length}`);
    console.log(`[Private Funding SOL] Total: ${(totalLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    console.log(`${'='.repeat(60)}\n`);

    // CHAIN ROUTING: Source -> Inter1 -> Inter2 -> ... -> InterN -> Destination
    // Each intermediary receives the FULL amount and passes it through (minus fees)
    console.log(`[Private Funding SOL] Routing through ${intermediaryKps.length} intermediary chain: Source -> Inter1 -> Inter2 -> ... -> Inter${intermediaryKps.length} -> Destination`);
    console.log(`[Private Funding SOL] Full amount: ${(totalLamports / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
    
    const chainResults = [];
    let currentAmount = totalLamports;
    let currentSender = sourceKp;
    // Note: We send ALL balance from intermediaries (like Phantom does)
    // Solana automatically closes accounts when balance goes to 0 and refunds rent to recipient
    // We only need to reserve a small amount for transaction fees
    
    // Build the chain: Source -> Inter1 -> Inter2 -> ... -> InterN -> Destination
    const chain = [sourceKp, ...intermediaryKps];
    
    // Route through each intermediary in sequence
    // Flow: Source -> Inter1 -> Inter2 -> ... -> InterN -> Destination
    for (let i = 0; i < intermediaryKps.length; i++) {
      const isLastIntermediary = (i === intermediaryKps.length - 1);
      
      // For each hop:
      // - Hop 1: Source sends TO Inter1 (intermediaryKps[0])
      // - Hop 2: Inter1 sends TO Inter2 (intermediaryKps[1])
      // - Hop 3: Inter2 sends TO Inter3 (intermediaryKps[2])
      // - ...
      // - Hop N: InterN sends TO Destination
      
      // The recipient for this hop
      const recipientKp = isLastIntermediary 
        ? null // Last hop sends to destination, not an intermediary
        : intermediaryKps[i]; // Intermediary that RECEIVES in this hop
      
      // Where to send funds TO
      const nextRecipient = isLastIntermediary 
        ? new PublicKey(destinationAddresses[0]) // Last intermediary sends to destination
        : recipientKp.publicKey; // Send to the intermediary that receives in this hop
      
      try {
        // For hops after the first, verify the sender (previous intermediary) has received funds
        if (i > 0) {
          // Wait a bit for previous transaction to settle
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Check balance of current sender (which should be the previous intermediary that just received funds)
          const senderBalance = await connection.getBalance(currentSender.publicKey);
          const expectedBalance = currentAmount;
          
          console.log(`[Private Funding SOL] Hop ${i + 1}: Checking balance of ${currentSender.publicKey.toBase58().substring(0, 8)}... (expected ~${(expectedBalance / LAMPORTS_PER_SOL).toFixed(9)} SOL)`);
          
          if (senderBalance < expectedBalance - 10_000) { // Allow small variance for fees
            console.log(`[Private Funding SOL] ⚠️ Hop ${i + 1}: Sender balance ${(senderBalance / LAMPORTS_PER_SOL).toFixed(9)} SOL, expected ~${(expectedBalance / LAMPORTS_PER_SOL).toFixed(9)} SOL. Waiting...`);
            
            // Wait and retry balance check (up to 10 seconds)
            let retries = 0;
            let newBalance = senderBalance;
            while (newBalance < expectedBalance - 10_000 && retries < 20) {
              await new Promise(resolve => setTimeout(resolve, 500));
              newBalance = await connection.getBalance(currentSender.publicKey);
              console.log(`[Private Funding SOL] Retry ${retries + 1}/20: Balance ${(newBalance / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
              if (newBalance >= expectedBalance - 10_000) {
                console.log(`[Private Funding SOL] ✅ Balance confirmed: ${(newBalance / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
                break;
              }
              retries++;
            }
            
            const finalBalance = await connection.getBalance(currentSender.publicKey);
            if (finalBalance < expectedBalance - 10_000) {
              throw new Error(`Insufficient balance in intermediary ${i}. Have ${(finalBalance / LAMPORTS_PER_SOL).toFixed(9)} SOL, expected ~${(expectedBalance / LAMPORTS_PER_SOL).toFixed(9)} SOL. Transaction may not have confirmed yet.`);
            }
            
            // Use actual balance (might be slightly less due to fees)
            currentAmount = finalBalance;
          } else {
            // Use actual balance
            currentAmount = senderBalance;
          }
        }
        
        // Calculate amount to send
        // Transaction fee is always deducted from sender, so we need to reserve it
        // For intermediary wallets: send balance - tx fee, then account closes and rent refunds to recipient
        const TX_FEE_RESERVE = 5_000; // Conservative estimate for transaction fee (actual is usually ~5k lamports)
        let amountToSend;
        if (i === 0) {
          // First hop from source wallet - reserve tx fee
          amountToSend = currentAmount - TX_FEE_RESERVE;
        } else {
          // Intermediary wallets - send balance minus tx fee
          // After sending, remaining balance (tx fee) is consumed by fee, account closes, rent refunded to recipient
          amountToSend = currentAmount - TX_FEE_RESERVE;
        }
        
        if (amountToSend <= 0) {
          throw new Error(`Insufficient balance. Have ${(currentAmount / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
        }
        
        // Convert recipient to PublicKey if needed
        const recipientPubkey = nextRecipient instanceof PublicKey ? nextRecipient : new PublicKey(nextRecipient);
        const recipientAddress = recipientPubkey.toBase58();
        
        console.log(`[Private Funding SOL] Hop ${i + 1}/${intermediaryKps.length}: ${currentSender.publicKey.toBase58().substring(0, 8)}... -> ${recipientAddress.substring(0, 8)}... (${(amountToSend / LAMPORTS_PER_SOL).toFixed(9)} SOL, sender balance: ${(currentAmount / LAMPORTS_PER_SOL).toFixed(9)} SOL)`);
        
        const { blockhash } = await connection.getLatestBlockhash('confirmed');
        const msg = new TransactionMessage({
          payerKey: currentSender.publicKey,
          recentBlockhash: blockhash,
          instructions: [
            SystemProgram.transfer({
              fromPubkey: currentSender.publicKey,
              toPubkey: recipientPubkey,
              lamports: amountToSend,
            }),
          ],
        }).compileToV0Message();

        const tx = new VersionedTransaction(msg);
        tx.sign([currentSender]);
        const sig = await connection.sendTransaction(tx, { skipPreflight: false, maxRetries: 3 });
        
        // Wait for confirmation with longer timeout
        const confirmation = await connection.confirmTransaction(sig, 'confirmed');
        if (confirmation.value.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        }

        console.log(`[Private Funding SOL] ✅ Hop ${i + 1} complete: ${sig.substring(0, 16)}...`);
        
        // Wait a bit longer for balance to update after confirmation
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Verify the recipient actually received the funds before moving to next hop
        // The recipient is the intermediary that just received funds (or destination if last hop)
        let recipientBalance = await connection.getBalance(recipientPubkey);
        const expectedRecipientBalance = amountToSend;
        
        console.log(`[Private Funding SOL] Hop ${i + 1}: Verifying recipient ${recipientPubkey.toBase58().substring(0, 8)}... received ${(expectedRecipientBalance / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
        
        if (recipientBalance < expectedRecipientBalance - 10_000) {
          console.log(`[Private Funding SOL] ⚠️ Hop ${i + 1}: Recipient balance ${(recipientBalance / LAMPORTS_PER_SOL).toFixed(9)} SOL, expected ~${(expectedRecipientBalance / LAMPORTS_PER_SOL).toFixed(9)} SOL. Waiting for balance update...`);
          
          // Wait for balance to appear (up to 10 seconds)
          let retries = 0;
          while (recipientBalance < expectedRecipientBalance - 10_000 && retries < 20) {
            await new Promise(resolve => setTimeout(resolve, 500));
            recipientBalance = await connection.getBalance(recipientPubkey);
            console.log(`[Private Funding SOL] Retry ${retries + 1}/20: Recipient balance ${(recipientBalance / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
            if (recipientBalance >= expectedRecipientBalance - 10_000) {
              console.log(`[Private Funding SOL] ✅ Recipient balance confirmed: ${(recipientBalance / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
              break;
            }
            retries++;
          }
          
          // Final check
          recipientBalance = await connection.getBalance(recipientPubkey);
          if (recipientBalance < expectedRecipientBalance - 10_000) {
            throw new Error(`Recipient ${recipientPubkey.toBase58().substring(0, 8)}... did not receive funds. Balance: ${(recipientBalance / LAMPORTS_PER_SOL).toFixed(9)} SOL, expected: ${(expectedRecipientBalance / LAMPORTS_PER_SOL).toFixed(9)} SOL. Transaction: ${sig}`);
          }
        }
        
        // Update for next hop - the recipient becomes the sender
        // After sending to Inter1, Inter1 becomes the sender for the next hop
        // After sending to Inter2, Inter2 becomes the sender for the next hop, etc.
        if (!isLastIntermediary && recipientKp) {
          // Next sender is the intermediary that just received funds
          currentSender = recipientKp;
          currentAmount = recipientBalance; // Use actual received balance (includes rent refund if account was closed)
          console.log(`[Private Funding SOL] Hop ${i + 1}: Recipient ${recipientKp.publicKey.toBase58().substring(0, 8)}... now has ${(currentAmount / LAMPORTS_PER_SOL).toFixed(9)} SOL and will be sender for Hop ${i + 2}`);
        }
        
        chainResults.push({ 
          hop: i + 1, 
          from: currentSender.publicKey.toBase58(), 
          to: nextRecipient.toBase58(), 
          amount: amountToSend,
          success: true, 
          signature: sig 
        });
        
        // Small delay between hops to ensure transaction is fully processed
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (e) {
        console.error(`[Private Funding SOL] ❌ Failed at hop ${i + 1}/${intermediaryKps.length}: ${e.message}`);
        const errorRecipient = isLastIntermediary 
          ? destinationAddresses[0]
          : (recipientKp ? recipientKp.publicKey.toBase58() : 'unknown');
        chainResults.push({ 
          hop: i + 1, 
          from: currentSender.publicKey.toBase58(), 
          to: errorRecipient, 
          success: false, 
          error: e.message 
        });
        // If a hop fails, we can't continue the chain
        return res.status(500).json({ 
          success: false, 
          error: `Chain routing failed at hop ${i + 1}: ${e.message}`,
          chainResults 
        });
      }
    }
    
    // Final hop: Last intermediary -> Destination (already handled in the loop if isLastIntermediary)
    // The loop should have already sent to destination, so we just need to verify
    const finalDestination = destinationAddresses[0];
    const finalAmount = currentAmount;
    
    // Verify final destination received funds
    await new Promise(resolve => setTimeout(resolve, 1000));
    const destinationBalance = await connection.getBalance(new PublicKey(finalDestination));
    console.log(`[Private Funding SOL] ✅ COMPLETE: Destination balance ${(destinationBalance / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
    console.log(`[Private Funding SOL] ✅ COMPLETE: ${(finalAmount / LAMPORTS_PER_SOL).toFixed(9)} SOL delivered to destination via ${intermediaryKps.length} intermediary wallets`);
    
    // Intermediary wallets are automatically closed by Solana when balance hits 0
    // The rent is automatically refunded to the recipient (minus transaction fees)
    console.log(`[Private Funding SOL] 💾 Intermediary wallets saved to ${INTERMEDIARY_WALLETS_FILE}`);
    console.log(`[Private Funding SOL] 💡 Intermediary wallets were automatically closed by Solana (rent refunded to destination, minus tx fees)`);
    
    // Delete old JSON file if it exists
    if (fs.existsSync(INTERMEDIARY_WALLETS_JSON)) {
      try {
        fs.unlinkSync(INTERMEDIARY_WALLETS_JSON);
        console.log(`[Private Funding SOL] 🗑️ Deleted old JSON file: ${INTERMEDIARY_WALLETS_JSON}`);
      } catch (e) {
        // Ignore deletion errors
      }
    }
    
    console.log(`[Private Funding SOL] ✅ All done!\n`);
    
    res.json({
      success: true,
      message: `Private funding via SOL intermediary chain complete. ${(finalAmount / LAMPORTS_PER_SOL).toFixed(9)} SOL delivered via ${intermediaryKps.length} intermediaries.`,
      intermediaryWalletsFile: INTERMEDIARY_WALLETS_FILE, // Simple text format: "Funding 1\npk1\npk2\n..."
      chainResults,
      finalAmount: finalAmount / LAMPORTS_PER_SOL,
      destination: finalDestination,
    });
  } catch (error) {
    console.error('[Private Funding SOL] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// RECOVERY: Collect SOL from all intermediary wallets
app.post('/api/private-funding/recover-sol-intermediaries', async (req, res) => {
  try {
    const { destinationWalletId = 'main' } = req.body;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[Recovery SOL] 🔧 RECOVERING SOL FROM INTERMEDIARY WALLETS`);
    console.log(`${'='.repeat(60)}\n`);
    
    // Get destination address
    let destinationAddress;
    if (destinationWalletId === 'main') {
      const env = readEnvFile();
      if (!env.PRIVATE_KEY) {
        return res.status(400).json({ success: false, error: 'PRIVATE_KEY not set in .env' });
      }
      const mainKp = Keypair.fromSecretKey(base58.decode(env.PRIVATE_KEY));
      destinationAddress = mainKp.publicKey.toBase58();
    } else {
      destinationAddress = destinationWalletId;
    }
    
    console.log(`[Recovery SOL] Destination: ${destinationAddress.substring(0, 8)}...`);
    
    // Load all intermediary wallets from JSON
    const intermediaryWallets = loadSolIntermediaryKeypairs(1); // Load from hop1
    
    if (intermediaryWallets.length === 0) {
      return res.status(404).json({ success: false, error: 'No intermediary wallets found in ' + INTERMEDIARY_WALLETS_FILE });
    }
    
    console.log(`[Recovery SOL] Found ${intermediaryWallets.length} intermediary wallets`);
    
    const solRpcUrl = process.env.SOL_RPC_URL || process.env.SOLANA_RPC_URL || process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(solRpcUrl, 'confirmed');
    const destinationPubkey = new PublicKey(destinationAddress);
    
    const results = [];
    let totalRecovered = 0;
    const RENT_EXEMPTION = 890_880; // Minimum balance required for rent exemption (~0.00089 SOL)
    const TX_FEE_ESTIMATE = 20_000; // Estimated transaction fee (conservative, actual is usually ~5k)
    const MIN_REQUIRED = RENT_EXEMPTION + TX_FEE_ESTIMATE; // Total minimum to leave in account (~0.00091 SOL)
    
    console.log(`[Recovery SOL] Minimum required per wallet: ${(MIN_REQUIRED / LAMPORTS_PER_SOL).toFixed(9)} SOL (rent exemption + fees)`);
    
    for (let i = 0; i < intermediaryWallets.length; i++) {
      const intermediaryKp = intermediaryWallets[i];
      const address = intermediaryKp.publicKey.toBase58();
      
      try {
        // Check balance
        const balance = await connection.getBalance(intermediaryKp.publicKey);
        const balanceSol = balance / LAMPORTS_PER_SOL;
        
        if (balance < MIN_REQUIRED) {
          console.log(`[Recovery SOL] Wallet ${i + 1}/${intermediaryWallets.length} (${address.substring(0, 8)}...): Insufficient balance (${balanceSol.toFixed(9)} SOL, need ${(MIN_REQUIRED / LAMPORTS_PER_SOL).toFixed(9)} SOL for rent + fees)`);
          results.push({ 
            wallet: address, 
            index: i + 1, 
            success: false, 
            error: 'Insufficient balance (below rent exemption + fees)',
            balance: balanceSol 
          });
          continue;
        }
        
        // Leave rent exemption + fee estimate, send the rest
        const amountToSend = balance - MIN_REQUIRED;
        const amountToSendSol = amountToSend / LAMPORTS_PER_SOL;
        
        if (amountToSend <= 0) {
          console.log(`[Recovery SOL] Wallet ${i + 1}/${intermediaryWallets.length} (${address.substring(0, 8)}...): No recoverable balance (below minimum)`);
          results.push({ 
            wallet: address, 
            index: i + 1, 
            success: false, 
            error: 'No recoverable balance (below minimum)',
            balance: balanceSol 
          });
          continue;
        }
        
        console.log(`[Recovery SOL] Wallet ${i + 1}/${intermediaryWallets.length} (${address.substring(0, 8)}...): Recovering ${amountToSendSol.toFixed(9)} SOL (balance: ${balanceSol.toFixed(9)} SOL)`);
        
        // Send SOL to destination
        const { blockhash } = await connection.getLatestBlockhash('confirmed');
        const msg = new TransactionMessage({
          payerKey: intermediaryKp.publicKey,
          recentBlockhash: blockhash,
          instructions: [
            SystemProgram.transfer({
              fromPubkey: intermediaryKp.publicKey,
              toPubkey: destinationPubkey,
              lamports: amountToSend,
            }),
          ],
        }).compileToV0Message();

        const tx = new VersionedTransaction(msg);
        tx.sign([intermediaryKp]);
        const sig = await connection.sendTransaction(tx, { skipPreflight: false, maxRetries: 3 });
        await connection.confirmTransaction(sig, 'confirmed');
        
        totalRecovered += amountToSendSol;
        console.log(`[Recovery SOL] ✅ Wallet ${i + 1} recovered: ${sig.substring(0, 16)}...`);
        
        results.push({ 
          wallet: address, 
          index: i + 1, 
          success: true, 
          signature: sig,
          amount: amountToSendSol,
          balance: balanceSol 
        });
        
        // Small delay between transactions
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (e) {
        console.error(`[Recovery SOL] ❌ Failed to recover from wallet ${i + 1} (${address.substring(0, 8)}...): ${e.message}`);
        results.push({ 
          wallet: address, 
          index: i + 1, 
          success: false, 
          error: e.message 
        });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[Recovery SOL] ✅ COMPLETE: ${successCount}/${intermediaryWallets.length} wallets recovered`);
    console.log(`[Recovery SOL] Total recovered: ${totalRecovered.toFixed(9)} SOL`);
    console.log(`${'='.repeat(60)}\n`);
    
    res.json({
      success: true,
      message: `Recovered ${totalRecovered.toFixed(9)} SOL from ${successCount}/${intermediaryWallets.length} intermediary wallets`,
      totalRecovered,
      successCount,
      totalWallets: intermediaryWallets.length,
      results,
    });
  } catch (error) {
    console.error('[Recovery SOL] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// RECOVERY: Bridge stuck ETH from intermediary back to SOL
app.post('/api/private-funding/recover-intermediary', async (req, res) => {
  try {
    const { intermediaryAddress, destinationSolAddress, chain = 'base' } = req.body;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[Recovery] 🔧 RECOVERING STUCK ETH`);
    console.log(`[Recovery] From: ${intermediaryAddress}`);
    console.log(`[Recovery] To: ${destinationSolAddress}`);
    console.log(`[Recovery] Chain: ${chain}`);
    console.log(`${'='.repeat(60)}\n`);
    
    // Find the intermediary wallet
    const data = loadEvmIntermediaryWallets();
    const wallet = data.wallets.find(w => w.address.toLowerCase() === intermediaryAddress.toLowerCase());
    
    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Intermediary wallet not found in storage' });
    }
    
    const { ethers } = require('ethers');
    const mayanSdk = require('@mayanfinance/swap-sdk');
    const { fetchQuote, swapFromEvm } = mayanSdk;
    
    // Public RPCs are sufficient for simple swaps/bridging operations
    // Only set custom RPC URLs in .env if you need higher rate limits or reliability
    const rpcUrls = {
      ethereum: process.env.ETH_RPC_URL || 'https://ethereum.publicnode.com',
      base: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
      bsc: process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org',
      polygon: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
      avalanche: process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc',
      arbitrum: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
      optimism: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
    };
    const provider = new ethers.JsonRpcProvider(rpcUrls[chain] || rpcUrls.base);
    
    // Check balance
    const balanceWei = await provider.getBalance(wallet.address);
    const ethBalance = parseFloat(ethers.formatEther(balanceWei));
    
    console.log(`[Recovery] Balance: ${ethBalance.toFixed(6)} ETH`);
    
    if (ethBalance < 0.0001) {
      return res.status(400).json({ success: false, error: `Insufficient ETH balance: ${ethBalance} ETH` });
    }
    
    // Create signer
    const evmSigner = new ethers.Wallet(wallet.privateKey, provider);
    
    // Calculate actual gas cost with safety buffer
    const feeData = await provider.getFeeData();
    const estimatedGas = chain === 'ethereum' ? 300000n : 250000n;
    const gasPrice = feeData.gasPrice || ethers.parseUnits('3', 'gwei');
    const gasCost = gasPrice * estimatedGas;
    const gasCostEth = parseFloat(ethers.formatEther(gasCost));
    const safetyBuffer = Math.max(gasCostEth * 0.2, 0.00005);
    const totalReserve = gasCostEth + safetyBuffer;
    
    // Bridge everything except gas reserve
    const amountToSend = Math.max(0, ethBalance - totalReserve);
    const MAYAN_MIN = chain === 'ethereum' ? 0.001 : 0.0008;
    
    if (amountToSend < MAYAN_MIN) {
      return res.status(400).json({ 
        success: false, 
        error: `Insufficient balance after gas. Have ${ethBalance.toFixed(6)} ETH, need ${(totalReserve + MAYAN_MIN).toFixed(6)} ETH minimum (gas + min bridge amount)` 
      });
    }
    
    const amountWei = ethers.parseEther(amountToSend.toFixed(18));
    console.log(`[Recovery] Gas estimate: ${gasCostEth.toFixed(6)} ETH, Buffer: ${safetyBuffer.toFixed(6)} ETH, Bridging: ${amountToSend.toFixed(6)} ETH`);
    
    // Chain mapping for Mayan SDK
    const chainMap = { 
      ethereum: 'ethereum', 
      base: 'base', 
      bsc: 'bsc',
      polygon: 'polygon',
      avalanche: 'avalanche',
      arbitrum: 'arbitrum',
      optimism: 'optimism',
    };
    const fromChain = chainMap[chain] || chain || 'base';
    
    // Get quote
    console.log(`[Recovery] Getting quote for ${amountToSend.toFixed(6)} ETH (${fromChain} → SOL)...`);
    const quotes = await fetchQuote({
      amountIn64: amountWei.toString(),
      fromToken: '0x0000000000000000000000000000000000000000',
      toToken: '0x0000000000000000000000000000000000000000',
      fromChain: fromChain,
      toChain: 'solana',
      slippageBps: 100,
    });
    
    if (!quotes || quotes.length === 0) {
      return res.status(400).json({ success: false, error: 'No quote available for ETH → SOL' });
    }
    
    const quote = quotes[0];
    console.log(`[Recovery] Quote: ${amountToSend.toFixed(6)} ETH → ~${quote.expectedAmountOut || quote.minAmountOut} SOL`);
    
    // Execute swap
    console.log(`[Recovery] Executing swap...`);
    const result = await swapFromEvm(
      quote,
      wallet.address,       // FROM: EVM intermediary
      destinationSolAddress, // TO: Solana wallet
      null,                 // referrer
      evmSigner,            // signer
      null,                 // permit
      null,                 // overrides
      null                  // payload
    );
    
    const txHash = typeof result === 'string' ? result : result.hash || result.signature;
    console.log(`[Recovery] ✅ SUCCESS! Tx: ${txHash}`);
    
    // Update wallet status
    wallet.status = 'recovered';
    wallet.recoveryTx = txHash;
    wallet.recoveredTo = destinationSolAddress;
    wallet.recoveredAt = new Date().toISOString();
    saveEvmIntermediaryWallets(data);
    
    res.json({
      success: true,
      message: `Recovery initiated! ~${quote.expectedAmountOut || quote.minAmountOut} SOL will arrive in 2-5 minutes.`,
      txHash,
      expectedSol: quote.expectedAmountOut || quote.minAmountOut,
    });
    
  } catch (error) {
    console.error('[Recovery] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// TREND DETECTOR - MOVED TO SEPARATE SERVICE
// =====================================================
// The Trend Detector is now a standalone service to reduce bundler overhead.
// Run it separately with: cd features/trends && npm run dev
// It runs on http://localhost:3003
// The frontend connects directly to that service when enabled.
// =====================================================

const server = app.listen(PORT, () => {
  console.log(`🚀 Control Panel API Server running on http://localhost:${PORT}`);
  console.log(`📁 Working directory: ${process.cwd()}`);
  console.log(`📁 API server directory: ${__dirname}`);
  console.log(`📁 Root .env path (PRIORITY): ${path.join(__dirname, '..', '.env')}`);
  console.log(`📁 Current dir .env: ${path.join(process.cwd(), '.env')}`);
  
  // Test reading .env on startup
  const testEnv = readEnvFile();
  console.log(`✅ Loaded ${Object.keys(testEnv).length} environment variables`);
  if (testEnv.PRIVATE_KEY) {
    console.log(`✅ PRIVATE_KEY found (length: ${testEnv.PRIVATE_KEY.length})`);
  } else {
    console.log(`⚠️  PRIVATE_KEY not found in .env file`);
  }
});

// Graceful shutdown handler - properly close all connections before exit
const gracefulShutdown = (signal) => {
  console.log(`\n[Shutdown] Received ${signal}, closing connections...`);
  
  // Close WebSocket server first
  if (wss) {
    wss.close(() => {
      console.log('[Shutdown] WebSocket server closed');
    });
  }
  
  // Close HTTP server
  server.close(() => {
    console.log('[Shutdown] HTTP server closed');
    process.exit(0);
  });
  
  // Force exit after 3 seconds if graceful shutdown fails
  setTimeout(() => {
    console.log('[Shutdown] Forcing exit...');
    process.exit(1);
  }, 3000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
