import * as readline from 'readline';
import { Keypair } from "@solana/web3.js";
import base58 from "bs58";
import fs from "fs";
import path from "path";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import dotenv from 'dotenv';

dotenv.config();

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

// Read .env config
function readEnvConfig() {
  const envPath = path.join(process.cwd(), '.env');
  const config: any = {};
  
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const lines = envContent.split('\n');
    lines.forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match && !match[1].trim().startsWith('#')) {
        const key = match[1].trim();
        let value = match[2].trim();
        // Remove inline comments (everything after #)
        const commentIndex = value.indexOf('#');
        if (commentIndex !== -1) {
          value = value.substring(0, commentIndex).trim();
        }
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        config[key] = value;
      }
    });
  }
  
  return config;
}

// Get next pump address
function getNextPumpAddress(): string | null {
  try {
    const pumpAddressesPath = path.join(process.cwd(), 'keys', 'pump-addresses.json');
    if (!fs.existsSync(pumpAddressesPath)) {
      return null;
    }
    
    const data = fs.readFileSync(pumpAddressesPath, 'utf-8');
    const addresses = JSON.parse(data);
    
    const available = addresses.find((addr: any) => 
      addr.status === 'available' && !addr.used
    );
    
    return available ? available.publicKey : null;
  } catch (error) {
    return null;
  }
}

