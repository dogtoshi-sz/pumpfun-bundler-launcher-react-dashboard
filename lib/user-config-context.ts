/**
 * User Config Context
 * 
 * Provides a context-aware way to access environment variables that can be
 * scoped to a specific user's wallet. Falls back to process.env for backward compatibility.
 * 
 * Usage:
 *   import { setUserContext, getUserConfig } from './lib/user-config-context';
 *   
 *   // Set user context before accessing config
 *   await setUserContext('WalletPublicKey...');
 *   
 *   // Now all getUserConfig() calls will use this user's config
 *   const privateKey = getUserConfig('PRIVATE_KEY');
 */

import { getUserConfigFromDB, saveUserConfigToDB } from './user-config-service';

// Current user context
let currentUserWallet: string | null = null;
let userConfigCache: Record<string, any> | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

/**
 * Set the current user context (wallet public key)
 * This loads the user's config from the database and caches it
 */
export async function setUserContext(walletPublicKey: string | null): Promise<void> {
  if (!walletPublicKey) {
    // Clear context - fallback to .env
    currentUserWallet = null;
    userConfigCache = null;
    cacheTimestamp = 0;
    return;
  }

  // Check if cache is still valid
  const now = Date.now();
  if (currentUserWallet === walletPublicKey && userConfigCache && (now - cacheTimestamp) < CACHE_TTL_MS) {
    // Cache is valid, no need to reload
    return;
  }

  // Load config from database
  try {
    const config = await getUserConfigFromDB(walletPublicKey);
    currentUserWallet = walletPublicKey;
    userConfigCache = config || {};
    cacheTimestamp = now;
  } catch (error) {
    console.warn(`[UserConfig] Failed to load config for wallet ${walletPublicKey}:`, error);
    // Fallback to empty config (will use process.env)
    currentUserWallet = walletPublicKey;
    userConfigCache = {};
    cacheTimestamp = now;
  }
}

/**
 * Get a config value for the current user context
 * Falls back to process.env if no user context is set or value not found
 */
export function getUserConfig(key: string): string {
  // If user context is set and cache exists, check user config first
  if (currentUserWallet && userConfigCache && key in userConfigCache) {
    const value = userConfigCache[key];
    // Return empty string if null/undefined, otherwise stringify
    return value != null ? String(value) : '';
  }

  // Fallback to process.env (backward compatibility)
  return process.env[key] || '';
}

/**
 * Get all config values for the current user context
 * Returns merged user config + process.env (user config takes precedence)
 */
export function getAllUserConfig(): Record<string, string> {
  const result: Record<string, string> = { ...process.env };

  // Override with user config if available
  if (currentUserWallet && userConfigCache) {
    for (const key in userConfigCache) {
      const value = userConfigCache[key];
      result[key] = value != null ? String(value) : '';
    }
  }

  return result;
}

/**
 * Save a config value for the current user context
 * Updates both cache and database
 */
export async function saveUserConfig(key: string, value: string): Promise<void> {
  if (!currentUserWallet) {
    throw new Error('Cannot save config: No user context set. Call setUserContext() first.');
  }

  // Update cache
  if (!userConfigCache) {
    userConfigCache = {};
  }
  userConfigCache[key] = value;

  // Save to database
  try {
    await saveUserConfigToDB(currentUserWallet, { [key]: value });
    cacheTimestamp = Date.now(); // Reset cache timestamp
  } catch (error) {
    console.error(`[UserConfig] Failed to save config for wallet ${currentUserWallet}:`, error);
    throw error;
  }
}

/**
 * Save multiple config values at once
 */
export async function saveUserConfigs(config: Record<string, string>): Promise<void> {
  if (!currentUserWallet) {
    throw new Error('Cannot save config: No user context set. Call setUserContext() first.');
  }

  // Update cache
  if (!userConfigCache) {
    userConfigCache = {};
  }
  Object.assign(userConfigCache, config);

  // Save to database
  try {
    await saveUserConfigToDB(currentUserWallet, config);
    cacheTimestamp = Date.now(); // Reset cache timestamp
  } catch (error) {
    console.error(`[UserConfig] Failed to save configs for wallet ${currentUserWallet}:`, error);
    throw error;
  }
}

/**
 * Clear the current user context (useful for cleanup)
 */
export function clearUserContext(): void {
  currentUserWallet = null;
  userConfigCache = null;
  cacheTimestamp = 0;
}

/**
 * Get the current user wallet public key (if context is set)
 */
export function getCurrentUserWallet(): string | null {
  return currentUserWallet;
}

/**
 * Check if user context is currently set
 */
export function hasUserContext(): boolean {
  return currentUserWallet !== null;
}
