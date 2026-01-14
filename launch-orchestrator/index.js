/**
 * Launch Orchestrator
 * Main class that coordinates the entire automated launch process
 */

const { getConfig, validateConfig } = require('./config');
const logger = require('./utils/logger');
const { formatDuration, formatPrice } = require('./utils/helpers');

// Services
const DomainFinder = require('./services/domain-finder');
const DomainBuyer = require('./services/domain-buyer');
const DNSManager = require('./services/dns-manager');
const SiteUpdater = require('./services/site-updater');
const AIGenerator = require('./services/ai-generator');

class LaunchOrchestrator {
  constructor(options = {}) {
    this.options = options;
    this.domainFinder = new DomainFinder();
    this.domainBuyer = new DomainBuyer();
    this.dnsManager = new DNSManager();
    this.siteUpdater = new SiteUpdater();
    this.aiGenerator = new AIGenerator();
  }

  /**
   * Validate configuration before launch
   */
  validateSetup() {
    const validation = validateConfig();
    if (!validation.valid) {
      logger.error('Configuration errors:');
      validation.errors.forEach(e => logger.error(`  - ${e}`));
      return false;
    }
    return true;
  }

  /**
   * Full automated launch process
   * 
   * @param {Object} params - Launch parameters
   * @param {string} params.tokenName - Name of the token
   * @param {string} [params.ticker] - Token ticker symbol
   * @param {string} [params.description] - Token description
   * @param {string} [params.domain] - Specific domain to use (skip search)
   * @param {string[]} [params.preferredTLDs] - Preferred domain TLDs
   * @param {number} [params.maxDomainPrice] - Maximum domain price in USD
   * @param {boolean} [params.skipDomain] - Skip domain purchase
   * @param {boolean} [params.skipLaunch] - Skip token launch (website only)
   * @param {Object} [params.tokenConfig] - Additional token configuration
   */
  async launch(params) {
    const startTime = Date.now();
    const TOTAL_STEPS = params.skipLaunch ? 5 : 6;
    let currentStep = 0;

    logger.banner(`🚀 LAUNCH ORCHESTRATOR`);
    logger.info(`Token: ${params.tokenName}`);
    logger.divider();

    const result = {
      success: false,
      tokenName: params.tokenName,
      startTime: new Date().toISOString(),
    };

    try {
      // Validate setup
      if (!this.validateSetup()) {
        throw new Error('Configuration validation failed');
      }

      // ═══════════════════════════════════════════════════════════════
      // STEP 1: Generate Token Profile
      // ═══════════════════════════════════════════════════════════════
      currentStep++;
      logger.step(currentStep, TOTAL_STEPS, 'Generating token profile...');

      const profile = await this.aiGenerator.generateTokenProfile(params.tokenName, {
        ticker: params.ticker,
        style: params.style || 'meme',
      });

      result.tokenSymbol = profile.tokenSymbol;
      result.description = params.description || profile.description;
      result.tagline = profile.tagline;
      result.colorScheme = profile.colorScheme;

      logger.success(`Profile: ${profile.tokenSymbol} - "${result.description.slice(0, 50)}..."`);

      // ═══════════════════════════════════════════════════════════════
      // STEP 2: Find Domain
      // ═══════════════════════════════════════════════════════════════
      currentStep++;
      logger.step(currentStep, TOTAL_STEPS, 'Finding available domain...');

      let domainInfo;

      if (params.domain) {
        // User specified a domain
        logger.domain(`Using specified domain: ${params.domain}`);
        const priceData = await this.domainFinder.getPrice(params.domain);
        domainInfo = {
          domain: params.domain,
          price: priceData.price,
          priceFormatted: formatPrice(priceData.price),
        };
      } else if (params.skipDomain) {
        // Skip domain purchase
        logger.warn('Domain purchase skipped');
        domainInfo = null;
      } else {
        // Find cheapest available domain
        const domains = await this.domainFinder.findDomains(params.tokenName, {
          tlds: params.preferredTLDs,
          maxPrice: params.maxDomainPrice,
          limit: 5,
        });

        if (domains.length === 0) {
          throw new Error('No available domains found within price range');
        }

        // Show options
        logger.info('Available domains:');
        domains.forEach((d, i) => {
          logger.info(`  ${i + 1}. ${d.domain} - ${d.priceFormatted}`);
        });

        domainInfo = domains[0];
        logger.success(`Selected: ${domainInfo.domain} at ${domainInfo.priceFormatted}`);
      }

      result.domain = domainInfo?.domain;
      result.domainPrice = domainInfo?.price;

      // ═══════════════════════════════════════════════════════════════
      // STEP 3: Purchase Domain
      // ═══════════════════════════════════════════════════════════════
      if (domainInfo && !params.skipDomain) {
        currentStep++;
        logger.step(currentStep, TOTAL_STEPS, 'Purchasing domain...');

        const purchase = await this.domainBuyer.purchaseAndConnect(
          domainInfo.domain,
          domainInfo.price
        );

        result.orderId = purchase.orderId;
        logger.success(`Domain purchased! Order: ${purchase.orderId}`);
      }

      // ═══════════════════════════════════════════════════════════════
      // STEP 4: Wait for DNS
      // ═══════════════════════════════════════════════════════════════
      if (domainInfo && !params.skipDomain) {
        currentStep++;
        logger.step(currentStep, TOTAL_STEPS, 'Waiting for DNS propagation...');

        const dnsResult = await this.dnsManager.waitForDomain(domainInfo.domain, {
          onProgress: (status) => {
            // Optional: emit progress events
          },
        });

        if (!dnsResult.success) {
          logger.warn('DNS propagation timeout - continuing anyway');
        }

        result.websiteUrl = dnsResult.url || `https://${domainInfo.domain}`;
        result.dnsTime = dnsResult.elapsed;
      }

      // ═══════════════════════════════════════════════════════════════
      // STEP 5: Update Website Database
      // ═══════════════════════════════════════════════════════════════
      currentStep++;
      logger.step(currentStep, TOTAL_STEPS, 'Updating website configuration...');

      if (domainInfo) {
        await this.siteUpdater.upsertSiteConfig(domainInfo.domain, {
          tokenName: params.tokenName,
          tokenSymbol: result.tokenSymbol,
          description: result.description,
          tagline: result.tagline,
          aboutContent: profile.aboutContent,
          colorScheme: result.colorScheme,
          contractAddress: null, // Will be updated after launch
          telegram: params.telegram,
          twitter: params.twitter,
          ...(params.tokenConfig || {}),
        });

        logger.success('Website configuration updated');
      }

      // ═══════════════════════════════════════════════════════════════
      // STEP 6: Launch Token (optional)
      // ═══════════════════════════════════════════════════════════════
      if (!params.skipLaunch) {
        currentStep++;
        logger.step(currentStep, TOTAL_STEPS, 'Launching token...');

        const launchResult = await this.launchToken({
          tokenName: params.tokenName,
          tokenSymbol: result.tokenSymbol,
          description: result.description,
          ...(params.tokenConfig || {}),
        });

        result.contractAddress = launchResult.contractAddress;
        result.mintAddress = launchResult.mintAddress;

        // Update website with contract address
        if (domainInfo && result.contractAddress) {
          await this.siteUpdater.upsertSiteConfig(domainInfo.domain, {
            tokenName: params.tokenName,
            tokenSymbol: result.tokenSymbol,
            description: result.description,
            contractAddress: result.contractAddress,
          });
        }

        logger.success(`Token launched! CA: ${result.contractAddress}`);
      }

      // ═══════════════════════════════════════════════════════════════
      // COMPLETE
      // ═══════════════════════════════════════════════════════════════
      const elapsed = Date.now() - startTime;
      result.success = true;
      result.elapsed = elapsed;
      result.endTime = new Date().toISOString();

      logger.divider();
      logger.banner(`✅ LAUNCH COMPLETE`);
      logger.info(`Token: ${result.tokenSymbol}`);
      if (result.domain) logger.info(`Website: https://${result.domain}`);
      if (result.contractAddress) logger.info(`Contract: ${result.contractAddress}`);
      logger.info(`Time: ${formatDuration(elapsed)}`);
      logger.divider();

      return result;

    } catch (error) {
      result.success = false;
      result.error = error.message;
      result.elapsed = Date.now() - startTime;

      logger.error(`Launch failed: ${error.message}`);
      logger.debug(error.stack);

      return result;
    } finally {
      // Cleanup
      await this.siteUpdater.disconnect();
    }
  }

