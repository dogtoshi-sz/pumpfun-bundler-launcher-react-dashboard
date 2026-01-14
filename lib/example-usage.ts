/**
 * Example Usage of Multi-User Config System
 * 
 * This file demonstrates how to use the user config system.
 * DO NOT import this file in production - it's for reference only.
 */

import {
  setUserContext,
  getUserConfig,
  saveUserConfig,
  saveUserConfigs,
  clearUserContext,
  getCurrentUserWallet,
  hasUserContext,
} from './user-config-context';

import {
  getUserConfigFromDB,
  saveUserConfigToDB,
  migrateEnvToUserConfig,
  userConfigExists,
} from './user-config-service';

/**
 * Example 1: Basic usage - setting context and reading config
 */
export async function example1_BasicUsage() {
  const walletPublicKey = 'YourWalletPublicKeyHere...';

  // Set user context (loads config from DB)
  await setUserContext(walletPublicKey);

  // Now all getUserConfig() calls use this user's config
  const tokenName = getUserConfig('TOKEN_NAME');
  const privateKey = getUserConfig('PRIVATE_KEY');
  const swapAmount = getUserConfig('SWAP_AMOUNT');

  console.log('User config:', { tokenName, privateKey, swapAmount });

  // Clear context when done
  clearUserContext();
}

/**
 * Example 2: Saving user config
 */
export async function example2_SaveConfig() {
  const walletPublicKey = 'YourWalletPublicKeyHere...';

  // Set context
  await setUserContext(walletPublicKey);

  // Save a single value
  await saveUserConfig('TOKEN_NAME', 'My Awesome Token');
  await saveUserConfig('TOKEN_SYMBOL', 'MAT');

  // Save multiple values at once
  await saveUserConfigs({
    SWAP_AMOUNT: '1.5',
    BUNDLE_WALLET_COUNT: '6',
    AUTO_RAPID_SELL: 'true',
  });

  // Verify it was saved
  const tokenName = getUserConfig('TOKEN_NAME');
  console.log('Saved token name:', tokenName); // Should be 'My Awesome Token'
}

/**
 * Example 3: Direct database access (bypassing cache)
 */
export async function example3_DirectDBAccess() {
  const walletPublicKey = 'YourWalletPublicKeyHere...';

  // Check if config exists
  const exists = await userConfigExists(walletPublicKey);
  console.log('Config exists:', exists);

  // Get config directly from DB (bypasses cache)
  const config = await getUserConfigFromDB(walletPublicKey);
  console.log('Config from DB:', config);

  // Save directly to DB (bypasses cache)
  await saveUserConfigToDB(walletPublicKey, {
    TOKEN_NAME: 'Direct Save Token',
  });
}

/**
 * Example 4: Migrating existing .env file to user config
 */
export async function example4_MigrateEnv() {
  const walletPublicKey = 'YourWalletPublicKeyHere...';

  // Migrate .env file to this user's config
  await migrateEnvToUserConfig(walletPublicKey, '.env');
  console.log('Migration complete!');
}

/**
 * Example 5: API endpoint pattern (for Express/API server)
 */
export async function example5_APIEndpointPattern(walletPublicKey: string) {
  try {
    // Set user context based on connected wallet
    await setUserContext(walletPublicKey);

    // Now all config reads in this request will use this user's config
    const tokenName = getUserConfig('TOKEN_NAME');
    const privateKey = getUserConfig('PRIVATE_KEY');

    // Do your business logic here...
    // All config reads will automatically use the user's config

    // Clear context when request is done
    clearUserContext();
  } catch (error) {
    // Always clear context on error
    clearUserContext();
    throw error;
  }
}

/**
 * Example 6: Checking if user has config vs using defaults
 */
export async function example6_CheckConfigExists() {
  const walletPublicKey = 'YourWalletPublicKeyHere...';

  const exists = await userConfigExists(walletPublicKey);

  if (exists) {
    // User has custom config - use it
    await setUserContext(walletPublicKey);
    const tokenName = getUserConfig('TOKEN_NAME');
    console.log('Using user config:', tokenName);
  } else {
    // User doesn't have config - use default .env
    console.log('Using default .env config');
    // Don't set context - getUserConfig() will fallback to process.env
  }
}

/**
 * Example 7: Updating config from API request
 */
export async function example7_UpdateFromAPI(
  walletPublicKey: string,
  updates: Record<string, string>
) {
  // Set context
  await setUserContext(walletPublicKey);

  // Save updates
  await saveUserConfigs(updates);

  // Verify updates
  for (const key in updates) {
    const value = getUserConfig(key);
    console.log(`${key} = ${value}`);
  }
}

/**
 * Example 8: Fallback behavior (backward compatibility)
 */
export function example8_FallbackBehavior() {
  // If no context is set, getUserConfig() falls back to process.env
  // This maintains backward compatibility with existing code

  // No context set
  const value1 = getUserConfig('TOKEN_NAME'); // Uses process.env

  // Context set
  // await setUserContext('Wallet...');
  // const value2 = getUserConfig('TOKEN_NAME'); // Uses DB config

  // If DB config doesn't have the key, falls back to process.env
  // This ensures existing code continues to work
}
