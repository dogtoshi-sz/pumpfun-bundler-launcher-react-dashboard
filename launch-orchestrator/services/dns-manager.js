/**
 * DNS Manager Service
 * Monitors DNS propagation and verifies domain connectivity
 */

const { getConfig } = require('../config');
const logger = require('../utils/logger');
const { sleep, checkUrl, formatDuration } = require('../utils/helpers');

class DNSManager {
  constructor() {
    const config = getConfig();
    this.token = config.vercel.token;
    this.teamId = config.vercel.teamId;
    this.projectId = config.vercel.projectId;
    this.apiBase = config.vercel.apiBase;
    this.checkInterval = config.timing.dnsCheckInterval;
    this.maxWait = config.timing.dnsMaxWait;
  }

  /**
   * Make authenticated request to Vercel API
   */
  async vercelRequest(endpoint) {
    const url = `${this.apiBase}${endpoint}${endpoint.includes('?') ? '&' : '?'}teamId=${this.teamId}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      throw new Error(`Vercel API error: ${error.error?.message || response.statusText}`);
    }

    return response.json();
  }

  /**
   * Check domain configuration status via Vercel API
   */
  async checkDomainConfig(domain) {
    try {
      const result = await this.vercelRequest(`/v9/projects/${this.projectId}/domains/${domain}`);
      return {
        verified: result.verified === true,
        configured: result.configured === true,
        error: result.error?.message || null,
        ssl: result.ssl?.state || null,
      };
    } catch (error) {
      return {
        verified: false,
        configured: false,
        error: error.message,
      };
    }
  }

  /**
   * Check if a domain is accessible via HTTP
   */
  async checkHttpAccess(domain) {
    const urls = [
      `https://${domain}`,
      `https://www.${domain}`,
    ];

    for (const url of urls) {
      const accessible = await checkUrl(url);
      if (accessible) {
        return { accessible: true, url };
      }
    }

    return { accessible: false };
  }

  /**
   * Wait for domain to be fully configured and accessible
   * Returns when domain is live or timeout is reached
   */
  async waitForDomain(domain, options = {}) {
    const {
      maxWait = this.maxWait,
      checkInterval = this.checkInterval,
      requireHttps = true,
      onProgress = () => {},
    } = options;

    const startTime = Date.now();
    let lastStatus = null;
    let checkCount = 0;

    logger.dns(`Waiting for ${domain} to become live...`);

    while (Date.now() - startTime < maxWait) {
      checkCount++;
      const elapsed = Date.now() - startTime;

      // Check Vercel configuration
      const config = await this.checkDomainConfig(domain);
      
      // Check HTTP accessibility
      const http = await this.checkHttpAccess(domain);

      const status = {
        elapsed,
        elapsedFormatted: formatDuration(elapsed),
        checkCount,
        verified: config.verified,
        configured: config.configured,
        ssl: config.ssl,
        accessible: http.accessible,
        url: http.url,
        error: config.error,
      };

      // Log progress
      if (JSON.stringify(status) !== JSON.stringify(lastStatus)) {
        logger.dns(`Check #${checkCount}: verified=${config.verified}, configured=${config.configured}, accessible=${http.accessible}`);
        lastStatus = status;
      }

      onProgress(status);

      // Success conditions
      if (config.verified && config.configured) {
        if (!requireHttps || http.accessible) {
          logger.success(`Domain ${domain} is live! (${formatDuration(elapsed)})`);
          return {
            success: true,
            domain,
            url: http.url || `https://${domain}`,
            elapsed,
            checkCount,
          };
        }
      }

      // Wait before next check
      await sleep(checkInterval);
    }

    // Timeout
    logger.warn(`Timeout waiting for ${domain} after ${formatDuration(maxWait)}`);
    
    return {
      success: false,
      domain,
      timeout: true,
      elapsed: Date.now() - startTime,
      checkCount,
      lastStatus,
    };
  }

  /**
   * Quick check if domain is ready (no waiting)
   */
  async isDomainReady(domain) {
    const config = await this.checkDomainConfig(domain);
    const http = await this.checkHttpAccess(domain);
    
    return config.verified && config.configured && http.accessible;
  }

  /**
   * Get SSL certificate status
   */
  async getSSLStatus(domain) {
    const config = await this.checkDomainConfig(domain);
    return {
      domain,
      ssl: config.ssl,
      verified: config.verified,
    };
  }
}

module.exports = DNSManager;
