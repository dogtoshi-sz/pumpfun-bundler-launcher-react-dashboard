import { Keypair, PublicKey } from "@solana/web3.js";
import base58 from "bs58";
import fs from "fs";
import path from "path";
import { startVolumeMaker } from "./volume-maker";
import {
  VOLUME_MAKER_ENABLED,
  VOLUME_MAKER_DURATION_MINUTES,
  VOLUME_MAKER_MIN_INTERVAL_SECONDS,
  VOLUME_MAKER_MAX_INTERVAL_SECONDS,
  VOLUME_MAKER_MIN_BUY_AMOUNT,
  VOLUME_MAKER_MAX_BUY_AMOUNT,
  VOLUME_MAKER_MIN_SELL_PERCENTAGE,
  VOLUME_MAKER_MAX_SELL_PERCENTAGE,
  VOLUME_MAKER_WALLET_COUNT
} from "../constants";

// Get command line arguments
const args = process.argv.slice(2);
const mintAddressArg = args.find(arg => arg.startsWith('--mint='))?.split('=')[1];
const durationArg = args.find(arg => arg.startsWith('--duration='))?.split('=')[1];

async function main() {
  console.log("📊 Volume Maker - Standalone Runner\n");

  // Get mint address
  let mintAddress: PublicKey;
  if (mintAddressArg) {
    try {
      mintAddress = new PublicKey(mintAddressArg);
      console.log(`✅ Using mint address from argument: ${mintAddress.toBase58()}`);
    } catch (error) {
      console.error("❌ Invalid mint address provided");
      process.exit(1);
    }
  } else {
    // Try to read from current-run.json
    const currentRunPath = path.join(process.cwd(), 'keys', 'current-run.json');
    if (fs.existsSync(currentRunPath)) {
      try {
        const currentRunData = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
        if (currentRunData.mintAddress) {
          mintAddress = new PublicKey(currentRunData.mintAddress);
          console.log(`✅ Using mint address from current-run.json: ${mintAddress.toBase58()}`);
        } else {
          console.error("❌ No mint address found in current-run.json");
          console.log("   Usage: ts-node run-volume-maker.ts --mint=<MINT_ADDRESS> [--duration=<MINUTES>]");
          process.exit(1);
        }
      } catch (error) {
        console.error("❌ Error reading current-run.json:", error);
        process.exit(1);
      }
    } else {
      console.error("❌ No mint address provided and current-run.json not found");
      console.log("   Usage: ts-node run-volume-maker.ts --mint=<MINT_ADDRESS> [--duration=<MINUTES>]");
      process.exit(1);
    }
  }

  // Get wallets
  const currentRunPath = path.join(process.cwd(), 'keys', 'current-run.json');
  let wallets: Keypair[] = [];

  if (fs.existsSync(currentRunPath)) {
    try {
      const currentRunData = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
      if (currentRunData.walletKeys && Array.isArray(currentRunData.walletKeys)) {
        wallets = currentRunData.walletKeys.map((key: string) => 
          Keypair.fromSecretKey(base58.decode(key))
        );
        console.log(`✅ Loaded ${wallets.length} wallets from current-run.json`);
      } else {
        console.error("❌ No walletKeys found in current-run.json");
        process.exit(1);
      }
    } catch (error) {
      console.error("❌ Error reading current-run.json:", error);
      process.exit(1);
    }
  } else {
    console.error("❌ current-run.json not found");
    console.log("   Make sure you've run a token launch first, or provide wallet keys manually");
    process.exit(1);
  }

  if (wallets.length === 0) {
    console.error("❌ No wallets found");
    process.exit(1);
  }

  // Get duration (override from env if provided)
  const durationMinutes = durationArg ? Number(durationArg) : VOLUME_MAKER_DURATION_MINUTES;

  // Configuration
  const config = {
    enabled: true,
    durationMinutes: durationMinutes,
    minIntervalSeconds: VOLUME_MAKER_MIN_INTERVAL_SECONDS,
    maxIntervalSeconds: VOLUME_MAKER_MAX_INTERVAL_SECONDS,
    minBuyAmount: VOLUME_MAKER_MIN_BUY_AMOUNT,
    maxBuyAmount: VOLUME_MAKER_MAX_BUY_AMOUNT,
    minSellPercentage: VOLUME_MAKER_MIN_SELL_PERCENTAGE,
    maxSellPercentage: VOLUME_MAKER_MAX_SELL_PERCENTAGE,
    walletCount: VOLUME_MAKER_WALLET_COUNT
  };

  console.log("\n📋 Configuration:");
  console.log(`   Mint Address: ${mintAddress.toBase58()}`);
  console.log(`   Total Wallets: ${wallets.length}`);
  console.log(`   Duration: ${config.durationMinutes} minutes`);
  console.log(`   Interval: ${config.minIntervalSeconds}-${config.maxIntervalSeconds} seconds`);
  console.log(`   Buy Range: ${config.minBuyAmount}-${config.maxBuyAmount} SOL`);
  console.log(`   Sell Range: ${config.minSellPercentage}-${config.maxSellPercentage}%`);
  console.log(`   Using: ${config.walletCount} wallets\n`);

  // Start volume maker
  await startVolumeMaker(wallets, mintAddress, config);
}

main().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});


