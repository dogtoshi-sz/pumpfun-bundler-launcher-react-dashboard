/**
 * Type definitions for user config system
 */

/**
 * User configuration structure
 * Maps environment variable names to their string values
 */
export interface UserConfig {
  // Core wallet settings
  PRIVATE_KEY?: string;
  BUYER_WALLET?: string;
  
  // RPC settings
  RPC_ENDPOINT?: string;
  RPC_WEBSOCKET_ENDPOINT?: string;
  LIL_JIT_ENDPOINT?: string;
  LIL_JIT_WEBSOCKET_ENDPOINT?: string;
  
  // Token settings
  TOKEN_NAME?: string;
  TOKEN_SYMBOL?: string;
  DESCRIPTION?: string;
  TOKEN_SHOW_NAME?: string;
  TOKEN_CREATE_ON?: string;
  FILE?: string;
  
  // Social links
  TWITTER?: string;
  TELEGRAM?: string;
  WEBSITE?: string;
  
  // Trading settings
  SWAP_AMOUNT?: string;
  SWAP_AMOUNTS?: string;
  BUYER_AMOUNT?: string;
  JITO_FEE?: string;
  
  // Wallet distribution
  DISTRIBUTION_WALLETNUM?: string;
  BUNDLE_WALLET_COUNT?: string;
  BUNDLE_SWAP_AMOUNTS?: string;
  HOLDER_WALLET_COUNT?: string;
  HOLDER_SWAP_AMOUNTS?: string;
  HOLDER_WALLET_AMOUNT?: string;
  
  // Feature flags
  VANITY_MODE?: string;
  LIL_JIT_MODE?: string;
  USE_NORMAL_LAUNCH?: string;
  AUTO_RAPID_SELL?: string;
  AUTO_SELL_50_PERCENT?: string;
  AUTO_SELL_STAGED?: string;
  AUTO_GATHER?: string;
  AUTO_COLLECT_FEES?: string;
  WEBSOCKET_TRACKING_ENABLED?: string;
  WEBSOCKET_ULTRA_FAST_MODE?: string;
  AUTO_HOLDER_WALLET_BUY?: string;
  MARKET_CAP_TRACKING_ENABLED?: string;
  
  // Staged sell config
  STAGED_SELL_STAGE1_THRESHOLD?: string;
  STAGED_SELL_STAGE1_PERCENTAGE?: string;
  STAGED_SELL_STAGE2_THRESHOLD?: string;
  STAGED_SELL_STAGE2_PERCENTAGE?: string;
  STAGED_SELL_STAGE3_THRESHOLD?: string;
  STAGED_SELL_STAGE3_PERCENTAGE?: string;
  
  // WebSocket config
  WEBSOCKET_EXTERNAL_BUY_THRESHOLD?: string;
  WEBSOCKET_EXTERNAL_BUY_WINDOW?: string;
  
  // Priority fees
  PRIORITY_FEE_LAMPORTS_ULTRA?: string;
  PRIORITY_FEE_LAMPORTS_HIGH?: string;
  PRIORITY_FEE_LAMPORTS_MEDIUM?: string;
  PRIORITY_FEE_LAMPORTS_LOW?: string;
  PRIORITY_FEE_LAMPORTS_NONE?: string;
  HOLDER_WALLET_PRIORITY_FEE?: string;
  
  // Market cap tracking
  MARKET_CAP_SELL_THRESHOLD?: string;
  MARKET_CAP_CHECK_INTERVAL?: string;
  BIRDEYE_API_KEY?: string;
  
  // Mixing/intermediary settings
  USE_MIXING_WALLETS?: string;
  USE_MULTI_INTERMEDIARY_SYSTEM?: string;
  NUM_INTERMEDIARY_HOPS?: string;
  BUNDLE_INTERMEDIARY_HOPS?: string;
  HOLDER_INTERMEDIARY_HOPS?: string;
  USE_VARIABLE_GAS_FEES?: string;
  CREATE_FRESH_MIXING_WALLETS?: string;
  CREATE_FRESH_INTERMEDIARIES?: string;
  
  // Holder wallet delays
  HOLDER_WALLET_AUTO_BUY_DELAYS?: string;
  
  // Volume maker
  VOLUME_MAKER_ENABLED?: string;
  VOLUME_MAKER_DURATION_MINUTES?: string;
  VOLUME_MAKER_MIN_INTERVAL_SECONDS?: string;
  VOLUME_MAKER_MAX_INTERVAL_SECONDS?: string;
  VOLUME_MAKER_MIN_BUY_AMOUNT?: string;
  VOLUME_MAKER_MAX_BUY_AMOUNT?: string;
  VOLUME_MAKER_MIN_SELL_PERCENTAGE?: string;
  VOLUME_MAKER_MAX_SELL_PERCENTAGE?: string;
  VOLUME_MAKER_WALLET_COUNT?: string;
  
  // Other
  MINT_PRIVATE_KEY?: string;
  OPENAI_API_KEY?: string;
  DATA_DIR?: string;
  
  // Allow any other string keys for flexibility
  [key: string]: string | undefined;
}

/**
 * Database row structure for user_configs table
 */
export interface UserConfigRow {
  wallet_public_key: string;
  config: UserConfig;
  created_at: Date;
  updated_at: Date;
}
