// Register ts-node to enable TypeScript imports
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    module: 'commonjs',
    esModuleInterop: true,
    skipLibCheck: true
  }
});

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { exec } = require('child_process');
const { promisify } = require('util');
const OpenAI = require('openai');
require('dotenv').config();

const execAsync = promisify(exec);
const app = express();
const PORT = 3001;

// Import WebSocket tracker for real-time transaction monitoring
const websocketTracker = require('./websocket-tracker');

// Initialize OpenAI
const openai = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
}) : null;

// ============================================================================
// UNIFIED .ENV CONFIGURATION
// ============================================================================
// Both terminal scripts AND this API server read from the SAME .env file.
// Terminal: Reads .env directly (via constants.ts or dotenv)
// Frontend: Reads .env via this API server (which filters out sensitive data)
//
// SECURITY: PRIVATE_KEY, RPC_ENDPOINT, OPENAI_API_KEY are NEVER included
// in configCache, so they can NEVER be exposed to the frontend.
// They are only used server-side when executing scripts.
// ============================================================================

// In-memory config cache (loaded from .env once, updated when config changes)
// NOTE: This cache ONLY includes safe, non-sensitive values that can be sent to frontend
let configCache = null;

// Helper function to read .env file and parse config
function readEnvConfig() {
  const envPath = path.join(__dirname, '..', '.env');
  const config = {};
  
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const lines = envContent.split('\n');
    lines.forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        config[key] = value;
      }
    });
  }
  
  return config;
}

// Initialize config cache on startup
// SECURITY: Only safe values are cached. PRIVATE_KEY, RPC_ENDPOINT, OPENAI_API_KEY
// are intentionally excluded and only used server-side.
function initializeConfigCache() {
  const rawConfig = readEnvConfig();
  configCache = {
    // Token info (safe to expose)
    tokenName: rawConfig.TOKEN_NAME || '',
    tokenSymbol: rawConfig.TOKEN_SYMBOL || '',
    description: rawConfig.DESCRIPTION || '',
    showName: rawConfig.TOKEN_SHOW_NAME || '',
    twitter: rawConfig.TWITTER || '',
    telegram: rawConfig.TELEGRAM || '',
    website: rawConfig.WEBSITE || '',
    // Wallet config (safe to expose)
    distributionWalletNum: parseInt(rawConfig.DISTRIBUTION_WALLETNUM) || 10,
    swapAmount: parseFloat(rawConfig.SWAP_AMOUNT) || 0.3,
    swapAmounts: rawConfig.SWAP_AMOUNTS || '',
    buyerAmount: parseFloat(rawConfig.BUYER_AMOUNT) || 0.1,
    // Options (safe to expose)
    vanityMode: rawConfig.VANITY_MODE === 'true',
    lilJitMode: rawConfig.LIL_JIT_MODE === 'true',
    // Auto actions (safe to expose)
    autoRapidSell: rawConfig.AUTO_RAPID_SELL === 'true',
    autoSell50Percent: rawConfig.AUTO_SELL_50_PERCENT === 'true',
    autoGather: rawConfig.AUTO_GATHER === 'true',
    autoCollectFees: rawConfig.AUTO_COLLECT_FEES === 'true'
    // NOTE: PRIVATE_KEY, RPC_ENDPOINT, OPENAI_API_KEY are intentionally NOT included
    // They are only used server-side and never exposed to frontend
  };
  console.log('Config cache initialized (safe values only, no private keys):', Object.keys(configCache));
}

// Initialize cache on server start
initializeConfigCache();

app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());

// Log all requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '..', 'image');
    fs.ensureDirSync(uploadPath);
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'token-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

// Helper function to update .env file
function updateEnvFile(updates) {
  const envPath = path.join(__dirname, '..', '.env');
  let envContent = fs.readFileSync(envPath, 'utf8');
  
  Object.entries(updates).forEach(([key, value]) => {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
      envContent += `\n${key}=${value}`;
    }
  });
  
  fs.writeFileSync(envPath, envContent);
}

// Helper function to run TypeScript/Node scripts
async function runScript(scriptPath, args = {}) {
  const scriptDir = path.join(__dirname, '..');
  
  // Try to find ts-node in node_modules
  const tsNodePath = path.join(scriptDir, 'node_modules', '.bin', 'ts-node');
  const tsNodeExists = fs.existsSync(tsNodePath + '.cmd') || fs.existsSync(tsNodePath);
  
  let command;
  if (tsNodeExists) {
    // Use local ts-node
    const tsNodeCmd = process.platform === 'win32' ? 'ts-node.cmd' : 'ts-node';
    command = `cd "${scriptDir}" && npx ${tsNodeCmd} ${scriptPath}`;
  } else {
    // Fallback to npm script or global ts-node
    command = `cd "${scriptDir}" && npx ts-node ${scriptPath}`;
  }
  
  console.log(`Executing command: ${command}`);
  console.log(`Working directory: ${scriptDir}`);
  
  return new Promise((resolve, reject) => {
    const childProcess = exec(command, { 
      maxBuffer: 10 * 1024 * 1024,
      cwd: scriptDir,
      env: { ...process.env },
      shell: true
    }, (error, stdout, stderr) => {
      if (error) {
        console.error('Script execution error:', error);
        console.error('stderr:', stderr);
        console.error('stdout:', stdout);
        reject({ error: error.message, stderr, stdout });
      } else {
        console.log('Script execution success:', stdout);
        resolve({ stdout, stderr });
      }
    });
    
    // Log output in real-time
    if (childProcess.stdout) {
      childProcess.stdout.on('data', (data) => {
        console.log(`[${scriptPath}] ${data}`);
      });
    }
    
    if (childProcess.stderr) {
      childProcess.stderr.on('data', (data) => {
        console.error(`[${scriptPath}] ERROR: ${data}`);
      });
    }
  });
}

// API Routes

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ success: true, message: 'API is working!' });
});

