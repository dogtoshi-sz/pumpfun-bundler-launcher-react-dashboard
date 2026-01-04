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
  console.log(`[Trending Tokens] Fetching pump.fun tokens (NEW, BONDING, GRADUATED) - target: ${limit} tokens...`)
  
  // Fetch MORE tokens per type for better variety
  // Each type gets limit/3, but we'll fetch even more to ensure we have enough after filtering
  const tokensPerType = Math.ceil(limit / 3) * 2 // Fetch 2x to ensure we have enough after filtering
  
  // Fetch all three types in parallel
  const [newTokens, bondingTokens, graduatedTokens] = await Promise.all([
    fetchMoralisTokens('new', 'new', tokensPerType),
    fetchMoralisTokens('bonding', 'bonding', tokensPerType),
    fetchMoralisTokens('graduated', 'graduated', tokensPerType)
  ])
  
  console.log(`[Trending Tokens] Fetched: ${newTokens.length} NEW, ${bondingTokens.length} BONDING, ${graduatedTokens.length} GRADUATED`)
  
  // Combine all tokens and shuffle randomly
  const allTokens = [...newTokens, ...bondingTokens, ...graduatedTokens]
  
  // Remove duplicates by mint address
  const uniqueTokens = new Map<string, TrendingToken>()
  for (const token of allTokens) {
    if (token.mint && !uniqueTokens.has(token.mint)) {
      uniqueTokens.set(token.mint, token)
    }
  }
  
  const deduplicated = Array.from(uniqueTokens.values())
  console.log(`[Trending Tokens] After deduplication: ${deduplicated.length} unique tokens`)
  
  // Shuffle array randomly
  for (let i = deduplicated.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deduplicated[i], deduplicated[j]] = [deduplicated[j], deduplicated[i]]
  }
  
  // Return up to limit tokens (or all if we have less)
  const result = deduplicated.slice(0, limit)
  
  if (result.length > 0) {
    console.log(`[Trending Tokens] ✅ Returning ${result.length} tokens (randomly mixed from all types)`)
    const typeCounts = {
      new: result.filter(t => t.type === 'new').length,
      bonding: result.filter(t => t.type === 'bonding').length,
      graduated: result.filter(t => t.type === 'graduated').length
    }
    console.log(`[Trending Tokens] Breakdown: ${typeCounts.new} new, ${typeCounts.bonding} bonding, ${typeCounts.graduated} graduated`)
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
