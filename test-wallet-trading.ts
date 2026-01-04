import * as readline from 'readline';
import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import base58 from "bs58";
import { buyTokenSimple, sellTokenSimple, getWalletTokenBalance } from "./trading-terminal";
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

// Get wallet balance (SOL)
async function getWalletBalance(publicKey: PublicKey): Promise<number> {
  const connection = getConnection();
  const balance = await connection.getBalance(publicKey);
  return balance / 1e9;
}

// Display wallet info
async function displayWallet(walletKp: Keypair) {
  const address = walletKp.publicKey.toBase58();
  const solBalance = await getWalletBalance(walletKp.publicKey);
  
  console.log("\n" + "=".repeat(80));
  console.log("💰 WALLET INFO");
  console.log("=".repeat(80));
  console.log(`   Address: ${address}`);
  console.log(`   SOL Balance: ${solBalance.toFixed(4)} SOL`);
  console.log("=".repeat(80));
  
  return { address, solBalance };
}

// Test buy
async function testBuy(walletPrivateKey: string, mintAddress: string) {
  console.log("\n" + "=".repeat(80));
  console.log("🧪 TEST BUY");
  console.log("=".repeat(80));
  
  const walletKp = Keypair.fromSecretKey(base58.decode(walletPrivateKey));
  await displayWallet(walletKp);
  
  const solAmountStr = await question("\nEnter SOL amount to spend: ");
  const solAmount = parseFloat(solAmountStr);
  
  if (isNaN(solAmount) || solAmount <= 0) {
    console.log("❌ Invalid SOL amount");
    return;
  }
  
  const solBalance = await getWalletBalance(walletKp.publicKey);
  if (solAmount > solBalance) {
    console.log(`❌ Insufficient SOL. Available: ${solBalance.toFixed(4)} SOL`);
    return;
  }
  
  console.log(`\n🔄 Buying tokens with ${solAmount} SOL...`);
  console.log(`   Token: ${mintAddress}`);
  
  try {
    const result = await buyTokenSimple(walletPrivateKey, mintAddress, solAmount);
    console.log("\n✅ Buy successful!");
    console.log(`   Transaction: ${result.signature}`);
    console.log(`   View on Solscan: ${result.txUrl}`);
    
    // Wait a bit then check token balance
    console.log("\n⏳ Waiting 3 seconds for token balance to update...");
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const tokenBalance = await getWalletTokenBalance(walletPrivateKey, mintAddress);
    if (tokenBalance.hasTokens) {
      console.log(`   Token Balance: ${tokenBalance.balance.toFixed(4)} tokens`);
    } else {
      console.log(`   Token Balance: 0 (may still be updating)`);
    }
  } catch (error: any) {
    console.log(`\n❌ Buy failed: ${error.message}`);
  }
}

// Test sell
async function testSell(walletPrivateKey: string, mintAddress: string) {
  console.log("\n" + "=".repeat(80));
  console.log("🧪 TEST SELL");
  console.log("=".repeat(80));
  
  const walletKp = Keypair.fromSecretKey(base58.decode(walletPrivateKey));
  await displayWallet(walletKp);
  
  // Check token balance
  const tokenBalance = await getWalletTokenBalance(walletPrivateKey, mintAddress);
  console.log(`\n   Token Balance: ${tokenBalance.hasTokens ? tokenBalance.balance.toFixed(4) : '0'} tokens`);
  
  if (!tokenBalance.hasTokens || tokenBalance.balance === 0) {
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
  console.log(`   Token: ${mintAddress}`);
  console.log(`   Amount: ${(tokenBalance.balance * percentage / 100).toFixed(4)} tokens`);
  
  try {
    const result = await sellTokenSimple(walletPrivateKey, mintAddress, percentage);
    console.log("\n✅ Sell successful!");
    console.log(`   Transaction: ${result.signature}`);
    console.log(`   View on Solscan: ${result.txUrl}`);
    
    // Wait a bit then check balances
    console.log("\n⏳ Waiting 3 seconds for balances to update...");
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const newTokenBalance = await getWalletTokenBalance(walletPrivateKey, mintAddress);
    const newSolBalance = await getWalletBalance(walletKp.publicKey);
    
    console.log(`   Remaining Token Balance: ${newTokenBalance.hasTokens ? newTokenBalance.balance.toFixed(4) : '0'} tokens`);
    console.log(`   New SOL Balance: ${newSolBalance.toFixed(4)} SOL`);
  } catch (error: any) {
    console.log(`\n❌ Sell failed: ${error.message}`);
  }
}

// Main menu
async function showMenu() {
  console.log("\n" + "=".repeat(80));
  console.log("🧪 WALLET TRADING TEST");
  console.log("=".repeat(80));
  console.log("  1. 💰 Test Buy");
  console.log("  2. 💸 Test Sell");
  console.log("  3. 📊 Check Wallet Balance");
  console.log("  4. 📊 Check Token Balance");
  console.log("  0. ❌ Exit");
  console.log("=".repeat(80));
  
  const choice = await question("\nSelect option: ");
  return choice.trim();
}

// Main function
async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🧪 PUMP.FUN WALLET TRADING TEST");
  console.log("=".repeat(80));
  console.log("This script allows you to test buy/sell with custom wallets");
  console.log("on any existing pump.fun token.");
  console.log("=".repeat(80));
  
  // Get wallet private key
  const walletPrivateKey = await question("\nEnter wallet private key (base58): ");
  
  if (!walletPrivateKey || walletPrivateKey.trim() === '') {
    console.log("❌ Private key is required");
    rl.close();
    return;
  }
  
  // Validate private key
  let walletKp: Keypair;
  try {
    walletKp = Keypair.fromSecretKey(base58.decode(walletPrivateKey.trim()));
  } catch (error) {
    console.log("❌ Invalid private key format");
    rl.close();
    return;
  }
  
  // Get mint address
  const mintAddress = await question("\nEnter token mint address (pump.fun token): ");
  
  if (!mintAddress || mintAddress.trim() === '') {
    console.log("❌ Mint address is required");
    rl.close();
    return;
  }
  
  // Validate mint address
  try {
    new PublicKey(mintAddress.trim());
  } catch (error) {
    console.log("❌ Invalid mint address format");
    rl.close();
    return;
  }
  
  // Display wallet info
  await displayWallet(walletKp);
  
  // Main loop
  while (true) {
    const choice = await showMenu();
    
    switch (choice) {
      case '1':
        await testBuy(walletPrivateKey.trim(), mintAddress.trim());
        break;
        
      case '2':
        await testSell(walletPrivateKey.trim(), mintAddress.trim());
        break;
        
      case '3':
        const solBalance = await getWalletBalance(walletKp.publicKey);
        console.log(`\n💰 SOL Balance: ${solBalance.toFixed(4)} SOL`);
        break;
        
      case '4':
        const tokenBalance = await getWalletTokenBalance(walletPrivateKey.trim(), mintAddress.trim());
        console.log(`\n🪙 Token Balance: ${tokenBalance.hasTokens ? tokenBalance.balance.toFixed(4) : '0'} tokens`);
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




