// Comprehensive SOL location finder - READ ONLY
require('dotenv').config();
const base58 = require('bs58');
const { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_ENDPOINT, 'confirmed');

const mainPrivateKey = process.env.PRIVATE_KEY;
const mainKp = Keypair.fromSecretKey(base58.decode(mainPrivateKey));
const mainAddress = mainKp.publicKey.toBase58();

console.log('='.repeat(70));
console.log('COMPREHENSIVE SOL LOCATION FINDER');
console.log('='.repeat(70));

async function findAllSol() {
  let totalFound = 0;
  
  // 1. Main wallet
  console.log(`\n1. MAIN WALLET`);
  try {
    const mainBal = await connection.getBalance(mainKp.publicKey);
    const mainSol = mainBal / LAMPORTS_PER_SOL;
    totalFound += mainSol;
    console.log(`   Address: ${mainAddress}`);
    console.log(`   Balance: ${mainSol.toFixed(4)} SOL`);
    console.log(`   Solscan: https://solscan.io/account/${mainAddress}`);
  } catch (e) {
    console.log(`   Error: ${e.message}`);
  }

  // 2. LUT rent
  console.log(`\n2. LUT RENT (Address Lookup Table)`);
  const lutPath = path.join(__dirname, 'keys', 'lut.json');
  if (fs.existsSync(lutPath)) {
    try {
      const lutData = JSON.parse(fs.readFileSync(lutPath, 'utf-8'));
      if (lutData.length > 0) {
        const lutAddress = lutData[0];
        const lutPubkey = new PublicKey(lutAddress);
        const lutBal = await connection.getBalance(lutPubkey);
        const lutSol = lutBal / LAMPORTS_PER_SOL;
        totalFound += lutSol;
        console.log(`   Address: ${lutAddress}`);
        console.log(`   Balance: ${lutSol.toFixed(4)} SOL`);
        console.log(`   Solscan: https://solscan.io/account/${lutAddress}`);
        if (lutSol > 0.001) {
          console.log(`   ⚠️  This rent can be reclaimed with: npm run close`);
        }
      } else {
        console.log(`   No LUT found in lut.json`);
      }
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
  } else {
    console.log(`   No lut.json file found`);
  }

  // 3. Bundler wallets
  console.log(`\n3. BUNDLER WALLETS`);
  const keysPath = path.join(__dirname, 'keys', 'data.json');
  if (fs.existsSync(keysPath)) {
    const walletsData = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
    let bundlerTotal = 0;
    let walletsWithSol = 0;
    
    for (let i = 0; i < walletsData.length; i++) {
      try {
        const kp = Keypair.fromSecretKey(base58.decode(walletsData[i]));
        const balance = await connection.getBalance(kp.publicKey);
        const solBal = balance / LAMPORTS_PER_SOL;
        bundlerTotal += solBal;
        if (solBal > 0.001) {
          walletsWithSol++;
          console.log(`   Wallet ${i + 1}: ${solBal.toFixed(4)} SOL - ${kp.publicKey.toBase58()}`);
        }
        await new Promise(r => setTimeout(r, 50)); // Rate limit protection
      } catch (e) {
        console.log(`   Wallet ${i + 1}: Error - ${e.message}`);
      }
    }
    totalFound += bundlerTotal;
    console.log(`   Total in bundler wallets: ${bundlerTotal.toFixed(4)} SOL`);
    if (walletsWithSol === 0) {
      console.log(`   ✅ All bundler wallets confirmed at 0 SOL`);
    }
  } else {
    console.log(`   No data.json file found`);
  }

  // 4. Token account (if token was created)
  console.log(`\n4. TOKEN ACCOUNT RENT`);
  const mintPath = path.join(__dirname, 'keys', 'mint.json');
  if (fs.existsSync(mintPath)) {
    try {
      const mintData = JSON.parse(fs.readFileSync(mintPath, 'utf-8'));
      if (mintData.length > 0) {
        const mintAddress = mintData[0];
        console.log(`   Mint Address: ${mintAddress}`);
        console.log(`   Solscan: https://solscan.io/token/${mintAddress}`);
        console.log(`   Note: Token account rent is minimal (~0.002 SOL per account)`);
      }
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
  }

  // 5. Summary
  console.log(`\n` + '='.repeat(70));
  console.log(`SUMMARY`);
  console.log('='.repeat(70));
  console.log(`Total SOL found across all locations: ${totalFound.toFixed(4)} SOL`);
  
  // Calculate expected
  const SWAP_AMOUNTS = process.env.SWAP_AMOUNTS 
    ? process.env.SWAP_AMOUNTS.split(',').map(s => Number(s.trim()))
    : Array(parseInt(process.env.DISTRIBUTION_WALLETNUM || '10')).fill(Number(process.env.SWAP_AMOUNT || 0.3));
  
  const expectedDistributed = SWAP_AMOUNTS.reduce((sum, amt) => sum + amt + 0.01, 0);
  const initialFees = 0.04 + parseFloat(process.env.JITO_FEE || '0.001');
  const expectedTotal = expectedDistributed + initialFees;
  
  console.log(`\nExpected total needed: ~${expectedTotal.toFixed(4)} SOL`);
  console.log(`(Distribution: ${expectedDistributed.toFixed(4)} SOL + Initial fees: ${initialFees.toFixed(4)} SOL)`);
  
  console.log(`\n💡 If SOL is missing:`);
  console.log(`   1. Check transaction history: https://solscan.io/account/${mainAddress}`);
  console.log(`   2. Look for failed transactions that consumed fees`);
  console.log(`   3. Reclaim LUT rent if available: npm run close`);
  console.log(`   4. Transaction fees from retries can add up`);
  
  console.log('='.repeat(70));
}

findAllSol().catch(console.error);

