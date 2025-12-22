// Standalone script to start WebSocket tracking for a token
// Usage: npx ts-node start-tracking.ts <mintAddress> [externalBuyThreshold] [windowSeconds]
// Example: npx ts-node start-tracking.ts H8XH2XESM8BRo7e4X2WnWdw7UVieav8DMQ3pNzn5pump 1.0 60
// NO API SERVER NEEDED - Works standalone!

import fs from 'fs';
import path from 'path';
import base58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { PRIVATE_KEY } from './constants';

// Import WebSocket tracker directly (no API server needed)
const websocketTracker = require('./api-server/websocket-tracker');

async function startTracking() {
  const mintAddress = process.argv[2];
  const externalBuyThreshold = parseFloat(process.argv[3] || '1.0'); // Default 1 SOL
  const windowSeconds = parseInt(process.argv[4] || '60'); // Default 60 seconds
  const simulationMode = process.argv[5] === 'sim' || process.argv[5] === '--sim'; // Simulation mode

  if (!mintAddress) {
    console.error('❌ Error: Mint address required');
    console.log('Usage: npx ts-node start-tracking.ts <mintAddress> [externalBuyThreshold] [windowSeconds] [sim]');
    console.log('   Add "sim" at the end to enable simulation mode (no actual selling)');
    process.exit(1);
  }

  if (simulationMode) {
    console.log('🧪 SIMULATION MODE - Testing only, no actual selling will occur');
    console.log('');
  }

  console.log('🚀 Starting WebSocket tracking (STANDALONE - No API server needed)...');
  console.log(`   Mint: ${mintAddress}`);
  console.log(`   External Buy Threshold: ${externalBuyThreshold} SOL (cumulative)`);
  console.log(`   Aggregation Window: ${windowSeconds} seconds`);
  if (simulationMode) {
    console.log(`   🧪 Mode: SIMULATION (testing only)`);
  }
  console.log('');

  // Get our wallet addresses
  const ourWallets: string[] = [];
  
  // Add DEV wallet
  const devKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY));
  ourWallets.push(devKp.publicKey.toBase58());
  console.log(`   ✅ Added DEV wallet: ${devKp.publicKey.toBase58()}`);

  // Add bundler wallets from current-run.json
  const currentRunPath = path.join(process.cwd(), 'keys', 'current-run.json');
  if (fs.existsSync(currentRunPath)) {
    const currentRun = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
    if (currentRun.walletKeys && Array.isArray(currentRun.walletKeys)) {
      currentRun.walletKeys.forEach((keyStr: string) => {
        try {
          const kp = Keypair.fromSecretKey(base58.decode(keyStr));
          ourWallets.push(kp.publicKey.toBase58());
        } catch (err) {
          console.error(`   ⚠️  Error parsing wallet key: ${err}`);
        }
      });
      console.log(`   ✅ Added ${currentRun.walletKeys.length} bundler wallets`);
    }
  }

  console.log(`   📊 Total wallets to exclude (our wallets): ${ourWallets.length}`);
  console.log('');

  // Start tracking directly (no API server needed!)
  try {
    const success = websocketTracker.startTracking(
      mintAddress,
      ourWallets,
      true, // autoSell enabled
      0.1, // threshold (not used for cumulative)
      externalBuyThreshold,
      windowSeconds * 1000, // Convert to milliseconds
      simulationMode // Simulation mode flag
    );

    if (success) {
      console.log('✅✅✅ WebSocket tracking started successfully!');
      console.log('');
      console.log('📊 Monitoring external buys (wallets NOT in our list)...');
      if (simulationMode) {
        console.log(`   🧪 [SIM] When cumulative external buys reach ${externalBuyThreshold} SOL within ${windowSeconds}s,`);
        console.log('   🧪 [SIM] the system WOULD trigger rapid sell (simulation mode - no actual selling)');
      } else {
        console.log(`   When cumulative external buys reach ${externalBuyThreshold} SOL within ${windowSeconds}s,`);
        console.log('   the system will INSTANTLY trigger rapid sell!');
      }
      console.log('');
      console.log('⚡ Real-time transaction stream is active');
      console.log('   All transactions will be logged below:');
      console.log('   - OUR WALLET transactions are ignored');
      console.log('   - EXTERNAL transactions are aggregated');
      if (simulationMode) {
        console.log('   - 🧪 [SIM] tags indicate simulation mode');
      }
      console.log('');
      console.log('   (Press Ctrl+C to stop)');
      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('');
    } else {
      console.error('❌ Failed to start tracking');
      process.exit(1);
    }
  } catch (error: any) {
    console.error('❌ Error starting tracking:', error.message || error);
    if (error.stack) {
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  }
}

startTracking();

