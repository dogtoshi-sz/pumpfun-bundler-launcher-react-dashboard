import dotenv from 'dotenv';
// CRITICAL: Load .env ONLY if values not already in process.env (for consumer support)
// Users can pass config directly as env vars, terminal users use .env file
if (!process.env.PRIVATE_KEY && !process.env.TOKEN_NAME) {
  // Only load .env if no config passed directly (fallback for terminal users)
  dotenv.config();
}

import { retrieveEnvVariable } from "../utils"
import { PublicKey } from "@solana/web3.js";

// PRIVATE_KEY can come from process.env or .env file
// Made optional (required: false) to allow trading-terminal.ts to work without it
// It's only required when actually launching tokens, not for trading operations
export const PRIVATE_KEY = retrieveEnvVariable('PRIVATE_KEY', '', false)
export const RPC_ENDPOINT = retrieveEnvVariable('RPC_ENDPOINT', process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com', false)
export const RPC_WEBSOCKET_ENDPOINT = retrieveEnvVariable('RPC_WEBSOCKET_ENDPOINT', '', false)

export const LIL_JIT_ENDPOINT = retrieveEnvVariable('LIL_JIT_ENDPOINT', '', false)
export const LIL_JIT_WEBSOCKET_ENDPOINT = retrieveEnvVariable('LIL_JIT_WEBSOCKET_ENDPOINT', '', false)

export const LIL_JIT_MODE = (process.env.LIL_JIT_MODE || 'false').toLowerCase() === 'true'
export const USE_NORMAL_LAUNCH = (process.env.USE_NORMAL_LAUNCH || 'false').toLowerCase() === 'true'
export const USE_MIXING_WALLETS = (process.env.USE_MIXING_WALLETS || 'true').toLowerCase() === 'true' // Default to true for privacy
export const CREATE_FRESH_MIXING_WALLETS = (process.env.CREATE_FRESH_MIXING_WALLETS || 'true').toLowerCase() === 'true' // Default to true - create fresh mixers each launch for better privacy

// Multi-intermediary system (new, more private)
export const NUM_INTERMEDIARY_HOPS = Number(process.env.NUM_INTERMEDIARY_HOPS || '2') // Default: 2 intermediaries (global fallback)
export const USE_VARIABLE_GAS_FEES = (process.env.USE_VARIABLE_GAS_FEES || 'true').toLowerCase() === 'true' // Default: true - randomized gas fees
export const CREATE_FRESH_INTERMEDIARIES = (process.env.CREATE_FRESH_INTERMEDIARIES || 'true').toLowerCase() === 'true' // Default: true - create fresh intermediaries per launch
export const USE_MULTI_INTERMEDIARY_SYSTEM = (process.env.USE_MULTI_INTERMEDIARY_SYSTEM || 'false').toLowerCase() === 'true' // Default: false - opt-in for new system

// Per-wallet-type intermediary hop configuration
// If not set, falls back to NUM_INTERMEDIARY_HOPS
export const BUNDLE_INTERMEDIARY_HOPS = process.env.BUNDLE_INTERMEDIARY_HOPS 
  ? Number(process.env.BUNDLE_INTERMEDIARY_HOPS) 
  : NUM_INTERMEDIARY_HOPS
export const HOLDER_INTERMEDIARY_HOPS = process.env.HOLDER_INTERMEDIARY_HOPS 
  ? Number(process.env.HOLDER_INTERMEDIARY_HOPS) 
  : NUM_INTERMEDIARY_HOPS

export const TOKEN_NAME = retrieveEnvVariable('TOKEN_NAME', '', true)
export const TOKEN_SYMBOL = retrieveEnvVariable('TOKEN_SYMBOL', '', true)
export const DESCRIPTION = retrieveEnvVariable('DESCRIPTION', '', true)
export const TOKEN_SHOW_NAME = retrieveEnvVariable('TOKEN_SHOW_NAME', '', false)
export const TOKEN_CREATE_ON = retrieveEnvVariable('TOKEN_CREATE_ON', 'pumpfun', false)
// Optional fields - allow empty strings (for social links)
export const TWITTER = process.env.TWITTER || ''
export const TELEGRAM = process.env.TELEGRAM || ''
export const WEBSITE = process.env.WEBSITE || ''
export const FILE = retrieveEnvVariable('FILE', '', false)
export const VANITY_MODE = (process.env.VANITY_MODE || 'false').toLowerCase() === 'true'

export const SWAP_AMOUNT = Number(process.env.SWAP_AMOUNT || '0.3')
// DISTRIBUTION_WALLETNUM is now optional (legacy) - use BUNDLE_WALLET_COUNT + HOLDER_WALLET_COUNT instead
export const DISTRIBUTION_WALLETNUM = Number(process.env.DISTRIBUTION_WALLETNUM || '0')

// Bundle wallets: Wallets that go in Jito bundle (5-6 max to avoid bundle size limits)
export const BUNDLE_WALLET_COUNT = Number(process.env.BUNDLE_WALLET_COUNT || process.env.DISTRIBUTION_WALLETNUM || '6')
// Bundle wallet amounts (comma-separated, e.g., "0.4,0.5,0.7,1.0")
// If not set, falls back to first N values from SWAP_AMOUNTS or SWAP_AMOUNT
export const BUNDLE_SWAP_AMOUNTS_STRING = process.env.BUNDLE_SWAP_AMOUNTS || ''
export const BUNDLE_SWAP_AMOUNTS = BUNDLE_SWAP_AMOUNTS_STRING
  ? BUNDLE_SWAP_AMOUNTS_STRING.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n))
  : []