// Display current settings
function displayCurrentSettings() {
  const config = readEnvConfig();
  const nextPumpAddress = getNextPumpAddress();
  
  console.log("\n" + "=".repeat(80));
  console.log("📋 CURRENT TOKEN LAUNCH SETTINGS");
  console.log("=".repeat(80));
  
  // Token Info
  console.log("\n🪙 TOKEN INFORMATION:");
  console.log(`   Name: ${config.TOKEN_NAME || 'Not set'}`);
  console.log(`   Symbol: ${config.TOKEN_SYMBOL || 'Not set'}`);
  console.log(`   Show Name: ${config.TOKEN_SHOW_NAME || config.TOKEN_NAME || 'Not set'}`);
  console.log(`   Description: ${(config.DESCRIPTION || 'Not set').substring(0, 60)}${(config.DESCRIPTION || '').length > 60 ? '...' : ''}`);
  console.log(`   Twitter: ${config.TWITTER || 'Not set'}`);
  console.log(`   Telegram: ${config.TELEGRAM || 'Not set'}`);
  console.log(`   Website: ${config.WEBSITE || 'Not set'}`);
  
  // Pump Address
  console.log("\n🎯 PUMP FUN ADDRESS:");
  if (nextPumpAddress) {
    console.log(`   ✅ Next Available: ${nextPumpAddress}`);
  } else {
    console.log(`   ⚠️  No available pump addresses found`);
  }
  
  // Bundle Wallets
  console.log("\n📦 BUNDLE WALLETS:");
  const bundleCount = parseInt(config.BUNDLE_WALLET_COUNT || '0');
  const bundleAmounts = (config.BUNDLE_SWAP_AMOUNTS || '').split(',').map((s: string) => s.trim()).filter((s: string) => s);
  console.log(`   Count: ${bundleCount}`);
  if (bundleAmounts.length > 0) {
    console.log(`   Amounts: ${bundleAmounts.join(', ')} SOL`);
    const totalBundle = bundleAmounts.reduce((sum: number, amt: string) => sum + parseFloat(amt || '0'), 0);
    console.log(`   Total: ${totalBundle.toFixed(4)} SOL`);
  } else {
    const defaultAmount = parseFloat(config.SWAP_AMOUNT || '0.3');
    console.log(`   Amount: ${defaultAmount} SOL each (default)`);
    console.log(`   Total: ${(defaultAmount * bundleCount).toFixed(4)} SOL`);
  }
  
  // Holder Wallets
  console.log("\n👥 HOLDER WALLETS:");
  const holderCount = parseInt(config.HOLDER_WALLET_COUNT || '0');
  const holderAmount = parseFloat(config.HOLDER_WALLET_AMOUNT || '0.01');
  const holderAmounts = (config.HOLDER_SWAP_AMOUNTS || '').split(',').map((s: string) => s.trim()).filter((s: string) => s);
  console.log(`   Count: ${holderCount} (MANUAL ONLY - will NOT auto-buy)`);
  if (holderAmounts.length > 0) {
    console.log(`   Amounts: ${holderAmounts.join(', ')} SOL`);
    const totalHolder = holderAmounts.reduce((sum: number, amt: string) => sum + parseFloat(amt || '0'), 0);
    console.log(`   Total: ${totalHolder.toFixed(4)} SOL`);
  } else {
    console.log(`   Amount: ${holderAmount} SOL each`);
    console.log(`   Total: ${(holderAmount * holderCount).toFixed(4)} SOL`);
  }
  
  // DEV Buy
  console.log("\n💰 DEV BUY:");
  const buyerAmount = parseFloat(config.BUYER_AMOUNT || '0.1');
  console.log(`   Amount: ${buyerAmount} SOL`);
  
  // Options
  console.log("\n⚙️  OPTIONS:");
  console.log(`   Vanity Mode: ${config.VANITY_MODE === 'true' ? '✅ Enabled' : '❌ Disabled'}`);
  console.log(`   Lil Jit Mode: ${config.LIL_JIT_MODE === 'true' ? '✅ Enabled' : '❌ Disabled'}`);
  
  // Auto Actions
  console.log("\n🤖 AUTO ACTIONS:");
  console.log(`   Auto Rapid Sell: ${config.AUTO_RAPID_SELL === 'true' ? '✅ Enabled' : '❌ Disabled'}`);
  console.log(`   Auto Sell 50%: ${config.AUTO_SELL_50_PERCENT === 'true' ? '✅ Enabled' : '❌ Disabled'}`);
  console.log(`   Auto Gather: ${config.AUTO_GATHER === 'true' ? '✅ Enabled' : '❌ Disabled'}`);
  console.log(`   Auto Collect Fees: ${config.AUTO_COLLECT_FEES === 'true' ? '✅ Enabled' : '❌ Disabled'}`);
  
  // WebSocket Tracking
  console.log("\n🌐 WEBSOCKET TRACKING:");
  const wsEnabled = config.WEBSOCKET_TRACKING_ENABLED === 'true' || config.WEBSOCKET_TRACKING_ENABLED === '1';
  console.log(`   Enabled: ${wsEnabled ? '✅ Yes' : '❌ No'}`);
  if (wsEnabled) {
    const ultraFast = config.WEBSOCKET_ULTRA_FAST_MODE === 'true' || config.WEBSOCKET_ULTRA_FAST_MODE === '1';
    console.log(`   Ultra Fast Mode: ${ultraFast ? '✅ Enabled' : '❌ Disabled'}`);
    console.log(`   External Buy Threshold: ${config.WEBSOCKET_EXTERNAL_BUY_THRESHOLD || '1.0'} SOL`);
    console.log(`   External Buy Window: ${config.WEBSOCKET_EXTERNAL_BUY_WINDOW || '60000'} ms`);
  }
  
  // Staged Sell
  const autoSellStaged = config.AUTO_SELL_STAGED === 'true' || config.AUTO_SELL_STAGED === '1';
  if (autoSellStaged) {
    console.log("\n📊 STAGED SELL:");
    console.log(`   Stage 1: ${config.STAGED_SELL_STAGE1_PERCENTAGE || '0'}% at ${config.STAGED_SELL_STAGE1_THRESHOLD || '0'} SOL`);
    console.log(`   Stage 2: ${config.STAGED_SELL_STAGE2_PERCENTAGE || '0'}% at ${config.STAGED_SELL_STAGE2_THRESHOLD || '0'} SOL`);
    console.log(`   Stage 3: ${config.STAGED_SELL_STAGE3_PERCENTAGE || '0'}% at ${config.STAGED_SELL_STAGE3_THRESHOLD || '0'} SOL`);
  }
  
  // Total SOL Needed
  const bundleTotal = bundleAmounts.length > 0 
    ? bundleAmounts.reduce((sum: number, amt: string) => sum + parseFloat(amt || '0'), 0)
    : parseFloat(config.SWAP_AMOUNT || '0.3') * bundleCount;
  const holderTotal = holderAmounts.length > 0
    ? holderAmounts.reduce((sum: number, amt: string) => sum + parseFloat(amt || '0'), 0)
    : holderAmount * holderCount;
  const totalNeeded = bundleTotal + holderTotal + buyerAmount + 0.05; // + buffer
  
  console.log("\n💵 TOTAL SOL NEEDED:");
  console.log(`   Bundle: ${bundleTotal.toFixed(4)} SOL`);
  console.log(`   Holder: ${holderTotal.toFixed(4)} SOL`);
  console.log(`   DEV Buy: ${buyerAmount.toFixed(4)} SOL`);
  console.log(`   Buffer: 0.0500 SOL`);
  console.log(`   ─────────────────`);
  console.log(`   TOTAL: ${totalNeeded.toFixed(4)} SOL`);
  
  console.log("=".repeat(80));
}

