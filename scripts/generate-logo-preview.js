/**
 * Generate a visual preview/index of all logos
 * Creates an HTML file showing all logos with their metadata
 */

const fs = require('fs');
const path = require('path');

function generateLogoPreview() {
  const alphabetDir = path.join(__dirname, '..', 'image', 'logo-library', 'Alphabet');
  const shapeLogosDir = path.join(__dirname, '..', 'image', 'logo-library', 'shape-logos');
  const metadataPath = path.join(shapeLogosDir, 'shape-logos-metadata.json');
  const outputPath = path.join(__dirname, '..', 'image', 'logo-library', 'logo-preview.html');
  
  // Read shape logos metadata
  let shapeLogosMetadata = null;
  if (fs.existsSync(metadataPath)) {
    shapeLogosMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  }
  
  // Get alphabet logos
  const alphabetLogos = [];
  if (fs.existsSync(alphabetDir)) {
    const files = fs.readdirSync(alphabetDir)
      .filter(f => f.toLowerCase().endsWith('.png'))
      .sort();
    
    for (const file of files) {
      const letter = path.basename(file, '.png').toUpperCase();
      alphabetLogos.push({
        letter,
        filename: file,
        path: `Alphabet/${file}`
      });
    }
  }
  
  // Get shape logos
  const shapeLogos = [];
  if (shapeLogosMetadata && shapeLogosMetadata.logos) {
    for (const [filename, data] of Object.entries(shapeLogosMetadata.logos)) {
      shapeLogos.push({
        filename,
        path: `shape-logos/${filename}`,
        color: data.primaryColor,
        brightness: data.brightnessLevel,
        hex: data.primaryHex,
        isTransparent: data.isTransparent
      });
    }
  }
  
  // Sort shape logos by color, then brightness
  shapeLogos.sort((a, b) => {
    if (a.color !== b.color) return a.color.localeCompare(b.color);
    return a.brightness.localeCompare(b.brightness);
  });
  
  // Generate HTML
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Logo Library Preview</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0a0a;
      color: #ffffff;
      padding: 20px;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
    }
    h1 {
      font-size: 32px;
      margin-bottom: 10px;
      color: #8B5CF6;
    }
    h2 {
      font-size: 24px;
      margin: 40px 0 20px 0;
      color: #A78BFA;
      border-bottom: 2px solid #8B5CF6;
      padding-bottom: 10px;
    }
    .section {
      margin-bottom: 50px;
    }
    .logo-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      gap: 20px;
      margin-top: 20px;
    }
    .logo-item {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 10px;
      text-align: center;
      transition: transform 0.2s, border-color 0.2s;
    }
    .logo-item:hover {
      transform: scale(1.05);
      border-color: #8B5CF6;
    }
    .logo-image {
      width: 100px;
      height: 100px;
      object-fit: contain;
      margin-bottom: 8px;
      background: 
        linear-gradient(45deg, #1a1a1a 25%, transparent 25%),
        linear-gradient(-45deg, #1a1a1a 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #1a1a1a 75%),
        linear-gradient(-45deg, transparent 75%, #1a1a1a 75%);
      background-size: 10px 10px;
      background-position: 0 0, 0 5px, 5px -5px, -5px 0px;
      border-radius: 4px;
    }
    .logo-label {
      font-size: 12px;
      color: #aaa;
      margin-top: 4px;
    }
    .logo-meta {
      font-size: 10px;
      color: #666;
      margin-top: 4px;
    }
    .color-badge {
      display: inline-block;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      margin-right: 4px;
      vertical-align: middle;
      border: 1px solid #333;
    }
    .stats {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 30px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
    }
    .stat-item {
      text-align: center;
    }
    .stat-value {
      font-size: 24px;
      font-weight: bold;
      color: #8B5CF6;
    }
    .stat-label {
      font-size: 12px;
      color: #aaa;
      margin-top: 4px;
    }
    .color-group {
      margin-bottom: 30px;
    }
    .color-group-title {
      font-size: 18px;
      color: #A78BFA;
      margin: 20px 0 10px 0;
      display: flex;
      align-items: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎨 Logo Library Preview</h1>
    <p style="color: #aaa; margin-bottom: 30px;">Visual index of all available logos for automated token launches</p>
    
    <div class="stats">
      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-value">${alphabetLogos.length}</div>
          <div class="stat-label">Alphabet Logos</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${shapeLogos.length}</div>
          <div class="stat-label">Shape Logos</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${new Set(shapeLogos.map(l => l.color)).size}</div>
          <div class="stat-label">Color Variants</div>
        </div>
      </div>
    </div>
    
    <div class="section">
      <h2>🔤 Alphabet Logos</h2>
      <p style="color: #aaa; margin-bottom: 15px;">Logos based on first letter of token name</p>
      <div class="logo-grid">
        ${alphabetLogos.map(logo => `
          <div class="logo-item">
            <img src="${logo.path}" alt="${logo.letter}" class="logo-image" />
            <div class="logo-label">${logo.letter}</div>
          </div>
        `).join('')}
      </div>
    </div>
    
    <div class="section">
      <h2>🔷 Shape Logos</h2>
      <p style="color: #aaa; margin-bottom: 15px;">Color-coded shape logos matched by color scheme</p>
      ${Object.entries(
        shapeLogos.reduce((acc, logo) => {
          if (!acc[logo.color]) acc[logo.color] = [];
          acc[logo.color].push(logo);
          return acc;
        }, {})
      ).map(([color, logos]) => `
        <div class="color-group">
          <div class="color-group-title">
            <span class="color-badge" style="background: ${logos[0].hex};"></span>
            ${color.toUpperCase()} (${logos.length} logos)
          </div>
          <div class="logo-grid">
            ${logos.map(logo => `
              <div class="logo-item">
                <img src="${logo.path}" alt="${logo.filename}" class="logo-image" />
                <div class="logo-label">${logo.filename.replace(/54AllinOneLogos_0000s_\d+s_\d+__.*?\.png/, '').slice(0, 20)}</div>
                <div class="logo-meta">
                  ${logo.brightness} • ${logo.isTransparent ? 'Transparent' : 'Opaque'}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  </div>
</body>
</html>`;
  
  fs.writeFileSync(outputPath, html);
  console.log(`✅ Logo preview generated: ${outputPath}`);
  console.log(`   Open in browser: file://${outputPath.replace(/\\/g, '/')}`);
}

generateLogoPreview();