// Holder wallets: Additional wallets that buy separately (not in bundle) with tiny amounts to increase holder count
export const HOLDER_WALLET_COUNT = Number(process.env.HOLDER_WALLET_COUNT || '0')
// Holder wallet amounts (comma-separated, e.g., "0.01,0.01,0.02" or single value for all)
// If not set, uses HOLDER_WALLET_AMOUNT for all holder wallets
export const HOLDER_SWAP_AMOUNTS_STRING = process.env.HOLDER_SWAP_AMOUNTS || ''
export const HOLDER_SWAP_AMOUNTS = HOLDER_SWAP_AMOUNTS_STRING
  ? HOLDER_SWAP_AMOUNTS_STRING.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n))
  : []
// Fallback: Single amount for all holder wallets (if HOLDER_SWAP_AMOUNTS not set)
export const HOLDER_WALLET_AMOUNT = Number(process.env.HOLDER_WALLET_AMOUNT || '0.01')
// Priority fee for holder wallet buys (much lower than bundle wallets - they're just for holder count)
// Default: 1,000 microLamports (0.000001 SOL) - very cheap since speed isn't critical
export const HOLDER_WALLET_PRIORITY_FEE = Number(process.env.HOLDER_WALLET_PRIORITY_FEE || '1000')
// Auto-buy with holder wallets after launch (without bundling)
// If true, holder wallets will automatically buy tokens right after launch is confirmed
export const AUTO_HOLDER_WALLET_BUY = (process.env.AUTO_HOLDER_WALLET_BUY || 'false').toLowerCase() === 'true'
// Holder wallet auto-buy delay configuration
// Format: "parallel:count,delay:seconds,parallel:count,delay:seconds"
// Example: "parallel:3,delay:0.5,parallel:2,delay:1.0" means:
//   - First 3 wallets buy in parallel (no delay)
//   - Wait 0.5 seconds
//   - Next 2 wallets buy in parallel
//   - Wait 1.0 seconds
//   - Remaining wallets buy sequentially with default delay
// If not set, defaults to sequential buys with 1-2 second random delays
export const HOLDER_WALLET_AUTO_BUY_DELAYS = process.env.HOLDER_WALLET_AUTO_BUY_DELAYS || ''

// Front-run protection for holder auto-buy wallets
// If external net buys exceed this threshold (in SOL), skip the auto-buy
// This protects against MEV bots/snipers buying before your holder wallets
// Set to 0 to disable (always buy regardless of external volume)
// Example: 0.2 = skip buy if external buys > 0.2 SOL before your wallet can execute
export const AUTO_BUY_FRONT_RUN_THRESHOLD = Number(process.env.AUTO_BUY_FRONT_RUN_THRESHOLD || '0')

