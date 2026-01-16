import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import base58 from "bs58";
import { getBuyTxWithJupiter, getSellTxWithJupiter } from "../utils/swapOnlyAmm";
import { RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT } from "../constants";
import { sleep } from "../utils";

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: "confirmed"
});

interface VolumeMakerConfig {
  enabled: boolean;
  durationMinutes: number;
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
  minBuyAmount: number;
  maxBuyAmount: number;
  minSellPercentage: number;
  maxSellPercentage: number;
  walletCount: number;
}

// Get token balance for a wallet
async function getTokenBalance(wallet: Keypair, mintAddress: PublicKey): Promise<number> {
  try {
    const { TOKEN_PROGRAM_ID } = require("@solana/spl-token");
    const tokenAccounts = await connection.getTokenAccountsByOwner(wallet.publicKey, {
      programId: TOKEN_PROGRAM_ID,
    });
    
    for (const account of tokenAccounts.value) {
      // Type assertion for parsed account data
      const accountData = account.account.data as any;
      const parsed = accountData.parsed?.info;
      if (parsed?.mint === mintAddress.toBase58()) {
        const balance = parsed.tokenAmount?.uiAmount || 0;
        return balance;
      }
    }
    
    return 0;
  } catch (error) {
    return 0;
  }
}

// Get SOL balance for a wallet
async function getSolBalance(wallet: Keypair): Promise<number> {
  try {
    const balance = await connection.getBalance(wallet.publicKey);
    return balance / 1e9;
  } catch (error) {
    return 0;
  }
}

// Random number between min and max
function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

// Random integer between min and max (inclusive)
function randomIntBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Execute a buy transaction
async function executeBuy(wallet: Keypair, mintAddress: PublicKey, amount: number): Promise<boolean> {
  try {
    const amountLamports = Math.floor(amount * 1e9);
    const tx = await getBuyTxWithJupiter(wallet, mintAddress, amountLamports);
    if (!tx) {
      console.log(`   ❌ Failed to create buy tx for ${wallet.publicKey.toBase58().slice(0, 8)}...`);
      return false;
    }

    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3
    });

    await connection.confirmTransaction(signature, "confirmed");
    console.log(`   ✅ Buy: ${amount.toFixed(4)} SOL - ${signature.slice(0, 16)}...`);
    return true;
  } catch (error: any) {
    console.log(`   ❌ Buy failed: ${error.message?.slice(0, 60) || String(error).slice(0, 60)}`);
    return false;
  }
}

// Execute a sell transaction
async function executeSell(wallet: Keypair, mintAddress: PublicKey, percentage: number): Promise<boolean> {
  try {
    const tokenBalance = await getTokenBalance(wallet, mintAddress);
    if (tokenBalance === 0) {
      return false;
    }

    const amountToSell = tokenBalance * (percentage / 100);
    
    // Get the actual token account to find decimals
    const { TOKEN_PROGRAM_ID } = require("@solana/spl-token");
    const tokenAccounts = await connection.getTokenAccountsByOwner(wallet.publicKey, {
      programId: TOKEN_PROGRAM_ID,
    });
    
    let decimals = 6; // Default for pump.fun tokens
    for (const account of tokenAccounts.value) {
      // @ts-ignore - account.data can be parsed format
      const parsed = account.account.data.parsed?.info;
      if (parsed?.mint === mintAddress.toBase58()) {
        decimals = parsed.tokenAmount?.decimals || 6;
        break;
      }
    }
    
    const amountString = Math.floor(amountToSell * Math.pow(10, decimals)).toString();

    const tx = await getSellTxWithJupiter(wallet, mintAddress, amountString);
    if (!tx) {
      console.log(`   ❌ Failed to create sell tx for ${wallet.publicKey.toBase58().slice(0, 8)}...`);
      return false;
    }

    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3
    });

    await connection.confirmTransaction(signature, "confirmed");
    console.log(`   ✅ Sell: ${(percentage).toFixed(1)}% (${amountToSell.toFixed(2)} tokens) - ${signature.slice(0, 16)}...`);
    return true;
  } catch (error: any) {
    console.log(`   ❌ Sell failed: ${error.message?.slice(0, 60) || String(error).slice(0, 60)}`);
    return false;
  }
}

export async function startVolumeMaker(
  wallets: Keypair[],
  mintAddress: PublicKey,
  config: VolumeMakerConfig
): Promise<void> {
  if (!config.enabled) {
    console.log("\n📊 Volume maker is disabled");
    return;
  }

  console.log("\n📊 Starting volume maker...");
  console.log(`   Duration: ${config.durationMinutes} minutes`);
  console.log(`   Interval: ${config.minIntervalSeconds}-${config.maxIntervalSeconds} seconds`);
  console.log(`   Buy range: ${config.minBuyAmount}-${config.maxBuyAmount} SOL`);
  console.log(`   Sell range: ${config.minSellPercentage}-${config.maxSellPercentage}%`);
  console.log(`   Using ${config.walletCount} wallets`);

  // Select random wallets to use for volume making
  const selectedWallets = wallets
    .sort(() => Math.random() - 0.5)
    .slice(0, Math.min(config.walletCount, wallets.length));

  console.log(`   Selected ${selectedWallets.length} wallets for volume making\n`);

  const startTime = Date.now();
  const endTime = startTime + (config.durationMinutes * 60 * 1000);
  let tradeCount = 0;

  while (Date.now() < endTime) {
    // Random delay between trades
    const delay = randomIntBetween(config.minIntervalSeconds, config.maxIntervalSeconds);
    await sleep(delay * 1000);

    // Randomly choose a wallet
    const wallet = selectedWallets[randomIntBetween(0, selectedWallets.length - 1)];

    // Check balances
    const solBalance = await getSolBalance(wallet);
    const tokenBalance = await getTokenBalance(wallet, mintAddress);

    // Decide whether to buy or sell (50/50 chance, but only if wallet has funds)
    const canBuy = solBalance >= config.minBuyAmount + 0.01; // Need extra for fees
    const canSell = tokenBalance > 0;

    if (!canBuy && !canSell) {
      continue; // Skip this wallet if it can't do anything
    }

    if (canBuy && canSell) {
      // If wallet can do both, randomly choose
      if (Math.random() < 0.5) {
        // Buy
        const buyAmount = randomBetween(config.minBuyAmount, config.maxBuyAmount);
        if (solBalance >= buyAmount + 0.01) {
          await executeBuy(wallet, mintAddress, buyAmount);
          tradeCount++;
        }
      } else {
        // Sell
        const sellPercentage = randomBetween(config.minSellPercentage, config.maxSellPercentage);
        await executeSell(wallet, mintAddress, sellPercentage);
        tradeCount++;
      }
    } else if (canBuy) {
      // Only can buy
      const buyAmount = randomBetween(config.minBuyAmount, config.maxBuyAmount);
      if (solBalance >= buyAmount + 0.01) {
        await executeBuy(wallet, mintAddress, buyAmount);
        tradeCount++;
      }
    } else if (canSell) {
      // Only can sell
      const sellPercentage = randomBetween(config.minSellPercentage, config.maxSellPercentage);
      await executeSell(wallet, mintAddress, sellPercentage);
      tradeCount++;
    }

    // Log progress every 10 trades
    if (tradeCount % 10 === 0) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const remaining = Math.floor((endTime - Date.now()) / 1000);
      console.log(`   📈 Progress: ${tradeCount} trades executed | ${elapsed}s elapsed | ${remaining}s remaining`);
    }
  }

  console.log(`\n✅ Volume maker completed: ${tradeCount} total trades executed`);
}


