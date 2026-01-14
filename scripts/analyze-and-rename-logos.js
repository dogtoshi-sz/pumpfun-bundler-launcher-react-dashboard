/**
 * Analyze and Rename Logo Images
 * 
 * Analyzes PNG logo images and renames them with descriptive names
 * based on colors, characteristics, and content.
 * 
 * Usage: node scripts/analyze-and-rename-logos.js [directory]
 */

const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

/**
 * Get dominant colors from an image
 */
function getDominantColors(imageData, sampleSize = 1000) {
  const pixels = imageData.data;
  const colorMap = new Map();
  
  // Sample pixels (every Nth pixel for performance)
  const step = Math.max(1, Math.floor((pixels.length / 4) / sampleSize));
  
  for (let i = 0; i < pixels.length; i += step * 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3];
    
    // Skip transparent pixels
    if (a < 128) continue;
    
    // Quantize colors to reduce variations
    const qr = Math.floor(r / 32) * 32;
    const qg = Math.floor(g / 32) * 32;
    const qb = Math.floor(b / 32) * 32;
    
    const key = `${qr},${qg},${qb}`;
    colorMap.set(key, (colorMap.get(key) || 0) + 1);
  }
  
  // Sort by frequency and get top colors
  const sorted = Array.from(colorMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, count]) => {
      const [r, g, b] = key.split(',').map(Number);
      return { r, g, b, count, hex: rgbToHex(r, g, b), name: getColorName(r, g, b) };
    });
  
  return sorted;
}

/**
 * Convert RGB to hex
 */
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

/**
 * Get color name from RGB
 */
