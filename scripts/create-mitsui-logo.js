const { createCanvas, registerFont } = require('canvas');
const fs = require('fs');
const path = require('path');

// Create a white circular logo with 光 in the center
async function createMitsuiLogo() {
  const size = 512;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // White circular background
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();

  // Draw 光 character in black
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 280px "Microsoft YaHei", "Noto Sans CJK", "SimHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('光', size / 2, size / 2 + 10);

  // Save to file
  const outputPath = path.join(__dirname, '..', 'image', 'createdlogos', 'mitsui-light-logo.png');
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(outputPath, buffer);
  
  console.log(`✅ Created logo at: ${outputPath}`);
  return outputPath;
}

createMitsuiLogo().catch(console.error);
