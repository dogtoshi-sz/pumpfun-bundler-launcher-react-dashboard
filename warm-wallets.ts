import { Connection, Keypair, PublicKey } from "@solana/web3.js"
import base58 from "bs58"
import fs from "fs"
import path from "path"
import { buyTokenSimple, sellTokenSimple } from "./trading-terminal"
import { RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT } from "./constants"
import { sleep } from "./utils"
import { getCachedTrendingTokens, TrendingToken } from "./src/fetch-trending-tokens"

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: "confirmed"
})

// Configuration
interface WarmConfig {
  walletsPerBatch: number // How many wallets to warm in parallel
  tradesPerWallet: number // Total trades per wallet
  minBuyAmount: number // Minimum SOL to spend per trade (SUPER TINY - e.g., 0.001)
  maxBuyAmount: number // Maximum SOL to spend per trade (SUPER TINY - e.g., 0.005)
  minIntervalSeconds: number // Minimum wait between trades (e.g., 30)
  maxIntervalSeconds: number // Maximum wait between trades (e.g., 300 = 5 minutes)
  priorityFee: 'low' | 'medium' | 'high' // Priority fee level (always 'low' for cheapest)
  useJupiter: boolean // Use Jupiter swap (works with any token, no referrer needed)
  useTrendingTokens: boolean // Use trending tokens from API instead of static list
}

const DEFAULT_CONFIG: WarmConfig = {
  walletsPerBatch: 2, // Process 2 wallets at a time to avoid rate limits
  tradesPerWallet: 10, // 10 trades per wallet
  minBuyAmount: 0.001, // 0.001 SOL minimum (SUPER TINY - ~$0.15)
  maxBuyAmount: 0.005, // 0.005 SOL maximum (SUPER TINY - ~$0.75)
  minIntervalSeconds: 30, // 30 seconds minimum between trades
  maxIntervalSeconds: 300, // 5 minutes maximum between trades
  priorityFee: 'low', // ALWAYS use low priority fee (cheapest possible)
  useJupiter: true, // Use Jupiter (works with any token)
  useTrendingTokens: true // Use trending tokens from API
}

// Get trending tokens - uses Moralis API (NEW, BONDING, GRADUATED), otherwise falls back to file
async function getTrendingTokens(useAPI: boolean, limit: number = 100): Promise<string[]> {
  if (useAPI) {
    try {
      // Get tokens from Moralis (NEW, BONDING, GRADUATED - randomly mixed)
      const tokens = await getCachedTrendingTokens(limit) // Get more tokens for variety
      if (tokens.length > 0) {
        console.log(`   ✅ Fetched ${tokens.length} tokens from Moralis (NEW/BONDING/GRADUATED)`)
        return tokens.map(t => t.mint)
      }
    } catch (error) {
      console.warn('Failed to fetch trending tokens from Moralis API, falling back to file:', error)
    }
  }
  
  // Fallback to file-based tokens
  return getTokensFromList()
}

// Alternative: Get tokens from a file or environment variable
function getTokensFromList(): string[] {
  const tokensFile = path.join(process.cwd(), 'keys', 'warmup-tokens.json')
  
  if (fs.existsSync(tokensFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(tokensFile, 'utf8'))
      return data.tokens || []
    } catch (error) {
      console.error('Error reading tokens file:', error)
    }
  }
  
  // Return empty array if no file exists
  return []
}

// Track warming progress per wallet
interface WarmingProgress {
  walletAddress: string
  totalTrades: number
  completedTrades: number
  successfulTrades: number
  failedTrades: number
  currentToken?: string
  status: 'idle' | 'warming' | 'completed' | 'error'
  lastUpdate: number
  errors: string[]
}

// Global progress tracker
const warmingProgress = new Map<string, WarmingProgress>()

export function getWarmingProgress(walletAddress?: string): WarmingProgress[] | WarmingProgress | null {
  if (walletAddress) {
    return warmingProgress.get(walletAddress) || null
  }
  return Array.from(warmingProgress.values())
}

