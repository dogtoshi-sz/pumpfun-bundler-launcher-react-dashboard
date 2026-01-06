/**
 * Website Update Module
 * 
 * Saves token website configuration to PostgreSQL database
 * Based on Nodematrix-v2 implementation
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Import pg - use require for better compatibility with ts-node
// pg is installed in api-server/node_modules, but ts-node should resolve it
const pg = require('pg');
const { Client } = pg;

// Load .env from root directory
// When loaded via ts-node from api-server, __dirname is marketing/website/
// So we need to go up to root: ../../.env
// But process.cwd() should be the project root when API server runs
const rootEnvPath = path.resolve(__dirname, '../../.env');
// Also try process.cwd() as fallback (for different execution contexts)
const altEnvPath = path.join(process.cwd(), '.env');
const envPath = fs.existsSync(rootEnvPath) ? rootEnvPath : altEnvPath;
dotenv.config({ path: envPath, override: true });
console.log('[Website Update] Loading .env from:', envPath);

interface TokenConfig {
  tokenName?: string;
  tokenSymbol?: string;
  tokenAddress?: string;
  website?: string;
  telegram?: string;
  twitter?: string;
  description?: string;
  chain?: string;
  logoUrl?: string | null;
  tokenImageUrl?: string | null;
  colorScheme?: string;
  theme?: string; // Direct theme name (e.g., 'blue', 'green', 'purple')
  themeName?: string; // Alternative name for theme
  darkMode?: boolean;
}

interface WebsiteUpdateOptions {
  siteUrl: string;
  secret?: string; // Optional - NOT used for direct database saves, only for Vercel API if using that method
  tokenConfig: TokenConfig;
}

/**
 * Get PostgreSQL connection string from environment
 */
function getDatabaseUrl(): string {
  // Match Nodematrix exactly - it just reads from process.env directly
  // Next.js automatically loads .env into process.env, so Nodematrix doesn't need dotenv.config()
  // Our API server sets process.env.DATABASE_URL before calling this function, so we should have it
  let databaseUrl = process.env.DATABASE_URL || process.env.RAILWAY_DATABASE_URL || '';
  
  if (!databaseUrl) {
    // Fallback: try loading .env manually (shouldn't be needed if API server set it)
    console.warn('[Website Update] DATABASE_URL not in process.env, trying to load from .env file...');
    dotenv.config({ path: envPath, override: true });
    databaseUrl = process.env.DATABASE_URL || process.env.RAILWAY_DATABASE_URL || '';
  }
  
  if (!databaseUrl) {
    console.error('[Website Update] DATABASE_URL not found in process.env');
    console.error('[Website Update] Available DATABASE-related env vars:', Object.keys(process.env).filter(k => k.includes('DATABASE')));
    console.error('[Website Update] .env file path:', envPath);
    console.error('[Website Update] .env file exists:', fs.existsSync(envPath));
    throw new Error('DATABASE_URL not configured. Set DATABASE_URL to PostgreSQL connection string.');
  }
  
  console.log('[Website Update] Using DATABASE_URL:', databaseUrl.replace(/:[^:@]+@/, ':****@'));
  
  // Replace Railway internal hostname with public hostname for local development
  // postgres.railway.internal only works inside Railway's network
  // For local testing, use the public Railway URL (usually postgres.railway.app or similar)
  if (databaseUrl.includes('postgres.railway.internal')) {
    console.warn('[Website Update] ⚠️  Detected Railway internal hostname. This only works inside Railway network.');
    console.warn('[Website Update] 💡 For local testing, use the public Railway database URL from your Railway dashboard.');
    console.warn('[Website Update] 💡 Format: postgresql://user:password@postgres.railway.app:5432/railway');
    throw new Error('Cannot use Railway internal hostname (postgres.railway.internal) from local machine.\n\n' +
      'For local testing, you need the PUBLIC Railway database URL.\n\n' +
      'Get it from:\n' +
      '1. Railway Dashboard → Your Database → Connect → Public Network\n' +
      '2. Copy the "Connection URL" (starts with postgresql://...)\n' +
      '3. It should have a hostname like postgres.railway.app (not .internal)\n\n' +
      'Then set DATABASE_URL in your .env file with the public URL.');
  }
  
  // Don't modify the connection string - use it exactly as provided (like Nodematrix)
  // TCP proxy works without SSL, HTTP domain needs SSL (handled in connection config)
  return databaseUrl;
}

/**
 * Normalize domain (extract base domain)
 */
