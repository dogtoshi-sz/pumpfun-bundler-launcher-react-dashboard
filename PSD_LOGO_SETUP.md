# PSD Logo Generation System Setup Guide

This guide explains how to set up the PSD processing and dynamic logo generation system for automated token launches.

## Overview

The system allows you to:
1. **Upload PSD files** with logos and fonts (optional - can use images/fonts directly)
2. **Extract assets** (logos as PNG, fonts as TTF/OTF) - or provide manually
3. **Generate logos dynamically** using those assets with custom text
4. **Use generated logos** in automated token launches

## Quick Start (Without PSD Parsing)

If you want to start immediately without PSD parsing:

1. **Manually extract logos from PSD**: Open PSD in Photoshop, export logo layers as PNG
2. **Extract fonts**: Save font files as TTF/OTF from your system or PSD
3. **Install canvas only**: `npm install canvas`
4. **Use the simple logo generator** - it's ready to use!

## Full Setup (With PSD Parsing)

### Step 1: Install Required Packages

For basic logo generation (recommended to start):
```bash
npm install canvas
```

For full PSD parsing (optional):
```bash
npm install ag-psd canvas
```

**Note for Windows:**
- `canvas` requires native dependencies. You may need:
  - Python 2.7 or 3.x
  - Visual Studio Build Tools (for Windows)
  - Or use pre-built binaries: `npm install canvas --build-from-source=false`

**Alternative PSD libraries:**
- `ag-psd` - Recommended, pure JavaScript, no native dependencies
- `psd` - Alternative option (may require additional setup)

### Step 2: Directory Structure

The system will create:
```
psd-assets/
  ├── logos/          # Extracted logo images
  ├── fonts/          # Extracted font files
  ├── generated/      # Generated logos
  └── psd-data.json   # Metadata about processed PSDs
```

## Implementation Steps

### 1. Complete PSD Processor (`src/psd-processor.ts`)

The file is created but needs actual PSD parsing implementation. Example:

```typescript
import * as PSD from 'ag-psd';
import { writeFileSync } from 'fs';

export async function processPSD(psdFilePath: string, outputDir: string): Promise<PSDData> {
  const buffer = await fs.promises.readFile(psdFilePath);
  const psd = PSD.readPsd(buffer);
  
  const logos: ExtractedLogo[] = [];
  const fonts: ExtractedFont[] = [];
  
  // Extract image layers (logos)
  function extractLayers(layers: any[]) {
    for (const layer of layers || []) {
      if (layer.canvas) {
        // Export as PNG
        const logoPath = path.join(outputDir, 'logos', `${layer.name}.png`);
        writeFileSync(logoPath, layer.canvas.toBuffer('image/png'));
        logos.push({
          name: layer.name,
          imagePath: logoPath,
          width: layer.width,
          height: layer.height,
          format: 'png'
        });
      }
      
      // Extract fonts from text layers
      if (layer.text) {
        const fontName = layer.text.font?.name;
        if (fontName && !fonts.find(f => f.name === fontName)) {
          fonts.push({
            name: fontName,
            fontPath: '', // Note: Font files may need to be provided separately
            family: fontName,
            style: layer.text.font?.style
          });
        }
      }
      
      // Recursively process child layers
      if (layer.children) {
        extractLayers(layer.children);
      }
    }
  }
  
  extractLayers(psd.children || []);
  
  return {
    logos,
    fonts,
    layers: psd.children || [],
    metadata: {
      width: psd.width || 0,
      height: psd.height || 0,
      colorMode: psd.colorMode || 'RGB'
    }
  };
}
```

### 2. Complete Logo Generator (`src/logo-generator.ts`)

Implement canvas-based logo generation:

