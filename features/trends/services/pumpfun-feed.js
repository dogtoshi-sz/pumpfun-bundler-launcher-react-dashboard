/**
 * PumpFun Feed - Dedicated WebSocket connection for Trend Detector
 * Subscribes to ALL new token creations and trades on pump.fun
 * Uses Helius DAS API for proper token metadata including images
 */

const WebSocket = require('ws');
const axios = require('axios');

// Extract Helius API key from RPC endpoint
const RPC_ENDPOINT = process.env.RPC_ENDPOINT || '';
const HELIUS_API_KEY = RPC_ENDPOINT.match(/api-key=([a-f0-9-]+)/)?.[1] || '';
const HELIUS_RPC_URL = HELIUS_API_KEY 
  ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
  : null;

class PumpFunFeed {
  constructor(trendDetector) {
    this.trendDetector = trendDetector;
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 20;
    this.reconnectDelay = 3000;
    
    this.subscribedTokens = new Set();
    this.maxSubscriptions = 100;
    
    this.metadataCache = new Map();
    this.metadataCacheTTL = 5 * 60 * 1000;
    this.pendingFetches = new Set();
    
    // Stats for periodic logging
    this.stats = {
      tokensCreated: 0,
      tradesProcessed: 0,
      metadataFetched: 0,
    };
    
    console.log('[PumpFunFeed] Feed initialized');
    if (HELIUS_API_KEY) {
      console.log('[PumpFunFeed] ✅ Helius API key found');
    } else {
      console.log('[PumpFunFeed] ⚠️ No Helius API key - using pump.fun API');
    }
  }

  start() {
    console.log('[PumpFunFeed] 🚀 Starting feed...');
    this.connect();
    
    // Log stats every 30 seconds
    this.statsInterval = setInterval(() => {
      if (this.stats.tokensCreated > 0 || this.stats.tradesProcessed > 0) {
        console.log(`[PumpFunFeed] 📊 Stats: ${this.stats.tokensCreated} tokens, ${this.stats.tradesProcessed} trades, ${this.stats.metadataFetched} metadata`);
        this.stats = { tokensCreated: 0, tradesProcessed: 0, metadataFetched: 0 };
      }
    }, 30000);
  }