// Get next pump address (for preview before launch) - MOVED EARLY FOR TESTING
app.get('/api/next-pump-address', async (req, res) => {
  try {
    // Read pump-addresses.json directly with correct path
    const keysDir = path.join(__dirname, '..', 'keys');
    const pumpAddressesPath = path.join(keysDir, 'pump-addresses.json');
    
    console.log('Looking for pump addresses at:', pumpAddressesPath);
    console.log('File exists:', fs.existsSync(pumpAddressesPath));
    
    if (!fs.existsSync(pumpAddressesPath)) {
      console.error('pump-addresses.json not found at:', pumpAddressesPath);
      return res.json({ success: false, message: 'pump-addresses.json file not found' });
    }
    
    const data = fs.readFileSync(pumpAddressesPath, 'utf-8');
    const addresses = JSON.parse(data);
    
    console.log('Total addresses in file:', addresses.length);
    
    // Find first available address
    const available = addresses.find(addr => 
      addr.status === 'available' && !addr.used
    );
    
    console.log('Available address found:', available ? available.publicKey : 'none');
    
    if (!available) {
      // Log why no address was found
      const usedCount = addresses.filter(a => a.used).length;
      const unavailableCount = addresses.filter(a => a.status !== 'available').length;
      console.log(`Used: ${usedCount}, Unavailable: ${unavailableCount}`);
      return res.json({ success: false, message: 'No available pump addresses (all are used or unavailable)' });
    }
    
    res.json({ success: true, publicKey: available.publicKey });
  } catch (error) {
    console.error('Error getting next pump address:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get dev wallet address (public key only - safe to expose)
app.get('/api/dev-wallet-address', async (req, res) => {
  try {
    const envConfig = readEnvConfig();
    if (!envConfig.PRIVATE_KEY) {
      return res.json({ success: false, error: 'PRIVATE_KEY not set in .env' });
    }
    
    const base58 = require('bs58').default || require('bs58');
    const { Keypair } = require('@solana/web3.js');
    const keypair = Keypair.fromSecretKey(base58.decode(envConfig.PRIVATE_KEY));
    const publicKey = keypair.publicKey.toString();
    
    res.json({ success: true, address: publicKey });
  } catch (error) {
    console.error('Error getting dev wallet address:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get current status
app.get('/api/status', async (req, res) => {
  try {
    const keysPath = path.join(__dirname, '..', 'keys', 'data.json');
    const currentRunPath = path.join(__dirname, '..', 'keys', 'current-run.json');
    
    let walletCount = 0;
    let mintAddress = null;
    
    if (fs.existsSync(keysPath)) {
      const wallets = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
      walletCount = wallets.length;
    }
    
    // Read mint address from current-run.json (last successful launch)
    // This is the ACTUAL mint address that was created, not just the keypair
    if (fs.existsSync(currentRunPath)) {
      try {
        const currentRunData = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
        mintAddress = currentRunData.mintAddress || null;
      } catch (e) {
        console.error('Error reading current-run.json:', e);
        // Fallback to mint.json if current-run.json is invalid
        const mintPath = path.join(__dirname, '..', 'keys', 'mint.json');
        if (fs.existsSync(mintPath)) {
          const mints = JSON.parse(fs.readFileSync(mintPath, 'utf8'));
          if (mints.length > 0) {
            try {
              const base58 = require('bs58').default || require('bs58');
              const { Keypair } = require('@solana/web3.js');
              const kp = Keypair.fromSecretKey(base58.decode(mints[0]));
              mintAddress = kp.publicKey.toBase58();
            } catch (e2) {
              mintAddress = mints[0];
            }
          }
        }
      }
    }
    
    // Return cached config (updated when user changes it, not from static .env)
    res.json({
      walletCount,
      mintAddress,
      hasWallets: walletCount > 0,
      config: { ...configCache } // Return cached config, not from .env
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload image and update config
app.post('/api/upload-image', upload.single('image'), (req, res) => {
  try {
    console.log('Upload image request received');
    console.log('File:', req.file);
    
    if (!req.file) {
      console.log('No file in request');
      return res.status(400).json({ error: 'No image file provided' });
    }
    
    const imagePath = `./image/${req.file.filename}`;
    updateEnvFile({ FILE: imagePath });
    
    console.log('Image uploaded successfully:', imagePath);
    res.json({
      success: true,
      filename: req.file.filename,
      path: imagePath
    });
  } catch (error) {
    console.error('Upload image error:', error);
    res.status(500).json({ error: error.message });
  }
});

// AI Generate token info
app.post('/api/ai-generate', async (req, res) => {
  try {
    if (!openai) {
      return res.status(400).json({ error: 'OpenAI API key not configured. Add OPENAI_API_KEY to .env file.' });
    }

    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    console.log('AI generate request received:', prompt);

    const systemPrompt = `You are an expert at creating cryptocurrency token metadata for Solana tokens on Pump.fun. 
Generate professional, engaging token information based on the user's prompt.

Return ONLY a valid JSON object with these exact fields:
{
  "tokenName": "Full token name (2-4 words, catchy)",
  "tokenSymbol": "Ticker symbol (3-6 uppercase letters)",
  "description": "Compelling description (2-3 sentences, max 200 chars)",
  "showName": "Short display name (1-2 words)",
  "twitter": "Twitter/X URL - CREATE a realistic URL based on the token name/concept (format: https://x.com/tokenname or https://twitter.com/tokenname)",
  "telegram": "Telegram URL - CREATE a realistic URL based on the token name/concept (format: https://t.me/tokenname)",
  "website": "Website URL - CREATE a realistic URL based on the token name/concept (format: https://tokenname.com or https://tokenname.io)"
}

Guidelines:
- Token name should be memorable and brandable
- Symbol should be 3-6 uppercase letters, related to the name
- Description should be compelling, mention utility/vision, max 200 characters
- Show name is a shorter version for wallet display
- Social links: ALWAYS generate realistic URLs based on the token concept, even if not mentioned in prompt
  * Convert token name to lowercase, remove spaces/special chars for URLs
  * Make Twitter handle match the token theme
  * Make Telegram group match the token theme  
  * Make website domain match the token theme
  * Examples: "MoonDoge" -> twitter: "https://x.com/moondoge", telegram: "https://t.me/moondoge", website: "https://moondoge.io"
- Make it sound professional and crypto-native
- Be creative but realistic
- ALWAYS provide all three social links (twitter, telegram, website) - never leave them empty`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ],
      temperature: 0.8,
      max_tokens: 500
    });

    const responseText = completion.choices[0].message.content.trim();
    console.log('OpenAI response:', responseText);

    // Try to extract JSON from response (in case it's wrapped in markdown)
    let jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in AI response');
    }

    const tokenInfo = JSON.parse(jsonMatch[0]);

    // Validate required fields
    if (!tokenInfo.tokenName || !tokenInfo.tokenSymbol || !tokenInfo.description) {
      throw new Error('AI response missing required fields');
    }

    // Ensure URLs are valid or generate defaults
    if (!tokenInfo.twitter || !tokenInfo.twitter.startsWith('http')) {
      // Generate default Twitter URL from token name
      const handle = tokenInfo.tokenName.toLowerCase().replace(/[^a-z0-9]/g, '');
      tokenInfo.twitter = `https://x.com/${handle}`;
    }
    if (!tokenInfo.telegram || !tokenInfo.telegram.startsWith('http')) {
      // Generate default Telegram URL from token name
      const handle = tokenInfo.tokenName.toLowerCase().replace(/[^a-z0-9]/g, '');
      tokenInfo.telegram = `https://t.me/${handle}`;
    }
    if (!tokenInfo.website || !tokenInfo.website.startsWith('http')) {
      // Generate default website URL from token name
      const domain = tokenInfo.tokenName.toLowerCase().replace(/[^a-z0-9]/g, '');
      tokenInfo.website = `https://${domain}.io`;
    }

    console.log('Generated token info:', tokenInfo);
    res.json({ success: true, data: tokenInfo });

  } catch (error) {
    console.error('AI generate error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate token info' });
  }
});

// Update token configuration
app.post('/api/update-config', async (req, res) => {
  try {
    console.log('Update config request received:', req.body);
    
    const {
      tokenName,
      tokenSymbol,
      description,
      showName,
      twitter,
      telegram,
      website,
      distributionWalletNum,
      swapAmount,
      swapAmounts,
      buyerAmount,
      vanityMode,
      lilJitMode
    } = req.body;
    
    const updates = {};
    
    // Save all token info fields (including empty strings for optional fields)
    if (tokenName !== undefined) updates.TOKEN_NAME = `"${tokenName}"`;
    if (tokenSymbol !== undefined) updates.TOKEN_SYMBOL = `"${tokenSymbol}"`;
    if (description !== undefined) updates.DESCRIPTION = `'${description.replace(/'/g, "\\'")}'`; // Escape single quotes
    if (showName !== undefined) updates.TOKEN_SHOW_NAME = `"${showName}"`;
    // Social links can be empty strings - save them anyway
    if (twitter !== undefined) updates.TWITTER = twitter ? `"${twitter}"` : '""';
    if (telegram !== undefined) updates.TELEGRAM = telegram ? `"${telegram}"` : '""';
    if (website !== undefined) updates.WEBSITE = website ? `"${website}"` : '""';
    if (distributionWalletNum) {
      updates.DISTRIBUTION_WALLETNUM = distributionWalletNum;
      
      // CRITICAL: If wallet count changes, automatically adjust SWAP_AMOUNTS to match
      const newWalletCount = parseInt(distributionWalletNum) || 10;
      
      if (swapAmounts) {
        // If swapAmounts provided, trim or pad to match wallet count
        const amountsArray = swapAmounts.split(',').map(s => s.trim()).filter(s => s);
        const defaultAmount = swapAmount || 0.3;
        
        if (amountsArray.length > newWalletCount) {
          // Trim to new wallet count
          updates.SWAP_AMOUNTS = amountsArray.slice(0, newWalletCount).join(',');
          console.log(`⚠️  Trimmed SWAP_AMOUNTS from ${amountsArray.length} to ${newWalletCount} values`);
        } else if (amountsArray.length < newWalletCount) {
          // Pad with default amount
          while (amountsArray.length < newWalletCount) {
            amountsArray.push(String(defaultAmount));
          }
          updates.SWAP_AMOUNTS = amountsArray.join(',');
          console.log(`⚠️  Padded SWAP_AMOUNTS from ${swapAmounts.split(',').length} to ${newWalletCount} values`);
        } else {
          // Same length, use as-is
          updates.SWAP_AMOUNTS = swapAmounts;
        }
      } else {
        // No swapAmounts provided, create array matching wallet count
        const defaultAmount = swapAmount || 0.3;
        updates.SWAP_AMOUNTS = Array(newWalletCount).fill(String(defaultAmount)).join(',');
        console.log(`⚠️  Created new SWAP_AMOUNTS with ${newWalletCount} values (all ${defaultAmount})`);
      }
    } else {
      // Wallet count not changing, use swapAmounts as-is if provided
      if (swapAmounts) updates.SWAP_AMOUNTS = swapAmounts;
    }
    
    if (swapAmount) updates.SWAP_AMOUNT = swapAmount;
    if (buyerAmount !== undefined) updates.BUYER_AMOUNT = buyerAmount; // DEV buy amount
    if (vanityMode !== undefined) updates.VANITY_MODE = `"${vanityMode}"`;
    if (lilJitMode !== undefined) updates.LIL_JIT_MODE = `"${lilJitMode}"`;
    // Auto action settings
    if (req.body.autoRapidSell !== undefined) updates.AUTO_RAPID_SELL = `"${req.body.autoRapidSell}"`;
    if (req.body.autoSell50Percent !== undefined) updates.AUTO_SELL_50_PERCENT = `"${req.body.autoSell50Percent}"`;
    if (req.body.autoGather !== undefined) updates.AUTO_GATHER = `"${req.body.autoGather}"`;
    if (req.body.autoCollectFees !== undefined) updates.AUTO_COLLECT_FEES = `"${req.body.autoCollectFees}"`;
    
    console.log('Updating .env with:', updates);
    updateEnvFile(updates);
    
    // CRITICAL: Wait a moment to ensure .env file write completes
    // This prevents race conditions where launch-token reads stale .env values
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Update config cache immediately (after .env is written)
    // Token info
    if (tokenName !== undefined) configCache.tokenName = tokenName;
    if (tokenSymbol !== undefined) configCache.tokenSymbol = tokenSymbol;
    if (description !== undefined) configCache.description = description;
    if (showName !== undefined) configCache.showName = showName;
    if (twitter !== undefined) configCache.twitter = twitter;
    if (telegram !== undefined) configCache.telegram = telegram;
    if (website !== undefined) configCache.website = website;
    // Wallet config
    if (distributionWalletNum !== undefined) {
      configCache.distributionWalletNum = parseInt(distributionWalletNum) || 10;
    }
    if (swapAmount !== undefined) {
      configCache.swapAmount = parseFloat(swapAmount) || 0.3;
    }
    // Update swapAmounts in cache with the final value (after trimming/padding)
    if (updates.SWAP_AMOUNTS !== undefined) {
      configCache.swapAmounts = updates.SWAP_AMOUNTS;
    } else if (swapAmounts !== undefined) {
      configCache.swapAmounts = swapAmounts;
    }
    if (buyerAmount !== undefined) {
      configCache.buyerAmount = parseFloat(buyerAmount) || 0.1;
    }
    // Options
    if (vanityMode !== undefined) {
      configCache.vanityMode = vanityMode === true || vanityMode === 'true';
    }
    if (lilJitMode !== undefined) {
      configCache.lilJitMode = lilJitMode === true || lilJitMode === 'true';
    }
    // Update auto action settings in cache
    if (req.body.autoRapidSell !== undefined) {
      configCache.autoRapidSell = req.body.autoRapidSell === true || req.body.autoRapidSell === 'true';
    }
    if (req.body.autoSell50Percent !== undefined) {
      configCache.autoSell50Percent = req.body.autoSell50Percent === true || req.body.autoSell50Percent === 'true';
    }
    if (req.body.autoGather !== undefined) {
      configCache.autoGather = req.body.autoGather === true || req.body.autoGather === 'true';
    }
    if (req.body.autoCollectFees !== undefined) {
      configCache.autoCollectFees = req.body.autoCollectFees === true || req.body.autoCollectFees === 'true';
    }
    
    console.log('Configuration updated successfully. Cache:', configCache);
    res.json({ success: true, message: 'Configuration updated' });
  } catch (error) {
    console.error('Update config error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create and launch token
app.post('/api/launch-token', async (req, res) => {
  try {
    console.log('Launch token request received');
    const autoRapidSell = req.body.autoRapidSell !== undefined ? req.body.autoRapidSell : true; // Default to true
    const autoSell50Percent = req.body.autoSell50Percent !== undefined ? req.body.autoSell50Percent : false;
    const autoGather = req.body.autoGather !== undefined ? req.body.autoGather : false;
    const autoCollectFees = req.body.autoCollectFees !== undefined ? req.body.autoCollectFees : false;
    
    // Auto sell 50% takes precedence over auto rapid sell (mutually exclusive)
    const finalAutoRapidSell = autoSell50Percent ? false : autoRapidSell;
    
    console.log(`Auto rapid sell: ${finalAutoRapidSell ? 'ENABLED' : 'DISABLED'}`);
    console.log(`Auto sell 50%: ${autoSell50Percent ? 'ENABLED' : 'DISABLED'}`);
    console.log(`Auto gather: ${autoGather ? 'ENABLED' : 'DISABLED'}`);
    console.log(`Auto collect fees: ${autoCollectFees ? 'ENABLED' : 'DISABLED'}`);
    const scriptDir = path.join(__dirname, '..');
    
    // Update .env with auto action settings before launch
    updateEnvFile({
      AUTO_RAPID_SELL: `"${finalAutoRapidSell}"`,
      AUTO_SELL_50_PERCENT: `"${autoSell50Percent}"`,
      AUTO_GATHER: `"${autoGather}"`,
      AUTO_COLLECT_FEES: `"${autoCollectFees}"`
    });
    
    // CRITICAL: Reload .env file to ensure latest values are used
    // This ensures SWAP_AMOUNTS, BUYER_AMOUNT, and auto actions are up-to-date
    delete require.cache[require.resolve('dotenv')];
    require('dotenv').config({ path: path.join(scriptDir, '.env'), override: true });
    
    // Verify the values are loaded correctly
    console.log('📋 Current .env SWAP_AMOUNTS:', process.env.SWAP_AMOUNTS || '(not set)');
    console.log('📋 Current .env BUYER_AMOUNT:', process.env.BUYER_AMOUNT || '(not set)');
    console.log('📋 Current .env SWAP_AMOUNT:', process.env.SWAP_AMOUNT || '(not set)');
    console.log('📋 Current .env DISTRIBUTION_WALLETNUM:', process.env.DISTRIBUTION_WALLETNUM || '(not set)');
    console.log('📋 Current .env AUTO_RAPID_SELL:', process.env.AUTO_RAPID_SELL || '(not set)');
    console.log('📋 Current .env AUTO_SELL_50_PERCENT:', process.env.AUTO_SELL_50_PERCENT || '(not set)');
    console.log('📋 Current .env AUTO_GATHER:', process.env.AUTO_GATHER || '(not set)');
    console.log('📋 Current .env AUTO_COLLECT_FEES:', process.env.AUTO_COLLECT_FEES || '(not set)');
    
    // Validate that SWAP_AMOUNTS is set if we expect custom amounts
    if (!process.env.SWAP_AMOUNTS || process.env.SWAP_AMOUNTS.trim() === '') {
      console.warn('⚠️  WARNING: SWAP_AMOUNTS is empty! All wallets will use SWAP_AMOUNT fallback value.');
    }
    
    res.json({ success: true, message: 'Token launch started', processId: 'running' });
    
    // Use npm run start which is already configured
    const command = `cd "${scriptDir}" && npm run start`;
    console.log(`Executing: ${command}`);
    console.log('='.repeat(80));
    console.log('TOKEN LAUNCH PROCESS STARTED');
    console.log('='.repeat(80));
    
    // Run in background with real-time output
    // Pass updated env vars explicitly to ensure they're used
    const childProcess = exec(command, { 
      maxBuffer: 10 * 1024 * 1024,
      cwd: scriptDir,
      env: { ...process.env }, // This includes the reloaded .env values
      shell: true
    });
    
    // Stream stdout in real-time
    childProcess.stdout.on('data', (data) => {
      console.log(`[TOKEN LAUNCH] ${data}`);
    });
    
    // Stream stderr in real-time
    childProcess.stderr.on('data', (data) => {
      console.error(`[TOKEN LAUNCH ERROR] ${data}`);
    });
    
    // Handle completion
    childProcess.on('close', async (code) => {
      if (code === 0) {
        console.log('='.repeat(80));
        console.log('TOKEN LAUNCH COMPLETED SUCCESSFULLY');
        console.log('='.repeat(80));
        
        // AUTOMATIC RAPID SELL - Start immediately after successful launch (if enabled)
        // Only start rapid sell if launch actually succeeded (exit code 0)
        if (autoRapidSell) {
          try {
          // Read mint address from current-run.json
          const currentRunPath = path.join(scriptDir, 'keys', 'current-run.json');
          let mintAddress = null;
          
          if (fs.existsSync(currentRunPath)) {
            const currentRunData = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
            mintAddress = currentRunData.mintAddress || null;
          }
          
          if (mintAddress) {
            console.log('🚀🚀🚀 AUTOMATIC RAPID SELL STARTING... 🚀🚀🚀');
            console.log(`   Mint: ${mintAddress}`);
            console.log(`   Starting IMMEDIATELY (0ms wait) to beat all bots!`);
            
            // Start rapid sell with 0ms initial wait (instant start)
            const rapidSellCommand = `cd "${scriptDir}" && npm run rapid-sell "${mintAddress}" 0`;
            console.log(`Executing: ${rapidSellCommand}`);
            console.log('='.repeat(80));
            console.log('AUTOMATIC RAPID SELL PROCESS STARTED');
            console.log('='.repeat(80));
            
            const rapidSellProcess = exec(rapidSellCommand, {
              maxBuffer: 10 * 1024 * 1024,
              cwd: scriptDir,
              env: { ...process.env },
              shell: true
            });
            
            // Stream rapid sell output
            rapidSellProcess.stdout.on('data', (data) => {
              console.log(`[RAPID SELL] ${data}`);
            });
            
            rapidSellProcess.stderr.on('data', (data) => {
              console.error(`[RAPID SELL ERROR] ${data}`);
            });
            
            rapidSellProcess.on('close', (rapidSellCode) => {
              if (rapidSellCode === 0) {
                console.log('='.repeat(80));
                console.log('AUTOMATIC RAPID SELL COMPLETED SUCCESSFULLY');
                console.log('='.repeat(80));
              } else {
                console.error('='.repeat(80));
                console.error(`AUTOMATIC RAPID SELL FAILED WITH EXIT CODE: ${rapidSellCode}`);
                console.error('='.repeat(80));
              }
            });
            
            rapidSellProcess.on('error', (error) => {
              console.error('Automatic rapid sell process error:', error);
            });
          } else {
            console.warn('⚠️  Could not find mint address in current-run.json. Automatic rapid sell skipped.');
          }
        } catch (error) {
          console.error('Error starting automatic rapid sell:', error);
          console.error('Rapid sell will need to be triggered manually.');
        }
        } else {
          console.log('⏸️  Auto rapid sell is DISABLED. Rapid sell will not start automatically.');
          console.log('   Use the "⚡ RAPID SELL" button in the frontend to trigger it manually.');
        }
      } else {
        console.error('='.repeat(80));
        console.error(`❌ TOKEN LAUNCH FAILED WITH EXIT CODE: ${code}`);
        console.error('='.repeat(80));
        console.error('⚠️  Rapid sell will NOT start automatically because launch failed.');
        console.error('⚠️  Please check the logs above to see why the bundle submission failed.');
        console.error('='.repeat(80));
      }
    });
    
    childProcess.on('error', (error) => {
      console.error('Token launch process error:', error);
    });
    
  } catch (error) {
    console.error('Launch token endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Rapid sell BUNDLED - uses Jito bundling like token launch (FASTEST method)
app.post('/api/rapid-sell-bundled', async (req, res) => {
  try {
    console.log('Bundled rapid sell request received');
    const scriptDir = path.join(__dirname, '..');
    const mintAddress = req.body.mintAddress;
    const initialWait = req.body.initialWait !== undefined ? req.body.initialWait : 0;
    
    res.json({ success: true, message: 'Bundled rapid sell started (Jito bundling)', processId: 'running' });
    
    let command = `cd "${scriptDir}" && npm run rapid-sell-bundled`;
    if (mintAddress) {
      command += ` ${mintAddress}`;
      if (initialWait !== undefined) {
        command += ` ${initialWait}`;
      }
    } else if (initialWait !== undefined) {
      command += ` "" ${initialWait}`;
    }
    
    console.log(`Executing: ${command}`);
    console.log('='.repeat(80));
    console.log('🚀🚀🚀 BUNDLED RAPID SELL - Using Jito bundling like token launch!');
    console.log(`   Initial wait: ${initialWait}ms (${initialWait === 0 ? 'INSTANT' : 'minimal delay'})`);
    console.log('='.repeat(80));
    
    const childProcess = exec(command, { 
      maxBuffer: 10 * 1024 * 1024,
      cwd: scriptDir,
      env: { ...process.env },
      shell: true
    });
    
    childProcess.stdout.on('data', (data) => {
      console.log(`[RAPID-SELL-BUNDLED] ${data}`);
    });
    
    childProcess.stderr.on('data', (data) => {
      console.error(`[RAPID-SELL-BUNDLED ERROR] ${data}`);
    });
    
    childProcess.on('close', (code) => {
      console.log(`[RAPID-SELL-BUNDLED] Process exited with code ${code}`);
    });
    
  } catch (error) {
    console.error('Bundled rapid sell error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Rapid sell - ultra-fast parallel selling from all wallets (RACE MODE to beat bots)
app.post('/api/rapid-sell', async (req, res) => {
  try {
    console.log('Rapid sell request received');
    const scriptDir = path.join(__dirname, '..');
    const mintAddress = req.body.mintAddress; // Optional mint address
    const initialWait = req.body.initialWait !== undefined ? req.body.initialWait : 0; // Default: 0ms (INSTANT start - fires before bonding curve detected)
    
    res.json({ success: true, message: 'Rapid sell started (RACE MODE)', processId: 'running' });
    
    // Use npm run rapid-sell with optional parameters
    let command = `cd "${scriptDir}" && npm run rapid-sell`;
    if (mintAddress) {
      command += ` ${mintAddress}`;
      if (initialWait !== undefined) {
        command += ` ${initialWait}`;
      }
    } else if (initialWait !== undefined) {
      command += ` "" ${initialWait}`; // Empty string for mint, then wait time
    }
    
    console.log(`Executing: ${command}`);
    console.log('='.repeat(80));
    console.log('🚀🚀🚀 RACE MODE STARTED - Ultra-fast parallel selling to beat sniper bots!');
    console.log(`   Initial wait: ${initialWait}ms (${initialWait === 0 ? 'INSTANT' : 'minimal delay'})`);
    console.log('='.repeat(80));
    
    // Run in background with real-time output
    const childProcess = exec(command, { 
      maxBuffer: 10 * 1024 * 1024,
      cwd: scriptDir,
      env: { ...process.env },
      shell: true
    });
    
    // Stream stdout in real-time
    childProcess.stdout.on('data', (data) => {
      console.log(`[RAPID-SELL] ${data}`);
    });
    
    // Stream stderr in real-time
    childProcess.stderr.on('data', (data) => {
      console.error(`[RAPID-SELL ERROR] ${data}`);
    });
    
    childProcess.on('close', (code) => {
      console.log(`[RAPID-SELL] Process exited with code ${code}`);
    });
    
  } catch (error) {
    console.error('Rapid sell error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Gather/Sell tokens from all wallets
app.post('/api/gather', async (req, res) => {
  try {
    console.log('Gather request received');
    const scriptDir = path.join(__dirname, '..');
    
    res.json({ success: true, message: 'Gather process started', processId: 'running' });
    
    // Use npm run gather
    const command = `cd "${scriptDir}" && npm run gather`;
    console.log(`Executing: ${command}`);
    console.log('='.repeat(80));
    console.log('GATHER PROCESS STARTED');
    console.log('='.repeat(80));
    
    // Run in background with real-time output
    const childProcess = exec(command, { 
      maxBuffer: 10 * 1024 * 1024,
      cwd: scriptDir,
      env: { ...process.env },
      shell: true
    });
    
    // Stream stdout in real-time
    childProcess.stdout.on('data', (data) => {
      console.log(`[GATHER] ${data}`);
    });
    
    // Stream stderr in real-time
    childProcess.stderr.on('data', (data) => {
      console.error(`[GATHER ERROR] ${data}`);
    });
    
    // Handle completion
    childProcess.on('close', (code) => {
      if (code === 0) {
        console.log('='.repeat(80));
        console.log('GATHER COMPLETED SUCCESSFULLY');
        console.log('='.repeat(80));
      } else {
        console.error('='.repeat(80));
        console.error(`GATHER FAILED WITH EXIT CODE: ${code}`);
        console.error('='.repeat(80));
      }
    });
    
    childProcess.on('error', (error) => {
      console.error('Gather process error:', error);
    });
    
  } catch (error) {
    console.error('Gather endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Gather SOL only (no token selling)
app.post('/api/gather-sol', async (req, res) => {
  try {
    console.log('Gather SOL request received');
    const scriptDir = path.join(__dirname, '..');
    
    res.json({ success: true, message: 'SOL gather started', processId: 'running' });
    
    // Run manual gather script
    const scriptPath = path.join(scriptDir, 'manual-gather.js');
    const command = `cd "${scriptDir}" && node ${scriptPath}`;
    console.log(`Executing: ${command}`);
    console.log('='.repeat(80));
    console.log('GATHER SOL PROCESS STARTED');
    console.log('='.repeat(80));
    
    // Run in background with real-time output
    const childProcess = exec(command, { 
      maxBuffer: 10 * 1024 * 1024,
      cwd: scriptDir,
      env: { ...process.env },
      shell: true
    });
    
    // Stream stdout in real-time
    childProcess.stdout.on('data', (data) => {
      console.log(`[GATHER SOL] ${data}`);
    });
    
    // Stream stderr in real-time
    childProcess.stderr.on('data', (data) => {
      console.error(`[GATHER SOL ERROR] ${data}`);
    });
    
    // Handle completion
    childProcess.on('close', (code) => {
      if (code === 0) {
        console.log('='.repeat(80));
        console.log('GATHER SOL COMPLETED SUCCESSFULLY');
        console.log('='.repeat(80));
      } else {
        console.error('='.repeat(80));
        console.error(`GATHER SOL FAILED WITH EXIT CODE: ${code}`);
        console.error('='.repeat(80));
      }
    });
    
    childProcess.on('error', (error) => {
      console.error('Gather SOL process error:', error);
    });
    
  } catch (error) {
    console.error('Gather SOL endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Rapid sell 50% of wallets (sells 100% from half, keeps other half)
app.post('/api/rapid-sell-50-percent', async (req, res) => {
  try {
    console.log('Rapid sell 50% request received');
    const scriptDir = path.join(__dirname, '..');
    const mintAddress = req.body.mintAddress;
    const initialWait = req.body.initialWait !== undefined ? req.body.initialWait : 0;
    
    res.json({ success: true, message: 'Rapid sell 50% started', processId: 'running' });
    
    let command = `cd "${scriptDir}" && npm run rapid-sell-50-percent`;
    if (mintAddress) {
      command += ` ${mintAddress}`;
      if (initialWait !== undefined) {
        command += ` ${initialWait}`;
      }
    } else if (initialWait !== undefined) {
      command += ` "" ${initialWait}`;
    }
    
    console.log(`Executing: ${command}`);
    console.log('='.repeat(80));
    console.log('🚀🚀🚀 RAPID SELL 50% - Selling 100% from half the wallets 🚀🚀🚀');
    console.log('='.repeat(80));
    
    const childProcess = exec(command, { 
      maxBuffer: 10 * 1024 * 1024,
      cwd: scriptDir,
      env: { ...process.env },
      shell: true
    });
    
    childProcess.stdout.on('data', (data) => {
      console.log(`[RAPID-SELL-50%] ${data}`);
    });
    
    childProcess.stderr.on('data', (data) => {
      console.error(`[RAPID-SELL-50% ERROR] ${data}`);
    });
    
    childProcess.on('close', (code) => {
      console.log(`[RAPID-SELL-50%] Process exited with code ${code}`);
    });
    
  } catch (error) {
    console.error('Rapid sell 50% error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Rapid sell remaining wallets (sells kept wallets + dev wallet)
app.post('/api/rapid-sell-remaining', async (req, res) => {
  try {
    console.log('Rapid sell remaining request received');
    const scriptDir = path.join(__dirname, '..');
    const mintAddress = req.body.mintAddress;
    const initialWait = req.body.initialWait !== undefined ? req.body.initialWait : 0;
    
    res.json({ success: true, message: 'Rapid sell remaining started', processId: 'running' });
    
    let command = `cd "${scriptDir}" && npm run rapid-sell-remaining`;
    if (mintAddress) {
      command += ` ${mintAddress}`;
      if (initialWait !== undefined) {
        command += ` ${initialWait}`;
      }
    } else if (initialWait !== undefined) {
      command += ` "" ${initialWait}`;
    }
    
    console.log(`Executing: ${command}`);
    console.log('='.repeat(80));
    console.log('🚀🚀🚀 RAPID SELL REMAINING - Selling kept wallets + dev wallet 🚀🚀🚀');
    console.log('='.repeat(80));
    
    const childProcess = exec(command, { 
      maxBuffer: 10 * 1024 * 1024,
      cwd: scriptDir,
      env: { ...process.env },
      shell: true
    });
    
    childProcess.stdout.on('data', (data) => {
      console.log(`[RAPID-SELL-REMAINING] ${data}`);
    });
    
    childProcess.stderr.on('data', (data) => {
      console.error(`[RAPID-SELL-REMAINING ERROR] ${data}`);
    });
    
    childProcess.on('close', (code) => {
      console.log(`[RAPID-SELL-REMAINING] Process exited with code ${code}`);
    });
    
  } catch (error) {
    console.error('Rapid sell remaining error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Gather all wallets (from all historical wallets)
app.post('/api/gather-all', async (req, res) => {
  try {
    console.log('Gather all wallets request received');
    const scriptDir = path.join(__dirname, '..');
    
    res.json({ success: true, message: 'Gather all wallets started', processId: 'running' });
    
    const command = `cd "${scriptDir}" && npm run gather-all`;
    console.log(`Executing: ${command}`);
    console.log('='.repeat(80));
    console.log('GATHER ALL WALLETS PROCESS STARTED');
    console.log('='.repeat(80));
    
    const childProcess = exec(command, { 
      maxBuffer: 10 * 1024 * 1024,
      cwd: scriptDir,
      env: { ...process.env },
      shell: true
    });
    
    childProcess.stdout.on('data', (data) => {
      console.log(`[GATHER-ALL] ${data}`);
    });
    
    childProcess.stderr.on('data', (data) => {
      console.error(`[GATHER-ALL ERROR] ${data}`);
    });
    
    childProcess.on('close', (code) => {
      if (code === 0) {
        console.log('='.repeat(80));
        console.log('GATHER ALL COMPLETED SUCCESSFULLY');
        console.log('='.repeat(80));
      } else {
        console.error('='.repeat(80));
        console.error(`GATHER ALL FAILED WITH EXIT CODE: ${code}`);
        console.error('='.repeat(80));
      }
    });
    
  } catch (error) {
    console.error('Gather all error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Gather last N wallets
app.post('/api/gather-last', async (req, res) => {
  try {
    console.log('Gather last wallets request received');
    const scriptDir = path.join(__dirname, '..');
    const count = req.body.count || 10;
    
    res.json({ success: true, message: `Gather last ${count} wallets started`, processId: 'running' });
    
    const command = `cd "${scriptDir}" && npm run gather-last ${count}`;
    console.log(`Executing: ${command}`);
    console.log('='.repeat(80));
    console.log(`GATHER LAST ${count} WALLETS PROCESS STARTED`);
    console.log('='.repeat(80));
    
    const childProcess = exec(command, { 
      maxBuffer: 10 * 1024 * 1024,
      cwd: scriptDir,
      env: { ...process.env },
      shell: true
    });
    
    childProcess.stdout.on('data', (data) => {
      console.log(`[GATHER-LAST] ${data}`);
    });
    
    childProcess.stderr.on('data', (data) => {
      console.error(`[GATHER-LAST ERROR] ${data}`);
    });
    
    childProcess.on('close', (code) => {
      if (code === 0) {
        console.log('='.repeat(80));
        console.log('GATHER LAST COMPLETED SUCCESSFULLY');
        console.log('='.repeat(80));
      } else {
        console.error('='.repeat(80));
        console.error(`GATHER LAST FAILED WITH EXIT CODE: ${code}`);
        console.error('='.repeat(80));
      }
    });
    
  } catch (error) {
    console.error('Gather last error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Collect creator fees
app.post('/api/collect-fees', async (req, res) => {
  try {
    console.log('Collect fees request received');
    const scriptDir = path.join(__dirname, '..');
    
    res.json({ success: true, message: 'Collect fees started', processId: 'running' });
    
    const command = `cd "${scriptDir}" && npm run collect-fees`;
    console.log(`Executing: ${command}`);
    console.log('='.repeat(80));
    console.log('COLLECT FEES PROCESS STARTED');
    console.log('='.repeat(80));
    
    const childProcess = exec(command, { 
      maxBuffer: 10 * 1024 * 1024,
      cwd: scriptDir,
      env: { ...process.env },
      shell: true
    });
    
    childProcess.stdout.on('data', (data) => {
      console.log(`[COLLECT-FEES] ${data}`);
    });
    
    childProcess.stderr.on('data', (data) => {
      console.error(`[COLLECT-FEES ERROR] ${data}`);
    });
    
    childProcess.on('close', (code) => {
      if (code === 0) {
        console.log('='.repeat(80));
        console.log('COLLECT FEES COMPLETED SUCCESSFULLY');
        console.log('='.repeat(80));
      } else {
        console.error('='.repeat(80));
        console.error(`COLLECT FEES FAILED WITH EXIT CODE: ${code}`);
        console.error('='.repeat(80));
      }
    });
    
  } catch (error) {
    console.error('Collect fees error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get wallet balances
app.get('/api/wallets', async (req, res) => {
  try {
    const keysPath = path.join(__dirname, '..', 'keys', 'data.json');
    if (!fs.existsSync(keysPath)) {
      return res.json({ wallets: [] });
    }
    
    const walletsData = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
    const base58 = require('bs58').default || require('bs58');
    const { Keypair, Connection, LAMPORTS_PER_SOL } = require('@solana/web3.js');
    
    const connection = new Connection(process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com', 'confirmed');
    const wallets = [];
    
    for (let i = 0; i < Math.min(walletsData.length, 50); i++) {
      try {
        const kp = Keypair.fromSecretKey(base58.decode(walletsData[i]));
        const balance = await connection.getBalance(kp.publicKey);
        wallets.push({
          index: i + 1,
          address: kp.publicKey.toBase58(),
          balance: balance / LAMPORTS_PER_SOL
        });
      } catch (e) {
        // Skip errors
      }
    }
    
    res.json({ wallets });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// TRADING TERMINAL API ENDPOINTS
// ============================================================================

const tradingAPI = require('../trading-terminal-api.js');

// Get all trading wallets (without private keys for security)
app.get('/api/trading/wallets', async (req, res) => {
  try {
    const wallets = await tradingAPI.getTradingWallets();
    // Remove private keys before sending to frontend
    const safeWallets = wallets.map(w => ({
      address: w.address,
      balance: w.balance
    }));
    res.json({ success: true, wallets: safeWallets });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add a trading wallet
app.post('/api/trading/wallets/add', async (req, res) => {
  try {
    const { privateKey } = req.body;
    if (!privateKey) {
      return res.status(400).json({ success: false, error: 'Private key is required' });
    }
    
    const result = tradingAPI.addTradingWallet(privateKey);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Remove a trading wallet (by address)
app.post('/api/trading/wallets/remove', async (req, res) => {
  try {
    const { address } = req.body;
    if (!address) {
      return res.status(400).json({ success: false, error: 'Wallet address is required' });
    }
    
    const privateKey = tradingAPI.getPrivateKeyByAddress(address);
    if (!privateKey) {
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }
    
    tradingAPI.removeTradingWallet(privateKey);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Buy tokens (simple RPC) - uses wallet address instead of private key
// PROFIT FOCUS: Also supports main wallet from .env for quick buys
app.post('/api/trading/buy', async (req, res) => {
  try {
    const { walletAddress, mintAddress, solAmount } = req.body;
    
    if (!mintAddress || !solAmount) {
      return res.status(400).json({ 
        success: false, 
        error: 'mintAddress and solAmount are required' 
      });
    }
    
    let privateKey = null;
    
    // If walletAddress provided, try to get from trading wallets
    if (walletAddress) {
      privateKey = tradingAPI.getPrivateKeyByAddress(walletAddress);
    }
    
    // If not found in trading wallets, try main wallet from .env (PROFIT FOCUS)
    if (!privateKey) {
      const envConfig = readEnvConfig();
      if (envConfig.PRIVATE_KEY) {
        privateKey = envConfig.PRIVATE_KEY;
        console.log('💰 Using main wallet from .env for quick buy');
      }
    }
    
    if (!privateKey) {
      return res.status(404).json({ success: false, error: 'Wallet not found. Provide walletAddress or ensure PRIVATE_KEY is set in .env' });
    }
    
    // Import TypeScript function (now possible with ts-node register)
    const { buyTokenSimple } = require('../trading-terminal.ts');
    const result = await buyTokenSimple(privateKey, mintAddress, parseFloat(solAmount));
    res.json({ success: true, message: `Bought tokens with ${solAmount} SOL`, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Sell tokens (simple RPC) - uses wallet address instead of private key
app.post('/api/trading/sell', async (req, res) => {
  try {
    const { walletAddress, mintAddress, percentage } = req.body;
    
    if (!walletAddress || !mintAddress) {
      return res.status(400).json({ 
        success: false, 
        error: 'walletAddress and mintAddress are required' 
      });
    }
    
    // Get private key from address
    const privateKey = tradingAPI.getPrivateKeyByAddress(walletAddress);
    if (!privateKey) {
      return res.status(404).json({ success: false, error: 'Wallet not found in trading wallets' });
    }
    
    const sellPercentage = percentage !== undefined ? parseFloat(percentage) : 100;
    
    // Import TypeScript function (now possible with ts-node register)
    const { sellTokenSimple } = require('../trading-terminal.ts');
    const result = await sellTokenSimple(privateKey, mintAddress, sellPercentage);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get wallet token balance - uses wallet address instead of private key
app.post('/api/trading/balance', async (req, res) => {
  try {
    const { walletAddress, mintAddress } = req.body;
    
    if (!walletAddress || !mintAddress) {
      return res.status(400).json({ 
        success: false, 
        error: 'walletAddress and mintAddress are required' 
      });
    }
    
    // Get private key from address
    const privateKey = tradingAPI.getPrivateKeyByAddress(walletAddress);
    if (!privateKey) {
      return res.status(404).json({ success: false, error: 'Wallet not found in trading wallets' });
    }
    
    const result = await tradingAPI.getWalletTokenBalance(privateKey, mintAddress);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get next pump address (for preview before launch)
app.get('/api/next-pump-address', async (req, res) => {
  try {
    // Read pump-addresses.json directly with correct path
    const keysDir = path.join(__dirname, '..', 'keys');
    const pumpAddressesPath = path.join(keysDir, 'pump-addresses.json');
    
    console.log('Looking for pump addresses at:', pumpAddressesPath);
    console.log('File exists:', fs.existsSync(pumpAddressesPath));
    
    if (!fs.existsSync(pumpAddressesPath)) {
      console.error('pump-addresses.json not found at:', pumpAddressesPath);
      return res.json({ success: false, message: 'pump-addresses.json file not found' });
    }
    
    const data = fs.readFileSync(pumpAddressesPath, 'utf-8');
    const addresses = JSON.parse(data);
    
    console.log('Total addresses in file:', addresses.length);
    
    // Find first available address
    const available = addresses.find(addr => 
      addr.status === 'available' && !addr.used
    );
    
    console.log('Available address found:', available ? available.publicKey : 'none');
    
    if (!available) {
      // Log why no address was found
      const usedCount = addresses.filter(a => a.used).length;
      const unavailableCount = addresses.filter(a => a.status !== 'available').length;
      console.log(`Used: ${usedCount}, Unavailable: ${unavailableCount}`);
      return res.json({ success: false, message: 'No available pump addresses (all are used or unavailable)' });
    }
    
    res.json({ success: true, publicKey: available.publicKey });
  } catch (error) {
    console.error('Error getting next pump address:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get wallet status for profit dashboard
app.get('/api/wallet-status', async (req, res) => {
  try {
    const { mintAddress } = req.query;
    
    if (!mintAddress) {
      return res.status(400).json({ success: false, error: 'mintAddress is required' });
    }

    const keysDir = path.join(__dirname, '..', 'keys');
    const currentRunPath = path.join(keysDir, 'current-run.json');
    const soldWalletsPath = path.join(keysDir, 'sold-wallets.json');
    const dataPath = path.join(keysDir, 'data.json');

    const wallets = [];
    const soldWalletAddresses = new Set();

    // Read sold wallets
    if (fs.existsSync(soldWalletsPath)) {
      try {
        const soldData = JSON.parse(fs.readFileSync(soldWalletsPath, 'utf8'));
        // sold-wallets.json uses soldWalletKeys array (base58 private keys)
        if (soldData.soldWalletKeys && Array.isArray(soldData.soldWalletKeys)) {
          const base58 = require('bs58').default || require('bs58');
          const { Keypair } = require('@solana/web3.js');
          soldData.soldWalletKeys.forEach(walletKey => {
            try {
              const keypair = Keypair.fromSecretKey(base58.decode(walletKey));
              soldWalletAddresses.add(keypair.publicKey.toString());
            } catch (e) {
              console.error('Error converting sold wallet key:', e);
            }
          });
        }
      } catch (e) {
        console.error('Error reading sold-wallets.json:', e);
      }
    }

    // Read current run wallets
    if (fs.existsSync(currentRunPath)) {
      try {
        const currentRun = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
        
        // Get dev wallet from .env
        const envConfig = readEnvConfig();
        const devWalletPrivateKey = envConfig.PRIVATE_KEY;
        
        if (devWalletPrivateKey) {
          const base58 = require('bs58').default || require('bs58');
          const { Keypair } = require('@solana/web3.js');
          const devKeypair = Keypair.fromSecretKey(base58.decode(devWalletPrivateKey));
          const devAddress = devKeypair.publicKey.toString();
          const isSold = soldWalletAddresses.has(devAddress);
          
          wallets.push({
            address: devAddress,
            type: 'Dev',
            invested: parseFloat(envConfig.BUYER_AMOUNT || 0),
            sold: isSold,
            currentValue: 0, // Will be calculated by frontend or separate price API
            profit: 0
          });
        }

        // Get bundler wallets
        if (currentRun.walletKeys && Array.isArray(currentRun.walletKeys)) {
          const swapAmounts = (envConfig.SWAP_AMOUNTS || '').split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
          const base58 = require('bs58').default || require('bs58');
          const { Keypair } = require('@solana/web3.js');
          
          currentRun.walletKeys.forEach((walletKey, index) => {
            try {
              const keypair = Keypair.fromSecretKey(base58.decode(walletKey));
              const address = keypair.publicKey.toString();
              const isSold = soldWalletAddresses.has(address);
              const invested = swapAmounts[index] || parseFloat(envConfig.SWAP_AMOUNT || 0.3);
              
              wallets.push({
                address: address,
                type: 'Bundler',
                invested: invested,
                sold: isSold,
                currentValue: 0, // Will be calculated by frontend or separate price API
                profit: 0
              });
            } catch (e) {
              console.error(`Error processing wallet ${index}:`, e);
            }
          });
        }
      } catch (e) {
        console.error('Error reading current-run.json:', e);
      }
    }

    res.json({ success: true, wallets, mintAddress });
  } catch (error) {
    console.error('Error in /api/wallet-status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get Birdeye transactions for a token (tracks buys/sells)
app.get('/api/birdeye-transactions', async (req, res) => {
  console.log('[Birdeye] Request received:', req.query);
  try {
    const { tokenAddress, limit = '50', offset = '0' } = req.query;
    
    if (!tokenAddress) {
      console.log('[Birdeye] Missing tokenAddress');
      return res.status(400).json({ success: false, error: 'tokenAddress is required' });
    }

    const birdeyeApiKey = process.env.BIRDEYE_API_KEY?.trim();
    if (!birdeyeApiKey || birdeyeApiKey === 'your_birdeye_api_key_here' || birdeyeApiKey.includes('placeholder') || birdeyeApiKey.length < 10) {
      console.error('[Birdeye] API key validation failed:', {
        hasKey: !!birdeyeApiKey,
        keyLength: birdeyeApiKey?.length || 0,
        isPlaceholder: birdeyeApiKey === 'your_birdeye_api_key_here'
      });
      return res.status(400).json({ 
        success: false, 
        error: 'BIRDEYE_API_KEY not configured. Add it to .env file.',
        message: 'Birdeye API key is required for trade history. Please add BIRDEYE_API_KEY to your .env file and restart the server.',
        debug: {
          hasKey: !!birdeyeApiKey,
          keyLength: birdeyeApiKey?.length || 0,
          isPlaceholder: birdeyeApiKey === 'your_birdeye_api_key_here'
        }
      });
    }

    // Birdeye API endpoint for Solana token transactions
    const url = `https://public-api.birdeye.so/defi/txs/token?address=${tokenAddress}&offset=${offset}&limit=${limit}&tx_type=swap&sort_type=desc`;

    const response = await fetch(url, {
      headers: {
        'X-API-KEY': birdeyeApiKey,
        'x-chain': 'solana',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Birdeye] API error ${response.status}:`, errorText.substring(0, 200));
      
      if (response.status === 401) {
        return res.status(401).json({
          success: false,
          error: 'Invalid Birdeye API key. Please check your BIRDEYE_API_KEY in .env'
        });
      }
      
      if (response.status === 403) {
        return res.status(403).json({
          success: false,
          error: 'Birdeye API access forbidden',
          message: 'Your API key may not have access to this endpoint, or the request is blacklisted. Check your Birdeye subscription tier.'
        });
      }
      
      if (response.status === 429) {
        return res.status(429).json({
          success: false,
          error: 'Rate limit exceeded',
          message: 'Too many requests to Birdeye API. Please wait a moment and try again.'
        });
      }
      
      return res.status(response.status).json({ 
        success: false, 
        error: `Birdeye API error: ${response.status}`,
        details: errorText.substring(0, 200),
        message: 'Failed to fetch transactions. The token may not be indexed yet, or there was an API error.'
      });
    }

    const data = await response.json();
    console.log(`[Birdeye] Found ${data.data?.items?.length || data.items?.length || 0} transactions`);
    const transactions = data.data?.items || data.items || [];

    // Format transactions similar to Nodematrix format
    const formattedTrades = transactions.map((tx) => {
      const baseChangeAmount = tx.base?.changeAmount || 0;
      const side = tx.side?.toLowerCase() || '';
      const isBuy = side === 'buy' || (baseChangeAmount > 0 && side !== 'sell');
      
      const priceUsd = tx.basePrice || tx.base?.price || '0';
      const quoteAmountUsd = tx.quote?.uiAmount && tx.quotePrice 
        ? tx.quote.uiAmount * tx.quotePrice 
        : tx.value || '0';
      
      let timestamp = tx.blockUnixTime || tx.timestamp;
      if (timestamp) {
        timestamp = timestamp < 10000000000 ? timestamp * 1000 : timestamp;
      } else {
        timestamp = Date.now();
      }

      return {
        timestamp: typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime(),
        type: isBuy ? 'buy' : 'sell',
        priceUsd: String(priceUsd),
        amountUsd: String(quoteAmountUsd),
        amount: String(tx.base?.uiAmount || tx.base?.amount || '0'),
        txHash: String(tx.txHash || tx.transactionHash || ''),
        from: String(tx.owner || tx.from || ''),
        to: String(tx.to || ''),
        dex: String(tx.source || tx.dex || ''),
        pair: String(tx.pair || ''),
      };
    });

    res.json({
      success: true,
      trades: formattedTrades,
      total: data.data?.total || formattedTrades.length,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (error) {
    console.error('Error fetching Birdeye transactions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clear old token data
app.post('/api/clear-token-data', async (req, res) => {
  try {
    const keysDir = path.join(__dirname, '..', 'keys');
    const currentRunPath = path.join(keysDir, 'current-run.json');
    const soldWalletsPath = path.join(keysDir, 'sold-wallets.json');
    
    // Clear current-run.json (but keep structure for next launch)
    if (fs.existsSync(currentRunPath)) {
      fs.writeFileSync(currentRunPath, JSON.stringify({
        count: 0,
        totalCreated: 0,
        timestamp: Date.now(),
        mintAddress: null,
        launchStatus: null,
        walletKeys: []
      }, null, 2));
    }
    
    // Optionally clear sold-wallets.json (user might want to keep this for history)
    // Uncomment if you want to clear sold wallets too:
    // if (fs.existsSync(soldWalletsPath)) {
    //   fs.unlinkSync(soldWalletsPath);
    // }
    
    console.log('Cleared old token data');
    res.json({ success: true, message: 'Old token data cleared' });
  } catch (error) {
    console.error('Error clearing token data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start WebSocket tracking endpoint
app.post('/api/websocket/start-tracking', async (req, res) => {
  try {
    const { mintAddress, ourWallets, autoSell, threshold } = req.body;
    
    if (!mintAddress) {
      return res.status(400).json({ success: false, error: 'mintAddress is required' });
    }

    if (!ourWallets || !Array.isArray(ourWallets)) {
      return res.status(400).json({ success: false, error: 'ourWallets array is required' });
    }

    const success = websocketTracker.startTracking(
      mintAddress,
      ourWallets,
      autoSell || false,
      threshold || 0.1,
      req.body.externalBuyThreshold || 1.0, // Cumulative threshold (default 1 SOL)
      req.body.externalBuyWindow || 60000 // Time window in ms (default 60 seconds)
    );

    if (success) {
      res.json({ success: true, message: 'WebSocket tracking started' });
    } else {
      res.status(500).json({ success: false, error: 'Failed to start WebSocket tracking' });
    }
  } catch (error) {
    console.error('Error starting WebSocket tracking:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Stop WebSocket tracking endpoint
app.post('/api/websocket/stop-tracking', async (req, res) => {
  try {
    websocketTracker.stopTracking();
    res.json({ success: true, message: 'WebSocket tracking stopped' });
  } catch (error) {
    console.error('Error stopping WebSocket tracking:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Server-Sent Events endpoint for real-time transaction stream
app.get('/api/websocket/stream', (req, res) => {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

  console.log('[SSE] New client connected to transaction stream');

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Connected to transaction stream' })}\n\n`);

  // Add event listener
  const sendTransaction = (txData) => {
    try {
      res.write(`data: ${JSON.stringify(txData)}\n\n`);
    } catch (err) {
      console.error('[SSE] Error sending transaction:', err);
    }
  };

  websocketTracker.addEventListener(sendTransaction);

  // Handle client disconnect
  req.on('close', () => {
    console.log('[SSE] Client disconnected from transaction stream');
    websocketTracker.removeEventListener(sendTransaction);
    res.end();
  });

  // Keep connection alive with periodic ping
  const pingInterval = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch (err) {
      clearInterval(pingInterval);
      websocketTracker.removeEventListener(sendTransaction);
    }
  }, 30000); // Ping every 30 seconds

  // Cleanup on close
  req.on('close', () => {
    clearInterval(pingInterval);
  });
});

app.listen(PORT, () => {
  console.log(`API Server running on http://localhost:${PORT}`);
  console.log(`Working directory: ${__dirname}`);
  console.log(`Parent directory: ${path.join(__dirname, '..')}`);
});

