/**
 * PumpFun Feed - Dedicated WebSocket connection for Trend Detector
 * Subscribes to ALL new token creations and trades on pump.fun
 * Uses Helius DAS API for proper token metadata including images
 */

const WebSocket = require('ws');
const axios = require('axios');
require('dotenv').config();

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
    
    // Track subscribed tokens (for trade feeds)
    this.subscribedTokens = new Set();
    this.maxSubscriptions = 100; // Limit active subscriptions
    
    // Token metadata cache
    this.metadataCache = new Map();
    this.metadataCacheTTL = 5 * 60 * 1000; // 5 minutes
    
    // Pending metadata fetches (to avoid duplicate requests)
    this.pendingFetches = new Set();
    
    console.log('[PumpFunFeed] Feed initialized');
    if (HELIUS_API_KEY) {
      console.log('[PumpFunFeed] ✅ Helius API key found - will use DAS API for metadata');
    } else {
      console.log('[PumpFunFeed] ⚠️ No Helius API key - using pump.fun API fallback');
    }
  }

  /**
   * Start the feed connection
   */
  start() {
    console.log('[PumpFunFeed] 🚀 Starting PumpFun feed...');
    this.connect();
  }

  /**
   * Stop the feed
   */
  stop() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.subscribedTokens.clear();
    console.log('[PumpFunFeed] 🛑 Feed stopped');
  }

  /**
   * Connect to PumpPortal WebSocket
   */
  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      console.log('[PumpFunFeed] Already connected or connecting');
      return;
    }

    console.log('[PumpFunFeed] 🔌 Connecting to wss://pumpportal.fun/api/data...');
    
    this.ws = new WebSocket('wss://pumpportal.fun/api/data');

    this.ws.on('open', () => {
      console.log('[PumpFunFeed] ✅ Connected to PumpPortal');
      this.isConnected = true;
      this.reconnectAttempts = 0;

      // Subscribe to ALL new token creations
      this.sendMessage({ method: 'subscribeNewToken' });
      console.log('[PumpFunFeed] 📡 Subscribed to new token creations');
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        // Count messages by type for debugging
        if (!this.messageCount) this.messageCount = {};
        const msgType = message.txType || message.type || (message.message ? 'status' : 'unknown');
        this.messageCount[msgType] = (this.messageCount[msgType] || 0) + 1;
        
        // Log message stats every 100 messages
        const total = Object.values(this.messageCount).reduce((a,b) => a+b, 0);
        if (total % 100 === 0) {
          console.log(`[PumpFunFeed] 📊 Message stats: ${JSON.stringify(this.messageCount)}`);
        }
        
        this.handleMessage(message);
      } catch (error) {
        console.error('[PumpFunFeed] Error parsing message:', error.message);
      }
    });

    this.ws.on('error', (error) => {
      console.error('[PumpFunFeed] ❌ WebSocket error:', error.message);
    });

    this.ws.on('close', () => {
      console.log('[PumpFunFeed] WebSocket closed');
      this.isConnected = false;
      
      // Reconnect with backoff
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = Math.min(this.reconnectDelay * this.reconnectAttempts, 30000);
        console.log(`[PumpFunFeed] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        setTimeout(() => this.connect(), delay);
      } else {
        console.error('[PumpFunFeed] ❌ Max reconnection attempts reached');
      }
    });
  }

  /**
   * Send message to WebSocket
   */
  sendMessage(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[PumpFunFeed] Cannot send - not connected');
      return false;
    }
    this.ws.send(JSON.stringify(payload));
    return true;
  }

  /**
   * Handle incoming WebSocket messages
   */
  async handleMessage(message) {
    // Status messages
    if (message.message) {
      console.log(`[PumpFunFeed] 📨 ${message.message}`);
      return;
    }
    
    // New token creation event
    if (message.txType === 'create' || message.type === 'create') {
      await this.handleNewToken(message);
      return;
    }

    // Trade event (buy/sell) - check txType field
    if (message.txType === 'buy' || message.txType === 'sell') {
      // Log trades periodically (not every one to avoid spam)
      if (Math.random() < 0.1) {
        console.log(`[PumpFunFeed] 📊 ${message.txType.toUpperCase()} ${(message.solAmount || 0).toFixed(3)} SOL - ${message.mint?.slice(0, 8)}...`);
      }
      this.handleTrade(message);
      return;
    }
    
    // Migrate event - token graduated to Raydium
    if (message.txType === 'migrate') {
      console.log(`[PumpFunFeed] 🎓 Token migrated: ${message.mint?.slice(0, 8)}...`);
      return;
    }
  }

  /**
   * Handle new token creation
   */
  async handleNewToken(data) {
    const mint = data.mint;
    if (!mint) {
      console.warn('[PumpFunFeed] New token missing mint address');
      return;
    }

    // Use data from create event first (instant)
    const symbol = data.symbol || '???';
    const name = data.name || symbol;
    
    console.log(`[PumpFunFeed] 🆕 New token: ${symbol} (${mint.slice(0, 8)}...)`);

    // Track the token immediately with basic info from create event
    const tokenInfo = {
      mint,
      name: name,
      symbol: symbol,
      imageUrl: null, // Will be fetched via Helius
      description: data.description || null,
      twitter: data.twitter || null,
      telegram: data.telegram || null,
      website: data.website || null,
      creator: data.traderPublicKey || data.creator || null,
      launchedAt: data.timestamp || Date.now(),
      // Store the metadata URI for later fetching
      metadataUri: data.uri || data.metadataUri || null,
    };

    // Pass to trend detector immediately
    if (this.trendDetector) {
      this.trendDetector.trackToken(tokenInfo);
    }

    // Subscribe to trades for this token
    this.subscribeToToken(mint);
    
    // Fetch full metadata in background using Helius (updates token if successful)
    this.fetchMetadataAsync(mint);
  }

  /**
   * Handle trade event
   */
  handleTrade(trade) {
    if (!this.trendDetector) return;

    // Format trade for trend detector
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

  /**
   * Subscribe to trades for a specific token
   */
  subscribeToToken(mint) {
    if (this.subscribedTokens.has(mint)) return;

    // Limit subscriptions to avoid overwhelming the connection
    if (this.subscribedTokens.size >= this.maxSubscriptions) {
      // Unsubscribe from oldest token
      const oldest = this.subscribedTokens.values().next().value;
      this.unsubscribeFromToken(oldest);
    }

    this.subscribedTokens.add(mint);
    this.sendMessage({ method: 'subscribeTokenTrade', keys: [mint] });
  }

  /**
   * Unsubscribe from a token's trades
   */
  unsubscribeFromToken(mint) {
    if (!this.subscribedTokens.has(mint)) return;
    
    this.subscribedTokens.delete(mint);
    this.sendMessage({ method: 'unsubscribeTokenTrade', keys: [mint] });
  }

  /**
   * Fetch token metadata using Helius DAS API (primary) or pump.fun API (fallback)
   */
  async fetchTokenMetadata(mint) {
    // Check cache first
    const cached = this.metadataCache.get(mint);
    if (cached && Date.now() - cached.fetchedAt < this.metadataCacheTTL) {
      return cached.data;
    }

    let metadata = null;

    // Try Helius DAS API first (most reliable for on-chain metadata)
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
          const jsonUri = content.json_uri;
          
          metadata = {
            name: content.metadata?.name || asset.token_info?.name,
            symbol: content.metadata?.symbol || asset.token_info?.symbol,
            description: content.metadata?.description,
            image_uri: content.links?.image || content.files?.[0]?.uri,
            twitter: links.twitter || content.metadata?.twitter,
            telegram: links.telegram || content.metadata?.telegram,
            website: links.website || content.metadata?.website,
            json_uri: jsonUri,
          };

          // If we have json_uri but no image, fetch the JSON metadata
          if (jsonUri && !metadata.image_uri) {
            try {
              const jsonRes = await axios.get(jsonUri, { timeout: 3000 });
              if (jsonRes.data) {
                metadata.image_uri = jsonRes.data.image || jsonRes.data.imageUrl;
                metadata.description = metadata.description || jsonRes.data.description;
                metadata.twitter = metadata.twitter || jsonRes.data.twitter;
                metadata.telegram = metadata.telegram || jsonRes.data.telegram;
                metadata.website = metadata.website || jsonRes.data.website;
              }
            } catch (e) {
              // Ignore JSON fetch errors
            }
          }

          if (metadata.name || metadata.symbol || metadata.image_uri) {
            console.log(`[PumpFunFeed] 📋 Helius metadata: ${metadata.symbol || '?'} - ${metadata.name || '?'} (image: ${metadata.image_uri ? 'yes' : 'no'})`);
          }
        }
      } catch (error) {
        // Helius failed, try fallback
        if (error.response?.status !== 404) {
          console.debug(`[PumpFunFeed] Helius fetch failed for ${mint.slice(0, 8)}...: ${error.message}`);
        }
      }
    }

    // Fallback: Try pump.fun frontend API
    if (!metadata || (!metadata.image_uri && !metadata.name)) {
      try {
        const response = await axios.get(`https://frontend-api.pump.fun/coins/${mint}`, {
          timeout: 3000,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });

        if (response.data) {
          const pumpData = response.data;
          metadata = metadata || {};
          metadata.name = metadata.name || pumpData.name;
          metadata.symbol = metadata.symbol || pumpData.symbol;
          metadata.description = metadata.description || pumpData.description;
          metadata.image_uri = metadata.image_uri || pumpData.image_uri;
          metadata.twitter = metadata.twitter || pumpData.twitter;
          metadata.telegram = metadata.telegram || pumpData.telegram;
          metadata.website = metadata.website || pumpData.website;
          
          console.log(`[PumpFunFeed] 📋 Pump.fun metadata: ${metadata.symbol} - ${metadata.name} (image: ${metadata.image_uri ? 'yes' : 'no'})`);
        }
      } catch (error) {
        // Silent fail for pump.fun API
      }
    }

    // Cache the result if we got anything
    if (metadata && (metadata.name || metadata.symbol || metadata.image_uri)) {
      this.metadataCache.set(mint, {
        data: metadata,
        fetchedAt: Date.now(),
      });
      return metadata;
    }

    return null;
  }
  
  /**
   * Fetch metadata in background (non-blocking)
   */
  fetchMetadataAsync(mint) {
    // Avoid duplicate fetches
    if (this.pendingFetches.has(mint)) return;
    this.pendingFetches.add(mint);
    
    // Small delay to let the token appear on-chain
    setTimeout(() => {
      this.fetchTokenMetadata(mint).then(metadata => {
        this.pendingFetches.delete(mint);
        
        if (metadata && this.trendDetector) {
          // Update the tracked token with metadata
          const tracked = this.trendDetector.trackedTokens?.get(mint);
          if (tracked) {
            if (metadata.name && metadata.name !== '???') tracked.name = metadata.name;
            if (metadata.symbol && metadata.symbol !== '???') tracked.symbol = metadata.symbol;
            if (metadata.image_uri) tracked.imageUrl = metadata.image_uri;
            if (metadata.twitter) tracked.twitter = metadata.twitter;
            if (metadata.telegram) tracked.telegram = metadata.telegram;
            if (metadata.website) tracked.website = metadata.website;
            if (metadata.description) tracked.description = metadata.description;
            
            // Log successful update
            if (metadata.image_uri) {
              console.log(`[PumpFunFeed] ✅ Updated ${tracked.symbol}: image=${metadata.image_uri.slice(0, 50)}...`);
            }
          }
        }
      }).catch(() => {
        this.pendingFetches.delete(mint);
        // Silently ignore - metadata is optional
      });
    }, 2000); // 2 second delay for on-chain propagation
  }

  /**
   * Get connection status
   */
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