// Front-run protection: How long (seconds) to wait before checking volume
// This gives time for external buys to be detected on-chain
// Default: 0.5 seconds - fast enough to still snipe, but allows detection of front-runners
export const AUTO_BUY_FRONT_RUN_CHECK_DELAY = Number(process.env.AUTO_BUY_FRONT_RUN_CHECK_DELAY || '0.5')

// Support for variable amounts per wallet (comma-separated, e.g., "0.1,0.2,0.15")
// If not set, uses SWAP_AMOUNT for all wallets
export const SWAP_AMOUNTS_STRING = process.env.SWAP_AMOUNTS || ''
export const SWAP_AMOUNTS = SWAP_AMOUNTS_STRING 
  ? SWAP_AMOUNTS_STRING.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n))
  : []

export const JITO_FEE = Number(process.env.JITO_FEE || '0.001')
export const MINIMUM_JITO_TIP = Number(process.env.MINIMUM_JITO_TIP || '0.0001')
export const SIMULATE_ONLY = (process.env.SIMULATE_ONLY || 'false').toLowerCase() === 'true'

export const global_mint = new PublicKey("p89evAyzjd9fphjJx7G3RFA48sbZdpGEppRcfRNpump")
export const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

// BUYER_WALLET: Creator/DEV wallet
// If set in .env, uses that wallet (persistent across launches)
// If NOT set (empty), will auto-create a new wallet each launch (like bundle wallets)
export const BUYER_WALLET = process.env.BUYER_WALLET || ''
export const BUYER_AMOUNT = Number(process.env.BUYER_AMOUNT || '0.1')
export const AUTO_RAPID_SELL = (process.env.AUTO_RAPID_SELL || 'true').toLowerCase() === 'true' // Default to true if not set
export const AUTO_SELL_50_PERCENT = (process.env.AUTO_SELL_50_PERCENT || 'false').toLowerCase() === 'true' // Default to false if not set
export const AUTO_SELL_STAGED = (process.env.AUTO_SELL_STAGED || 'false').toLowerCase() === 'true' // Default to false if not set

// Staged sell configuration
export const STAGED_SELL_STAGE1_THRESHOLD = Number(process.env.STAGED_SELL_STAGE1_THRESHOLD || '5') // SOL volume for stage 1
export const STAGED_SELL_STAGE1_PERCENTAGE = Number(process.env.STAGED_SELL_STAGE1_PERCENTAGE || '30') // Percentage of wallets for stage 1
export const STAGED_SELL_STAGE2_THRESHOLD = Number(process.env.STAGED_SELL_STAGE2_THRESHOLD || '10') // SOL volume for stage 2
export const STAGED_SELL_STAGE2_PERCENTAGE = Number(process.env.STAGED_SELL_STAGE2_PERCENTAGE || '30') // Percentage of wallets for stage 2
export const STAGED_SELL_STAGE3_THRESHOLD = Number(process.env.STAGED_SELL_STAGE3_THRESHOLD || '20') // SOL volume for stage 3
export const STAGED_SELL_STAGE3_PERCENTAGE = Number(process.env.STAGED_SELL_STAGE3_PERCENTAGE || '40') // Percentage of wallets for stage 3 (remaining + DEV)
export const AUTO_GATHER = (process.env.AUTO_GATHER || 'false').toLowerCase() === 'true' // Default to false if not set
export const AUTO_COLLECT_FEES = (process.env.AUTO_COLLECT_FEES || 'false').toLowerCase() === 'true' // Default to false if not set

// Volume maker configuration
export const VOLUME_MAKER_ENABLED = (process.env.VOLUME_MAKER_ENABLED || 'false').toLowerCase() === 'true'
export const VOLUME_MAKER_DURATION_MINUTES = Number(process.env.VOLUME_MAKER_DURATION_MINUTES || '30')
export const VOLUME_MAKER_MIN_INTERVAL_SECONDS = Number(process.env.VOLUME_MAKER_MIN_INTERVAL_SECONDS || '10')
export const VOLUME_MAKER_MAX_INTERVAL_SECONDS = Number(process.env.VOLUME_MAKER_MAX_INTERVAL_SECONDS || '60')
export const VOLUME_MAKER_MIN_BUY_AMOUNT = Number(process.env.VOLUME_MAKER_MIN_BUY_AMOUNT || '0.01')
export const VOLUME_MAKER_MAX_BUY_AMOUNT = Number(process.env.VOLUME_MAKER_MAX_BUY_AMOUNT || '0.1')
export const VOLUME_MAKER_MIN_SELL_PERCENTAGE = Number(process.env.VOLUME_MAKER_MIN_SELL_PERCENTAGE || '10')
export const VOLUME_MAKER_MAX_SELL_PERCENTAGE = Number(process.env.VOLUME_MAKER_MAX_SELL_PERCENTAGE || '50')
export const VOLUME_MAKER_WALLET_COUNT = Number(process.env.VOLUME_MAKER_WALLET_COUNT || '5')

