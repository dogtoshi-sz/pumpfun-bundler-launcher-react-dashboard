# 🎒 Bags.fm Integration Guide

## Overview

**Bags.fm** is an alternative Solana token launch platform similar to pump.fun, but with its own API, SDK, and program infrastructure. This document outlines how to integrate Bags.fm as a deployment option alongside pump.fun.

---

## 📊 Key Differences from Pump.fun

### Platform Architecture

| Feature | Pump.fun | Bags.fm |
|---------|----------|---------|
| **API Type** | Direct HTTP API | SDK-based (@bagsfm/bags-sdk) |
| **Authentication** | No auth required | API Key required |
| **Program IDs** | Pump program | Meteora DBC + DAMM v2 |
| **Fee Structure** | Fixed fees | Custom fee splits (V1/V2) |
| **Post-Migration** | Raydium | Meteora AMM |
| **File Upload** | Direct to pump.fun | API endpoint with multipart |

### Program IDs (Mainnet)

```javascript
// Bags.fm Programs
const BAGS_PROGRAMS = {
  FEE_SHARE_V1: 'FEEhPbKVKnco9EXnaY3i4R5rQVUx91wgVfu8qokixywi', // Legacy
  FEE_SHARE_V2: '7ko7duEv4Gk5kRoJKGTRVgypuRHvTbCFbDeaC9Q4pWk3', // Current
  METEORA_DAMM: 'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG',  // Post-migration AMM
  METEORA_DBC: 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN'    // Token creation & bonding curve
};

// Pump.fun Programs (for reference)
const PUMP_PROGRAMS = {
  PROGRAM: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  // ... existing pump.fun programs
};
```

---

## 🔧 Required Setup

### 1. Environment Variables

Add to `.env`:

```env
# Bags.fm Configuration
BAGS_API_KEY=your_bags_api_key_here
BAGS_API_URL=https://api.bags.fm
ENABLE_BAGS_FM=false  # Toggle Bags.fm support

# Deployment Platform Selection
DEPLOYMENT_PLATFORM=pumpfun  # Options: 'pumpfun', 'bagsfm'
```

### 2. Dependencies

```bash
npm install @bagsfm/bags-sdk
```

### 3. API Key

- Get your API key from: https://dev.bags.fm
- Store securely in `.env`
- Never commit to version control

---

## 📋 API Documentation

### Base URL & Versioning

```
Base URL: https://api.bags.fm
Current Version: v1
Endpoint Format: https://api.bags.fm/v1/{endpoint}
```

### Authentication

All requests require an API key in the header:

```javascript
headers: {
  'Authorization': `Bearer ${BAGS_API_KEY}`,
  'Content-Type': 'application/json'
}
```

### Rate Limits

- **Standard Tier**: 100 requests/minute
- **Premium Tier**: 500 requests/minute
- Monitor via response headers: `X-RateLimit-Remaining`

---

## 🚀 Token Launch Workflow

### Bags.fm Launch Steps

```javascript
// 1. Initialize SDK
import { BagsSDK } from '@bagsfm/bags-sdk';
import { Connection } from '@solana/web3.js';

const connection = new Connection(process.env.SOLANA_RPC_URL);
const bagsSDK = new BagsSDK({
  apiKey: process.env.BAGS_API_KEY,
  connection
});

// 2. Upload Token Image (if not already uploaded)
const imageUpload = await bagsSDK.uploadFile({
  file: tokenImageBuffer,
  filename: 'token.png'
});

// 3. Create Token
const tokenResult = await bagsSDK.createToken({
  name: 'My Token',
  symbol: 'MTK',
  description: 'Token description',
  imageUrl: imageUpload.url,
  twitter: '@mytoken',
  telegram: 't.me/mytoken',
  website: 'https://mytoken.com',
  initialLiquidity: 1000000000, // In smallest units
  creatorWallet: creatorPublicKey.toString()
});

// 4. Monitor Bonding Curve
const bondingStatus = await bagsSDK.getBondingCurveStatus(tokenResult.mint);

// 5. Claim Fees (after trading)
const feesClaimed = await bagsSDK.claimFees({
  mint: tokenResult.mint,
  wallet: creatorPublicKey
});
```

