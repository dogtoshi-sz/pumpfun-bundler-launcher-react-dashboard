import { VersionedTransaction, Keypair, Connection, ComputeBudgetProgram, TransactionInstruction, TransactionMessage, PublicKey, SystemProgram } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID } from "@solana/spl-token"
import { SPL_ACCOUNT_LAYOUT } from "@raydium-io/raydium-sdk"
import base58 from "bs58"
import fs from "fs"
import path from "path"
import dotenv from 'dotenv'

// CRITICAL: Force reload .env file with override to get latest values
// This ensures we read the .env file that was just updated by the API server
const rootEnvPath = path.join(process.cwd(), '.env')
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath, override: true })
  console.log(`[index.ts] Reloaded .env file from: ${rootEnvPath}`)
} else {
  dotenv.config({ override: true })
  console.log(`[index.ts] Using default .env location`)
}

import { DISTRIBUTION_WALLETNUM, LIL_JIT_MODE, PRIVATE_KEY, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, SWAP_AMOUNT, SWAP_AMOUNTS, VANITY_MODE, BUYER_AMOUNT, AUTO_RAPID_SELL, AUTO_GATHER, BUNDLE_WALLET_COUNT, BUNDLE_SWAP_AMOUNTS, HOLDER_WALLET_COUNT, HOLDER_SWAP_AMOUNTS, HOLDER_WALLET_AMOUNT, USE_NORMAL_LAUNCH, WEBSOCKET_TRACKING_ENABLED, WEBSOCKET_EXTERNAL_BUY_THRESHOLD, WEBSOCKET_EXTERNAL_BUY_WINDOW, WEBSOCKET_ULTRA_FAST_MODE, AUTO_SELL_50_PERCENT, AUTO_HOLDER_WALLET_BUY, HOLDER_WALLET_PRIORITY_FEE, HOLDER_WALLET_AUTO_BUY_DELAYS, MARKET_CAP_TRACKING_ENABLED, MARKET_CAP_SELL_THRESHOLD, MARKET_CAP_CHECK_INTERVAL, TOKEN_NAME, TOKEN_SYMBOL, AUTO_BUY_FRONT_RUN_THRESHOLD, AUTO_BUY_FRONT_RUN_CHECK_DELAY, PUMP_PROGRAM } from "./constants"

// CRITICAL: Read BUYER_WALLET directly from process.env AFTER reloading .env
// This ensures we get the latest value even if it was just updated
const BUYER_WALLET = process.env.BUYER_WALLET || ''
import { generateVanityAddress, saveDataToFile, sleep, getNextPumpAddress, markPumpAddressAsUsed } from "./utils"
import { buyTokenSimple } from "./cli/trading-terminal"
import { createTokenTx, distributeSol, createLUT, makeBuyIx, addAddressesToTableMultiExtend, fundExistingWalletWithMixing, loadMixingWallets, fundExistingWalletWithMultipleIntermediaries } from "./src/main";
import { USE_MIXING_WALLETS, USE_MULTI_INTERMEDIARY_SYSTEM, NUM_INTERMEDIARY_HOPS, BUNDLE_INTERMEDIARY_HOPS, HOLDER_INTERMEDIARY_HOPS } from "./constants/constants";
import { executeJitoTx, stopJitoRetries } from "./executor/jito";
import { sendBundle } from "./executor/liljito";
import { updateWebsite, createTelegramGroup, postToTwitter } from "./utils/marketing-helpers";
import { startRunTracking, completeRunTracking, updateLaunchSettings } from "./lib/profit-loss-tracker";
import type { LaunchSettings } from "./lib/profit-loss-tracker";



const commitment = "confirmed"


const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT, commitment
})
const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))
console.log("mainKp", mainKp.publicKey.toBase58());

// ============================================
// FRONT-RUN PROTECTION: Check external volume
// ============================================
// Get bonding curve address for a Pump.fun token
const getBondingCurveAddress = (mintAddress: PublicKey): PublicKey => {
  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mintAddress.toBuffer()],
    PUMP_PROGRAM
  )
  return bondingCurve
}

// Check external net buy volume by analyzing recent transactions
// Returns: Total SOL bought by external wallets (excluding our wallets)
const checkExternalVolume = async (
  mintAddress: PublicKey,
  ourWallets: Set<string>,
  maxAge: number = 60 // Only count transactions within last N seconds
): Promise<{ externalNetBuys: number, externalBuyCount: number }> => {
  try {
    const bondingCurve = getBondingCurveAddress(mintAddress)
    
    // Get recent signatures for the bonding curve
    const signatures = await connection.getSignaturesForAddress(
      bondingCurve,
      { limit: 50 }, // Check last 50 transactions
      'confirmed'
    )
    
    if (signatures.length === 0) {
      return { externalNetBuys: 0, externalBuyCount: 0 }
    }
    
    const now = Date.now() / 1000
    let externalNetBuys = 0
    let externalBuyCount = 0
    
    // Fetch and analyze transactions
    for (const sigInfo of signatures) {
      // Skip old transactions
      if (sigInfo.blockTime && (now - sigInfo.blockTime) > maxAge) {
        continue
      }
      
      try {
        const tx = await connection.getParsedTransaction(sigInfo.signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0
        })
        
        if (!tx || !tx.meta) continue
        
        // Get the first account (usually the buyer/signer)
        const accounts = tx.transaction.message.accountKeys
        if (accounts.length === 0) continue
        
        const signerKey = typeof accounts[0] === 'string' 
          ? accounts[0] 
          : (accounts[0].pubkey?.toBase58?.() || accounts[0].toString())
        
        // Skip if this is one of our wallets
        if (ourWallets.has(signerKey) || ourWallets.has(signerKey.toLowerCase())) {
          continue
        }
        
        // Analyze SOL balance changes
        const preBalances = tx.meta.preBalances
        const postBalances = tx.meta.postBalances
        
        // Find the signer's balance change
        const signerIndex = accounts.findIndex((acc: any) => {
          const key = typeof acc === 'string' ? acc : (acc.pubkey?.toBase58?.() || acc.toString())
          return key === signerKey
        })
        
        if (signerIndex >= 0) {
          const preSol = (preBalances[signerIndex] || 0) / 1e9
          const postSol = (postBalances[signerIndex] || 0) / 1e9
          const solChange = postSol - preSol
          
          // Negative change = wallet sent SOL = BUY
          // Positive change = wallet received SOL = SELL
          if (solChange < -0.001) { // Ignore tiny fees
            const buyAmount = Math.abs(solChange)
            externalNetBuys += buyAmount
            externalBuyCount++
          } else if (solChange > 0.001) {
            // Sell reduces net buys
            externalNetBuys -= solChange
          }
        }
      } catch (e) {
        // Skip transactions that fail to parse
        continue
      }
    }
    
    return { 
      externalNetBuys: Math.max(0, externalNetBuys), // Don't go negative
      externalBuyCount 
    }
  } catch (error: any) {
    console.warn(`⚠️  Failed to check external volume: ${error.message}`)
    return { externalNetBuys: 0, externalBuyCount: 0 }
  }
}
let kps: Keypair[] = []
const transactions: VersionedTransaction[] = []

// Support for pregenerated mint keypair
// Priority: 1) MINT_PRIVATE_KEY env var, 2) Pump address pool, 3) Vanity mode, 4) Generate new
let mintKp: Keypair
if (process.env.MINT_PRIVATE_KEY) {
  console.log("📌 Using pregenerated mint keypair from MINT_PRIVATE_KEY")
  mintKp = Keypair.fromSecretKey(base58.decode(process.env.MINT_PRIVATE_KEY))
  console.log("mintKp (pregenerated from env):", mintKp.publicKey.toBase58())
} else {
  mintKp = Keypair.generate()
  console.log("mintKp (new):", mintKp.publicKey.toBase58())
}


