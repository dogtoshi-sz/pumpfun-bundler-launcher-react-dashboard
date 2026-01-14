#!/usr/bin/env node
/**
 * Branding Generator CLI
 * Generate token logos, website logos, and Twitter banners
 * 
 * Usage:
 *   node generate-branding.js "Token Name" "TICKER" --color=purple
 *   node generate-branding.js --list-icons
 *   node generate-branding.js --list-colors
 */

const BrandingGenerator = require('./services/branding-generator');
const logger = require('./utils/logger');

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help')) {
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║                    BRANDING GENERATOR                          ║
╠════════════════════════════════════════════════════════════════╣
║  Generate professional token branding assets                   ║
╚════════════════════════════════════════════════════════════════╝

Usage:
  node generate-branding.js "Token Name" "TICKER" [options]

Options:
  --color=<scheme>    Color scheme (purple, blue, green, red, etc.)
  --tagline="..."     Optional tagline for Twitter banner
  --icon=<name>       Force specific icon (rocket, dog, moon, etc.)
  --list-icons        Show all available icons
  --list-colors       Show all color schemes

Examples:
  node generate-branding.js "Moon Dog" "MDOG" --color=purple
  node generate-branding.js "Diamond Hands" "DHAND" --color=gold --tagline="Hold forever"
  node generate-branding.js "CatCoin" "CAT" --icon=cat --color=pink

Output:
  - token-logo-[timestamp].png (500x500, with background)
  - website-logo-[timestamp].png (transparent, icon + text)
  - twitter-banner-[timestamp].png (1500x500, stylized)
`);
    return;
  }
  
  const generator = new BrandingGenerator();
  
  // List icons
  if (args.includes('--list-icons')) {
    const icons = generator.listIcons();
    console.log('\n📦 Available Icons (' + icons.length + '):\n');
    
    // Group by first letter
    const grouped = {};
    icons.forEach(icon => {
      const letter = icon[0].toUpperCase();
      if (!grouped[letter]) grouped[letter] = [];
      grouped[letter].push(icon);
    });
    
    Object.keys(grouped).sort().forEach(letter => {
      console.log(`  ${letter}: ${grouped[letter].join(', ')}`);
    });
    return;
  }
  
  // List color schemes
  if (args.includes('--list-colors')) {
    const colors = generator.listColorSchemes();
    console.log('\n🎨 Available Color Schemes:\n');
    colors.forEach(c => {
      const scheme = generator.getColorScheme(c);
      console.log(`  • ${c.padEnd(10)} - Primary: ${scheme.primary}`);
    });
    return;
  }
  
  // Parse arguments
  const tokenName = args[0];
  const ticker = args[1] || tokenName.split(' ')[0].toUpperCase();
  
  // Parse options
  let colorScheme = 'purple';
  let tagline = null;
  let iconName = null;
  
  args.forEach(arg => {
    if (arg.startsWith('--color=')) {
      colorScheme = arg.split('=')[1];
    }
    if (arg.startsWith('--tagline=')) {
      tagline = arg.split('=')[1];
    }
    if (arg.startsWith('--icon=')) {
      iconName = arg.split('=')[1];
    }
  });
  
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║                    GENERATING BRANDING                         ║
╠════════════════════════════════════════════════════════════════╣
║  Token:  ${tokenName.padEnd(50)}║
║  Ticker: $${ticker.padEnd(49)}║
║  Color:  ${colorScheme.padEnd(50)}║
${tagline ? `║  Tagline: ${tagline.padEnd(48)}║\n` : ''}╚════════════════════════════════════════════════════════════════╝
`);

  try {
    const results = await generator.generateAllAssets(tokenName, ticker, {
      colorScheme,
      tagline,
      iconName,
    });
    
    console.log('\n✅ GENERATION COMPLETE!\n');
    console.log('📁 Files saved to: launch-orchestrator/assets/generated/\n');
    console.log(`   🪙 Token Logo:     ${results.tokenLogo.filename}`);
    console.log(`   🌐 Website Logo:   ${results.websiteLogo.filename}`);
    console.log(`   🐦 Twitter Banner: ${results.twitterBanner.filename}`);
    console.log(`\n   🎨 Icon used: ${results.icon}`);
    console.log(`   🎨 Color scheme: ${results.colorScheme}\n`);
    
  } catch (error) {
    logger.error(`Failed to generate branding: ${error.message}`);
    console.error(error);
  }
}

main();
