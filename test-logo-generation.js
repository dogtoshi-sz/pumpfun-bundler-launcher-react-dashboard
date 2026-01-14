/**
 * Test script to demonstrate logo generation
 * Run: ts-node test-logo-generation.js
 * OR: node -r ts-node/register test-logo-generation.js
 */

// Register ts-node to handle TypeScript files
require('ts-node').register();

const { generateAndSaveSimpleLogo } = require('./src/simple-logo-generator.ts');
const path = require('path');

async function testLogoGeneration() {
  console.log('🎨 Testing Logo Generation...\n');

  // Ensure createdlogos directory exists
  const logosDir = path.join(__dirname, 'image', 'createdlogos');
  const fs = require('fs');
  if (!fs.existsSync(logosDir)) {
    fs.mkdirSync(logosDir, { recursive: true });
  }

  try {
    // Test 1: Simple text-only logo
    console.log('Test 1: Generating text-only logo...');
    await generateAndSaveSimpleLogo({
      tokenName: 'MyToken',
      tokenSymbol: 'MTK',
      fontSize: 60,
      textColor: '#FFD700',
      backgroundColor: '#000000',
      width: 512,
      height: 512
    }, path.join(logosDir, 'test-logo-text-only.png'));
    console.log(`✅ Text-only logo saved: image/createdlogos/test-logo-text-only.png\n`);

    // Test 2: Logo with base image (if you have one)
    // Uncomment and add your logo path:
    /*
    console.log('Test 2: Generating logo with base image...');
    await generateAndSaveSimpleLogo({
      tokenName: 'MyToken',
      tokenSymbol: 'MTK',
      baseLogoPath: './image/logos/your-logo.png', // Your logo path here
      fontSize: 48,
      textColor: '#FFFFFF',
      backgroundColor: '#1a1a1a',
      width: 512,
      height: 512,
      logoScale: 0.5
    }, path.join(logosDir, 'test-logo-with-image.png'));
    console.log(`✅ Logo with image saved: image/createdlogos/test-logo-with-image.png\n`);
    */

    // Test 3: Logo with custom font (if you have one)
    // Uncomment and add your font path:
    /*
    console.log('Test 3: Generating logo with custom font...');
    await generateAndSaveSimpleLogo({
      tokenName: 'MyToken',
      tokenSymbol: 'MTK',
      fontPath: './psd-assets/fonts/your-font.ttf', // Your font path here
      fontFamily: 'YourFontName',
      fontSize: 60,
      textColor: '#FFD700',
      backgroundColor: '#000000',
      width: 512,
      height: 512
    }, path.join(logosDir, 'test-logo-custom-font.png'));
    console.log(`✅ Logo with custom font saved: image/createdlogos/test-logo-custom-font.png\n`);
    */

    console.log('✨ All tests completed! Check the generated PNG files.');
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.message.includes('Canvas package not installed')) {
      console.log('\n💡 Make sure canvas is installed: npm install canvas');
    }
  }
}

testLogoGeneration();
