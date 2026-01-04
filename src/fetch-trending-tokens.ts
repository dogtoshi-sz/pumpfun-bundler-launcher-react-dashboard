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
  
  // Method 1: Try pump.fun recently bonded/trending API (most accurate)
  try {
    console.log(`[Trending Tokens] Trying pump.fun trending API...`)
    const pumpFunResponse = await fetch(`https://frontend-api.pump.fun/coins/trending`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      }
    })
    
    if (pumpFunResponse.ok) {
      const pumpFunData = await pumpFunResponse.json()
      console.log(`[Trending Tokens] pump.fun API returned ${Array.isArray(pumpFunData) ? pumpFunData.length : 'non-array'} data`)
      
      if (pumpFunData && Array.isArray(pumpFunData) && pumpFunData.length > 0) {
        const tokens: TrendingToken[] = pumpFunData.slice(0, limit).map((token: any) => ({
          mint: token.mint || token.address || '',
          symbol: token.symbol || 'UNKNOWN',
          name: token.name || token.symbol || 'Unknown Token',
          priceUsd: parseFloat(token.usd_market_cap ? (token.usd_market_cap / (token.supply || 1)) : token.price || '0') || 0,
          volume24h: parseFloat(token.volume_24h || token.volume24h || '0') || 0,
          liquidity: parseFloat(token.liquidity || '0') || 0
        })).filter((t: TrendingToken) => t.mint && t.mint.length > 0)
        
        if (tokens.length > 0) {
          console.log(`[Trending Tokens] ✅ Successfully fetched ${tokens.length} tokens from pump.fun API`)
          return tokens
        }
      }
    }
  } catch (pumpFunError: any) {
    console.warn(`[Trending Tokens] pump.fun API failed: ${pumpFunError.message}`)
  }
  
  // Method 2: Use DexScreener API - search for Solana tokens and filter for pump.fun
  try {
    console.log(`[Trending Tokens] Trying DexScreener API...`)
    
    // Try multiple DexScreener endpoints
    let pairs: any[] = []
    
    // Endpoint 1: Search for pump.fun
    try {
      const searchResponse = await fetch(`https://api.dexscreener.com/latest/dex/search?q=pump.fun`, {
        headers: { 'Accept': 'application/json' }
      })
      if (searchResponse.ok) {
        const searchData = await searchResponse.json()
        pairs = searchData.pairs || []
        console.log(`[Trending Tokens] DexScreener search returned ${pairs.length} pairs`)
      }
    } catch (e) {
      console.warn(`[Trending Tokens] DexScreener search failed: ${e}`)
    }
    
    // Endpoint 2: Get latest tokens (if search didn't work)
    if (pairs.length === 0) {
      try {
        const tokensResponse = await fetch(`https://api.dexscreener.com/latest/dex/tokens`, {
          headers: { 'Accept': 'application/json' }
        })
        if (tokensResponse.ok) {
          const tokensData = await tokensResponse.json()
          pairs = tokensData.pairs || []
          console.log(`[Trending Tokens] DexScreener tokens endpoint returned ${pairs.length} pairs`)
        }
      } catch (e) {
        console.warn(`[Trending Tokens] DexScreener tokens endpoint failed: ${e}`)
      }
    }
    
    // Filter for pump.fun pairs
    const pumpFunPairs = pairs.filter((pair: any) => {
      const isPumpFun = 
        pair.dexId === 'pump.fun' ||
        pair.dexId === 'pumpfun' ||
        pair.dexId?.toLowerCase().includes('pump') ||
        pair.url?.includes('pump.fun') ||
        pair.url?.includes('pumpfun') ||
        pair.pairAddress?.toLowerCase().includes('pump')
      return isPumpFun
    })
    
    console.log(`[Trending Tokens] Found ${pumpFunPairs.length} pump.fun pairs from DexScreener`)
    
    if (pumpFunPairs.length > 0) {
      const uniqueTokens = new Map<string, TrendingToken>()
      
      for (const pair of pumpFunPairs.slice(0, limit * 3)) {
        const baseToken = pair.baseToken
        if (baseToken?.address && !uniqueTokens.has(baseToken.address)) {
          uniqueTokens.set(baseToken.address, {
            mint: baseToken.address,
            symbol: baseToken.symbol || 'UNKNOWN',
            name: baseToken.name || baseToken.symbol || 'Unknown Token',
            priceUsd: parseFloat(pair.priceUsd || '0'),
            volume24h: parseFloat(pair.volume?.h24 || pair.volume24h || '0'),
            liquidity: parseFloat(pair.liquidity?.usd || pair.liquidity || '0')
          })
          
          if (uniqueTokens.size >= limit) break
        }
      }
      
      const tokensArray = Array.from(uniqueTokens.values())
        .filter(t => t.mint && t.mint.length > 0)
        .sort((a, b) => b.volume24h - a.volume24h)
        .slice(0, limit)
      
      if (tokensArray.length > 0) {
        console.log(`[Trending Tokens] ✅ Successfully fetched ${tokensArray.length} tokens from DexScreener`)
        return tokensArray
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
