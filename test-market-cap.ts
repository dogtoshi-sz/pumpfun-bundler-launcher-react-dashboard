// Test Market Cap Tracker - Test market cap tracking with any token address (WebSocket-based)
import MarketCapTrackerWebSocket from './market-cap-tracker-websocket';
import { MARKET_CAP_SELL_THRESHOLD } from './constants';

// Get mint address from command line argument
const mintAddress = process.argv[2];

if (!mintAddress) {
  console.error('❌ Usage: npm run test-market-cap <MINT_ADDRESS>');
  console.error('   Example: npm run test-market-cap 7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr');
  process.exit(1);
}

console.log('🧪 Testing Market Cap Tracker (WebSocket-based)');
console.log(`   Mint Address: ${mintAddress}`);
console.log(`   Using Helius WebSocket + Jupiter API for real-time updates`);
console.log(`   Press Ctrl+C to stop\n`);

// Create tracker with a very high threshold (so it won't trigger auto-sell)
const tracker = new MarketCapTrackerWebSocket(
  mintAddress,
  999999999999, // Very high threshold - won't trigger
  'rapid-sell',
  (marketCap) => {
    // Callback to display market cap updates
    const marketCapFormatted = marketCap >= 1000000 
      ? `$${(marketCap / 1000000).toFixed(2)}M`
      : marketCap >= 1000
      ? `$${(marketCap / 1000).toFixed(2)}K`
      : `$${marketCap.toFixed(2)}`;
    console.log(`📊 Current Market Cap: ${marketCapFormatted}`);
  }
);

// Start tracking
const success = tracker.start();

if (!success) {
  console.error('❌ Failed to start market cap tracking');
  process.exit(1);
}

// Keep process alive
process.on('SIGINT', () => {
  console.log('\n\n⏸️  Stopping market cap tracker...');
  tracker.stop();
  process.exit(0);
});

