import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import base58 from "bs58";
import fs from "fs";
import path from "path";
import { RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, BUYER_WALLET } from "../constants";

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: "confirmed"
});

/**
 * Collect creator fees using PumpPortal API
 * Collects fees for all tokens created by the creator wallet
 */
export async function collectCreatorFees(creatorWallet: Keypair, priorityFee: number = 0): Promise<boolean> {
  try {
    console.log(`\n💰 Collecting creator fees via PumpPortal...`);
    console.log(`   Creator/DEV wallet: ${creatorWallet.publicKey.toBase58()}`);
    console.log(`   (Fees go to creator wallet - this is correct for pump.fun)`);
    console.log(`   Priority fee: ${priorityFee} SOL (cheapest - no priority fee)\n`);

    const response = await fetch(`https://pumpportal.fun/api/trade-local`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        "publicKey": creatorWallet.publicKey.toBase58(),
        "action": "collectCreatorFee",
        "priorityFee": priorityFee,
      })
    });

    if (response.status === 200) {
      // Successfully generated transaction
      const data = await response.arrayBuffer();
      const tx = VersionedTransaction.deserialize(new Uint8Array(data));
      
      // Sign the transaction
      tx.sign([creatorWallet]);
      
      // Send the transaction
      const signature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        maxRetries: 3
      });
      
      // Wait for confirmation
      await connection.confirmTransaction(signature, "confirmed");
      
      console.log(`   ✅ Creator fees collected successfully!`);
      console.log(`   📍 Transaction: https://solscan.io/tx/${signature}`);
      return true;
    } else {
      const errorText = await response.text();
      console.log(`   ❌ PumpPortal API error (${response.status}): ${errorText}`);
      
      // Check if there are no fees to collect
      if (response.status === 400 || response.status === 404) {
        console.log(`   ℹ️  No fees available to collect (or already collected)`);
      }
      
      return false;
    }
  } catch (error: any) {
    console.error(`   ❌ Error collecting creator fees: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log("💰 Pump.fun Creator Fee Collector\n");

  // Get creator wallet - PRIORITY: current-run.json (for auto-created wallets), FALLBACK: BUYER_WALLET from .env
  let creatorWallet: Keypair;
  let walletSource: string;
  
  const currentRunPath = path.join(process.cwd(), 'keys', 'current-run.json');
  if (fs.existsSync(currentRunPath)) {
    try {
      const currentRunData = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
      if (currentRunData.creatorDevWalletKey) {
        // Use auto-created DEV wallet from current-run.json
        creatorWallet = Keypair.fromSecretKey(base58.decode(currentRunData.creatorDevWalletKey));
        walletSource = 'current-run.json (auto-created DEV wallet)';
        console.log(`   ✅ Found auto-created DEV wallet in current-run.json`);
      } else if (BUYER_WALLET && BUYER_WALLET.trim() !== '') {
        // Fallback to BUYER_WALLET from .env
        creatorWallet = Keypair.fromSecretKey(base58.decode(BUYER_WALLET));
        walletSource = 'BUYER_WALLET env var';
        console.log(`   ⚠️  No creatorDevWalletKey in current-run.json, using BUYER_WALLET from .env`);
      } else {
        throw new Error('No creator wallet found in current-run.json and BUYER_WALLET not set in .env');
      }
    } catch (error: any) {
      // If reading current-run.json fails, fallback to BUYER_WALLET
      if (BUYER_WALLET && BUYER_WALLET.trim() !== '') {
        creatorWallet = Keypair.fromSecretKey(base58.decode(BUYER_WALLET));
        walletSource = 'BUYER_WALLET env var (fallback)';
        console.log(`   ⚠️  Error reading current-run.json: ${error.message}`);
        console.log(`   Using BUYER_WALLET from .env as fallback`);
      } else {
        throw new Error(`Failed to get creator wallet: ${error.message}`);
      }
    }
  } else {
    // No current-run.json, use BUYER_WALLET from .env
    if (!BUYER_WALLET || BUYER_WALLET.trim() === '') {
      throw new Error('No current-run.json found and BUYER_WALLET not set in .env. Cannot determine creator wallet.');
    }
    creatorWallet = Keypair.fromSecretKey(base58.decode(BUYER_WALLET));
    walletSource = 'BUYER_WALLET env var';
    console.log(`   ⚠️  No current-run.json found, using BUYER_WALLET from .env`);
  }
  
  console.log(`   Using creator/DEV wallet: ${creatorWallet.publicKey.toBase58()}`);
  console.log(`   Source: ${walletSource}`);
  console.log(`   (This wallet collects fees for tokens it created)\n`);
  
  // Collect fees (collects for all tokens created by this wallet)
  await collectCreatorFees(creatorWallet);
}

main().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});


