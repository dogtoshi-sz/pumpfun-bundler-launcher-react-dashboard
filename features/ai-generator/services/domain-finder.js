/**
 * Domain Finder Service
 * Searches for available domains and compares prices using Vercel API
 */

const { getConfig } = require('../config');
const logger = require('../utils/logger');
const { generateDomainSuggestions, formatPrice, retry } = require('../utils/helpers');

class DomainFinder {
  constructor() {
    const config = getConfig();
    this.token = config.vercel.token;
    this.teamId = config.vercel.teamId;
    this.apiBase = config.vercel.apiBase;
    this.preferredTLDs = config.domain.preferredTLDs;
    this.maxPrice = config.domain.maxPrice;
  }

  /**
   * Make authenticated request to Vercel API
   */
  async vercelRequest(endpoint, options = {}) {
    const url = `${this.apiBase}${endpoint}${endpoint.includes('?') ? '&' : '?'}teamId=${this.teamId}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      throw new Error(`Vercel API error: ${error.error?.message || response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get supported TLDs from Vercel
   */
  async getSupportedTLDs() {
    logger.domain('Fetching supported TLDs...');
    const data = await this.vercelRequest('/v1/registrar/tlds');
    return data.tlds || [];
  }

  /**
   * Check if a specific domain is available
   */
  async checkAvailability(domain) {
    try {
      const data = await this.vercelRequest(`/v1/registrar/domains/${domain}/availability`);
      return {
        domain,
        available: data.available === true,
        premium: data.premium || false,
      };
    } catch (error) {
      logger.debug(`Availability check failed for ${domain}: ${error.message}`);
      return {
        domain,
        available: false,
        error: error.message,
      };
    }
  }

  /**
   * Get price for a specific domain
   */
  async getPrice(domain) {
    try {
      const data = await this.vercelRequest(`/v1/registrar/domains/${domain}/price`);
      return {
        domain,
        price: data.price,
        period: data.period || 1,
        currency: 'USD',
      };
    } catch (error) {
      logger.debug(`Price check failed for ${domain}: ${error.message}`);
      return {
        domain,
        price: null,
        error: error.message,
      };
    }
  }

  /**
   * Check availability for multiple domains at once
   */
  async checkMultipleAvailability(domains) {
    try {
      const data = await this.vercelRequest('/v1/registrar/domains/availability', {
        method: 'POST',
        body: JSON.stringify({ domains }),
      });
      return data.domains || [];
    } catch (error) {
      // Fallback to individual checks
      logger.warn('Bulk availability check failed, falling back to individual checks');
      const results = [];
      for (const domain of domains) {
        results.push(await this.checkAvailability(domain));
      }
      return results;
    }
  }

  /**
   * Find available domains for a token name
   * Returns sorted list by price (cheapest first)
   */
  async findDomains(tokenName, options = {}) {
    const {
      tlds = this.preferredTLDs,
      maxPrice = this.maxPrice,
      limit = 10,
    } = options;

    logger.domain(`Searching domains for: "${tokenName}"`);
    
    // Generate domain suggestions
    const suggestions = generateDomainSuggestions(tokenName, tlds);
    logger.domain(`Generated ${suggestions.length} domain suggestions`);

    // Check availability one by one (more reliable)
    logger.domain(`Checking ${suggestions.length} domains individually...`);
    const availableDomains = [];
    
    for (let i = 0; i < suggestions.length && availableDomains.length < 20; i++) {
      const domain = suggestions[i];
      try {
        // Add delay between requests to avoid rate limits (Vercel: 20 req/min)
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 3500)); // ~17 req/min to be safe
        }
        
        const availability = await this.checkAvailability(domain);
        if (availability.available && !availability.premium) {
          // Small delay before price check
          await new Promise(resolve => setTimeout(resolve, 3500));
          
          // Check price immediately
          const priceData = await this.getPrice(domain);
          if (priceData.price && priceData.price < maxPrice) { // STRICT: under maxPrice
            availableDomains.push({
              domain,
              price: priceData.price,
              period: priceData.period,
              priceFormatted: formatPrice(priceData.price),
            });
            logger.domain(`✅ Found: ${domain} at ${formatPrice(priceData.price)}`);
          }
        }
      } catch (error) {
        // If rate limited, wait longer
        if (error.message && error.message.includes('Too Many Requests')) {
          logger.warn(`Rate limited, waiting 10 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 10000));
          i--; // Retry this domain
        }
        // Skip other errors, continue checking
      }
    }
    
    logger.domain(`Found ${availableDomains.length} available domains under $${maxPrice}`);

    if (availableDomains.length === 0) {
      return [];
    }

    // Already have prices, just sort
    const domainsWithPrices = availableDomains;

    // Sort by price (cheapest first)
    domainsWithPrices.sort((a, b) => a.price - b.price);

    // Return top results
    const results = domainsWithPrices.slice(0, limit);
    
    if (results.length > 0) {
      logger.domain(`Best option: ${results[0].domain} at ${results[0].priceFormatted}`);
    }

    return results;
  }

  /**
   * Find the single cheapest available domain
   */
  async findCheapest(tokenName, options = {}) {
    const domains = await this.findDomains(tokenName, { ...options, limit: 1 });
    return domains[0] || null;
  }
}

module.exports = DomainFinder;
