/**
 * Analyze a single logo image in detail
 * Usage: node scripts/analyze-single-logo.js <path-to-image>
 */

const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

// Reuse functions from analyze-and-rename-logos.js
function getDominantColors(imageData, sampleSize = 1000) {
  const pixels = imageData.data;
  const colorMap = new Map();
  
  const step = Math.max(1, Math.floor((pixels.length / 4) / sampleSize));
  
  for (let i = 0; i < pixels.length; i += step * 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3];
    
    if (a < 128) continue;
    
    const qr = Math.floor(r / 32) * 32;
    const qg = Math.floor(g / 32) * 32;
    const qb = Math.floor(b / 32) * 32;
    
    const key = `${qr},${qg},${qb}`;
    colorMap.set(key, (colorMap.get(key) || 0) + 1);
  }
  
  const sorted = Array.from(colorMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
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
    transparent: transparent,
    opaque: opaque,
    transparencyPercent: (transparent / (transparent + opaque) * 100).toFixed(1)
  };
}

function analyzeBrightness(imageData) {
  const pixels = imageData.data;
  let totalBrightness = 0;
  let pixelCount = 0;
  
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a < 128) continue; // Skip transparent
    
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    
    // Calculate brightness (luminance formula)
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

async function analyzeLogo(imagePath) {
  try {
    const image = await loadImage(imagePath);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    
    const imageData = ctx.getImageData(0, 0, image.width, image.height);
    
    // Get file stats
    const stats = fs.statSync(imagePath);
    
    // Analyze colors
    const colors = getDominantColors(imageData);
    
    // Analyze transparency
    const transparency = analyzeTransparency(imageData);
    
    // Analyze brightness
    const brightness = analyzeBrightness(imageData);
    
    // Calculate color diversity
    const uniqueColors = new Set();
    for (let i = 0; i < imageData.data.length; i += 4) {
      const a = imageData.data[i + 3];
      if (a > 128) {
        const r = Math.floor(imageData.data[i] / 32) * 32;
        const g = Math.floor(imageData.data[i + 1] / 32) * 32;
        const b = Math.floor(imageData.data[i + 2] / 32) * 32;
        uniqueColors.add(`${r},${g},${b}`);
      }
    }
    
    return {
      file: path.basename(imagePath),
      path: imagePath,
      dimensions: {
        width: image.width,
        height: image.height,
        aspectRatio: (image.width / image.height).toFixed(2),
        isSquare: image.width === image.height
      },
      fileSize: {
        bytes: stats.size,
        kb: (stats.size / 1024).toFixed(2),
        mb: (stats.size / (1024 * 1024)).toFixed(4)
      },
      colors: {
        dominant: colors,
        uniqueCount: uniqueColors.size,
        primary: colors[0],
        secondary: colors[1] || null
      },
      transparency: transparency,
      brightness: brightness,
      summary: {
        primaryColor: colors[0]?.name || 'unknown',
        primaryHex: colors[0]?.hex || '#000000',
        secondaryColor: colors[1]?.name || null,
        isTransparent: parseFloat(transparency.transparencyPercent) > 10,
        brightnessLevel: brightness.level,
        colorCount: uniqueColors.size
      }
    };
  } catch (error) {
    console.error(`Error analyzing ${imagePath}:`, error.message);
    return null;
  }
}

async function main() {
  const imagePath = process.argv[2];
  
  if (!imagePath) {
    console.error('Usage: node scripts/analyze-single-logo.js <path-to-image>');
    process.exit(1);
  }
  
  const fullPath = path.isAbsolute(imagePath) ? imagePath : path.join(process.cwd(), imagePath);
  
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ File not found: ${fullPath}`);
    process.exit(1);
  }
  
  console.log('🔍 Analyzing Logo Image\n');
  console.log('='.repeat(60));
  
  const analysis = await analyzeLogo(fullPath);
  
  if (!analysis) {
    console.error('❌ Failed to analyze image');
    process.exit(1);
  }
  
  console.log(`\n📁 File: ${analysis.file}`);
  console.log(`📍 Path: ${analysis.path}`);
  
  console.log(`\n📐 Dimensions:`);
  console.log(`   Width: ${analysis.dimensions.width}px`);
  console.log(`   Height: ${analysis.dimensions.height}px`);
  console.log(`   Aspect Ratio: ${analysis.dimensions.aspectRatio}:1`);
  console.log(`   Shape: ${analysis.dimensions.isSquare ? 'Square' : 'Rectangle'}`);
  
  console.log(`\n💾 File Size:`);
  console.log(`   ${analysis.fileSize.bytes} bytes (${analysis.fileSize.kb} KB)`);
  
  console.log(`\n🎨 Colors:`);
  console.log(`   Unique Colors: ${analysis.colors.uniqueCount}`);
  console.log(`   Primary: ${analysis.summary.primaryColor} (${analysis.summary.primaryHex})`);
  if (analysis.summary.secondaryColor) {
    console.log(`   Secondary: ${analysis.summary.secondaryColor} (${analysis.colors.secondary.hex})`);
  }
  console.log(`\n   Top 10 Dominant Colors:`);
  analysis.colors.dominant.forEach((color, i) => {
    const percentage = ((color.count / (analysis.dimensions.width * analysis.dimensions.height)) * 100).toFixed(1);
    console.log(`   ${i + 1}. ${color.name.padEnd(10)} ${color.hex} - ${percentage}%`);
  });
  
  console.log(`\n🔍 Transparency:`);
  console.log(`   Transparent Pixels: ${analysis.transparency.transparent.toLocaleString()}`);
  console.log(`   Opaque Pixels: ${analysis.transparency.opaque.toLocaleString()}`);
  console.log(`   Transparency: ${analysis.transparency.transparencyPercent}%`);
  console.log(`   Has Transparency: ${analysis.summary.isTransparent ? 'Yes' : 'No'}`);
  
  console.log(`\n💡 Brightness:`);
  console.log(`   Average: ${analysis.brightness.average}/255`);
  console.log(`   Level: ${analysis.brightness.level}`);
  
  console.log(`\n📊 Summary:`);
  console.log(`   • Primary Color: ${analysis.summary.primaryColor} (${analysis.summary.primaryHex})`);
  if (analysis.summary.secondaryColor) {
    console.log(`   • Secondary Color: ${analysis.summary.secondaryColor}`);
  }
  console.log(`   • Brightness: ${analysis.summary.brightnessLevel}`);
  console.log(`   • Transparency: ${analysis.summary.isTransparent ? 'Yes' : 'No'}`);
  console.log(`   • Color Count: ${analysis.summary.colorCount} unique colors`);
  console.log(`   • Shape: ${analysis.dimensions.width}x${analysis.dimensions.height} ${analysis.dimensions.isSquare ? 'square' : 'rectangle'}`);
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('✨ Analysis Complete!');
}

main().catch(console.error);