// Warm a single wallet by doing random trades
async function warmWallet(
  walletPrivateKey: string,
  config: WarmConfig,
  tokenList: string[],
  onProgress?: (progress: WarmingProgress) => void
): Promise<{ success: number; failed: number; errors: string[] }> {
  const walletKp = Keypair.fromSecretKey(base58.decode(walletPrivateKey))
  const address = walletKp.publicKey.toBase58()
  
  // Initialize progress tracking
  const progress: WarmingProgress = {
    walletAddress: address,
    totalTrades: config.tradesPerWallet,
    completedTrades: 0,
    successfulTrades: 0,
    failedTrades: 0,
    status: 'warming',
    lastUpdate: Date.now(),
    errors: []
  }
  warmingProgress.set(address, progress)
  
  console.log(`\n🔥 Warming wallet: ${address.substring(0, 8)}...${address.substring(address.length - 8)}`)
  
  let successCount = 0
  let failedCount = 0
  const errors: string[] = []
  
  // Check wallet balance first
  const balance = await connection.getBalance(walletKp.publicKey)
  const balanceSol = balance / 1e9
  
  // Estimate required SOL: (maxBuyAmount * 2) * tradesPerWallet + buffer for fees
  const estimatedRequired = (config.maxBuyAmount * 2) * config.tradesPerWallet + 0.1
  if (balanceSol < estimatedRequired) {
    const error = `Insufficient balance: ${balanceSol.toFixed(4)} SOL. Need at least ${estimatedRequired.toFixed(4)} SOL`
    console.log(`   ⚠️  ${error}`)
    errors.push(error)
    return { success: 0, failed: 0, errors }
  }
  
  console.log(`   💰 Balance: ${balanceSol.toFixed(4)} SOL (estimated need: ${estimatedRequired.toFixed(4)} SOL)`)
  console.log(`   📊 Target: ${config.tradesPerWallet} trades`)
  
  for (let i = 0; i < config.tradesPerWallet; i++) {
    // Pick a random token
    if (tokenList.length === 0) {
      console.log(`   ⚠️  No tokens available. Please add tokens to keys/warmup-tokens.json`)
      break
    }
    
    const randomToken = tokenList[Math.floor(Math.random() * tokenList.length)]
    
    // Random buy amount
    const buyAmount = config.minBuyAmount + 
      Math.random() * (config.maxBuyAmount - config.minBuyAmount)
    
    try {
      console.log(`   [${i + 1}/${config.tradesPerWallet}] Buying ${buyAmount.toFixed(4)} SOL of token ${randomToken.substring(0, 8)}...`)
      
      // Buy tokens
      const buyResult = await buyTokenSimple(
        walletPrivateKey,
        randomToken,
        buyAmount,
        undefined, // No referrer needed when using Jupiter
        config.useJupiter,
        config.priorityFee
      )
      
      console.log(`   ✅ Buy successful: ${buyResult.txUrl}`)
      
      // Wait a bit before selling (random 5-30 seconds)
      const sellDelay = 5 + Math.random() * 25
      console.log(`   ⏳ Waiting ${sellDelay.toFixed(1)}s before selling...`)
      await sleep(sellDelay * 1000)
      
      // Sell 100% of tokens (or a random percentage between 80-100%)
      const sellPercentage = 80 + Math.random() * 20
      console.log(`   💸 Selling ${sellPercentage.toFixed(1)}% of tokens...`)
      
      const sellResult = await sellTokenSimple(
        walletPrivateKey,
        randomToken,
        sellPercentage,
        config.priorityFee
      )
      
      console.log(`   ✅ Sell successful: ${sellResult.txUrl}`)
      successCount++
      
      // Update progress
      progress.completedTrades = i + 1
      progress.successfulTrades = successCount
      progress.status = i + 1 < config.tradesPerWallet ? 'warming' : 'completed'
      progress.lastUpdate = Date.now()
      if (onProgress) onProgress(progress)
      
      // Random interval before next trade (except for last trade)
      if (i < config.tradesPerWallet - 1) {
        const interval = config.minIntervalSeconds + 
          Math.random() * (config.maxIntervalSeconds - config.minIntervalSeconds)
        console.log(`   ⏸️  Waiting ${interval.toFixed(1)}s before next trade...`)
        await sleep(interval * 1000)
      }
      
    } catch (error: any) {
      failedCount++
      const errorMsg = `Trade ${i + 1} failed: ${error.message}`
      console.log(`   ❌ ${errorMsg}`)
      errors.push(errorMsg)
      
      // Update progress
      progress.completedTrades = i + 1
      progress.failedTrades = failedCount
      progress.errors.push(errorMsg)
      progress.lastUpdate = Date.now()
      if (onProgress) onProgress(progress)
      
      // Wait a bit before retrying (shorter wait on error)
      if (i < config.tradesPerWallet - 1) {
        await sleep(10000) // 10 seconds on error
      }
    }
  }
  
  // Finalize progress
  progress.status = 'completed'
  progress.lastUpdate = Date.now()
  if (onProgress) onProgress(progress)
  
  console.log(`   📊 Completed: ${successCount} successful, ${failedCount} failed`)
  return { success: successCount, failed: failedCount, errors }
}