function getColorName(r, g, b) {
  // Common color names
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

/**
 * Detect if image has gradient
 */
function hasGradient(imageData) {
  const pixels = imageData.data;
  const width = imageData.width;
  const height = imageData.height;
  
  // Sample horizontal and vertical gradients
  let horizontalChanges = 0;
  let verticalChanges = 0;
  
  // Check horizontal gradient (sample middle row)
  const midY = Math.floor(height / 2);
  for (let x = 0; x < width - 1; x += 10) {
    const idx1 = (midY * width + x) * 4;
    const idx2 = (midY * width + x + 10) * 4;
    
    const r1 = pixels[idx1];
    const g1 = pixels[idx1 + 1];
    const b1 = pixels[idx1 + 2];
    const r2 = pixels[idx2];
    const g2 = pixels[idx2 + 1];
    const b2 = pixels[idx2 + 2];
    
    const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
    if (diff > 30) horizontalChanges++;
  }
  
  // Check vertical gradient (sample middle column)
  const midX = Math.floor(width / 2);
  for (let y = 0; y < height - 1; y += 10) {
    const idx1 = (y * width + midX) * 4;
    const idx2 = ((y + 10) * width + midX) * 4;
    
    const r1 = pixels[idx1];
    const g1 = pixels[idx1 + 1];
    const b1 = pixels[idx1 + 2];
    const r2 = pixels[idx2];
    const g2 = pixels[idx2 + 1];
    const b2 = pixels[idx2 + 2];
    
    const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
    if (diff > 30) verticalChanges++;
  }
  
  return horizontalChanges > 5 || verticalChanges > 5;
}

/**
 * Detect if image is mostly solid color
 */
function isMostlySolid(imageData) {
  const pixels = imageData.data;
  const colorMap = new Map();
  
  // Sample pixels
  for (let i = 0; i < pixels.length; i += 40) {
    const r = Math.floor(pixels[i] / 32) * 32;
    const g = Math.floor(pixels[i + 1] / 32) * 32;
    const b = Math.floor(pixels[i + 2] / 32) * 32;
    const a = pixels[i + 3];
    
    if (a < 128) continue;
    
    const key = `${r},${g},${b}`;
    colorMap.set(key, (colorMap.get(key) || 0) + 1);
  }
  
  // Check if one color dominates (>70%)
  const total = Array.from(colorMap.values()).reduce((a, b) => a + b, 0);
  const max = Math.max(...Array.from(colorMap.values()));
  
  return max / total > 0.7;
}

/**
 * Analyze image and generate descriptive name
 */
async function analyzeImage(imagePath) {
  try {
    const image = await loadImage(imagePath);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    
    const imageData = ctx.getImageData(0, 0, image.width, image.height);
    
    // Get dominant colors
    const colors = getDominantColors(imageData);
    const primaryColor = colors[0];
    const secondaryColor = colors[1];
    
    // Detect characteristics
    const hasGrad = hasGradient(imageData);
    const isSolid = isMostlySolid(imageData);
    
    // Build descriptive name
    const parts = [];
    
    // Add gradient/solid indicator
    if (hasGrad) {
      parts.push('gradient');
    } else if (isSolid) {
      parts.push('solid');
    }
    
    // Add primary color
    if (primaryColor) {
      parts.push(primaryColor.name);
    }
    
    // Add secondary color if significantly different
    if (secondaryColor && secondaryColor.count > primaryColor.count * 0.3) {
      const colorDiff = Math.abs(primaryColor.r - secondaryColor.r) +
                       Math.abs(primaryColor.g - secondaryColor.g) +
                       Math.abs(primaryColor.b - secondaryColor.b);
      if (colorDiff > 50) {
        parts.push(secondaryColor.name);
      }
    }
    
    // Add dimensions if not standard
    if (image.width !== 512 || image.height !== 512) {
      parts.push(`${image.width}x${image.height}`);
    }
    
    // Add logo indicator
    parts.push('logo');
    
    return {
      name: parts.join('-'),
      colors: colors.map(c => ({ name: c.name, hex: c.hex })),
      hasGradient: hasGrad,
      isSolid: isSolid,
      dimensions: `${image.width}x${image.height}`
    };
  } catch (error) {
    console.error(`Error analyzing ${imagePath}:`, error.message);
    return null;
  }
}

/**
 * Sanitize filename
 */
function sanitizeFilename(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Main function
 */
async function main() {
  const targetDir = process.argv[2] || path.join(__dirname, '..', 'image', 'createdlogos');
  
  console.log(`🔍 Analyzing logos in: ${targetDir}\n`);
  
  if (!fs.existsSync(targetDir)) {
    console.error(`❌ Directory not found: ${targetDir}`);
    process.exit(1);
  }
  
  const files = fs.readdirSync(targetDir)
    .filter(f => f.match(/\.(png|jpg|jpeg)$/i))
    .map(f => path.join(targetDir, f));
  
  if (files.length === 0) {
    console.log('No image files found.');
    return;
  }
  
  console.log(`Found ${files.length} image(s) to analyze...\n`);
  
  for (const filePath of files) {
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath);
    const baseName = path.basename(filePath, ext);
    
    // Skip if already has descriptive name (contains color names)
    const colorNames = ['black', 'white', 'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'gold', 'silver', 'gray', 'gradient', 'solid'];
    if (colorNames.some(color => baseName.toLowerCase().includes(color))) {
      console.log(`⏭️  Skipping ${fileName} (already descriptive)`);
      continue;
    }
    
    console.log(`📸 Analyzing: ${fileName}...`);
    
    const analysis = await analyzeImage(filePath);
    
    if (!analysis) {
      console.log(`   ❌ Failed to analyze\n`);
      continue;
    }
    
    const newName = sanitizeFilename(analysis.name) + ext;
    const newPath = path.join(targetDir, newName);
    
    // Check if file with new name already exists
    if (fs.existsSync(newPath) && newPath !== filePath) {
      // Add timestamp to make it unique
      const timestamp = Date.now();
      const uniqueName = sanitizeFilename(`${analysis.name}-${timestamp}`) + ext;
      const uniquePath = path.join(targetDir, uniqueName);
      fs.renameSync(filePath, uniquePath);
      console.log(`   ✅ Renamed to: ${uniqueName}`);
    } else {
      fs.renameSync(filePath, newPath);
      console.log(`   ✅ Renamed to: ${newName}`);
    }
    
    console.log(`   Colors: ${analysis.colors.map(c => `${c.name}(${c.hex})`).join(', ')}`);
    console.log(`   ${analysis.hasGradient ? 'Gradient' : analysis.isSolid ? 'Solid' : 'Mixed'} | ${analysis.dimensions}\n`);
  }
  
  console.log('✨ Analysis complete!');
}

main().catch(console.error);
