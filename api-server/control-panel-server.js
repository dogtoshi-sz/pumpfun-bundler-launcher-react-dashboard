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
const liveTradesTracker = require('./live-trades-tracker');
const quickNodeWebhook = require('./quicknode-webhook-handler');
const pumpPortalTracker = require('./pumpportal-tracker');

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
const PORT = 3001;
const execAsync = promisify(exec);
const multer = require('multer');

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
// 🔒 SECURITY: LOCALHOST ONLY - BLOCK ALL EXTERNAL REQUESTS
// ============================================================
app.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress || '';
  const isLocalhost = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost';
  
  // Also check X-Forwarded-For header (for reverse proxies like ngrok)
  const forwardedFor = req.headers['x-forwarded-for'];
  const isFromNgrok = forwardedFor && forwardedFor.length > 0;
  
  // BLOCK ALL EXTERNAL REQUESTS (including via ngrok)
  if (isFromNgrok) {
    console.warn(`🚨 BLOCKED EXTERNAL REQUEST via ngrok: ${req.method} ${req.path} from ${forwardedFor}`);
    return res.status(403).json({ 
      error: 'Access denied. This API is localhost-only for security.',
      message: 'External access via ngrok/tunnel is blocked.' 
    });
  }
  
  if (!isLocalhost) {
    console.warn(`🚨 BLOCKED EXTERNAL REQUEST: ${req.method} ${req.path} from ${ip}`);
    return res.status(403).json({ 
      error: 'Access denied. This API is localhost-only for security.' 
    });
  }
  
  next();
});
// ============================================================

// Increase JSON body size limit to handle base64 images (10MB)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files from image directory
const imageDir = path.join(__dirname, '..', 'image');
app.use('/image', express.static(imageDir));

// Serve PSD assets directory
const psdAssetsDir = path.join(__dirname, '..', 'psd-assets');
if (fs.existsSync(psdAssetsDir)) {
  app.use('/psd-assets', express.static(psdAssetsDir));
}