// Main warming function
async function warmWallets(
  walletPrivateKeys: string[],
  tokenList: string[],
  config: WarmConfig = DEFAULT_CONFIG,
  onProgress?: (walletAddress: string, progress: WarmingProgress) => void
) {
  // Fetch trending tokens if enabled
  if (config.useTrendingTokens) {
    console.log('📡 Fetching trending pump.fun tokens from Moralis API (NEW, BONDING, GRADUATED)...')
    // Fetch MORE tokens for better variety per wallet
    // Calculate: at least 10 tokens per wallet, but minimum 100 for good variety
    const minTokensNeeded = Math.max(100, walletPrivateKeys.length * 10)
    const trendingTokens = await getTrendingTokens(true, minTokensNeeded)
    if (trendingTokens.length > 0) {
      tokenList = trendingTokens
      console.log(`✅ Successfully fetched ${trendingTokens.length} trending tokens from Moralis API`)
      console.log(`   This gives ${(trendingTokens.length / walletPrivateKeys.length).toFixed(1)} tokens per wallet for variety`)
      console.log(`   Sample tokens: ${trendingTokens.slice(0, 5).map(t => t.substring(0, 8) + '...').join(', ')}`)
    } else {
      console.log('⚠️  No trending tokens found from API, falling back to file-based tokens')
      const fileTokens = getTokensFromList()
      if (fileTokens.length > 0) {
        tokenList = fileTokens
        console.log(`   Using ${fileTokens.length} tokens from warmup-tokens.json`)
      } else {
        console.log('   ❌ No tokens available from file either!')
      }
    }
  } else {
    console.log('📄 Using tokens from warmup-tokens.json file (trending tokens disabled)')
    tokenList = getTokensFromList()
  }
  
  if (tokenList.length === 0) {
    console.log('❌ No tokens available. Please add tokens to keys/warmup-tokens.json or enable trending tokens')
    return
  }
  
  if (walletPrivateKeys.length === 0) {
    console.log('❌ No wallets provided')
    return
  }
  
  console.log(`\n🔥🔥🔥 WALLET WARMING STARTED 🔥🔥🔥`)
  console.log(`📊 Configuration:`)
  console.log(`   Wallets: ${walletPrivateKeys.length}`)
  console.log(`   Trades per wallet: ${config.tradesPerWallet}`)
  console.log(`   Buy amount: ${config.minBuyAmount}-${config.maxBuyAmount} SOL`)
  console.log(`   Interval: ${config.minIntervalSeconds}-${config.maxIntervalSeconds}s`)
  console.log(`   Priority fee: ${config.priorityFee}`)
  console.log(`   Tokens available: ${tokenList.length}`)
  console.log(`   Parallel wallets: ${config.walletsPerBatch}`)
  
  const results: Array<{
    address: string
    success: number
    failed: number
    errors: string[]
  }> = []
  
  // Process wallets in batches to avoid rate limits
  for (let i = 0; i < walletPrivateKeys.length; i += config.walletsPerBatch) {
    const batch = walletPrivateKeys.slice(i, i + config.walletsPerBatch)
    console.log(`\n📦 Processing batch ${Math.floor(i / config.walletsPerBatch) + 1}/${Math.ceil(walletPrivateKeys.length / config.walletsPerBatch)}`)
    
    // Process batch in parallel
    const batchPromises = batch.map(async (privateKey) => {
      const walletKp = Keypair.fromSecretKey(base58.decode(privateKey))
      const address = walletKp.publicKey.toBase58()
      const result = await warmWallet(
        privateKey, 
        config, 
        tokenList,
        (progress) => {
          if (onProgress) onProgress(address, progress)
        }
      )
      return {
        address,
        ...result
      }
    })
    
    const batchResults = await Promise.all(batchPromises)
    results.push(...batchResults)
    
    // Wait between batches to avoid rate limits
    if (i + config.walletsPerBatch < walletPrivateKeys.length) {
      console.log(`\n⏸️  Waiting 10s before next batch...`)
      await sleep(10000)
    }
  }
  
  // Print summary
  console.log(`\n${'='.repeat(80)}`)
  console.log(`📊 WARMING SUMMARY`)
  console.log(`${'='.repeat(80)}`)
  
  let totalSuccess = 0
  let totalFailed = 0
  
  results.forEach((result, index) => {
    console.log(`\n[${index + 1}] ${result.address.substring(0, 8)}...${result.address.substring(result.address.length - 8)}`)
    console.log(`   ✅ Success: ${result.success}`)
    console.log(`   ❌ Failed: ${result.failed}`)
    if (result.errors.length > 0) {
      console.log(`   ⚠️  Errors:`)
      result.errors.slice(0, 3).forEach(err => console.log(`      - ${err}`))
      if (result.errors.length > 3) {
        console.log(`      ... and ${result.errors.length - 3} more`)
      }
    }
    totalSuccess += result.success
    totalFailed += result.failed
  })
  
  console.log(`\n${'='.repeat(80)}`)
  console.log(`TOTAL: ${totalSuccess} successful, ${totalFailed} failed`)
  console.log(`${'='.repeat(80)}\n`)
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2)
  
  // Load wallets from data.json or provide via command line
  const dataJsonPath = path.join(process.cwd(), 'keys', 'data.json')
  let walletPrivateKeys: string[] = []
  
  if (args.length > 0 && args[0] === '--wallets') {
    // Wallets provided as comma-separated list
    walletPrivateKeys = args[1].split(',').map(w => w.trim())
  } else if (fs.existsSync(dataJsonPath)) {
    // Load from data.json
    try {
      const data = JSON.parse(fs.readFileSync(dataJsonPath, 'utf8'))
      walletPrivateKeys = Array.isArray(data) ? data : []
    } catch (error) {
      console.error('Error reading data.json:', error)
    }
  }
  
  // Load tokens
  const tokenList = getTokensFromList()
  
  // Parse config from environment variables or use defaults
  const config: WarmConfig = {
    walletsPerBatch: parseInt(process.env.WARM_WALLETS_PER_BATCH || '3'),
    tradesPerWallet: parseInt(process.env.WARM_TRADES_PER_WALLET || '10'),
    minBuyAmount: parseFloat(process.env.WARM_MIN_BUY || '0.01'),
    maxBuyAmount: parseFloat(process.env.WARM_MAX_BUY || '0.05'),
    minIntervalSeconds: parseInt(process.env.WARM_MIN_INTERVAL || '30'),
    maxIntervalSeconds: parseInt(process.env.WARM_MAX_INTERVAL || '300'),
    priorityFee: (process.env.WARM_PRIORITY_FEE as 'low' | 'medium' | 'high') || 'low',
    useJupiter: process.env.WARM_USE_JUPITER !== 'false'
  }
  
  warmWallets(walletPrivateKeys, tokenList, config)
    .then(() => {
      console.log('✅ Warming completed')
      process.exit(0)
    })
    .catch((error) => {
      console.error('❌ Warming failed:', error)
      process.exit(1)
    })
}

export { warmWallets, warmWallet, getTokensFromList, WarmConfig, WarmingProgress, getWarmingProgress }