  stop() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }
    this.isConnected = false;
    this.subscribedTokens.clear();
    console.log('[PumpFunFeed] 🛑 Feed stopped');
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    console.log('[PumpFunFeed] 🔌 Connecting to PumpPortal...');
    
    this.ws = new WebSocket('wss://pumpportal.fun/api/data');

    this.ws.on('open', () => {
      console.log('[PumpFunFeed] ✅ Connected to PumpPortal');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.sendMessage({ method: 'subscribeNewToken' });
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        // Silent fail
      }
    });

    this.ws.on('error', (error) => {
      console.error('[PumpFunFeed] ❌ WebSocket error:', error.message);
    });

    this.ws.on('close', () => {
      this.isConnected = false;
      
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = Math.min(this.reconnectDelay * this.reconnectAttempts, 30000);
        console.log(`[PumpFunFeed] Reconnecting in ${delay / 1000}s...`);
        setTimeout(() => this.connect(), delay);
      }
    });
  }

  sendMessage(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(payload));
    return true;
  }

  async handleMessage(message) {
    if (message.message) return; // Skip status messages
    
    if (message.txType === 'create' || message.type === 'create') {
      await this.handleNewToken(message);
      return;
    }

    if (message.txType === 'buy' || message.txType === 'sell') {
      this.handleTrade(message);
      return;
    }
  }

  async handleNewToken(data) {
    const mint = data.mint;
    if (!mint) return;

    this.stats.tokensCreated++;

    // Log the full create event to see all available fields (for debugging)
    console.log('[PumpFunFeed] 🆕 Token created:', data.symbol || data.name, '| Fields:', Object.keys(data).join(', '));

    // Extract ALL possible metadata from the create event
    // PumpPortal may use different field names
    const tokenInfo = {
      mint,
      name: data.name || data.tokenName || data.symbol || '???',
      symbol: data.symbol || data.tokenSymbol || '???',
      // Image can come from multiple fields
      imageUrl: data.image_uri || data.imageUri || data.image || data.uri || null,
      // Description
      description: data.description || data.desc || null,
      // Social links - try multiple possible field names
      twitter: data.twitter || data.twitterLink || data.twitter_link || null,
      telegram: data.telegram || data.telegramLink || data.telegram_link || null,
      website: data.website || data.websiteLink || data.website_link || data.url || null,
      // Creator
      creator: data.traderPublicKey || data.creator || data.creatorPublicKey || null,
      launchedAt: data.timestamp || Date.now(),
      // Metadata URI for fetching full metadata
      metadataUri: data.uri || data.metadataUri || data.metadata_uri || null,
    };

    // If we have a metadataUri but no image, try to fetch immediately
    if (tokenInfo.metadataUri && !tokenInfo.imageUrl) {
      try {
        // The uri often points to IPFS or similar with full metadata
        const metaRes = await this.fetchMetadataFromUri(tokenInfo.metadataUri);
        if (metaRes) {
          if (!tokenInfo.imageUrl && metaRes.image) tokenInfo.imageUrl = metaRes.image;
          if (!tokenInfo.description && metaRes.description) tokenInfo.description = metaRes.description;
          if (!tokenInfo.twitter && metaRes.twitter) tokenInfo.twitter = metaRes.twitter;
          if (!tokenInfo.telegram && metaRes.telegram) tokenInfo.telegram = metaRes.telegram;
          if (!tokenInfo.website && metaRes.website) tokenInfo.website = metaRes.website;
        }
      } catch (e) {
        // Silent fail - will retry with async fetch
      }
    }

    if (this.trendDetector) {
      this.trendDetector.trackToken(tokenInfo);
    }

    this.subscribeToToken(mint);
    this.fetchMetadataAsync(mint);
  }

  // Fetch metadata from a URI (IPFS, Arweave, etc.)
  async fetchMetadataFromUri(uri) {
    if (!uri) return null;
    try {
      // Convert IPFS URIs to HTTP gateway
      let httpUri = uri;
      if (uri.startsWith('ipfs://')) {
        httpUri = uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
      }
      const res = await axios.get(httpUri, { timeout: 3000 });
      return res.data;
    } catch (e) {
      return null;
    }
  }

  handleTrade(trade) {
    if (!this.trendDetector) return;
    
    this.stats.tradesProcessed++;

    const formattedTrade = {
      mint: trade.mint,
      mintAddress: trade.mint,
      type: trade.txType,
      txType: trade.txType,
      solAmount: trade.solAmount || trade.sol_amount || trade.amount || 0,
      tokenAmount: trade.txType === 'buy' ? (trade.buy || trade.tokenAmount || 0) : (trade.sell || trade.tokenAmount || 0),
      trader: trade.traderPublicKey,
      traderPublicKey: trade.traderPublicKey,
      fullTrader: trade.traderPublicKey,
      timestamp: trade.timestamp || Date.now(),
      signature: trade.signature,
      marketCapSol: trade.marketCapSol,
      tokenName: trade.name,
      tokenSymbol: trade.symbol,
    };

    this.trendDetector.recordTrade(formattedTrade);
  }

  subscribeToToken(mint) {
    if (this.subscribedTokens.has(mint)) return;

    if (this.subscribedTokens.size >= this.maxSubscriptions) {
      const oldest = this.subscribedTokens.values().next().value;
      this.unsubscribeFromToken(oldest);
    }

    this.subscribedTokens.add(mint);
    this.sendMessage({ method: 'subscribeTokenTrade', keys: [mint] });
  }

  unsubscribeFromToken(mint) {
    if (!this.subscribedTokens.has(mint)) return;
    this.subscribedTokens.delete(mint);
    this.sendMessage({ method: 'unsubscribeTokenTrade', keys: [mint] });
  }

  async fetchTokenMetadata(mint) {
    const cached = this.metadataCache.get(mint);
    if (cached && Date.now() - cached.fetchedAt < this.metadataCacheTTL) {
      return cached.data;
    }

    let metadata = null;

    // Try Helius DAS API first
    if (HELIUS_RPC_URL) {
      try {
        const response = await axios.post(HELIUS_RPC_URL, {
          jsonrpc: '2.0',
          id: `getAsset-${mint}`,
          method: 'getAsset',
          params: { id: mint },
        }, {
          timeout: 5000,
          headers: { 'Content-Type': 'application/json' },
        });

        if (response.data?.result) {
          const asset = response.data.result;
          const content = asset.content || {};
          const links = content.links || {};
          const files = content.files || [];
          const jsonUri = content.json_uri;
          
          // Try multiple sources for image
          let imageUri = links.image || content.metadata?.image;
          if (!imageUri && files.length > 0) {
            // Check files for image
            const imageFile = files.find(f => f.mime?.startsWith('image/') || f.uri?.match(/\.(png|jpg|jpeg|gif|webp)/i));
            imageUri = imageFile?.uri || imageFile?.cdn_uri || files[0]?.uri;
          }
          
          metadata = {
            name: content.metadata?.name || asset.token_info?.name,
            symbol: content.metadata?.symbol || asset.token_info?.symbol,
            description: content.metadata?.description,
            image_uri: imageUri,
            twitter: links.twitter || content.metadata?.twitter,
            telegram: links.telegram || content.metadata?.telegram,
            website: links.website || content.metadata?.website,
            json_uri: jsonUri,
          };

          // If no image but we have json_uri, fetch the metadata JSON
          if (!metadata.image_uri && jsonUri) {
            try {
              const jsonRes = await axios.get(jsonUri, { timeout: 3000 });
              if (jsonRes.data) {
                metadata.image_uri = jsonRes.data.image || jsonRes.data.imageUrl || jsonRes.data.image_uri;
                metadata.description = metadata.description || jsonRes.data.description;
                metadata.twitter = metadata.twitter || jsonRes.data.twitter;
                metadata.telegram = metadata.telegram || jsonRes.data.telegram;
                metadata.website = metadata.website || jsonRes.data.website;
              }
            } catch (e) {}
          }
        }
      } catch (error) {}
    }

    // Fallback: pump.fun API (most reliable for pump.fun tokens)
    if (!metadata || !metadata.image_uri || !metadata.twitter) {
      try {
        const response = await axios.get(`https://frontend-api.pump.fun/coins/${mint}`, {
          timeout: 5000,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });

        if (response.data) {
          const pumpData = response.data;
          metadata = metadata || {};
          // Pump.fun API is authoritative - use its data
          metadata.name = pumpData.name || metadata.name;
          metadata.symbol = pumpData.symbol || metadata.symbol;
          metadata.description = pumpData.description || metadata.description;
          metadata.image_uri = pumpData.image_uri || metadata.image_uri;
          // Social links - pump.fun stores them as full URLs or handles
          metadata.twitter = pumpData.twitter || metadata.twitter;
          metadata.telegram = pumpData.telegram || metadata.telegram;
          metadata.website = pumpData.website || metadata.website;
          // Additional pump.fun fields
          metadata.created_timestamp = pumpData.created_timestamp;
          metadata.market_cap = pumpData.market_cap;
          metadata.usd_market_cap = pumpData.usd_market_cap;
        }
      } catch (error) {
        // Silent fail - will retry
      }
    }

    if (metadata && (metadata.name || metadata.symbol || metadata.image_uri)) {
      this.metadataCache.set(mint, { data: metadata, fetchedAt: Date.now() });
      return metadata;
    }

    return null;
  }
  
  fetchMetadataAsync(mint, retryCount = 0) {
    const fetchKey = `${mint}-${retryCount}`;
    if (this.pendingFetches.has(fetchKey)) return;
    this.pendingFetches.add(fetchKey);
    
    // Progressive delays: 2s, 8s, 20s
    const delays = [2000, 8000, 20000];
    const delay = delays[Math.min(retryCount, delays.length - 1)];
    
    setTimeout(() => {
      this.fetchTokenMetadata(mint).then(metadata => {
        this.pendingFetches.delete(fetchKey);
        
        if (metadata && this.trendDetector) {
          this.stats.metadataFetched++;
          const tracked = this.trendDetector.trackedTokens?.get(mint);
          if (tracked) {
            let updated = false;
            
            if (metadata.name && metadata.name !== '???' && tracked.name !== metadata.name) {
              tracked.name = metadata.name;
              updated = true;
            }
            if (metadata.symbol && metadata.symbol !== '???' && tracked.symbol !== metadata.symbol) {
              tracked.symbol = metadata.symbol;
              updated = true;
            }
            if (metadata.image_uri && !tracked.imageUrl) {
              tracked.imageUrl = metadata.image_uri;
              updated = true;
            }
            if (metadata.twitter && !tracked.twitter) {
              tracked.twitter = metadata.twitter;
              updated = true;
            }
            if (metadata.telegram && !tracked.telegram) {
              tracked.telegram = metadata.telegram;
              updated = true;
            }
            if (metadata.website && !tracked.website) {
              tracked.website = metadata.website;
              updated = true;
            }
            if (metadata.description && !tracked.description) {
              tracked.description = metadata.description;
              updated = true;
            }
            
            // If metadata was updated and token is a candidate, trigger refresh
            if (updated && tracked.status === 'candidate') {
              // Emit candidates updated event
              this.trendDetector.emit('candidatesUpdated', {
                candidates: this.trendDetector.candidates,
              });
            }
            
            // Check if we're missing critical data and should retry
            const missingImage = !tracked.imageUrl;
            const missingLinks = !tracked.twitter && !tracked.telegram && !tracked.website;
            
            // Retry up to 3 times if missing data (and token still exists/is candidate)
            if ((missingImage || missingLinks) && retryCount < 2 && tracked.status !== 'dropped') {
              this.fetchMetadataAsync(mint, retryCount + 1);
            }
          }
        } else if (retryCount < 2) {
          // No metadata found, try again later
          this.fetchMetadataAsync(mint, retryCount + 1);
        }
      }).catch(() => {
        this.pendingFetches.delete(fetchKey);
        // Retry on error (up to 3 times)
        if (retryCount < 2) {
          this.fetchMetadataAsync(mint, retryCount + 1);
        }
      });
    }, delay);
  }

  getStatus() {
    return {
      connected: this.isConnected,
      subscribedTokens: this.subscribedTokens.size,
      metadataCacheSize: this.metadataCache.size,
      heliusEnabled: !!HELIUS_API_KEY,
    };
  }
}

module.exports = { PumpFunFeed };
