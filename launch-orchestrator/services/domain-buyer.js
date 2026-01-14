/**
 * Domain Buyer Service
 * Purchases domains via Vercel Registrar API
 */

const { getConfig } = require('../config');
const logger = require('../utils/logger');
const { formatPrice } = require('../utils/helpers');

class DomainBuyer {
  constructor() {
    const config = getConfig();
    this.token = config.vercel.token;
    this.teamId = config.vercel.teamId;
    this.projectId = config.vercel.projectId;
    this.apiBase = config.vercel.apiBase;
    this.contactInfo = config.domainContact;
    this.autoRenew = config.domain.autoRenew;
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

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(`Vercel API error: ${data.error?.message || response.statusText}`);
    }

    return data;
  }

  /**
   * Purchase a domain
   * @param {string} domain - Domain to purchase
   * @param {number} expectedPrice - Expected price (for confirmation)
   * @param {number} years - Number of years to purchase (default: 1)
   */
  async purchaseDomain(domain, expectedPrice, years = 1) {
    logger.domain(`Purchasing domain: ${domain}`);
    logger.domain(`Price: ${formatPrice(expectedPrice)} for ${years} year(s)`);

    try {
      const result = await this.vercelRequest(`/v1/registrar/domains/${domain}/buy`, {
        method: 'POST',
        body: JSON.stringify({
          autoRenew: this.autoRenew,
          years,
          expectedPrice,
          contactInformation: {
            firstName: this.contactInfo.firstName,
            lastName: this.contactInfo.lastName,
            email: this.contactInfo.email,
            phone: this.contactInfo.phone,
            address1: this.contactInfo.address1,
            city: this.contactInfo.city,
            state: this.contactInfo.state,
            zip: this.contactInfo.zip,
            country: this.contactInfo.country,
          },
        }),
      });

      logger.success(`Domain purchased! Order ID: ${result.orderId}`);

      return {
        success: true,
        domain,
        orderId: result.orderId,
        price: expectedPrice,
        years,
      };
    } catch (error) {
      logger.error(`Failed to purchase domain: ${error.message}`);
      throw error;
    }
  }

  /**
   * Add purchased domain to a Vercel project
   * This connects the domain to your website
   */
  async addDomainToProject(domain, projectId = this.projectId) {
    logger.domain(`Adding ${domain} to project ${projectId}...`);

    try {
      const result = await this.vercelRequest(`/v10/projects/${projectId}/domains`, {
        method: 'POST',
        body: JSON.stringify({
          name: domain,
        }),
      });

      logger.success(`Domain ${domain} added to project!`);

      return {
        success: true,
        domain,
        verified: result.verified,
        configured: result.configured,
      };
    } catch (error) {
      // If domain already exists on project, that's okay
      if (error.message.includes('already exists')) {
        logger.warn(`Domain ${domain} was already added to project`);
        return {
          success: true,
          domain,
          alreadyExists: true,
        };
      }
      logger.error(`Failed to add domain to project: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get domain configuration status
   */
  async getDomainStatus(domain) {
    try {
      const result = await this.vercelRequest(`/v9/projects/${this.projectId}/domains/${domain}`);
      return {
        domain,
        verified: result.verified,
        configured: result.configured,
        error: result.error,
      };
    } catch (error) {
      return {
        domain,
        error: error.message,
      };
    }
  }

  /**
   * Get order status
   */
  async getOrderStatus(orderId) {
    try {
      const result = await this.vercelRequest(`/v1/registrar/orders/${orderId}`);
      return result;
    } catch (error) {
      return {
        orderId,
        error: error.message,
      };
    }
  }

  /**
   * Full purchase flow: buy domain and add to project
   */
  async purchaseAndConnect(domain, price, options = {}) {
    const { years = 1, projectId = this.projectId } = options;

    // 1. Purchase the domain
    const purchase = await this.purchaseDomain(domain, price, years);

    // 2. Add to project
    const connection = await this.addDomainToProject(domain, projectId);

    return {
      ...purchase,
      ...connection,
    };
  }

  /**
   * Remove/disconnect domain from a Vercel project
   * This disconnects the domain but you still OWN it (can reconnect later)
   */
  async removeDomainFromProject(domain, projectId = this.projectId) {
    logger.domain(`Removing ${domain} from project ${projectId}...`);

    try {
      await this.vercelRequest(`/v9/projects/${projectId}/domains/${domain}`, {
        method: 'DELETE',
      });

      logger.success(`Domain ${domain} disconnected from project!`);

      return {
        success: true,
        domain,
        disconnected: true,
      };
    } catch (error) {
      // If domain doesn't exist on project, that's okay
      if (error.message.includes('not found') || error.message.includes('does not exist')) {
        logger.warn(`Domain ${domain} was not connected to project`);
        return {
          success: true,
          domain,
          alreadyDisconnected: true,
        };
      }
      logger.error(`Failed to remove domain from project: ${error.message}`);
      throw error;
    }
  }

  /**
   * List all domains connected to a project
   */
  async listProjectDomains(projectId = this.projectId) {
    try {
      const result = await this.vercelRequest(`/v9/projects/${projectId}/domains`);
      return {
        success: true,
        domains: result.domains || [],
      };
    } catch (error) {
      logger.error(`Failed to list project domains: ${error.message}`);
      return {
        success: false,
        domains: [],
        error: error.message,
      };
    }
  }
}

module.exports = DomainBuyer;
