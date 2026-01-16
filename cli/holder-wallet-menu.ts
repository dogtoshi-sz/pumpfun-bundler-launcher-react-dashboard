import * as readline from 'readline';
import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import base58 from "bs58";
import fs from "fs";
import path from "path";
import { buyTokenSimple, sellTokenSimple } from "./trading-terminal";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { SPL_ACCOUNT_LAYOUT } from "@raydium-io/raydium-sdk";
import dotenv from 'dotenv';

dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

// Get RPC endpoint
const getRpcEndpoint = () => process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
const getConnection = () => new Connection(getRpcEndpoint(), 'confirmed');

// Load current run data
function loadCurrentRun() {
  const currentRunPath = path.join(process.cwd(), 'keys', 'current-run.json');
  if (!fs.existsSync(currentRunPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
}

// Get wallet balance (SOL)
async function getWalletBalance(publicKey: PublicKey): Promise<number> {
  const connection = getConnection();
  const balance = await connection.getBalance(publicKey);
  return balance / 1e9;
}

// Get token balance for a wallet
async function getTokenBalance(publicKey: PublicKey, mintAddress: string): Promise<number> {
  try {
    const connection = getConnection();
    const tokenAccounts = await connection.getTokenAccountsByOwner(publicKey, {
      programId: TOKEN_PROGRAM_ID,
    });
    
    const mintPubkey = new PublicKey(mintAddress);
    for (const account of tokenAccounts.value) {
      try {
        const accountInfo = SPL_ACCOUNT_LAYOUT.decode(account.account.data);
        if (accountInfo.mint.equals(mintPubkey)) {
          const balance = await connection.getTokenAccountBalance(account.pubkey);
          return balance.value.uiAmount || 0;
        }
      } catch {
        // Skip invalid accounts
      }
    }
    return 0;
  } catch (error) {
    return 0;
  }
}

// Display holder wallets with balances
async function displayHolderWallets(holderWalletKeys: string[], mintAddress: string) {
  console.log("\n" + "=".repeat(80));
  console.log("💰 HOLDER WALLETS - Current Run Token Trading");
  console.log("=".repeat(80));
  console.log(`Token: ${mintAddress}\n`);
  
  interface WalletInfo {
    index: number;
    address: string;
    privateKey: string;
    solBalance: number;
    tokenBalance: number;
  }
  
  const wallets: WalletInfo[] = [];
  for (let i = 0; i < holderWalletKeys.length; i++) {
    const privateKey = holderWalletKeys[i];
    const kp = Keypair.fromSecretKey(base58.decode(privateKey));
    const address = kp.publicKey.toBase58();
    const solBalance = await getWalletBalance(kp.publicKey);
    const tokenBalance = await getTokenBalance(kp.publicKey, mintAddress);
    
    wallets.push({
      index: i + 1,
      address,
      privateKey,
      solBalance,
      tokenBalance
    });
    
    console.log(`  ${i + 1}. ${address.substring(0, 8)}...${address.substring(address.length - 8)}`);
    console.log(`     SOL: ${solBalance.toFixed(4)} | Tokens: ${tokenBalance.toFixed(4)}`);
  }
  
  console.log("=".repeat(80));
  return wallets;
}

// Main menu
interface WalletInfo {
  index: number;
  address: string;
  privateKey: string;
  solBalance: number;
  tokenBalance: number;
}

async function showMainMenu(wallets: WalletInfo[], mintAddress: string) {
  console.log("\n" + "=".repeat(80));
  console.log("📋 HOLDER WALLET TRADING MENU");
  console.log("=".repeat(80));
  console.log("  1. 💰 Buy Tokens (with selected wallet)");
  console.log("  2. 💸 Sell Tokens (with selected wallet)");
  console.log("  3. 🔄 Refresh Wallet Balances");
  console.log("  0. ❌ Exit");
  console.log("=".repeat(80));
  
  const choice = await question("\nSelect option: ");
  // Trim and remove any carriage returns or extra whitespace
  return choice.trim().replace(/\r/g, '').replace(/\n/g, '');
}

// Buy tokens
async function buyTokens(wallets: WalletInfo[], mintAddress: string) {
  console.log("\n" + "=".repeat(80));
  console.log("💰 BUY TOKENS");
  console.log("=".repeat(80));
  
  // Show wallets
  wallets.forEach(w => {
    console.log(`  ${w.index}. ${w.address.substring(0, 12)}...${w.address.substring(w.address.length - 8)} | SOL: ${w.solBalance.toFixed(4)}`);
  });
  
  const walletChoice = await question("\nSelect wallet number: ");
  const walletIndex = parseInt(walletChoice) - 1;
  
  if (walletIndex < 0 || walletIndex >= wallets.length) {
    console.log("❌ Invalid wallet selection");
    return;
  }
  
  const wallet = wallets[walletIndex];
  console.log(`\nSelected: ${wallet.address.substring(0, 12)}...${wallet.address.substring(wallet.address.length - 8)}`);
  console.log(`Available SOL: ${wallet.solBalance.toFixed(4)}`);
  
  const solAmountStr = await question("\nEnter SOL amount to spend: ");
  const solAmount = parseFloat(solAmountStr);
  
  if (isNaN(solAmount) || solAmount <= 0) {
    console.log("❌ Invalid SOL amount");
    return;
  }
  
  if (solAmount > wallet.solBalance) {
    console.log(`❌ Insufficient SOL. Available: ${wallet.solBalance.toFixed(4)}`);
    return;
  }
  
  console.log(`\n🔄 Buying tokens with ${solAmount} SOL...`);
  try {
    const result = await buyTokenSimple(wallet.privateKey, mintAddress, solAmount);
    console.log("✅ Buy successful!");
    console.log(`   Transaction: ${result.signature || 'N/A'}`);
    console.log(`   View on Solscan: ${result.txUrl || 'N/A'}`);
  } catch (error: any) {
    console.log(`❌ Buy failed: ${error.message}`);
  }
}

// Sell tokens
async function sellTokens(wallets: WalletInfo[], mintAddress: string) {
  console.log("\n" + "=".repeat(80));
  console.log("💸 SELL TOKENS");
  console.log("=".repeat(80));
  
  // Show wallets with token balances
  wallets.forEach(w => {
    console.log(`  ${w.index}. ${w.address.substring(0, 12)}...${w.address.substring(w.address.length - 8)} | Tokens: ${w.tokenBalance.toFixed(4)}`);
  });
  
  const walletChoice = await question("\nSelect wallet number: ");
  const walletIndex = parseInt(walletChoice) - 1;
  
  if (walletIndex < 0 || walletIndex >= wallets.length) {
    console.log("❌ Invalid wallet selection");
    return;
  }
  
  const wallet = wallets[walletIndex];
  console.log(`\nSelected: ${wallet.address.substring(0, 12)}...${wallet.address.substring(wallet.address.length - 8)}`);
  console.log(`Available Tokens: ${wallet.tokenBalance.toFixed(4)}`);
  
  if (wallet.tokenBalance === 0) {
    console.log("❌ No tokens to sell");
    return;
  }
  
  const percentageStr = await question("\nEnter percentage to sell (1-100, or 'all' for 100%): ");
  let percentage = 100;
  
  if (percentageStr.toLowerCase() === 'all') {
    percentage = 100;
  } else {
    const parsed = parseFloat(percentageStr);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
      percentage = parsed;
    } else {
      console.log("❌ Invalid percentage");
      return;
    }
  }
  
  console.log(`\n🔄 Selling ${percentage}% of tokens...`);
  try {
    const result = await sellTokenSimple(wallet.privateKey, mintAddress, percentage);
    console.log("✅ Sell successful!");
    console.log(`   Transaction: ${result.signature || 'N/A'}`);
    console.log(`   View on Solscan: ${result.txUrl || 'N/A'}`);
  } catch (error: any) {
    console.log(`❌ Sell failed: ${error.message}`);
  }
}

// Main function
async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🎯 HOLDER WALLET TRADING TERMINAL");
  console.log("=".repeat(80));
  
  // Load current run
  const currentRun = loadCurrentRun();
  if (!currentRun) {
    console.log("❌ No current-run.json found. Please launch a token first.");
    rl.close();
    return;
  }
  
  const holderWalletKeys = currentRun.holderWalletKeys || [];
  const mintAddress = currentRun.mintAddress;
  
  if (!mintAddress) {
    console.log("❌ No mint address found in current-run.json");
    rl.close();
    return;
  }
  
  if (holderWalletKeys.length === 0) {
    console.log("❌ No holder wallets found in current-run.json");
    rl.close();
    return;
  }
  
  console.log(`\n📊 Found ${holderWalletKeys.length} holder wallet(s)`);
  console.log(`🪙 Token: ${mintAddress}\n`);
  
  // Load and display wallets
  let wallets = await displayHolderWallets(holderWalletKeys, mintAddress);
  
  // Main loop
  while (true) {
    const choice = await showMainMenu(wallets, mintAddress);
    // Debug: log the choice to see what we're getting
    // console.log(`DEBUG: Choice received: "${choice}" (length: ${choice.length})`);
    
    switch (choice) {
      case '1':
        await buyTokens(wallets, mintAddress);
        // Refresh balances after buy
        wallets = await displayHolderWallets(holderWalletKeys, mintAddress);
        break;
        
      case '2':
        await sellTokens(wallets, mintAddress);
        // Refresh balances after sell
        wallets = await displayHolderWallets(holderWalletKeys, mintAddress);
        break;
        
      case '3':
        console.log("\n🔄 Refreshing balances...");
        wallets = await displayHolderWallets(holderWalletKeys, mintAddress);
        break;
        
      case '0':
        console.log("\n👋 Exiting...");
        rl.close();
        return;
        
      default:
        console.log("❌ Invalid option");
    }
  }
}

// Run
main().catch(error => {
  console.error("Fatal error:", error);
  rl.close();
  process.exit(1);
});

