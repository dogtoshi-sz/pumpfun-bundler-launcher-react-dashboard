/**
 * Simple Logo Generator - Works with existing images and fonts
 * 
 * This is a simpler version that doesn't require PSD parsing.
 * You can manually extract logos from PSD and provide font files separately.
 */

import fs from 'fs';
import path from 'path';

export interface SimpleLogoOptions {
  tokenName?: string;
  tokenSymbol?: string;
  baseLogoPath?: string; // Path to base logo PNG/JPG
  fontPath?: string; // Path to TTF/OTF font file
  fontFamily?: string; // Font family name
  fontSize?: number;
  textColor?: string;
  backgroundColor?: string;
  width?: number;
  height?: number;
  textPosition?: 'top' | 'bottom' | 'center' | 'overlay';
  logoScale?: number; // Scale factor for logo (0.1 to 1.0)
}

/**
 * Generate logo using canvas (requires 'canvas' package)
 * This is a working implementation once canvas is installed
 */
export async function generateSimpleLogo(options: SimpleLogoOptions): Promise<Buffer> {
  // Check if canvas is available
  let Canvas: any;
  try {
    Canvas = require('canvas');
  } catch (error) {
    throw new Error('Canvas package not installed. Run: npm install canvas');
  }

  const tokenName = options.tokenName || '';
  const tokenSymbol = options.tokenSymbol || '';
  const baseLogoPath = options.baseLogoPath;
  const fontPath = options.fontPath;
  const fontFamily = options.fontFamily || 'Arial';
  const fontSize = options.fontSize || 48;
  const textColor = options.textColor || '#FFFFFF';
  const backgroundColor = options.backgroundColor || '#000000';
  const width = options.width || 512;
  const height = options.height || 512;
  const textPosition = options.textPosition || 'center';
  const logoScale = options.logoScale || 0.6;

  const { createCanvas, loadImage, registerFont } = Canvas;

  // Register custom font if provided
  if (fontPath && fs.existsSync(fontPath)) {
    try {
      registerFont(fontPath, { family: fontFamily || 'CustomFont' });
      console.log(`[Logo Generator] Registered font: ${fontFamily} from ${fontPath}`);
    } catch (error) {
      console.warn(`[Logo Generator] Could not register font: ${error.message}`);
    }
  }

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Fill background
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  // Load and draw base logo if provided
  if (baseLogoPath && fs.existsSync(baseLogoPath)) {
    try {
      const logoImage = await loadImage(baseLogoPath) as any;
      
      if (logoImage && logoImage.width && logoImage.height) {
        // Calculate logo size and position
        const logoAspect = logoImage.width / logoImage.height;
        const logoHeight = height * logoScale;
        const logoWidth = logoHeight * logoAspect;
        
        // Center logo
        const logoX = (width - logoWidth) / 2;
        let logoY = 0;
        
        // Adjust logo position based on text position
        if (textPosition === 'top') {
          logoY = height * 0.15; // Logo in middle-lower area
        } else if (textPosition === 'bottom') {
          logoY = height * 0.1; // Logo in upper area
        } else if (textPosition === 'overlay') {
          logoY = (height - logoHeight) / 2; // Center, text will overlay
        } else {
          logoY = (height - logoHeight) / 2 - (tokenName || tokenSymbol ? fontSize * 0.8 : 0);
        }
        
        ctx.drawImage(logoImage, logoX, logoY, logoWidth, logoHeight);
        console.log(`[Logo Generator] Drew base logo: ${baseLogoPath}`);
      }
    } catch (error: any) {
      console.warn(`[Logo Generator] Could not load base logo: ${error.message}`);
    }
  }

  // Draw text with custom font
  if (tokenName || tokenSymbol) {
    ctx.fillStyle = textColor;
    ctx.font = `bold ${fontSize}px "${fontFamily}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Add text shadow for better visibility
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    let textY = height / 2;
    
    if (textPosition === 'top') {
      textY = height * 0.25;
    } else if (textPosition === 'bottom') {
      textY = height * 0.75;
    } else if (textPosition === 'overlay') {
      textY = height / 2; // Overlay on logo
    }

    if (tokenName && tokenSymbol) {
      const textSpacing = fontSize * 1.3;
      ctx.fillText(tokenName, width / 2, textY - textSpacing / 2);
      ctx.fillText(tokenSymbol, width / 2, textY + textSpacing / 2);
    } else if (tokenName) {
      ctx.fillText(tokenName, width / 2, textY);
    } else if (tokenSymbol) {
      ctx.fillText(tokenSymbol, width / 2, textY);
    }

    // Reset shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  return canvas.toBuffer('image/png');
}

/**
 * Generate logo and save to file
 */
export async function generateAndSaveSimpleLogo(
  options: SimpleLogoOptions,
  outputPath: string
): Promise<string> {
  const logoBuffer = await generateSimpleLogo(options);
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(outputPath, logoBuffer);
  console.log(`[Logo Generator] ✅ Generated logo saved to: ${outputPath}`);
  return outputPath;
}

/**
 * Generate logo as base64 data URL
 */
export async function generateSimpleLogoAsBase64(options: SimpleLogoOptions): Promise<string> {
  const logoBuffer = await generateSimpleLogo(options);
  const base64 = logoBuffer.toString('base64');
  return `data:image/png;base64,${base64}`;
}
