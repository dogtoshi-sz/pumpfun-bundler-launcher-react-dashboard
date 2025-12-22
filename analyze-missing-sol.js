// Detailed analysis of missing SOL - READ ONLY
require('dotenv').config();
const base58 = require('bs58');
const { Keypair, Connection, AddressLookupTableProgram } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_ENDPOINT, 'confirmed');

const mainPrivateKey = process.env.PRIVATE_KEY;
const mainKp = Keypair.fromSecretKey(base58.decode(mainPrivateKey));
const mainAddress = mainKp.publicKey.toBase58();

const keysPath = path.join(__dirname, 'keys', 'data.json');
const walletsData = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));

const SWAP_AMOUNTS = process.env.SWAP_AMOUNTS 
  ? process.env.SWAP_AMOUNTS.split(',').map(s => Number(s.trim()))
  : Array(parseInt(process.env.DISTRIBUTION_WALLETNUM || '10')).fill(Number(process.env.SWAP_AMOUNT || 0.3));

async function analyzeMissing() {
  console.log('='.repeat(70));
  console.log('DETAILED MISSING SOL ANALYSIS');
  console.log('='.repeat(70));
  
  // 1. Check main wallet
  console.log(`\n1. MAIN WALLET: ${mainAddress}`);
  try {
    const mainBal = await connection.getBalance(mainKp.publicKey);
    console.log(`   Balance: ${(mainBal / 1e9).toFixed(4)} SOL`);
  } catch (e) {
    console.log(`   Error: ${e.message}`);
  }

  // 2. Check LUT rent
  console.log(`\n2. CHECKING LUT RENT...`);
  const lutPath = path.join(__dirname, 'keys', 'lut.json');
  if (fs.existsSync(lutPath)) {
    const lutData = JSON.parse(fs.readFileSync(lutPath, 'utf-8'));
    if (lutData.length > 0) {
      const lutAddress = lutData[0];
      console.log(`   LUT Address: ${lutAddress}`);
      try {
        const lutInfo = await connection.getAddressLookupTable(new (await import('@solana/web3.js')).PublicKey(lutAddress));
        if (lutInfo.value) {
          const rent = await connection.getBalance(new (await import('@solana/web3.js')).PublicKey(lutAddress));
          console.log(`   LUT Rent Locked: ${(rent / 1e9).toFixed(4)} SOL`);
          console.log(`   ⚠️  This rent can be reclaimed with: npm run close`);
          console.log(`   Solscan: https://solscan.io/account/${lutAddress}`);
        } else {
          console.log(`   LUT not found (may be closed)`);
        }
      } catch (e) {
        console.log(`   Error checking LUT: ${e.message}`);
      }
    }
  }

  // 3. Calculate expected distribution
  console.log(`\n3. EXPECTED DISTRIBUTION CALCULATION...`);
  const expectedPerWallet = SWAP_AMOUNTS.map(amt => amt + 0.01); // Buy amount + 0.01 fee buffer
  const totalExpectedDistributed = expectedPerWallet.reduce((sum, amt) => sum + amt, 0);
  console.log(`   Wallets: ${SWAP_AMOUNTS.length}`);
  console.log(`   Expected per wallet: ${expectedPerWallet.map(a => a.toFixed(2)).join(', ')} SOL`);
  console.log(`   Total Expected Distributed: ${totalExpectedDistributed.toFixed(4)} SOL`);

  // 4. Check all bundler wallets
  console.log(`\n4. VERIFYING ALL BUNDLER WALLETS HAVE 0 BALANCE...`);
  let walletsWithBalance = [];
  for (let i = 0; i < walletsData.length; i++) {
    try {
      const kp = Keypair.fromSecretKey(base58.decode(walletsData[i]));
      const balance = await connection.getBalance(kp.publicKey);
      const solBal = balance / 1e9;
      if (solBal > 0.001) {
        walletsWithBalance.push({ index: i + 1, address: kp.publicKey.toBase58(), balance: solBal });
        console.log(`   ⚠️  Wallet ${i + 1} still has ${solBal.toFixed(4)} SOL`);
      }
      await new Promise(r => setTimeout(r, 100));
    } catch (e) {
      console.log(`   Wallet ${i + 1}: Error - ${e.message}`);
    }
  }

  if (walletsWithBalance.length === 0) {
    console.log(`   ✅ All bundler wallets confirmed at 0 SOL`);
  }

  // 5. Calculate missing amount
  console.log(`\n5. MISSING SOL ANALYSIS...`);
  console.log(`   Expected Distributed: ${totalExpectedDistributed.toFixed(4)} SOL`);
  console.log(`   Missing: ~0.75 SOL`);
  console.log(`\n   Possible locations:`);
  console.log(`   a) LUT Rent: Check above`);
  console.log(`   b) Transaction Fees: Failed transactions consume fees`);
  console.log(`   c) Failed Distribution: Transaction sent but partially failed`);
  console.log(`   d) Token Account Rent: If tokens were created, rent may be locked`);

  // 6. Check transaction history suggestion
  console.log(`\n6. RECOMMENDATION:`);
  console.log(`   Check your main wallet transaction history:`);
  console.log(`   https://solscan.io/account/${mainAddress}`);
  console.log(`\n   Look for:`);
  console.log(`   - Failed distribution transactions`);
  console.log(`   - Multiple distribution attempts`);
  console.log(`   - Transaction fees from retries`);
  console.log(`   - Any outgoing transfers around the time you ran the bundler`);

  console.log(`\n` + '='.repeat(70));
}

analyzeMissing().catch(console.error);

