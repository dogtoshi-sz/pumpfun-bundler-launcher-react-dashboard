// Market Cap Tracker - Gets market cap from Jupiter/pump.fun APIs (via Helius RPC) and triggers auto-sell when threshold is reached
import { exec } from 'child_process';
import { promisify } from 'util';
import { Connection, PublicKey } from '@solana/web3.js';
import { MARKET_CAP_SELL_THRESHOLD, MARKET_CAP_CHECK_INTERVAL, BIRDEYE_API_KEY, RPC_ENDPOINT } from '../constants';

const execAsync = promisify(exec);

interface TokenMarketData {
  price: number;
  marketCap: number;
  source: 'jupiter' | 'birdeye' | 'pumpfun';
}

class MarketCapTracker {
  private mintAddress: string;
  private threshold: number;
  private checkInterval: number;
  private intervalId: NodeJS.Timeout | null = null;
  private isTracking: boolean = false;
  private lastMarketCap: number = 0;
  private autoSellType: string = 'rapid-sell';
  private onMarketCapUpdate?: (marketCap: number) => void;

  constructor(
    mintAddress: string,
    threshold: number = MARKET_CAP_SELL_THRESHOLD,
    checkInterval: number = MARKET_CAP_CHECK_INTERVAL,
    autoSellType: string = 'rapid-sell',
    onMarketCapUpdate?: (marketCap: number) => void
  ) {
    this.mintAddress = mintAddress;
    this.threshold = threshold;
    this.checkInterval = checkInterval;
    this.autoSellType = autoSellType;
    this.onMarketCapUpdate = onMarketCapUpdate;
  }

  async fetchMarketCap(): Promise<number | null> {
    // Try multiple sources in order of preference
    // 1. Jupiter API (free, no API key needed, works with Helius RPC)
    // 2. Birdeye API (if API key is set)
    // 3. pump.fun API (fallback)
    
    // Method 1: Try Jupiter API first (best - free, no API key needed)
    try {
      const jupiterUrl = `https://price.jup.ag/v4/price?ids=${this.mintAddress}`;
      const jupiterResponse = await fetch(jupiterUrl);
      
      if (jupiterResponse.ok) {
        const jupiterData = await jupiterResponse.json();
        if (jupiterData.data && jupiterData.data[this.mintAddress]) {
          const priceData = jupiterData.data[this.mintAddress];
          const price = priceData.price || 0;
          
          // Get token supply from on-chain
          const connection = new Connection(RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com');
          const mintPubkey = new PublicKey(this.mintAddress);
          const mintInfo = await connection.getParsedAccountInfo(mintPubkey);
          
          if (mintInfo.value && mintInfo.value.data && 'parsed' in mintInfo.value.data) {
            const supply = (mintInfo.value.data.parsed as any).info.supply || 0;
            const decimals = (mintInfo.value.data.parsed as any).info.decimals || 9;
            const supplyFormatted = Number(supply) / Math.pow(10, decimals);
            const marketCap = price * supplyFormatted;
            
            if (marketCap > 0) {
              return marketCap;
            }
          }
        }
      }
    } catch (error: any) {
      // Jupiter failed, try next method
    }
    
    // Method 2: Try Birdeye API (if API key is set)
    if (BIRDEYE_API_KEY) {
      try {
        const url = `https://public-api.birdeye.so/defi/token_overview?address=${this.mintAddress}`;
        const response = await fetch(url, {
          headers: {
            'X-API-KEY': BIRDEYE_API_KEY,
            'Accept': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data) {
            const marketCap = data.data.mc || data.data.marketCap || 0;
            if (marketCap > 0) {
              return marketCap;
            }
          }
        }
      } catch (error: any) {
        // Birdeye failed, try next method
      }
    }
    
    // Method 3: Try pump.fun API (for pump.fun tokens)
    try {
      const pumpfunUrl = `https://frontend-api.pump.fun/coins/${this.mintAddress}`;
      const pumpfunResponse = await fetch(pumpfunUrl);
      
      if (pumpfunResponse.ok) {
        const pumpfunData = await pumpfunResponse.json();
        if (pumpfunData.usd_market_cap) {
          return pumpfunData.usd_market_cap;
        }
      }
    } catch (error: any) {
      // All methods failed
    }
    
    return null;
  }

  async checkMarketCap(): Promise<void> {
    if (!this.isTracking) return;

    const marketCap = await this.fetchMarketCap();
    
    if (marketCap === null) {
      // API error or rate limit - continue tracking, will retry next interval
      return;
    }

    this.lastMarketCap = marketCap;

    // Notify callback if provided
    if (this.onMarketCapUpdate) {
      this.onMarketCapUpdate(marketCap);
    }

    // Format market cap for display
    const marketCapFormatted = marketCap >= 1000000 
      ? `$${(marketCap / 1000000).toFixed(2)}M`
      : marketCap >= 1000
      ? `$${(marketCap / 1000).toFixed(2)}K`
      : `$${marketCap.toFixed(2)}`;

    console.log(`📊 Market Cap: ${marketCapFormatted} (Threshold: $${(this.threshold / 1000).toFixed(0)}K)`);

    // Check if threshold is reached
    if (marketCap >= this.threshold) {
      console.log(`\n🎯🎯🎯 MARKET CAP THRESHOLD REACHED! 🎯🎯🎯`);
      console.log(`   Current Market Cap: ${marketCapFormatted}`);
      console.log(`   Threshold: $${(this.threshold / 1000).toFixed(0)}K`);
      console.log(`   Triggering ${this.autoSellType}...\n`);

      // Stop tracking to prevent multiple triggers
      this.stop();

      // Trigger rapid sell
      try {
        const command = `npm run ${this.autoSellType} ${this.mintAddress}`;
        console.log(`🚀 Executing: ${command}`);
        const { stdout, stderr } = await execAsync(command, {
          cwd: process.cwd(),
          maxBuffer: 10 * 1024 * 1024 // 10MB buffer
        });
        
        if (stdout) console.log(stdout);
        if (stderr) console.error(stderr);
        
        console.log(`✅ Auto-sell triggered successfully!`);
      } catch (error: any) {
        console.error(`❌ Failed to trigger auto-sell: ${error.message}`);
        console.error(`   You can manually sell with: npm run ${this.autoSellType} ${this.mintAddress}`);
      }
    }
  }

  start(): boolean {
    if (this.isTracking) {
      console.warn('⚠️  Market cap tracking is already running');
      return false;
    }

    this.isTracking = true;
    console.log(`\n📊📊📊 MARKET CAP TRACKING STARTED 📊📊📊`);
    console.log(`   Mint Address: ${this.mintAddress}`);
    console.log(`   Threshold: $${(this.threshold / 1000).toFixed(0)}K`);
    console.log(`   Check Interval: ${this.checkInterval} seconds`);
    console.log(`   Auto-Sell Type: ${this.autoSellType}`);
    console.log(`   Data Sources: Jupiter API (primary), ${BIRDEYE_API_KEY ? 'Birdeye API (fallback), ' : ''}pump.fun API (fallback)`);
    console.log(`   Will trigger auto-sell when market cap reaches threshold\n`);

    // Initial check immediately
    this.checkMarketCap();

    // Then check at intervals
    this.intervalId = setInterval(() => {
      this.checkMarketCap();
    }, this.checkInterval * 1000);

    return true;
  }

  stop(): void {
    if (!this.isTracking) return;

    this.isTracking = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
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

export default MarketCapTracker;