```typescript
import { createCanvas, loadImage, registerFont } from 'canvas';
import { readFileSync } from 'fs';

export async function generateLogo(options: LogoGenerationOptions): Promise<Buffer> {
  const {
    tokenName = '',
    tokenSymbol = '',
    baseLogo,
    fontPath,
    fontFamily = 'Arial',
    fontSize = 48,
    textColor = '#FFFFFF',
    backgroundColor = '#000000',
    width = 512,
    height = 512,
    layout = 'centered',
    logoPosition = 'center'
  } = options;

  // Register custom font
  if (fontPath && fs.existsSync(fontPath)) {
    registerFont(fontPath, { family: fontFamily });
  }

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Fill background
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  // Load and draw base logo
  let logoImage = null;
  if (baseLogo && fs.existsSync(baseLogo)) {
    logoImage = await loadImage(baseLogo);
    
    // Calculate logo position
    let logoX = 0, logoY = 0;
    const logoAspect = logoImage.width / logoImage.height;
    const logoHeight = height * 0.4; // 40% of canvas height
    const logoWidth = logoHeight * logoAspect;
    
    switch (logoPosition) {
      case 'top':
        logoX = (width - logoWidth) / 2;
        logoY = height * 0.1;
        break;
      case 'center':
        logoX = (width - logoWidth) / 2;
        logoY = (height - logoHeight) / 2 - (tokenName || tokenSymbol ? fontSize : 0);
        break;
      // Add other positions...
    }
    
    ctx.drawImage(logoImage, logoX, logoY, logoWidth, logoHeight);
  }

  // Draw text with custom font
  ctx.fillStyle = textColor;
  ctx.font = `${fontSize}px "${fontFamily}"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const centerY = height / 2;
  const textSpacing = fontSize * 1.2;

  if (tokenName && tokenSymbol) {
    ctx.fillText(tokenName, width / 2, centerY - textSpacing / 2);
    ctx.fillText(tokenSymbol, width / 2, centerY + textSpacing / 2);
  } else if (tokenName) {
    ctx.fillText(tokenName, width / 2, centerY);
  } else if (tokenSymbol) {
    ctx.fillText(tokenSymbol, width / 2, centerY);
  }

  return canvas.toBuffer('image/png');
}
```

## Usage

### Quick Start: Generate Logo from Images/Fonts

**Step 1: Prepare your assets**
- Export logo from PSD as PNG (e.g., `image/logos/base-logo.png`)
- Have your font file ready (e.g., `psd-assets/fonts/custom-font.ttf`)

**Step 2: Generate logo via API**

```bash
curl -X POST http://localhost:3001/api/logo/generate \
  -H "Content-Type: application/json" \
  -d '{
    "tokenName": "MyToken",
    "tokenSymbol": "MTK",
    "baseLogoPath": "./image/logos/base-logo.png",
    "fontPath": "./psd-assets/fonts/custom-font.ttf",
    "fontFamily": "CustomFont",
    "fontSize": 60,
    "textColor": "#FFD700",
    "backgroundColor": "#000000",
    "width": 512,
    "height": 512,
    "outputFormat": "base64"
  }'
```

The API will return a base64 image that you can use directly!

### Full Setup: Upload and Process PSD File

**Step 1: Upload PSD**

```bash
curl -X POST http://localhost:3001/api/psd/upload \
  -F "psd=@your-logo-template.psd"
```

**Step 2: List extracted assets**

```bash
curl http://localhost:3001/api/psd/assets
```

**Step 3: Generate Logo for Token Launch

```bash
curl -X POST http://localhost:3001/api/logo/generate \
  -H "Content-Type: application/json" \
  -d '{
    "tokenName": "MyToken",
    "tokenSymbol": "MTK",
    "baseLogo": "/psd-assets/logos/main-logo.png",
    "fontPath": "/psd-assets/fonts/custom-font.ttf",
    "fontFamily": "CustomFont",
    "fontSize": 60,
    "textColor": "#FFD700",
    "backgroundColor": "#000000",
    "width": 512,
    "height": 512,
    "outputFormat": "base64"
  }'
```

### 3. Use in Token Launch

The generated logo (as base64) can be used in the `FILE` environment variable or passed directly to the token creation function.

## Integration with Launch System

To automatically generate logos for each launch:

1. **Modify `index.ts`** to call logo generation before token creation
2. **Use generated logo** in `createTokenTx` function
3. **Store logo path** in `current-run.json` for reference

Example integration:

```typescript
// In index.ts, before createTokenTx
import { generateLogoAsBase64 } from './src/logo-generator';

// Generate logo for this token
const logoBase64 = await generateLogoAsBase64({
  tokenName: TOKEN_NAME,
  tokenSymbol: TOKEN_SYMBOL,
  baseLogo: process.env.BASE_LOGO_PATH, // From PSD extraction
  fontPath: process.env.CUSTOM_FONT_PATH, // From PSD extraction
  fontFamily: process.env.CUSTOM_FONT_FAMILY || 'CustomFont',
  fontSize: Number(process.env.LOGO_FONT_SIZE) || 48,
  textColor: process.env.LOGO_TEXT_COLOR || '#FFFFFF',
  backgroundColor: process.env.LOGO_BG_COLOR || '#000000'
});

// Save logo temporarily and use in FILE
const logoPath = path.join(process.cwd(), 'image', `logo-${Date.now()}.png`);
fs.writeFileSync(logoPath, Buffer.from(logoBase64.split(',')[1], 'base64'));
process.env.FILE = logoPath; // Use in token creation
```

## Environment Variables

Add to `.env`:

```env
# PSD Logo Generation
BASE_LOGO_PATH=./psd-assets/logos/main-logo.png
CUSTOM_FONT_PATH=./psd-assets/fonts/custom-font.ttf
CUSTOM_FONT_FAMILY=CustomFont
LOGO_FONT_SIZE=48
LOGO_TEXT_COLOR=#FFFFFF
LOGO_BG_COLOR=#000000
AUTO_GENERATE_LOGO=true
```

## Next Steps

1. **Install packages**: `npm install ag-psd canvas`
2. **Complete implementations** in `psd-processor.ts` and `logo-generator.ts` (see examples above)
3. **Test PSD upload** via API
4. **Test logo generation** with sample data
5. **Integrate with launch system** to auto-generate logos

## Troubleshooting

- **Canvas installation issues on Windows**: Try `npm install canvas --build-from-source=false`
- **PSD parsing errors**: Ensure PSD file is not corrupted and is a valid Photoshop file
- **Font not loading**: Verify font file path and format (TTF/OTF supported)
- **Logo generation fails**: Check that base logo image exists and is readable