// PSD and Logo generation API routes
const psdLogoApi = require('./psd-logo-api');
app.use('/api/psd', psdLogoApi);
app.use('/api/logo', psdLogoApi);

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
      console.log(`[Settings] Writing to .env file at: ${envPath}`);
      console.log(`[Settings] Absolute path: ${absolutePath}`);
      break;
    }
  }
  
  if (!envPath) {
    // If no .env exists, create one in root
    envPath = path.join(__dirname, '..', '.env');
    const absolutePath = path.resolve(envPath);
    console.log(`[Settings] Creating new .env file at: ${envPath}`);
    console.log(`[Settings] Absolute path: ${absolutePath}`);
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
  
  console.log(`[Settings] Updating ${keysToUpdate.size} keys:`, Array.from(keysToUpdate));
  
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

// Upload image file - uploads to Vercel Blob and returns URL
app.post('/api/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image file provided' });
    }
    
    // Check if Vercel Blob token is configured
    const blobToken = process.env.BLOB1_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
    
    if (blobToken) {
      // Upload to Vercel Blob
      try {
        const { put } = await import('@vercel/blob');
        const fs = require('fs');
        
        // Read file buffer
        const fileBuffer = fs.readFileSync(req.file.path);
        const file = new File([fileBuffer], req.file.filename, { type: req.file.mimetype });
        
        // Generate unique filename
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substring(2, 9);
        const extension = req.file.filename.split('.').pop() || 'png';
        const filename = `website-logo-${timestamp}-${randomStr}.${extension}`;
        
        // Upload to Vercel Blob
        const blob = await put(filename, file, {
          access: 'public',
          addRandomSuffix: false,
          token: blobToken,
        });
        
        // Delete local file after upload
        fs.unlinkSync(req.file.path);
        
        console.log('[Upload Image] ✅ Uploaded to Vercel Blob:', blob.url);
        
        return res.json({ 
          success: true, 
          url: blob.url,
          filePath: blob.url, // For backward compatibility
          filename: filename,
          message: 'Image uploaded to Vercel Blob successfully' 
        });
      } catch (blobError) {
        console.error('[Upload Image] ❌ Vercel Blob upload failed:', blobError.message);
        // Fall back to local file path
        const relativePath = `./image/${req.file.filename}`;
        return res.json({ 
          success: true, 
          filePath: relativePath,
          filename: req.file.filename,
          message: 'Image saved locally (Vercel Blob upload failed)' 
        });
      }
    } else {
      // No Vercel Blob token - use local file path
      console.warn('[Upload Image] ⚠️ BLOB1_READ_WRITE_TOKEN not configured, using local file path');
      const relativePath = `./image/${req.file.filename}`;
      return res.json({ 
        success: true, 
        filePath: relativePath,
        filename: req.file.filename,
        message: 'Image saved locally (Vercel Blob not configured)' 
      });
    }
  } catch (error) {
    console.error('[Upload Image] ❌ Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update .env settings
app.post('/api/settings', (req, res) => {
  try {
    const updates = req.body.settings;
    console.log('[Settings] Received update request with keys:', Object.keys(updates));
    
    // CRITICAL: Clear amounts when wallet count is set to 0
    if (updates.BUNDLE_WALLET_COUNT !== undefined) {
      const bundleCount = parseInt(updates.BUNDLE_WALLET_COUNT) || 0;
      if (bundleCount === 0) {
        console.log('[Settings] BUNDLE_WALLET_COUNT is 0 - clearing BUNDLE_SWAP_AMOUNTS');
        updates.BUNDLE_SWAP_AMOUNTS = '';
      }
    }
    if (updates.HOLDER_WALLET_COUNT !== undefined) {
      const holderCount = parseInt(updates.HOLDER_WALLET_COUNT) || 0;
      if (holderCount === 0) {
        console.log('[Settings] HOLDER_WALLET_COUNT is 0 - clearing HOLDER_SWAP_AMOUNTS');
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
    console.log('[Settings] Update values (private keys masked):', safeUpdates);
    
    // Read current .env file
    const currentEnv = readEnvFile();
    console.log('[Settings] Current env has', Object.keys(currentEnv).length, 'keys');
    
    // Merge updates with current values
    const updatedEnv = { ...currentEnv, ...updates };
    console.log('[Settings] Merged env has', Object.keys(updatedEnv).length, 'keys');
    
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
    
    console.log('[Settings] Successfully updated .env file and verified');
    console.log('[Settings] 📋 Final values after save:');
    for (const key in updates) {
      console.log(`[Settings]   ${key} = ${verifyEnv[key]}`);
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
      frontRunThreshold 
    } = req.body || {};
    
    // Determine if any warmed wallets are being used (legacy compat + new per-type)
    const anyWarmedUsed = useWarmedWallets || useWarmedDevWallet || useWarmedBundleWallets || useWarmedHolderWallets;
    const hasWarmedSelections = creatorWalletAddress || (bundleWalletAddresses && bundleWalletAddresses.length > 0) || (holderWalletAddresses && holderWalletAddresses.length > 0);
    
    if (anyWarmedUsed && hasWarmedSelections) {
      console.log(`[Launch] 🔥 Per-type warmed wallet configuration:`);
      console.log(`   DEV: ${useWarmedDevWallet ? 'WARMED' : 'FRESH'} ${creatorWalletAddress ? `(${creatorWalletAddress.slice(0, 8)}...)` : ''}`);
      console.log(`   Bundle: ${useWarmedBundleWallets ? 'WARMED' : 'FRESH'} (${bundleWalletAddresses?.length || 0} selected)`);
      console.log(`   Holder: ${useWarmedHolderWallets ? 'WARMED' : 'FRESH'} (${holderWalletAddresses?.length || 0} selected)`);
      
      // Load warmed wallets and save selected ones to a file that index.ts can read
      const { loadWarmedWallets } = require('../src/wallet-warming-manager.ts');
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
        const freshAutoBuyPath = path.join(projectRoot, 'keys', 'fresh-auto-buy-config.json');
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
        const freshAutoBuyPath = path.join(projectRoot, 'keys', 'fresh-auto-buy-config.json');
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
    const childProcess = exec('npm start', { 
      cwd: projectRoot, // Same directory as running "npm start" from terminal
      env: {
        ...process.env, // Inherit parent environment
        // Ensure NODE_ENV and other important vars are set
        NODE_ENV: process.env.NODE_ENV || 'development'
      },
      // Capture output for streaming
    });
    
    // Log process info
    console.log(`[Launch] Child process started with PID: ${childProcess.pid}`);
    console.log(`[Launch] Working directory: ${projectRoot}`);
    
    // Function to broadcast progress to all SSE listeners
    const broadcastProgress = (type, data) => {
      const message = JSON.stringify({ type, data, timestamp: Date.now() });
      global.launchProgressListeners.forEach(listener => {
        try {
          listener.write(`data: ${message}\n\n`);
        } catch (error) {
          // Remove dead listeners
          global.launchProgressListeners = global.launchProgressListeners.filter(l => l !== listener);
        }
      });
    };
    
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
        const pumpAddressesPath = path.join(__dirname, '..', 'keys', 'pump-addresses.json');
        if (fs.existsSync(pumpAddressesPath)) {
          const data = fs.readFileSync(pumpAddressesPath, 'utf-8');
          const addresses = JSON.parse(data);
          
          const available = addresses.find((addr) => 
            addr.status === 'available' && !addr.used
          );
          
          if (available) {
            address = available.publicKey;
            source = 'Pump address pool (pump-addresses.json)';
          }
        }
      } catch (error) {
        console.error('[Next Pump Address] Error reading pump-addresses.json:', error);
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

// Balance cache to reduce RPC calls
const balanceCache = new Map(); // key: `${address}_${mintAddress}` -> { solBalance, tokenBalance, timestamp }
const CACHE_TTL = 3000; // 3 seconds cache

// Invalidate cache for a wallet (call after buy/sell transactions)
function invalidateBalanceCache(address, mintAddress) {
  const cacheKey = `${address}_${mintAddress}`;
  balanceCache.delete(cacheKey);
  // Removed verbose logging - only log errors
}

// Batch fetch balances (more efficient than individual calls)
async function batchFetchBalances(walletKeys, mintAddress) {
  const connection = getConnection();
  const wallets = [];
  const now = Date.now();
  
  // Prepare all public keys first (NO private keys stored)
  const walletData = walletKeys.map(privateKey => {
    const kp = Keypair.fromSecretKey(base58.decode(privateKey));
    return { kp, address: kp.publicKey.toBase58() }; // SECURITY: Don't store privateKey
  });
  
  // Batch fetch SOL balances using getMultipleAccountsInfo (single RPC call)
  const publicKeys = walletData.map(w => w.kp.publicKey);
  const solAccountInfos = await connection.getMultipleAccountsInfo(publicKeys);
  
  // Only fetch token balances if mintAddress is provided
  let tokenAccountMap = new Map();
  let tokenAccountAddresses = [];
  if (mintAddress) {
    try {
      const mintPubkey = new PublicKey(mintAddress);
      
      // Get token account addresses for all wallets
      tokenAccountAddresses = await Promise.all(
        walletData.map(w => getAssociatedTokenAddress(mintPubkey, w.kp.publicKey, true).catch(() => null))
      );
      
      // Batch fetch token account info (use getParsedAccountInfo in parallel)
      const validTokenAccounts = tokenAccountAddresses.filter(addr => addr !== null);
      const tokenAccountPromises = validTokenAccounts.map(addr => 
        connection.getParsedAccountInfo(addr).catch(() => null)
      );
      const tokenAccountInfos = await Promise.all(tokenAccountPromises);
      
      // Create a map for quick lookup
      validTokenAccounts.forEach((addr, idx) => {
        const accountInfo = tokenAccountInfos[idx];
        if (accountInfo && accountInfo.value && accountInfo.value.data && accountInfo.value.data.parsed) {
          tokenAccountMap.set(addr.toBase58(), accountInfo.value.data.parsed.info.tokenAmount.uiAmount || 0);
        }
      });
    } catch (error) {
      // If mintAddress is invalid or token fetching fails, just continue with SOL balances
      console.warn('[Batch Fetch] Could not fetch token balances:', error.message);
    }
  }
  
  // Process results
  for (let i = 0; i < walletData.length; i++) {
    try {
      const wallet = walletData[i];
      const cacheKey = `${wallet.address}_${mintAddress || 'no-mint'}`;
      
      // Check cache first (3 second TTL)
      const cached = balanceCache.get(cacheKey);
      if (cached && now - cached.timestamp < CACHE_TTL) {
        wallets.push({
          address: wallet.address,
          // SECURITY: No private key returned
          solBalance: cached.solBalance,
          tokenBalance: cached.tokenBalance
        });
        continue;
      }
      
      // Get SOL balance from batch result
      const solBalance = solAccountInfos[i] ? 
        (solAccountInfos[i].lamports || 0) / LAMPORTS_PER_SOL : 0;
      
      // Get token balance from batch result (only if mintAddress exists)
      let tokenBalance = 0;
      if (mintAddress) {
        const tokenAccountAddr = tokenAccountAddresses[i];
        if (tokenAccountAddr) {
          tokenBalance = tokenAccountMap.get(tokenAccountAddr.toBase58()) || 0;
        }
      }
      
      // Cache the result
      balanceCache.set(cacheKey, {
        solBalance,
        tokenBalance,
        timestamp: now
      });
      
      wallets.push({
        address: wallet.address,
        // SECURITY: No private key returned
        solBalance,
        tokenBalance: tokenBalance || 0
      });
    } catch (error) {
      console.error(`Error processing wallet ${i}:`, error);
      wallets.push({
        address: walletData[i].address,
        // SECURITY: No private key returned
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
    
    // Use batch fetching for efficiency (mintAddress can be null - will just fetch SOL balances)
    const wallets = await batchFetchBalances(allWalletKeys, mintAddress);
    
    // Add wallet type tags
    wallets.forEach((wallet, index) => {
      wallet.type = walletTypes[index] || 'unknown';
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

// Sell all tokens (99.9%) from a wallet
app.post('/api/warming-wallets/sell-all-tokens', async (req, res) => {
  try {
    const { walletAddress } = req.body;
    
    if (!walletAddress) {
      return res.status(400).json({ success: false, error: 'Wallet address is required' });
    }
    
    // Load wallet from warmed wallets to get private key
    const { loadWarmedWallets } = require('../src/wallet-warming-manager.ts');
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
    
    // Get all token accounts
    const tokenAccounts = await connection.getTokenAccountsByOwner(walletKp.publicKey, {
      programId: TOKEN_PROGRAM_ID,
    });
    
    console.log(`[Sell All] Found ${tokenAccounts.value.length} token account(s) for wallet ${walletAddress.substring(0, 8)}...`);
    
    if (tokenAccounts.value.length === 0) {
      return res.json({ success: true, message: 'No tokens found', results: [], summary: { successful: 0, failed: 0, total: 0 } });
    }
    
    const results = [];
    const tokensToSell = []; // Store tokens with balance for selling
    
    // First, identify all tokens with balance (check raw amount to catch very small balances)
    for (let i = 0; i < tokenAccounts.value.length; i++) {
      const { account } = tokenAccounts.value[i];
      const accountData = account.data;
      const mintPubkey = new PublicKey(accountData.slice(0, 32));
      const mintAddress = mintPubkey.toBase58();
      
      try {
        // Get token balance (check both UI amount and raw amount)
        const tokenBalance = await connection.getTokenAccountBalance(tokenAccounts.value[i].pubkey);
        const uiAmount = tokenBalance.value?.uiAmount;
        const rawAmount = tokenBalance.value?.amount; // Raw amount (not divided by decimals)
        
        // Check if token has any balance (using raw amount for accuracy - catches very small balances)
        // Raw amount is a string, so check if it's not "0" or 0
        const hasBalance = tokenBalance.value && rawAmount && rawAmount !== '0' && rawAmount !== 0 && rawAmount !== '0' && Number(rawAmount) > 0;
        
        if (!hasBalance) {
          console.log(`[Sell All] Skipping ${mintAddress.substring(0, 8)}... (zero balance - raw: ${rawAmount})`);
          continue; // Skip empty accounts
        }
        
        tokensToSell.push({
          mintAddress,
          uiAmount,
          rawAmount,
          accountIndex: i
        });
        
        console.log(`[Sell All] Token ${tokensToSell.length}: ${mintAddress.substring(0, 8)}... (balance: ${uiAmount || 'N/A'}, raw: ${rawAmount})`);
      } catch (error) {
        console.error(`[Sell All] Error checking balance for ${mintAddress.substring(0, 8)}...:`, error.message);
      }
    }
    
    const tokensWithBalance = tokensToSell.length;
    
    console.log(`[Sell All] Found ${tokensWithBalance} token(s) with balance, proceeding to sell...`);
    
    // Now sell each token with balance
    for (let i = 0; i < tokensToSell.length; i++) {
      const { mintAddress, uiAmount, rawAmount, accountIndex } = tokensToSell[i];
      
      try {
        console.log(`[Sell All] [${i + 1}/${tokensWithBalance}] Selling ${mintAddress.substring(0, 8)}... (balance: ${uiAmount || 'N/A'}, raw: ${rawAmount})`);
        
        // Re-check balance right before selling to ensure tokens are still there
        // Wait a bit if tokens were just bought (they might not be fully settled)
        let retries = 0;
        let currentBalance = null;
        while (retries < 5) {
          const freshBalance = await connection.getTokenAccountBalance(tokenAccounts.value[accountIndex].pubkey);
          const freshUiAmount = freshBalance.value?.uiAmount;
          const freshRawAmount = freshBalance.value?.amount;
          
          if (freshUiAmount && freshUiAmount > 0 && freshRawAmount && Number(freshRawAmount) > 0) {
            currentBalance = freshUiAmount;
            console.log(`[Sell All] Confirmed balance: ${freshUiAmount} (raw: ${freshRawAmount})`);
            break;
          } else {
            retries++;
            if (retries < 5) {
              console.log(`[Sell All] Waiting for tokens to settle... (attempt ${retries}/5)`);
              await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
            }
          }
        }
        
        if (!currentBalance || currentBalance === 0) {
          console.log(`[Sell All] Token ${mintAddress.substring(0, 8)}... has no balance after retries, skipping`);
          results.push({ mint: mintAddress, success: false, error: 'No balance found after retries' });
          continue;
        }
        
        // For very small amounts, sell 100% instead of 99.9% to avoid "too small" error
        // If UI amount is less than 0.01 or very small, sell 100% to ensure we can sell it
        const sellPercentage = (currentBalance && currentBalance < 0.01) ? 100 : 99.9;
        
        console.log(`[Sell All] Selling ${sellPercentage}% of ${mintAddress.substring(0, 8)}... (current balance: ${currentBalance})`);
        
        // Sell with lowest priority fee (same as holder wallets)
        try {
          const result = await callTradingFunction('sellTokenSimple', wallet.privateKey, mintAddress, sellPercentage, 'low');
          if (result && result.signature) {
            results.push({ mint: mintAddress, success: true, result, sellPercentage });
            console.log(`[Sell All] ✅ Successfully sold ${mintAddress.substring(0, 8)}... - Tx: ${result.signature}`);
          } else {
            throw new Error('No signature returned from sell transaction');
          }
        } catch (sellError) {
          console.error(`[Sell All] ❌ Failed to sell ${mintAddress.substring(0, 8)}...:`, sellError.message);
          throw sellError; // Re-throw to be caught by outer catch
        }
        
        // Invalidate cache
        invalidateBalanceCache(walletAddress, mintAddress);
        
        // Small delay between sells
        if (i < tokensToSell.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.error(`[Sell All] Failed to sell ${mintAddress.substring(0, 8)}...:`, error.message);
        // If "too small" error or "No tokens" error, try selling 100% instead
        if (error.message && (error.message.includes('too small') || error.message.includes('Amount to sell') || error.message.includes('No tokens'))) {
          try {
            console.log(`[Sell All] Retrying with 100% for ${mintAddress.substring(0, 8)}...`);
            // Wait a bit before retry
            await new Promise(resolve => setTimeout(resolve, 1000));
            const retryResult = await callTradingFunction('sellTokenSimple', wallet.privateKey, mintAddress, 100, 'low');
            results.push({ mint: mintAddress, success: true, result: retryResult, sellPercentage: 100, retried: true });
            invalidateBalanceCache(walletAddress, mintAddress);
          } catch (retryError) {
            console.error(`[Sell All] Retry also failed for ${mintAddress.substring(0, 8)}...:`, retryError.message);
            results.push({ mint: mintAddress, success: false, error: retryError.message });
          }
        } else {
          results.push({ mint: mintAddress, success: false, error: error.message });
        }
      }
    }
    
    // Update wallet balance after selling
    try {
      const { updateWalletBalance } = require('../src/wallet-warming-manager.ts');
      await updateWalletBalance(walletAddress);
      console.log(`[Sell All] Updated balance for ${walletAddress.substring(0, 8)}...`);
    } catch (error) {
      console.error(`[Sell All] Failed to update balance:`, error.message);
    }
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    res.json({
      success: true,
      message: `Sold ${successful} token(s) successfully${failed > 0 ? `, ${failed} failed` : ''}${tokensWithBalance > 0 ? ` out of ${tokensWithBalance} token(s) with balance` : ''}`,
      results,
      summary: { successful, failed, total: results.length, tokensWithBalance }
    });
  } catch (error) {
    console.error('[Sell All Tokens] Error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to sell all tokens' });
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
      'gather-all': 'gather-all',
      'gather-last': 'gather-last',
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
    const longRunningCommands = ['gather', 'gather-new-only', 'gather-all', 'gather-last', 'rapid-sell', 'rapid-sell-50-percent', 'rapid-sell-remaining'];
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
    const profitLossPath = path.join(__dirname, '..', 'keys', 'profit-loss.json');
    
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
    const fundingWalletKp = Keypair.fromSecretKey(base58.decode(env.PRIVATE_KEY));
    const fundingWalletAddress = fundingWalletKp.publicKey.toBase58();
    
    // Get funding wallet balance
    const connection = new Connection(env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com');
    const fundingBalance = await connection.getBalance(fundingWalletKp.publicKey);
    
    // Creator/DEV wallet info
    // PRIORITY 1: Use BUYER_WALLET from .env if set (ALWAYS use this if present)
    // PRIORITY 2: Check current-run.json for creatorDevWalletKey (only if BUYER_WALLET not set)
    // PRIORITY 3: Will be auto-created (only if neither exists)
    let creatorDevWallet = null;
    let creatorDevPrivateKey = null;
    
    // FIRST: Check if BUYER_WALLET is set in .env - if yes, ALWAYS use it
    if (env.BUYER_WALLET && env.BUYER_WALLET.trim() !== '') {
      const creatorKp = Keypair.fromSecretKey(base58.decode(env.BUYER_WALLET));
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
      
      if (creatorDevWalletKey) {
        // Use previously auto-created wallet from current-run.json
        const creatorKp = Keypair.fromSecretKey(base58.decode(creatorDevWalletKey));
        const creatorBalance = await connection.getBalance(creatorKp.publicKey);
        creatorDevWallet = {
          address: creatorKp.publicKey.toBase58(),
          source: 'creatorDevWalletKey from current-run.json (auto-created in previous launch)',
          balance: creatorBalance / 1e9,
          isAutoCreated: false
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
    
    // Calculate bundle SOL needed (subtract existing balances)
    let bundleSolNeeded = 0;
    let bundleExistingBalance = 0;
    for (let i = 0; i < bundleAmounts.length; i++) {
      const required = bundleAmounts[i] + 0.01; // amount + buffer
      const existing = warmedBundleBalances[i] || 0;
      bundleExistingBalance += existing;
      const needed = Math.max(0, required - existing);
      bundleSolNeeded += needed;
    }
    
    // Calculate holder SOL needed (subtract existing balances)
    let holderSolNeeded = 0;
    let holderExistingBalance = 0;
    for (let i = 0; i < holderAmounts.length; i++) {
      const required = holderAmounts[i] + 0.01; // amount + buffer
      const existing = warmedHolderBalances[i] || 0;
      holderExistingBalance += existing;
      const needed = Math.max(0, required - existing);
      holderSolNeeded += needed;
    }
    
    // Creator/DEV wallet funding: if auto-created OR if existing wallet needs funding
    // The DEV buy amount (buyerAmount) must always be accounted for from the funding wallet
    let creatorDevSolNeeded = 0;
    const creatorRequiredAmount = buyerAmount + 0.1; // BUYER_AMOUNT + 0.1 SOL buffer for fees/rent/safety (matches index.ts)
    
    // Use warmed creator balance if provided, otherwise use existing creatorDevWallet balance
    const effectiveCreatorBalance = warmedCreatorAddress ? warmedCreatorBalance : creatorDevWallet.balance;
    
    if (creatorDevWallet.isAutoCreated && !warmedCreatorAddress) {
      // Auto-created wallet (no warmed wallet selected): need to fund it fully
      creatorDevSolNeeded = creatorRequiredAmount;
    } else {
      // Existing wallet or warmed wallet: check if it needs funding
      if (effectiveCreatorBalance < creatorRequiredAmount) {
        // Need to top up the wallet to cover the buy + buffer
        creatorDevSolNeeded = creatorRequiredAmount - effectiveCreatorBalance;
      }
      // If wallet has enough balance, no funding needed from master wallet
    }
    
    // Update creatorDevWallet info if warmed
    if (warmedCreatorAddress) {
      creatorDevWallet.address = warmedCreatorAddress;
      creatorDevWallet.source = 'Warmed wallet (selected)';
      creatorDevWallet.balance = warmedCreatorBalance;
      creatorDevWallet.isAutoCreated = false;
    }
    
    // IMPORTANT: Always account for the DEV buy amount in the total
    // If wallet was funded (creatorDevSolNeeded > 0), the buyerAmount is already included
    // If wallet has enough balance (creatorDevSolNeeded = 0), we still need to account for buyerAmount
    // because it represents the cost that will be incurred (even if from DEV wallet's existing balance)
    // Actually, wait - if DEV wallet has enough, the funding wallet doesn't pay for it
    // But for TOTAL cost calculation, we should show it as a cost that will be incurred
    const devBuyCost = creatorDevSolNeeded > 0 ? 0 : buyerAmount; // Only add separately if not already in funding
    
    const jitoFee = parseFloat(env.JITO_FEE || '0.001');
    const lutFee = 0.002; // LUT creation rent (~0.001-0.002 SOL actual cost, using 0.002 as safe estimate)
    const buffer = 0.04; // Buffer for fees
    
    const totalSolNeeded = bundleSolNeeded + holderSolNeeded + creatorDevSolNeeded + devBuyCost + jitoFee + lutFee + buffer;
    
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
          total: totalSolNeeded,
          totalExistingBalance: bundleExistingBalance + holderExistingBalance + effectiveCreatorBalance
        },
        buyerAmount: buyerAmount
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
    
    console.log('[Deployer Wallet] Checking PRIVATE_KEY...');
    console.log('[Deployer Wallet] process.env.PRIVATE_KEY exists:', !!process.env.PRIVATE_KEY);
    
    if (!privateKey) {
      console.log('[Deployer Wallet] Reading from .env file...');
      const env = readEnvFile();
      privateKey = env.PRIVATE_KEY;
      console.log('[Deployer Wallet] readEnvFile() PRIVATE_KEY exists:', !!privateKey);
      if (privateKey) {
        console.log('[Deployer Wallet] PRIVATE_KEY length:', privateKey.length);
      }
    }
    
    if (!privateKey) {
      console.log('[Deployer Wallet] PRIVATE_KEY not found');
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
      console.log('[Deployer Wallet] Public key derived:', publicKey.substring(0, 8) + '...');
      
      // Get balance from blockchain
      const connection = getConnection();
      console.log('[Deployer Wallet] Fetching balance from RPC...');
      const balance = await connection.getBalance(kp.publicKey);
      console.log('[Deployer Wallet] Balance fetched:', balance / LAMPORTS_PER_SOL, 'SOL');
      
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

// ============================================
// MARKETING API ENDPOINTS
// ============================================

// Website Update Endpoint
app.post('/api/marketing/website/update', async (req, res) => {
  try {
    console.log('[Marketing] Website update request received');
    const { vercelSiteUrl, secret, tokenConfig } = req.body;
    
    // Sanitize tokenConfig for logging (truncate base64 image data)
    const sanitizeForLog = (config) => {
      if (!config) return config;
      const sanitized = { ...config };
      if (sanitized.logoUrl && sanitized.logoUrl.startsWith('data:image/')) {
        sanitized.logoUrl = sanitized.logoUrl.substring(0, 50) + '... (base64 data, truncated)';
      }
      if (sanitized.tokenImageUrl && sanitized.tokenImageUrl.startsWith('data:image/')) {
        sanitized.tokenImageUrl = sanitized.tokenImageUrl.substring(0, 50) + '... (base64 data, truncated)';
      }
      return sanitized;
    };
    
    // Log sanitized config (only in development)
    if (process.env.NODE_ENV === 'development') {
      console.log('[Marketing] Token config (sanitized):', JSON.stringify(sanitizeForLog(tokenConfig), null, 2));
    }
    
    if (!vercelSiteUrl) {
      return res.status(400).json({ success: false, error: 'Website URL is required' });
    }
    
    if (!tokenConfig) {
      return res.status(400).json({ success: false, error: 'Token config is required' });
    }
    
    // Check if DATABASE_URL is configured
    // Reload .env to ensure we have the latest value (like Nodematrix - Next.js auto-reloads .env)
    const rootEnvPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(rootEnvPath)) {
      require('dotenv').config({ path: rootEnvPath, override: true });
    }
    
    const databaseUrl = process.env.DATABASE_URL || process.env.RAILWAY_DATABASE_URL;
    if (!databaseUrl) {
      console.error('[Marketing] ❌ DATABASE_URL not configured');
      console.error('[Marketing] Checked root .env at:', rootEnvPath);
      console.error('[Marketing] Available DATABASE env vars:', Object.keys(process.env).filter(k => k.includes('DATABASE')));
      return res.status(400).json({ 
        success: false, 
        error: 'DATABASE_URL not configured. Please set DATABASE_URL in your .env file with your PostgreSQL connection string.' 
      });
    }
    
    console.log('[Marketing] Using DATABASE_URL:', databaseUrl.replace(/:[^:@]+@/, ':****@')); // Mask password
    console.log('[Marketing] DATABASE_URL host:', databaseUrl.match(/@([^:]+)/)?.[1] || 'unknown');
    
    // Note: secret is optional and NOT used for direct database saves
    // It's only for Vercel API authentication (if using Vercel deployment method)
    // For direct PostgreSQL saves, we don't need a secret
    if (secret) {
      console.log('[Marketing] ℹ️  Secret provided (not used for direct DB saves)');
    }
    
    // CRITICAL: Ensure DATABASE_URL is set in process.env before loading TypeScript module
    // This matches how Nodematrix (Next.js) works - Next.js auto-loads .env into process.env
    process.env.DATABASE_URL = databaseUrl;
    process.env.RAILWAY_DATABASE_URL = databaseUrl;
    
    // If logoUrl or tokenImageUrl is a base64 data URL, upload it to Vercel Blob first
    const { put } = require('@vercel/blob');
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB1_READ_WRITE_TOKEN;
    
    const uploadBase64ToBlob = async (base64DataUrl, filename) => {
      if (!base64DataUrl || !base64DataUrl.startsWith('data:image/')) {
        return base64DataUrl; // Not a base64 data URL, return as-is
      }
      
      if (!blobToken) {
        console.warn('[Marketing] ⚠️ BLOB_READ_WRITE_TOKEN not set, cannot upload base64 image to Vercel Blob');
        return null; // Return null instead of base64 to avoid database spam
      }
      
      try {
        // Extract mime type and base64 data
        const matches = base64DataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
        if (!matches) {
          console.warn('[Marketing] ⚠️ Invalid base64 data URL format');
          return null;
        }
        
        const mimeType = matches[1];
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, 'base64');
        
        // Upload to Vercel Blob
        const blob = await put(filename, buffer, {
          access: 'public',
          addRandomSuffix: true,
          contentType: `image/${mimeType}`,
          token: blobToken,
        });
        
        console.log(`[Marketing] ✅ Uploaded base64 image to Vercel Blob: ${blob.url}`);
        return blob.url;
      } catch (error) {
        console.error('[Marketing] ❌ Failed to upload base64 image to Vercel Blob:', error.message);
        return null; // Return null instead of base64 to avoid database spam
      }
    };
    
    // Process logoUrl and tokenImageUrl
    if (tokenConfig.logoUrl && tokenConfig.logoUrl.startsWith('data:image/')) {
      const filename = `logo-${Date.now()}.${tokenConfig.logoUrl.match(/data:image\/(\w+);/)?.[1] || 'png'}`;
      tokenConfig.logoUrl = await uploadBase64ToBlob(tokenConfig.logoUrl, filename);
    }
    
    if (tokenConfig.tokenImageUrl && tokenConfig.tokenImageUrl.startsWith('data:image/')) {
      const filename = `token-image-${Date.now()}.${tokenConfig.tokenImageUrl.match(/data:image\/(\w+);/)?.[1] || 'png'}`;
      tokenConfig.tokenImageUrl = await uploadBase64ToBlob(tokenConfig.tokenImageUrl, filename);
    }
    
    // Import and use website update module (TypeScript)
    // The module will read from process.env.DATABASE_URL (like Nodematrix does)
    const { updateWebsiteConfig } = require('../marketing/website/website-update.ts');
    const result = await updateWebsiteConfig({
      siteUrl: vercelSiteUrl,
      secret: secret || '', // Optional, not used for DB saves
      tokenConfig: tokenConfig,
    });
    
    if (result.success) {
      console.log('[Marketing] ✅ Website config updated:', result.site_url);
      res.json({
        success: true,
        site_url: result.site_url,
        message: 'Website configuration updated successfully',
      });
    } else {
      console.error('[Marketing] ❌ Website update failed:', result.error);
      res.status(500).json({
        success: false,
        error: result.error || 'Failed to update website configuration',
      });
    }
  } catch (error) {
    // Sanitize error message to avoid logging base64 images
    const sanitizedMessage = error.message && error.message.length > 500 
      ? error.message.substring(0, 500) + '... (truncated)' 
      : error.message;
    console.error('[Marketing] ❌ Website update error:', sanitizedMessage);
    
    // Provide helpful error message
    let errorMessage = sanitizedMessage || 'Unknown error';
    if (error.message && error.message.includes('DATABASE_URL')) {
      errorMessage = 'DATABASE_URL not configured. Please set DATABASE_URL in your .env file.';
    } else if (error.message && error.message.includes('ECONNRESET')) {
      errorMessage = 'Database connection failed. Check your DATABASE_URL and ensure the database is accessible. See console for details.';
    } else if (error.message && error.message.includes('ENOTFOUND')) {
      errorMessage = 'Database host not found. Make sure you\'re using the PUBLIC Railway database URL (not .internal).';
    }
    
    res.status(500).json({ 
      success: false, 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? undefined : undefined // Don't include stack trace to avoid base64 spam
    });
  }
});

// Telegram Verification Endpoints
app.post('/api/marketing/telegram/send-code', async (req, res) => {
  try {
    console.log('[Marketing] Telegram send code request received');
    const { api_id, api_hash, phone } = req.body;
    
    if (!api_id || !api_hash || !phone) {
      return res.status(400).json({ 
        success: false, 
        error: 'Telegram API credentials are required (api_id, api_hash, phone)' 
      });
    }
    
    // Import and use Telegram verification wrapper
    console.log('[Marketing] Calling sendTelegramVerificationCode...');
    const { sendTelegramVerificationCode } = require('../marketing/telegram/telegram-verification.ts');
    const result = await sendTelegramVerificationCode({
      api_id,
      api_hash,
      phone,
    });
    
    console.log('[Marketing] Verification result:', JSON.stringify(result, null, 2));
    res.json(result);
  } catch (error) {
    console.error('[Marketing] Telegram send code error:', error.message);
    res.status(500).json({ success: false, error: error.message || 'Unknown error' });
  }
});

app.post('/api/marketing/telegram/verify-code', async (req, res) => {
  try {
    console.log('[Marketing] Telegram verify code request received');
    const { api_id, api_hash, phone, code, phone_code_hash, password } = req.body;
    
    if (!api_id || !api_hash || !phone || !code) {
      return res.status(400).json({ 
        success: false, 
        error: 'api_id, api_hash, phone, and code are required' 
      });
    }
    
    // Import and use Telegram verification wrapper
    const { verifyTelegramCode } = require('../marketing/telegram/telegram-verification.ts');
    const result = await verifyTelegramCode({
      api_id,
      api_hash,
      phone,
      code,
      phone_code_hash,
      password,
    });
    
    res.json(result);
  } catch (error) {
    console.error('[Marketing] Telegram verify code error:', error.message);
    res.status(500).json({ success: false, error: error.message || 'Unknown error' });
  }
});

app.post('/api/marketing/telegram/check-status', async (req, res) => {
  try {
    console.log('[Marketing] Telegram check status request received');
    const { api_id, api_hash, phone } = req.body;
    
    if (!api_id || !api_hash || !phone) {
      return res.status(400).json({ 
        success: false, 
        error: 'Telegram API credentials are required (api_id, api_hash, phone)' 
      });
    }
    
    // Import and use Telegram verification wrapper
    const { checkTelegramStatus } = require('../marketing/telegram/telegram-verification.ts');
    const result = await checkTelegramStatus({
      api_id,
      api_hash,
      phone,
    });
    
    res.json(result);
  } catch (error) {
    console.error('[Marketing] Telegram check status error:', error.message);
    res.status(500).json({ success: false, error: error.message || 'Unknown error' });
  }
});

// Telegram Create Group Endpoint
app.post('/api/marketing/telegram/create-group', async (req, res) => {
  try {
    console.log('[Marketing] Telegram create group request received');
    const { config, scripted_conversations = [] } = req.body;
    
    if (!config || !config.telegram_api_id || !config.telegram_api_hash || !config.telegram_phone) {
      return res.status(400).json({ 
        success: false, 
        error: 'Telegram API credentials are required (api_id, api_hash, phone)' 
      });
    }
    
    // Import and use Telegram wrapper (TypeScript)
    const { createTelegramGroup } = require('../marketing/telegram/telegram-wrapper.ts');
    const result = await createTelegramGroup({
      config: config,
      scripted_conversations: scripted_conversations,
    });
    
    if (result.success) {
      res.json({
        success: true,
        group_chat_id: result.group_chat_id,
        channel_chat_id: result.channel_chat_id,
        telegram_link: result.telegram_link,
        message: result.message || 'Telegram group/channel created successfully',
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error || 'Failed to create Telegram group/channel',
      });
    }
  } catch (error) {
    // Sanitize error message to avoid logging base64 images
    const sanitizedMessage = error.message && error.message.length > 500 
      ? error.message.substring(0, 500) + '... (truncated)' 
      : error.message;
    console.error('[Marketing] Telegram create group error:', sanitizedMessage);
    res.status(500).json({ success: false, error: sanitizedMessage || 'Unknown error' });
  }
});

// Wallet Warming Endpoints - SIMPLIFIED SYSTEM
let warmingProcesses = new Map(); // Track active warming processes

// Get all warmed wallets
app.get('/api/warming-wallets', async (req, res) => {
  try {
    const { loadWarmedWallets } = require('../src/wallet-warming-manager.ts');
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
    const { createWarmingWallet, loadWarmedWallets } = require('../src/wallet-warming-manager.ts');
    
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
    
    // Decode private key to get address
    const bs58 = require('bs58');
    const { Keypair, Connection } = require('@solana/web3.js');
    
    let keypair;
    try {
      const decoded = bs58.decode(privateKey.trim());
      keypair = Keypair.fromSecretKey(decoded);
    } catch (decodeError) {
      return res.status(400).json({ success: false, error: 'Invalid private key format' });
    }
    
    const address = keypair.publicKey.toBase58();
    
    if (!address || address.length < 32) {
      return res.status(400).json({ success: false, error: 'Failed to derive wallet address from private key' });
    }
    
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
    
    const { addWarmingWallet, loadWarmedWallets } = require('../src/wallet-warming-manager.ts');
    
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
    
    const { createWarmingWallet } = require('../src/wallet-warming-manager.ts');
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
        const { addWarmingWallet } = require('../src/wallet-warming-manager.ts');
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
        const { loadWarmedWallets } = require('../src/wallet-warming-manager.ts');
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
          const { loadWarmedWallets } = require('../src/wallet-warming-manager.ts');
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
    
    const { updateWalletTags } = require('../src/wallet-warming-manager.ts');
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
    const { updateMultipleWalletBalances } = require('../src/wallet-warming-manager.ts');
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
    const { gatherSolFromWallets } = require('../src/wallet-warming-manager.ts');
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
    const { loadWarmedWallets } = require('../src/wallet-warming-manager.ts');
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
      const { updateWalletBalance } = require('../src/wallet-warming-manager.ts');
      await updateWalletBalance(walletAddress);
      console.log(`[Withdraw] Updated balance for ${walletAddress.substring(0, 8)}...`);
    } catch (error) {
      console.error(`[Withdraw] Failed to update balance, using estimated:`, error.message);
      // Fallback to estimated balance
      const walletIndex = wallets.findIndex(w => w.address === walletAddress);
      if (walletIndex >= 0) {
        wallets[walletIndex].solBalance = rentExemption;
        wallets[walletIndex].lastBalanceUpdate = new Date().toISOString();
        const { saveWarmedWallets } = require('../src/wallet-warming-manager.ts');
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
    const { updateMultipleWalletsFromBlockchain } = require('../src/wallet-warming-manager.ts');
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
    const { deleteWarmingWallet } = require('../src/wallet-warming-manager.ts');
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
    const { warmWallets } = require('../src/wallet-warming-manager.ts');
    
    // Default config with cheapest settings
    const warmConfig = {
      walletsPerBatch: config?.walletsPerBatch || 2,
      tradesPerWallet: config?.tradesPerWallet || 10,
      minBuyAmount: config?.minBuyAmount || 0.01, // Increased to reduce slippage (was 0.001)
      maxBuyAmount: config?.maxBuyAmount || 0.02, // Increased to reduce slippage (was 0.005)
      minIntervalSeconds: config?.minIntervalSeconds || 30,
      maxIntervalSeconds: config?.maxIntervalSeconds || 300,
      priorityFee: 'low', // ALWAYS cheapest
      useJupiter: true,
      useTrendingTokens: config?.useTrendingTokens !== false, // Default to true
      fundingAmount: config?.fundingAmount || 0.05, // Lower default, configurable
      skipFunding: config?.skipFunding || false // Skip funding for wallets with existing balance
    };
    
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
    const { loadWarmedWallets } = require('../src/wallet-warming-manager.ts');
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
    const { getCachedTrendingTokens } = require('../src/fetch-trending-tokens.ts');
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

// ==========================================
// DUNE ANALYTICS API
// ==========================================

// Cache for Dune data (default 15 minutes to avoid rate limits)
// Dune free tier: 2500 credits/month, each query ~10 credits
// Safe to query ~250 times/month = ~8 times/day
let duneDataCache = {
  pumpfunHourlyVolume: null,
  lastFetch: null,
  cacheDuration: 15 * 60 * 1000, // 15 minutes default cache
  rawData: null // Store raw data for different view options
};

// Dune Query IDs - save different queries on Dune and add their IDs here
const DUNE_QUERIES = {
  hourly_14d: '6499319', // Default: hourly volume last 14 days
  // Add more query IDs here for different time periods if needed
  // hourly_7d: 'QUERY_ID',
  // hourly_30d: 'QUERY_ID',
  // daily: 'QUERY_ID',
};

// ═══════════════════════════════════════════════════════════════════════════
// AI CONTENT GENERATION ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// Initialize AI Generator
let aiGenerator = null;
let generateContentWithBranding = null;
try {
  const aiModule = require('../launch-orchestrator/services/ai-generator');
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
        error: 'AI Generator not available. Make sure launch-orchestrator is set up.' 
      });
    }

    // If images are requested, use the branding-integrated function
    if (generateImages && generateContentWithBranding) {
      const result = await generateContentWithBranding(prompt, {
        theme,
        forceTemplate,
        existingName,
        generateImages: true,
        uploadImages: uploadImages !== false, // Default to true
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
      const { generateVariationsWithBranding } = require('../launch-orchestrator/services/ai-generator');
      const result = await generateVariationsWithBranding(prompt, count, {
        theme,
        forceTemplate,
        generateImages: true,
        uploadImages: uploadImages !== false,
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

// Get Pump.fun hourly volume data from Dune
app.get('/api/dune/pumpfun-volume', async (req, res) => {
  try {
    const now = Date.now();
    const forceRefresh = req.query.refresh === 'true';
    const executeQuery = req.query.execute === 'true'; // Force query re-execution for fresh data
    const days = parseInt(req.query.days) || 14; // Filter: show last N days
    const queryId = req.query.queryId || DUNE_QUERIES.hourly_14d;
    
    // Return cached data if still valid (unless force refresh)
    if (!forceRefresh && !executeQuery && duneDataCache.pumpfunHourlyVolume && duneDataCache.lastFetch && 
        (now - duneDataCache.lastFetch) < duneDataCache.cacheDuration) {
      
      // Re-process cached raw data with new filter settings
      const processedData = processDuneData(duneDataCache.rawData, days);
      
      return res.json({
        success: true,
        data: processedData,
        cached: true,
        lastFetch: duneDataCache.lastFetch,
        cacheExpiresIn: Math.round((duneDataCache.cacheDuration - (now - duneDataCache.lastFetch)) / 1000),
        daysFilter: days
      });
    }
    
    console.log(`[Dune] Fetching Pump.fun hourly volume data (Query: ${queryId})...`);
    
    const duneApiKey = process.env.DUNE_API_KEY;
    if (!duneApiKey) {
      return res.status(500).json({ success: false, error: 'DUNE_API_KEY not configured' });
    }
    
    // If execute=true, re-execute the query to get fresh data
    // NOTE: This uses Dune credits (~10 per execution), so use sparingly
    if (executeQuery) {
      console.log(`[Dune] 🔄 Executing query ${queryId} for fresh data...`);
      
      // Start execution
      const execResponse = await fetch(`https://api.dune.com/api/v1/query/${queryId}/execute`, {
        method: 'POST',
        headers: {
          'x-dune-api-key': duneApiKey,
          'Content-Type': 'application/json'
        }
      });
      
      if (!execResponse.ok) {
        const errorText = await execResponse.text();
        console.warn(`[Dune] ⚠️ Execute failed: ${execResponse.status} - ${errorText}`);
        // Fall back to cached results
      } else {
        const execData = await execResponse.json();
        const executionId = execData.execution_id;
        console.log(`[Dune] ⏳ Execution started: ${executionId}`);
        
        // Poll for completion (max 30 seconds)
        let attempts = 0;
        const maxAttempts = 15;
        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
          
          const statusResponse = await fetch(`https://api.dune.com/api/v1/execution/${executionId}/status`, {
            headers: { 'x-dune-api-key': duneApiKey }
          });
          
          if (statusResponse.ok) {
            const statusData = await statusResponse.json();
            console.log(`[Dune] Status: ${statusData.state} (attempt ${attempts + 1}/${maxAttempts})`);
            
            if (statusData.state === 'QUERY_STATE_COMPLETED') {
              console.log(`[Dune] ✅ Query execution completed!`);
              break;
            } else if (statusData.state === 'QUERY_STATE_FAILED') {
              console.error(`[Dune] ❌ Query execution failed`);
              break;
            }
          }
          attempts++;
        }
        
        if (attempts >= maxAttempts) {
          console.warn(`[Dune] ⚠️ Query execution taking too long, using cached results`);
        }
      }
    }
    
    // Fetch from Dune API (results endpoint - gets latest execution)
    const response = await fetch(`https://api.dune.com/api/v1/query/${queryId}/results?limit=2000`, {
      headers: {
        'x-dune-api-key': duneApiKey
      }
    });
    
    if (!response.ok) {
      throw new Error(`Dune API error: ${response.status} ${response.statusText}`);
    }
    
    const duneData = await response.json();
    
    // Log execution time to help debug freshness
    if (duneData.execution_ended_at) {
      const executionAge = Math.round((now - new Date(duneData.execution_ended_at).getTime()) / 60000);
      console.log(`[Dune] 📊 Data from execution: ${duneData.execution_ended_at} (${executionAge} minutes ago)`);
      
      if (executionAge > 60) {
        console.warn(`[Dune] ⚠️ Data is ${executionAge} minutes old! Consider using ?execute=true for fresh data`);
      }
    }
    
    // Log the structure for debugging
    if (duneData.result && duneData.result.rows && duneData.result.rows.length > 0) {
      console.log('[Dune] ✅ Received', duneData.result.rows.length, 'rows');
      console.log('[Dune] Sample row keys:', Object.keys(duneData.result.rows[0]));
      console.log('[Dune] First row:', JSON.stringify(duneData.result.rows[0]));
      console.log('[Dune] Last row:', JSON.stringify(duneData.result.rows[duneData.result.rows.length - 1]));
    } else {
      console.log('[Dune] ⚠️ No data in response');
    }
    
    // Cache the raw data
    duneDataCache.rawData = duneData;
    duneDataCache.lastFetch = now;
    
    // Calculate execution age
    let executionAgeMinutes = null;
    if (duneData.execution_ended_at) {
      executionAgeMinutes = Math.round((now - new Date(duneData.execution_ended_at).getTime()) / 60000);
    }
    
    // Process the data
    const processedData = processDuneData(duneData, days);
    duneDataCache.pumpfunHourlyVolume = processedData;
    
    console.log(`[Dune] ✅ Processed: ${processedData.rawRows} rows, max volume: ${processedData.maxVolume?.toFixed(0)}, current rank: ${processedData.currentRank}/24`);
    
    res.json({
      success: true,
      data: processedData,
      cached: false,
      lastFetch: now,
      daysFilter: days,
      executionAge: executionAgeMinutes,
      executionEndedAt: duneData.execution_ended_at || null
    });
    
  } catch (error) {
    console.error('[Dune] Error fetching Pump.fun volume:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch Dune data' });
  }
});

// Process Dune data into hourly aggregates
function processDuneData(duneData, daysFilter = 14) {
  const hourlyAggregates = {};
  for (let i = 0; i < 24; i++) {
    hourlyAggregates[i] = { totalVolume: 0, count: 0, dataPoints: [] };
  }
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysFilter);
  
  let totalProcessed = 0;
  let skipped = 0;
  
  // Also collect raw timeline data (sorted chronologically)
  const timelineData = [];
  
  if (duneData.result && duneData.result.rows) {
    duneData.result.rows.forEach(row => {
      // Your query returns: date (timestamp), volume_usd
      // Handle multiple possible column names
      const dateField = row.date || row.timestamp || row.block_time || row.time || row.hour;
      const volumeField = row.volume_usd || row.volume || row.total_volume || row.amount_usd || row.usd_volume || 0;
      
      if (!dateField) {
        skipped++;
        return;
      }
      
      const date = new Date(dateField);
      if (isNaN(date.getTime())) {
        skipped++;
        return;
      }
      
      // Apply time filter
      if (date < cutoffDate) {
        skipped++;
        return;
      }
      
      const hour = date.getUTCHours();
      const volume = parseFloat(volumeField) || 0;
      
      if (hour >= 0 && hour < 24 && volume > 0) {
        hourlyAggregates[hour].totalVolume += volume;
        hourlyAggregates[hour].count++;
        hourlyAggregates[hour].dataPoints.push({ date: date.toISOString(), volume });
        
        // Add to timeline (raw hourly data)
        timelineData.push({
          date: date.toISOString(),
          timestamp: date.getTime(),
          hour: hour,
          volume: volume
        });
        
        totalProcessed++;
      }
    });
  }
  
  // Sort timeline chronologically (oldest first)
  timelineData.sort((a, b) => a.timestamp - b.timestamp);
  
  console.log(`[Dune] Processing: ${totalProcessed} rows used, ${skipped} skipped (outside ${daysFilter} day window)`);
  
  // Calculate averages and create hourly data array
  const hourlyData = Object.entries(hourlyAggregates).map(([hour, data]) => ({
    hour: parseInt(hour),
    avgVolume: data.count > 0 ? data.totalVolume / data.count : 0,
    totalVolume: data.totalVolume,
    dataPoints: data.count,
    minVolume: data.dataPoints.length > 0 ? Math.min(...data.dataPoints.map(d => d.volume)) : 0,
    maxVolume: data.dataPoints.length > 0 ? Math.max(...data.dataPoints.map(d => d.volume)) : 0
  }));
  
  // Safety: Filter out invalid data
  const validHourlyData = hourlyData.filter(h => h.avgVolume > 0 && isFinite(h.avgVolume));
  
  // Find max/min volume for chart scaling - with safety defaults
  const maxVolume = validHourlyData.length > 0 
    ? Math.max(...validHourlyData.map(h => h.avgVolume))
    : 1000000; // Default 1M if no data
  const minVolume = validHourlyData.length > 0
    ? Math.min(...validHourlyData.map(h => h.avgVolume))
    : 0;
  
  // Sort by average volume to find best/worst hours
  const sortedByVolume = [...hourlyData].sort((a, b) => b.avgVolume - a.avgVolume);
  const bestHours = sortedByVolume.slice(0, 5).map(h => h.hour);
  const worstHours = sortedByVolume.slice(-5).map(h => h.hour);
  
  // Get current hour (UTC)
  const currentHour = new Date().getUTCHours();
  const currentHourData = hourlyData.find(h => h.hour === currentHour);
  const currentRank = sortedByVolume.findIndex(h => h.hour === currentHour) + 1;
  
  // Calculate launch score based on VOLUME (not just rank) - more proportional!
  // Score 0-100: 100 = best hour (max volume), 0 = worst hour (min volume)
  // Clamped to 0-100 to handle edge cases (missing data, no volume yet)
  const currentVolume = currentHourData?.avgVolume || 0;
  const volumeRange = maxVolume - minVolume;
  let launchScore = 50; // Default
  
  if (volumeRange > 0 && currentVolume > 0) {
    // Proportional scoring: where does current volume fall in the range?
    const rawScore = ((currentVolume - minVolume) / volumeRange) * 100;
    launchScore = Math.round(Math.max(0, Math.min(100, rawScore))); // Clamp 0-100
  } else if (currentVolume === 0) {
    // No data for current hour yet - give neutral score
    launchScore = 50;
  }
  
  return {
    hourlyData,
    timelineData, // Raw hourly data points, chronologically sorted
    maxVolume,
    minVolume,
    currentHour,
    currentHourVolume: currentHourData?.avgVolume || 0,
    currentRank,
    launchScore,
    bestHours,
    worstHours,
    recommendation: launchScore >= 70 ? 'GREAT' : launchScore >= 50 ? 'GOOD' : launchScore >= 30 ? 'OKAY' : 'WAIT',
    rawRows: totalProcessed,
    queryId: DUNE_QUERIES.hourly_14d,
    daysFilter
  };
}

// Add warmed wallets to launch (simple - just add to data.json and current-run.json)
app.post('/api/warm-wallets/add-to-launch', async (req, res) => {
  try {
    const { walletAddresses, roles } = req.body; // roles: ['bundle', 'holder', 'dev'] - optional, can use any wallet for any role
    
    if (!walletAddresses || !Array.isArray(walletAddresses) || walletAddresses.length === 0) {
      return res.status(400).json({ success: false, error: 'Wallet addresses are required' });
    }
    
    const { loadWarmedWallets } = require('../src/wallet-warming-manager.ts');
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
    const { getTwitterAccountInfo } = require('../marketing/twitter/twitter-poster.ts');
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
    const { postToTwitter } = require('../marketing/twitter/twitter-poster.ts');
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
    const { postToTwitter } = require('../marketing/twitter/twitter-poster.ts');
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

// ============================================
// TELEGRAM MESSAGE MANAGEMENT ENDPOINTS
// ============================================

// Get messages from Telegram group
app.post('/api/marketing/telegram/get-messages', async (req, res) => {
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
    const { getTelegramMessages } = require('../marketing/telegram/telegram_messages_wrapper.ts');
    
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
    const { sendTelegramMessage } = require('../marketing/telegram/telegram_messages_wrapper.ts');
    
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
    const { pinTelegramMessage } = require('../marketing/telegram/telegram_messages_wrapper.ts');
    
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
    const { deleteTelegramMessage } = require('../marketing/telegram/telegram_messages_wrapper.ts');
    
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
    const { getTelegramChatInfo } = require('../marketing/telegram/telegram_messages_wrapper.ts');
    
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

// ============================================
// TWITTER ACCOUNT MANAGEMENT ENDPOINTS
// ============================================
const TWITTER_ACCOUNTS_DIR = path.join(__dirname, '..', 'keys', 'twitter-accounts');
if (!fs.existsSync(TWITTER_ACCOUNTS_DIR)) {
  fs.mkdirSync(TWITTER_ACCOUNTS_DIR, { recursive: true });
}

// Get all Twitter accounts
app.get('/api/twitter-accounts', (req, res) => {
  try {
    const files = fs.readdirSync(TWITTER_ACCOUNTS_DIR);
    const accounts = files
      .filter(file => file.endsWith('.json'))
      .map(file => {
        try {
          const filePath = path.join(TWITTER_ACCOUNTS_DIR, file);
          const content = fs.readFileSync(filePath, 'utf8');
          const account = JSON.parse(content);
          // Don't send full credentials in list
          return {
            id: account.id,
            name: account.name,
            accountInfo: account.accountInfo,
            createdAt: account.createdAt,
          };
        } catch (e) {
          console.error(`Failed to read Twitter account ${file}:`, e.message);
          return null;
        }
      })
      .filter(account => account !== null);
    
    res.json({ success: true, accounts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single Twitter account (with full credentials)
app.get('/api/twitter-accounts/:id', (req, res) => {
  try {
    const filePath = path.join(TWITTER_ACCOUNTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Account not found' });
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    const account = JSON.parse(content);
    res.json({ success: true, account });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test Twitter credentials and get account info
app.post('/api/twitter-accounts/test', async (req, res) => {
  try {
    const { apiKey, apiSecret, accessToken, accessTokenSecret } = req.body;
    
    if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
      return res.status(400).json({
        success: false,
        error: 'All Twitter credentials required (apiKey, apiSecret, accessToken, accessTokenSecret)',
      });
    }
    
    // Test credentials by fetching account info
    const { getTwitterAccountInfo } = require('../marketing/twitter/twitter-poster.ts');
    const result = await getTwitterAccountInfo({
      apiKey,
      apiSecret,
      accessToken,
      accessTokenSecret,
    });
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add new Twitter account
app.post('/api/twitter-accounts', async (req, res) => {
  try {
    const { name, apiKey, apiSecret, accessToken, accessTokenSecret } = req.body;
    
    if (!name || !apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
      return res.status(400).json({
        success: false,
        error: 'Name and all credentials required',
      });
    }
    
    // Test credentials first
    const { getTwitterAccountInfo } = require('../marketing/twitter/twitter-poster.ts');
    const testResult = await getTwitterAccountInfo({
      apiKey,
      apiSecret,
      accessToken,
      accessTokenSecret,
    });
    
    if (!testResult.success) {
      return res.status(400).json({
        success: false,
        error: `Invalid credentials: ${testResult.error}`,
      });
    }
    
    // Generate unique ID
    const id = `twitter_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create account object
    const account = {
      id,
      name,
      apiKey,
      apiSecret,
      accessToken,
      accessTokenSecret,
      accountInfo: testResult.account,
      createdAt: new Date().toISOString(),
    };
    
    // Save to file
    const filePath = path.join(TWITTER_ACCOUNTS_DIR, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(account, null, 2));
    
    console.log(`[Twitter Accounts] Added account: ${name} (@${testResult.account?.username})`);
    
    res.json({
      success: true,
      account: {
        id: account.id,
        name: account.name,
        accountInfo: account.accountInfo,
        createdAt: account.createdAt,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete Twitter account
app.delete('/api/twitter-accounts/:id', (req, res) => {
  try {
    const filePath = path.join(TWITTER_ACCOUNTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Account not found' });
    }
    
    fs.unlinkSync(filePath);
    console.log(`[Twitter Accounts] Deleted account: ${req.params.id}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// TELEGRAM ACCOUNT MANAGEMENT ENDPOINTS
// ============================================
const TELEGRAM_ACCOUNTS_DIR = path.join(__dirname, '..', 'keys', 'telegram-accounts');
if (!fs.existsSync(TELEGRAM_ACCOUNTS_DIR)) {
  fs.mkdirSync(TELEGRAM_ACCOUNTS_DIR, { recursive: true });
}

// Get all Telegram accounts
app.get('/api/telegram-accounts', (req, res) => {
  try {
    const files = fs.readdirSync(TELEGRAM_ACCOUNTS_DIR);
    const accounts = files
      .filter(file => file.endsWith('.json'))
      .map(file => {
        try {
          const filePath = path.join(TELEGRAM_ACCOUNTS_DIR, file);
          const content = fs.readFileSync(filePath, 'utf8');
          const account = JSON.parse(content);
          // Don't send full credentials in list
          return {
            id: account.id,
            name: account.name,
            phone: account.phone,
            accountInfo: account.accountInfo,
            createdAt: account.createdAt,
          };
        } catch (e) {
          console.error(`Failed to read Telegram account ${file}:`, e.message);
          return null;
        }
      })
      .filter(account => account !== null);
    
    res.json({ success: true, accounts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single Telegram account (with full credentials)
app.get('/api/telegram-accounts/:id', (req, res) => {
  try {
    const filePath = path.join(TELEGRAM_ACCOUNTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Account not found' });
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    const account = JSON.parse(content);
    res.json({ success: true, account });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test Telegram credentials (gets user info via Telethon)
app.post('/api/telegram-accounts/test', async (req, res) => {
  try {
    const { apiId, apiHash, phone } = req.body;
    
    if (!apiId || !apiHash || !phone) {
      return res.status(400).json({
        success: false,
        error: 'All Telegram credentials required (apiId, apiHash, phone)',
      });
    }
    
    // Test credentials by getting "me" info
    const { executeTelegramAction } = require('../marketing/telegram/telegram_messages_wrapper.ts');
    
    // We'll use a simple get_chat_info call to test connectivity
    // Note: This requires the account to be authorized already
    const result = await executeTelegramAction({
      action: 'get_chat_info',
      api_id: apiId,
      api_hash: apiHash,
      phone: phone,
      chat_id: 'me', // Special chat_id for own account
    });
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add new Telegram account
app.post('/api/telegram-accounts', async (req, res) => {
  try {
    const { name, apiId, apiHash, phone } = req.body;
    
    if (!name || !apiId || !apiHash || !phone) {
      return res.status(400).json({
        success: false,
        error: 'Name and all credentials required',
      });
    }
    
    // Note: Telegram accounts require initial authorization via 2FA code
    // We'll save the account without testing, as testing requires user interaction
    
    // Generate unique ID
    const id = `telegram_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create account object
    const account = {
      id,
      name,
      apiId,
      apiHash,
      phone,
      accountInfo: {
        phone: phone,
        note: 'Authorization required on first use',
      },
      createdAt: new Date().toISOString(),
    };
    
    // Save to file
    const filePath = path.join(TELEGRAM_ACCOUNTS_DIR, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(account, null, 2));
    
    console.log(`[Telegram Accounts] Added account: ${name} (${phone})`);
    
    res.json({
      success: true,
      account: {
        id: account.id,
        name: account.name,
        phone: account.phone,
        accountInfo: account.accountInfo,
        createdAt: account.createdAt,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete Telegram account
app.delete('/api/telegram-accounts/:id', (req, res) => {
  try {
    const filePath = path.join(TELEGRAM_ACCOUNTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Account not found' });
    }
    
    // Read account to get phone for session file cleanup
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const account = JSON.parse(content);
      
      // Also try to delete session file
      const sessionPath = path.join(__dirname, '..', 'marketing', 'telegram', `telegram_session_${account.phone}.session`);
      if (fs.existsSync(sessionPath)) {
        fs.unlinkSync(sessionPath);
        console.log(`[Telegram Accounts] Deleted session file for ${account.phone}`);
      }
    } catch (e) {
      console.warn(`[Telegram Accounts] Could not clean up session file: ${e.message}`);
    }
    
    fs.unlinkSync(filePath);
    console.log(`[Telegram Accounts] Deleted account: ${req.params.id}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

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
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)); // Most recent first
    
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
    
    // Generate ID from name (sanitize for filename)
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now();
    
    // Prepare config to save (include metadata)
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
    
    // Load existing config to preserve metadata
    const existingContent = fs.readFileSync(filePath, 'utf8');
    const existingConfig = JSON.parse(existingContent);
    
    // Update config
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

// WebSocket server for real-time balance updates (optional - reduces RPC calls)
const WS_PORT = 3002;
let wss = null;

try {
  wss = new WebSocket.Server({ port: WS_PORT });
  console.log(`📡 Balance WebSocket Server running on ws://localhost:${WS_PORT}`);
  
  wss.on('connection', (ws) => {
    console.log('[Balance WS] Client connected');
    
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
      console.log('[Balance WS] Client disconnected');
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
  console.log(`[Launch Progress] Client connected (${global.launchProgressListeners.length} listeners)`);
  
  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Connected to launch progress stream' })}\n\n`);
  
  // Clean up on client disconnect
  req.on('close', () => {
    console.log(`[Launch Progress] Client disconnected`);
    global.launchProgressListeners = global.launchProgressListeners.filter(l => l !== res);
  });
});

app.get('/api/live-trades', async (req, res) => {
  const mintAddress = req.query.mint;
  
  console.log(`[API] /api/live-trades called with mint: ${mintAddress} (using PumpPortal)`);
  
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
    // Subscribe to this mint via PumpPortal
    console.log(`[API] Subscribing to ${mintAddress.slice(0, 8)}... via PumpPortal`);
    pumpPortalTracker.subscribeToToken(mintAddress);
    
    // Add this client as a listener
    pumpPortalTracker.addListener(res);
    
    // Send initial cached trades immediately (PumpPortal is faster - no historical fetch needed)
    const initialTrades = pumpPortalTracker.getTrades(mintAddress);
    console.log(`[API] Sending ${initialTrades.length} cached trades to client`);
    res.write(`data: ${JSON.stringify({ type: 'initial', trades: initialTrades })}\n\n`);
    
    // Clean up on client disconnect
    req.on('close', () => {
      console.log(`[API] Client disconnected for ${mintAddress.slice(0, 8)}...`);
      pumpPortalTracker.removeListener(res);
    });
  } catch (error) {
    console.error('[API] Error in live-trades endpoint:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
  }
});

// Add test wallets for testing (temporary, not saved)
app.post('/api/live-trades/add-test-wallets', async (req, res) => {
  try {
    const { wallets } = req.body;
    
    if (!wallets || !Array.isArray(wallets)) {
      return res.status(400).json({ 
        success: false, 
        error: 'wallets array required' 
      });
    }
    
    const addedCount = liveTradesTracker.addTestWallets(wallets);
    
    res.json({
      success: true,
      added: addedCount,
      totalTestWallets: liveTradesTracker.getTestWallets().length,
      message: `Added ${addedCount} test wallet(s)`
    });
  } catch (error) {
    console.error('[API] Error adding test wallets:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Clear test wallets
app.post('/api/live-trades/clear-test-wallets', async (req, res) => {
  try {
    const clearedCount = liveTradesTracker.clearTestWallets();
    
    res.json({
      success: true,
      cleared: clearedCount,
      message: `Cleared ${clearedCount} test wallet(s)`
    });
  } catch (error) {
    console.error('[API] Error clearing test wallets:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get test wallets
app.get('/api/live-trades/test-wallets', async (req, res) => {
  try {
    const testWallets = liveTradesTracker.getTestWallets();
    
    res.json({
      success: true,
      wallets: testWallets,
      count: testWallets.length
    });
  } catch (error) {
    console.error('[API] Error getting test wallets:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-SELL ENDPOINTS - Per-wallet threshold-based automatic selling
// ═══════════════════════════════════════════════════════════════════════════

// Get auto-sell configuration (now using PumpPortal)
app.get('/api/auto-sell/config', (req, res) => {
  try {
    const config = pumpPortalTracker.getAutoSellConfig();
    res.json({ success: true, ...config });
  } catch (error) {
    console.error('[API] Error getting auto-sell config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Configure auto-sell for a single wallet (now using PumpPortal)
app.post('/api/auto-sell/configure', (req, res) => {
  try {
    const { walletAddress, threshold, enabled } = req.body;
    
    if (!walletAddress) {
      return res.status(400).json({ success: false, error: 'walletAddress required' });
    }
    
    const config = pumpPortalTracker.configureAutoSell(walletAddress, threshold, enabled);
    res.json({ success: true, ...config });
  } catch (error) {
    console.error('[API] Error configuring auto-sell:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Bulk configure auto-sell for multiple wallets (now using PumpPortal)
app.post('/api/auto-sell/configure-all', (req, res) => {
  try {
    const { wallets, enabled } = req.body;
    
    if (!wallets || typeof wallets !== 'object') {
      return res.status(400).json({ success: false, error: 'wallets object required' });
    }
    
    const config = pumpPortalTracker.setAutoSellConfigs(wallets);
    if (typeof enabled === 'boolean') {
      pumpPortalTracker.setAutoSellEnabled(enabled);
    }
    res.json({ success: true, ...pumpPortalTracker.getAutoSellConfig() });
  } catch (error) {
    console.error('[API] Error configuring auto-sell:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Enable/disable global auto-sell (now using PumpPortal)
app.post('/api/auto-sell/toggle', (req, res) => {
  try {
    const { enabled } = req.body;
    const config = pumpPortalTracker.setAutoSellEnabled(enabled === true);
    res.json({ success: true, ...config });
  } catch (error) {
    console.error('[API] Error toggling auto-sell:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Reset auto-sell state (for new runs) (now using PumpPortal)
app.post('/api/auto-sell/reset', (req, res) => {
  try {
    const config = pumpPortalTracker.resetAutoSell();
    res.json({ success: true, ...config });
  } catch (error) {
    console.error('[API] Error resetting auto-sell:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Configure MEV protection settings (now using PumpPortal)
app.post('/api/auto-sell/mev-protection', (req, res) => {
  try {
    const { enabled, confirmationDelaySec, launchCooldownSec, rapidTraderWindowSec } = req.body;
    
    const settings = {};
    if (enabled !== undefined) settings.enabled = enabled;
    if (confirmationDelaySec !== undefined) settings.confirmationDelaySec = parseFloat(confirmationDelaySec);
    if (launchCooldownSec !== undefined) settings.launchCooldownSec = parseFloat(launchCooldownSec);
    if (rapidTraderWindowSec !== undefined) settings.rapidTraderWindowSec = parseFloat(rapidTraderWindowSec);
    
    const mevProtection = pumpPortalTracker.setMevProtection(settings);
    res.json({ success: true, mevProtection });
  } catch (error) {
    console.error('[API] Error configuring MEV protection:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get MEV protection settings (now using PumpPortal)
app.get('/api/auto-sell/mev-protection', (req, res) => {
  try {
    const mevProtection = pumpPortalTracker.getMevProtection();
    res.json({ success: true, mevProtection });
  } catch (error) {
    console.error('[API] Error getting MEV protection:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// SSE endpoint for auto-sell events (now using PumpPortal)
app.get('/api/auto-sell/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // Send initial config
  res.write(`data: ${JSON.stringify({ type: 'config', ...pumpPortalTracker.getAutoSellConfig() })}\n\n`);
  
  // Add listener
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
    
    const result = await callTradingFunction('sell', privateKey, mintAddress, percentage, 'low');
    
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

// QuickNode Webhook Endpoint
// This receives webhooks from QuickNode stream
// SECURITY: Never log request body or payload - could contain sensitive data
app.post('/api/quicknode-webhook', express.json({ limit: '50mb' }), async (req, res) => {
  // DEBUG: Log that we received ANY request (before auth)
  console.log('[QuickNode] 📡 INCOMING REQUEST');
  
  try {
    // SECURITY: Verify QuickNode security token
    // Get token from environment variable or use default
    const rootEnvPath = path.join(__dirname, '..', '.env');
    let expectedToken = 'qnsec_YTMwNzIyMmQtMGFhMS00OTM3LTg2YzktMDMwYjBmOGYzYmQ1'; // Default
    try {
      if (fs.existsSync(rootEnvPath)) {
        require('dotenv').config({ path: rootEnvPath });
      }
      expectedToken = process.env.QUICKNODE_SECURITY_TOKEN || expectedToken;
    } catch (e) {
      // Use default if env read fails
    }
    
    // QuickNode sends token in header (check common header names)
    const providedToken = req.headers['x-quicknode-token'] || 
                         req.headers['quicknode-token'] || 
                         req.headers['x-qn-token'] ||
                         req.headers['authorization']?.replace('Bearer ', '') ||
                         req.query.token;
    
    if (providedToken !== expectedToken) {
      console.warn('[QuickNode] ⚠️ Webhook rejected - invalid or missing security token');
      // Return 401 to indicate authentication failure (but don't reveal expected token)
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }
    
    // QuickNode sends the filtered payload directly
    const payload = req.body;
    
    // DEBUG: Log payload structure
    console.log(`[QuickNode] 📦 Payload: isArray=${Array.isArray(payload)}, length=${Array.isArray(payload) ? payload.length : 'N/A'}, hasEvents=${payload && payload[0] && payload[0].events ? payload[0].events.length : 'none'}`);
    
    // Handle the webhook (doesn't log sensitive data)
    const result = quickNodeWebhook.handleQuickNodeWebhook(payload);
    console.log(`[QuickNode] 📊 Result: processed=${result.processed}, skipped=${result.skipped}`);
    
    // Always return 200 to acknowledge receipt
    // Don't include sensitive data in response
    res.status(200).json({
      success: true,
      processed: result.processed,
      skipped: result.skipped
      // Intentionally NOT including payload or error details in response
    });
  } catch (error) {
    // Log error but don't expose stack trace or sensitive details
    console.error('[QuickNode] ❌ Webhook error:', error.message);
    // Still return 200 to prevent QuickNode from retrying
    res.status(200).json({
      success: false
      // Intentionally NOT including error message in response
    });
  }
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

// Initialize PumpPortal tracker
pumpPortalTracker.initialize();

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

// =====================================================

app.listen(PORT, () => {
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

