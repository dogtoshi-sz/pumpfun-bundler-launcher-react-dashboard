import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import base58 from "bs58";
import { RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, PRIVATE_KEY } from "./constants";

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: "confirmed"
});

/**
 * Collect creator fees using PumpPortal API
 * Collects fees for all tokens created by the creator wallet
 */
export async function collectCreatorFees(creatorWallet: Keypair, priorityFee: number = 0.000001): Promise<boolean> {
  try {
    console.log(`\n💰 Collecting creator fees via PumpPortal...`);
    console.log(`   Creator wallet: ${creatorWallet.publicKey.toBase58()}`);
    console.log(`   Priority fee: ${priorityFee} SOL\n`);

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

  // Get creator wallet (main wallet from .env)
  const creatorWallet = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY));
  
  // Collect fees (collects for all tokens created by this wallet)
  await collectCreatorFees(creatorWallet);
}

main().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});


