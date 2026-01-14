/**
 * Test script for launch logo generation
 * Generates token logo, website logo, and twitter banner
 * 
 * Run: npx ts-node test-launch-logos.js
 */

require('ts-node').register();

const { generateLaunchLogos, listAlphabetLogos } = require('./src/launch-logo-generator.ts');
const path = require('path');

async function testLaunchLogos() {
  console.log('🎨 Testing Launch Logo Generation\n');
  console.log('='.repeat(60));
  
  // List available alphabet logos
  console.log('\n📚 Available Alphabet Logos:');
  const alphabetLogos = listAlphabetLogos();
  console.log(`   Found ${alphabetLogos.length} alphabet logos: ${alphabetLogos.join(', ')}\n`);
  
  // Test with token name starting with 'A'
  console.log('🚀 Generating launch logos for token: "AlphaToken" (ATK)\n');
  
  try {
    const logos = await generateLaunchLogos({
      tokenName: 'AlphaToken',
      tokenSymbol: 'ATK',
      alphabetLogo: 'a', // Use 'a' alphabet logo
      primaryColor: '#FFD700',
      backgroundColor: '#000000'
    });
    
    console.log('✅ Generated Logos:');
    console.log(`   📦 Token Logo: ${path.basename(logos.tokenLogo)}`);
    console.log(`   🌐 Website Logo: ${path.basename(logos.websiteLogo)}`);
    console.log(`   🐦 Twitter Banner: ${path.basename(logos.twitterBanner)}`);
    console.log(`\n   All logos saved to: image/createdlogos/`);
    
    console.log('\n' + '='.repeat(60));
    console.log('✨ Test Complete!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.message.includes('Canvas package not installed')) {
      console.log('\n💡 Make sure canvas is installed: npm install canvas');
    }
  }
}

testLaunchLogos();
