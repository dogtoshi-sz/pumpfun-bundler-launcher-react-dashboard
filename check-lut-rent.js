// Check LUT rent - READ ONLY
require('dotenv').config();
const { PublicKey, Connection } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_ENDPOINT, 'confirmed');

const lutPath = path.join(__dirname, 'keys', 'lut.json');
const lutData = JSON.parse(fs.readFileSync(lutPath, 'utf-8'));
const lutAddress = lutData[0];

console.log('='.repeat(60));
console.log('CHECKING LUT RENT');
console.log('='.repeat(60));
console.log(`\nLUT Address: ${lutAddress}`);
console.log(`Solscan: https://solscan.io/account/${lutAddress}\n`);

async function checkLUT() {
  try {
    const lutPubkey = new PublicKey(lutAddress);
    const balance = await connection.getBalance(lutPubkey);
    const solBalance = balance / 1e9;
    
    console.log(`LUT Balance (Rent): ${solBalance.toFixed(4)} SOL`);
    
    if (solBalance > 0.001) {
      console.log(`\n⚠️  FOUND ${solBalance.toFixed(4)} SOL locked in LUT rent!`);
      console.log(`\nTo reclaim this SOL:`);
      console.log(`1. Run: npm run close`);
      console.log(`2. Wait 250 seconds for cooldown`);
      console.log(`3. The SOL will be returned to your main wallet`);
    } else {
      console.log(`LUT appears to be closed or has minimal rent`);
    }
    
    // Check LUT status
    try {
      const lutInfo = await connection.getAddressLookupTable(lutPubkey);
      if (lutInfo.value) {
        console.log(`\nLUT Status: Active`);
        console.log(`Number of addresses: ${lutInfo.value.addresses.length}`);
      } else {
        console.log(`\nLUT Status: Not found (may be deactivated/closed)`);
      }
    } catch (e) {
      console.log(`\nCould not fetch LUT info: ${e.message}`);
    }
    
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
}

checkLUT();

