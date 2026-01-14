/**
 * Simple test to demonstrate canvas logo generation
 * Run: node test-logo-simple.js
 */

const { createCanvas, loadImage, registerFont } = require('canvas');
const fs = require('fs');
const path = require('path');

async function generateTestLogo() {
  console.log('🎨 Generating test logo with Canvas...\n');

  // Create a 512x512 canvas
  const width = 512;
  const height = 512;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Fill background with gradient
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#1a1a2e');
  gradient.addColorStop(1, '#16213e');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Add some decorative circles
  ctx.fillStyle = 'rgba(255, 215, 0, 0.1)';
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, 200, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255, 215, 0, 0.05)';
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, 150, 0, Math.PI * 2);
  ctx.fill();

  // Draw text with shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetX = 4;
  ctx.shadowOffsetY = 4;

  // Token Name
  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 64px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('MyToken', width / 2, height / 2 - 30);

  // Token Symbol
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 48px Arial';
  ctx.fillText('MTK', width / 2, height / 2 + 40);

  // Reset shadow
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // Save the image
  const buffer = canvas.toBuffer('image/png');
  const outputPath = path.join(__dirname, 'test-logo-generated.png');
  fs.writeFileSync(outputPath, buffer);

  console.log('✅ Logo generated successfully!');
  console.log(`📁 Saved to: ${outputPath}`);
  console.log(`\n💡 This demonstrates how the logo generator works:`);
  console.log(`   1. Creates a canvas (512x512)`);
  console.log(`   2. Draws background and graphics`);
  console.log(`   3. Adds text with custom styling`);
  console.log(`   4. Exports as PNG file`);
  console.log(`\n🚀 Now you can use the API or integrate it into your launches!`);
}

generateTestLogo().catch(console.error);
