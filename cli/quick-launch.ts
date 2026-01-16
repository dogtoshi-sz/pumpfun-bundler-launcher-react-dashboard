/**
 * QUICK LAUNCH MODE
 * 
 * A simplified launcher for rapid token deployment:
 * - Dev buy only (no bundle wallets, no Jito)
 * - Twitter API integration for instant posts
 * - Uses same pump-addresses.json pool
 * - Uses same .env configuration
 * - Proper address marking as used
 */

import dotenv from 'dotenv';
dotenv.config({ override: true });

import { Connection, Keypair, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import base58 from "bs58";
import fs from "fs";
import path from "path";
import readline from "readline";

import { getNextPumpAddress, markPumpAddressAsUsed, saveDataToFile, sleep } from "../utils";
import { createTokenTx, makeBuyIx } from "../src/main";
import { postToTwitter, getTwitterAccountInfo } from "../marketing/twitter/twitter-poster";

// Load constants
const {
  PRIVATE_KEY,
  RPC_ENDPOINT,
  RPC_WEBSOCKET_ENDPOINT,
  TOKEN_NAME,
  TOKEN_SYMBOL,
  DESCRIPTION,
  TWITTER,
  TELEGRAM,
  WEBSITE,
  TWITTER_API_KEY,
  TWITTER_API_SECRET,
  TWITTER_ACCESS_TOKEN,
  TWITTER_ACCESS_TOKEN_SECRET,
  TWITTER_TWEETS,
  ENABLE_TWITTER_POSTING,
  FILE,
} = process.env;

const commitment = "confirmed";
const PRIORITY_FEE_LAMPORTS = 100000; // 0.0001 SOL priority fee

const connection = new Connection(RPC_ENDPOINT!, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment
});

// Create readline interface for user prompts
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

// Display quick launch settings
function displaySettings() {
  const nextPumpAddress = getNextPumpAddress();
  
  console.log("\n" + "=".repeat(70));
  console.log("⚡ QUICK LAUNCH MODE - Settings");
  console.log("=".repeat(70));
  
  console.log("\n🪙 TOKEN:");
  console.log(`   Name: ${TOKEN_NAME || 'NOT SET'}`);
  console.log(`   Symbol: ${TOKEN_SYMBOL || 'NOT SET'}`);
  console.log(`   Description: ${(DESCRIPTION || 'NOT SET').substring(0, 50)}${(DESCRIPTION || '').length > 50 ? '...' : ''}`);
  
  console.log("\n🔗 SOCIALS:");
  console.log(`   Twitter: ${TWITTER || 'NOT SET'}`);
  console.log(`   Telegram: ${TELEGRAM || 'NOT SET'}`);
  console.log(`   Website: ${WEBSITE || 'NOT SET'}`);
  
  console.log("\n🎯 PUMP ADDRESS:");
  if (nextPumpAddress) {
    console.log(`   ✅ Next: ${nextPumpAddress.publicKey}`);
  } else {
    console.log(`   ⚠️  No available addresses`);
  }
  
  console.log("\n🐦 TWITTER POSTING:");
  const twitterEnabled = ENABLE_TWITTER_POSTING === 'true';
  console.log(`   Enabled: ${twitterEnabled ? '✅ Yes' : '❌ No'}`);
  if (twitterEnabled && TWITTER_API_KEY) {
    console.log(`   API Key: ${TWITTER_API_KEY.substring(0, 8)}...`);
    const tweets = (TWITTER_TWEETS || '').split('|||').filter(t => t.trim());
    console.log(`   Scheduled Tweets: ${tweets.length}`);
  }
  
  console.log("\n💰 DEV BUY:");
  const buyerAmount = parseFloat(process.env.BUYER_AMOUNT || '0.1');
  console.log(`   Amount: ${buyerAmount} SOL`);
  
  console.log("\n⚡ MODE:");
  console.log(`   Priority Fee: ${PRIORITY_FEE_LAMPORTS / 1_000_000_000} SOL`);
  console.log(`   Jito: ❌ Disabled (using priority fees)`);
  console.log(`   Bundle Wallets: ❌ None`);
  console.log(`   Holder Wallets: ❌ None (Quick Launch)`);
  
  console.log("=".repeat(70));
}

