/**
 * Site Updater Service
 * Updates the dynamic website database with token information
 */

const { getConfig } = require('../config');
const logger = require('../utils/logger');

class SiteUpdater {
  constructor() {
    const config = getConfig();
    this.databaseUrl = config.database.url;
    this.pool = null;
  }

  /**
   * Initialize database connection pool
   */
  async connect() {
    if (!this.databaseUrl) {
      logger.warn('DATABASE_URL not configured - site updates will be skipped');
      return false;
    }

    try {
      // Dynamic import to avoid errors if pg is not installed
      const { Pool } = require('pg');
      this.pool = new Pool({
        connectionString: this.databaseUrl,
        ssl: this.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
      });
      
      // Test connection
      await this.pool.query('SELECT 1');
      logger.success('Connected to database');
      return true;
    } catch (error) {
      logger.error(`Database connection failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Close database connection
   */
  async disconnect() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  /**
   * Update or insert site configuration for a domain
   */
  async upsertSiteConfig(domain, tokenData) {
    if (!this.pool) {
      const connected = await this.connect();
      if (!connected) {
        logger.warn('Skipping database update - no connection');
        return { success: false, reason: 'no_database' };
      }
    }

    const {
      tokenName,
      tokenSymbol,
      description,
      contractAddress,
      tokenImageUrl,
      logoUrl,
      telegram,
      twitter,
      website,
      colorScheme = 'purple',
      tagline,
      aboutContent,
      chain = 'solana',
    } = tokenData;

    logger.info(`Updating site config for ${domain}...`);

    try {
      // Check if site_configs table exists
      const tableCheck = await this.pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'site_configs'
        )
      `);

      if (!tableCheck.rows[0].exists) {
        // Create table if it doesn't exist
        await this.createSiteConfigsTable();
      }

      // Upsert the site configuration
      const result = await this.pool.query(`
        INSERT INTO site_configs (
          domain,
          token_name,
          token_symbol,
          description,
          contract_address,
          token_image_url,
          logo_url,
          telegram,
          twitter,
          website,
          color_scheme,
          tagline,
          about_content,
          chain,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
        ON CONFLICT (domain) DO UPDATE SET
          token_name = EXCLUDED.token_name,
          token_symbol = EXCLUDED.token_symbol,
          description = EXCLUDED.description,
          contract_address = EXCLUDED.contract_address,
          token_image_url = EXCLUDED.token_image_url,
          logo_url = EXCLUDED.logo_url,
          telegram = EXCLUDED.telegram,
          twitter = EXCLUDED.twitter,
          website = EXCLUDED.website,
          color_scheme = EXCLUDED.color_scheme,
          tagline = EXCLUDED.tagline,
          about_content = EXCLUDED.about_content,
          chain = EXCLUDED.chain,
          updated_at = NOW()
        RETURNING id
      `, [
        domain,
        tokenName,
        tokenSymbol,
        description,
        contractAddress,
        tokenImageUrl,
        logoUrl,
        telegram,
        twitter,
        website || `https://${domain}`,
        colorScheme,
        tagline || `The future of ${tokenName}`,
        aboutContent || `# About ${tokenName}\n\n${description}`,
        chain,
      ]);

      logger.success(`Site config updated for ${domain} (ID: ${result.rows[0]?.id})`);

      return {
        success: true,
        domain,
        id: result.rows[0]?.id,
      };
    } catch (error) {
      logger.error(`Failed to update site config: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create the site_configs table if it doesn't exist
   */
  async createSiteConfigsTable() {
    logger.info('Creating site_configs table...');

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS site_configs (
        id SERIAL PRIMARY KEY,
        domain VARCHAR(255) UNIQUE NOT NULL,
        token_name VARCHAR(255) NOT NULL,
        token_symbol VARCHAR(20),
        description TEXT,
        contract_address VARCHAR(255),
        token_image_url TEXT,
        logo_url TEXT,
        telegram VARCHAR(255),
        twitter VARCHAR(255),
        website VARCHAR(255),
        color_scheme VARCHAR(50) DEFAULT 'purple',
        tagline TEXT,
        about_content TEXT,
        early_access_content TEXT,
        documentation_content TEXT,
        chain VARCHAR(50) DEFAULT 'solana',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    logger.success('site_configs table created');
  }

  /**
   * Get site configuration for a domain
   */
  async getSiteConfig(domain) {
    if (!this.pool) {
      await this.connect();
    }

    try {
      const result = await this.pool.query(
        'SELECT * FROM site_configs WHERE domain = $1',
        [domain]
      );
      return result.rows[0] || null;
    } catch (error) {
      logger.error(`Failed to get site config: ${error.message}`);
      return null;
    }
  }

  /**
   * List all site configurations
   */
  async listSites() {
    if (!this.pool) {
      await this.connect();
    }

    try {
      const result = await this.pool.query(
        'SELECT domain, token_name, token_symbol, contract_address, created_at FROM site_configs ORDER BY created_at DESC'
      );
      return result.rows;
    } catch (error) {
      logger.error(`Failed to list sites: ${error.message}`);
      return [];
    }
  }

  /**
   * Delete a site configuration
   */
  async deleteSiteConfig(domain) {
    if (!this.pool) {
      await this.connect();
    }

    try {
      await this.pool.query('DELETE FROM site_configs WHERE domain = $1', [domain]);
      logger.success(`Deleted site config for ${domain}`);
      return { success: true };
    } catch (error) {
      logger.error(`Failed to delete site config: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

module.exports = SiteUpdater;
