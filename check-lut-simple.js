// Simple LUT rent checker
require('dotenv').config();
const { PublicKey, Connection, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_ENDPOINT, 'confirmed');

const lutPath = path.join(__dirname, 'keys', 'lut.json');
const lutData = JSON.parse(fs.readFileSync(lutPath, 'utf-8'));
const lutAddress = lutData[0];

console.log('Checking LUT Rent...');
console.log(`LUT Address: ${lutAddress}`);
console.log(`Solscan: https://solscan.io/account/${lutAddress}\n`);

connection.getBalance(new PublicKey(lutAddress))
  .then(balance => {
    const sol = balance / LAMPORTS_PER_SOL;
    console.log(`LUT Rent Locked: ${sol.toFixed(6)} SOL`);
    if (sol > 0.001) {
      console.log(`\n⚠️  Found ${sol.toFixed(6)} SOL in LUT rent!`);
      console.log(`\nTo reclaim:`);
      console.log(`1. Run: npm run close`);
      console.log(`2. Wait 250 seconds for cooldown`);
      console.log(`3. SOL will be returned to your main wallet`);
    } else {
      console.log(`LUT appears to be closed or has minimal rent`);
    }
  })
  .catch(error => {
    console.error(`Error: ${error.message}`);
    console.log(`\nCheck manually on Solscan: https://solscan.io/account/${lutAddress}`);
  });