function extractBaseDomain(domain: string): string {
  if (!domain || !domain.trim()) {
    console.warn('[Website Update] ⚠️  Empty domain provided, using localhost');
    return 'localhost';
  }
  
  // Remove protocol (https://, http://)
  let normalized = domain.trim().replace(/^https?:\/\//, '');
  
  // Remove trailing slash
  normalized = normalized.replace(/\/$/, '');
  
  // Remove port number if present (e.g., :3000)
  normalized = normalized.replace(/:\d+$/, '');
  
  // Remove www. prefix
  normalized = normalized.replace(/^www\./, '');
  
  // Remove docs. prefix
  normalized = normalized.replace(/^docs\./, '');
  
  // For any other subdomain, keep only domain.tld (last 2 parts)
  // BUT: Only if it's clearly a subdomain (more than 2 parts)
  const parts = normalized.split('.');
  if (parts.length > 2) {
    // Check if it's a known TLD with subdomain (e.g., example.co.uk should keep co.uk)
    // For now, simple approach: if more than 2 parts, keep last 2
    // This handles: subdomain.example.com -> example.com
    normalized = parts.slice(-2).join('.');
  }
  
  // Convert to lowercase for consistency
  normalized = normalized.toLowerCase();
  
  console.log(`[Website Update] Domain normalization: "${domain}" -> "${normalized}"`);
  
  return normalized;
}

/**
 * Update website configuration in PostgreSQL
 */
export async function updateWebsiteConfig(options: WebsiteUpdateOptions): Promise<{
  success: boolean;
  site_url?: string;
  error?: string;
}> {
  let client: Client | null = null;
  
  try {
    const { siteUrl, tokenConfig, secret } = options;
    
    // Note: secret is NOT used for direct database saves
    // It's only for Vercel API authentication (if using Vercel deployment method)
    // For direct PostgreSQL saves, we don't need a secret
    
    if (!siteUrl || !siteUrl.trim()) {
      throw new Error('Website URL is required');
    }
    
    if (!tokenConfig) {
      throw new Error('Token config is required');
    }
    
    // Connect to PostgreSQL
    const databaseUrl = getDatabaseUrl();
    
    if (!databaseUrl || !databaseUrl.trim()) {
      throw new Error('DATABASE_URL is not configured. Please set DATABASE_URL in your .env file.');
    }
    
    // Configure SSL - match Nodematrix but handle TCP proxy differently
    // Nodematrix uses: ssl: databaseUrl.includes('railway') || databaseUrl.includes('rlwy.net') ? { rejectUnauthorized: false } : false
    // However, TCP proxy (proxy.rlwy.net) might not support SSL, causing ECONNRESET
    // Try without SSL for TCP proxy first
    const isProxy = databaseUrl.includes('proxy.rlwy.net');
    let sslConfig: any = false;
    
    if (isProxy) {
      // TCP proxy: try without SSL first (most TCP proxies don't support SSL)
      sslConfig = false;
      console.log('[Website Update] Using TCP proxy - SSL disabled');
    } else if (databaseUrl.includes('railway') || databaseUrl.includes('rlwy.net')) {
      // HTTP domain: SSL required (like Nodematrix)
      sslConfig = { rejectUnauthorized: false };
      console.log('[Website Update] Using HTTP domain - SSL enabled');
    }
    
    // Extract hostname for logging
    const hostMatch = databaseUrl.match(/@([^:]+)/);
    const hostname = hostMatch ? hostMatch[1] : 'unknown';
    
    console.log('[Website Update] 🔌 Connecting to PostgreSQL...');
    console.log('[Website Update] Host:', hostname);
    console.log('[Website Update] SSL:', sslConfig ? 'enabled' : 'disabled');
    
    // Simple connection - match Nodematrix exactly (no timeouts, no keepAlive, no retries)
    // Nodematrix connects instantly, so we should too
    client = new Client({
      connectionString: databaseUrl,
      ssl: sslConfig,
      // Don't set connectionTimeoutMillis - let pg use defaults
      // Don't set keepAlive - not needed for simple connections
    });
    
    await client.connect();
    console.log('[Website Update] ✅ Connected to Railway PostgreSQL');
    
    // Ensure site_config table exists - match Nodematrix exactly
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS site_config (
          id SERIAL PRIMARY KEY,
          site_url VARCHAR(255) UNIQUE NOT NULL,
          token_name VARCHAR(255),
          token_symbol VARCHAR(50),
          token_address VARCHAR(42),
          contract_address VARCHAR(42),
          chain VARCHAR(50),
          description TEXT,
          website TEXT,
          telegram TEXT,
          twitter TEXT,
          docs TEXT,
          logo_url TEXT,
          website_logo_image TEXT,
          token_image_url TEXT,
          total_supply VARCHAR(255),
          decimals INTEGER,
          pool_address VARCHAR(42),
          deployment_tx_hash VARCHAR(66),
          explorer_url TEXT,
          site_id VARCHAR(255),
          automation_name VARCHAR(255),
          color_scheme VARCHAR(50),
          theme_name VARCHAR(50),
          dark_mode BOOLEAN,
          template VARCHAR(50) DEFAULT 'original',
          tokenomics TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE INDEX IF NOT EXISTS idx_site_config_site_url ON site_config(site_url);
        CREATE INDEX IF NOT EXISTS idx_site_config_contract_address ON site_config(contract_address);
        CREATE INDEX IF NOT EXISTS idx_site_config_token_address ON site_config(token_address);
      `);
      console.log('[Website Update] ✅ Verified site_config table exists');
      
      // Add missing columns if table already existed (for existing databases)
      // These are for razebot compatibility - Nodematrix only uses logo_url and color_scheme
      try {
        await client.query(`
          ALTER TABLE site_config 
          ADD COLUMN IF NOT EXISTS website_logo_image TEXT;
        `);
      } catch (e: any) {
        // Column might already exist or error - that's OK
        if (!e.message?.includes('already exists')) {
          console.warn('[Website Update] Could not add website_logo_image column:', e.message);
        }
      }
      
      try {
        await client.query(`
          ALTER TABLE site_config 
          ADD COLUMN IF NOT EXISTS theme_name VARCHAR(50);
        `);
      } catch (e: any) {
        // Column might already exist or error - that's OK
        if (!e.message?.includes('already exists')) {
          console.warn('[Website Update] Could not add theme_name column:', e.message);
        }
      }
      
      console.log('[Website Update] ✅ Verified all required columns exist');
    } catch (tableError: any) {
      console.error('[Website Update] ⚠️ Error creating site_config table:', tableError.message);
      // Continue anyway - table might already exist
    }
    
    // Clean and normalize URL
    let url = siteUrl.trim();
    url = url.replace(/^https?:\/\//, ''); // Remove protocol
    url = url.replace(/\/$/, ''); // Remove trailing slash
    
    const baseDomain = extractBaseDomain(url);
    
    // Helper to sanitize URLs (truncate base64 data URLs)
    const sanitizeUrl = (url: string | undefined): string => {
      if (!url) return 'N/A';
      // If it's a base64 data URL, truncate it
      if (url.startsWith('data:image/')) {
        return url.substring(0, 50) + '... (base64 data, truncated)';
      }
      // If it's a very long URL, truncate it
      if (url.length > 100) {
        return url.substring(0, 100) + '... (truncated)';
      }
      return url;
    };
    
    console.log(`[Website Update] 📤 Updating PostgreSQL config:`);
    console.log(`   Original URL: ${url}`);
    console.log(`   Site URL (normalized): ${baseDomain}`);
    console.log(`   Token: ${tokenConfig.tokenName || 'N/A'} (${tokenConfig.tokenSymbol || 'N/A'})`);
    console.log(`   Contract: ${tokenConfig.tokenAddress || 'N/A'}`);
    console.log(`   Logo URL: ${sanitizeUrl(tokenConfig.logoUrl)}`);
    console.log(`   Token Image URL: ${sanitizeUrl(tokenConfig.tokenImageUrl)}`);
    
    // Build database update object (snake_case for database)
    const dbConfig: Record<string, any> = {
      site_url: baseDomain,
    };
    
    // Map all fields to database columns - EXACTLY like Nodematrix does
    if (tokenConfig.tokenName !== undefined) dbConfig.token_name = tokenConfig.tokenName || null;
    if (tokenConfig.tokenSymbol !== undefined) dbConfig.token_symbol = tokenConfig.tokenSymbol || null;
    if (tokenConfig.tokenAddress !== undefined) {
      // Treat 'Not set' or empty strings as null
      const tokenAddr = tokenConfig.tokenAddress && tokenConfig.tokenAddress !== 'Not set' && tokenConfig.tokenAddress.trim() !== '' 
        ? tokenConfig.tokenAddress.trim() 
        : null;
      dbConfig.token_address = tokenAddr;
      dbConfig.contract_address = tokenAddr;
    }
    if (tokenConfig.website !== undefined) dbConfig.website = tokenConfig.website || null;
    if (tokenConfig.telegram !== undefined) dbConfig.telegram = tokenConfig.telegram || null;
    if (tokenConfig.twitter !== undefined) dbConfig.twitter = tokenConfig.twitter || null;
    if (tokenConfig.description !== undefined) dbConfig.description = tokenConfig.description || null;
    // CRITICAL: Always update logo_url if provided (including null to clear it) - EXACTLY like Nodematrix
    if (tokenConfig.logoUrl !== undefined) {
      dbConfig.logo_url = tokenConfig.logoUrl || null;
      // Also save to website_logo_image for razebot compatibility (if column exists)
      // Don't fail if column doesn't exist - just log warning
      try {
        dbConfig.website_logo_image = tokenConfig.logoUrl || null;
      } catch (e) {
        // Column might not exist yet - that's OK, we'll add it
      }
    }
    if (tokenConfig.tokenImageUrl !== undefined) dbConfig.token_image_url = tokenConfig.tokenImageUrl || null;
    if (tokenConfig.chain !== undefined) dbConfig.chain = tokenConfig.chain || null;
    
    // Handle theme/colorScheme - prioritize theme, then themeName, then colorScheme
    // Theme1, Theme2, Theme3 are structured themes (not just colors)
    const themeValue = tokenConfig.theme || tokenConfig.themeName || tokenConfig.colorScheme;
    if (themeValue !== undefined && themeValue !== null) {
      const themeUpper = String(themeValue).toUpperCase().trim();
      
      // Check if it's a structured theme (Theme1, Theme2, Theme3)
      if (themeUpper === 'THEME1' || themeUpper === 'THEME2' || themeUpper === 'THEME3') {
        // Structured themes - save as template and theme_name (uppercase)
        dbConfig.template = themeUpper.toLowerCase(); // template: 'theme1', 'theme2', 'theme3'
        dbConfig.theme_name = themeUpper; // theme_name: 'THEME1', 'THEME2', 'THEME3'
        dbConfig.color_scheme = null; // Don't set color_scheme for structured themes
        console.log(`[Website Update] Setting structured theme: ${themeUpper} (template: ${themeUpper.toLowerCase()})`);
      } else {
        // Color-based themes - normalize to lowercase for CSS file names (blue.css, green.css, etc.)
        const normalizedTheme = String(themeValue).toLowerCase().trim();
        dbConfig.color_scheme = normalizedTheme;
        dbConfig.theme_name = normalizedTheme; // Always set theme_name for razebot (normalized to lowercase)
        dbConfig.template = 'original'; // Use original template for color themes
        console.log(`[Website Update] Setting color theme: ${normalizedTheme} (from: ${themeValue})`);
      }
    } else if (tokenConfig.colorScheme !== undefined) {
      // Legacy support for colorScheme only
      const normalizedTheme = tokenConfig.colorScheme ? String(tokenConfig.colorScheme).toLowerCase().trim() : null;
      dbConfig.color_scheme = normalizedTheme;
      dbConfig.theme_name = normalizedTheme;
      dbConfig.template = 'original';
    }
    
    if (tokenConfig.darkMode !== undefined) dbConfig.dark_mode = tokenConfig.darkMode || null;
    
    // Ensure template is set (default to 'original' if not a structured theme)
    if (!dbConfig.template) {
      dbConfig.template = 'original';
    }
    
    // Build UPSERT query - EXACTLY like Nodematrix
    const columns = Object.keys(dbConfig);
    const values = Object.values(dbConfig);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const updateSet = columns
      .filter(col => col !== 'site_url') // Don't update site_url in SET clause
      .map((col) => `"${col}" = EXCLUDED."${col}"`) // Quote column names for safety
      .join(', ');
    
    // Try to include website_logo_image and theme_name, but don't fail if they don't exist
    // Filter out columns that might not exist in the database
    const safeColumns = columns.filter(col => {
      // Always include standard columns
      if (!['website_logo_image', 'theme_name'].includes(col)) {
        return true;
      }
      // For razebot-specific columns, we'll try to include them but catch errors
      return true; // Include them - let the database error if column doesn't exist
    });
    
    const safePlaceholders = safeColumns.map((_, i) => `$${i + 1}`).join(', ');
    const safeUpdateSet = safeColumns
      .filter(col => col !== 'site_url')
      .map((col) => `"${col}" = EXCLUDED."${col}"`)
      .join(', ');
    
    const query = `
      INSERT INTO site_config (${safeColumns.map(c => `"${c}"`).join(', ')})
      VALUES (${safePlaceholders})
      ON CONFLICT (site_url) 
      DO UPDATE SET 
        ${safeUpdateSet},
        updated_at = NOW()
      RETURNING site_url, token_name, token_symbol, logo_url, contract_address, token_address, theme_name, color_scheme, website_logo_image, template;
    `;
    
    // Execute query - catch column errors and retry without optional columns
    let result;
    try {
      result = await client.query(query, values);
    } catch (queryError: any) {
      // If error is about missing columns, remove them and retry
      if (queryError.message?.includes('website_logo_image') || queryError.message?.includes('theme_name')) {
        console.warn('[Website Update] Optional columns missing, retrying without them...');
        const standardColumns = columns.filter(c => !['website_logo_image', 'theme_name'].includes(c));
        const standardValues = standardColumns.map(col => dbConfig[col]);
        const standardPlaceholders = standardColumns.map((_, i) => `$${i + 1}`).join(', ');
        const standardUpdateSet = standardColumns
          .filter(col => col !== 'site_url')
          .map((col) => `"${col}" = EXCLUDED."${col}"`)
          .join(', ');
        
        const fallbackQuery = `
          INSERT INTO site_config (${standardColumns.map(c => `"${c}"`).join(', ')})
          VALUES (${standardPlaceholders})
          ON CONFLICT (site_url) 
          DO UPDATE SET 
            ${standardUpdateSet},
            updated_at = NOW()
          RETURNING site_url, token_name, token_symbol, logo_url, contract_address, token_address, theme_name, color_scheme, template;
        `;
        
        result = await client.query(fallbackQuery, standardValues);
      } else {
        throw queryError;
      }
    }
    
    if (result.rows.length > 0) {
      const updated = result.rows[0];
      console.log(`[Website Update] ✅ Config updated successfully:`);
      console.log(`   Site URL: ${updated.site_url}`);
      console.log(`   Token: ${updated.token_name} (${updated.token_symbol})`);
      console.log(`   Contract Address: ${updated.contract_address || updated.token_address || 'NULL'}`);
      console.log(`   Logo URL: ${sanitizeUrl(updated.logo_url)}`);
      console.log(`   Website Logo Image: ${sanitizeUrl(updated.website_logo_image)}`);
      console.log(`   Theme: ${updated.theme_name || updated.color_scheme || 'NULL'}`);
      console.log(`   Template: ${updated.template || 'original'}`);
      
      // CRITICAL: Verify the update was actually saved by querying it back
      try {
        const verifyResult = await client.query(
          `SELECT * FROM site_config WHERE site_url = $1`,
          [baseDomain]
        );
        if (verifyResult.rows.length > 0) {
          const verified = verifyResult.rows[0];
          console.log(`[Website Update] ✅ VERIFICATION: Config confirmed in database`);
          console.log(`   Verified Site URL: ${verified.site_url}`);
          console.log(`   Verified Token: ${verified.token_name} (${verified.token_symbol})`);
          console.log(`   Verified Contract: ${verified.contract_address || verified.token_address || 'NULL'}`);
        } else {
          console.error(`[Website Update] ❌ VERIFICATION FAILED: Config not found after update!`);
          console.error(`   Searched for site_url: ${baseDomain}`);
        }
      } catch (verifyError: any) {
        console.error(`[Website Update] ⚠️  Could not verify update:`, verifyError.message);
      }
      
      console.log(`[Website Update] 💡 To verify manually, query: SELECT * FROM site_config WHERE site_url = '${updated.site_url}'`);
      
      return {
        success: true,
        site_url: updated.site_url,
      };
    } else {
      throw new Error('Database update returned no rows');
    }
  } catch (error: any) {
    console.error('[Website Update] ❌ Error:', error.message);
    console.error('[Website Update] ❌ Error stack:', error.stack);
    console.error('[Website Update] ❌ Error code:', error.code);
    
    // Log more details for connection errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      console.error('[Website Update] ❌ Database connection error - check DATABASE_URL');
      console.error('[Website Update] ❌ DATABASE_URL host:', databaseUrl.match(/@([^:]+)/)?.[1] || 'unknown');
    }
    
    return {
      success: false,
      error: error.message,
    };
  } finally {
    if (client) {
      try {
        await client.end();
        console.log('[Website Update] ✅ Database connection closed');
      } catch (closeError: any) {
        console.warn('[Website Update] ⚠️  Error closing connection:', closeError.message);
      }
    }
  }
}