// WebSocket tracking configuration (for real-time buy/sell detection and auto-sell)
export const WEBSOCKET_TRACKING_ENABLED = (process.env.WEBSOCKET_TRACKING_ENABLED || 'false').toLowerCase() === 'true'
export const WEBSOCKET_EXTERNAL_BUY_THRESHOLD = Number(process.env.WEBSOCKET_EXTERNAL_BUY_THRESHOLD || '1.0') // SOL threshold
export const WEBSOCKET_EXTERNAL_BUY_WINDOW = Number(process.env.WEBSOCKET_EXTERNAL_BUY_WINDOW || '60') // seconds
// Ultra-fast WebSocket tracker (sub-500ms reaction time) - uses 'processed' commitment and pre-built transactions
export const WEBSOCKET_ULTRA_FAST_MODE = (process.env.WEBSOCKET_ULTRA_FAST_MODE || 'false').toLowerCase() === 'true'

// Market Cap Tracking - Auto-sell when market cap reaches threshold
export const MARKET_CAP_TRACKING_ENABLED = (process.env.MARKET_CAP_TRACKING_ENABLED || 'false').toLowerCase() === 'true'
export const MARKET_CAP_SELL_THRESHOLD = Number(process.env.MARKET_CAP_SELL_THRESHOLD || '100000') // USD market cap threshold
export const MARKET_CAP_CHECK_INTERVAL = Number(process.env.MARKET_CAP_CHECK_INTERVAL || '5') // seconds between checks
export const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || ''

// Priority fees for Jupiter swaps (in lamports) - higher = faster confirmation
// ULTRA priority: Maximum speed - for critical trades!
// Default: 10,000,000 lamports (0.01 SOL) - fastest possible confirmation (~500ms)
export const PRIORITY_FEE_LAMPORTS_ULTRA = Number(process.env.PRIORITY_FEE_LAMPORTS_ULTRA || '10000000')

// HIGH priority: Used when WebSocket threshold is met (auto-sell) - very fast but expensive!
// Default: 5,000,000 lamports (0.005 SOL) - reduces confirmation from ~4s to ~1s
export const PRIORITY_FEE_LAMPORTS_HIGH = Number(process.env.PRIORITY_FEE_LAMPORTS_HIGH || '5000000')

// MEDIUM priority: Used for rapid sells - fast and reasonable!
// Default: 500,000 lamports (0.0005 SOL) - good balance of speed and cost (~2-3s confirmation)
export const PRIORITY_FEE_LAMPORTS_MEDIUM = Number(process.env.PRIORITY_FEE_LAMPORTS_MEDIUM || '500000')

// LOW priority: Recommended default for regular trades - good balance!
// Default: 100,000 lamports (0.0001 SOL) - fast enough for GMGN indexing (~3-4s confirmation)
// This is the sweet spot: cheap but fast enough for most use cases
export const PRIORITY_FEE_LAMPORTS_LOW = Number(process.env.PRIORITY_FEE_LAMPORTS_LOW || '100000')

// MINIMAL priority: Very cheap trades that still look organic - for manual/holder trades
// Default: 5,000 lamports (0.000005 SOL) - very cheap but adds variance
export const PRIORITY_FEE_LAMPORTS_MINIMAL = Number(process.env.PRIORITY_FEE_LAMPORTS_MINIMAL || '5000')

// NONE priority: Absolute minimum - no priority fee (slowest but cheapest)
// Default: 0 lamports (0 SOL) - base transaction fee only (~5-10s confirmation)
export const PRIORITY_FEE_LAMPORTS_NONE = Number(process.env.PRIORITY_FEE_LAMPORTS_NONE || '0')
