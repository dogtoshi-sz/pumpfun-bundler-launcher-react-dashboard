/**
 * Test alphabet logo integration
 * Run: node test-alphabet-logos.js
 */

const { listAlphabetLogos, getAlphabetLogoPath } = require('./src/launch-logo-generator.ts');
const path = require('path');

console.log('🎨 Testing Alphabet Logo Integration\n');
console.log('='.repeat(60));

// List available alphabet logos
console.log('\n📚 Available Alphabet Logos:');
const logos = listAlphabetLogos();
console.log(`   Found ${logos.length} logos: ${logos.join(', ')}\n`);

// Test getting logo paths
console.log('🔍 Testing Logo Path Resolution:');
const testTokens = ['AlphaToken', 'BetaCoin', 'CryptoToken'];
testTokens.forEach(token => {
  const logoPath = getAlphabetLogoPath(token, undefined);
  const letter = token.charAt(0).toLowerCase();
  if (logoPath) {
    console.log(`   ✅ "${token}" → Found logo: ${path.basename(logoPath)}`);
  } else {
    console.log(`   ❌ "${token}" → No logo found for letter "${letter}"`);
  }
});

console.log('\n' + '='.repeat(60));
console.log('✨ Alphabet logos are ready to use!');
console.log('\n💡 Usage:');
console.log('   - Token name "AlphaToken" will automatically use "a.png"');
console.log('   - Token symbol "BTC" will automatically use "b.png"');
console.log('   - Or specify manually: alphabetLogo: "c"');
