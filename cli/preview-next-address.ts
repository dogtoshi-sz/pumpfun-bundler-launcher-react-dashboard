// Preview script to show which pump address will be used on next launch
// Usage: npx ts-node preview-next-address.ts

import dotenv from 'dotenv';
import { Keypair } from '@solana/web3.js';
import base58 from 'bs58';
import { getNextPumpAddress, generateVanityAddress } from '../utils/utils';
import { VANITY_MODE } from '../constants';

dotenv.config();

async function previewNextAddress() {
  console.log('\n🔍 PREVIEW: Next Pump Address That Will Be Used\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Priority order (same as index.ts):
  // 1. MINT_PRIVATE_KEY env variable
  // 2. Pump address pool (pregenerated pump addresses)
  // 3. Vanity mode (generate new with "pump" suffix)
  // 4. Generate new random keypair (default)

  if (process.env.MINT_PRIVATE_KEY) {
    console.log('📌 Priority 1: MINT_PRIVATE_KEY is set in .env');
    try {
      const mintKp = Keypair.fromSecretKey(base58.decode(process.env.MINT_PRIVATE_KEY));
      console.log(`   ✅ Address: ${mintKp.publicKey.toBase58()}`);
      console.log(`   📝 Source: MINT_PRIVATE_KEY environment variable`);
    } catch (error: any) {
      console.log(`   ❌ Error: Invalid MINT_PRIVATE_KEY - ${error.message}`);
    }
  } else {
    console.log('📌 Priority 1: MINT_PRIVATE_KEY not set (skipping)');
    
    // Try pump address pool
    console.log('\n📌 Priority 2: Checking pump-addresses.json pool...');
    const pumpAddress = getNextPumpAddress();
    if (pumpAddress) {
      console.log(`   ✅ Address: ${pumpAddress.publicKey}`);
      console.log(`   📝 Source: Pre-generated pump address from pool`);
      console.log(`   ⚠️  Note: This address will be marked as "used" after successful launch`);
    } else {
      console.log('   ❌ No available addresses in pool');
      
      // Try vanity mode
      if (VANITY_MODE) {
        console.log('\n📌 Priority 3: VANITY_MODE is enabled');
        console.log('   ⚠️  Will generate NEW vanity address with "pump" suffix');
        console.log('   ⏳ This will take time to generate (can be minutes)...');
        console.log('   💡 Tip: Pre-generate addresses with: npm run generate-pump');
      } else {
        console.log('\n📌 Priority 3: VANITY_MODE is disabled (skipping)');
        console.log('\n📌 Priority 4: Will generate NEW random keypair');
        console.log('   ⚠️  Address: Will be randomly generated (not a pump address)');
        console.log('   💡 Tip: Use pump-addresses.json pool or enable VANITY_MODE for pump addresses');
      }
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

previewNextAddress().catch(console.error);

