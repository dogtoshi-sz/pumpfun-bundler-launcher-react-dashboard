// Fetch trending pump.fun tokens from DexScreener API
// DexScreener has a pump.fun filter that we can use

export interface TrendingToken {
  mint: string
  symbol: string
  name: string
  priceUsd: number
  volume24h: number
  liquidity: number
}

export async function fetchTrendingPumpFunTokens(limit: number = 20): Promise<TrendingToken[]> {
  try {
    console.log(`[Trending Tokens] Fetching top ${limit} trending pump.fun tokens...`)
    
    // DexScreener API endpoint for pump.fun tokens
    // We'll search for tokens on pump.fun by querying the pump.fun program
    // Alternative: Use Birdeye API if available
    
    // Method 1: Use DexScreener search (they have pump.fun pairs)
    const response = await fetch(`https://api.dexscreener.com/latest/dex/search?q=pump.fun`, {
      headers: {
        'Accept': 'application/json'
      }
    })
    
    if (!response.ok) {
      throw new Error(`DexScreener API error: ${response.status}`)
    }
    
    const data = await response.json()
    console.log(`[Trending Tokens] DexScreener returned ${data.pairs?.length || 0} pairs`)
    
    // Filter for pump.fun pairs and extract token info
    const pumpFunPairs = (data.pairs || []).filter((pair: any) => {
      // Check if it's a pump.fun pair
      return pair.dexId === 'pump.fun' || 
             pair.url?.includes('pump.fun') ||
             pair.pairAddress?.startsWith('pump')
    })
    
    console.log(`[Trending Tokens] Found ${pumpFunPairs.length} pump.fun pairs`)
    
      // Get unique tokens (by base token address)
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
      
      // Sort by volume and return top tokens
      const tokensArray = Array.from(uniqueTokens.values())
        .filter(t => t.mint && t.mint.length > 0) // Only valid mints
        .sort((a, b) => b.volume24h - a.volume24h)
        .slice(0, limit)
      
      if (tokensArray.length > 0) {
        console.log(`[Trending Tokens] Successfully fetched ${tokensArray.length} tokens from DexScreener`)
        return tokensArray
      }
    } catch (dexscreenerError: any) {
      console.warn(`[Trending Tokens] DexScreener API failed: ${dexscreenerError.message}`)
    }
    
    // Method 3: Try Birdeye API if available
    if (uniqueTokens.size < limit) {
      // Alternative: Fetch from Birdeye API if available
      const birdeyeApiKey = process.env.BIRDEYE_API_KEY
      if (birdeyeApiKey) {
        try {
          const birdeyeResponse = await fetch(
            `https://public-api.birdeye.so/defi/tokenlist?sort_by=v24hUSD&sort_type=desc&offset=0&limit=${limit}`,
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
            
            for (const token of tokens) {
              if (token.address && !uniqueTokens.has(token.address)) {
                // Check if it's a pump.fun token (you might need to filter by program ID)
                uniqueTokens.set(token.address, {
                  mint: token.address,
                  symbol: token.symbol || 'UNKNOWN',
                  name: token.name || token.symbol || 'Unknown Token',
                  priceUsd: parseFloat(token.price || '0'),
                  volume24h: parseFloat(token.v24hUSD || '0'),
                  liquidity: parseFloat(token.liquidity || '0')
                })
                
                if (uniqueTokens.size >= limit) break
              }
            }
          }
        } catch (birdeyeError) {
          console.warn('Birdeye API error:', birdeyeError)
        }
      }
    }
    
    // Sort by volume and return top tokens
    const tokensArray = Array.from(uniqueTokens.values())
      .filter(t => t.volume24h > 0) // Only tokens with volume
      .sort((a, b) => b.volume24h - a.volume24h)
      .slice(0, limit)
    
    console.log(`[Trending Tokens] Returning ${tokensArray.length} tokens (top by volume)`)
    if (tokensArray.length > 0) {
      console.log(`[Trending Tokens] Top token: ${tokensArray[0].symbol} (${tokensArray[0].mint.substring(0, 8)}...) - Volume: $${tokensArray[0].volume24h.toFixed(2)}`)
    }
    
    return tokensArray
    
  } catch (error: any) {
    console.error('[Trending Tokens] Error fetching trending tokens:', error.message)
    console.error('[Trending Tokens] Stack:', error.stack)
    
    // Fallback: Return empty array or use cached tokens
    return []
  }
}

// Cache tokens for a short period to avoid rate limits
let cachedTokens: TrendingToken[] = []
let cacheTimestamp = 0
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

export async function getCachedTrendingTokens(limit: number = 20): Promise<TrendingToken[]> {
  const now = Date.now()
  
  if (cachedTokens.length > 0 && (now - cacheTimestamp) < CACHE_DURATION) {
    return cachedTokens.slice(0, limit)
  }
  
  const tokens = await fetchTrendingPumpFunTokens(limit)
  cachedTokens = tokens
  cacheTimestamp = now
  
  return tokens
}

