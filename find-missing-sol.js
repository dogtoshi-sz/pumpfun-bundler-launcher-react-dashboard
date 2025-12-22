// Comprehensive SOL tracking script - READ ONLY, NO TRANSACTIONS
require('dotenv').config();
const base58 = require('bs58');
const { Keypair, Connection } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_ENDPOINT, 'confirmed');

const mainPrivateKey = process.env.PRIVATE_KEY;
const mainKp = Keypair.fromSecretKey(base58.decode(mainPrivateKey));
const mainAddress = mainKp.publicKey.toBase58();

const keysPath = path.join(__dirname, 'keys', 'data.json');
const walletsData = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));

// Expected amounts per wallet
const SWAP_AMOUNTS = process.env.SWAP_AMOUNTS 
  ? process.env.SWAP_AMOUNTS.split(',').map(s => Number(s.trim()))
  : Array(parseInt(process.env.DISTRIBUTION_WALLETNUM || '10')).fill(Number(process.env.SWAP_AMOUNT || 0.3));

async function comprehensiveCheck() {
  console.log('='.repeat(60));
  console.log('COMPREHENSIVE SOL TRACKING ANALYSIS');
  console.log('='.repeat(60));
  console.log(`\nMain Wallet: ${mainAddress}`);
  console.log(`Solscan: https://solscan.io/account/${mainAddress}\n`);

  // Check main wallet balance
  let mainBalance = 0;
  try {
    const balance = await connection.getBalance(mainKp.publicKey);
    mainBalance = balance / 1e9;
    console.log(`Main Wallet Balance: ${mainBalance.toFixed(4)} SOL\n`);
  } catch (error) {
    console.log(`Error checking main wallet: ${error.message}\n`);
  }

  console.log('='.repeat(60));
  console.log('CHECKING BUNDLER WALLETS');
  console.log('='.repeat(60));
  console.log(`Total wallets to check: ${walletsData.length}\n`);

  const walletDetails = [];
  let totalFound = 0;

  for (let i = 0; i < walletsData.length; i++) {
    try {
      const keypair = Keypair.fromSecretKey(base58.decode(walletsData[i]));
      const address = keypair.publicKey.toBase58();
      const expectedAmount = SWAP_AMOUNTS[i] || SWAP_AMOUNTS[0] || 0.3;
      const expectedWithFees = expectedAmount + 0.01; // Each wallet gets buy amount + 0.01 for fees

      try {
        const balance = await connection.getBalance(keypair.publicKey);
        const solBalance = balance / 1e9;
        
        walletDetails.push({
          index: i + 1,
          address,
          expected: expectedWithFees,
          actual: solBalance,
          difference: solBalance - expectedWithFees,
          hasBalance: solBalance > 0.001
        });

        if (solBalance > 0.001) {
          totalFound += solBalance;
          console.log(`Wallet ${i + 1}:`);
          console.log(`  Address: ${address}`);
          console.log(`  Expected: ${expectedWithFees.toFixed(4)} SOL`);
          console.log(`  Actual: ${solBalance.toFixed(4)} SOL`);
          console.log(`  Difference: ${(solBalance - expectedWithFees).toFixed(4)} SOL`);
          console.log(`  Solscan: https://solscan.io/account/${address}\n`);
        }
        
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.log(`Wallet ${i + 1}: Error checking balance - ${error.message}`);
        walletDetails.push({
          index: i + 1,
          address: 'Error',
          expected: expectedWithFees,
          actual: 0,
          difference: -expectedWithFees,
          hasBalance: false
        });
      }
    } catch (error) {
      console.log(`Wallet ${i + 1}: Error decoding private key`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  
  const walletsWithBalance = walletDetails.filter(w => w.hasBalance);
  const totalExpected = walletDetails.reduce((sum, w) => sum + w.expected, 0);
  const totalActual = walletDetails.reduce((sum, w) => sum + w.actual, 0);
  const missingAmount = totalExpected - totalActual - mainBalance;

  console.log(`\nMain Wallet Balance: ${mainBalance.toFixed(4)} SOL`);
  console.log(`Total Expected Distributed: ${totalExpected.toFixed(4)} SOL`);
  console.log(`Total Found in Bundler Wallets: ${totalActual.toFixed(4)} SOL`);
  console.log(`Wallets with Balance: ${walletsWithBalance.length}/${walletsData.length}`);
  
  console.log(`\nAccounted For: ${(mainBalance + totalActual).toFixed(4)} SOL`);
  console.log(`Potentially Missing: ${missingAmount.toFixed(4)} SOL`);

  if (walletsWithBalance.length > 0) {
    console.log('\n' + '='.repeat(60));
    console.log('WALLETS STILL HOLDING SOL');
    console.log('='.repeat(60));
    walletsWithBalance.forEach(w => {
      console.log(`\nWallet ${w.index}:`);
      console.log(`  Address: ${w.address}`);
      console.log(`  Balance: ${w.actual.toFixed(4)} SOL`);
      console.log(`  Link: https://solscan.io/account/${w.address}`);
    });
    
    console.log(`\nTotal SOL in bundler wallets: ${totalActual.toFixed(4)} SOL`);
    console.log(`\nTo collect this SOL, run: npm run gather`);
    console.log(`(Or wait for RPC limits to reset if you got 429 errors)`);
  } else {
    console.log('\nNo bundler wallets found with significant balance.');
    console.log('\nPossible reasons for missing SOL:');
    console.log('1. Transaction fees from failed attempts');
    console.log('2. SOL stuck in failed transactions');
    console.log('3. Already gathered but balance not updated yet');
    console.log('4. Distribution transaction failed before sending SOL');
  }

  console.log('\n' + '='.repeat(60));
  console.log('RECOMMENDATION');
  console.log('='.repeat(60));
  if (walletsWithBalance.length > 0) {
    console.log(`\nFound ${totalActual.toFixed(4)} SOL in ${walletsWithBalance.length} wallets.`);
    console.log('Try running gather again with a premium RPC endpoint to collect it.');
  } else {
    console.log('\nCheck transaction history on Solscan for your main wallet:');
    console.log(`https://solscan.io/account/${mainAddress}`);
    console.log('\nLook for failed distribution transactions that may have consumed fees.');
  }
}

comprehensiveCheck().catch(console.error);

