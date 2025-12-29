import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { RPC_ENDPOINT } from "./constants";
import base58 from "bs58";

const connection = new Connection(RPC_ENDPOINT, "confirmed");

// Analyze costs for the recent token launch
async function analyzeCosts() {
  const mainWallet = "FEYAuf9BzbPPcKtECLDtSLTVh6i4Niu7587UBLTCUU6V";
  const mintAddress = "HvJgy4VVhPzhv8YycabLmBmkiNva2aVtGJB8ED86pump";
  
  console.log("🔍 Analyzing costs for token launch...\n");
  console.log(`Main Wallet: ${mainWallet}`);
  console.log(`Mint Address: ${mintAddress}\n`);
  
  // Get current balance
  const currentBalance = await connection.getBalance(new PublicKey(mainWallet));
  console.log(`💰 Current Balance: ${(currentBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL\n`);
  
  // From logs:
  // Starting balance: 7.385 SOL
  // Distributed: 0.18 + 0.15 = 0.33 SOL (to 2 bundler wallets)
  // DEV buy: 0.1 SOL
  // Recovered: 6.901233 + 0.180928 + 0.149439 = 7.2316 SOL
  
  const startingBalance = 7.385;
  const distributedToWallets = 0.18 + 0.15; // 0.33 SOL
  const devBuyAmount = 0.1;
  const recoveredFromGather = 6.901233 + 0.180928 + 0.149439; // 7.2316 SOL
  
  console.log("📊 Cost Breakdown:\n");
  console.log(`Starting Balance: ${startingBalance.toFixed(6)} SOL`);
  console.log(`\n💰 Money Out:`);
  console.log(`  - Distributed to bundler wallets: ${distributedToWallets.toFixed(6)} SOL`);
  console.log(`  - DEV buy amount: ${devBuyAmount.toFixed(6)} SOL`);
  console.log(`  - Total spent on buys: ${(distributedToWallets + devBuyAmount).toFixed(6)} SOL`);
  
  console.log(`\n💵 Money Recovered:`);
  console.log(`  - From gather: ${recoveredFromGather.toFixed(6)} SOL`);
  
  const netRecovered = recoveredFromGather - (distributedToWallets + devBuyAmount);
  console.log(`\n📈 Net from buys/sells: ${netRecovered > 0 ? '+' : ''}${netRecovered.toFixed(6)} SOL`);
  
  // Calculate total loss
  const totalLoss = startingBalance - (currentBalance / LAMPORTS_PER_SOL);
  console.log(`\n❌ Total SOL Lost: ${totalLoss.toFixed(6)} SOL`);
  
  // Breakdown of costs
  const knownCosts = distributedToWallets + devBuyAmount;
  const unknownCosts = totalLoss - (knownCosts - netRecovered);
  
  console.log(`\n🔍 Cost Analysis:`);
  console.log(`  - Known costs (buys): ${knownCosts.toFixed(6)} SOL`);
  console.log(`  - Recovered from sells: ${recoveredFromGather.toFixed(6)} SOL`);
  console.log(`  - Loss on token trades: ${(knownCosts - recoveredFromGather).toFixed(6)} SOL`);
  console.log(`  - Other costs (rent, fees, etc.): ${unknownCosts.toFixed(6)} SOL`);
  
  console.log(`\n💡 Other costs include:`);
  console.log(`  - Token creation rent (mint account, metadata, etc.)`);
  console.log(`  - LUT creation and extension rent`);
  console.log(`  - Transaction fees (priority fees, base fees)`);
  console.log(`  - Jito bundle fees`);
  console.log(`  - Token account creation rent`);
  console.log(`  - Slippage and trading fees on Jupiter`);
  
  // Check token account rent
  try {
    const mintInfo = await connection.getParsedAccountInfo(new PublicKey(mintAddress));
    if (mintInfo.value) {
      console.log(`\n✅ Token exists on-chain`);
    }
  } catch (e) {
    console.log(`\n⚠️  Could not verify token on-chain`);
  }
  
  // Estimate costs
  console.log(`\n📋 Estimated Costs:`);
  console.log(`  - Token creation: ~0.5-2.0 SOL (rent for accounts)`);
  console.log(`  - LUT creation: ~0.001-0.002 SOL (rent for account)`);
  console.log(`  - Transaction fees: ~0.01-0.05 SOL`);
  console.log(`  - Trading slippage: Variable (depends on liquidity)`);
  
  const estimatedTotal = 0.5 + 0.02 + 0.05; // Conservative estimate
  console.log(`\n💸 Estimated minimum other costs: ~${estimatedTotal.toFixed(2)} SOL`);
  console.log(`   (Actual may be higher due to token creation rent)`);
}

analyzeCosts().catch(console.error);

