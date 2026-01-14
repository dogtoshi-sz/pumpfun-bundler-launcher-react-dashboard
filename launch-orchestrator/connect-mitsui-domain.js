/**
 * Find and connect cheapest domain for mitsui project
 */

const DomainFinder = require('./services/domain-finder');
const DomainBuyer = require('./services/domain-buyer');
const logger = require('./utils/logger');

async function connectMitsuiDomain() {
  try {
    const finder = new DomainFinder();
    const buyer = new DomainBuyer();
    
    logger.info('🔍 Finding cheapest domain for "mitsui" variations...');
    
    // Try multiple variations
    const variations = ['mitsuiai', 'mitsuiapp', 'mitsuifun', 'mitsuixyz', 'mitsui', 'mitsuicoin', 'mitsuidefi'];
    let allDomains = [];
    
    for (const variation of variations) {
      logger.info(`\n🔎 Searching: ${variation}...`);
      try {
        const domains = await finder.findDomains(variation, {
          maxPrice: 4.99, // STRICT: Under $5 only
          limit: 20,
          tlds: ['.xyz', '.fun', '.app', '.dev', '.io', '.co', '.net', '.org'], // Focus on cheap TLDs
        });
        allDomains.push(...domains);
        if (domains.length > 0) {
          logger.info(`   Found ${domains.length} available domain(s)`);
        }
      } catch (error) {
        logger.warn(`   Error searching ${variation}: ${error.message}`);
      }
    }
    
    // Remove duplicates and sort by price
    const uniqueDomains = [];
    const seen = new Set();
    for (const domain of allDomains) {
      if (!seen.has(domain.domain)) {
        seen.add(domain.domain);
        uniqueDomains.push(domain);
      }
    }
    
    // Sort by price (cheapest first)
    uniqueDomains.sort((a, b) => a.price - b.price);
    
    const domains = uniqueDomains;
    
    if (domains.length === 0) {
      logger.error('❌ No available domains found within price range');
      logger.info('💡 Try increasing maxPrice or checking different TLDs');
      return;
    }
    
    // Log all found domains for reference
    logger.info(`\n📊 Found ${domains.length} available domain(s):`);
    
    logger.info('\n📋 Available domains:');
    domains.forEach((d, i) => {
      logger.info(`  ${i + 1}. ${d.domain.padEnd(30)} ${d.priceFormatted}`);
    });
    
    const cheapest = domains[0];
    logger.success(`\n✅ Selected: ${cheapest.domain} at ${cheapest.priceFormatted}`);
    
    // Purchase and connect
    logger.info(`\n💰 Purchasing and connecting ${cheapest.domain}...`);
    const result = await buyer.purchaseAndConnect(cheapest.domain, cheapest.price);
    
    if (result.success) {
      logger.success(`\n✅ Domain purchased and connected!`);
      logger.info(`   Domain: ${cheapest.domain}`);
      logger.info(`   Order ID: ${result.orderId}`);
      logger.info(`   Project: mitsui (${process.env.VERCEL_PROJECT_ID})`);
      logger.info(`\n🌐 Your site will be available at: https://${cheapest.domain}`);
    }
    
  } catch (error) {
    logger.error(`❌ Error: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

connectMitsuiDomain();
