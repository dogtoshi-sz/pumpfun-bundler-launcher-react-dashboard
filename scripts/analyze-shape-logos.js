/**
 * Analyze all shape logos and create a metadata file
 * This allows quick lookup of logo characteristics without re-analyzing
 */

const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

function getDominantColors(imageData, sampleSize = 1000) {
  const pixels = imageData.data;
  const colorMap = new Map();
  
  const step = Math.max(1, Math.floor((pixels.length / 4) / sampleSize));
  
  for (let i = 0; i < pixels.length; i += step * 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3];
    
    if (a < 128) continue; // Skip transparent pixels
    
    const qr = Math.floor(r / 32) * 32;
    const qg = Math.floor(g / 32) * 32;
    const qb = Math.floor(b / 32) * 32;
    
    const key = `${qr},${qg},${qb}`;
    colorMap.set(key, (colorMap.get(key) || 0) + 1);
  }
  
  const sorted = Array.from(colorMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, count]) => {
      const [r, g, b] = key.split(',').map(Number);
      return { r, g, b, count, hex: rgbToHex(r, g, b), name: getColorName(r, g, b) };
    });
  
  return sorted;
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

function getColorName(r, g, b) {
  const colors = [
    { name: 'black', r: 0, g: 0, b: 0 },
    { name: 'white', r: 255, g: 255, b: 255 },
    { name: 'red', r: 255, g: 0, b: 0 },
    { name: 'green', r: 0, g: 255, b: 0 },
    { name: 'blue', r: 0, g: 0, b: 255 },
    { name: 'yellow', r: 255, g: 255, b: 0 },
    { name: 'orange', r: 255, g: 165, b: 0 },
    { name: 'purple', r: 128, g: 0, b: 128 },
    { name: 'pink', r: 255, g: 192, b: 203 },
    { name: 'cyan', r: 0, g: 255, b: 255 },
    { name: 'magenta', r: 255, g: 0, b: 255 },
    { name: 'gold', r: 255, g: 215, b: 0 },
    { name: 'silver', r: 192, g: 192, b: 192 },
    { name: 'gray', r: 128, g: 128, b: 128 },
    { name: 'brown', r: 165, g: 42, b: 42 },
  ];
  
  let minDist = Infinity;
  let closestColor = 'unknown';
  
  for (const color of colors) {
    const dist = Math.sqrt(
      Math.pow(r - color.r, 2) +
      Math.pow(g - color.g, 2) +
      Math.pow(b - color.b, 2)
    );
    if (dist < minDist) {
      minDist = dist;
      closestColor = color.name;
    }
  }
  
  return closestColor;
}

function analyzeBrightness(imageData) {
  const pixels = imageData.data;
  let totalBrightness = 0;
  let pixelCount = 0;
  
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a < 128) continue;
    
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    
    const brightness = (0.299 * r + 0.587 * g + 0.114 * b);
    totalBrightness += brightness;
    pixelCount++;
  }
  
  const avgBrightness = totalBrightness / pixelCount;
  return {
    average: Math.round(avgBrightness),
    level: avgBrightness < 85 ? 'dark' : avgBrightness < 170 ? 'medium' : 'bright'
  };
}

function analyzeTransparency(imageData) {
  const pixels = imageData.data;
  let transparent = 0;
  let opaque = 0;
  
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 128) {
      transparent++;
    } else {
      opaque++;
    }
  }
  
  return {
    transparencyPercent: (transparent / (transparent + opaque) * 100).toFixed(1),
    isTransparent: (transparent / (transparent + opaque) * 100) > 10
  };
}

async function analyzeShapeLogo(imagePath) {
  try {
    const image = await loadImage(imagePath);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    
    const imageData = ctx.getImageData(0, 0, image.width, image.height);
    
    const colors = getDominantColors(imageData);
    const brightness = analyzeBrightness(imageData);
    const transparency = analyzeTransparency(imageData);
    
    return {
      filename: path.basename(imagePath),
      dimensions: {
        width: image.width,
        height: image.height,
        isSquare: image.width === image.height
      },
      colors: {
        primary: colors[0] || null,
        secondary: colors[1] || null,
        accent: colors[2] || null,
        all: colors
      },
      brightness: brightness,
      transparency: transparency,
      // Quick lookup fields
      primaryColor: colors[0]?.name || 'unknown',
      primaryHex: colors[0]?.hex || '#000000',
      brightnessLevel: brightness.level,
      isTransparent: transparency.isTransparent
    };
  } catch (error) {
    console.error(`Error analyzing ${imagePath}:`, error.message);
    return null;
  }
}

async function main() {
  const shapeLogosDir = path.join(__dirname, '..', 'image', 'logo-library', 'shape-logos');
  const metadataPath = path.join(shapeLogosDir, 'shape-logos-metadata.json');
  
  if (!fs.existsSync(shapeLogosDir)) {
    console.error(`❌ Shape logos directory not found: ${shapeLogosDir}`);
    process.exit(1);
  }
  
  console.log('🔍 Analyzing Shape Logos...\n');
  
  const files = fs.readdirSync(shapeLogosDir)
    .filter(f => f.toLowerCase().endsWith('.png'))
    .sort();
  
  console.log(`Found ${files.length} shape logos to analyze\n`);
  
  const metadata = {
    generatedAt: new Date().toISOString(),
    totalLogos: files.length,
    logos: {}
  };
  
  let processed = 0;
  let errors = 0;
  
  for (const file of files) {
    const filePath = path.join(shapeLogosDir, file);
    process.stdout.write(`Analyzing ${file}... `);
    
    const analysis = await analyzeShapeLogo(filePath);
    
    if (analysis) {
      metadata.logos[file] = analysis;
      processed++;
      
      // Color code summary
      const colorCode = `${analysis.primaryColor}-${analysis.brightnessLevel}`;
      process.stdout.write(`✅ ${colorCode}\n`);
    } else {
      errors++;
      process.stdout.write(`❌ Failed\n`);
    }
  }
  
  // Save metadata
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`✨ Analysis Complete!`);
  console.log(`   Processed: ${processed}/${files.length}`);
  console.log(`   Errors: ${errors}`);
  console.log(`   Metadata saved to: ${metadataPath}`);
  
  // Print color summary
  console.log(`\n📊 Color Summary:`);
  const colorCounts = {};
  for (const [file, data] of Object.entries(metadata.logos)) {
    const key = `${data.primaryColor}-${data.brightnessLevel}`;
    colorCounts[key] = (colorCounts[key] || 0) + 1;
  }
  
  const sortedColors = Object.entries(colorCounts)
    .sort((a, b) => b[1] - a[1]);
  
  sortedColors.forEach(([colorCode, count]) => {
    console.log(`   ${colorCode.padEnd(20)} ${count} logos`);
  });
}

main().catch(console.error);