// Verify Twitter connection
async function verifyTwitter(): Promise<boolean> {
  if (ENABLE_TWITTER_POSTING !== 'true') {
    console.log("📱 Twitter posting is disabled");
    return false;
  }
  
  if (!TWITTER_API_KEY || !TWITTER_API_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_TOKEN_SECRET) {
    console.log("⚠️  Twitter API credentials not configured");
    return false;
  }
  
  try {
    console.log("🔄 Verifying Twitter connection...");
    const result = await getTwitterAccountInfo({
      apiKey: TWITTER_API_KEY,
      apiSecret: TWITTER_API_SECRET,
      accessToken: TWITTER_ACCESS_TOKEN,
      accessTokenSecret: TWITTER_ACCESS_TOKEN_SECRET,
    });
    
    if (result.success && result.account) {
      console.log(`✅ Twitter connected: @${result.account.username} (${result.account.name})`);
      return true;
    } else {
      console.log(`⚠️  Twitter connection failed: ${result.error}`);
      return false;
    }
  } catch (error: any) {
    console.log(`⚠️  Twitter verification error: ${error.message}`);
    return false;
  }
}

// Post to Twitter after successful launch
async function postLaunchTweets(contractAddress: string): Promise<void> {
  if (ENABLE_TWITTER_POSTING !== 'true') {
    return;
  }
  
  const tweets = (TWITTER_TWEETS || '').split('|||').filter(t => t.trim());
  if (tweets.length === 0) {
    console.log("📱 No tweets configured in TWITTER_TWEETS");
    return;
  }
  
  console.log(`\n🐦 Posting ${tweets.length} tweet(s) to Twitter...`);
  
  try {
    const result = await postToTwitter({
      apiKey: TWITTER_API_KEY!,
      apiSecret: TWITTER_API_SECRET!,
      accessToken: TWITTER_ACCESS_TOKEN!,
      accessTokenSecret: TWITTER_ACCESS_TOKEN_SECRET!,
      tweets: tweets,
      tweetDelays: [5, 10], // 5s, 10s delays between tweets
      updateProfile: true,
      tokenConfig: {
        tokenName: TOKEN_NAME,
        tokenSymbol: TOKEN_SYMBOL,
        tokenAddress: contractAddress,
        pumpVanityPublicKey: contractAddress,
        website: WEBSITE,
        telegram: TELEGRAM,
        twitter: TWITTER,
        description: DESCRIPTION,
        chain: 'Solana',
      },
    });
    
    if (result.success) {
      console.log(`✅ ${result.message}`);
      if (result.tweets?.tweetIds.length) {
        console.log(`   Tweet IDs: ${result.tweets.tweetIds.join(', ')}`);
      }
    } else {
      console.log(`⚠️  Twitter error: ${result.error}`);
    }
  } catch (error: any) {
    console.log(`⚠️  Twitter posting failed: ${error.message}`);
  }
}

