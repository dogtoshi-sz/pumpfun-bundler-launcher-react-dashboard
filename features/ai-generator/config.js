/**
 * Configuration loader for Launch Orchestrator
 * Loads environment variables and provides defaults
 */

const path = require('path');
const fs = require('fs');

// Load .env from parent directory (pumpfun bundler root)
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=').replace(/^["']|["']$/g, '');
        if (key && !process.env[key]) {
          process.env[key] = value;
        }
      }
    });
  }
}

loadEnv();

const config = {
  // Vercel API
  vercel: {
    token: process.env.VERCEL_TOKEN,
    teamId: process.env.VERCEL_TEAM_ID,
    projectId: process.env.VERCEL_PROJECT_ID,
    apiBase: 'https://api.vercel.com',
  },

  // Domain registration contact info
  domainContact: {
    firstName: process.env.DOMAIN_CONTACT_FIRST_NAME || 'John',
    lastName: process.env.DOMAIN_CONTACT_LAST_NAME || 'Doe',
    email: process.env.DOMAIN_CONTACT_EMAIL || 'contact@example.com',
    phone: process.env.DOMAIN_CONTACT_PHONE || '+1234567890',
    address1: process.env.DOMAIN_CONTACT_ADDRESS || '123 Main St',
    city: process.env.DOMAIN_CONTACT_CITY || 'New York',
    state: process.env.DOMAIN_CONTACT_STATE || 'NY',
    zip: process.env.DOMAIN_CONTACT_ZIP || '10001',
    country: process.env.DOMAIN_CONTACT_COUNTRY || 'US',
  },

  // Domain preferences
  domain: {
    preferredTLDs: ['.xyz', '.fun', '.io', '.app', '.dev', '.com'],
    maxPrice: parseFloat(process.env.MAX_DOMAIN_PRICE) || 50, // USD
    autoRenew: process.env.DOMAIN_AUTO_RENEW === 'true',
  },

  // OpenAI (optional, for AI-generated content)
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  },

  // Database for dynamic website
  database: {
    url: process.env.DATABASE_URL,
  },

  // Pumpfun bundler paths
  bundler: {
    rootDir: path.join(__dirname, '..'),
    keysDir: path.join(__dirname, '..', 'keys'),
    configPath: path.join(__dirname, '..', 'config.json'),
  },

  // Timeouts and retries
  timing: {
    dnsCheckInterval: 10000, // 10 seconds
    dnsMaxWait: 300000, // 5 minutes
    httpTimeout: 30000, // 30 seconds
  },
};

/**
 * Validate required configuration
 */
function validateConfig() {
  const errors = [];

  if (!config.vercel.token) {
    errors.push('VERCEL_TOKEN is required');
  }
  if (!config.vercel.teamId) {
    errors.push('VERCEL_TEAM_ID is required');
  }
  if (!config.vercel.projectId) {
    errors.push('VERCEL_PROJECT_ID is required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get config with validation
 */
function getConfig(requireValidation = false) {
  if (requireValidation) {
    const validation = validateConfig();
    if (!validation.valid) {
      throw new Error(`Configuration errors:\n${validation.errors.join('\n')}`);
    }
  }
  return config;
}

module.exports = {
  config,
  getConfig,
  validateConfig,
};
