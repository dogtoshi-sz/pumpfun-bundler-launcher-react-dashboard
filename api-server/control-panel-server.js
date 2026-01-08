const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
// Handle bs58 v6 export format (same as other files in project)
const base58 = require('bs58').default || require('bs58');
const { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } = require('@solana/spl-token');
const WebSocket = require('ws');
const liveTradesTracker = require('./live-trades-tracker');

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
// Increase JSON body size limit to handle base64 images (10MB)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files from image directory
const imageDir = path.join(__dirname, '..', 'image');
app.use('/image', express.static(imageDir));

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
      console.log('Found .env file at:', envPath);
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
  
  console.log('Loaded', Object.keys(env).length, 'environment variables from .env');
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
      
      // If this key needs to be updated, replace the line
      if (keysToUpdate.has(key)) {
        const newValue = env[key];
        // Preserve original line format (whitespace before =) if possible
        const originalKeyPart = line.substring(0, line.indexOf('='));
        const preservedKey = originalKeyPart.trim() === key ? originalKeyPart : key;
        const newLine = `${preservedKey}=${newValue}`;
        updatedLines.push(newLine);
        keysUpdated.add(key);
        console.log(`[Settings] Updated ${key}=${newValue}`);
        console.log(`[Settings]   Old line: "${line}"`);
        console.log(`[Settings]   New line: "${newLine}"`);
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
  for (const key of keysToUpdate) {
    if (!keysUpdated.has(key)) {
      const newValue = env[key];
      updatedLines.push(`${key}=${newValue}`);
      console.log(`[Settings] Added new key ${key}=${newValue}`);
    }
  }
  
  // Write file with proper line endings (preserve original if possible, otherwise use \n)
  const lineEnding = existingContent.includes('\r\n') ? '\r\n' : '\n';
  const finalContent = updatedLines.join(lineEnding);
  
  try {
    // Force write with explicit encoding
    fs.writeFileSync(envPath, finalContent, { encoding: 'utf8', flag: 'w' });
    
    // Verify write by reading back immediately
    const verifyContent = fs.readFileSync(envPath, 'utf8');
    if (verifyContent !== finalContent) {
      console.error(`[Settings] WARNING: File content mismatch after write!`);
      console.error(`[Settings] Expected length: ${finalContent.length}, Got: ${verifyContent.length}`);
    }
    
    console.log(`[Settings] Successfully wrote .env file at: ${envPath}`);
    console.log(`[Settings] File size: ${finalContent.length} bytes`);
    console.log(`[Settings] Updated keys: ${Array.from(keysUpdated).join(', ')}`);
    
    // Log specific key updates for debugging
    for (const key of keysUpdated) {
      console.log(`[Settings] ✅ ${key} = ${env[key]}`);
    }
    
    // CRITICAL: Log the absolute path so user knows exactly where it saved
    const absolutePath = path.resolve(envPath);
    console.log(`[Settings] 📁 ABSOLUTE PATH: ${absolutePath}`);
    console.log(`[Settings] 📁 Verify by opening: ${absolutePath}`);
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
    console.log('[Settings] Returning', Object.keys(env).length, 'settings');
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
    
    // Handle warmed wallets if provided
    const { useWarmedWallets, creatorWalletAddress, bundleWalletAddresses, holderWalletAddresses, holderWalletAutoBuyAddresses, holderWalletAutoBuyIndices, holderWalletAutoBuyDelays } = req.body || {};
    if (useWarmedWallets && (creatorWalletAddress || bundleWalletAddresses || holderWalletAddresses)) {
      console.log(`[Launch] Using warmed wallets:`);
      console.log(`   Creator wallet: ${creatorWalletAddress ? '1' : '0'}`);
      console.log(`   Bundle wallets: ${bundleWalletAddresses?.length || 0}`);
      console.log(`   Holder wallets: ${holderWalletAddresses?.length || 0}`);
      
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
        creatorWalletKey: creatorWalletKey || null,
        creatorWalletAddress: creatorWalletAddress || null,
        bundleWalletKeys,
        holderWalletKeys,
        bundleWalletAddresses: bundleWalletAddresses || [],
        holderWalletAddresses: holderWalletAddresses || [],
        holderWalletAutoBuyKeys: holderWalletAutoBuyKeys,
        holderWalletAutoBuyAddresses: holderWalletAutoBuyAddressesList,
        holderWalletAutoBuyDelays: holderWalletAutoBuyDelays || null,
        createdAt: new Date().toISOString()
      };
      fs.writeFileSync(warmedWalletsPath, JSON.stringify(warmedWalletsData, null, 2));
      
      console.log(`[Launch] Saved warmed wallets to ${warmedWalletsPath}:`);
      console.log(`   Creator wallet: ${creatorWalletKey ? '✅ Found' : '❌ Not selected or not found'}`);
      if (creatorWalletKey) {
        console.log(`   Creator address: ${creatorWalletAddress}`);
      }
      console.log(`   Bundle wallets: ${bundleWalletKeys.length}`);
      console.log(`   Holder wallets: ${holderWalletKeys.length} (${holderWalletAutoBuyKeys.length} selected for auto-buy)`);
      if (holderWalletAutoBuyDelays) {
        console.log(`   Auto-buy delays config: ${holderWalletAutoBuyDelays}`);
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
      // Don't inherit stdio so it doesn't interfere with API server output
      // The output will go to the terminal where the API server is running
    });
    
    // Log process info
    console.log(`[Launch] Child process started with PID: ${childProcess.pid}`);
    console.log(`[Launch] Working directory: ${projectRoot}`);
    
    // Don't wait for completion - return immediately
    // The launch process will run in background and output to the API server's terminal
    res.json({ 
      success: true, 
      message: 'Token launch started. Check API server terminal for progress.',
      pid: childProcess.pid,
      workingDirectory: projectRoot
    });
    
    // Log output for debugging (optional - goes to API server console)
    childProcess.stdout.on('data', (data) => {
      console.log(`[Launch] stdout: ${data.toString().trim()}`);
    });
    
    childProcess.stderr.on('data', (data) => {
      console.error(`[Launch] stderr: ${data.toString().trim()}`);
    });
    
    childProcess.on('close', (code) => {
      console.log(`[Launch] Process exited with code ${code}`);
    });
    
    childProcess.on('error', (error) => {
      console.error(`[Launch] Process error:`, error);
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
  
  // Prepare all public keys first
  const walletData = walletKeys.map(privateKey => {
    const kp = Keypair.fromSecretKey(base58.decode(privateKey));
    return { kp, address: kp.publicKey.toBase58(), privateKey };
  });
  
  // Batch fetch SOL balances using getMultipleAccountsInfo (single RPC call)
  const publicKeys = walletData.map(w => w.kp.publicKey);
  const solAccountInfos = await connection.getMultipleAccountsInfo(publicKeys);
  
  const mintPubkey = new PublicKey(mintAddress);
  
  // Get token account addresses for all wallets
  const tokenAccountAddresses = await Promise.all(
    walletData.map(w => getAssociatedTokenAddress(mintPubkey, w.kp.publicKey, true).catch(() => null))
  );
  
  // Batch fetch token account info (use getParsedAccountInfo in parallel)
  const validTokenAccounts = tokenAccountAddresses.filter(addr => addr !== null);
  const tokenAccountPromises = validTokenAccounts.map(addr => 
    connection.getParsedAccountInfo(addr).catch(() => null)
  );
  const tokenAccountInfos = await Promise.all(tokenAccountPromises);
  
  // Create a map for quick lookup
  const tokenAccountMap = new Map();
  validTokenAccounts.forEach((addr, idx) => {
    const accountInfo = tokenAccountInfos[idx];
    if (accountInfo && accountInfo.value && accountInfo.value.data && accountInfo.value.data.parsed) {
      tokenAccountMap.set(addr.toBase58(), accountInfo.value.data.parsed.info.tokenAmount.uiAmount || 0);
    }
  });
  
  // Process results
  for (let i = 0; i < walletData.length; i++) {
    try {
      const wallet = walletData[i];
      const cacheKey = `${wallet.address}_${mintAddress}`;
      
      // Check cache first (3 second TTL)
      const cached = balanceCache.get(cacheKey);
      if (cached && now - cached.timestamp < CACHE_TTL) {
        wallets.push({
          address: wallet.address,
          privateKey: wallet.privateKey,
          solBalance: cached.solBalance,
          tokenBalance: cached.tokenBalance
        });
        continue;
      }
      
      // Get SOL balance from batch result
      const solBalance = solAccountInfos[i] ? 
        (solAccountInfos[i].lamports || 0) / LAMPORTS_PER_SOL : 0;
      
      // Get token balance from batch result
      let tokenBalance = 0;
      const tokenAccountAddr = tokenAccountAddresses[i];
      if (tokenAccountAddr) {
        tokenBalance = tokenAccountMap.get(tokenAccountAddr.toBase58()) || 0;
      }
      
      // Cache the result
      balanceCache.set(cacheKey, {
        solBalance,
        tokenBalance,
        timestamp: now
      });
      
      wallets.push({
        address: wallet.address,
        privateKey: wallet.privateKey,
        solBalance,
        tokenBalance: tokenBalance || 0
      });
    } catch (error) {
      console.error(`Error processing wallet ${i}:`, error);
      wallets.push({
        address: walletData[i].address,
        privateKey: walletData[i].privateKey,
        solBalance: 0,
        tokenBalance: 0
      });
    }
  }
  
  return wallets;
}

// Get holder wallets with balances (optimized with batch fetching and caching)
app.get('/api/holder-wallets', async (req, res) => {
  try {
    // Use __dirname to ensure we're reading from project root, not api-server directory
    const currentRunPath = path.join(__dirname, '..', 'keys', 'current-run.json');
    
    if (!fs.existsSync(currentRunPath)) {
      return res.json({ success: true, wallets: [], mintAddress: null });
    }
    
    const currentRun = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
    const mintAddress = currentRun.mintAddress;
    
    if (!mintAddress) {
      return res.json({ success: true, wallets: [], mintAddress: null });
    }
    
    // Get all wallet types
    const holderWalletKeys = currentRun.holderWalletKeys || [];
    const bundleWalletKeys = currentRun.bundleWalletKeys || [];
    
    // Get DEV/Creator wallet - PRIORITY: creatorDevWalletKey from current-run.json, FALLBACK: BUYER_WALLET from .env
    let devWalletKey = null;
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
    
    // Fetch balances for all wallets
    const allWalletKeys = [];
    const walletTypes = [];
    
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
    
    // Add dev wallet if exists
    if (devWalletKey) {
      allWalletKeys.push(devWalletKey);
      walletTypes.push('dev');
    }
    
    // Use batch fetching for efficiency
    const wallets = await batchFetchBalances(allWalletKeys, mintAddress);
    
    // Add wallet type tags
    wallets.forEach((wallet, index) => {
      wallet.type = walletTypes[index] || 'unknown';
      wallet.privateKey = allWalletKeys[index]; // Include private key for trading
    });
    
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

// Buy tokens with holder wallet
app.post('/api/holder-wallet/buy', async (req, res) => {
  try {
    const { privateKey, mintAddress, solAmount, referrerPrivateKey, priorityFee } = req.body;
    
    if (!privateKey || !mintAddress || !solAmount) {
      return res.status(400).json({ success: false, error: 'Missing required parameters' });
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
      const walletAddress = walletKp.publicKey.toBase58();
      
      const result = await callTradingFunction('buyTokenSimple', ...args);
      
      // Invalidate cache after buy
      invalidateBalanceCache(walletAddress, mintAddress);
      
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
    const { privateKey, mintAddress, percentage, priorityFee } = req.body;
    
    if (!privateKey || !mintAddress || percentage === undefined) {
      return res.status(400).json({ success: false, error: 'Missing required parameters' });
    }
    
    // Use the wrapper function directly
    const { callTradingFunction } = require('./call-trading-function');
    
    try {
      const walletKp = Keypair.fromSecretKey(base58.decode(privateKey));
      const walletAddress = walletKp.publicKey.toBase58();
      const feeLevel = priorityFee === 'ultra' ? 'ultra' : priorityFee === 'high' ? 'high' : priorityFee === 'medium' ? 'medium' : priorityFee === 'none' ? 'none' : 'low'; // Default to 'low'
      
      const result = await callTradingFunction('sellTokenSimple', privateKey, mintAddress, parseFloat(percentage), feeLevel);
      
      // Invalidate cache after sell
      invalidateBalanceCache(walletAddress, mintAddress);
      
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
    const longRunningCommands = ['gather', 'gather-all', 'gather-last', 'rapid-sell', 'rapid-sell-50-percent', 'rapid-sell-remaining'];
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

// Get launch wallet info and SOL requirements
app.get('/api/launch-wallet-info', async (req, res) => {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    const env = readEnvFile();
    
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
    const bundleSolNeeded = bundleAmounts.reduce((sum, amount) => sum + amount + 0.01, 0);
    const holderSolNeeded = holderAmounts.reduce((sum, amount) => sum + amount + 0.01, 0);
    
    // Creator/DEV wallet funding: if auto-created OR if existing wallet needs funding
    // The DEV buy amount (buyerAmount) must always be accounted for from the funding wallet
    let creatorDevSolNeeded = 0;
    const creatorRequiredAmount = buyerAmount + 0.1; // BUYER_AMOUNT + 0.1 SOL buffer for fees/rent/safety (matches index.ts)
    if (creatorDevWallet.isAutoCreated) {
      // Auto-created wallet: need to fund it fully (buyerAmount + 0.1 buffer)
      creatorDevSolNeeded = creatorRequiredAmount;
    } else {
      // Existing wallet: check if it needs funding
      if (creatorDevWallet.balance < creatorRequiredAmount) {
        // Need to top up the wallet to cover the buy + buffer
        creatorDevSolNeeded = creatorRequiredAmount - creatorDevWallet.balance;
      }
      // If wallet has enough balance, no funding needed from master wallet
      // The buy will use the DEV wallet's existing balance (not a cost to funding wallet)
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
          label: 'Bundle Wallets'
        },
        holderWallets: {
          count: holderWalletCount,
          amounts: holderAmounts,
          totalSol: holderSolNeeded,
          label: 'Holder Wallets'
        },
        breakdown: {
          bundleWallets: bundleSolNeeded,
          holderWallets: holderSolNeeded,
          creatorDevWallet: creatorDevSolNeeded,
          devBuyAmount: devBuyCost,
          jitoFee: jitoFee,
          lutFee: lutFee,
          buffer: buffer,
          total: totalSolNeeded
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
    console.log('[Warming] Loading wallets...');
    const { loadWarmedWallets } = require('../src/wallet-warming-manager.ts');
    const wallets = loadWarmedWallets();
    console.log(`[Warming] Loaded ${wallets.length} wallets`);
    
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

// Get private key for a specific wallet (secure - requires wallet address)
app.post('/api/warming-wallets/get-private-key', async (req, res) => {
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
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }
    
    if (!wallet.privateKey) {
      return res.status(404).json({ success: false, error: 'Private key not found for this wallet' });
    }
    
    res.json({
      success: true,
      privateKey: wallet.privateKey
    });
  } catch (error) {
    console.error('[Warming] Get private key error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to get private key' });
  }
});

// Create new wallet
app.post('/api/warming-wallets/create', async (req, res) => {
  try {
    const { tags } = req.body; // Optional tags array
    const { createWarmingWallet } = require('../src/wallet-warming-manager.ts');
    const wallet = createWarmingWallet(Array.isArray(tags) ? tags : []);
    
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
      }
    });
  } catch (error) {
    console.error('[Warming] Create wallet error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to create wallet' });
  }
});

// Add existing wallet
app.post('/api/warming-wallets/add', async (req, res) => {
  try {
    const { privateKey, tags } = req.body;
    if (!privateKey) {
      return res.status(400).json({ success: false, error: 'Private key is required' });
    }
    
    const { addWarmingWallet } = require('../src/wallet-warming-manager.ts');
    const wallet = addWarmingWallet(privateKey, tags || []);
    
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
      }
    });
  } catch (error) {
    console.error('[Warming] Add wallet error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to add wallet' });
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
    console.log('[Warming] Request body:', req.body);
    
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
    console.log('[Warming] Request body:', req.body);
    
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
    console.log('[Warming] Request body:', req.body);
    
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
      useTrendingTokens: config?.useTrendingTokens !== false // Default to true
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

app.get('/api/live-trades', async (req, res) => {
  const mintAddress = req.query.mint;
  
  console.log(`[API] /api/live-trades called with mint: ${mintAddress}`);
  
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
    // Start tracking this mint (this will fetch history)
    console.log(`[API] Starting tracking for ${mintAddress.slice(0, 8)}...`);
    await liveTradesTracker.startTracking(mintAddress);
    
    // Add this client as a listener
    liveTradesTracker.addListener(res);
    
    // Wait a bit for trades to load, then send initial trades
    setTimeout(() => {
      const initialTrades = liveTradesTracker.getTrades();
      console.log(`[API] Sending ${initialTrades.length} initial trades to client`);
      if (initialTrades.length > 0) {
        res.write(`data: ${JSON.stringify({ type: 'initial', trades: initialTrades })}\n\n`);
      } else {
        // Send empty array so frontend knows connection is working
        res.write(`data: ${JSON.stringify({ type: 'initial', trades: [] })}\n\n`);
      }
    }, 1000); // Wait 1 second for trades to load
    
    // Clean up on client disconnect
    req.on('close', () => {
      console.log(`[API] Client disconnected for ${mintAddress.slice(0, 8)}...`);
      liveTradesTracker.removeListener(res);
    });
  } catch (error) {
    console.error('[API] Error in live-trades endpoint:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
  }
});

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

