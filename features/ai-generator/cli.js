#!/usr/bin/env node

/**
 * Launch Orchestrator CLI
 * Command-line interface for automated token launches
 */

const { LaunchOrchestrator } = require('./index');
const logger = require('./utils/logger');
const { formatPrice } = require('./utils/helpers');

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];

// Parse flags
const flags = {};
const positionalArgs = [];

for (let i = 1; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const [key, value] = args[i].slice(2).split('=');
    flags[key] = value || true;
  } else if (args[i].startsWith('-')) {
    flags[args[i].slice(1)] = args[i + 1] || true;
    i++;
  } else {
    positionalArgs.push(args[i]);
  }
}

// Help text
const HELP = `
🚀 Launch Orchestrator CLI

Usage:
  node cli.js <command> [options]

Commands:
  launch <name>       Full automated launch
  find <name>         Find available domains (no purchase)
  buy <domain>        Purchase a specific domain
  status <domain>     Check domain status
  list                List all configured sites
  help                Show this help

Options:
  --ticker, -t        Token ticker symbol
  --description, -d   Token description
  --domain            Specific domain to use
  --tlds              Preferred TLDs (comma-separated)
  --max-price         Maximum domain price in USD
  --skip-domain       Skip domain purchase
  --skip-launch       Skip token launch (website only)
  --dry-run           Show what would happen without doing it

Examples:
  node cli.js launch "Doge Killer" --ticker DOGEK
  node cli.js find "Moon Cat"
  node cli.js buy mooncattoken.xyz
  node cli.js status mooncattoken.xyz
`;

async function main() {
  const orchestrator = new LaunchOrchestrator();

  try {
    switch (command) {
      case 'launch': {
        const tokenName = positionalArgs.join(' ');
        if (!tokenName) {
          logger.error('Token name is required');
          console.log('Usage: node cli.js launch "Token Name" [options]');
          process.exit(1);
        }

        const result = await orchestrator.launch({
          tokenName,
          ticker: flags.ticker || flags.t,
          description: flags.description || flags.d,
          domain: flags.domain,
          preferredTLDs: flags.tlds ? flags.tlds.split(',').map(t => t.trim()) : undefined,
          maxDomainPrice: flags['max-price'] ? parseFloat(flags['max-price']) : undefined,
          skipDomain: flags['skip-domain'] === true,
          skipLaunch: flags['skip-launch'] === true,
        });

        if (result.success) {
          console.log('\n✅ Launch successful!');
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log('\n❌ Launch failed');
          console.log(result.error);
          process.exit(1);
        }
        break;
      }

      case 'find': {
        const tokenName = positionalArgs.join(' ');
        if (!tokenName) {
          logger.error('Token name is required');
          console.log('Usage: node cli.js find "Token Name"');
          process.exit(1);
        }

        logger.info(`Finding domains for: ${tokenName}`);

        const domains = await orchestrator.findDomains(tokenName, {
          tlds: flags.tlds ? flags.tlds.split(',').map(t => t.trim()) : undefined,
          maxPrice: flags['max-price'] ? parseFloat(flags['max-price']) : undefined,
          limit: parseInt(flags.limit) || 10,
        });

        if (domains.length === 0) {
          console.log('\n❌ No available domains found');
        } else {
          console.log('\n📋 Available domains:\n');
          domains.forEach((d, i) => {
            console.log(`  ${i + 1}. ${d.domain.padEnd(30)} ${d.priceFormatted}`);
          });
          console.log(`\n💡 To purchase: node cli.js buy ${domains[0].domain}`);
        }
        break;
      }

      case 'buy': {
        const domain = positionalArgs[0];
        if (!domain) {
          logger.error('Domain is required');
          console.log('Usage: node cli.js buy example.xyz');
          process.exit(1);
        }

        if (flags['dry-run']) {
          logger.info(`[DRY RUN] Would purchase: ${domain}`);
          break;
        }

        logger.info(`Purchasing domain: ${domain}`);
        
        const result = await orchestrator.purchaseDomain(domain);

        if (result.success) {
          console.log('\n✅ Domain purchased!');
          console.log(`   Order ID: ${result.orderId}`);
          console.log(`   Domain: ${domain}`);
        }
        break;
      }

      case 'status': {
        const domain = positionalArgs[0];
        if (!domain) {
          logger.error('Domain is required');
          console.log('Usage: node cli.js status example.xyz');
          process.exit(1);
        }

        logger.info(`Checking status for: ${domain}`);
        
        const status = await orchestrator.checkDomainStatus(domain);
        
        console.log('\n📊 Domain Status:\n');
        console.log(`   Domain:     ${domain}`);
        console.log(`   Verified:   ${status.verified ? '✅' : '❌'}`);
        console.log(`   Configured: ${status.configured ? '✅' : '❌'}`);
        console.log(`   SSL:        ${status.ssl || 'N/A'}`);
        if (status.error) {
          console.log(`   Error:      ${status.error}`);
        }
        break;
      }

      case 'list': {
        const SiteUpdater = require('./services/site-updater');
        const siteUpdater = new SiteUpdater();
        
        const sites = await siteUpdater.listSites();
        
        if (sites.length === 0) {
          console.log('\n📋 No sites configured yet');
        } else {
          console.log('\n📋 Configured Sites:\n');
          sites.forEach((site, i) => {
            console.log(`  ${i + 1}. ${site.domain}`);
            console.log(`     Token: ${site.token_name} (${site.token_symbol})`);
            if (site.contract_address) {
              console.log(`     CA: ${site.contract_address}`);
            }
            console.log(`     Created: ${new Date(site.created_at).toLocaleDateString()}`);
            console.log();
          });
        }
        
        await siteUpdater.disconnect();
        break;
      }

      case 'help':
      case '--help':
      case '-h':
      case undefined:
        console.log(HELP);
        break;

      default:
        logger.error(`Unknown command: ${command}`);
        console.log(HELP);
        process.exit(1);
    }

  } catch (error) {
    logger.error(`Error: ${error.message}`);
    if (flags.debug) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main().catch(console.error);
