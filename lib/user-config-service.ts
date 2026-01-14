/**
 * User Config Service
 * 
 * Handles database operations for user configurations.
 * Stores environment variables per wallet public key in PostgreSQL.
 */

import { Pool } from 'pg';

let pool: Pool | null = null;

/**
 * Initialize database connection pool
 */
function getPool(): Pool {
  if (!pool) {
    const databaseUrl = process.env.DATABASE_URL || process.env.RAILWAY_DATABASE_URL;
    
    if (!databaseUrl) {
      throw new Error(
        'DATABASE_URL not configured. Please set DATABASE_URL in your .env file with your PostgreSQL connection string.'
      );
    }

    pool = new Pool({
      connectionString: databaseUrl,
      // Connection pool settings
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
      connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
    });

    // Handle pool errors
    pool.on('error', (err) => {
      console.error('[UserConfigService] Unexpected error on idle client', err);
    });
  }

  return pool;
}

/**
 * Get user configuration from database
 * Returns null if user doesn't exist
 */
export async function getUserConfigFromDB(walletPublicKey: string): Promise<Record<string, any> | null> {
  const db = getPool();
  
  try {
    const result = await db.query(
      'SELECT config FROM user_configs WHERE wallet_public_key = $1',
      [walletPublicKey]
    );

    if (result.rows.length === 0) {
      return null; // User doesn't exist yet
    }

    return result.rows[0].config || {};
  } catch (error) {
    console.error(`[UserConfigService] Error fetching config for wallet ${walletPublicKey}:`, error);
    throw error;
  }
}

/**
 * Save user configuration to database
 * Merges with existing config (partial update)
 */
export async function saveUserConfigToDB(
  walletPublicKey: string,
  config: Record<string, any>
): Promise<void> {
  const db = getPool();

  try {
    // Get existing config
    const existing = await getUserConfigFromDB(walletPublicKey);
    const mergedConfig = { ...existing, ...config };

    // Upsert (insert or update)
    await db.query(
      `INSERT INTO user_configs (wallet_public_key, config, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (wallet_public_key)
       DO UPDATE SET config = $2, updated_at = NOW()`,
      [walletPublicKey, JSON.stringify(mergedConfig)]
    );
  } catch (error) {
    console.error(`[UserConfigService] Error saving config for wallet ${walletPublicKey}:`, error);
    throw error;
  }
}

/**
 * Replace entire user configuration (not merged)
 */
export async function replaceUserConfigToDB(
  walletPublicKey: string,
  config: Record<string, any>
): Promise<void> {
  const db = getPool();

  try {
    await db.query(
      `INSERT INTO user_configs (wallet_public_key, config, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (wallet_public_key)
       DO UPDATE SET config = $2, updated_at = NOW()`,
      [walletPublicKey, JSON.stringify(config)]
    );
  } catch (error) {
    console.error(`[UserConfigService] Error replacing config for wallet ${walletPublicKey}:`, error);
    throw error;
  }
}

/**
 * Delete user configuration
 */
export async function deleteUserConfigFromDB(walletPublicKey: string): Promise<void> {
  const db = getPool();

  try {
    await db.query(
      'DELETE FROM user_configs WHERE wallet_public_key = $1',
      [walletPublicKey]
    );
  } catch (error) {
    console.error(`[UserConfigService] Error deleting config for wallet ${walletPublicKey}:`, error);
    throw error;
  }
}

/**
 * Get all user configs (for admin/debugging purposes)
 */
export async function getAllUserConfigs(): Promise<Array<{ wallet_public_key: string; config: Record<string, any>; updated_at: Date }>> {
  const db = getPool();

  try {
    const result = await db.query(
      'SELECT wallet_public_key, config, updated_at FROM user_configs ORDER BY updated_at DESC'
    );

    return result.rows.map(row => ({
      wallet_public_key: row.wallet_public_key,
      config: row.config || {},
      updated_at: row.updated_at,
    }));
  } catch (error) {
    console.error('[UserConfigService] Error fetching all configs:', error);
    throw error;
  }
}

/**
 * Check if user config exists
 */
export async function userConfigExists(walletPublicKey: string): Promise<boolean> {
  const db = getPool();

  try {
    const result = await db.query(
      'SELECT 1 FROM user_configs WHERE wallet_public_key = $1 LIMIT 1',
      [walletPublicKey]
    );

    return result.rows.length > 0;
  } catch (error) {
    console.error(`[UserConfigService] Error checking config existence for wallet ${walletPublicKey}:`, error);
    throw error;
  }
}

/**
 * Migrate .env file to user config (one-time migration helper)
 * Useful for migrating existing single-user setup to multi-user
 */
export async function migrateEnvToUserConfig(
  walletPublicKey: string,
  envFilePath: string = '.env'
): Promise<void> {
  const fs = require('fs');
  const path = require('path');

  // Read .env file
  const fullPath = path.join(process.cwd(), envFilePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`.env file not found at ${fullPath}`);
  }

  const content = fs.readFileSync(fullPath, 'utf8');
  const config: Record<string, string> = {};

  // Parse .env file
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();

      // Remove quotes if present
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      config[key] = value;
    }
  }

  // Save to database
  await replaceUserConfigToDB(walletPublicKey, config);
  console.log(`[UserConfigService] Migrated ${Object.keys(config).length} config values to user config for wallet ${walletPublicKey}`);
}

/**
 * Close database connection pool (for cleanup)
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