// Display menu options
function displayMenu() {
  console.log("\n" + "=".repeat(80));
  console.log("🎯 MASTER MENU - Select an option:");
  console.log("=".repeat(80));
  console.log("");
  console.log("  🚀 LAUNCHERS:");
  console.log("  1. ⚡ Quick Launch (simple dev buy + Twitter, no Jito)");
  console.log("  2. 🔥 Advanced Launch (bundles, LUTs, Jito - full system)");
  console.log("");
  console.log("  📋 TOOLS:");
  console.log("  3. 📋 Interactive Menu (selling, gathering, etc.)");
  console.log("  4. 👥 Holder Wallet Menu (manual buy/sell with holder wallets)");
  console.log("  5. 📊 Check Bundle Status");
  console.log("  6. 💰 Check Balance");
  console.log("  7. 📈 Check Token Status");
  console.log("  8. 🔄 Refresh Settings Display");
  console.log("");
  console.log("  0. ❌ Exit");
  console.log("=".repeat(80));
}

// Run command in new process (non-interactive)
async function runCommand(command: string, description: string) {
  console.log(`\n🔄 Starting: ${description}...\n`);
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
        console.error(`\n⚠️  Process exited with code ${code}`);
        resolve(); // Still resolve so menu continues
      }
    });
    
    childProcess.on('error', (error) => {
      console.error(`❌ Error: ${error.message}`);
      reject(error);
    });
  });
}

// Run interactive command with proper stdin handling
async function runInteractiveCommand(command: string, description: string) {
  return new Promise<void>((resolve, reject) => {
    // Close the master menu's readline to avoid conflicts with child process
    rl.close();
    
    // Use spawn for interactive commands to properly handle stdin
    // On Windows, need shell: true to find npm
    const isWindows = process.platform === 'win32';
    const childProcess = spawn(isWindows ? 'npm.cmd' : 'npm', ['run', command], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit', // This connects stdin/stdout/stderr directly
      shell: isWindows // Use shell on Windows
    });
    
    childProcess.on('close', (code) => {
      // Recreate readline interface after child exits
      // Note: This means the master menu will exit after running interactive commands
      // User should restart master menu if they want to use it again
      if (code === 0) {
        console.log("\n✅ Command completed. Restart master menu to continue.");
        resolve();
      } else {
        console.error(`\n⚠️  Process exited with code ${code}`);
        resolve(); // Still resolve so menu continues
      }
    });
    
    childProcess.on('error', (error) => {
      console.error(`❌ Error: ${error.message}`);
      reject(error);
    });
  });
}

// Main function
async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🎯 PUMP.FUN BUNDLER - MASTER MENU");
  console.log("=".repeat(80));
  
  // Show current settings first
  displayCurrentSettings();
  
  // Main loop
  while (true) {
    displayMenu();
    const choice = await question("\n👉 Enter your choice (0-8): ");
    
    switch (choice.trim()) {
      case '1':
        console.log("\n⚡ Starting Quick Launch...");
        console.log("   Simple dev buy + Twitter posting (no Jito, no bundles)\n");
        await runInteractiveCommand('quick-launch', 'Quick Launch');
        console.log("\n👋 Master menu closed. Run 'npm run master' to restart.");
        rl.close();
        return;
        
      case '2':
        console.log("\n🔥 Starting Advanced Launch...");
        console.log("   Full system: bundles, LUTs, Jito, holder wallets\n");
        await runInteractiveCommand('start', 'Advanced Launch');
        console.log("\n👋 Master menu closed. Run 'npm run master' to restart.");
        rl.close();
        return;
        
      case '3':
        console.log("\n📋 Opening Interactive Menu...");
        console.log("⚠️  This will close the master menu. Restart it after you're done.\n");
        await runInteractiveCommand('menu', 'Interactive Menu');
        // Exit master menu after interactive command
        console.log("\n👋 Master menu closed. Run 'npm run master' to restart.");
        rl.close();
        return;
        
      case '4':
        console.log("\n👥 Opening Holder Wallet Menu...");
        console.log("⚠️  This will close the master menu. Restart it after you're done.\n");
        await runInteractiveCommand('holder-menu', 'Holder Wallet Menu');
        // Exit master menu after interactive command
        console.log("\n👋 Master menu closed. Run 'npm run master' to restart.");
        rl.close();
        return;
        
      case '5':
        await runCommand('check-bundle', 'Check Bundle Status');
        break;
        
      case '6':
        await runCommand('check-balance', 'Check Balance');
        break;
        
      case '7':
        await runCommand('status', 'Check Token Status');
        break;
        
      case '8':
        displayCurrentSettings();
        break;
        
      case '0':
        console.log("\n👋 Goodbye!");
        rl.close();
        return;
        
      default:
        console.log("\n❌ Invalid choice. Please enter a number between 0-8.");
    }
    
    if (choice.trim() !== '0') {
      await question("\n⏸️  Press Enter to continue...");
    }
  }
}

// Run
main().catch(error => {
  console.error("Fatal error:", error);
  rl.close();
  process.exit(1);
});

