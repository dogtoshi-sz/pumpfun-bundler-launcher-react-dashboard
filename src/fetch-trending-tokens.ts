// Fetch pump.fun tokens from Moralis API
// Gets: NEW pairs, BONDING pairs, and GRADUATED pairs
// Docs: https://docs.moralis.com/web3-data-api/solana/tutorials/get-bonding-pump-fun-tokens

export interface TrendingToken {
  mint: string
  symbol: string
  name: string
  priceUsd: number
  volume24h: number
  liquidity: number
  type?: 'new' | 'bonding' | 'graduated' // Track which type of pair
}

const MORALIS_API_KEY = process.env.MORALIS_API_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6Ijc1OGIwYWZhLWNjMTgtNDU4ZS1iYmZkLTcyNTcxNWMwMzY5NyIsIm9yZ0lkIjoiNDUwNDgwIiwidXNlcklkIjoiNDYzNTAyIiwidHlwZUlkIjoiNTg5NzRiN2UtM2Q2Yy00NjQwLThjNmUtNjRiNDdhZjgzOGFjIiwidHlwZSI6IlBST0pFQ1QiLCJpYXQiOjE3NTg4NDMxNTIsImV4cCI6NDkxNDYwMzE1Mn0.To2pj_xVknxF-XlFHIlrTdlf8Ipqi-MHbeuRZwBXYuQ'

// Fetch tokens from a specific Moralis endpoint
async function fetchMoralisTokens(endpoint: string, type: 'new' | 'bonding' | 'graduated', limit: number): Promise<TrendingToken[]> {
  try {
    const response = await fetch(`https://solana-gateway.moralis.io/token/mainnet/exchange/pumpfun/${endpoint}?limit=${limit}`, {
      headers: {
        'Accept': 'application/json',
        'X-API-Key': MORALIS_API_KEY
      }
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Moralis API error (${endpoint}): ${response.status} - ${errorText}`)
    }
    
    const data = await response.json()
    let tokens = Array.isArray(data) ? data : (data.result || data.tokens || data.data || [])
    
    if (!tokens || tokens.length === 0) {
      return []
    }
    
    return tokens.map((token: any) => ({
      mint: token.tokenAddress || token.mint || token.mintAddress || token.address || '',
      symbol: token.symbol || 'UNKNOWN',
      name: token.name || token.symbol || 'Unknown Token',
      priceUsd: parseFloat(token.priceUsd || token.price || token.priceNative || '0') || 0,
      volume24h: parseFloat(token.volume24h || token.volume || '0') || 0,
      liquidity: parseFloat(token.liquidity || '0') || 0,
      type: type
    })).filter((t: TrendingToken) => t.mint && t.mint.length > 0)
  } catch (error: any) {
    console.warn(`[Trending Tokens] Failed to fetch ${type} tokens: ${error.message}`)
    return []
  }
}

export async function fetchTrendingPumpFunTokens(limit: number = 100): Promise<TrendingToken[]> {
  console.log(`[Trending Tokens] Fetching ALL pump.fun tokens (new, bonding, graduated)...`)
  
  // Fetch ALL types - Jupiter CAN trade pump.fun tokens via their bonding curve integration
  // The key is filtering for tokens with VOLUME (not dead/rugged)
  const [newTokens, bondingTokens, graduatedTokens] = await Promise.all([
    fetchMoralisTokens('new', 'new', 100),
    fetchMoralisTokens('bonding', 'bonding', 200),
    fetchMoralisTokens('graduated', 'graduated', 200)
  ])
  
  console.log(`[Trending Tokens] Fetched: ${newTokens.length} NEW, ${bondingTokens.length} BONDING, ${graduatedTokens.length} GRADUATED`)
  
  // Combine all tokens - prioritize graduated (guaranteed liquidity), then bonding, then new
  const allTokens = [...graduatedTokens, ...bondingTokens, ...newTokens]
  
  // Remove duplicates by mint address
  const uniqueTokens = new Map<string, TrendingToken>()
  for (const token of allTokens) {
    if (token.mint && !uniqueTokens.has(token.mint)) {
      uniqueTokens.set(token.mint, token)
    }
  }
  
  const deduplicated = Array.from(uniqueTokens.values())
  console.log(`[Trending Tokens] After deduplication: ${deduplicated.length} unique tokens`)
  
  // CRITICAL: Filter for tokens with ACTUAL VOLUME - dead tokens have $0 volume
  // This is the key difference - your token works because it has activity, dead tokens don't
  const MIN_VOLUME_24H = 100 // At least $100 volume in 24h = someone is trading it
  const MIN_LIQUIDITY = 50   // At least $50 liquidity = not completely rugged
  
  const tradableTokens = deduplicated.filter(t => {
    // Must have some volume OR liquidity to be tradable
    const hasVolume = t.volume24h >= MIN_VOLUME_24H
    const hasLiquidity = t.liquidity >= MIN_LIQUIDITY
    return hasVolume || hasLiquidity
  })
  
  console.log(`[Trending Tokens] After volume/liquidity filter: ${tradableTokens.length} tradable tokens (min $${MIN_VOLUME_24H} vol or $${MIN_LIQUIDITY} liq)`)
  
  // If we filtered too aggressively, fall back to all tokens but sort by volume
  let tokensToUse = tradableTokens.length >= 20 ? tradableTokens : deduplicated
  
  // Sort by volume (highest first) so we try active tokens first
  tokensToUse.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
  
  // Take top by volume, then shuffle for variety
  const topByVolume = tokensToUse.slice(0, Math.min(200, tokensToUse.length))
  
  // Shuffle array for variety
  const shuffleArray = (arr: TrendingToken[]) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }
  
  const result = shuffleArray(topByVolume).slice(0, limit)
  
  if (result.length > 0) {
    const avgVolume = result.reduce((sum, t) => sum + (t.volume24h || 0), 0) / result.length
    console.log(`[Trending Tokens] ✅ Returning ${result.length} tokens (avg 24h vol: $${avgVolume.toFixed(0)})`)
  } else {
    console.warn(`[Trending Tokens] ❌ No tokens fetched from any endpoint`)
  }
  
  return result
}

// Cache tokens for a short period to avoid rate limits
let cachedTokens: TrendingToken[] = []
let cacheTimestamp = 0
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

export async function getCachedTrendingTokens(limit: number = 100): Promise<TrendingToken[]> {
  const now = Date.now()
  
  if (cachedTokens.length > 0 && (now - cacheTimestamp) < CACHE_DURATION) {
    console.log(`[Trending Tokens] Using cached tokens (${cachedTokens.length} tokens)`)
    return cachedTokens.slice(0, limit)
  }
  
  const tokens = await fetchTrendingPumpFunTokens(limit)
  cachedTokens = tokens
  cacheTimestamp = now
  
  return tokens
}
