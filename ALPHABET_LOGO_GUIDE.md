# Alphabet Logo Integration Guide

## Overview

The alphabet logos from `image/logo-library/Alphabet/` are now integrated into the logo generation system. They will automatically be used as base logos when generating token logos, website logos, and Twitter banners.

## How It Works

### Automatic Logo Selection

The system automatically picks an alphabet logo based on:
1. **Token Name** - First letter of the token name (e.g., "AlphaToken" → uses `a.png`)
2. **Token Symbol** - If token name doesn't match, uses first letter of symbol (e.g., "BTC" → uses `b.png`)
3. **Manual Override** - You can specify `alphabetLogo: "c"` to force a specific letter

### Available Alphabet Logos

All 26 letters (a-z) are available:
```
a.png, b.png, c.png, d.png, e.png, f.png, g.png, h.png, i.png, j.png,
k.png, l.png, m.png, n.png, o.png, p.png, q.png, r.png, s.png, t.png,
u.png, v.png, w.png, x.png, y.png, z.png
```

## Usage

### 1. Via API - Generate All Launch Logos

```bash
POST http://localhost:3001/api/logo/generate-launch
Content-Type: application/json

{
  "tokenName": "AlphaToken",
  "tokenSymbol": "ATK",
  "alphabetLogo": "a",  // Optional: force specific letter
  "primaryColor": "#FFD700",
  "backgroundColor": "#000000"
}
```

**Response:**
```json
{
  "success": true,
  "logos": {
    "tokenLogo": "path/to/token-logo.png",
    "websiteLogo": "path/to/website-logo.png",
    "twitterBanner": "path/to/twitter-banner.png"
  },
  "urls": {
    "tokenLogo": "/image/createdlogos/token-logo-1234567890.png",
    "websiteLogo": "/image/createdlogos/website-logo-1234567890.png",
    "twitterBanner": "/image/createdlogos/twitter-banner-1234567890.png"
  }
}
```

### 2. List Available Alphabet Logos

```bash
GET http://localhost:3001/api/logo/alphabet
```

**Response:**
```json
{
  "success": true,
  "logos": ["a", "b", "c", ... "z"],
  "count": 26
}
```

### 3. In Code (TypeScript/JavaScript)

```typescript
import { generateLaunchLogos, listAlphabetLogos } from './src/launch-logo-generator';

// List available logos
const available = listAlphabetLogos();
console.log('Available:', available); // ['a', 'b', 'c', ...]

// Generate all logos for a launch
const logos = await generateLaunchLogos({
  tokenName: 'AlphaToken',
  tokenSymbol: 'ATK',
  alphabetLogo: 'a', // Optional: specify letter
  primaryColor: '#FFD700',
  backgroundColor: '#000000'
});

console.log('Token Logo:', logos.tokenLogo);
console.log('Website Logo:', logos.websiteLogo);
console.log('Twitter Banner:', logos.twitterBanner);
```

## Logo Types Generated

### 1. Token Logo (512x512)
- **Purpose**: For pump.fun token creation
- **Size**: 512x512 pixels
- **Background**: Customizable (default: black)
- **Contains**: Alphabet logo + token name/symbol text

### 2. Website Logo (400x200)
- **Purpose**: For website headers/navigation
- **Size**: 400x200 pixels
- **Background**: White (can be made transparent later)
- **Contains**: Alphabet logo + token name/symbol text

### 3. Twitter Banner (1500x500)
- **Purpose**: Twitter profile banner
- **Size**: 1500x500 pixels (Twitter standard)
- **Background**: Customizable (default: black)
- **Contains**: Alphabet logo + token name/symbol text

## Examples

### Example 1: Auto-detect from Token Name
```javascript
// "BetaToken" will automatically use "b.png"
await generateLaunchLogos({
  tokenName: 'BetaToken',
  tokenSymbol: 'BETA'
});
```

### Example 2: Force Specific Letter
```javascript
// Force use of "c.png" regardless of token name
await generateLaunchLogos({
  tokenName: 'MyToken',
  tokenSymbol: 'MTK',
  alphabetLogo: 'c'
});
```

### Example 3: Custom Colors
```javascript
await generateLaunchLogos({
  tokenName: 'GoldToken',
  tokenSymbol: 'GOLD',
  primaryColor: '#FFD700',    // Gold text
  backgroundColor: '#1a1a2e'   // Dark blue background
});
```

## Integration with Launch System

To automatically generate logos before token creation, add to your launch script:

```typescript
import { generateLaunchLogos } from './src/launch-logo-generator';

// Before token creation
const logos = await generateLaunchLogos({
  tokenName: TOKEN_NAME,
  tokenSymbol: TOKEN_SYMBOL,
  primaryColor: process.env.LOGO_TEXT_COLOR || '#FFFFFF',
  backgroundColor: process.env.LOGO_BG_COLOR || '#000000'
});

// Use token logo for token creation
process.env.FILE = logos.tokenLogo;

// Use website logo for marketing website
// Use twitter banner for Twitter profile
```

## Testing

Test the alphabet logo integration:

```bash
# Test alphabet logo detection
node test-alphabet-logos.js

# Test full logo generation (when TypeScript issues are resolved)
npx ts-node test-launch-logos.js
```

## Notes

- Alphabet logos are transparent PNGs, perfect for compositing
- The system automatically scales and positions the alphabet logo
- If no alphabet logo is found for a letter, it will fall back to text-only
- All generated logos are saved to `image/createdlogos/`
