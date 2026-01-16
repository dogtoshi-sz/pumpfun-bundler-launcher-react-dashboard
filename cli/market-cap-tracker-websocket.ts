// Market Cap Tracker - Uses Helius WebSocket for REAL-TIME market cap tracking
// Monitors transactions and calculates market cap from live price data
import { exec } from 'child_process';
import { promisify } from 'util';
import { Connection, PublicKey } from '@solana/web3.js';
const WebSocket = require('ws');
const axios = require('axios');
import * as fs from 'fs';
import * as path from 'path';
import { MARKET_CAP_SELL_THRESHOLD, MARKET_CAP_CHECK_INTERVAL, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT } from '../constants';

const execAsync = promisify(exec);
const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

class MarketCapTrackerWebSocket {
  private mintAddress: string;
  private threshold: number;
  private autoSellType: string;
  private onMarketCapUpdate?: (marketCap: number) => void;
  
  private ws: any = null;
  private connection: Connection;
  private isTracking: boolean = false;
  private lastMarketCap: number = 0;
  private lastPrice: number = 0;
  private tokenSupply: number = 0;
  private decimals: number = 9;
  private wsUrl: string = '';
  private subscriptionId: number | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private priceUpdateInterval: NodeJS.Timeout | null = null;

  constructor(
    mintAddress: string,
    threshold: number = MARKET_CAP_SELL_THRESHOLD,
    autoSellType: string = 'rapid-sell',
    onMarketCapUpdate?: (marketCap: number) => void
  ) {
    this.mintAddress = mintAddress;
    this.threshold = threshold;
    this.autoSellType = autoSellType;
    this.onMarketCapUpdate = onMarketCapUpdate;
    this.connection = new Connection(RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com');
  }

  private async getTokenSupply(): Promise<number> {
    try {
      const mintPubkey = new PublicKey(this.mintAddress);
      const mintInfo = await this.connection.getParsedAccountInfo(mintPubkey);
      
      if (mintInfo.value && mintInfo.value.data && 'parsed' in mintInfo.value.data) {
        const supply = (mintInfo.value.data.parsed as any).info.supply || 0;
        this.decimals = (mintInfo.value.data.parsed as any).info.decimals || 9;
        this.tokenSupply = Number(supply) / Math.pow(10, this.decimals);
        return this.tokenSupply;
      }
    } catch (error: any) {
      console.warn(`⚠️  Error fetching token supply: ${error.message}`);
    }
    return 0;
  }

  private async getPriceFromJupiter(): Promise<number | null> {
    try {
      // Jupiter API is REAL and public - no API key needed
      const url = `https://price.jup.ag/v4/price?ids=${this.mintAddress}`;
      const response = await axios.get(url);
      
      if (response.status === 200 && response.data) {
        const data = response.data;
        if (data.data && data.data[this.mintAddress]) {
          const priceData = data.data[this.mintAddress];
          const price = priceData.price || 0;
          
          if (price > 0) {
            this.lastPrice = price;
            return price;
          } else {
            console.warn(`[Market Cap Tracker] ⚠️  Jupiter returned price 0 for ${this.mintAddress}`);
          }
        } else {
          console.warn(`[Market Cap Tracker] ⚠️  Jupiter API: Token ${this.mintAddress} not found in price data`);
        }
      } else {
        console.warn(`[Market Cap Tracker] ⚠️  Jupiter API error: ${response.status}`);
      }
    } catch (error: any) {
      if (error.response) {
        console.warn(`[Market Cap Tracker] ⚠️  Jupiter API error: ${error.response.status} ${error.response.statusText}`);
      } else {
        console.warn(`[Market Cap Tracker] ⚠️  Jupiter API fetch failed: ${error.message}`);
      }
    }
    return null;
  }
  
  private async getMarketCapFromBirdeye(): Promise<number | null> {
    // Try Birdeye if API key is set (they have market cap directly)
    const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
    if (!BIRDEYE_API_KEY) {
      return null;
    }
    
    try {
      const url = `https://public-api.birdeye.so/defi/token_overview?address=${this.mintAddress}`;
      const response = await axios.get(url, {
        headers: {
          'X-API-KEY': BIRDEYE_API_KEY,
          'Accept': 'application/json'
        }
      });
      
      if (response.status === 200 && response.data) {
        const data = response.data;
        if (data.success && data.data) {
          const marketCap = data.data.mc || data.data.marketCap || 0;
          if (marketCap > 0) {
            return marketCap;
          }
        }
      }
    } catch (error: any) {
      // Birdeye failed - silently continue
    }
    return null;
  }

  private async processTransactionForPrice(signature: string): Promise<void> {
    try {
      // Fetch transaction to extract buy/sell amounts
      const tx = await this.connection.getParsedTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      });
      
      if (!tx || !tx.meta) return;
      
      // Look for token transfers and SOL transfers to calculate price
      const preBalances = tx.meta.preBalances || [];
      const postBalances = tx.meta.postBalances || [];
      const preTokenBalances = tx.meta.preTokenBalances || [];
      const postTokenBalances = tx.meta.postTokenBalances || [];
      
      // Find SOL balance change (buy/sell amount)
      let solChange = 0;
      for (let i = 0; i < preBalances.length && i < postBalances.length; i++) {
        const change = (postBalances[i] - preBalances[i]) / 1e9;
        if (Math.abs(change) > 0.001) { // Significant change
          solChange = Math.abs(change);
          break;
        }
      }
      
      // Find token balance change
      let tokenChange = 0;
      for (const pre of preTokenBalances) {
        if (pre.mint === this.mintAddress) {
          for (const post of postTokenBalances) {
            if (post.mint === this.mintAddress && post.owner === pre.owner) {
              const preAmount = parseFloat(pre.uiTokenAmount.uiAmountString || '0');
              const postAmount = parseFloat(post.uiTokenAmount.uiAmountString || '0');
              tokenChange = Math.abs(postAmount - preAmount);
              break;
            }
          }
        }
      }
      
      // Calculate price from transaction: price = SOL / tokens
      if (solChange > 0 && tokenChange > 0) {
        const price = solChange / tokenChange;
        if (price > 0 && price < 1000000) { // Sanity check
          this.lastPrice = price;
          console.log(`[Market Cap Tracker] 💰 New price from transaction: $${price.toFixed(8)} (${solChange.toFixed(4)} SOL / ${tokenChange.toFixed(2)} tokens)`);
          
          // Update market cap
          if (this.tokenSupply === 0) {
            await this.getTokenSupply();
          }
          if (this.tokenSupply > 0) {
            const marketCap = price * this.tokenSupply;
            this.updateMarketCapValue(marketCap);
          }
        }
      }
    } catch (error: any) {
      // Ignore transaction fetch errors
    }
  }

  private async updateMarketCapFromOnChain(): Promise<void> {
    // Get initial supply
    await this.getTokenSupply();
    
    // Try to get price from recent transactions or use API fallback
    await this.updateMarketCap();
  }

  private async updateMarketCap(): Promise<void> {
    if (!this.isTracking) return;

    console.log(`[Market Cap Tracker] 🔄 Fetching market cap data...`);

    // Method 1: Try Birdeye for direct market cap (if API key set)
    const birdeyeMarketCap = await this.getMarketCapFromBirdeye();
    if (birdeyeMarketCap !== null && birdeyeMarketCap > 0) {
      console.log(`[Market Cap Tracker] ✅ Got market cap from Birdeye: $${birdeyeMarketCap.toFixed(2)}`);
      this.updateMarketCapValue(birdeyeMarketCap);
      return;
    }

    // Method 2: Try DexScreener first (works with pump.fun tokens)
    console.log(`[Market Cap Tracker] 📡 Fetching price from DexScreener API...`);
    let price = await this.getPriceFromDexScreener();
    
    // Method 3: Fallback to Jupiter (only works for graduated tokens)
    if (price === null) {
      console.log(`[Market Cap Tracker] 📡 DexScreener failed, trying Jupiter API...`);
      price = await this.getPriceFromJupiter();
    }
    
    if (price === null) {
      console.warn(`[Market Cap Tracker] ⚠️  Could not get price from any API`);
      // If all APIs fail, use last known price if available
      if (this.lastPrice > 0 && this.tokenSupply > 0) {
        const marketCap = this.lastPrice * this.tokenSupply;
        console.log(`[Market Cap Tracker] 📊 Using last known price: $${this.lastPrice.toFixed(8)}`);
        this.updateMarketCapValue(marketCap);
        return;
      }
      console.error(`[Market Cap Tracker] ❌ No price data available. Token may not be listed yet.`);
      return;
    }

    console.log(`[Market Cap Tracker] ✅ Got price from Jupiter: $${price.toFixed(8)}`);

    // Ensure we have supply
    if (this.tokenSupply === 0) {
      console.log(`[Market Cap Tracker] 📦 Fetching token supply...`);
      await this.getTokenSupply();
      if (this.tokenSupply === 0) {
        console.error(`[Market Cap Tracker] ❌ Could not fetch token supply`);
        return;
      }
    }

    console.log(`[Market Cap Tracker] 📦 Token supply: ${this.tokenSupply.toFixed(2)}`);

    // Calculate market cap: price × supply
    const marketCap = price * this.tokenSupply;
    console.log(`[Market Cap Tracker] 💰 Calculated market cap: $${marketCap.toFixed(2)}`);
    this.updateMarketCapValue(marketCap);
  }

  private updateMarketCapValue(marketCap: number): void {
    this.lastMarketCap = marketCap;

    // Notify callback
    if (this.onMarketCapUpdate) {
      this.onMarketCapUpdate(marketCap);
    }

    // Format for display
    const marketCapFormatted = marketCap >= 1000000 
      ? `$${(marketCap / 1000000).toFixed(2)}M`
      : marketCap >= 1000
      ? `$${(marketCap / 1000).toFixed(2)}K`
      : `$${marketCap.toFixed(2)}`;

    console.log(`📊 Market Cap: ${marketCapFormatted} (Threshold: $${(this.threshold / 1000).toFixed(0)}K)`);

    // Check threshold
    if (marketCap >= this.threshold) {
      console.log(`\n🎯🎯🎯 MARKET CAP THRESHOLD REACHED! 🎯🎯🎯`);
      console.log(`   Current Market Cap: ${marketCapFormatted}`);
      console.log(`   Threshold: $${(this.threshold / 1000).toFixed(0)}K`);
      console.log(`   Triggering ${this.autoSellType}...\n`);

      this.stop();

      // Trigger rapid sell
      this.triggerAutoSell();
    }
  }

  private async triggerAutoSell(): Promise<void> {
    try {
      const command = `npm run ${this.autoSellType} ${this.mintAddress}`;
      console.log(`🚀 Executing: ${command}`);
      const { stdout, stderr } = await execAsync(command, {
        cwd: process.cwd(),
        maxBuffer: 10 * 1024 * 1024
      });
      
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
      
      console.log(`✅ Auto-sell triggered successfully!`);
    } catch (error: any) {
      console.error(`❌ Failed to trigger auto-sell: ${error.message}`);
      console.error(`   You can manually sell with: npm run ${this.autoSellType} ${this.mintAddress}`);
    }
  }

  private initializeWebSocket(): void {
    // Use RPC_WEBSOCKET_ENDPOINT from constants (already loaded from .env)
    if (RPC_WEBSOCKET_ENDPOINT && RPC_WEBSOCKET_ENDPOINT.trim() !== '') {
      this.wsUrl = RPC_WEBSOCKET_ENDPOINT;
      return;
    }
    
    // Fallback: Extract API key from RPC_ENDPOINT and construct WebSocket URL
    if (RPC_ENDPOINT) {
      const apiKeyMatch = RPC_ENDPOINT.match(/api-key=([^&]+)/);
      if (apiKeyMatch) {
        this.wsUrl = `wss://mainnet.helius-rpc.com/?api-key=${apiKeyMatch[1]}`;
        return;
      }
    }
    
    // Last resort: Try reading from .env file directly
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const lines = envContent.split(/\r?\n/); // Handle both \n and \r\n
      
      for (const line of lines) {
        const trimmed = line.trim();
        // Skip comments and empty lines
        if (!trimmed || trimmed.startsWith('#')) continue;
        
        const wsMatch = trimmed.match(/^RPC_WEBSOCKET_ENDPOINT=(.*)$/);
        if (wsMatch) {
          this.wsUrl = wsMatch[1].trim();
          return;
        }
        
        const rpcMatch = trimmed.match(/^RPC_ENDPOINT=(.*)$/);
        if (rpcMatch) {
          const apiKeyMatch = rpcMatch[1].match(/api-key=([^&]+)/);
          if (apiKeyMatch) {
            this.wsUrl = `wss://mainnet.helius-rpc.com/?api-key=${apiKeyMatch[1]}`;
            return;
          }
        }
      }
    }
    
    throw new Error('Could not find RPC_WEBSOCKET_ENDPOINT or RPC_ENDPOINT with api-key. Please check your .env file.');
  }

  private connectWebSocket(): void {
    if (!this.wsUrl) {
      this.initializeWebSocket();
    }

    console.log(`[Market Cap Tracker] Connecting to WebSocket: ${this.wsUrl.replace(/api-key=[^&]+/, 'api-key=***')}`);

    this.ws = new WebSocket(this.wsUrl);

    if (!this.ws) {
      throw new Error('Failed to create WebSocket connection');
    }

    this.ws.on('open', () => {
      console.log('[Market Cap Tracker] ✅ WebSocket connected');
      this.reconnectAttempts = 0;
      
      // Subscribe to pump.fun program transaction logs to monitor buy/sell transactions
      // This gives us REAL-TIME price updates from actual trades
      const subscribeMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'logsSubscribe',
        params: [
          {
            mentions: [PUMP_PROGRAM_ID] // Subscribe to all pump.fun transactions
          },
          {
            commitment: 'confirmed'
          }
        ]
      };
      
      console.log('[Market Cap Tracker] 📡 Subscribing to pump.fun transaction logs...');
      this.ws?.send(JSON.stringify(subscribeMessage));
      
      // Also subscribe to account changes for supply updates
      const accountSubscribe = {
        jsonrpc: '2.0',
        id: 2,
        method: 'accountSubscribe',
        params: [
          this.mintAddress,
          {
            encoding: 'jsonParsed',
            commitment: 'confirmed'
          }
        ]
      };
      this.ws?.send(JSON.stringify(accountSubscribe));
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        
        // Handle subscription confirmations
        if (message.id === 1 && message.result) {
          // Logs subscription confirmed
          console.log('[Market Cap Tracker] ✅ Subscribed to pump.fun transaction logs');
          // Initial update
          this.updateMarketCapFromOnChain();
        } else if (message.id === 2 && message.result) {
          // Account subscription confirmed
          console.log('[Market Cap Tracker] ✅ Subscribed to account changes');
        }
        
        // Handle log notifications (pump.fun transactions)
        if (message.method === 'logsNotification' && message.params) {
          const { result } = message.params;
          if (result && result.value && result.value.logs) {
            // Check if this transaction mentions our mint address
            const logs = result.value.logs.join(' ');
            if (logs.includes(this.mintAddress)) {
              // Transaction involving our token - fetch it and extract price
              this.processTransactionForPrice(result.value.signature);
            }
          }
        }
        
        // Handle account notifications (supply changes)
        if (message.method === 'accountNotification') {
          // Token account changed - update supply and recalculate
          this.getTokenSupply().then(() => {
            if (this.lastPrice > 0 && this.tokenSupply > 0) {
              const marketCap = this.lastPrice * this.tokenSupply;
              this.updateMarketCapValue(marketCap);
            }
          });
        }
      } catch (error: any) {
        // Ignore parse errors
      }
    });

    this.ws.on('error', (error: Error) => {
      console.error('[Market Cap Tracker] WebSocket error:', error.message);
    });

    this.ws.on('close', () => {
      console.log('[Market Cap Tracker] WebSocket closed');
      this.subscriptionId = null;
      
      if (this.isTracking && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        console.log(`[Market Cap Tracker] Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        setTimeout(() => this.connectWebSocket(), delay);
      }
    });
  }

  start(): boolean {
    if (this.isTracking) {
      console.warn('⚠️  Market cap tracking is already running');
      return false;
    }

    this.isTracking = true;
    console.log(`\n📊📊📊 MARKET CAP TRACKING STARTED (WebSocket) 📊📊📊`);
    console.log(`   Mint Address: ${this.mintAddress}`);
    console.log(`   Threshold: $${(this.threshold / 1000).toFixed(0)}K`);
    console.log(`   Update Interval: ${MARKET_CAP_CHECK_INTERVAL} seconds`);
    console.log(`   Auto-Sell Type: ${this.autoSellType}`);
    console.log(`   Using Helius WebSocket + DexScreener/Jupiter API for real-time updates`);
    console.log(`   Will trigger auto-sell when market cap reaches threshold\n`);

    // Initialize token supply
    this.getTokenSupply().then(() => {
      // Connect WebSocket
      this.connectWebSocket();
    });

    return true;
  }

  stop(): void {
    if (!this.isTracking) return;

    this.isTracking = false;
    
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
      this.priceUpdateInterval = null;
    }
    
    if (this.subscriptionId && this.ws) {
      // Unsubscribe
      const unsubscribeMessage = {
        jsonrpc: '2.0',
        id: 2,
        method: 'accountUnsubscribe',
        params: [this.subscriptionId]
      };
      this.ws.send(JSON.stringify(unsubscribeMessage));
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    console.log('⏸️  Market cap tracking stopped');
  }

  getLastMarketCap(): number {
    return this.lastMarketCap;
  }

  isActive(): boolean {
    return this.isTracking;
  }
}

export default MarketCapTrackerWebSocket;

