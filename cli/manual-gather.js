// Manual SOL gather script - transfers remaining SOL from bundler wallets to main wallet
require('dotenv').config();
const base58 = require('bs58').default || require('bs58');
const { Keypair, Connection, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
const RPC_WEBSOCKET_ENDPOINT = process.env.RPC_WEBSOCKET_ENDPOINT || 'wss://api.mainnet-beta.solana.com';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const BUYER_WALLET = process.env.BUYER_WALLET;

if (!RPC_ENDPOINT || !PRIVATE_KEY) {
  console.error('RPC_ENDPOINT and PRIVATE_KEY must be set in the .env file.');
  process.exit(1);
}

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: "confirmed"
});

const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY));
const mainAddress = mainKp.publicKey.toBase58();

console.log('='.repeat(70));
console.log('MANUAL SOL GATHER');
console.log('='.repeat(70));
console.log(`Main Wallet: ${mainAddress}`);
console.log(`Solscan: https://solscan.io/account/${mainAddress}\n`);

async function manualGather() {
  const keysPath = path.join(__dirname, '..', 'keys', 'data.json');
  if (!fs.existsSync(keysPath)) {
    console.error('No bundler wallets found in keys/data.json');
    return;
  }

  const walletsData = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
  
  // Read current run info to know which wallets to gather from
  const currentRunPath = path.join(__dirname, '..', 'keys', 'current-run.json');
  let walletsToProcess = [];
  
  if (fs.existsSync(currentRunPath)) {
    try {
      const currentRunData = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
      
      // NEW: Use actual wallet keys from current-run.json if available (more accurate)
      if (currentRunData.walletKeys && Array.isArray(currentRunData.walletKeys) && currentRunData.walletKeys.length > 0) {
        console.log(`✅ Found ${currentRunData.walletKeys.length} wallet keys in current-run.json`);
        console.log(`   Mint: ${currentRunData.mintAddress || 'N/A'}`);
        console.log(`   Timestamp: ${new Date(currentRunData.timestamp).toLocaleString()}`);
        
        // Use the exact wallets from this run
        walletsToProcess = currentRunData.walletKeys;
        console.log(`   Using EXACT wallets from current run (no unnecessary RPC calls for old wallets)`);
      } else {
        // FALLBACK: Old format - use count and slice from data.json
        console.log(`⚠️  Old format current-run.json detected (no walletKeys). Using count-based approach.`);
        const walletCount = currentRunData.count || walletsData.length;
        console.log(`Current run used ${walletCount} wallets`);
        console.log(`Total wallets in data.json: ${walletsData.length}`);
        
        // Only use the LAST N wallets (from the current run)
        const startIndex = Math.max(0, walletsData.length - walletCount);
        walletsToProcess = walletsData.slice(startIndex);
        
        console.log(`Gathering from wallets ${startIndex + 1} to ${walletsData.length} (${walletsToProcess.length} wallets)`);
      }
    } catch (error) {
      console.log('❌ Error reading current-run.json, using all wallets:', error);
      walletsToProcess = walletsData;
    }
  } else {
    console.log('⚠️ No current-run.json found. Using ALL wallets from data.json');
    console.log('This will gather from all historical wallets. Consider running a token launch first.');
    walletsToProcess = walletsData;
  }
  
  // Add DEV buy wallet if it exists
  if (BUYER_WALLET) {
    const buyerKp = Keypair.fromSecretKey(base58.decode(BUYER_WALLET));
    walletsToProcess.push(BUYER_WALLET); // Add as string to match format
    console.log(`Added DEV buy wallet: ${buyerKp.publicKey.toBase58()}`);
  }
  
  console.log(`\n📊 GATHERING SUMMARY:`);
  console.log(`   - Bundler wallets: ${walletsToProcess.length - (BUYER_WALLET ? 1 : 0)}`);
  if (BUYER_WALLET) {
    console.log(`   - DEV buy wallet: 1`);
  }
  console.log(`   - Total wallets to process: ${walletsToProcess.length}\n`);

  let totalGathered = 0;
  let walletsProcessed = 0;
  let walletsWithBalance = [];

  // First, check which wallets have SOL
  console.log('Checking wallet balances...\n');
  for (let i = 0; i < walletsToProcess.length; i++) {
    try {
      const walletKey = walletsToProcess[i];
      const kp = Keypair.fromSecretKey(base58.decode(walletKey));
      const isDevWallet = BUYER_WALLET && walletKey === BUYER_WALLET;
      const walletLabel = isDevWallet ? "DEV Buy Wallet" : `Bundler Wallet ${i + 1}`;
      const balance = await connection.getBalance(kp.publicKey);
      const solBal = balance / LAMPORTS_PER_SOL;
      
      if (solBal > 0.001) { // More than 0.001 SOL (accounting for fees)
        // Calculate original index in full walletsData array (only for bundler wallets)
        const originalIndex = isDevWallet ? -1 : (walletsData.length - (walletsToProcess.length - (BUYER_WALLET ? 1 : 0)) + i);
        walletsWithBalance.push({
          index: originalIndex,
          keypair: kp,
          balance: solBal,
          address: kp.publicKey.toBase58(),
          isDevWallet: isDevWallet
        });
        const indexLabel = isDevWallet ? "DEV" : `${originalIndex + 1}`;
        console.log(`${walletLabel} (${indexLabel}): ${solBal.toFixed(4)} SOL - ${kp.publicKey.toBase58()}`);
      }
      await new Promise(r => setTimeout(r, 100)); // Rate limit protection
    } catch (error) {
      console.error(`Error checking wallet ${i + 1}: ${error.message}`);
    }
  }

  if (walletsWithBalance.length === 0) {
    console.log('\n✅ No wallets with SOL found. All SOL has been gathered.');
    return;
  }

  console.log(`\nFound ${walletsWithBalance.length} wallets with SOL\n`);
  console.log('='.repeat(70));
  console.log('GATHERING SOL...');
  console.log('='.repeat(70));

  // Transfer SOL from each wallet
  for (const wallet of walletsWithBalance) {
    try {
      const balance = await connection.getBalance(wallet.keypair.publicKey);
      const solBal = balance / LAMPORTS_PER_SOL;
      
      // Reserve ~0.001 SOL for transaction fees
      const transferAmount = balance - 5000; // Leave 5000 lamports (~0.000005 SOL) for fees
      
      if (transferAmount <= 0) {
        console.log(`\nWallet ${wallet.index + 1}: Insufficient balance (${solBal.toFixed(4)} SOL) - skipping`);
        continue;
      }

      console.log(`\nWallet ${wallet.index + 1} (${wallet.address}):`);
      console.log(`  Balance: ${solBal.toFixed(4)} SOL`);
      console.log(`  Transferring: ${(transferAmount / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: wallet.keypair.publicKey,
          toPubkey: mainKp.publicKey,
          lamports: transferAmount,
        })
      );

      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [wallet.keypair],
        {
          commitment: 'confirmed',
          skipPreflight: false
        }
      );

      const finalBalance = await connection.getBalance(wallet.keypair.publicKey);
      const gathered = solBal - (finalBalance / LAMPORTS_PER_SOL);
      totalGathered += gathered;
      walletsProcessed++;

      console.log(`  ✅ Success! Gathered ${gathered.toFixed(4)} SOL`);
      console.log(`  Transaction: https://solscan.io/tx/${signature}`);
      console.log(`  Remaining: ${(finalBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

      // Small delay between transactions to avoid rate limits
      await new Promise(r => setTimeout(r, 1000));

    } catch (error) {
      console.error(`\n❌ Error gathering from wallet ${wallet.index + 1}: ${error.message}`);
      if (error.message.includes('429')) {
        console.log('  Rate limit hit. Waiting 5 seconds...');
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`Wallets processed: ${walletsProcessed}/${walletsWithBalance.length}`);
  console.log(`Total SOL gathered: ${totalGathered.toFixed(4)} SOL`);
  
  const mainBalance = await connection.getBalance(mainKp.publicKey);
  console.log(`\nMain wallet balance: ${(mainBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`Solscan: https://solscan.io/account/${mainAddress}`);
  console.log('='.repeat(70));
}

manualGather().catch(console.error);

