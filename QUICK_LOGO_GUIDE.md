# Quick Logo Generation Guide

## Fastest Way to Get Started

### 1. Install Canvas Package

```bash
npm install canvas
```

**Windows users**: If installation fails, try:
```bash
npm install canvas --build-from-source=false
```

Or install Visual Studio Build Tools first.

### 2. Prepare Your Assets

From your PSD file:
- **Export logo layers** as PNG files → Save to `image/logos/` or `psd-assets/logos/`
- **Extract font files** (TTF/OTF) → Save to `psd-assets/fonts/`

**How to extract from PSD:**
1. Open PSD in Photoshop
2. For logos: Right-click layer → Export As → PNG
3. For fonts: Check what fonts are used, then find the font files on your system (usually in `C:\Windows\Fonts\` on Windows)

### 3. Generate Logo via API

```bash
curl -X POST http://localhost:3001/api/logo/generate \
  -H "Content-Type: application/json" \
  -d '{
    "tokenName": "MyToken",
    "tokenSymbol": "MTK",
    "baseLogoPath": "./image/logos/your-logo.png",
    "fontPath": "./psd-assets/fonts/your-font.ttf",
    "fontFamily": "YourFontName",
    "fontSize": 60,
    "textColor": "#FFFFFF",
    "backgroundColor": "#000000",
    "width": 512,
    "height": 512,
    "outputFormat": "file"
  }'
```

### 4. Use in Token Launch

The generated logo will be saved to `image/generated-logo-{timestamp}.png` and accessible at `/image/generated-logo-{timestamp}.png`.

You can:
- Set `FILE` environment variable to the generated logo path
- Or use the base64 output directly in your launch code

## Example: Auto-Generate Logo Before Launch

Add this to your launch script (in `index.ts` or wherever you create tokens):

```typescript
import { generateAndSaveSimpleLogo } from './src/simple-logo-generator';

// Before token creation
const logoPath = path.join(process.cwd(), 'image', `logo-${Date.now()}.png`);
await generateAndSaveSimpleLogo({
  tokenName: TOKEN_NAME,
  tokenSymbol: TOKEN_SYMBOL,
  baseLogoPath: process.env.BASE_LOGO_PATH || './image/logos/base-logo.png',
  fontPath: process.env.CUSTOM_FONT_PATH,
  fontFamily: process.env.CUSTOM_FONT_FAMILY || 'Arial',
  fontSize: Number(process.env.LOGO_FONT_SIZE) || 48,
  textColor: process.env.LOGO_TEXT_COLOR || '#FFFFFF',
  backgroundColor: process.env.LOGO_BG_COLOR || '#000000',
  width: 512,
  height: 512
}, logoPath);

// Use generated logo
process.env.FILE = logoPath;
```

## Environment Variables

Add to `.env`:

```env
# Logo Generation
BASE_LOGO_PATH=./image/logos/base-logo.png
CUSTOM_FONT_PATH=./psd-assets/fonts/custom-font.ttf
CUSTOM_FONT_FAMILY=CustomFont
LOGO_FONT_SIZE=60
LOGO_TEXT_COLOR=#FFFFFF
LOGO_BG_COLOR=#000000
AUTO_GENERATE_LOGO=true
```

## Testing

1. **Test logo generation**:
   ```bash
   node -e "const { generateAndSaveSimpleLogo } = require('./src/simple-logo-generator.ts'); generateAndSaveSimpleLogo({ tokenName: 'Test', tokenSymbol: 'TEST', baseLogoPath: './image/logos/base-logo.png' }, './test-logo.png').then(() => console.log('Done!'))"
   ```

2. **Check API endpoint**:
   - Visit: `http://localhost:3001/api/psd/assets` to see available assets
   - Generate logo via API (see example above)

## Next Steps

Once this works, you can:
- Implement full PSD parsing (see `PSD_LOGO_SETUP.md`)
- Create a frontend UI for logo generation
- Add more customization options (gradients, effects, etc.)