### Pump.fun Launch Steps (Current)

```javascript
// 1. Create Token (Direct API)
const response = await fetch('https://pumpportal.fun/api/trade', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'create',
    tokenMetadata: { name, symbol, description, image },
    mint: mintKeypair.publicKey.toBase58(),
    ...
  })
});
```

---

## 🎨 UI/Menu Changes Required

### 1. Platform Selection (Launch Page)

**Add to TokenLaunch.jsx:**

```jsx
// New Setting Section: Platform Selection
<div className="space-y-4">
  <h3 className="text-lg font-semibold">Deployment Platform</h3>
  <div className="grid grid-cols-2 gap-4">
    <button
      onClick={() => setDeploymentPlatform('pumpfun')}
      className={`p-4 rounded-lg border-2 ${
        deploymentPlatform === 'pumpfun' 
          ? 'border-purple-500 bg-purple-500/20' 
          : 'border-gray-700'
      }`}
    >
      <div className="text-xl mb-2">💊</div>
      <div className="font-semibold">Pump.fun</div>
      <div className="text-xs text-gray-400">Classic bonding curve</div>
    </button>
    
    <button
      onClick={() => setDeploymentPlatform('bagsfm')}
      className={`p-4 rounded-lg border-2 ${
        deploymentPlatform === 'bagsfm' 
          ? 'border-blue-500 bg-blue-500/20' 
          : 'border-gray-700'
      }`}
    >
      <div className="text-xl mb-2">🎒</div>
      <div className="font-semibold">Bags.fm</div>
      <div className="text-xs text-gray-400">Meteora integration</div>
    </button>
  </div>
</div>
```

### 2. Platform-Specific Fields

**Bags.fm Additional Fields:**

```jsx
{deploymentPlatform === 'bagsfm' && (
  <>
    {/* Fee Share Configuration */}
    <div className="space-y-2">
      <label>Fee Share Split (%)</label>
      <input
        type="number"
        placeholder="0-100"
        min="0"
        max="100"
        // Creator's fee share percentage
      />
      <p className="text-xs text-gray-400">
        Percentage of trading fees you'll receive
      </p>
    </div>

    {/* Liquidity Migration Settings */}
    <div className="space-y-2">
      <label>Auto-Migrate to Meteora</label>
      <select>
        <option value="true">Yes - Auto migrate after bonding curve</option>
        <option value="false">No - Manual migration</option>
      </select>
    </div>

    {/* Initial Liquidity */}
    <div className="space-y-2">
      <label>Initial Liquidity (SOL)</label>
      <input
        type="number"
        placeholder="1.0"
        step="0.1"
        min="0.1"
        // Different from pump.fun amounts
      />
    </div>
  </>
)}
```

### 3. Settings Menu Updates

**Add to Settings.jsx:**

```jsx
const sections = {
  // ... existing sections
  platform: {
    title: 'Platform Settings',
    icon: Squares2X2Icon,
    description: 'Configure deployment platform preferences.',
    settings: [
      { 
        key: 'DEPLOYMENT_PLATFORM', 
        label: 'Default Platform', 
        type: 'select',
        options: [
          { value: 'pumpfun', label: 'Pump.fun' },
          { value: 'bagsfm', label: 'Bags.fm' }
        ],
        description: 'Choose default token launch platform'
      },
      { 
        key: 'ENABLE_BAGS_FM', 
        label: 'Enable Bags.fm', 
        type: 'checkbox', 
        description: 'Allow token deployment on Bags.fm' 
      },
      { 
        key: 'BAGS_API_KEY', 
        label: 'Bags.fm API Key', 
        type: 'password', 
        description: 'Your Bags.fm API key from dev.bags.fm',
        required: true,
        show_if: 'ENABLE_BAGS_FM'
      },
    ],
  },
};
```

