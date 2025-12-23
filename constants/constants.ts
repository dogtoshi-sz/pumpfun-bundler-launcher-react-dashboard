import dotenv from 'dotenv';
// CRITICAL: Load .env BEFORE reading any process.env values
dotenv.config();

import { retrieveEnvVariable } from "../utils"
import { PublicKey } from "@solana/web3.js";

export const PRIVATE_KEY = retrieveEnvVariable('PRIVATE_KEY')
export const RPC_ENDPOINT = retrieveEnvVariable('RPC_ENDPOINT')
export const RPC_WEBSOCKET_ENDPOINT = retrieveEnvVariable('RPC_WEBSOCKET_ENDPOINT')

export const LIL_JIT_ENDPOINT = retrieveEnvVariable('LIL_JIT_ENDPOINT')
export const LIL_JIT_WEBSOCKET_ENDPOINT = retrieveEnvVariable('LIL_JIT_WEBSOCKET_ENDPOINT')

export const LIL_JIT_MODE = retrieveEnvVariable('LIL_JIT_MODE') == "true"

export const TOKEN_NAME = retrieveEnvVariable('TOKEN_NAME')
export const TOKEN_SYMBOL = retrieveEnvVariable('TOKEN_SYMBOL')
export const DESCRIPTION = retrieveEnvVariable('DESCRIPTION')
export const TOKEN_SHOW_NAME = retrieveEnvVariable('TOKEN_SHOW_NAME')
export const TOKEN_CREATE_ON = retrieveEnvVariable('TOKEN_CREATE_ON')
// Optional fields - allow empty strings (for social links)
export const TWITTER = process.env.TWITTER || ''
export const TELEGRAM = process.env.TELEGRAM || ''
export const WEBSITE = process.env.WEBSITE || ''
export const FILE = retrieveEnvVariable('FILE')
export const VANITY_MODE = retrieveEnvVariable('VANITY_MODE') == "true"

export const SWAP_AMOUNT = Number(retrieveEnvVariable('SWAP_AMOUNT'))
export const DISTRIBUTION_WALLETNUM = Number(retrieveEnvVariable('DISTRIBUTION_WALLETNUM'))

// Support for variable amounts per wallet (comma-separated, e.g., "0.1,0.2,0.15")
// If not set, uses SWAP_AMOUNT for all wallets
export const SWAP_AMOUNTS_STRING = process.env.SWAP_AMOUNTS || ''
export const SWAP_AMOUNTS = SWAP_AMOUNTS_STRING 
  ? SWAP_AMOUNTS_STRING.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n))
  : []

export const JITO_FEE = Number(retrieveEnvVariable('JITO_FEE'))
export const MINIMUM_JITO_TIP = Number(retrieveEnvVariable('MINIMUM_JITO_TIP'))
export const SIMULATE_ONLY = retrieveEnvVariable('SIMULATE_ONLY') == "true"

export const global_mint = new PublicKey("p89evAyzjd9fphjJx7G3RFA48sbZdpGEppRcfRNpump")
export const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

export const BUYER_WALLET = retrieveEnvVariable('BUYER_WALLET')
export const BUYER_AMOUNT = Number(retrieveEnvVariable('BUYER_AMOUNT'))
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

// Priority fees for Jupiter swaps (in lamports) - higher = faster confirmation
// HIGH priority: Used when WebSocket threshold is met (auto-sell) - must be fast!
// Default: 5,000,000 lamports (0.005 SOL) - reduces confirmation from ~4s to ~1s
// For extreme speed, can increase to 10,000,000 (0.01 SOL) or higher
export const PRIORITY_FEE_LAMPORTS_HIGH = Number(process.env.PRIORITY_FEE_LAMPORTS_HIGH || '5000000')

// LOW priority: Used for manual sells or when threshold isn't met - save money!
// Default: 100,000 lamports (0.0001 SOL) - cheap but slower confirmation (~4-5s)
export const PRIORITY_FEE_LAMPORTS_LOW = Number(process.env.PRIORITY_FEE_LAMPORTS_LOW || '100000')