// Main quick launch function
async function quickLaunch() {
  console.log("\n" + "=".repeat(70));
  console.log("⚡⚡⚡ QUICK LAUNCH MODE ⚡⚡⚡");
  console.log("=".repeat(70));
  
  displaySettings();
  
  // Verify prerequisites
  if (!PRIVATE_KEY) {
    console.error("❌ PRIVATE_KEY not set in .env");
    process.exit(1);
  }
  
  // Check if we should use funding wallet as buyer
  const useFundingAsBuyer = process.env.USE_FUNDING_AS_BUYER === 'true';
  const buyerWallet = useFundingAsBuyer ? PRIVATE_KEY : process.env.BUYER_WALLET;
  
  if (!buyerWallet) {
    console.error("❌ BUYER_WALLET not set in .env (or USE_FUNDING_AS_BUYER=true with PRIVATE_KEY)");
    process.exit(1);
  }
  
  if (useFundingAsBuyer) {
    console.log("✅ Using Funding Wallet as Buyer (USE_FUNDING_AS_BUYER=true)");
  }
  
  const buyerAmount = parseFloat(process.env.BUYER_AMOUNT || '0.1');
  if (buyerAmount <= 0) {
    console.error("❌ BUYER_AMOUNT must be greater than 0");
    process.exit(1);
  }
  
  // Get pump address
  const pumpAddress = getNextPumpAddress();
  if (!pumpAddress) {
    console.error("❌ No available pump addresses. Generate more with the vanity generator.");
    process.exit(1);
  }
  
  // Verify Twitter if enabled
  const twitterReady = await verifyTwitter();
  
  // Confirmation prompt
  console.log("\n" + "=".repeat(70));
  console.log("🚀 READY TO LAUNCH");
  console.log("=".repeat(70));
  console.log(`   Token: ${TOKEN_NAME} ($${TOKEN_SYMBOL})`);
  console.log(`   Contract: ${pumpAddress.publicKey}`);
  console.log(`   Dev Buy: ${buyerAmount} SOL`);
  console.log(`   Twitter: ${twitterReady ? '✅ Will post' : '❌ Disabled'}`);
  console.log("=".repeat(70));
  
  // Auto-confirm if called from API (QUICK_LAUNCH_AUTO_CONFIRM env var)
  const autoConfirm = process.env.QUICK_LAUNCH_AUTO_CONFIRM === 'true';
  
  if (!autoConfirm) {
    const confirm = await question("\n⚡ Launch now? (y/n): ");
    if (confirm.toLowerCase() !== 'y') {
      console.log("❌ Launch cancelled");
      rl.close();
      process.exit(0);
    }
  } else {
    console.log("\n⚡ Auto-confirm enabled (API mode)");
  }
  
  console.log("\n🚀 LAUNCHING...\n");
  
  try {
    const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY));
    const buyerKp = Keypair.fromSecretKey(base58.decode(buyerWallet));
    const mintKp = pumpAddress.keypair;
    
    console.log("📝 Step 1/4: Creating token transaction...");
    
    // Create token transaction
    const tokenCreationIxs = await createTokenTx(buyerKp, mintKp, mainKp);
    const latestBlockhash = await connection.getLatestBlockhash();
    
    // Build token creation + dev buy transaction (combined)
    const buyIx = await makeBuyIx(
      buyerKp,
      Math.floor(buyerAmount * 10 ** 9),
      0,
      buyerKp.publicKey, // creator is buyer
      mintKp.publicKey
    );
    
    console.log("📝 Step 2/4: Building transactions...");
    
    // Token creation transaction
    // NOTE: createTokenTx already includes ComputeBudgetProgram instructions, don't add duplicates
    const tokenCreationMsg = new TransactionMessage({
      payerKey: buyerKp.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: tokenCreationIxs // Already has compute budget + jito fee + create instruction
    }).compileToV0Message();
    
    const tokenCreationTx = new VersionedTransaction(tokenCreationMsg);
    tokenCreationTx.sign([buyerKp, mintKp]);
    
    // Dev buy transaction
    const buyMsg = new TransactionMessage({
      payerKey: buyerKp.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_LAMPORTS }),
        ...buyIx
      ]
    }).compileToV0Message();
    
    const buyTx = new VersionedTransaction(buyMsg);
    buyTx.sign([buyerKp]);
    
    console.log("📡 Step 3/4: Sending token creation...");
    
    // Send token creation first
    const createSig = await connection.sendTransaction(tokenCreationTx, {
      skipPreflight: false,
      preflightCommitment: commitment,
    });
    
    console.log(`   ⏳ Confirming... (${createSig.slice(0, 20)}...)`);
    
    const createConfirm = await connection.confirmTransaction({
      signature: createSig,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    }, commitment);
    
    if (createConfirm.value.err) {
      throw new Error(`Token creation failed: ${JSON.stringify(createConfirm.value.err)}`);
    }
    
    console.log(`   ✅ Token created!`);
    // Emit mint address immediately for instant tracking subscription
    console.log(`   📡 TRACKING_SIGNAL: ${pumpAddress.publicKey}`);
    
    // Wait for tracker to subscribe before sending dev buy
    // This ensures the P&L tracker catches the dev buy in real-time
    console.log(`   ⏳ Waiting for tracker subscription...`);
    await sleep(1500); // Give tracker time to subscribe via WebSocket
    
    console.log("💰 Step 4/4: Sending dev buy...");
    
    // Get fresh blockhash for buy tx
    const freshBlockhash = await connection.getLatestBlockhash();
    const buyMsgFresh = new TransactionMessage({
      payerKey: buyerKp.publicKey,
      recentBlockhash: freshBlockhash.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_LAMPORTS }),
        ...buyIx
      ]
    }).compileToV0Message();
    
    const buyTxFresh = new VersionedTransaction(buyMsgFresh);
    buyTxFresh.sign([buyerKp]);
    
    const buySig = await connection.sendTransaction(buyTxFresh, {
      skipPreflight: false,
      preflightCommitment: commitment,
    });
    
    console.log(`   ⏳ Confirming... (${buySig.slice(0, 20)}...)`);
    
    const buyConfirm = await connection.confirmTransaction({
      signature: buySig,
      blockhash: freshBlockhash.blockhash,
      lastValidBlockHeight: freshBlockhash.lastValidBlockHeight,
    }, commitment);
    
    if (buyConfirm.value.err) {
      console.log(`   ⚠️  Dev buy failed, but token was created!`);
    } else {
      console.log(`   ✅ Dev buy complete!`);
    }
    
    // SUCCESS!
    console.log("\n" + "=".repeat(70));
    console.log("✅✅✅ QUICK LAUNCH SUCCESSFUL! ✅✅✅");
    console.log("=".repeat(70));
    console.log(`   Token: ${TOKEN_NAME} ($${TOKEN_SYMBOL})`);
    console.log(`   Contract: ${pumpAddress.publicKey}`);
    console.log(`   Pump.fun: https://pump.fun/coin/${pumpAddress.publicKey}`);
    console.log(`   Create TX: https://solscan.io/tx/${createSig}`);
    console.log(`   Buy TX: https://solscan.io/tx/${buySig}`);
    console.log("=".repeat(70));
    
    // Mark pump address as used
    markPumpAddressAsUsed(pumpAddress.publicKey);
    console.log(`✅ Marked pump address as used: ${pumpAddress.publicKey.slice(0, 12)}...`);
    
    // Save to current-run.json for tracking
    // Note: Use field names that match what pumpportal-tracker.js expects
    const currentRunData = {
      mintAddress: pumpAddress.publicKey,
      tokenName: TOKEN_NAME,
      tokenSymbol: TOKEN_SYMBOL,
      launchMode: 'quick',
      launchTime: new Date().toISOString(),
      // These fields are used by the P&L tracker (pumpportal-tracker.js)
      devWallet: buyerKp.publicKey.toBase58(), // Primary field for Quick Launch
      devWalletAddress: buyerKp.publicKey.toBase58(), // Alias for compatibility
      creatorDevWalletKey: buyerWallet, // Private key for deriving address
      devBuyAmount: buyerAmount,
      createTxSignature: createSig,
      buyTxSignature: buySig,
      status: 'SUCCESS',
    };
    
    const keysDir = path.join(process.cwd(), 'keys');
    if (!fs.existsSync(keysDir)) {
      fs.mkdirSync(keysDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(keysDir, 'current-run.json'),
      JSON.stringify(currentRunData, null, 2)
    );
    console.log("✅ Saved current-run.json");
    
    // Post to Twitter
    if (twitterReady) {
      await postLaunchTweets(pumpAddress.publicKey);
    }
    
    console.log("\n🎉 Quick Launch complete! Your token is live.\n");
    
  } catch (error: any) {
    console.error("\n❌ LAUNCH FAILED:", error.message);
    console.error("\nFull error:", error);
  }
  
  rl.close();
}

// Run
quickLaunch().catch(console.error);
