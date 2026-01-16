import * as readline from 'readline';
import { Keypair, PublicKey } from "@solana/web3.js";
import base58 from "bs58";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { startVolumeMaker } from "./volume-maker";
import { gatherLastWallets } from "./gather-last-wallets";
import {
  VOLUME_MAKER_DURATION_MINUTES,
  VOLUME_MAKER_MIN_INTERVAL_SECONDS,
  VOLUME_MAKER_MAX_INTERVAL_SECONDS,
  VOLUME_MAKER_MIN_BUY_AMOUNT,
  VOLUME_MAKER_MAX_BUY_AMOUNT,
  VOLUME_MAKER_MIN_SELL_PERCENTAGE,
  VOLUME_MAKER_MAX_SELL_PERCENTAGE,
  VOLUME_MAKER_WALLET_COUNT
} from "../constants";

const execAsync = promisify(exec);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function displayMenu() {
  console.log("\n" + "=".repeat(60));
  console.log("📋 INTERACTIVE MENU - Select an option:");
  console.log("=".repeat(60));
  console.log("  1. 🚀 Run Volume Maker");
  console.log("  2. 📊 Check Bundle Status");
  console.log("  3. 💰 Gather Wallets (Recover SOL from current run)");
  console.log("  4. 💰 Gather All Wallets (Recover SOL from all wallets)");
  console.log("  5. 💰 Gather Last N Wallets (Recover SOL from last N wallets)");
  console.log("  6. 📈 Check Token Status");
  console.log("  7. 🔄 Rapid Sell Tokens (sells 100% from all wallets)");
  console.log("  8. 💰 Sell 50% of Wallets (sells 100% from half, keeps other half)");
  console.log("  9. 💰 Sell Remaining Wallets (sells kept wallets + dev wallet)");
  console.log("  10. 📝 View Current Run Info");
  console.log("  11. 💰 Collect Pump.fun Creator Fees");
  console.log("  0. ❌ Exit");
  console.log("=".repeat(60));
}

async function runVolumeMaker() {
  const currentRunPath = path.join(process.cwd(), 'keys', 'current-run.json');
  if (!fs.existsSync(currentRunPath)) {
    console.log("❌ No current-run.json found. Run a launch first.");
    return;
  }

  const currentRunData = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
  if (!currentRunData.mintAddress || !currentRunData.walletKeys) {
    console.log("❌ Invalid current-run.json. Missing mint address or wallets.");
    return;
  }

  const mintAddress = new PublicKey(currentRunData.mintAddress);
  const wallets = currentRunData.walletKeys.map((key: string) => 
    Keypair.fromSecretKey(base58.decode(key))
  );

  console.log(`\n📊 Starting volume maker for ${mintAddress.toBase58()}`);
  console.log(`   Using ${wallets.length} wallets\n`);

  await startVolumeMaker(wallets, mintAddress, {
    enabled: true,
    durationMinutes: VOLUME_MAKER_DURATION_MINUTES,
    minIntervalSeconds: VOLUME_MAKER_MIN_INTERVAL_SECONDS,
    maxIntervalSeconds: VOLUME_MAKER_MAX_INTERVAL_SECONDS,
    minBuyAmount: VOLUME_MAKER_MIN_BUY_AMOUNT,
    maxBuyAmount: VOLUME_MAKER_MAX_BUY_AMOUNT,
    minSellPercentage: VOLUME_MAKER_MIN_SELL_PERCENTAGE,
    maxSellPercentage: VOLUME_MAKER_MAX_SELL_PERCENTAGE,
    walletCount: VOLUME_MAKER_WALLET_COUNT
  });
}

async function runCommand(command: string, description: string) {
  console.log(`\n🔄 Running: ${description}...\n`);
  return new Promise<void>((resolve, reject) => {
    const childProcess = exec(`npm run ${command}`, {
      cwd: process.cwd(),
      env: process.env
    });
    
    // Stream output in real-time
    if (childProcess.stdout) {
      childProcess.stdout.on('data', (data) => {
        process.stdout.write(data);
      });
    }
    
    if (childProcess.stderr) {
      childProcess.stderr.on('data', (data) => {
        process.stderr.write(data);
      });
    }
    
    childProcess.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        console.error(`\n❌ Command exited with code ${code}`);
        resolve(); // Still resolve so menu continues
      }
    });
    
    childProcess.on('error', (error) => {
      console.error(`❌ Error: ${error.message}`);
      reject(error);
    });
  });
}

async function viewCurrentRunInfo() {
  const currentRunPath = path.join(process.cwd(), 'keys', 'current-run.json');
  if (!fs.existsSync(currentRunPath)) {
    console.log("❌ No current-run.json found.");
    return;
  }

  const currentRunData = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
  console.log("\n📝 Current Run Information:");
  console.log("=".repeat(60));
  console.log(`   Mint Address: ${currentRunData.mintAddress || 'N/A'}`);
  console.log(`   Launch Status: ${currentRunData.launchStatus || 'N/A'}`);
  console.log(`   Wallet Count: ${currentRunData.walletKeys?.length || currentRunData.count || 'N/A'}`);
  console.log(`   Timestamp: ${currentRunData.timestamp ? new Date(currentRunData.timestamp).toLocaleString() : 'N/A'}`);
  console.log("=".repeat(60));
}

export async function showInteractiveMenu(): Promise<void> {
  while (true) {
    displayMenu();
    const answer = await question("\n👉 Enter your choice (0-11): ");

    switch (answer.trim()) {
      case '1':
        await runVolumeMaker();
        break;
      case '2':
        await runCommand('check-bundle', 'Check Bundle Status');
        break;
      case '3':
        await runCommand('gather', 'Gather Wallets');
        break;
      case '4':
        await runCommand('gather-all', 'Gather All Wallets');
        break;
      case '5':
        const countStr = await question("Enter number of wallets to gather from (default: 10): ");
        const count = countStr.trim() ? parseInt(countStr.trim()) : 10;
        if (isNaN(count) || count <= 0) {
          console.log("❌ Invalid number. Using default: 10");
          await gatherLastWallets(10);
        } else {
          await gatherLastWallets(count);
        }
        break;
      case '6':
        await runCommand('status', 'Check Token Status');
        break;
      case '7':
        await runCommand('rapid-sell', 'Rapid Sell Tokens');
        break;
      case '8':
        await runCommand('rapid-sell-50-percent', 'Sell 50% of Wallets');
        break;
      case '9':
        await runCommand('rapid-sell-remaining', 'Sell Remaining Wallets');
        break;
      case '10':
        await viewCurrentRunInfo();
        break;
      case '11':
        await runCommand('collect-fees', 'Collect Pump.fun Creator Fees');
        break;
      case '0':
        console.log("\n👋 Goodbye!");
        rl.close();
        return;
      default:
        console.log("\n❌ Invalid choice. Please enter a number between 0-11.");
    }

    if (answer.trim() !== '0') {
      await question("\n⏸️  Press Enter to continue...");
    }
  }
}