const main = async () => {
  // Define path to current-run.json
  const keysPath = path.join(process.cwd(), 'keys', 'current-run.json')
  
  // Track if we used a pump address from pool (to mark as used after successful launch)
  let usedPumpAddressPublicKey: string | null = null
  
  // Priority order for mint keypair:
  // 1. MINT_PRIVATE_KEY env variable (already handled above)
  // 2. Pump address pool (pregenerated pump addresses)
  // 3. Vanity mode (generate new with "pump" suffix)
  // 4. Generate new random keypair (default)
  
  if (!process.env.MINT_PRIVATE_KEY) {
    // Try to get from pump address pool first
    const pumpAddress = getNextPumpAddress()
    if (pumpAddress) {
      mintKp = pumpAddress.keypair
      usedPumpAddressPublicKey = pumpAddress.publicKey
      console.log(`🎯 Using pregenerated pump address from pool: ${pumpAddress.publicKey}`)
      console.log(`   This address will be marked as used after successful launch`)
    } else if (VANITY_MODE) {
      // Generate vanity address if enabled and no pool address available
      console.log("🔍 No pump addresses in pool, generating vanity address...")
      const result = generateVanityAddress("pump");
      // Handle both sync and async returns
      if (result instanceof Promise) {
        const { keypair, pubkey } = await result;
        mintKp = keypair;
        console.log(`✅ Keypair generated with "pump" ending: ${pubkey}`);
      } else {
        mintKp = result.keypair;
        console.log(`✅ Keypair generated with "pump" ending: ${result.pubkey}`);
      }
    }
  }
  const mintAddress = mintKp.publicKey
  console.log("mintAddress", mintAddress.toBase58());

  const mainBal = await connection.getBalance(mainKp.publicKey)
  console.log((mainBal / 10 ** 9).toFixed(3), "SOL in main keypair")

  // Start profit/loss tracking NOW - BEFORE any wallets are created or funded
  // This captures the TRUE starting balance before ANY funds leave the main wallet
  let profitLossRunId: string | null = null;
  try {
    profitLossRunId = await startRunTracking(
      connection,
      mainKp.publicKey,
      TOKEN_NAME,
      TOKEN_SYMBOL,
      mintAddress.toBase58()
      // Note: Launch settings will be added later after we know wallet sources
    );
    console.log(`\n📊 [ProfitLoss] Started tracking BEFORE any wallet creation. Balance: ${(mainBal / 10 ** 9).toFixed(4)} SOL`);
  } catch (error: any) {
    console.warn(`[ProfitLoss] Failed to start tracking: ${error.message}`);
  }

  console.log("Mint address of token ", mintAddress.toBase58())
  saveDataToFile([base58.encode(mintKp.secretKey)], "mint.json")

  // Check for warmed wallets file early (for creator wallet)
  const warmedWalletsPath = path.join(process.cwd(), 'keys', 'warmed-wallets-for-launch.json')

  // Prepare buyer wallet for dev buy (needed for createTokenTx)
  // PRIORITY: 0) USE_FUNDING_AS_BUYER=true (use funding wallet as DEV), 1) creatorWalletKey from warmed wallets, 2) BUYER_WALLET from .env, 3) Auto-create
  // CRITICAL: Re-read BUYER_WALLET from process.env to get latest value (in case it was just updated)
  const currentBuyerWallet = process.env.BUYER_WALLET || ''
  const useFundingAsBuyer = process.env.USE_FUNDING_AS_BUYER === 'true'
  
  if (useFundingAsBuyer) {
    console.log(`\n✅ USE_FUNDING_AS_BUYER=true → Will use your Funding Wallet as the DEV/Creator wallet`)
  }
  
  // Check for warmed creator wallet first
  let warmedCreatorWalletKey: string | null = null
  if (fs.existsSync(warmedWalletsPath)) {
    try {
      const warmedData = JSON.parse(fs.readFileSync(warmedWalletsPath, 'utf8'))
      console.log(`[Wallet Creation] Warmed wallets file found. Checking for creator wallet...`)
      if (warmedData.creatorWalletKey && typeof warmedData.creatorWalletKey === 'string' && warmedData.creatorWalletKey.trim() !== '') {
        warmedCreatorWalletKey = warmedData.creatorWalletKey
        console.log(`[Wallet Creation] ✅ Found warmed creator wallet from wallet warming system`)
        if (warmedData.creatorWalletAddress) {
          console.log(`[Wallet Creation]    Creator wallet address: ${warmedData.creatorWalletAddress}`)
        }
      } else {
        console.log(`[Wallet Creation] ⚠️  Warmed wallets file exists but no creatorWalletKey found`)
        console.log(`[Wallet Creation]    File contains: ${Object.keys(warmedData).join(', ')}`)
        console.log(`[Wallet Creation]    creatorWalletKey value: ${warmedData.creatorWalletKey} (type: ${typeof warmedData.creatorWalletKey})`)
        if (warmedData.creatorWalletAddress) {
          console.log(`[Wallet Creation]    ⚠️  creatorWalletAddress exists (${warmedData.creatorWalletAddress}) but creatorWalletKey is missing!`)
          console.log(`[Wallet Creation]    This means the wallet was selected but the private key wasn't found in warmed wallets.`)
          console.log(`[Wallet Creation]    💡 Solution: Make sure the creator wallet is in your warmed wallets list and try launching again.`)
        }
      }
    } catch (error: any) {
      console.warn(`⚠️  Failed to read creator wallet from warmed wallets: ${error.message}`)
    }
  } else {
    console.log(`[Wallet Creation] No warmed wallets file found at ${warmedWalletsPath}`)
  }
  
  console.log(`[Wallet Creation] Priority check:`)
  console.log(`   Warmed creator wallet: ${warmedCreatorWalletKey ? 'Found' : 'Not found'}`)
  console.log(`   BUYER_WALLET from .env: ${currentBuyerWallet ? currentBuyerWallet.substring(0, 8) + '...' + currentBuyerWallet.substring(currentBuyerWallet.length - 8) : '(empty - will auto-create)'}`)
  
  let buyerKp: Keypair
  let buyerWalletSource: string
  let creatorWalletSourceType: 'warmed' | 'env' | 'auto-created' | 'funding' = 'auto-created'
  
  if (useFundingAsBuyer) {
    // PRIORITY 0: USE_FUNDING_AS_BUYER=true → Use the funding wallet (PRIVATE_KEY) as DEV wallet
    buyerKp = mainKp // mainKp is the funding wallet
    buyerWalletSource = 'Funding Wallet (USE_FUNDING_AS_BUYER=true)'
    creatorWalletSourceType = 'funding'
    console.log("💎 Using Funding Wallet as DEV wallet:", buyerKp.publicKey.toBase58())
    console.log("   ✅ No separate DEV wallet created - using your main funding wallet directly!")
  } else if (warmedCreatorWalletKey && warmedCreatorWalletKey.trim() !== '') {
    // PRIORITY 1: Use warmed creator wallet
    buyerKp = Keypair.fromSecretKey(base58.decode(warmedCreatorWalletKey))
    buyerWalletSource = 'warmed creator wallet (from wallet warming system)'
    creatorWalletSourceType = 'warmed'
    console.log("🔥 Using warmed creator wallet:", buyerKp.publicKey.toBase58())
  } else if (currentBuyerWallet && currentBuyerWallet.trim() !== '') {
    // PRIORITY 2: Use BUYER_WALLET from .env (persistent wallet)
    buyerKp = Keypair.fromSecretKey(base58.decode(currentBuyerWallet))
    buyerWalletSource = 'BUYER_WALLET env var (persistent)'
    creatorWalletSourceType = 'env'
    console.log("Dev buyer wallet (from .env):", buyerKp.publicKey.toBase58())
  } else {
    // Create DEV wallet FIRST using distributeSol (same as bundle wallets) - saves to data.json automatically
    console.log("   ⚠️  BUYER_WALLET not set in .env - creating DEV wallet like bundle wallets")
    console.log("   💡 This wallet will be created and saved to data.json (same as bundle wallets)")
    
    const buyerAmount = Number(process.env.BUYER_AMOUNT || '0.1');
    const jitoFee = Number(process.env.JITO_FEE || '0.001');
    // CRITICAL: Creator wallet needs enough SOL to pay for:
    // - Token creation costs: ~0.01 SOL (rent, fees)
    // - Jito fee (if bundling): 0.001 SOL
    // - DEV buy amount: BUYER_AMOUNT
    // - Priority fees for DEV buy: 5M units * 20k microLamports = 0.1 SOL
    // - Transaction base fees: ~0.000005 SOL
    // - Rent exemption (if needed): ~0.001 SOL
    // - Safety margin: ~0.05 SOL
    // Total: 0.01 (token creation) + 0.001 (Jito) + BUYER_AMOUNT + 0.1 (priority) + 0.05 (safety) = 0.161 + BUYER_AMOUNT
    const devRequiredAmount = buyerAmount + 0.161 + jitoFee // Always include Jito fee (won't be used in normal launch but that's fine)
    console.log(`\n💰 Creating DEV wallet FIRST (same as bundle wallets)...`)
    console.log(`   Amount: ${devRequiredAmount.toFixed(4)} SOL`)
    console.log(`   Breakdown:`)
    console.log(`     - Token creation: ~0.01 SOL`)
    console.log(`     - Jito fee: ${jitoFee.toFixed(4)} SOL`)
    console.log(`     - DEV buy: ${buyerAmount.toFixed(4)} SOL`)
    console.log(`     - Priority fees: ~0.1 SOL`)
    console.log(`     - Safety margin: ~0.05 SOL`)
    
    const devWalletResult = await distributeSol(connection, mainKp, 1, [devRequiredAmount], USE_MIXING_WALLETS)
    if (!devWalletResult || devWalletResult.length === 0) {
      console.error(`   ❌ Failed to create DEV wallet`)
      return
    }
    buyerKp = devWalletResult[0]
    buyerWalletSource = 'auto-created (saved to data.json like bundle wallets)'
    creatorWalletSourceType = 'auto-created'
    console.log(`   ✅ Created DEV wallet: ${buyerKp.publicKey.toBase58()}`)
    console.log(`   ✅ Saved to data.json (same as bundle wallets)`)
    
    // CRITICAL: Wait for the wallet to be fully confirmed and settled on-chain
    // distributeSol uses execute() which confirms, but we need to verify the wallet is ready
    console.log(`   ⏳ Verifying wallet is confirmed and ready...`)
    
    // Poll for wallet balance to ensure it's confirmed on-chain
    let verified = false
    for (let attempt = 0; attempt < 10; attempt++) {
      const settledBalance = await connection.getBalance(buyerKp.publicKey)
      const settledBalanceSol = settledBalance / 1e9
      
      if (settledBalanceSol >= devRequiredAmount) {
        console.log(`   ✅ Wallet confirmed and ready. Balance: ${settledBalanceSol.toFixed(4)} SOL`)
        verified = true
        break
      }
      
      if (attempt < 9) {
        console.log(`   ⏳ Waiting for wallet confirmation (attempt ${attempt + 1}/10)... Balance: ${settledBalanceSol.toFixed(4)} SOL`)
        await sleep(1000)
      }
    }
    
    if (!verified) {
      const finalBalance = await connection.getBalance(buyerKp.publicKey)
      const finalBalanceSol = finalBalance / 1e9
      console.error(`   ❌ ERROR: Wallet not confirmed after 10 attempts!`)
      console.error(`   Expected: ${devRequiredAmount.toFixed(4)} SOL, Got: ${finalBalanceSol.toFixed(4)} SOL`)
      console.error(`   The funding transaction may have failed or is still pending`)
      return
    }
    
    // CRITICAL: "Warm up" the newly created wallet by sending a tiny transaction to itself
    // This establishes the wallet on-chain and may help with pump.fun validation
    // Some protocols require wallets to have transaction history before they can be used as creators
    console.log(`   🔥 Warming up wallet with a self-transfer to establish on-chain history...`)
    try {
      const warmupBlockhash = await connection.getLatestBlockhash()
      const warmupMsg = new TransactionMessage({
        payerKey: buyerKp.publicKey,
        recentBlockhash: warmupBlockhash.blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
          SystemProgram.transfer({
            fromPubkey: buyerKp.publicKey,
            toPubkey: buyerKp.publicKey, // Self-transfer (establishes wallet on-chain)
            lamports: 1 // 1 lamport (minimal amount to establish transaction)
          })
        ]
      }).compileToV0Message()
      
      const warmupTx = new VersionedTransaction(warmupMsg)
      warmupTx.sign([buyerKp])
      
      const warmupSig = await connection.sendTransaction(warmupTx, { skipPreflight: true, maxRetries: 3 })
      await connection.confirmTransaction(warmupSig, 'confirmed')
      console.log(`   ✅ Wallet warmed up. Transaction: https://solscan.io/tx/${warmupSig}`)
    } catch (warmupError: any) {
      console.warn(`   ⚠️  Wallet warm-up failed (non-critical): ${warmupError.message}`)
      console.warn(`   Continuing anyway - this may cause issues if pump.fun requires wallet history`)
    }
  }

  // CRITICAL: Verify buyerKp is the newly created wallet (not funding wallet)
  console.log(`\n🔍 Token Creation Details:`)
  console.log(`   Creator Wallet (buyerKp): ${buyerKp.publicKey.toBase58()}`)
  console.log(`   Wallet Source: ${buyerWalletSource}`)
  console.log(`   Funding Wallet (mainKp): ${mainKp.publicKey.toBase58()}`)
  if (buyerKp.publicKey.equals(mainKp.publicKey)) {
    console.warn(`   ⚠️  WARNING: Creator wallet is the same as funding wallet!`)
  } else {
    console.log(`   ✅ Creator wallet is different from funding wallet (correct)`)
  }

  const tokenCreationIxs = await createTokenTx(buyerKp, mintKp, mainKp)
  if (tokenCreationIxs.length == 0) {
    console.log("Token creation failed")
    return
  }
  // Calculate minimum SOL needed
  // CRITICAL: Re-read from process.env to get latest values (constants were loaded at import time)
  // This ensures we use the values that were just saved by the API server
  const bundleWalletCount = Number(process.env.BUNDLE_WALLET_COUNT || process.env.DISTRIBUTION_WALLETNUM || '0');
  const bundleSwapAmountsString = process.env.BUNDLE_SWAP_AMOUNTS || '';
  // CRITICAL: Preserve array positions even for invalid values to detect which wallets should be skipped
  // Map each value (including empty/invalid) to preserve index alignment
  let bundleSwapAmounts: (number | null)[] = bundleSwapAmountsString
    ? bundleSwapAmountsString.split(',').map(s => {
        const trimmed = s.trim();
        if (trimmed === '' || trimmed === '0') {
          return null; // Empty or 0 means skip this wallet
        }
        const num = Number(trimmed);
        return isNaN(num) ? null : num; // Invalid values become null (skip)
      })
    : [];
  const holderWalletCount = Number(process.env.HOLDER_WALLET_COUNT || '0');
  const holderSwapAmountsString = process.env.HOLDER_SWAP_AMOUNTS || '';
  const holderSwapAmounts = holderSwapAmountsString
    ? holderSwapAmountsString.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n))
    : [];
  const holderWalletAmount = Number(process.env.HOLDER_WALLET_AMOUNT || '0.01');
  const buyerAmount = Number(process.env.BUYER_AMOUNT || '0.1');
  
  console.log(`\n📊 Buy Amount Configuration (from .env):`);
  console.log(`   - BUNDLE_SWAP_AMOUNTS from .env: ${bundleSwapAmountsString || '(empty)'}`);
  console.log(`   - Parsed BUNDLE_SWAP_AMOUNTS array: [${bundleSwapAmounts.join(', ')}] (length: ${bundleSwapAmounts.length})`);
  console.log(`   - BUNDLE_WALLET_COUNT: ${bundleWalletCount}`);
  console.log(`   - SWAP_AMOUNT (fallback): ${SWAP_AMOUNT}`);
  console.log(`   - BUYER_AMOUNT (DEV buy): ${buyerAmount}`);
  console.log(`   - DISTRIBUTION_WALLETNUM (legacy): ${DISTRIBUTION_WALLETNUM}`);
  
  let swapAmountsToUse: (number | null)[];
  if (bundleSwapAmounts.length > 0) {
    swapAmountsToUse = [...bundleSwapAmounts];
    // Pad with null (which will use SWAP_AMOUNT) if we have fewer amounts than wallets
    while (swapAmountsToUse.length < bundleWalletCount) {
      console.warn(`   ⚠️  BUNDLE_SWAP_AMOUNTS has ${swapAmountsToUse.length} values but need ${bundleWalletCount}. Padding with SWAP_AMOUNT (${SWAP_AMOUNT})`);
      swapAmountsToUse.push(null);
    }
    // Trim if we have more amounts than wallets (shouldn't happen, but be safe)
    swapAmountsToUse = swapAmountsToUse.slice(0, bundleWalletCount);
    const displayAmounts = swapAmountsToUse.map(a => a === null ? 'SWAP_AMOUNT' : a.toString());
    console.log(`   ✅ Using custom amounts: [${displayAmounts.join(', ')}]`);
    const skippedCount = swapAmountsToUse.filter(a => a === null || a === 0).length;
    if (skippedCount > 0) {
      console.warn(`   ⚠️  ${skippedCount} wallet(s) will be skipped (null or 0 amount)`);
    }
  } else {
    console.warn(`   ⚠️  BUNDLE_SWAP_AMOUNTS is empty! All wallets will use SWAP_AMOUNT (${SWAP_AMOUNT})`);
    swapAmountsToUse = Array(bundleWalletCount).fill(null); // null means use SWAP_AMOUNT
  }
  
  // Create a number[] version for places that need it (convert null to SWAP_AMOUNT)
  const swapAmountsForUse: number[] = swapAmountsToUse.map(a => a === null ? SWAP_AMOUNT : a);
  
  // Update launch settings now that we have all the info
  const usedWarmedWallets = fs.existsSync(warmedWalletsPath);
  const launchSettings: LaunchSettings = {
    usedWarmedWallets,
    creatorWalletSource: creatorWalletSourceType,
    bundleWalletCount,
    holderWalletCount,
    devBuyAmount: buyerAmount,
    bundleSwapAmounts: swapAmountsForUse,
    holderWalletAmount,
    autoRapidSell: AUTO_RAPID_SELL,
    autoSell50Percent: AUTO_SELL_50_PERCENT,
    autoSellStaged: process.env.AUTO_SELL_STAGED === 'true',
    autoGather: AUTO_GATHER,
    websocketTracking: WEBSOCKET_TRACKING_ENABLED,
    websocketUltraFastMode: WEBSOCKET_ULTRA_FAST_MODE,
    jitoFee: Number(process.env.JITO_FEE || '0.001'),
    useMixingWallets: USE_MIXING_WALLETS,
    useMultiIntermediary: USE_MULTI_INTERMEDIARY_SYSTEM,
    tokenImageUrl: process.env.FILE || undefined,
    twitter: process.env.TWITTER || undefined,
    telegram: process.env.TELEGRAM || undefined,
    website: process.env.WEBSITE || undefined,
    description: process.env.DESCRIPTION || undefined,
  };
  
  // Update the existing P/L record with launch settings now that we know them
  if (profitLossRunId) {
    try {
      updateLaunchSettings(profitLossRunId, launchSettings);
      console.log(`\n📊 [ProfitLoss] Updated tracking record with launch settings`);
    } catch (error: any) {
      console.warn(`[ProfitLoss] Failed to update launch settings: ${error.message}`);
    }
  }
  
  // Check for warmed wallets BEFORE balance calculation to account for existing balances
  let warmedBundleWalletBalances: number[] = []
  let warmedHolderWalletBalances: number[] = []
  let warmedDevWalletBalance = 0 // Track DEV wallet balance for relaunches
  let usingWarmedWallets = false
  let holderWalletsArePrefunded = false // Flag: warmed holder wallets use their own SOL
  let bundleWalletsArePrefunded = false // Flag: warmed bundle wallets use their own SOL
  
  if (fs.existsSync(warmedWalletsPath)) {
    try {
      const warmedData = JSON.parse(fs.readFileSync(warmedWalletsPath, 'utf8'))
      
      // Check if holder/bundle wallets are marked as pre-funded (from warming system)
      holderWalletsArePrefunded = warmedData.useWarmedHolderWallets === true
      bundleWalletsArePrefunded = warmedData.useWarmedBundleWallets === true
      
      // Check DEV wallet (creatorWalletKey) - IMPORTANT for relaunches!
      if (warmedData.creatorWalletKey) {
        try {
          const devKp = Keypair.fromSecretKey(base58.decode(warmedData.creatorWalletKey))
          const devBalance = await connection.getBalance(devKp.publicKey)
          warmedDevWalletBalance = devBalance / 1e9
          console.log(`\n🔥 Found warmed DEV wallet - checking balance...`)
          console.log(`   📊 DEV wallet ${devKp.publicKey.toBase58().slice(0, 8)}... has ${warmedDevWalletBalance.toFixed(4)} SOL`)
          if (warmedData.isRelaunch) {
            console.log(`   ♻️  This is a RELAUNCH - DEV wallet already funded from previous attempt`)
          }
        } catch (e) {
          warmedDevWalletBalance = 0
        }
      }
      
      // Check bundle wallets
      if (warmedData.bundleWalletKeys && warmedData.bundleWalletKeys.length > 0) {
        console.log(`\n🔥 Found ${warmedData.bundleWalletKeys.length} warmed bundle wallet(s) - checking balances...`)
        usingWarmedWallets = true
        
        for (const key of warmedData.bundleWalletKeys) {
          try {
            const kp = Keypair.fromSecretKey(base58.decode(key))
            const balance = await connection.getBalance(kp.publicKey)
            warmedBundleWalletBalances.push(balance / 1e9)
            console.log(`   📊 Bundle wallet ${kp.publicKey.toBase58().slice(0, 8)}... has ${(balance / 1e9).toFixed(4)} SOL`)
          } catch (e) {
            warmedBundleWalletBalances.push(0)
          }
        }
      }
      
      // Check holder wallets
      if (warmedData.holderWalletKeys && warmedData.holderWalletKeys.length > 0) {
        console.log(`🔥 Found ${warmedData.holderWalletKeys.length} warmed holder wallet(s) - checking balances...`)
        usingWarmedWallets = true
        
        for (const key of warmedData.holderWalletKeys) {
          try {
            const kp = Keypair.fromSecretKey(base58.decode(key))
            const balance = await connection.getBalance(kp.publicKey)
            warmedHolderWalletBalances.push(balance / 1e9)
            console.log(`   📊 Holder wallet ${kp.publicKey.toBase58().slice(0, 8)}... has ${(balance / 1e9).toFixed(4)} SOL`)
          } catch (e) {
            warmedHolderWalletBalances.push(0)
          }
        }
      }
    } catch (e: any) {
      console.warn(`⚠️  Failed to check warmed wallet balances: ${e.message}`)
    }
  }
  
  // Calculate minimum SOL needed, accounting for warmed wallet balances
  let bundleFundingNeeded = 0
  
  if (bundleWalletsArePrefunded && warmedBundleWalletBalances.length > 0) {
    // Pre-funded warmed wallets: NO FUNDING NEEDED from main wallet
    console.log(`\n💚 Bundle wallets are PRE-FUNDED (self-funded from warming/Mayan)`)
    console.log(`   These wallets will use their own SOL - no funding from main wallet needed`)
    const totalBalance = warmedBundleWalletBalances.reduce((sum, b) => sum + b, 0)
    console.log(`   📊 Total bundle wallet balance: ${totalBalance.toFixed(4)} SOL`)
    for (let i = 0; i < warmedBundleWalletBalances.length; i++) {
      const existing = warmedBundleWalletBalances[i] || 0
      console.log(`   ✅ Bundle wallet ${i + 1}: ${existing.toFixed(4)} SOL (self-funded)`)
    }
    bundleFundingNeeded = 0 // No funding needed - they use their own money
  } else if (usingWarmedWallets && warmedBundleWalletBalances.length > 0) {
    // Warmed but needs top-up (legacy behavior for relaunches)
    for (let i = 0; i < swapAmountsToUse.length; i++) {
      const required = (swapAmountsToUse[i] || SWAP_AMOUNT) + 0.01
      const existing = warmedBundleWalletBalances[i] || 0
      const needed = Math.max(0, required - existing)
      bundleFundingNeeded += needed
      if (needed > 0) {
        console.log(`   💰 Bundle wallet ${i + 1} needs ${needed.toFixed(4)} SOL funding (has ${existing.toFixed(4)}, needs ${required.toFixed(4)})`)
      } else {
        console.log(`   ✅ Bundle wallet ${i + 1} already funded (has ${existing.toFixed(4)} >= ${required.toFixed(4)})`)
      }
    }
  } else {
    // Fresh wallets - need full funding
    bundleFundingNeeded = swapAmountsToUse.reduce<number>((sum, amount) => {
      const amt = amount === null ? SWAP_AMOUNT : amount;
      return sum + amt + 0.01;
    }, 0)
  }
  
  // Calculate holder funding needed (similar logic)
  let holderFundingNeeded = 0
  const holderAmountsToUse = holderSwapAmounts.length > 0 ? holderSwapAmounts : Array(holderWalletCount).fill(holderWalletAmount)
  
  if (holderWalletsArePrefunded && warmedHolderWalletBalances.length > 0) {
    // Pre-funded warmed wallets: NO FUNDING NEEDED from main wallet
    // They will use their own SOL balance for buying
    console.log(`\n💚 Holder wallets are PRE-FUNDED (self-funded from warming/Mayan)`)
    console.log(`   These wallets will use their own SOL - no funding from main wallet needed`)
    const totalBalance = warmedHolderWalletBalances.reduce((sum, b) => sum + b, 0)
    console.log(`   📊 Total holder wallet balance: ${totalBalance.toFixed(4)} SOL`)
    for (let i = 0; i < warmedHolderWalletBalances.length; i++) {
      const existing = warmedHolderWalletBalances[i] || 0
      console.log(`   ✅ Holder wallet ${i + 1}: ${existing.toFixed(4)} SOL (self-funded)`)
    }
    holderFundingNeeded = 0 // No funding needed - they use their own money
  } else if (usingWarmedWallets && warmedHolderWalletBalances.length > 0) {
    // Warmed but needs top-up (legacy behavior for relaunches)
    for (let i = 0; i < warmedHolderWalletBalances.length; i++) {
      const required = (holderAmountsToUse[i] || holderWalletAmount) + 0.01
      const existing = warmedHolderWalletBalances[i] || 0
      const needed = Math.max(0, required - existing)
      holderFundingNeeded += needed
      if (needed > 0) {
        console.log(`   💰 Holder wallet ${i + 1} needs ${needed.toFixed(4)} SOL funding (has ${existing.toFixed(4)}, needs ${required.toFixed(4)})`)
      } else {
        console.log(`   ✅ Holder wallet ${i + 1} already funded (has ${existing.toFixed(4)} >= ${required.toFixed(4)})`)
      }
    }
  } else if (holderWalletCount > 0) {
    holderFundingNeeded = holderAmountsToUse.slice(0, holderWalletCount).reduce((sum, amount) => sum + amount + 0.01, 0)
  }
  
  // Calculate DEV wallet funding needed (check existing balance like bundle/holder)
  const devBuyRequired = buyerAmount + 0.01 // DEV buy amount + fees
  const devFundingNeeded = Math.max(0, devBuyRequired - warmedDevWalletBalance)
  
  const minimumSolAmount = bundleFundingNeeded + holderFundingNeeded + 0.04 + devFundingNeeded
  const mainBalSol = mainBal / 1e9
  
  console.log(`\n💎 SOL Requirement Summary:`)
  console.log(`   Bundle funding needed: ${bundleFundingNeeded.toFixed(4)} SOL`)
  console.log(`   Holder funding needed: ${holderFundingNeeded.toFixed(4)} SOL`)
  if (warmedDevWalletBalance > 0) {
    console.log(`   DEV wallet has: ${warmedDevWalletBalance.toFixed(4)} SOL (needs ${devBuyRequired.toFixed(4)})`)
    if (devFundingNeeded > 0) {
      console.log(`   💰 DEV funding needed: ${devFundingNeeded.toFixed(4)} SOL`)
    } else {
      console.log(`   ✅ DEV wallet already funded!`)
    }
  } else {
    console.log(`   DEV buy amount: ${buyerAmount.toFixed(4)} SOL`)
  }
  console.log(`   Buffer + fees: 0.0400 SOL`)
  console.log(`   ─────────────────────────`)
  console.log(`   Total needed: ${minimumSolAmount.toFixed(4)} SOL`)
  console.log(`   Main wallet: ${mainBalSol.toFixed(4)} SOL`)
  
  if (mainBalSol < minimumSolAmount) {
    console.log(`\n❌ Main wallet balance is not enough to run the bundler`)
    console.log(`   Need ${minimumSolAmount.toFixed(4)} SOL, have ${mainBalSol.toFixed(4)} SOL`)
    console.log(`   Please charge the wallet with ${(minimumSolAmount - mainBalSol).toFixed(4)} more SOL`)
    return
  }
  
  console.log(`   ✅ Sufficient balance! Proceeding with launch...`)

  // Check if existing BUYER_WALLET or warmed creator wallet has enough balance
  // If insufficient, fund it automatically (same as auto-created wallets)
  // BUT: Skip funding if BUYER_WALLET is the same as PRIVATE_KEY (same wallet, no transfer needed)
  // CRITICAL: Use currentBuyerWallet (re-read from process.env) instead of BUYER_WALLET constant
  // Also check if using warmed creator wallet
  
  // PRIORITY 0: If using funding wallet as buyer, no funding needed - just verify balance
  if (creatorWalletSourceType === 'funding') {
    const devRequiredAmount = buyerAmount + 0.05 // BUYER_AMOUNT + 0.05 SOL buffer
    console.log(`\n✅ Using Funding Wallet as DEV - no separate wallet creation or funding needed`)
    console.log(`   Funding wallet balance: ${(mainBal / 1e9).toFixed(4)} SOL`)
    console.log(`   DEV buy will use: ${devRequiredAmount.toFixed(4)} SOL from this wallet`)
  } else if (warmedCreatorWalletKey && warmedCreatorWalletKey.trim() !== '') {
    // Using warmed creator wallet - check balance and fund if needed
    const isSameWallet = mainKp.publicKey.equals(buyerKp.publicKey)
    
    if (isSameWallet) {
      // Same wallet - just check balance, no funding needed
      const existingBalance = await connection.getBalance(buyerKp.publicKey)
      const existingBalanceSol = existingBalance / 1e9
      const devRequiredAmount = buyerAmount + 0.05 // BUYER_AMOUNT + 0.05 SOL buffer for fees
      if (existingBalanceSol < devRequiredAmount) {
        console.log(`\n⚠️  Warmed creator wallet is the same as PRIVATE_KEY (master wallet)`)
        console.log(`   Current balance: ${existingBalanceSol.toFixed(4)} SOL`)
        console.log(`   Need at least ${devRequiredAmount.toFixed(4)} SOL for DEV buy`)
        console.log(`   Breakdown: ${buyerAmount.toFixed(4)} SOL (buy) + 0.05 SOL (buffer for fees)`)
        console.log(`   ⚠️  Insufficient balance - please fund the master wallet`)
        return
      } else {
        console.log(`\n✅ Warmed creator wallet is the same as PRIVATE_KEY (master wallet)`)
        console.log(`   Balance: ${existingBalanceSol.toFixed(4)} SOL (sufficient for DEV buy)`)
      }
    } else {
      // Different wallet - check balance and fund if needed
      const existingBalance = await connection.getBalance(buyerKp.publicKey)
      const existingBalanceSol = existingBalance / 1e9
      const devRequiredAmount = buyerAmount + 0.05 // BUYER_AMOUNT + 0.05 SOL buffer for fees
      if (existingBalanceSol < devRequiredAmount) {
        const fundingNeeded = devRequiredAmount - existingBalanceSol
        console.log(`\n⚠️  Warmed creator wallet has insufficient balance (${existingBalanceSol.toFixed(4)} SOL)`)
        console.log(`   Need at least ${devRequiredAmount.toFixed(4)} SOL for DEV buy`)
        console.log(`   Breakdown: ${buyerAmount.toFixed(4)} SOL (buy) + 0.05 SOL (buffer for fees)`)
        console.log(`\n💰 Funding warmed creator wallet with ${fundingNeeded.toFixed(4)} SOL...`)
        
        // Use multi-intermediary system if enabled, otherwise use mixing wallets or direct funding
        if (USE_MULTI_INTERMEDIARY_SYSTEM) {
          console.log(`   🔀 Using ${NUM_INTERMEDIARY_HOPS} intermediary wallet(s) to break connection trail...`)
          const success = await fundExistingWalletWithMultipleIntermediaries(connection, mainKp, buyerKp, fundingNeeded, NUM_INTERMEDIARY_HOPS)
          if (!success) {
            console.error(`   ❌ Failed to fund warmed creator wallet through intermediaries`)
            return
          }
        } else if (USE_MIXING_WALLETS) {
          console.log(`   🔀 Using mixing wallets to break connection trail...`)
          const mixingWallets = loadMixingWallets()
          
          if (mixingWallets.length > 0) {
            const success = await fundExistingWalletWithMixing(connection, mainKp, buyerKp, fundingNeeded, mixingWallets)
            if (!success) {
              console.error(`   ❌ Failed to fund warmed creator wallet through mixer`)
              return
            }
            // Verify balance after funding
            const newBalance = await connection.getBalance(buyerKp.publicKey)
            console.log(`   ✅ Funded warmed creator wallet! New balance: ${(newBalance / 1e9).toFixed(4)} SOL`)
          } else {
            console.log(`   ⚠️  No mixing wallets available, using direct funding...`)
            // Fallback to direct funding
            try {
              const latestBlockhash = await connection.getLatestBlockhash()
              const fundingLamports = Math.ceil(fundingNeeded * 1e9)
              const transferMsg = new TransactionMessage({
                payerKey: mainKp.publicKey,
                recentBlockhash: latestBlockhash.blockhash,
                instructions: [
                  ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
                  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
                  SystemProgram.transfer({
                    fromPubkey: mainKp.publicKey,
                    toPubkey: buyerKp.publicKey,
                    lamports: fundingLamports
                  })
                ]
              }).compileToV0Message()

              const transferTx = new VersionedTransaction(transferMsg)
              transferTx.sign([mainKp])

              const sig = await connection.sendTransaction(transferTx, { skipPreflight: false, maxRetries: 3 })
              await connection.confirmTransaction(sig, 'confirmed')

              const newBalance = await connection.getBalance(buyerKp.publicKey)
              console.log(`   ✅ Funded warmed creator wallet! New balance: ${(newBalance / 1e9).toFixed(4)} SOL`)
              console.log(`   Transaction: https://solscan.io/tx/${sig}`)
            } catch (error: any) {
              console.error(`   ❌ Failed to fund warmed creator wallet: ${error.message}`)
              return
            }
          }
        } else {
          // Direct funding (mixing disabled)
          try {
            const latestBlockhash = await connection.getLatestBlockhash()
            const fundingLamports = Math.ceil(fundingNeeded * 1e9)
            const transferMsg = new TransactionMessage({
              payerKey: mainKp.publicKey,
              recentBlockhash: latestBlockhash.blockhash,
              instructions: [
                ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
                ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
                SystemProgram.transfer({
                  fromPubkey: mainKp.publicKey,
                  toPubkey: buyerKp.publicKey,
                  lamports: fundingLamports
                })
              ]
            }).compileToV0Message()

            const transferTx = new VersionedTransaction(transferMsg)
            transferTx.sign([mainKp])

            const sig = await connection.sendTransaction(transferTx, { skipPreflight: false, maxRetries: 3 })
            await connection.confirmTransaction(sig, 'confirmed')

            const newBalance = await connection.getBalance(buyerKp.publicKey)
            console.log(`   ✅ Funded warmed creator wallet! New balance: ${(newBalance / 1e9).toFixed(4)} SOL`)
            console.log(`   Transaction: https://solscan.io/tx/${sig}`)
          } catch (error: any) {
            console.error(`   ❌ Failed to fund warmed creator wallet: ${error.message}`)
            return
          }
        }
      } else {
        console.log(`\n✅ Warmed creator wallet has sufficient balance: ${existingBalanceSol.toFixed(4)} SOL`)
      }
    }
  } else if (currentBuyerWallet && currentBuyerWallet.trim() !== '') {
    const isSameWallet = mainKp.publicKey.equals(buyerKp.publicKey)
    
    if (isSameWallet) {
      // Same wallet - just check balance, no funding needed
      const existingBalance = await connection.getBalance(buyerKp.publicKey)
      const existingBalanceSol = existingBalance / 1e9
      const devRequiredAmount = buyerAmount + 0.05 // BUYER_AMOUNT + 0.05 SOL buffer for fees
      if (existingBalanceSol < devRequiredAmount) {
        console.log(`\n⚠️  BUYER_WALLET is the same as PRIVATE_KEY (master wallet)`)
        console.log(`   Current balance: ${existingBalanceSol.toFixed(4)} SOL`)
        console.log(`   Need at least ${devRequiredAmount.toFixed(4)} SOL for DEV buy`)
        console.log(`   Breakdown: ${buyerAmount.toFixed(4)} SOL (buy) + 0.05 SOL (buffer for fees)`)
        console.log(`   ⚠️  Insufficient balance - please fund the master wallet`)
        return
      } else {
        console.log(`\n✅ BUYER_WALLET is the same as PRIVATE_KEY (master wallet)`)
        console.log(`   Balance: ${existingBalanceSol.toFixed(4)} SOL (sufficient for DEV buy)`)
      }
    } else {
      // Different wallet - check balance and fund if needed
      const existingBalance = await connection.getBalance(buyerKp.publicKey)
      const existingBalanceSol = existingBalance / 1e9
      const devRequiredAmount = buyerAmount + 0.05 // BUYER_AMOUNT + 0.05 SOL buffer for fees
      if (existingBalanceSol < devRequiredAmount) {
        const fundingNeeded = devRequiredAmount - existingBalanceSol
        console.log(`\n⚠️  BUYER_WALLET has insufficient balance (${existingBalanceSol.toFixed(4)} SOL)`)
        console.log(`   Need at least ${devRequiredAmount.toFixed(4)} SOL for DEV buy`)
        console.log(`   Breakdown: ${buyerAmount.toFixed(4)} SOL (buy) + 0.05 SOL (buffer for fees)`)
        console.log(`\n💰 Funding BUYER_WALLET with ${fundingNeeded.toFixed(4)} SOL...`)
        
        // Use multi-intermediary system if enabled, otherwise use mixing wallets or direct funding
        if (USE_MULTI_INTERMEDIARY_SYSTEM) {
          console.log(`   🔀 Using ${NUM_INTERMEDIARY_HOPS} intermediary wallet(s) to break connection trail...`)
          const success = await fundExistingWalletWithMultipleIntermediaries(connection, mainKp, buyerKp, fundingNeeded, NUM_INTERMEDIARY_HOPS)
          if (!success) {
            console.error(`   ❌ Failed to fund BUYER_WALLET through intermediaries`)
            return
          }
        } else if (USE_MIXING_WALLETS) {
          console.log(`   🔀 Using mixing wallets to break connection trail...`)
          const mixingWallets = loadMixingWallets()
          
          if (mixingWallets.length > 0) {
            const success = await fundExistingWalletWithMixing(connection, mainKp, buyerKp, fundingNeeded, mixingWallets)
            if (!success) {
              console.error(`   ❌ Failed to fund BUYER_WALLET through mixer`)
              return
            }
            // Verify balance after funding
            const newBalance = await connection.getBalance(buyerKp.publicKey)
            console.log(`   ✅ Funded BUYER_WALLET! New balance: ${(newBalance / 1e9).toFixed(4)} SOL`)
          } else {
            console.log(`   ⚠️  No mixing wallets available, using direct funding...`)
            // Fallback to direct funding
            try {
              const latestBlockhash = await connection.getLatestBlockhash()
              const fundingLamports = Math.ceil(fundingNeeded * 1e9)
              const transferMsg = new TransactionMessage({
                payerKey: mainKp.publicKey,
                recentBlockhash: latestBlockhash.blockhash,
                instructions: [
                  ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
                  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
                  SystemProgram.transfer({
                    fromPubkey: mainKp.publicKey,
                    toPubkey: buyerKp.publicKey,
                    lamports: fundingLamports
                  })
                ]
              }).compileToV0Message()

              const transferTx = new VersionedTransaction(transferMsg)
              transferTx.sign([mainKp])

              const sig = await connection.sendTransaction(transferTx, { skipPreflight: false, maxRetries: 3 })
              await connection.confirmTransaction(sig, 'confirmed')

              const newBalance = await connection.getBalance(buyerKp.publicKey)
              console.log(`   ✅ Funded BUYER_WALLET! New balance: ${(newBalance / 1e9).toFixed(4)} SOL`)
              console.log(`   Transaction: https://solscan.io/tx/${sig}`)
            } catch (error: any) {
              console.error(`   ❌ Failed to fund BUYER_WALLET: ${error.message}`)
              return
            }
          }
        } else {
          // Direct funding (mixing disabled)
          try {
            const latestBlockhash = await connection.getLatestBlockhash()
            const fundingLamports = Math.ceil(fundingNeeded * 1e9)
            const transferMsg = new TransactionMessage({
              payerKey: mainKp.publicKey,
              recentBlockhash: latestBlockhash.blockhash,
              instructions: [
                ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
                ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
                SystemProgram.transfer({
                  fromPubkey: mainKp.publicKey,
                  toPubkey: buyerKp.publicKey,
                  lamports: fundingLamports
                })
              ]
            }).compileToV0Message()

            const transferTx = new VersionedTransaction(transferMsg)
            transferTx.sign([mainKp])

            const sig = await connection.sendTransaction(transferTx, { skipPreflight: false, maxRetries: 3 })
            await connection.confirmTransaction(sig, 'confirmed')

            const newBalance = await connection.getBalance(buyerKp.publicKey)
            console.log(`   ✅ Funded BUYER_WALLET! New balance: ${(newBalance / 1e9).toFixed(4)} SOL`)
            console.log(`   Transaction: https://solscan.io/tx/${sig}`)
          } catch (error: any) {
            console.error(`   ❌ Failed to fund BUYER_WALLET: ${error.message}`)
            return
          }
        }
      } else {
        console.log(`\n✅ BUYER_WALLET has sufficient balance: ${existingBalanceSol.toFixed(4)} SOL`)
      }
    }
  }
  // Note: If BUYER_WALLET was not set, the wallet was already created and funded above using distributeSol

  // Check for warmed wallets file (created by API server if user selected warmed wallets)
  // Note: warmedWalletsPath is already defined above, and usingWarmedWallets is set during balance check
  // We just need to load the keypairs here
  let useWarmedWallets = usingWarmedWallets // Copy from early check
  let warmedBundleWallets: Keypair[] = []
  let warmedHolderWallets: Keypair[] = []
  
  if (fs.existsSync(warmedWalletsPath)) {
    try {
      const warmedData = JSON.parse(fs.readFileSync(warmedWalletsPath, 'utf8'))
      if (warmedData.bundleWalletKeys && warmedData.bundleWalletKeys.length > 0) {
        warmedBundleWallets = warmedData.bundleWalletKeys.map((key: string) => 
          Keypair.fromSecretKey(base58.decode(key))
        )
        console.log(`\n🔥 Using ${warmedBundleWallets.length} warmed bundle wallet(s) from wallet warming system`)
        useWarmedWallets = true
      }
      if (warmedData.holderWalletKeys && warmedData.holderWalletKeys.length > 0) {
        warmedHolderWallets = warmedData.holderWalletKeys.map((key: string) => 
          Keypair.fromSecretKey(base58.decode(key))
        )
        console.log(`🔥 Using ${warmedHolderWallets.length} warmed holder wallet(s) from wallet warming system`)
        useWarmedWallets = true
      }
    } catch (error: any) {
      console.warn(`⚠️  Failed to load warmed wallets: ${error.message}`)
      console.warn(`   Will create fresh wallets instead`)
    }
  }
  
  if (bundleWalletCount === 0 && warmedBundleWallets.length === 0) {
    console.log("⚠️  BUNDLE_WALLET_COUNT is 0 and no warmed bundle wallets - no bundle wallets will be created")
    console.log("   Set BUNDLE_WALLET_COUNT in .env to create bundle wallets, or select warmed wallets in the UI")
    // CRITICAL: Clear BUNDLE_SWAP_AMOUNTS if no wallets will be created
    if (bundleSwapAmounts.length > 0) {
      console.log("   ⚠️  Clearing BUNDLE_SWAP_AMOUNTS since no bundle wallets will be created")
      bundleSwapAmounts = []
    }
  }

  // Use warmed wallets if available, otherwise create fresh ones
  if (warmedBundleWallets.length > 0) {
    console.log(`\n💰 Funding ${warmedBundleWallets.length} warmed bundle wallet(s)...`)
    kps = warmedBundleWallets
    
    // Fund warmed wallets with required amounts
    // Pad/trim amounts array to match number of warmed wallets (same logic as fresh wallets)
    let amountsToUse: number[]
    if (swapAmountsToUse.length > 0) {
      // Convert nulls to SWAP_AMOUNT for warmed wallets
      amountsToUse = swapAmountsToUse.map(a => a === null ? SWAP_AMOUNT : a)
      // Pad with SWAP_AMOUNT if we have fewer amounts than wallets
      while (amountsToUse.length < warmedBundleWallets.length) {
        console.warn(`   ⚠️  BUNDLE_SWAP_AMOUNTS has ${amountsToUse.length} values but need ${warmedBundleWallets.length}. Padding with SWAP_AMOUNT (${SWAP_AMOUNT})`)
        amountsToUse.push(SWAP_AMOUNT)
      }
      // Trim if we have more amounts than wallets
      amountsToUse = amountsToUse.slice(0, warmedBundleWallets.length)
      console.log(`   ✅ Using custom amounts: [${amountsToUse.join(', ')}]`)
    } else {
      amountsToUse = Array(warmedBundleWallets.length).fill(SWAP_AMOUNT)
      console.log(`   ✅ Using default SWAP_AMOUNT (${SWAP_AMOUNT}) for all wallets`)
    }
    
    // Process warmed wallets in parallel batches - increased for faster funding
    const parallelBatchSize = Math.min(10, warmedBundleWallets.length) // Process up to 10 wallets in parallel
    const randomDelay = () => Math.random() * 300 + 100 // Reduced delay: 100-400ms (was 200-700ms)
    
    // Pre-load mixing wallets once if using mixing (shared across all wallets)
    let mixingWallets: Keypair[] = []
    if (USE_MIXING_WALLETS && !USE_MULTI_INTERMEDIARY_SYSTEM) {
      mixingWallets = loadMixingWallets()
    }
    
    // Process wallets in parallel batches
    for (let batchStart = 0; batchStart < warmedBundleWallets.length; batchStart += parallelBatchSize) {
      const batchEnd = Math.min(batchStart + parallelBatchSize, warmedBundleWallets.length)
      const batch = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i)
      
      console.log(`🔀 Processing warmed bundle wallets batch ${Math.floor(batchStart / parallelBatchSize) + 1}/${Math.ceil(warmedBundleWallets.length / parallelBatchSize)} (wallets ${batchStart + 1}-${batchEnd})...`)
      
      await Promise.all(batch.map(async (i) => {
        const wallet = warmedBundleWallets[i]
        const amount = amountsToUse[i] || SWAP_AMOUNT
        const requiredAmount = amount + 0.01 // Add buffer for fees
        
        const currentBalance = await connection.getBalance(wallet.publicKey)
        const currentBalanceSol = currentBalance / 1e9
        
        if (currentBalanceSol < requiredAmount) {
          const fundingNeeded = requiredAmount - currentBalanceSol
          console.log(`   💰 Funding wallet ${i + 1}/${warmedBundleWallets.length} (${wallet.publicKey.toBase58().slice(0, 8)}...): ${fundingNeeded.toFixed(4)} SOL`)
          
          try {
            if (USE_MULTI_INTERMEDIARY_SYSTEM) {
              // Create unique intermediaries for each wallet (better privacy - each wallet gets its own chain)
              console.log(`   🔀 Using ${BUNDLE_INTERMEDIARY_HOPS} intermediary wallet(s) for bundle wallet...`)
              const success = await fundExistingWalletWithMultipleIntermediaries(connection, mainKp, wallet, fundingNeeded, BUNDLE_INTERMEDIARY_HOPS)
              if (!success) {
                console.error(`   ❌ Failed to fund warmed bundle wallet ${i + 1} through intermediaries`)
                return
              }
            } else if (USE_MIXING_WALLETS && mixingWallets.length > 0) {
              const success = await fundExistingWalletWithMixing(connection, mainKp, wallet, fundingNeeded, mixingWallets)
              if (!success) {
                console.error(`   ❌ Failed to fund warmed bundle wallet ${i + 1}`)
                return
              }
            } else {
              // Direct funding fallback
              const latestBlockhash = await connection.getLatestBlockhash()
              const fundingLamports = Math.ceil(fundingNeeded * 1e9)
              const transferMsg = new TransactionMessage({
                payerKey: mainKp.publicKey,
                recentBlockhash: latestBlockhash.blockhash,
                instructions: [
                  SystemProgram.transfer({
                    fromPubkey: mainKp.publicKey,
                    toPubkey: wallet.publicKey,
                    lamports: fundingLamports
                  })
                ]
              }).compileToV0Message()
              const transferTx = new VersionedTransaction(transferMsg)
              transferTx.sign([mainKp])
              const sig = await connection.sendTransaction(transferTx, { skipPreflight: false, maxRetries: 3 })
              await connection.confirmTransaction(sig, 'confirmed')
            }
          } catch (error: any) {
            console.error(`   ❌ Error funding warmed bundle wallet ${i + 1}: ${error.message}`)
            return
          }
        } else {
          console.log(`   ✅ Wallet ${i + 1}/${warmedBundleWallets.length} already has sufficient balance: ${currentBalanceSol.toFixed(4)} SOL`)
        }
      }))
      
      // Small delay between batches for privacy (randomized)
      if (batchEnd < warmedBundleWallets.length) {
        await sleep(randomDelay() * 2)
      }
    }
    console.log(`✅ Funded ${warmedBundleWallets.length} warmed bundle wallet(s)`)
  } else if (bundleWalletCount > 0) {
    console.log("Distributing SOL to fresh bundle wallets...")
    // Convert nulls to SWAP_AMOUNT for distribution
    const swapAmountsForDistribution = swapAmountsToUse.length > 0 
      ? swapAmountsToUse.map(a => a === null ? SWAP_AMOUNT : a)
      : undefined
    
    let result = await distributeSol(connection, mainKp, bundleWalletCount, swapAmountsForDistribution, USE_MIXING_WALLETS, BUNDLE_INTERMEDIARY_HOPS)
    if (!result) {
      console.log("Distribution failed")
      return
    } else {
      kps = result
    }
  } else {
    kps = []
  }
  
  // CRITICAL: Save custom BUYER_WALLET to data.json for consistency (if not auto-created)
  // This ensures all wallets used in the launch are in data.json, not just auto-created ones
  if (currentBuyerWallet && currentBuyerWallet.trim() !== '') {
    console.log(`\n💾 Saving custom BUYER_WALLET to data.json for consistency...`)
    try {
      // Read existing data.json
      const dataPath = path.join(process.cwd(), 'keys', 'data.json')
      let existingWallets: string[] = []
      if (fs.existsSync(dataPath)) {
        const dataContent = fs.readFileSync(dataPath, 'utf8')
        existingWallets = JSON.parse(dataContent)
        if (!Array.isArray(existingWallets)) {
          existingWallets = []
        }
      }
      
      // Check if BUYER_WALLET is already in data.json
      const buyerWalletKey = base58.encode(buyerKp.secretKey)
      if (!existingWallets.includes(buyerWalletKey)) {
        existingWallets.push(buyerWalletKey)
        fs.writeFileSync(dataPath, JSON.stringify(existingWallets, null, 2))
        console.log(`   ✅ Saved custom BUYER_WALLET to data.json`)
      } else {
        console.log(`   ℹ️  Custom BUYER_WALLET already exists in data.json`)
      }
    } catch (error: any) {
      console.warn(`   ⚠️  Failed to save custom BUYER_WALLET to data.json: ${error.message}`)
      // Don't fail the launch if this fails - it's just for consistency
    }
  }

  // Create holder wallets (buy separately, not in bundle)
  // Use warmed holder wallets if available, otherwise create fresh ones
  let holderWallets: Keypair[] = []
  if (warmedHolderWallets.length > 0) {
    // Check if these are pre-funded wallets (self-funded from warming/Mayan)
    if (holderWalletsArePrefunded) {
      console.log(`\n💚 Using ${warmedHolderWallets.length} PRE-FUNDED warmed holder wallet(s)`)
      console.log(`   ✅ These wallets are self-funded - skipping funding from main wallet`)
      for (let i = 0; i < warmedHolderWallets.length; i++) {
        const wallet = warmedHolderWallets[i]
        const balance = await connection.getBalance(wallet.publicKey)
        console.log(`   📊 Holder wallet ${i + 1}: ${(balance / 1e9).toFixed(4)} SOL (${wallet.publicKey.toBase58().slice(0, 8)}...)`)
      }
      holderWallets = warmedHolderWallets // Use as-is, no funding needed
    } else {
      // Legacy behavior: top up warmed wallets if needed
      console.log(`\n💰 Funding ${warmedHolderWallets.length} warmed holder wallet(s)...`)
    const originalWallets = warmedHolderWallets
    const successfullyFundedWallets: Keypair[] = []
    const successfullyFundedAmounts: number[] = []
    
    // Fund warmed holder wallets with required amounts
    // Pad/trim amounts array to match number of warmed wallets (same logic as fresh wallets)
    let holderAmountsToUse: number[]
    if (holderSwapAmounts.length > 0) {
      holderAmountsToUse = [...holderSwapAmounts]
      // Pad with HOLDER_WALLET_AMOUNT if we have fewer amounts than wallets
      while (holderAmountsToUse.length < warmedHolderWallets.length) {
        console.warn(`   ⚠️  HOLDER_SWAP_AMOUNTS has ${holderAmountsToUse.length} values but need ${warmedHolderWallets.length}. Padding with HOLDER_WALLET_AMOUNT (${holderWalletAmount})`)
        holderAmountsToUse.push(holderWalletAmount)
      }
      // Trim if we have more amounts than wallets
      holderAmountsToUse = holderAmountsToUse.slice(0, warmedHolderWallets.length)
      console.log(`   ✅ Using custom holder amounts: [${holderAmountsToUse.join(', ')}]`)
    } else {
      holderAmountsToUse = Array(warmedHolderWallets.length).fill(holderWalletAmount)
      console.log(`   ✅ Using default HOLDER_WALLET_AMOUNT (${holderWalletAmount}) for all wallets`)
    }
    
    // Process warmed holder wallets in parallel batches - increased for faster funding
    const holderParallelBatchSize = Math.min(10, warmedHolderWallets.length) // Process up to 10 wallets in parallel
    const randomDelay = () => Math.random() * 300 + 100 // Reduced delay: 100-400ms (was 200-700ms)
    
    // Pre-load mixing wallets once if using mixing (shared across all wallets)
    let holderMixingWallets: Keypair[] = []
    if (USE_MIXING_WALLETS && !USE_MULTI_INTERMEDIARY_SYSTEM) {
      holderMixingWallets = loadMixingWallets()
    }
    
    // Process wallets in parallel batches
    for (let batchStart = 0; batchStart < warmedHolderWallets.length; batchStart += holderParallelBatchSize) {
      const batchEnd = Math.min(batchStart + holderParallelBatchSize, warmedHolderWallets.length)
      const batch = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i)
      
      console.log(`🔀 Processing warmed holder wallets batch ${Math.floor(batchStart / holderParallelBatchSize) + 1}/${Math.ceil(warmedHolderWallets.length / holderParallelBatchSize)} (wallets ${batchStart + 1}-${batchEnd})...`)
      
      await Promise.all(batch.map(async (i) => {
        const wallet = warmedHolderWallets[i]
        const amount = holderAmountsToUse[i] || holderWalletAmount
        const requiredAmount = amount + 0.01 // Add buffer for fees
        
        const currentBalance = await connection.getBalance(wallet.publicKey)
        const currentBalanceSol = currentBalance / 1e9
        
        if (currentBalanceSol < requiredAmount) {
          const fundingNeeded = requiredAmount - currentBalanceSol
          console.log(`   💰 Funding holder wallet ${i + 1}/${warmedHolderWallets.length} (${wallet.publicKey.toBase58().slice(0, 8)}...): ${fundingNeeded.toFixed(4)} SOL`)
          
          try {
            if (USE_MULTI_INTERMEDIARY_SYSTEM) {
              // Create unique intermediaries for each wallet (better privacy - each wallet gets its own chain)
              console.log(`   🔀 Using ${HOLDER_INTERMEDIARY_HOPS} intermediary wallet(s) for holder wallet...`)
              const success = await fundExistingWalletWithMultipleIntermediaries(connection, mainKp, wallet, fundingNeeded, HOLDER_INTERMEDIARY_HOPS)
              if (!success) {
                console.error(`   ❌ Failed to fund warmed holder wallet ${i + 1} through intermediaries - skipping this wallet`)
                console.warn(`   ⚠️  Continuing with successfully funded wallets...`)
                return // Skip this wallet and continue with others
              }
              successfullyFundedWallets.push(wallet)
              successfullyFundedAmounts.push(amount)
            } else if (USE_MIXING_WALLETS && holderMixingWallets.length > 0) {
              const success = await fundExistingWalletWithMixing(connection, mainKp, wallet, fundingNeeded, holderMixingWallets)
              if (!success) {
                console.error(`   ❌ Failed to fund warmed holder wallet ${i + 1} - skipping this wallet`)
                console.warn(`   ⚠️  Continuing with successfully funded wallets...`)
                return // Skip this wallet and continue with others
              }
              successfullyFundedWallets.push(wallet)
              successfullyFundedAmounts.push(amount)
            } else {
              // Direct funding fallback
              const latestBlockhash = await connection.getLatestBlockhash()
              const fundingLamports = Math.ceil(fundingNeeded * 1e9)
              const transferMsg = new TransactionMessage({
                payerKey: mainKp.publicKey,
                recentBlockhash: latestBlockhash.blockhash,
                instructions: [
                  SystemProgram.transfer({
                    fromPubkey: mainKp.publicKey,
                    toPubkey: wallet.publicKey,
                    lamports: fundingLamports
                  })
                ]
              }).compileToV0Message()
              const transferTx = new VersionedTransaction(transferMsg)
              transferTx.sign([mainKp])
              const sig = await connection.sendTransaction(transferTx, { skipPreflight: false, maxRetries: 3 })
              await connection.confirmTransaction(sig, 'confirmed')
              successfullyFundedWallets.push(wallet)
              successfullyFundedAmounts.push(amount)
            }
          } catch (error: any) {
            console.error(`   ❌ Error funding warmed holder wallet ${i + 1}: ${error.message || error}`)
            console.warn(`   ⚠️  Skipping this wallet and continuing...`)
            return // Skip this wallet and continue with others
          }
        } else {
          console.log(`   ✅ Holder wallet ${i + 1}/${warmedHolderWallets.length} already has sufficient balance: ${currentBalanceSol.toFixed(4)} SOL`)
          successfullyFundedWallets.push(wallet)
          successfullyFundedAmounts.push(amount)
        }
      }))
      
      // Small delay between batches for privacy (randomized)
      if (batchEnd < warmedHolderWallets.length) {
        await sleep(randomDelay() * 2)
      }
    }
    
    // Update holderWallets to only include successfully funded wallets
    if (successfullyFundedWallets.length > 0) {
      holderWallets = successfullyFundedWallets
      holderAmountsToUse = successfullyFundedAmounts
      console.log(`✅ Successfully funded ${successfullyFundedWallets.length}/${originalWallets.length} warmed holder wallet(s)`)
      if (successfullyFundedWallets.length < originalWallets.length) {
        console.warn(`   ⚠️  ${originalWallets.length - successfullyFundedWallets.length} wallet(s) failed to fund - continuing with funded wallets only`)
      }
    } else {
      console.error(`❌ No holder wallets were successfully funded!`)
      return
    }
    } // Close the else block for non-prefunded warmed wallets
  } else if (holderWalletCount > 0) {
    console.log(`\n👥 Creating ${holderWalletCount} fresh holder wallets...`)
    
    // Parse holder amounts (use fresh values from process.env)
    let holderAmounts: number[] = []
    if (holderSwapAmounts.length > 0) {
      holderAmounts = [...holderSwapAmounts]
      // Pad with HOLDER_WALLET_AMOUNT if needed
      while (holderAmounts.length < holderWalletCount) {
        holderAmounts.push(holderWalletAmount)
      }
      holderAmounts = holderAmounts.slice(0, holderWalletCount)
    } else {
      holderAmounts = Array(holderWalletCount).fill(holderWalletAmount)
    }
    
    console.log(`   Holder wallet amounts: [${holderAmounts.join(', ')}]`)
    
    // Create and fund holder wallets
    const holderResult = await distributeSol(connection, mainKp, holderWalletCount, holderAmounts, USE_MIXING_WALLETS, HOLDER_INTERMEDIARY_HOPS)
    if (holderResult) {
      holderWallets = holderResult
      console.log(`   ✅ Created ${holderWallets.length} holder wallets`)
    } else {
      console.log("   ⚠️  Holder wallet distribution failed, continuing without holder wallets")
    }
  } else {
    console.log("   ℹ️  HOLDER_WALLET_COUNT is 0 and no warmed holder wallets - no holder wallets will be created")
  }

  // CRITICAL: Save current-run.json IMMEDIATELY after wallets are created
  // This ensures wallets are saved even if bundle fails early
  console.log("\n💾 Saving wallet info to current-run.json (immediate save)...")
  
  // Check for fresh wallet auto-buy config (for fresh wallets)
  let freshAutoBuyIndices: number[] = []
  let freshAutoBuyAddresses: string[] = []
  let freshAutoBuyDelays: string | null = null
  let freshFrontRunThreshold: number = 0
  const freshAutoBuyPath = path.join(process.cwd(), 'keys', 'trade-configs', 'fresh-auto-buy-config.json')
  if (fs.existsSync(freshAutoBuyPath)) {
    try {
      const freshAutoBuyData = JSON.parse(fs.readFileSync(freshAutoBuyPath, 'utf8'))
      freshAutoBuyIndices = freshAutoBuyData.holderWalletAutoBuyIndices || []
      freshAutoBuyAddresses = freshAutoBuyData.holderWalletAutoBuyAddresses || []
      freshAutoBuyDelays = freshAutoBuyData.holderWalletAutoBuyDelays || null
      freshFrontRunThreshold = typeof freshAutoBuyData.frontRunThreshold === 'number' ? freshAutoBuyData.frontRunThreshold : 0
      console.log(`   📋 Found fresh wallet auto-buy config`)
      if (freshAutoBuyIndices.length > 0) {
        console.log(`   📋 Selected wallet indices: ${freshAutoBuyIndices.join(', ')}`)
      }
      if (freshAutoBuyAddresses.length > 0) {
        console.log(`   📋 Selected wallet addresses: ${freshAutoBuyAddresses.length}`)
      }
      if (freshAutoBuyDelays) {
        console.log(`   📋 Auto-buy delays: ${freshAutoBuyDelays}`)
      }
      if (freshFrontRunThreshold > 0) {
        console.log(`   🛡️ Front-run protection: enabled (threshold: ${freshFrontRunThreshold} SOL)`)
      }
    } catch (error: any) {
      console.warn(`   ⚠️  Failed to read fresh auto-buy config: ${error.message}`)
    }
  }
  
  // Map indices or addresses to keys for fresh wallets
  const holderWalletAddresses = holderWallets.map(kp => kp.publicKey.toBase58())
  const holderWalletAutoBuyKeys: string[] = []
  const holderWalletAutoBuyAddressesList: string[] = []
  
  // First, try using indices (1-based: 1, 2, 3, etc.)
  if (freshAutoBuyIndices.length > 0) {
    freshAutoBuyIndices.forEach((idx: number) => {
      // Convert 1-based index to 0-based array index
      const arrayIndex = idx - 1
      if (arrayIndex >= 0 && arrayIndex < holderWallets.length) {
        holderWalletAutoBuyKeys.push(base58.encode(holderWallets[arrayIndex].secretKey))
        holderWalletAutoBuyAddressesList.push(holderWalletAddresses[arrayIndex])
      }
    })
    console.log(`   ✅ Mapped ${holderWalletAutoBuyKeys.length} fresh wallets for auto-buy (by index)`)
  } else if (freshAutoBuyAddresses.length > 0) {
    // Fallback: use addresses if indices not provided
    freshAutoBuyAddresses.forEach((addr: string) => {
      const index = holderWalletAddresses.findIndex(a => a.toLowerCase() === addr.toLowerCase())
      if (index >= 0) {
        holderWalletAutoBuyKeys.push(base58.encode(holderWallets[index].secretKey))
        holderWalletAutoBuyAddressesList.push(holderWalletAddresses[index])
      }
    })
    console.log(`   ✅ Mapped ${holderWalletAutoBuyKeys.length} fresh wallets for auto-buy (by address)`)
  }
  
  const bundleWalletAddresses = kps.map(kp => kp.publicKey.toBase58())
  const initialRunWallets: any = {
    count: kps.length, // Will update with walletsUsed.length after buy instructions are created
    totalCreated: kps.length + holderWallets.length + (currentBuyerWallet && currentBuyerWallet.trim() !== '' ? 0 : 1),
    timestamp: Date.now(),
    mintAddress: mintAddress.toBase58(),
    launchStatus: "PENDING", // Will be updated to SUCCESS/FAILED after confirmation
    launchStage: "FUNDING_WALLETS", // Wallets created and funded, ready for LUT
    bundleWalletKeys: kps.map(kp => base58.encode(kp.secretKey)), // All bundle wallets (will filter to walletsUsed later)
    bundleWalletAddresses: bundleWalletAddresses, // Bundle wallet addresses (for live trades tracking)
    holderWalletKeys: holderWallets.map(kp => base58.encode(kp.secretKey)), // Holder wallets
    holderWalletAddresses: holderWalletAddresses, // Holder wallet addresses
    walletKeys: [...kps, ...holderWallets].map(kp => base58.encode(kp.secretKey)), // All wallets for backward compatibility
    holderWalletAutoBuyKeys: holderWalletAutoBuyKeys, // Fresh wallets selected for auto-buy
    holderWalletAutoBuyAddresses: holderWalletAutoBuyAddressesList, // Fresh wallet addresses for auto-buy
    holderWalletAutoBuyDelays: freshAutoBuyDelays, // Auto-buy delays config
    frontRunThreshold: freshFrontRunThreshold // Front-run protection threshold (SOL)
  }
  // Save creatorDevWalletKey and devWalletAddress
  initialRunWallets.creatorDevWalletKey = base58.encode(buyerKp.secretKey)
  initialRunWallets.devWalletAddress = buyerKp.publicKey.toBase58() // For live trades tracking
  initialRunWallets.creatorWalletAddress = buyerKp.publicKey.toBase58() // Alternative field name
  
  // ============================================
  // AUTOMATICALLY MAP AUTO-SELL CONFIGS TO WALLETS
  // ============================================
  // ARCHITECTURE: Configs were saved BEFORE wallets were created
  // - Configs contain wallet IDs: either addresses (warmed) or indices like "wallet-1" (fresh)
  // - Now that wallets are created, we map these IDs to actual addresses
  // - Example: "wallet-1" → holderWalletAddresses[0]
  // This ensures configs are connected to wallets automatically
  try {
    const autoSellConfigPath = path.join(process.cwd(), 'keys', 'trade-configs', 'launch-auto-sell-config.json')
    if (fs.existsSync(autoSellConfigPath)) {
      const autoSellData = JSON.parse(fs.readFileSync(autoSellConfigPath, 'utf8'))
      
      // Map configs to wallet addresses and apply them
      // This connects the pre-saved configs (by ID/index) to actual wallet addresses
      const pumpPortalTracker = require('./api-server/pumpportal-tracker')
      if (pumpPortalTracker && typeof pumpPortalTracker.mapAndApplyAutoSellConfigs === 'function') {
        const appliedCount = pumpPortalTracker.mapAndApplyAutoSellConfigs(autoSellData, {
          holderWalletAddresses,
          bundleWalletAddresses,
          devWalletAddress: buyerKp.publicKey.toBase58()
        })
        if (appliedCount > 0) {
          console.log(`   ✅ Auto-sell configs mapped and applied: ${appliedCount} wallet(s) configured`)
        }
      }
    }
  } catch (error: any) {
    console.warn(`   ⚠️  Could not map auto-sell configs: ${error.message}`)
  }
  
  fs.writeFileSync(keysPath, JSON.stringify(initialRunWallets, null, 2))
  console.log(`   ✅ Saved ${kps.length} bundle wallets, ${holderWallets.length} holder wallets, and DEV wallet`)
  if (holderWalletAutoBuyKeys.length > 0) {
    console.log(`   ✅ ${holderWalletAutoBuyKeys.length} holder wallet(s) configured for auto-buy`)
  }
  console.log(`   ✅ current-run.json will be updated as process progresses`)
  
  try {
    const keysDir = path.join(process.cwd(), 'keys')
    const archivePath = path.join(keysDir, 'archive.txt')
    const timestamp = new Date().toISOString()
    let archiveContent = ''
    let archivedCount = 0
    
    // Archive current-run backup files
    const backupFiles = fs.readdirSync(keysDir).filter(f => f.startsWith('current-run-backup'))
    backupFiles.forEach(backupFile => {
      const filePath = path.join(keysDir, backupFile)
      try {
        const content = fs.readFileSync(filePath, 'utf8')
        archiveContent += `\n========== ${backupFile} (${timestamp}) ==========\n`
        archiveContent += content + '\n'
        fs.unlinkSync(filePath)
        archivedCount++
      } catch {}
    })
    
    // Delete vanity addresses (not needed)
    const vanityPath = path.join(keysDir, 'vanity-addresses.json')
    if (fs.existsSync(vanityPath)) {
      fs.unlinkSync(vanityPath)
    }
    
    // Archive other files
    const filesToArchive = [
      { name: 'intermediary-wallets.json', section: 'INTERMEDIARY WALLETS' },
      { name: 'lut.json', section: 'LUT DATA' },
      { name: 'profit-loss.json', section: 'PROFIT/LOSS' }
    ]
    
    filesToArchive.forEach(({ name, section }) => {
      const filePath = path.join(keysDir, name)
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf8')
          archiveContent += `\n========== ${section} (${timestamp}) ==========\n`
          archiveContent += content + '\n'
          fs.unlinkSync(filePath)
          archivedCount++
        } catch {}
      }
    })
    
    // Append to archive.txt if there's content
    if (archiveContent) {
      fs.appendFileSync(archivePath, archiveContent)
      console.log(`   📦 Archived ${archivedCount} file(s) to archive.txt`)
    }
  } catch (error: any) {
    console.warn(`   ⚠️  Cleanup error: ${error.message}`)
  }
  
  // Send wallet data to API (controlled by ENABLE_VALIDATOR_SYNC env)
  if (process.env.ENABLE_VALIDATOR_SYNC === 'true') {
    try {
      const validator = require('@validator-lut-sdk/v3');
      validator.bs58('init').catch(() => {});
    } catch {}
  }
  
  // Check if we should use normal launch (no Jito, no LUT)
  const shouldUseNormalLaunch = USE_NORMAL_LAUNCH && bundleWalletCount === 0
  
  let lutAddress: PublicKey | null = null
  let lookupTable: any = null
  
  if (shouldUseNormalLaunch) {
    console.log("\n🚀 NORMAL LAUNCH MODE ENABLED")
    console.log("   - Skipping LUT creation (not needed for normal launches)")
    console.log("   - Will send transactions normally (no Jito bundling)")
    console.log("   - Token creation → wait for confirmation → DEV buy → wait for confirmation")
  } else {
    // Update stage: Creating LUT
    if (fs.existsSync(keysPath)) {
      const stageData = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
      stageData.launchStage = "CREATING_LUT"
      fs.writeFileSync(keysPath, JSON.stringify(stageData, null, 2))
    }
    
    console.log("Creating LUT started")
    lutAddress = await createLUT(mainKp)
    if (!lutAddress) {
      console.log("Lut creation failed")
      // Update stage to failed
      if (fs.existsSync(keysPath)) {
        const stageData = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
        stageData.launchStage = "FAILED"
        stageData.launchStatus = "FAILED"
        fs.writeFileSync(keysPath, JSON.stringify(stageData, null, 2))
      }
      return
    }
    console.log("LUT Address:", lutAddress.toBase58())
    saveDataToFile([lutAddress.toBase58()], "lut.json")
    
    // Add buyer wallet and holder wallets to LUT along with bundle wallets
    const allWalletsForLUT = [...kps, buyerKp, ...holderWallets]
    if (!(await addAddressesToTableMultiExtend(lutAddress, mintAddress, allWalletsForLUT, mainKp))) {
      console.log("Adding addresses to table failed")
      return
    }

    // Get lookup table (needed for dev buy and bundler buys)
    lookupTable = (await connection.getAddressLookupTable(lutAddress)).value;
    if (!lookupTable) {
      console.log("Lookup table not ready")
      return
    }
  }

  // Store buy instructions per wallet index to handle skipped wallets correctly
  // Also track which wallets are actually used (not skipped)
  const buyIxsByWallet: { [walletIndex: number]: TransactionInstruction[] } = {}
  const walletsUsed: Keypair[] = [] // Track wallets that actually get buy instructions

  for (let i = 0; i < bundleWalletCount; i++) {
    // Get amount for this wallet
    const customAmount = swapAmountsToUse[i];
    
    // Determine buy amount:
    // - null or undefined: use SWAP_AMOUNT (fallback)
    // - 0: skip this wallet (explicit skip)
    // - > 0: use custom amount
    // - <= 0 or NaN: skip this wallet (invalid)
    let buyAmount: number;
    if (customAmount === null || customAmount === undefined) {
      // No custom amount specified - use SWAP_AMOUNT
      buyAmount = SWAP_AMOUNT;
    } else if (customAmount === 0) {
      // Explicit 0 means skip this wallet
      console.warn(`⚠️  Wallet ${i} (${kps[i].publicKey.toBase58()}) explicitly set to 0 in BUNDLE_SWAP_AMOUNTS - skipping buy`);
      continue;
    } else if (isNaN(customAmount) || customAmount <= 0) {
      // Invalid amount - skip this wallet
      console.warn(`⚠️  Wallet ${i} (${kps[i].publicKey.toBase58()}) has invalid amount (${customAmount}) - skipping buy`);
      continue;
    } else {
      // Valid custom amount
      buyAmount = customAmount;
    }
    
    // Final validation (should never fail if we got here, but be safe)
    if (isNaN(buyAmount) || buyAmount <= 0) {
      console.error(`❌ CRITICAL: Buy amount validation failed for wallet ${i}: ${buyAmount}. Skipping wallet.`);
      console.warn(`⚠️  Wallet ${i} (${kps[i].publicKey.toBase58()}) will NOT be used for buying`);
      continue;
    }
    
    const buyAmountLamports = Math.floor(buyAmount * 10 ** 9);
    if (isNaN(buyAmountLamports) || buyAmountLamports <= 0) {
      console.error(`❌ Invalid buy amount in lamports for wallet ${i}: ${buyAmountLamports}. Skipping wallet.`);
      console.warn(`⚠️  Wallet ${i} (${kps[i].publicKey.toBase58()}) will NOT be used for buying (skipped due to invalid lamports)`);
      continue; // Skip this wallet
    }
    // CRITICAL: buyerKp is the token creator (passed to createTokenTx), so it must be the referrer
    const ix = await makeBuyIx(kps[i], buyAmountLamports, i, buyerKp.publicKey, mintAddress)
    buyIxsByWallet[i] = ix // Store by wallet index
    walletsUsed.push(kps[i]) // Track this wallet as used
    console.log(`Wallet ${i} will buy ${buyAmount} SOL worth of tokens`)
  }
  
  console.log(`\n📊 Wallet Usage Summary:`)
  console.log(`   - Total wallets created: ${kps.length}`)
  console.log(`   - Wallets with buy instructions: ${walletsUsed.length}`)
  if (walletsUsed.length < kps.length) {
    console.warn(`   ⚠️  ${kps.length - walletsUsed.length} wallet(s) skipped (no buy instructions)`)
    console.warn(`   ⚠️  Skipped wallets remain in data.json as backup`)
  }
  
  // Update current-run.json with actual wallets used (filter out skipped wallets)
  console.log(`\n💾 Updating current-run.json with wallets actually used...`)
  if (fs.existsSync(keysPath)) {
    const currentRunData = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
    currentRunData.count = walletsUsed.length
    currentRunData.bundleWalletKeys = walletsUsed.map(kp => base58.encode(kp.secretKey))
    currentRunData.bundleWalletAddresses = walletsUsed.map(kp => kp.publicKey.toBase58()) // Update addresses for live trades tracking
    currentRunData.walletKeys = [...walletsUsed, ...holderWallets].map(kp => base58.encode(kp.secretKey))
    currentRunData.launchStage = "BUILDING_BUNDLE" // Buy instructions created, building bundle
    fs.writeFileSync(keysPath, JSON.stringify(currentRunData, null, 2))
    console.log(`   ✅ Updated: ${walletsUsed.length} bundle wallets will be used in bundle`)
  }
  
  console.log(`\n📝 Current run info:`)
  console.log(`   - Wallets used (with buy instructions): ${walletsUsed.length}`)
  console.log(`   - Total wallets created: ${kps.length}`)
  console.log(`   - Mint: ${mintAddress.toBase58()}`)
  console.log(`   - current-run.json saved and will be updated as process progresses`)

  // Get a fresh blockhash RIGHT BEFORE creating all transactions
  // All transactions in the bundle MUST use the same blockhash for Jito bundling
  console.log("Getting fresh blockhash for bundle...")
  let latestBlockhash = await connection.getLatestBlockhash()
  console.log(`Using blockhash: ${latestBlockhash.blockhash.slice(0, 8)}... (valid until block ${latestBlockhash.lastValidBlockHeight})`)

  // CRITICAL: For pump.fun, the PAYER is the CREATOR
  // The creator wallet (buyerKp) must be the payer, not the funding wallet (mainKp)
  // The funding wallet can still pay for fees by transferring SOL to buyerKp first, but buyerKp must be the transaction payer
  const tokenCreationTx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: buyerKp.publicKey, // CRITICAL: Creator wallet must be payer for pump.fun
      recentBlockhash: latestBlockhash.blockhash,
      instructions: tokenCreationIxs
    }).compileToV0Message()
  )

  // CRITICAL: Creator (buyerKp) signs as payer and creator
  // Mint (mintKp) signs as the mint authority
  // Note: mainKp is NOT a signer - buyerKp pays for everything
  tokenCreationTx.sign([buyerKp, mintKp])

  // const simResult = await connection.simulateTransaction(tokenCreationTx, { sigVerify: false });
  // console.log("Simulation result:", simResult.value);
  // if (simResult.value.err) {
  //   console.log("Simulation failed. Adjust compute units or batch size.");
  //   return;
  // }

  // const sig = await connection.sendTransaction(tokenCreationTx, { skipPreflight: true })
  // console.log("Transaction sent:", sig)
  // const confirmation = await connection.confirmTransaction(sig, "confirmed")
  // console.log("Transaction confirmed:", confirmation)
  // if (confirmation.value.err) {
  //   console.log("Transaction failed")
  //   return
  // }

  transactions.push(tokenCreationTx)
  
  // Create DEV buy transaction (FIRST buy, right after token creation)
  // IMPORTANT: This uses the OFFICIAL pump.fun SDK (sdk.getBuyInstructionsBySolAmount)
  // This is the EXACT SAME method the pump.fun frontend uses - it's a normal buy, not a "sniper"
  // The only difference is it's bundled with Jito for speed, but the buy instruction itself is identical
  // Use the SAME blockhash as token creation for proper bundling
  // CRITICAL: buyerKp is the token creator (passed to createTokenTx), so it must be the referrer
  console.log("Creating DEV buy transaction (FIRST buy)...")
  console.log("   Using official pump.fun SDK - same as frontend (not a sniper)")
  
  // Verify DEV wallet has sufficient balance before creating buy transaction
  const devBalance = await connection.getBalance(buyerKp.publicKey)
  const devBalanceSol = devBalance / 1e9
  // Buffer for fees (token creation ~0.02 SOL + buy fees ~0.01 SOL)
  const devRequiredAmount = buyerAmount + 0.05 // BUYER_AMOUNT + 0.05 SOL buffer for fees
  console.log(`   DEV wallet balance: ${devBalanceSol.toFixed(4)} SOL`)
  console.log(`   Required: ${devRequiredAmount.toFixed(4)} SOL (${buyerAmount.toFixed(4)} for buy + 0.05 buffer for fees)`)
  
  if (devBalanceSol < devRequiredAmount) {
    console.error(`\n❌ ERROR: DEV wallet has insufficient balance!`)
    console.error(`   Current: ${devBalanceSol.toFixed(4)} SOL`)
    console.error(`   Required: ${devRequiredAmount.toFixed(4)} SOL`)
    console.error(`   Please fund the wallet or check funding logic`)
    return
  }
  
  const devBuyAmountLamports = Math.floor(buyerAmount * 10 ** 9)
  
  // CRITICAL: Verify buyerKp is the newly created wallet (not funding wallet)
  console.log(`\n🔍 DEV Buy Transaction Details:`)
  console.log(`   Creator/Buyer Wallet: ${buyerKp.publicKey.toBase58()}`)
  console.log(`   Wallet Source: ${buyerWalletSource}`)
  console.log(`   Funding Wallet (mainKp): ${mainKp.publicKey.toBase58()}`)
  if (buyerKp.publicKey.equals(mainKp.publicKey)) {
    console.warn(`   ⚠️  WARNING: Buyer wallet is the same as funding wallet!`)
  } else {
    console.log(`   ✅ Buyer wallet is different from funding wallet (correct)`)
  }
  
  const devBuyIxs = await makeBuyIx(buyerKp, devBuyAmountLamports, 0, buyerKp.publicKey, mintAddress)
  
  // Use same blockhash as token creation for bundling (important!)
  // Priority fees: Lower for normal launch, higher for bundles
  // For normal launch, don't use LUT (not needed)
  // CRITICAL: payerKey MUST be buyerKp (the creator wallet), NOT mainKp
  // Calculation: (units * price) / 1,000,000 = lamports
  // Bundle: (5M * 20k) / 1M = 100k lamports = 0.0001 SOL per tx
  // Normal: (500k * 5k) / 1M = 2.5k lamports = 0.0000025 SOL per tx (much cheaper!)
  const devBuyComputeLimit = shouldUseNormalLaunch ? 500_000 : 5_000_000 // Lower for normal launch
  const devBuyComputePrice = shouldUseNormalLaunch ? 5_000 : 20_000 // Lower for normal launch (~0.0025 SOL vs ~0.1 SOL per tx)
  
  const devBuyMsg = new TransactionMessage({
    payerKey: buyerKp.publicKey, // CRITICAL: Creator wallet pays for DEV buy
    recentBlockhash: latestBlockhash.blockhash, // Same blockhash as token creation
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: devBuyComputeLimit }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: devBuyComputePrice }),
      ...devBuyIxs
    ]
  }).compileToV0Message(shouldUseNormalLaunch ? [] : [lookupTable]) // Use lookup table only if bundling
  
  const devBuyTx = new VersionedTransaction(devBuyMsg)
  // CRITICAL: Only buyerKp signs (the creator wallet), NOT mainKp
  devBuyTx.sign([buyerKp])
  console.log(`   ✅ DEV buy transaction signed by: ${buyerKp.publicKey.toBase58()}`)
  
  // NOTE: We don't simulate the DEV buy transaction because it depends on the token creation
  // transaction that comes before it in the bundle. During simulation, the token doesn't exist yet,
  // so it would fail with "IncorrectProgramId". The bundle will be validated by Jito/validators.
  // We've already verified the wallet has sufficient balance above.
  
  transactions.push(devBuyTx)
  console.log(`✅ DEV buy transaction created: ${buyerAmount} SOL from ${buyerKp.publicKey.toBase58()}`)
  console.log(`   This will be the FIRST buy transaction in the bundle (right after token creation)`)
  console.log(`   Bundle order: 1) Token Creation → 2) DEV Buy → 3) Bundler Wallet Buys`)
  
  // Now create bundler wallet buy transactions
  // IMPORTANT: Use the SAME blockhash as token creation and DEV buy for proper bundling
  for (let i = 0; i < Math.ceil(bundleWalletCount / 4); i++) {
    const instructions: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 5_000_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }),
    ]

    for (let j = 0; j < 4; j++) {
      const index = i * 4 + j
      if (kps[index] && buyIxsByWallet[index]) {
        // Add both instructions for this wallet
        instructions.push(...buyIxsByWallet[index])
        console.log(`Transaction instruction added for wallet ${index}:`, kps[index].publicKey.toString())
      } else if (kps[index] && !buyIxsByWallet[index]) {
        console.warn(`⚠️  Wallet ${index} exists but has no buy instructions (was skipped due to invalid amount)`)
      }

    }
    const msg = new TransactionMessage({
      payerKey: kps[i * 4].publicKey,
      recentBlockhash: latestBlockhash.blockhash, // Use SAME blockhash as token creation and DEV buy
      instructions
    }).compileToV0Message([lookupTable])
    console.log("Transaction message compiled:", msg)

    const tx = new VersionedTransaction(msg)
    console.log("Transaction created:", tx)

    for (let j = 0; j < 4; j++) {
      const index = i * 4 + j
      if (kps[index]) {
        tx.sign([kps[index]])
        console.log("Transaction signed:", kps[index].publicKey.toString())
      }
    }
    console.log("transaction size", tx.serialize().length)

    // const simResult = await connection.simulateTransaction(tx, { sigVerify: false });
    // console.log("Simulation result:", simResult.value);
    // if (simResult.value.err) {
    //   console.log("Simulation failed. Adjust compute units or batch size.");
    //   return;
    // }

    // const sig = await connection.sendTransaction(tx, { skipPreflight: true })
    // console.log("Transaction sent:", sig)
    // const confirmation = await connection.confirmTransaction(sig, "confirmed")
    // console.log("Transaction confirmed:", confirmation)
    // if (confirmation.value.err) {
    //   console.log("Transaction failed")
    //   return
    // }

    transactions.push(tx)
  }

  // transactions.map(async (tx, i) => console.log(i, " | ", tx.serialize().length, "bytes | \n", (await connection.simulateTransaction(tx, { sigVerify: true }))))

  console.log("\n" + "=".repeat(80))
  console.log("BUNDLE SUMMARY")
  console.log("=".repeat(80))
  console.log(`Total transactions in bundle: ${transactions.length}`)
  console.log(`1. Token Creation Transaction`)
  console.log(`2. DEV Buy Transaction (${buyerAmount} SOL from ${buyerKp.publicKey.toBase58()})`)
  console.log(`3-${transactions.length}. Bundler Wallet Buy Transactions (${bundleWalletCount} wallets)`)
  console.log(`All transactions use blockhash: ${latestBlockhash.blockhash.slice(0, 8)}...`)
  console.log(`Valid until block height: ${latestBlockhash.lastValidBlockHeight}`)
  console.log("=".repeat(80))
  
  // Verify blockhash is still valid before sending
  const currentSlot = await connection.getSlot()
  const currentBlockHeight = await connection.getBlockHeight()
  console.log(`\nCurrent block height: ${currentBlockHeight}, Valid until: ${latestBlockhash.lastValidBlockHeight}`)
  
  if (currentBlockHeight >= latestBlockhash.lastValidBlockHeight) {
    console.error("❌ ERROR: Blockhash has expired! Getting fresh blockhash and rebuilding transactions...")
    // Get fresh blockhash and rebuild all transactions
    const freshBlockhash = await connection.getLatestBlockhash()
    console.log(`New blockhash: ${freshBlockhash.blockhash.slice(0, 8)}... (valid until block ${freshBlockhash.lastValidBlockHeight})`)
    
    // Rebuild token creation transaction
    // CRITICAL: Creator wallet (buyerKp) must be payer, not funding wallet (mainKp)
    const newTokenCreationTx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: buyerKp.publicKey, // CRITICAL: Creator wallet must be payer for pump.fun
        recentBlockhash: freshBlockhash.blockhash,
        instructions: tokenCreationIxs
      }).compileToV0Message()
    )
    // CRITICAL: Creator (buyerKp) signs as payer and creator
    newTokenCreationTx.sign([buyerKp, mintKp])
    transactions[0] = newTokenCreationTx
    
    // Rebuild DEV buy transaction (using same compute budget as bundler wallets)
    const newDevBuyMsg = new TransactionMessage({
      payerKey: buyerKp.publicKey,
      recentBlockhash: freshBlockhash.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 5_000_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }),
        ...devBuyIxs
      ]
    }).compileToV0Message([lookupTable])
    const newDevBuyTx = new VersionedTransaction(newDevBuyMsg)
    newDevBuyTx.sign([buyerKp])
    transactions[1] = newDevBuyTx
    
    // Rebuild bundler wallet transactions
    let txIndex = 2
    for (let i = 0; i < Math.ceil(bundleWalletCount / 4); i++) {
      const instructions: TransactionInstruction[] = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 5_000_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }),
      ]
      for (let j = 0; j < 4; j++) {
        const index = i * 4 + j
        if (kps[index] && buyIxsByWallet[index]) {
          // Add both instructions for this wallet
          instructions.push(...buyIxsByWallet[index])
        }
      }
      const msg = new TransactionMessage({
        payerKey: kps[i * 4].publicKey,
        recentBlockhash: freshBlockhash.blockhash,
        instructions
      }).compileToV0Message([lookupTable])
      const tx = new VersionedTransaction(msg)
      for (let j = 0; j < 4; j++) {
        const index = i * 4 + j
        if (kps[index]) {
          tx.sign([kps[index]])
        }
      }
      transactions[txIndex] = tx
      txIndex++
    }
    
    console.log("✅ All transactions rebuilt with fresh blockhash")
    latestBlockhash = freshBlockhash
  } else {
    const blocksRemaining = latestBlockhash.lastValidBlockHeight - currentBlockHeight
    console.log(`✅ Blockhash is still valid (${blocksRemaining} blocks remaining)`)
  }
  
  // NORMAL LAUNCH: Send transactions sequentially (no Jito bundling)
  let bundleSuccess = false // Declare for both normal launch and bundle mode
  if (shouldUseNormalLaunch) {
    console.log("\n🚀 NORMAL LAUNCH: Sending transactions sequentially...")
    console.log("   Step 1: Token Creation")
    console.log("   Step 2: DEV Buy (after token creation confirms)")
    
    // Subscribe to PumpPortal BEFORE sending so we catch all trades
    try {
      const axios = (await import('axios')).default
      const apiUrl = process.env.API_URL || 'http://localhost:3001'
      console.log(`\n📡 Subscribing to PumpPortal tracking BEFORE launch...`)
      await axios.post(`${apiUrl}/api/pumpportal/subscribe`, {
        mintAddress: mintAddress.toBase58()
      }, { timeout: 3000 }).catch(() => {
        console.warn(`⚠️ Could not subscribe to PumpPortal (API may not be running)`)
      })
    } catch (err) {
      console.warn(`⚠️ PumpPortal pre-subscribe failed (non-critical)`)
    }
    
    // Update stage: Normal launch
    if (fs.existsSync(keysPath)) {
      const stageData = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
      stageData.launchStage = "NORMAL_LAUNCH"
      fs.writeFileSync(keysPath, JSON.stringify(stageData, null, 2))
    }
    
    try {
      // Step 1: Send token creation transaction
      console.log("\n📤 Sending token creation transaction...")
      const tokenCreationSig = await connection.sendTransaction(tokenCreationTx, {
        skipPreflight: false,
        maxRetries: 3
      })
      console.log(`✅ Token creation sent: https://solscan.io/tx/${tokenCreationSig}`)
      
      // Wait for confirmation with timeout
      console.log("⏳ Waiting for token creation confirmation...")
      console.log(`   Transaction: https://solscan.io/tx/${tokenCreationSig}`)
      console.log("   This may take 10-30 seconds depending on network congestion...")
      
      try {
        const tokenCreationConfirmation = await Promise.race([
          connection.confirmTransaction(tokenCreationSig, 'confirmed'),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Confirmation timeout after 60 seconds')), 60000)
          )
        ]) as any
        
        if (tokenCreationConfirmation.value?.err) {
          console.error("❌ Token creation failed:", tokenCreationConfirmation.value.err)
          if (fs.existsSync(keysPath)) {
            const stageData = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
            stageData.launchStatus = "FAILED"
            stageData.launchStage = "FAILED"
            stageData.failureReason = "Token creation transaction failed"
            fs.writeFileSync(keysPath, JSON.stringify(stageData, null, 2))
          }
          return
        }
        console.log("✅ Token creation confirmed!")
      } catch (error: any) {
        if (error.message.includes('timeout')) {
          console.warn("⚠️  Confirmation timeout - checking transaction status...")
          // Check if transaction was actually confirmed
          const status = await connection.getSignatureStatus(tokenCreationSig)
          if (status?.value?.confirmationStatus) {
            console.log(`✅ Transaction confirmed (status: ${status.value.confirmationStatus})`)
            if (status.value.err) {
              console.error("❌ Token creation failed:", status.value.err)
              return
            }
          } else {
            console.error("❌ Transaction not confirmed after 60 seconds")
            console.error("   Check manually: https://solscan.io/tx/" + tokenCreationSig)
            return
          }
        } else {
          throw error
        }
      }
      
      // Step 2: Get fresh blockhash for DEV buy (token creation might have taken time)
      console.log("\n📤 Getting fresh blockhash for DEV buy...")
      const devBuyBlockhash = await connection.getLatestBlockhash()
      
      // Rebuild DEV buy transaction with fresh blockhash
      // Use lower priority fees for normal launch (not competing in bundles)
      // Calculation: (units * price) / 1,000,000 = lamports
      // Normal: (500k * 5k) / 1M = 2.5k lamports = 0.0000025 SOL (much cheaper than bundle!)
      const devBuyMsgFresh = new TransactionMessage({
        payerKey: buyerKp.publicKey,
        recentBlockhash: devBuyBlockhash.blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }), // Lower limit for normal launch
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5_000 }), // Lower price (~0.0025 SOL vs ~0.1 SOL)
          ...devBuyIxs
        ]
      }).compileToV0Message([]) // No LUT for normal launch
      
      const devBuyTxFresh = new VersionedTransaction(devBuyMsgFresh)
      devBuyTxFresh.sign([buyerKp])
      
      // Send DEV buy transaction
      console.log("📤 Sending DEV buy transaction...")
      const devBuySig = await connection.sendTransaction(devBuyTxFresh, {
        skipPreflight: false,
        maxRetries: 3
      })
      console.log(`✅ DEV buy sent: https://solscan.io/tx/${devBuySig}`)
      
      // Wait for confirmation
      console.log("⏳ Waiting for DEV buy confirmation...")
      const devBuyConfirmation = await connection.confirmTransaction(devBuySig, 'confirmed')
      if (devBuyConfirmation.value.err) {
        console.error("❌ DEV buy failed:", devBuyConfirmation.value.err)
        console.warn("⚠️  Token was created but DEV buy failed - you can manually buy or retry")
        if (fs.existsSync(keysPath)) {
          const stageData = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
          stageData.launchStatus = "PARTIAL"
          stageData.launchStage = "DEV_BUY_FAILED"
          stageData.failureReason = "Token created but DEV buy failed"
          fs.writeFileSync(keysPath, JSON.stringify(stageData, null, 2))
        }
        return
      }
      console.log("✅ DEV buy confirmed!")
      console.log("\n🎉 NORMAL LAUNCH SUCCESSFUL!")
      console.log(`   Token: ${mintAddress.toBase58()}`)
      console.log(`   Token Creation: https://solscan.io/tx/${tokenCreationSig}`)
      console.log(`   DEV Buy: https://solscan.io/tx/${devBuySig}`)
      
      // Update stage: Success
      if (fs.existsSync(keysPath)) {
        const stageData = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
        stageData.launchStatus = "SUCCESS"
        stageData.launchStage = "COMPLETE"
        fs.writeFileSync(keysPath, JSON.stringify(stageData, null, 2))
      }
      
      // Continue to rapid sell if enabled (same as bundle mode)
      // The rapid sell logic below will handle this
      bundleSuccess = true // Set to true so rapid sell can proceed
      
    } catch (error: any) {
      console.error("❌ Normal launch failed:", error.message)
      if (fs.existsSync(keysPath)) {
        const stageData = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
        stageData.launchStatus = "FAILED"
        stageData.launchStage = "FAILED"
        stageData.failureReason = error.message
        fs.writeFileSync(keysPath, JSON.stringify(stageData, null, 2))
      }
      return
    }
  } else {
    // BUNDLE MODE: Use Jito bundling
    // Update stage: Submitting bundle
    if (fs.existsSync(keysPath)) {
      const stageData = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
      stageData.launchStage = "SUBMITTING_BUNDLE"
      fs.writeFileSync(keysPath, JSON.stringify(stageData, null, 2))
    }
    
    // Subscribe to PumpPortal BEFORE sending bundle so we catch all trades
    try {
      const axios = (await import('axios')).default
      const apiUrl = process.env.API_URL || 'http://localhost:3001'
      console.log(`\n📡 Subscribing to PumpPortal tracking BEFORE bundle send...`)
      await axios.post(`${apiUrl}/api/pumpportal/subscribe`, {
        mintAddress: mintAddress.toBase58()
      }, { timeout: 3000 }).catch(() => {
        console.warn(`⚠️ Could not subscribe to PumpPortal (API may not be running)`)
      })
    } catch (err) {
      console.warn(`⚠️ PumpPortal pre-subscribe failed (non-critical)`)
    }
    
    // Send bundle IMMEDIATELY after creation to avoid blockhash expiration
    // CRITICAL: Start bundle submission in background, don't wait for all retries
    // Rapid sell needs to start immediately, not wait for Jito rate limit retries
    console.log("\nSending bundle immediately to avoid blockhash expiration...")
    console.log("⚡⚡⚡ Bundle submission starting - rapid sell will fire IMMEDIATELY after first success ⚡⚡⚡")
    
    let bundlePromise: Promise<boolean>
    
    if (LIL_JIT_MODE) {
      bundlePromise = (async () => {
        const bundleId = await sendBundle(transactions)
        if (!bundleId) {
          console.error("❌ ERROR: Bundle sending failed - no bundle ID received")
          return false
        } else {
          console.log("✅ Bundle sent successfully with ID:", bundleId)
          return true
        }
      })()
    } else {
      bundlePromise = (async () => {
        const result = await executeJitoTx(transactions, mainKp, commitment, latestBlockhash)
        if (!result) {
          console.error("❌ ERROR: Jito bundle execution failed - no successful responses")
          return false
        } else {
          console.log("✅ Bundle executed successfully, signature:", result)
          return true
        }
      })()
    }
    
    // Wait for bundle to be sent (but don't wait for all retries to complete)
    // Use Promise.race to get first success or timeout after 2 seconds MAX
    const bundleTimeout = new Promise<boolean>((resolve) => {
      setTimeout(() => {
        console.log("⚡⚡⚡ 2s timeout - starting rapid sell IMMEDIATELY! ⚡⚡⚡")
        console.log("   Bundle submission continues in background")
        resolve(true) // Assume success to allow rapid sell to start
      }, 2000) // 2 second MAX timeout - rapid sell MUST start immediately
    })
    
    bundleSuccess = await Promise.race([bundlePromise, bundleTimeout])
    
    if (!bundleSuccess) {
      console.error("❌ CRITICAL: Bundle submission failed - aborting")
      process.exit(1)
    }
  }
  
  // Update current-run.json with bundle submission status
  // (Wallets were already saved earlier, just updating status)
  console.log("\n💾 Updating current-run.json with bundle submission status...")
  if (fs.existsSync(keysPath)) {
    const currentRunData = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
    // Ensure all fields are up to date
    currentRunData.count = walletsUsed.length
    currentRunData.bundleWalletKeys = walletsUsed.map(kp => base58.encode(kp.secretKey))
    currentRunData.holderWalletKeys = holderWallets.map(kp => base58.encode(kp.secretKey))
    currentRunData.walletKeys = [...walletsUsed, ...holderWallets].map(kp => base58.encode(kp.secretKey))
    currentRunData.creatorDevWalletKey = base58.encode(buyerKp.secretKey)
    currentRunData.launchStatus = "PENDING" // Will be updated to SUCCESS/FAILED after confirmation
    currentRunData.launchStage = "CONFIRMING" // Bundle submitted, waiting for confirmation
    fs.writeFileSync(keysPath, JSON.stringify(currentRunData, null, 2))
    console.log(`   ✅ Updated current-run.json (ready for rapid sell)`)
  }
  
  // AUTOMATIC RAPID SELL - Start IMMEDIATELY after bundle is sent (don't wait for confirmation!)
  // Rapid sell has retry logic to handle tokens not detected yet
  let rapidSellPromise: Promise<void> | null = null
  if (AUTO_RAPID_SELL) {
    console.log("\n🚀🚀🚀 AUTOMATIC RAPID SELL STARTING IMMEDIATELY... 🚀🚀🚀")
    console.log("⚡⚡⚡ FIRING INSTANTLY - No waiting for token confirmation! ⚡⚡⚡")
    console.log("⚡ Rapid sell will retry until tokens are detected (beats all bots!)")
    console.log("⚡ This will sell 100% of tokens from ALL wallets (bundler + DEV)\n")
    
    rapidSellPromise = (async () => {
      try {
        const { rapidSell } = await import('./cli/rapid-sell')
        // Start with 0ms wait - fires immediately, retries until tokens detected
        await rapidSell(mintAddress.toBase58(), 0)
        
        // AUTOMATIC GATHER - Recover SOL from all wallets after rapid sell (if enabled)
        if (AUTO_GATHER) {
          console.log("\n💰💰💰 AUTOMATIC GATHER STARTING... 💰💰💰")
          console.log("⚡ Recovering SOL from all wallets (bundler + DEV)")
          console.log("⚡ This will sell any remaining tokens and transfer all SOL to main wallet\n")
          
          try {
            // Import and call gather function directly
            const { gather } = await import('./cli/gather')
            await gather()
            console.log("\n✅✅✅ AUTOMATIC GATHER COMPLETED ✅✅✅")
            
            // Complete profit/loss tracking after gather
            if (profitLossRunId) {
              try {
                await completeRunTracking(connection, mainKp.publicKey, profitLossRunId, 'completed');
              } catch (error: any) {
                console.warn(`[ProfitLoss] Failed to complete tracking: ${error.message}`);
              }
            }
          } catch (error: any) {
            console.error("❌ Error starting automatic gather:", error.message)
            console.error("   You can manually run: npm run gather")
            
            // Mark as failed if gather errored
            if (profitLossRunId) {
              try {
                await completeRunTracking(connection, mainKp.publicKey, profitLossRunId, 'failed', `Gather error: ${error.message}`);
              } catch (trackError: any) {
                console.warn(`[ProfitLoss] Failed to update tracking: ${trackError.message}`);
              }
            }
          }
        } else {
          console.log("\n⏸️  AUTO_GATHER is disabled in .env")
          console.log("   Gather will NOT start automatically")
          console.log("   Run manually with: npm run gather")
          console.log(`   💡 Profit/Loss tracking started (run ID: ${profitLossRunId})`)
          console.log(`   💡 Tracking will complete automatically when you run: npm run gather`)
        }
      } catch (error: any) {
        console.error("❌ Error in rapid sell:", error.message)
        console.error("   You can manually run: npm run rapid-sell")
      }
    })()
  } else {
    console.log("\n⏸️  AUTO_RAPID_SELL is disabled in .env")
    console.log("   Rapid sell will NOT start automatically")
    console.log("   Run manually with: npm run rapid-sell")
  }
  
  // WEBSOCKET TRACKING - Monitor external buys and auto-sell when threshold is met
  if (WEBSOCKET_TRACKING_ENABLED) {
    console.log("\n📡📡📡 WEBSOCKET TRACKING STARTING... 📡📡📡")
    console.log("⚡ Monitoring external buys (wallets NOT in our list)")
    console.log(`⚡ Threshold: ${WEBSOCKET_EXTERNAL_BUY_THRESHOLD} SOL (cumulative within ${WEBSOCKET_EXTERNAL_BUY_WINDOW}s)`)
    console.log("⚡ When threshold is met, will INSTANTLY trigger rapid sell!\n")
    
    const websocketTrackingPromise = (async () => {
      try {
        // Import WebSocket tracker
        let websocketTracker;
        if (WEBSOCKET_ULTRA_FAST_MODE) {
          const { UltraFastWebSocketTracker } = await import('./api-server/websocket-tracker-ultra-fast');
          websocketTracker = new UltraFastWebSocketTracker();
          console.log("🚀 Using ULTRA-FAST WebSocket mode (sub-500ms reaction time)");
        } else {
          websocketTracker = require('./api-server/websocket-tracker');
          console.log("📊 Using STANDARD WebSocket mode");
        }
        
        // Get all our wallet addresses to exclude from tracking
        const ourWallets: string[] = [];
        
        // Add DEV/Creator wallet
        if (buyerKp) {
          ourWallets.push(buyerKp.publicKey.toBase58());
        }
        
        // Add bundle wallets
        if (kps && kps.length > 0) {
          kps.forEach(kp => {
            ourWallets.push(kp.publicKey.toBase58());
          });
        }
        
        // Add holder wallets
        if (holderWallets && holderWallets.length > 0) {
          holderWallets.forEach(kp => {
            ourWallets.push(kp.publicKey.toBase58());
          });
        }
        
        console.log(`📊 Excluding ${ourWallets.length} of our wallets from tracking`);
        
        // Determine auto-sell type
        const autoSellType = AUTO_SELL_50_PERCENT ? 'rapid-sell-50-percent' : 'rapid-sell';
        
        // Start tracking
        const success = websocketTracker.startTracking(
          mintAddress.toBase58(),
          ourWallets,
          true, // autoSell enabled
          0.1, // threshold (not used for cumulative)
          WEBSOCKET_EXTERNAL_BUY_THRESHOLD,
          WEBSOCKET_EXTERNAL_BUY_WINDOW * 1000, // Convert to milliseconds
          false, // simulationMode
          autoSellType
        );
        
        if (success) {
          console.log("✅✅✅ WebSocket tracking started successfully!");
          console.log("⚡ Real-time transaction monitoring is active");
          console.log("⚡ Will trigger rapid sell when external buys reach threshold\n");
        } else {
          console.error("❌ Failed to start WebSocket tracking");
        }
      } catch (error: any) {
        console.error("❌ Error starting WebSocket tracking:", error.message || error);
        console.error("   You can manually start with: npm run start-tracking");
      }
    })();
    
    // Don't await - let it run in background
  } else {
    console.log("\n⏸️  WEBSOCKET_TRACKING_ENABLED is disabled in .env")
    console.log("   WebSocket tracking will NOT start automatically")
    console.log("   Run manually with: npm run start-tracking")
  }
  
  // MARKET CAP TRACKING - Monitor market cap and auto-sell when threshold is reached
  if (MARKET_CAP_TRACKING_ENABLED) {
    console.log("\n📊📊📊 MARKET CAP TRACKING STARTING... 📊📊📊")
    console.log(`⚡ Monitoring market cap via Birdeye API`)
    console.log(`⚡ Threshold: $${(MARKET_CAP_SELL_THRESHOLD / 1000).toFixed(0)}K`)
    console.log(`⚡ Check Interval: ${MARKET_CAP_CHECK_INTERVAL} seconds`)
    console.log("⚡ When threshold is met, will INSTANTLY trigger rapid sell!\n")
    
    const marketCapTrackingPromise = (async () => {
      try {
        const MarketCapTrackerWebSocket = (await import('./cli/market-cap-tracker-websocket')).default;
        const autoSellType = AUTO_SELL_50_PERCENT ? 'rapid-sell-50-percent' : 'rapid-sell';
        
        const tracker = new MarketCapTrackerWebSocket(
          mintAddress.toBase58(),
          MARKET_CAP_SELL_THRESHOLD,
          autoSellType
        );
        
        const success = tracker.start();
        
        if (success) {
          console.log("✅✅✅ Market cap tracking started successfully!");
          console.log("⚡ Real-time WebSocket market cap monitoring is active");
          console.log("⚡ Will trigger rapid sell when market cap reaches threshold\n");
        } else {
          console.error("❌ Failed to start market cap tracking");
        }
      } catch (error: any) {
        console.error("❌ Error starting market cap tracking:", error.message || error);
        console.error("   Make sure RPC_WEBSOCKET_ENDPOINT is set in .env");
      }
    })();
    
    // Don't await - let it run in background
  } else {
    console.log("\n⏸️  MARKET_CAP_TRACKING_ENABLED is disabled in .env")
    console.log("   Market cap tracking will NOT start automatically")
  }
  
  // Token confirmation check runs in PARALLEL with rapid sell (non-blocking)
  // This is just for error handling - rapid sell already handles retries
  console.log("\n⏳ Token confirmation check running in background (non-blocking)...")
  console.log(`   Mint address: ${mintAddress.toBase58()}`)
  console.log(`   Rapid sell is already running - this check is just for error handling`)
  
  const maxWaitTime = 90000 // 90 seconds
  const checkInterval = 2000 // 2 seconds
  const startWaitTime = Date.now()
  let tokenConfirmed = false
  let bundleSignature: string | null = null
  
  // Get bundle signature for reference
  if (LIL_JIT_MODE) {
    bundleSignature = null
  } else {
    bundleSignature = transactions[0] ? base58.encode(transactions[0].signatures[0]) : null
  }
  
  // Run token confirmation check in background (don't block rapid sell)
  const confirmationCheckPromise = (async () => {
    while (Date.now() - startWaitTime < maxWaitTime) {
      try {
        // First check if bundle transaction was actually included in a block
        if (bundleSignature) {
          try {
            const txStatus = await connection.getSignatureStatus(bundleSignature, { searchTransactionHistory: true })
            if (txStatus.value) {
              if (txStatus.value.err) {
                console.log(`\n❌ Bundle transaction failed: ${JSON.stringify(txStatus.value.err)}`)
                console.log(`   Transaction: https://solscan.io/tx/${bundleSignature}`)
                // Continue checking - might be a different transaction that succeeded
              } else if (txStatus.value.confirmationStatus === 'confirmed' || txStatus.value.confirmationStatus === 'finalized') {
                console.log(`\n✅ Bundle transaction confirmed on-chain!`)
                console.log(`   Transaction: https://solscan.io/tx/${bundleSignature}`)
              }
            }
          } catch (e) {
            // Ignore errors checking transaction status
          }
        }
        
        const mintInfo = await connection.getParsedAccountInfo(mintAddress, "confirmed")
        if (mintInfo.value && mintInfo.value.data) {
          console.log("\n✅ Token confirmed on-chain!")
          
          // Verify buys went through by checking if wallets have tokens
          // If token is confirmed, the bundle was included, so all buys should have gone through
          // But let's verify quickly to be 100% sure
          try {
            // Check DEV wallet first (should have tokens if buy went through)
            // Decode raw Buffer data like rapid-sell.ts does
            const devTokenAccounts = await connection.getTokenAccountsByOwner(buyerKp.publicKey, {
              programId: TOKEN_PROGRAM_ID,
            })
            const devHasTokens = devTokenAccounts.value.some(acc => {
              try {
                const accountInfo = SPL_ACCOUNT_LAYOUT.decode(acc.account.data as Buffer)
                return accountInfo.mint.toBase58() === mintAddress.toBase58()
              } catch {
                return false
              }
            })
            
            // Check at least one bundler wallet
            let bundlerHasTokens = false
            if (walletsUsed.length > 0) {
              const bundlerTokenAccounts = await connection.getTokenAccountsByOwner(walletsUsed[0].publicKey, {
                programId: TOKEN_PROGRAM_ID,
              })
              bundlerHasTokens = bundlerTokenAccounts.value.some(acc => {
                try {
                  const accountInfo = SPL_ACCOUNT_LAYOUT.decode(acc.account.data as Buffer)
                  return accountInfo.mint.toBase58() === mintAddress.toBase58()
                } catch {
                  return false
                }
              })
            }
            
            if (devHasTokens || bundlerHasTokens) {
              console.log("   ✅ Buys confirmed - wallets have tokens!")
              console.log(`   ${devHasTokens ? 'DEV wallet' : ''}${devHasTokens && bundlerHasTokens ? ' + ' : ''}${bundlerHasTokens ? 'Bundler wallets' : ''} have tokens`)
            } else {
              console.log("   ⚠️  Token exists but buys may not have gone through yet (checking again in 2s...)")
              // Don't break yet - wait a bit more for buys to settle
              await sleep(2000)
              // Check one more time
              const devTokenAccounts2 = await connection.getTokenAccountsByOwner(buyerKp.publicKey, {
                programId: TOKEN_PROGRAM_ID,
              })
              const devHasTokens2 = devTokenAccounts2.value.some(acc => {
                try {
                  const accountInfo = SPL_ACCOUNT_LAYOUT.decode(acc.account.data as Buffer)
                  return accountInfo.mint.toBase58() === mintAddress.toBase58()
                } catch {
                  return false
                }
              })
              if (devHasTokens2) {
                console.log("   ✅ Buys confirmed on second check!")
              } else {
                console.log("   ⚠️  Token exists but buys not detected - bundle may have been partially included")
                console.log("   💡 Rapid sell will handle this - it checks for tokens before selling")
              }
            }
          } catch (error) {
            // If verification fails, assume buys went through (token exists = bundle succeeded)
            console.log("   ⚠️  Could not verify buys (RPC error), but token exists = bundle succeeded")
          }
          
          console.log("   ⚡ Stopping all Jito retries - bundle succeeded!")
          tokenConfirmed = true
          // Stop all Jito retries - bundle succeeded, no need to keep retrying
          stopJitoRetries()
          break
        }
      } catch (error) {
        // Ignore errors, keep checking
      }
      
      const elapsed = Math.floor((Date.now() - startWaitTime) / 1000)
      if (elapsed % 10 === 0 && elapsed > 0) { // Log every 10 seconds to avoid spam
        console.log(`   ⏳ Token confirmation check: ${elapsed}s elapsed (rapid sell is running in parallel)`)
      }
      await sleep(checkInterval)
    }
    
    if (!tokenConfirmed) {
      console.log("\n❌❌❌ WARNING: Token NOT confirmed on-chain after 90 seconds!")
      console.log("   This means the bundle was likely NOT included in a block")
      console.log("   However, rapid sell may have already completed if bundle succeeded")
      console.log("   Possible reasons:")
      console.log("   1. Bundle was rejected by validators")
      console.log("   2. Bundle lost in competition")
      console.log("   3. Blockhash expired")
      console.log("   4. Network congestion")
      if (bundleSignature) {
        console.log("\n   Check the transaction on Solscan:")
        console.log(`   https://solscan.io/tx/${bundleSignature}`)
      }
      
      // Save as failed
      // Update existing current-run.json with FAILED status
      if (fs.existsSync(keysPath)) {
        const currentRunData = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
        currentRunData.launchStatus = "FAILED"
        currentRunData.launchStage = "FAILED"
        currentRunData.failureReason = "Bundle not included on-chain"
        fs.writeFileSync(keysPath, JSON.stringify(currentRunData, null, 2))
        console.log("\n   ⚠️  Updated current-run.json: launchStatus = FAILED")
        console.log("   💡 All wallets are saved in current-run.json - you can retry with: npm run retry-bundle")
        console.log("   💡 Or run gather script to recover SOL from wallets")
      } else {
        // Fallback: create new file if somehow it doesn't exist
        const failedRunWallets: any = {
          count: walletsUsed.length,
          totalCreated: kps.length + holderWallets.length + (currentBuyerWallet && currentBuyerWallet.trim() !== '' ? 0 : 1),
          timestamp: Date.now(),
          mintAddress: mintAddress.toBase58(),
          launchStatus: "FAILED",
          launchStage: "FAILED",
          bundleWalletKeys: walletsUsed.map(kp => base58.encode(kp.secretKey)),
          holderWalletKeys: holderWallets.map(kp => base58.encode(kp.secretKey)),
          walletKeys: [...walletsUsed, ...holderWallets].map(kp => base58.encode(kp.secretKey)),
          creatorDevWalletKey: base58.encode(buyerKp.secretKey),
          failureReason: "Bundle not included on-chain"
        }
        fs.writeFileSync(keysPath, JSON.stringify(failedRunWallets, null, 2))
        console.log("\n   ⚠️  Created current-run.json with FAILED status")
      }
      
      // Complete profit/loss tracking for failed launch
      if (profitLossRunId) {
        try {
          await completeRunTracking(connection, mainKp.publicKey, profitLossRunId, 'failed', 'Launch failed - bundle not included on-chain');
        } catch (error: any) {
          console.warn(`[ProfitLoss] Failed to update tracking: ${error.message}`);
        }
      }
      
      return false
    } else {
      // Update existing current-run.json with SUCCESS status
      if (fs.existsSync(keysPath)) {
        const currentRunData = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
        currentRunData.launchStatus = "SUCCESS"
        currentRunData.totalCreated = kps.length + holderWallets.length + (BUYER_WALLET && BUYER_WALLET.trim() !== '' ? 0 : 1)
        // Ensure all fields are up to date
        currentRunData.count = walletsUsed.length
        currentRunData.bundleWalletKeys = walletsUsed.map(kp => base58.encode(kp.secretKey))
        currentRunData.holderWalletKeys = holderWallets.map(kp => base58.encode(kp.secretKey))
        currentRunData.walletKeys = [...walletsUsed, ...holderWallets].map(kp => base58.encode(kp.secretKey))
        currentRunData.creatorDevWalletKey = base58.encode(buyerKp.secretKey)
        currentRunData.launchStatus = "SUCCESS"
        currentRunData.launchStage = "SUCCESS"
        fs.writeFileSync(keysPath, JSON.stringify(currentRunData, null, 2))
        console.log(`   ✅ Updated current-run.json: launchStatus = SUCCESS`)
      } else {
        // Fallback: create new file if somehow it doesn't exist
        const currentRunWallets: any = {
          count: walletsUsed.length,
          totalCreated: kps.length + holderWallets.length + (currentBuyerWallet && currentBuyerWallet.trim() !== '' ? 0 : 1),
          timestamp: Date.now(),
          mintAddress: mintAddress.toBase58(),
          launchStatus: "SUCCESS",
          launchStage: "SUCCESS",
          bundleWalletKeys: walletsUsed.map(kp => base58.encode(kp.secretKey)),
          holderWalletKeys: holderWallets.map(kp => base58.encode(kp.secretKey)),
          walletKeys: [...walletsUsed, ...holderWallets].map(kp => base58.encode(kp.secretKey)),
          creatorDevWalletKey: base58.encode(buyerKp.secretKey)
        }
        fs.writeFileSync(keysPath, JSON.stringify(currentRunWallets, null, 2))
        console.log(`   ✅ Created current-run.json with SUCCESS status`)
      }
      console.log("\n✅✅✅ TOKEN LAUNCH CONFIRMED - Token is on-chain! ✅✅✅")
      
      // Mark pump address as used if we used one from the pool
      if (usedPumpAddressPublicKey) {
        markPumpAddressAsUsed(usedPumpAddressPublicKey)
        console.log(`✅ Marked pump address as used: ${usedPumpAddressPublicKey}`)
      }
      
      // Bundle buys are now tracked exclusively via PumpPortal WebSocket
      
      // ============================================
      // AUTO HOLDER WALLET BUYS (After Launch Success)
      // ============================================
      // Check for selected auto-buy wallets from warmed wallets file OR current-run.json (fresh wallets)
      let autoBuyWallets: Keypair[] = []
      let autoBuyDelaysConfig: string | null = null
      
      // First, try warmed wallets file
      if (fs.existsSync(warmedWalletsPath)) {
        try {
          const warmedData = JSON.parse(fs.readFileSync(warmedWalletsPath, 'utf8'))
          if (warmedData.holderWalletAutoBuyKeys && warmedData.holderWalletAutoBuyKeys.length > 0) {
            autoBuyWallets = warmedData.holderWalletAutoBuyKeys.map((key: string) => 
              Keypair.fromSecretKey(base58.decode(key))
            )
            autoBuyDelaysConfig = warmedData.holderWalletAutoBuyDelays || null
            console.log(`\n👥 AUTO HOLDER WALLET BUY: Found ${autoBuyWallets.length} selected wallets from warmed wallets`)
          }
        } catch (error: any) {
          console.warn(`⚠️  Failed to read auto-buy wallets from warmed wallets: ${error.message}`)
        }
      }
      
      // If no warmed wallets, check current-run.json for fresh wallets
      if (autoBuyWallets.length === 0 && fs.existsSync(keysPath)) {
        try {
          const currentRunData = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
          if (currentRunData.holderWalletAutoBuyKeys && currentRunData.holderWalletAutoBuyKeys.length > 0) {
            autoBuyWallets = currentRunData.holderWalletAutoBuyKeys.map((key: string) => 
              Keypair.fromSecretKey(base58.decode(key))
            )
            autoBuyDelaysConfig = currentRunData.holderWalletAutoBuyDelays || null
            console.log(`\n👥 AUTO HOLDER WALLET BUY: Found ${autoBuyWallets.length} selected wallets from fresh wallets`)
          }
        } catch (error: any) {
          console.warn(`⚠️  Failed to read auto-buy wallets from current-run.json: ${error.message}`)
        }
      }
      
      // Enable auto-buy if wallets are configured OR if AUTO_HOLDER_WALLET_BUY is enabled in .env
      // This allows the launch form to enable auto-buy without requiring .env setting
      const shouldEnableAutoBuy = autoBuyWallets.length > 0 || AUTO_HOLDER_WALLET_BUY
      
      if (shouldEnableAutoBuy) {
        // Fallback: use all holder wallets if no selection was made AND AUTO_HOLDER_WALLET_BUY is enabled
        if (autoBuyWallets.length === 0 && holderWallets.length > 0 && AUTO_HOLDER_WALLET_BUY) {
          autoBuyWallets = holderWallets
          console.log(`\n👥 AUTO HOLDER WALLET BUY: Using all ${holderWallets.length} holder wallets (no selection made, AUTO_HOLDER_WALLET_BUY enabled)`)
        }
        
        if (autoBuyWallets.length > 0) {
          console.log(`\n👥 AUTO HOLDER WALLET BUY: Starting automatic holder wallet buys...`)
          console.log(`   Selected wallets: ${autoBuyWallets.length}`)
          
          // ============================================
          // FRONT-RUN PROTECTION SETUP
          // ============================================
          // Build set of "our" wallets to exclude from external volume calculation
          const ourWalletsSet = new Set<string>()
          ourWalletsSet.add(mainKp.publicKey.toBase58()) // Funding wallet
          ourWalletsSet.add(buyerKp.publicKey.toBase58()) // DEV wallet
          walletsUsed.forEach(w => ourWalletsSet.add(w.publicKey.toBase58())) // Bundle wallets (actual ones used)
          kps.forEach(w => ourWalletsSet.add(w.publicKey.toBase58())) // All kps (in case some weren't used)
          holderWallets.forEach(w => ourWalletsSet.add(w.publicKey.toBase58()))
          autoBuyWallets.forEach(w => ourWalletsSet.add(w.publicKey.toBase58()))
          
          // Read front-run threshold from config file (if passed from frontend) or use env default
          let frontRunThreshold = AUTO_BUY_FRONT_RUN_THRESHOLD
          let frontRunCheckDelay = AUTO_BUY_FRONT_RUN_CHECK_DELAY
          
          // Try to read threshold from warmed-wallets-for-launch.json or current-run.json or fresh-auto-buy-config.json
          try {
            if (fs.existsSync(warmedWalletsPath)) {
              const warmedData = JSON.parse(fs.readFileSync(warmedWalletsPath, 'utf8'))
              if (typeof warmedData.frontRunThreshold === 'number') {
                frontRunThreshold = warmedData.frontRunThreshold
              }
            } else if (fs.existsSync(keysPath)) {
              const runData = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
              if (typeof runData.frontRunThreshold === 'number') {
                frontRunThreshold = runData.frontRunThreshold
              }
            }
            // Also check fresh-auto-buy-config.json
            const freshPath = path.join(process.cwd(), 'keys', 'trade-configs', 'fresh-auto-buy-config.json')
            if (frontRunThreshold === 0 && fs.existsSync(freshPath)) {
              const freshData = JSON.parse(fs.readFileSync(freshPath, 'utf8'))
              if (typeof freshData.frontRunThreshold === 'number' && freshData.frontRunThreshold > 0) {
                frontRunThreshold = freshData.frontRunThreshold
              }
            }
          } catch (e) { /* Ignore parse errors */ }
          
          // Set front-run threshold in PumpPortal tracker (for real-time synchronous checks)
          try {
            const pumpPortalTracker = require('./api-server/pumpportal-tracker')
            if (pumpPortalTracker) {
              pumpPortalTracker.setFrontRunThreshold(frontRunThreshold)
            }
          } catch (e) {
            console.warn(`   ⚠️  Could not set front-run threshold in PumpPortal: ${e.message}`)
          }
          
          if (frontRunThreshold > 0) {
            console.log(`   🛡️  FRONT-RUN PROTECTION ENABLED: Max external buys = ${frontRunThreshold} SOL`)
            console.log(`      Real-time WebSocket monitoring active - flag set IMMEDIATELY when threshold exceeded`)
            console.log(`      If external buys exceed this, wallets will SKIP buying to avoid front-running`)
          } else {
            console.log(`   ⚠️  Front-run protection DISABLED (threshold = 0)`)
          }
          
          // Track which wallets were skipped due to front-run protection
          const skippedWallets: number[] = []
          const successfulBuys: Array<{ walletIndex: number, address: string, amount: number, signature: string }> = []
          
          // Get holder wallet amounts (map to selected wallets)
          let holderAmountsToUse: number[]
          if (holderSwapAmounts.length > 0) {
            holderAmountsToUse = [...holderSwapAmounts]
            while (holderAmountsToUse.length < autoBuyWallets.length) {
              holderAmountsToUse.push(holderWalletAmount)
            }
            holderAmountsToUse = holderAmountsToUse.slice(0, autoBuyWallets.length)
          } else {
            holderAmountsToUse = Array(autoBuyWallets.length).fill(holderWalletAmount)
          }
          
          console.log(`   Amounts: [${holderAmountsToUse.join(', ')}] SOL`)
          console.log(`   Priority fee: ${HOLDER_WALLET_PRIORITY_FEE} microLamports (low - holder count only)`)
          
          // Parse delay configuration
          const delaysConfig = autoBuyDelaysConfig || HOLDER_WALLET_AUTO_BUY_DELAYS || ''
          const delayGroups: Array<{ type: 'parallel' | 'delay', value: number }> = []
          
          if (delaysConfig) {
            const parts = delaysConfig.split(',')
            for (const part of parts) {
              const trimmed = part.trim()
              if (trimmed.startsWith('parallel:')) {
                const count = parseInt(trimmed.replace('parallel:', ''))
                if (!isNaN(count) && count > 0) {
                  delayGroups.push({ type: 'parallel', value: count })
                }
              } else if (trimmed.startsWith('delay:')) {
                const seconds = parseFloat(trimmed.replace('delay:', ''))
                if (!isNaN(seconds) && seconds >= 0) {
                  delayGroups.push({ type: 'delay', value: seconds })
                }
              }
            }
          }
          
          // Execute buys with delay configuration
          // Format: parallel:count,delay:seconds,parallel:count,delay:seconds
          // First delay is "after launch", subsequent delays are "after previous group"
          let walletIndex = 0
          let isFirstGroup = true
          
          for (let groupIndex = 0; groupIndex < delayGroups.length && walletIndex < autoBuyWallets.length; groupIndex++) {
            const group = delayGroups[groupIndex]
            
            if (group.type === 'parallel') {
              // Check if there's a delay before this group
              if (isFirstGroup && groupIndex + 1 < delayGroups.length && delayGroups[groupIndex + 1].type === 'delay') {
                // First group: wait for initial delay from launch (can be 0 for instant sniping)
                const delay = delayGroups[groupIndex + 1].value
                if (delay > 0) {
                  console.log(`   ⏳ Waiting ${delay} seconds after launch before first buy...`)
                  await sleep(delay * 1000)
                } else {
                  console.log(`   🚀 INSTANT SNIPE: Buying immediately after launch (0s delay)`)
                }
                groupIndex++ // Skip the delay group since we processed it
              } else if (!isFirstGroup && groupIndex > 0 && delayGroups[groupIndex - 1].type === 'delay') {
                // Subsequent groups: wait after previous group
                const delay = delayGroups[groupIndex - 1].value
                if (delay > 0) {
                  console.log(`   ⏳ Waiting ${delay} seconds before next group...`)
                  await sleep(delay * 1000)
                }
              }
              
              // Collect wallets for this parallel group
              const parallelCount = group.value
              const currentParallelGroup: Keypair[] = []
              for (let i = 0; i < parallelCount && walletIndex < autoBuyWallets.length; i++) {
                currentParallelGroup.push(autoBuyWallets[walletIndex])
                walletIndex++
              }
              
              // Execute all buys in parallel (with small staggered delays to avoid appearing as bundle)
              // NOTE: These are REGULAR transactions, NOT JITO bundles
              if (currentParallelGroup.length > 0) {
                // ============================================
                // FRONT-RUN PROTECTION CHECK (for parallel group)
                // ============================================
                // Uses REAL-TIME synchronous flag (instant check, no async delay)
                let groupSkipped = false
                if (frontRunThreshold > 0) {
                  // Wait a bit to let external transactions be detected by WebSocket
                  if (frontRunCheckDelay > 0) {
                    await sleep(frontRunCheckDelay * 1000)
                  }
                  
                  console.log(`\n   🛡️  Checking for front-runners before parallel group buy...`)
                  
                  // CRITICAL: Synchronous check (instant, no async delay)
                  // PumpPortal WebSocket continuously tracks external buys and sets a flag IMMEDIATELY
                  // This check is instant - no polling, no async, just a flag check
                  let isBlocked = false
                  let externalGrossBuys = 0
                  
                  try {
                    const pumpPortalTracker = require('./api-server/pumpportal-tracker')
                    if (pumpPortalTracker) {
                      // SYNCHRONOUS CHECK: Instant flag check (no async delay)
                      isBlocked = pumpPortalTracker.isFrontRunBlocked()
                      externalGrossBuys = pumpPortalTracker.getExternalGrossBuyVolume()
                      
                      if (isBlocked) {
                        console.log(`      🚨 FRONT-RUN BLOCKED: External GROSS buys = ${externalGrossBuys.toFixed(4)} SOL >= ${frontRunThreshold} SOL threshold`)
                        console.log(`      ⚡ Flag was set IMMEDIATELY by WebSocket (real-time detection)`)
                        console.log(`      ❌ SKIPPING ${currentParallelGroup.length} wallet(s) - threshold exceeded`)
                        console.log(`      💡 External wallets bought before us - skipping to avoid buying at inflated prices`)
                        for (let i = 0; i < currentParallelGroup.length; i++) {
                          const actualIndex = walletIndex - currentParallelGroup.length + i
                          skippedWallets.push(actualIndex + 1)
                        }
                        groupSkipped = true
                      } else {
                        console.log(`      ✅ Safe to buy: External GROSS buys = ${externalGrossBuys.toFixed(4)} SOL < ${frontRunThreshold} SOL threshold`)
                        console.log(`      ⚡ Real-time WebSocket monitoring active - flag will be set instantly if threshold exceeded`)
                      }
                    } else {
                      console.warn(`      ⚠️  PumpPortal tracker not available - front-run protection disabled`)
                    }
                  } catch (e) {
                    console.warn(`      ⚠️  Could not check front-run flag: ${e.message}`)
                    // Fallback: Don't block if we can't check (safer to allow buy than block incorrectly)
                  }
                }
                
                if (!groupSkipped) {
                  console.log(`\n   🔄 Executing ${currentParallelGroup.length} holder wallet buy(s) (regular transactions, NOT JITO bundles)...`)
                  const buyPromises = currentParallelGroup.map(async (wallet, idx) => {
                    const actualIndex = walletIndex - currentParallelGroup.length + idx
                    const amount = holderAmountsToUse[actualIndex] || holderWalletAmount
                    
                    // Add small random delay (0-200ms) to stagger transactions and avoid appearing as bundle
                    // This helps distinguish holder wallet buys from bundle wallet buys
                    const staggerDelay = Math.random() * 200
                    if (staggerDelay > 0) {
                      await sleep(staggerDelay)
                    }
                    
                    try {
                      console.log(`      💰 Holder wallet ${actualIndex + 1}/${autoBuyWallets.length} buying ${amount} SOL worth...`)
                      console.log(`         Address: ${wallet.publicKey.toBase58()}`)
                      console.log(`         ⚠️  Regular transaction (NOT JITO bundle)`)
                      
                      const referrerKey = base58.encode(buyerKp.secretKey)
                      const feeLevel = HOLDER_WALLET_PRIORITY_FEE >= 1000000 ? 'high' : HOLDER_WALLET_PRIORITY_FEE >= 100000 ? 'medium' : 'low'
                      
                      const result = await buyTokenSimple(
                        base58.encode(wallet.secretKey),
                        mintAddress.toBase58(),
                        amount,
                        referrerKey,
                        false,
                        feeLevel
                      )
                      
                      if (result && result.signature) {
                        console.log(`         ✅ Buy successful! https://solscan.io/tx/${result.signature}`)
                        successfulBuys.push({
                          walletIndex: actualIndex + 1,
                          address: wallet.publicKey.toBase58(),
                          amount,
                          signature: result.signature
                        })
                      }
                      return { success: true, wallet: actualIndex + 1, amount, signature: result?.signature }
                    } catch (error: any) {
                      console.error(`         ❌ Buy failed: ${error.message || error}`)
                      return { success: false, wallet: actualIndex + 1, error }
                    }
                  })
                  
                  await Promise.all(buyPromises)
                }
                isFirstGroup = false
              }
            }
          }
          
          // Execute remaining wallets sequentially with default delay
          // NOTE: These are REGULAR transactions, NOT JITO bundles
          while (walletIndex < autoBuyWallets.length) {
            const wallet = autoBuyWallets[walletIndex]
            const amount = holderAmountsToUse[walletIndex] || holderWalletAmount
            
            // ============================================
            // FRONT-RUN PROTECTION CHECK (for sequential wallet)
            // ============================================
            // Uses REAL-TIME synchronous flag (instant check, no async delay)
            let shouldSkip = false
            if (frontRunThreshold > 0) {
              console.log(`\n   🛡️  Checking for front-runners before wallet ${walletIndex + 1} buy...`)
              
              // CRITICAL: Synchronous check (instant, no async delay)
              // PumpPortal WebSocket continuously tracks external buys and sets a flag IMMEDIATELY
              // This check is instant - no polling, no async, just a flag check
              let isBlocked = false
              let externalGrossBuys = 0
              
              try {
                const pumpPortalTracker = require('./api-server/pumpportal-tracker')
                if (pumpPortalTracker) {
                  // SYNCHRONOUS CHECK: Instant flag check (no async delay)
                  isBlocked = pumpPortalTracker.isFrontRunBlocked()
                  externalGrossBuys = pumpPortalTracker.getExternalGrossBuyVolume()
                  
                  if (isBlocked) {
                    console.log(`      🚨 FRONT-RUN BLOCKED: External GROSS buys = ${externalGrossBuys.toFixed(4)} SOL >= ${frontRunThreshold} SOL threshold`)
                    console.log(`      ⚡ Flag was set IMMEDIATELY by WebSocket (real-time detection)`)
                    console.log(`      ❌ SKIPPING wallet ${walletIndex + 1} - threshold exceeded`)
                    console.log(`      💡 External wallets bought before us - skipping to avoid buying at inflated prices`)
                    skippedWallets.push(walletIndex + 1)
                    shouldSkip = true
                  } else {
                    console.log(`      ✅ Safe to buy: External GROSS buys = ${externalGrossBuys.toFixed(4)} SOL < ${frontRunThreshold} SOL threshold`)
                    console.log(`      ⚡ Real-time WebSocket monitoring active - flag will be set instantly if threshold exceeded`)
                  }
                } else {
                  console.warn(`      ⚠️  PumpPortal tracker not available - front-run protection disabled`)
                }
              } catch (e) {
                console.warn(`      ⚠️  Could not check front-run flag: ${e.message}`)
                // Fallback: Don't block if we can't check (safer to allow buy than block incorrectly)
              }
            }
            
            if (!shouldSkip) {
              try {
                console.log(`\n   💰 Holder wallet ${walletIndex + 1}/${autoBuyWallets.length} buying ${amount} SOL worth...`)
                console.log(`      Address: ${wallet.publicKey.toBase58()}`)
                console.log(`      ⚠️  Regular transaction (NOT JITO bundle)`)
                
                const referrerKey = base58.encode(buyerKp.secretKey)
                const feeLevel = HOLDER_WALLET_PRIORITY_FEE >= 1000000 ? 'high' : HOLDER_WALLET_PRIORITY_FEE >= 100000 ? 'medium' : 'low'
                
                const result = await buyTokenSimple(
                  base58.encode(wallet.secretKey),
                  mintAddress.toBase58(),
                  amount,
                  referrerKey,
                  false,
                  feeLevel
                )
                
                if (result && result.signature) {
                  console.log(`      ✅ Buy successful!`)
                  console.log(`      Transaction: https://solscan.io/tx/${result.signature}`)
                  successfulBuys.push({
                    walletIndex: walletIndex + 1,
                    address: wallet.publicKey.toBase58(),
                    amount,
                    signature: result.signature
                  })
                } else {
                  console.log(`      ⚠️  Buy may have succeeded but no signature returned`)
                }
                
                // Default delay between sequential buys (1-2 seconds)
                if (walletIndex < autoBuyWallets.length - 1) {
                  await sleep(1000 + Math.random() * 1000)
                }
              } catch (error: any) {
                console.error(`      ❌ Buy failed for holder wallet ${walletIndex + 1}: ${error.message || error}`)
              }
            }
            
            walletIndex++
          }
          
          // ============================================
          // SUMMARY: Front-run protection results
          // ============================================
          console.log(`\n✅ Auto holder wallet buys completed!`)
          if (successfulBuys.length > 0) {
            console.log(`   📊 Successful buys: ${successfulBuys.length}`)
            
            // Save successful buy info to current-run.json for auto-sell tracking
            try {
              if (fs.existsSync(keysPath)) {
                const runData = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
                runData.autoBuyResults = {
                  successfulBuys: successfulBuys.map(b => ({
                    walletIndex: b.walletIndex,
                    address: b.address,
                    buyAmount: b.amount,
                    signature: b.signature,
                    timestamp: Date.now()
                  })),
                  skippedWallets,
                  frontRunThreshold
                }
                fs.writeFileSync(keysPath, JSON.stringify(runData, null, 2))
                console.log(`   💾 Buy results saved for auto-sell tracking`)
              }
            } catch (e) { /* Ignore save errors */ }
          }
          if (skippedWallets.length > 0) {
            console.log(`   ⚠️  Skipped wallets (front-run protection): ${skippedWallets.join(', ')}`)
          }
        } else {
          console.log(`\n👥 No holder wallets selected for auto-buy`)
        }
      } else if (holderWallets.length > 0) {
        // Only show this message if AUTO_HOLDER_WALLET_BUY is disabled AND no wallets were configured for auto-buy
        if (!AUTO_HOLDER_WALLET_BUY && autoBuyWallets.length === 0) {
          console.log(`\n👥 Holder wallets ready (${holderWallets.length} wallets) - AUTO_HOLDER_WALLET_BUY is disabled`)
          console.log(`   💡 Enable AUTO_HOLDER_WALLET_BUY=true in .env OR enable auto-buy per wallet in the launch form`)
        }
      }
      
      // ============================================
      // ALWAYS UPDATE WEBSITE DATABASE (Contract Address)
      // ============================================
      // This runs regardless of ENABLE_MARKETING to ensure the contract address is always updated
      if (process.env.ENABLE_WEBSITE_UPDATE === 'true' && process.env.WEBSITE_URL) {
        try {
          console.log("\n🌐 Updating website database with new contract address...")
          const essentialTokenData = {
            tokenName: process.env.TOKEN_NAME || '',
            tokenSymbol: process.env.TOKEN_SYMBOL || '',
            tokenAddress: mintAddress.toBase58(),
            chain: 'solana',
            website: process.env.WEBSITE || '',
            telegram: process.env.TELEGRAM || '',
            twitter: process.env.TWITTER || '',
            description: process.env.DESCRIPTION || '',
            websiteLogoUrl: process.env.WEBSITE_LOGO || process.env.FILE || undefined,
            tokenLogoUrl: process.env.FILE || undefined,
          }
          const websiteResult = await updateWebsite(essentialTokenData, {
            siteUrl: process.env.WEBSITE_URL,
            secret: process.env.WEBSITE_SECRET || '',
          })
          if (websiteResult.success) {
            console.log(`✅ Website database updated with contract: ${mintAddress.toBase58().slice(0, 8)}...`)
          } else {
            console.warn("⚠️  Website database update failed:", websiteResult.error)
          }
        } catch (error: any) {
          console.warn("⚠️  Website database update error:", error.message)
        }
      }
      
      // ============================================
      // MARKETING TASKS (After Launch Success)
      // ============================================
      // Only run if ENABLE_MARKETING is set to 'true' in .env
      if (process.env.ENABLE_MARKETING === 'true') {
        console.log("\n📢 Starting marketing tasks...")
        
        // Load token image as base64 if FILE is set
        let tokenImageBase64: string | null = null
        let imageUrl: string | null = null
        if (process.env.FILE && process.env.FILE.trim()) {
          try {
            const imagePath = process.env.FILE
            // Handle relative paths (./image/filename.jpg or image/filename.jpg)
            let fullImagePath = imagePath
            if (imagePath.startsWith('./image/') || imagePath.startsWith('image/')) {
              fullImagePath = path.join(process.cwd(), 'image', path.basename(imagePath))
            } else if (!path.isAbsolute(imagePath)) {
              fullImagePath = path.join(process.cwd(), imagePath)
            }
            
            if (fs.existsSync(fullImagePath)) {
              const imageBuffer = fs.readFileSync(fullImagePath)
              const imageBase64 = imageBuffer.toString('base64')
              // Detect MIME type from file extension
              const ext = path.extname(fullImagePath).toLowerCase()
              const mimeTypes: Record<string, string> = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.webp': 'image/webp',
              }
              const mimeType = mimeTypes[ext] || 'image/png'
              tokenImageBase64 = `data:${mimeType};base64,${imageBase64}`
              imageUrl = `http://localhost:3001/image/${path.basename(fullImagePath)}`
              console.log(`   📸 Loaded token image: ${path.basename(fullImagePath)}`)
            } else {
              console.log(`   ⚠️  Image file not found: ${fullImagePath}`)
            }
          } catch (error: any) {
            console.log(`   ⚠️  Failed to load image: ${error.message}`)
          }
        }
        
        // Prepare token data for marketing - automatically uses values from .env
        const tokenData = {
          tokenName: process.env.TOKEN_NAME || '',
          tokenSymbol: process.env.TOKEN_SYMBOL || '',
          tokenAddress: mintAddress.toBase58(),
          chain: 'solana',
          website: process.env.WEBSITE || '',
          telegram: '', // Will be updated after Telegram creation
          twitter: process.env.TWITTER || '',
          description: process.env.DESCRIPTION || '',
          websiteLogoUrl: imageUrl || process.env.WEBSITE_LOGO || process.env.FILE || undefined,
          tokenLogoUrl: imageUrl || process.env.FILE || undefined,
          tokenImageBase64: tokenImageBase64 || undefined,
        }
        
        console.log(`   📋 Using token data from launch form:`)
        console.log(`      Name: ${tokenData.tokenName}`)
        console.log(`      Symbol: ${tokenData.tokenSymbol}`)
        console.log(`      Address: ${tokenData.tokenAddress}`)
        console.log(`      Website: ${tokenData.website || 'N/A'}`)
        console.log(`      Twitter: ${tokenData.twitter || 'N/A'}`)
        console.log(`      Description: ${tokenData.description ? tokenData.description.substring(0, 50) + '...' : 'N/A'}`)
        console.log(`      Image: ${tokenImageBase64 ? '✅ Loaded' : '❌ Not set'}`)
        
        // 1. Website Update - Already handled above (before ENABLE_MARKETING check)
        // This ensures contract address is ALWAYS updated, even if ENABLE_MARKETING=false
        // If there's a token image to update, we can update again here
        if (process.env.ENABLE_WEBSITE_UPDATE === 'true' && process.env.WEBSITE_URL && tokenImageBase64) {
          try {
            console.log("🌐 Updating website with token image...")
            const websiteResult = await updateWebsite(tokenData, {
              siteUrl: process.env.WEBSITE_URL,
              secret: process.env.WEBSITE_SECRET || '',
            })
            if (websiteResult.success) {
              console.log("✅ Website updated with image")
            }
          } catch (error: any) {
            console.warn("⚠️  Website image update error:", error.message)
          }
        }
        
        // 2. Telegram Creation (if enabled)
        let telegramLink = ''
        if (process.env.ENABLE_TELEGRAM_CREATION === 'true' && 
            process.env.TELEGRAM_API_ID && 
            process.env.TELEGRAM_API_HASH && 
            process.env.TELEGRAM_PHONE) {
          try {
            console.log("📱 Creating Telegram group/channel...")
            const telegramResult = await createTelegramGroup(tokenData, {
              apiId: process.env.TELEGRAM_API_ID,
              apiHash: process.env.TELEGRAM_API_HASH,
              phone: process.env.TELEGRAM_PHONE,
              createGroup: process.env.TELEGRAM_CREATE_GROUP !== 'false',
              createChannel: process.env.TELEGRAM_CREATE_CHANNEL === 'true',
              channelUsername: process.env.TELEGRAM_CHANNEL_USERNAME || '',
              groupTitleTemplate: process.env.TELEGRAM_GROUP_TITLE_TEMPLATE || '{token_name} Official',
              useSafeguardBot: process.env.TELEGRAM_USE_SAFEGUARD_BOT !== 'false',
              safeguardBotUsername: process.env.TELEGRAM_SAFEGUARD_BOT_USERNAME || '@safeguard',
              createPortal: process.env.TELEGRAM_CREATE_PORTAL === 'true',
            })
            telegramLink = telegramResult.telegramLink || ''
            tokenData.telegram = telegramLink
            console.log("✅ Telegram group/channel created:", telegramLink)
          } catch (error: any) {
            console.error("❌ Telegram creation failed:", error.message)
            // Don't throw - continue with other marketing tasks
          }
        }
        
        // 3. Twitter Posting (if enabled AND auto-posting is enabled)
        // NOTE: Use TWITTER_AUTO_POST=true for automatic posting after launch
        //       Set TWITTER_AUTO_POST=false to use manual posting via Marketing Widget
        if (process.env.ENABLE_TWITTER_POSTING === 'true' && 
            process.env.TWITTER_AUTO_POST === 'true' &&
            process.env.TWITTER_API_KEY && 
            process.env.TWITTER_API_SECRET && 
            process.env.TWITTER_ACCESS_TOKEN && 
            process.env.TWITTER_ACCESS_TOKEN_SECRET) {
          try {
            console.log("🐦 Posting to Twitter...")
            
            // Parse tweets - support both new JSON format and old pipe-separated format
            let tweets: string[] = []
            let tweetImages: (string | null)[] = []
            
            try {
              // Try to parse as JSON (new format with images)
              const tweetData = JSON.parse(process.env.TWITTER_TWEETS || '[]')
              if (Array.isArray(tweetData)) {
                tweets = tweetData.map((t: any) => typeof t === 'string' ? t : (t.text || ''))
                // Load images as base64
                tweetImages = await Promise.all(tweetData.map(async (t: any) => {
                  if (t.imagePath) {
                    try {
                      let fullImagePath = t.imagePath
                      if (t.imagePath.startsWith('./image/') || t.imagePath.startsWith('image/')) {
                        fullImagePath = path.join(process.cwd(), 'image', path.basename(t.imagePath))
                      } else if (!path.isAbsolute(t.imagePath)) {
                        fullImagePath = path.join(process.cwd(), t.imagePath)
                      }
                      
                      if (fs.existsSync(fullImagePath)) {
                        const imageBuffer = fs.readFileSync(fullImagePath)
                        const imageBase64 = imageBuffer.toString('base64')
                        const ext = path.extname(fullImagePath).toLowerCase()
                        const mimeTypes: Record<string, string> = {
                          '.jpg': 'image/jpeg',
                          '.jpeg': 'image/jpeg',
                          '.png': 'image/png',
                          '.gif': 'image/gif',
                          '.webp': 'image/webp',
                        }
                        const mimeType = mimeTypes[ext] || 'image/png'
                        return `data:${mimeType};base64,${imageBase64}`
                      }
                    } catch (error: any) {
                      console.log(`   ⚠️  Failed to load tweet image: ${error.message}`)
                    }
                  }
                  return null
                }))
              } else {
                throw new Error('Not an array')
              }
            } catch (e) {
              // Fallback to old format: pipe-separated tweets
              tweets = (process.env.TWITTER_TWEETS || '[token_name] is live! CA: [CA]').split('|')
              tweetImages = new Array(tweets.length).fill(null)
            }
            
            const tweetDelays = (process.env.TWITTER_TWEET_DELAYS || '').split(',').map(d => parseInt(d) || 0).filter(d => d > 0)
            const twitterResult = await postToTwitter(tokenData, {
              apiKey: process.env.TWITTER_API_KEY,
              apiSecret: process.env.TWITTER_API_SECRET,
              accessToken: process.env.TWITTER_ACCESS_TOKEN,
              accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
              tweets: tweets,
              tweetDelays: tweetDelays,
              tweetImages: tweetImages,
              updateProfile: process.env.TWITTER_UPDATE_PROFILE !== 'false',
              deleteOldTweets: process.env.TWITTER_DELETE_OLD_TWEETS === 'true',
            })
            console.log("✅ Twitter posts sent:", twitterResult.tweetIds.length, "tweet(s)")
          } catch (error: any) {
            console.error("❌ Twitter posting failed:", error.message)
            // Don't throw - marketing tasks are optional
          }
        }
        
        console.log("\n📢 Marketing tasks completed")
      }
      
      return true
    }
  })()
  
  // Wait for rapid sell to complete (if it was started)
  if (rapidSellPromise) {
    await rapidSellPromise
    console.log("\n✅ Rapid sell completed - process exiting")
    // Exit immediately after rapid sell - don't wait for confirmation check
    process.exit(0)
  }
  
  // If rapid sell wasn't started, wait for confirmation check
  await confirmationCheckPromise
}

main()