### 4. Launch Button Logic

**Update index.ts:**

```typescript
// Platform-aware launch function
async function launchToken(config: LaunchConfig) {
  const platform = process.env.DEPLOYMENT_PLATFORM || 'pumpfun';
  
  if (platform === 'bagsfm') {
    return await launchOnBagsFm(config);
  } else {
    return await launchOnPumpFun(config);
  }
}

async function launchOnBagsFm(config: LaunchConfig) {
  // Bags.fm specific implementation
  console.log('🎒 Launching on Bags.fm...');
  
  // 1. Validate Bags.fm API key
  if (!process.env.BAGS_API_KEY) {
    throw new Error('BAGS_API_KEY not configured');
  }
  
  // 2. Initialize Bags SDK
  const bagsSDK = new BagsSDK({
    apiKey: process.env.BAGS_API_KEY,
    connection: new Connection(process.env.SOLANA_RPC_URL)
  });
  
  // 3. Upload image to Bags.fm
  const imageUrl = await bagsSDK.uploadFile({
    file: config.imageBuffer,
    filename: `${config.symbol}.png`
  });
  
  // 4. Create token via Bags SDK
  const result = await bagsSDK.createToken({
    name: config.name,
    symbol: config.symbol,
    description: config.description,
    imageUrl: imageUrl.url,
    twitter: config.twitter,
    telegram: config.telegram,
    website: config.website,
    initialLiquidity: config.initialLiquidity,
    creatorWallet: config.creatorWallet.toString(),
    feeSharePercent: config.feeSharePercent || 0
  });
  
  return {
    mint: result.mint,
    signature: result.signature,
    bondingCurve: result.bondingCurveAddress,
    platform: 'bagsfm'
  };
}
```

---

## 🔍 Feature Comparison

### Token Creation

| Feature | Pump.fun | Bags.fm |
|---------|----------|---------|
| Token Standard | SPL Token | SPL Token |
| Metadata | On-chain | On-chain |
| Image Hosting | pump.fun CDN | Bags.fm CDN |
| Max Supply | Configurable | Configurable |
| Decimals | 6 (default) | 6-9 (configurable) |

### Bonding Curve

| Feature | Pump.fun | Bags.fm |
|---------|----------|---------|
| Curve Type | Linear | Configurable |
| Graduation Target | 85 SOL | Configurable |
| Post-Migration | Raydium CLMM | Meteora DAMM v2 |
| Slippage Protection | Yes | Yes |

### Fee Structure

| Feature | Pump.fun | Bags.fm |
|---------|----------|---------|
| Creation Fee | ~0.02 SOL | ~0.01 SOL |
| Trading Fee | 1% | 0.5-2% (configurable) |
| Creator Share | 0% | 0-50% (configurable) |
| Fee Claiming | Automatic | Manual via SDK |

---

## 📝 Implementation Checklist

### Phase 1: Backend Integration
- [ ] Install `@bagsfm/bags-sdk` package
- [ ] Add Bags.fm environment variables to `.env.example`
- [ ] Create `src/bags-fm/bags-launcher.ts`
- [ ] Implement `launchOnBagsFm()` function
- [ ] Add platform detection in `index.ts`
- [ ] Update error handling for Bags.fm responses
- [ ] Add Bags.fm transaction tracking

### Phase 2: Frontend Integration
- [ ] Add platform selection toggle in `TokenLaunch.jsx`
- [ ] Create Bags.fm-specific form fields
- [ ] Add Bags.fm settings section in `Settings.jsx`
- [ ] Update validation logic for platform-specific fields
- [ ] Add Bags.fm status indicators
- [ ] Update success/error messages

### Phase 3: Testing
- [ ] Test Bags.fm API key validation
- [ ] Test token creation on Bags.fm devnet
- [ ] Test image upload to Bags.fm
- [ ] Test fee claiming functionality
- [ ] Test platform switching
- [ ] Test error scenarios