  /**
   * Launch token via pumpfun bundler
   * This integrates with your existing bundler code
   */
  async launchToken(tokenData) {
    const config = getConfig();
    const path = require('path');
    const { spawn } = require('child_process');

    return new Promise((resolve, reject) => {
      logger.launch('Starting pumpfun bundler...');

      // Write token config to a temp file or pass as env
      const bundlerPath = config.bundler.rootDir;
      
      // Option 1: Trigger via npm start (your existing flow)
      // Option 2: Import and call directly
      
      // For now, we'll spawn the bundler process
      const child = spawn('npm', ['start'], {
        cwd: bundlerPath,
        shell: true,
        env: {
          ...process.env,
          TOKEN_NAME: tokenData.tokenName,
          TOKEN_SYMBOL: tokenData.tokenSymbol,
          TOKEN_DESCRIPTION: tokenData.description,
        },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        logger.launch(text.trim());

        // Look for contract address in output
        const caMatch = text.match(/Contract Address: ([A-Za-z0-9]+)/i) ||
                        text.match(/Mint: ([A-Za-z0-9]+)/i) ||
                        text.match(/Token created: ([A-Za-z0-9]+)/i);
        
        if (caMatch) {
          resolve({
            contractAddress: caMatch[1],
            mintAddress: caMatch[1],
          });
        }
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
        logger.warn(data.toString().trim());
      });

      child.on('error', (error) => {
        reject(new Error(`Bundler spawn error: ${error.message}`));
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Bundler exited with code ${code}: ${stderr}`));
        }
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        child.kill();
        reject(new Error('Token launch timeout'));
      }, 5 * 60 * 1000);
    });
  }

  /**
   * Just find domains (no purchase)
   */
  async findDomains(tokenName, options = {}) {
    return this.domainFinder.findDomains(tokenName, options);
  }

  /**
   * Just purchase a specific domain
   */
  async purchaseDomain(domain, options = {}) {
    // Get price first
    const priceData = await this.domainFinder.getPrice(domain);
    if (!priceData.price) {
      throw new Error(`Could not get price for ${domain}`);
    }

    return this.domainBuyer.purchaseAndConnect(domain, priceData.price, options);
  }

  /**
   * Check domain status
   */
  async checkDomainStatus(domain) {
    return this.dnsManager.checkDomainConfig(domain);
  }
}

// Export both class and singleton
module.exports = {
  LaunchOrchestrator,
  default: LaunchOrchestrator,
};
