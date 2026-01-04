// Fetch trending pump.fun tokens from multiple APIs with fallbacks
// Priority: 1) pump.fun API, 2) DexScreener, 3) Birdeye

export interface TrendingToken {
  mint: string
  symbol: string
  name: string
  priceUsd: number
  volume24h: number
  liquidity: number
}

export async function fetchTrendingPumpFunTokens(limit: number = 20): Promise<TrendingToken[]> {
  console.log(`[Trending Tokens] Fetching top ${limit} trending pump.fun tokens...`)
  
  // Method 1: Use DexScreener API - REAL documented API at https://docs.dexscreener.com/
  try {
    console.log(`[Trending Tokens] Fetching from DexScreener API (REAL API)...`)
    
    // DexScreener API: Get pairs by chain (Solana)
    // Docs: https://docs.dexscreener.com/
    const response = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana`, {
      headers: { 'Accept': 'application/json' }
    })
    
    if (!response.ok) {
      throw new Error(`DexScreener API error: ${response.status}`)
    }
    
    const data = await response.json()
    const pairs = data.pairs || []
    console.log(`[Trending Tokens] DexScreener returned ${pairs.length} Solana pairs`)
    
    // Filter for pump.fun pairs - check dexId
    const pumpFunPairs = pairs.filter((pair: any) => {
      // DexScreener marks pump.fun pairs with dexId === 'pump.fun'
      return pair.dexId === 'pump.fun' || 
             pair.dexId === 'pumpfun' ||
             (pair.url && pair.url.includes('pump.fun'))
    })
    
    console.log(`[Trending Tokens] Found ${pumpFunPairs.length} pump.fun pairs`)
    
    if (pumpFunPairs.length > 0) {
      // Sort by volume and get top tokens
      const sortedPairs = pumpFunPairs
        .filter((p: any) => p.baseToken?.address && parseFloat(p.volume?.h24 || '0') > 0)
        .sort((a: any, b: any) => {
          const volA = parseFloat(a.volume?.h24 || '0')
          const volB = parseFloat(b.volume?.h24 || '0')
          return volB - volA
        })
        .slice(0, limit)
      
      const tokens: TrendingToken[] = sortedPairs.map((pair: any) => ({
        mint: pair.baseToken.address,
        symbol: pair.baseToken.symbol || 'UNKNOWN',
        name: pair.baseToken.name || pair.baseToken.symbol || 'Unknown Token',
        priceUsd: parseFloat(pair.priceUsd || '0'),
        volume24h: parseFloat(pair.volume?.h24 || '0'),
        liquidity: parseFloat(pair.liquidity?.usd || '0')
      }))
      
      if (tokens.length > 0) {
        console.log(`[Trending Tokens] ✅ Successfully fetched ${tokens.length} tokens from DexScreener`)
        return tokens
      }
    }
  } catch (dexscreenerError: any) {
    console.warn(`[Trending Tokens] DexScreener API failed: ${dexscreenerError.message}`)
  }
  
  // Method 3: Try Birdeye API if available
  const birdeyeApiKey = process.env.BIRDEYE_API_KEY
  if (birdeyeApiKey) {
    try {
      console.log(`[Trending Tokens] Trying Birdeye API...`)
      const birdeyeResponse = await fetch(
        `https://public-api.birdeye.so/defi/tokenlist?sort_by=v24hUSD&sort_type=desc&offset=0&limit=${limit * 2}`,
        {
          headers: {
            'X-API-KEY': birdeyeApiKey,
            'Accept': 'application/json'
          }
        }
      )
      
      if (birdeyeResponse.ok) {
        const birdeyeData = await birdeyeResponse.json()
        const tokens = birdeyeData.data?.tokens || []
        console.log(`[Trending Tokens] Birdeye returned ${tokens.length} tokens`)
        
        // Filter for Solana tokens (long addresses)
        const solanaTokens = tokens
          .filter((token: any) => token.address && token.address.length > 30)
          .slice(0, limit)
          .map((token: any) => ({
            mint: token.address,
            symbol: token.symbol || 'UNKNOWN',
            name: token.name || token.symbol || 'Unknown Token',
            priceUsd: parseFloat(token.price || '0'),
            volume24h: parseFloat(token.v24hUSD || '0'),
            liquidity: parseFloat(token.liquidity || '0')
          }))
        
        if (solanaTokens.length > 0) {
          console.log(`[Trending Tokens] ✅ Successfully fetched ${solanaTokens.length} tokens from Birdeye`)
          return solanaTokens
        }
      }
    } catch (birdeyeError: any) {
      console.warn(`[Trending Tokens] Birdeye API error: ${birdeyeError.message}`)
    }
  }
  
  // All methods failed
  console.warn(`[Trending Tokens] ❌ All API methods failed, returning empty array`)
  return []
}

// Cache tokens for a short period to avoid rate limits
let cachedTokens: TrendingToken[] = []
let cacheTimestamp = 0
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

export async function getCachedTrendingTokens(limit: number = 20): Promise<TrendingToken[]> {
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