### Phase 4: Documentation
- [ ] Update main README with Bags.fm support
- [ ] Create Bags.fm setup guide
- [ ] Document API key acquisition
- [ ] Add troubleshooting section
- [ ] Create comparison guide

---

## ⚠️ Important Considerations

### 1. API Key Security
```javascript
// ❌ BAD - Never expose API key in frontend
const apiKey = 'bags_live_abc123...';

// ✅ GOOD - Keep in backend only
const apiKey = process.env.BAGS_API_KEY;
```

### 2. Rate Limiting
```javascript
// Implement exponential backoff for rate limit errors
async function callBagsAPI(endpoint, options, retries = 3) {
  try {
    return await fetch(endpoint, options);
  } catch (error) {
    if (error.status === 429 && retries > 0) {
      await sleep(1000 * (4 - retries)); // 1s, 2s, 3s
      return callBagsAPI(endpoint, options, retries - 1);
    }
    throw error;
  }
}
```

### 3. Transaction Confirmation
```javascript
// Bags.fm may use different confirmation levels
const confirmation = await connection.confirmTransaction(
  signature,
  'confirmed' // or 'finalized' based on use case
);
```

### 4. Error Handling
```javascript
// Bags.fm specific errors
try {
  await bagsSDK.createToken(config);
} catch (error) {
  if (error.code === 'INSUFFICIENT_API_CREDITS') {
    // Handle API credit exhaustion
  } else if (error.code === 'INVALID_TOKEN_METADATA') {
    // Handle metadata validation errors
  } else {
    // Generic error handling
  }
}
```

---

## 🔗 File Structure

```
src/
├── bags-fm/
│   ├── bags-launcher.ts       # Main launch logic
│   ├── bags-sdk-wrapper.ts    # SDK initialization
│   ├── bags-fee-manager.ts    # Fee claiming logic
│   └── bags-types.ts          # TypeScript types
├── pump-fun/
│   └── ... (existing pump.fun code)
└── launcher.ts                # Platform-agnostic launcher

frontend/src/components/
├── BagsFmSettings.jsx         # Bags.fm specific settings
├── PlatformSelector.jsx       # Platform toggle component
└── TokenLaunch.jsx            # Updated with platform logic
```

---

## 📚 Additional Resources

### Official Documentation
- **Bags.fm Docs**: https://docs.bags.fm
- **API Reference**: https://docs.bags.fm/api-reference
- **Get API Key**: https://dev.bags.fm
- **TypeScript SDK**: https://github.com/bagsfm/bags-sdk

### Program Verification
- **Fee Share V2**: `7ko7duEv4Gk5kRoJKGTRVgypuRHvTbCFbDeaC9Q4pWk3`
- **Meteora DBC**: `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`
- **Meteora DAMM v2**: `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG`

### Support
- **Discord**: https://discord.gg/bagsfm
- **Twitter**: @bagsfm
- **Email**: support@bags.fm

---

## 🎯 Next Steps

1. **Read this entire document** ✅
2. **Get Bags.fm API key** from https://dev.bags.fm
3. **Install dependencies**: `npm install @bagsfm/bags-sdk`
4. **Test on devnet** before mainnet deployment
5. **Implement backend** integration first
6. **Update frontend** with platform selector
7. **Test thoroughly** with small amounts
8. **Deploy to production**

---

## ⚡ Quick Comparison Summary

**Use Pump.fun when:**
- ✅ You want the simplest setup (no API key)
- ✅ You're familiar with the existing system
- ✅ You want Raydium migration
- ✅ Standard bonding curve is fine

**Use Bags.fm when:**
- ✅ You want custom fee sharing
- ✅ You prefer Meteora over Raydium
- ✅ You need more control over tokenomics
- ✅ You want SDK-based integration
- ✅ You need programmatic fee claiming

---

**Status**: 📝 Documentation Complete - Ready for Implementation

**Last Updated**: January 2026
