// Check each wallet individually for SOL balance
require('dotenv').config();
const base58 = require('bs58');
const { Keypair, Connection, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
const RPC_WEBSOCKET_ENDPOINT = process.env.RPC_WEBSOCKET_ENDPOINT || 'wss://api.mainnet-beta.solana.com';

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: "confirmed"
});

const keysPath = path.join(__dirname, 'keys', 'data.json');
const walletsData = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));

console.log('='.repeat(80));
console.log('CHECKING EACH WALLET FOR SOL BALANCE');
console.log('='.repeat(80));
console.log(`Total wallets to check: ${walletsData.length}\n`);

async function checkEachWallet() {
  let totalSolFound = 0;
  let walletsWithSol = [];
  let walletsChecked = 0;
  
  for (let i = 0; i < walletsData.length; i++) {
    try {
      const privateKey = walletsData[i];
      const kp = Keypair.fromSecretKey(base58.decode(privateKey));
      const address = kp.publicKey.toBase58();
      
      console.log(`Checking Wallet ${i + 1}/${walletsData.length}...`);
      console.log(`  Address: ${address}`);
      
      try {
        const balance = await connection.getBalance(kp.publicKey);
        const solBal = balance / LAMPORTS_PER_SOL;
        walletsChecked++;
        
        console.log(`  Balance: ${solBal.toFixed(6)} SOL`);
        console.log(`  Solscan: https://solscan.io/account/${address}`);
        
        if (solBal > 0.0001) { // More than 0.0001 SOL
          walletsWithSol.push({
            index: i + 1,
            address: address,
            balance: solBal,
            privateKey: privateKey
          });
          totalSolFound += solBal;
          console.log(`  ✅ HAS SOL`);
        } else {
          console.log(`  ⚪ Empty or minimal balance`);
        }
        
      } catch (balanceError) {
        console.log(`  ❌ Error checking balance: ${balanceError.message}`);
        if (balanceError.message.includes('429')) {
          console.log(`  ⚠️  Rate limit hit. Waiting 3 seconds...`);
          await new Promise(r => setTimeout(r, 3000));
        }
      }
      
      console.log(''); // Empty line for readability
      
      // Small delay between checks to avoid rate limits
      await new Promise(r => setTimeout(r, 300));
      
    } catch (error) {
      console.error(`❌ Error processing wallet ${i + 1}: ${error.message}\n`);
    }
  }
  
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Wallets checked: ${walletsChecked}/${walletsData.length}`);
  console.log(`Wallets with SOL: ${walletsWithSol.length}`);
  console.log(`Total SOL found: ${totalSolFound.toFixed(6)} SOL\n`);
  
  if (walletsWithSol.length > 0) {
    console.log('Wallets with SOL:');
    walletsWithSol.forEach(w => {
      console.log(`  Wallet ${w.index}: ${w.balance.toFixed(6)} SOL - ${w.address}`);
    });
    console.log(`\n💡 To gather this SOL, run: npm run manual-gather`);
  } else {
    console.log('✅ All wallets are empty (or have minimal balance < 0.0001 SOL)');
    console.log('\nIf you expected SOL in these wallets, it may have been:');
    console.log('  1. Already gathered');
    console.log('  2. Spent on transaction fees');
    console.log('  3. Used to buy tokens (check token balances)');
  }
  
  console.log('='.repeat(80));
}

checkEachWallet().catch(console.error);

