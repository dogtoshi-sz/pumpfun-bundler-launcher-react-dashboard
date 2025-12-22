import { VersionedTransaction, Keypair, Connection, ComputeBudgetProgram, TransactionInstruction, TransactionMessage, PublicKey, SystemProgram } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID } from "@solana/spl-token"
import { SPL_ACCOUNT_LAYOUT } from "@raydium-io/raydium-sdk"
import base58 from "bs58"
import fs from "fs"
import path from "path"

import { DISTRIBUTION_WALLETNUM, LIL_JIT_MODE, PRIVATE_KEY, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, SWAP_AMOUNT, SWAP_AMOUNTS, VANITY_MODE, BUYER_WALLET, BUYER_AMOUNT, AUTO_RAPID_SELL, AUTO_SELL_50_PERCENT, AUTO_GATHER, AUTO_COLLECT_FEES, VOLUME_MAKER_ENABLED, VOLUME_MAKER_DURATION_MINUTES, VOLUME_MAKER_MIN_INTERVAL_SECONDS, VOLUME_MAKER_MAX_INTERVAL_SECONDS, VOLUME_MAKER_MIN_BUY_AMOUNT, VOLUME_MAKER_MAX_BUY_AMOUNT, VOLUME_MAKER_MIN_SELL_PERCENTAGE, VOLUME_MAKER_MAX_SELL_PERCENTAGE, VOLUME_MAKER_WALLET_COUNT, WEBSOCKET_TRACKING_ENABLED, WEBSOCKET_EXTERNAL_BUY_THRESHOLD, WEBSOCKET_EXTERNAL_BUY_WINDOW } from "./constants"
import { generateVanityAddress, saveDataToFile, sleep, getNextPumpAddress, markPumpAddressAsUsed } from "./utils"
import { createTokenTx, distributeSol, createLUT, makeBuyIx, addAddressesToTableMultiExtend } from "./src/main";
import { executeJitoTx, stopJitoRetries } from "./executor/jito";
import { sendBundle } from "./executor/liljito";
import { startVolumeMaker } from "./volume-maker";
import { showInteractiveMenu } from "./interactive-menu";



const commitment = "confirmed"

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT, commitment
})
const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))
console.log("mainKp", mainKp.publicKey.toBase58());
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

  console.log("Mint address of token ", mintAddress.toBase58())
  saveDataToFile([base58.encode(mintKp.secretKey)], "mint.json")

  const tokenCreationIxs = await createTokenTx(mainKp, mintKp)
  if (tokenCreationIxs.length == 0) {
    console.log("Token creation failed")
    return
  }
  // Calculate minimum SOL needed
  // If SWAP_AMOUNTS is provided but has fewer values than DISTRIBUTION_WALLETNUM, pad with SWAP_AMOUNT
  console.log(`\n📊 Buy Amount Configuration:`);
  console.log(`   - SWAP_AMOUNTS from .env: ${process.env.SWAP_AMOUNTS || '(empty)'}`);
  console.log(`   - Parsed SWAP_AMOUNTS array: [${SWAP_AMOUNTS.join(', ')}] (length: ${SWAP_AMOUNTS.length})`);
  console.log(`   - SWAP_AMOUNT (fallback): ${SWAP_AMOUNT}`);
  console.log(`   - BUYER_AMOUNT (DEV buy): ${BUYER_AMOUNT}`);
  console.log(`   - DISTRIBUTION_WALLETNUM: ${DISTRIBUTION_WALLETNUM}`);
  
  let swapAmountsToUse: number[];
  if (SWAP_AMOUNTS.length > 0) {
    swapAmountsToUse = [...SWAP_AMOUNTS];
    // Pad with SWAP_AMOUNT if we have fewer amounts than wallets
    while (swapAmountsToUse.length < DISTRIBUTION_WALLETNUM) {
      console.warn(`   ⚠️  SWAP_AMOUNTS has ${swapAmountsToUse.length} values but need ${DISTRIBUTION_WALLETNUM}. Padding with SWAP_AMOUNT (${SWAP_AMOUNT})`);
      swapAmountsToUse.push(SWAP_AMOUNT);
    }
    // Trim if we have more amounts than wallets (shouldn't happen, but be safe)
    swapAmountsToUse = swapAmountsToUse.slice(0, DISTRIBUTION_WALLETNUM);
    console.log(`   ✅ Using custom amounts: [${swapAmountsToUse.join(', ')}]`);
  } else {
    console.warn(`   ⚠️  SWAP_AMOUNTS is empty! All wallets will use SWAP_AMOUNT (${SWAP_AMOUNT})`);
    swapAmountsToUse = Array(DISTRIBUTION_WALLETNUM).fill(SWAP_AMOUNT);
  }
  // Calculate minimum SOL needed: bundle wallets + buyer wallet + buffer
  const minimumSolAmount = swapAmountsToUse.reduce((sum, amount) => sum + amount + 0.01, 0) + BUYER_AMOUNT + 0.01 + 0.04

  if (mainBal / 10 ** 9 < minimumSolAmount) {
    console.log("Main wallet balance is not enough to run the bundler")
    console.log(`Plz charge the wallet more than ${minimumSolAmount.toFixed(3)}SOL`)
    return
  }

  console.log("Distributing SOL to wallets...")
  const swapAmountsForDistribution = SWAP_AMOUNTS.length > 0 ? SWAP_AMOUNTS : undefined
  
  let result = await distributeSol(connection, mainKp, DISTRIBUTION_WALLETNUM, swapAmountsForDistribution)
  if (!result) {
    console.log("Distribution failed")
    return
  } else {
    kps = result
  }

  // START WEBSOCKET TRACKING (if enabled) - Start IMMEDIATELY after wallets are created
  // This tracks all buys in real-time and triggers auto-sell when threshold is met
  let websocketTrackerInstance: any = null;
  if (WEBSOCKET_TRACKING_ENABLED) {
    console.log("\n🌐🌐🌐 STARTING WEBSOCKET TRACKING... 🌐🌐🌐");
    console.log("⚡ Real-time buy/sell detection enabled");
    console.log(`   Mint: ${mintAddress.toBase58()}`);
    console.log(`   External Buy Threshold: ${WEBSOCKET_EXTERNAL_BUY_THRESHOLD} SOL (cumulative)`);
    console.log(`   Aggregation Window: ${WEBSOCKET_EXTERNAL_BUY_WINDOW} seconds`);
    
    // Determine auto-sell type based on .env settings
    // Priority: AUTO_SELL_50_PERCENT takes precedence over AUTO_RAPID_SELL
    let autoSellType = 'rapid-sell'; // Default
    let autoSellEnabled = false;
    
    if (AUTO_SELL_50_PERCENT) {
      autoSellType = 'rapid-sell-50-percent';
      autoSellEnabled = true;
      console.log(`   Auto-Sell: 50% of bundler wallets (DEV wallet excluded)`);
    } else if (AUTO_RAPID_SELL) {
      autoSellType = 'rapid-sell';
      autoSellEnabled = true;
      console.log(`   Auto-Sell: ALL wallets (bundler + DEV)`);
    } else {
      console.log(`   Auto-Sell: DISABLED (tracking only, no auto-sell)`);
    }
    
    try {
      // Import WebSocket tracker (it exports a singleton instance)
      const websocketTrackerModule = require('./api-server/websocket-tracker');
      // The module exports a singleton instance, so use it directly
      websocketTrackerInstance = websocketTrackerModule;
      
      // Prepare our wallet addresses (DEV + bundler wallets)
      const ourWalletAddresses: string[] = [];
      
      // Add DEV wallet
      ourWalletAddresses.push(mainKp.publicKey.toBase58());
      
      // Add bundler wallets (from kps array - wallets that were just created)
      kps.forEach(kp => {
        ourWalletAddresses.push(kp.publicKey.toBase58());
      });
      
      // Add buyer wallet (DEV buy wallet) if different from main
      const buyerKp = Keypair.fromSecretKey(base58.decode(BUYER_WALLET));
      if (!buyerKp.publicKey.equals(mainKp.publicKey)) {
        ourWalletAddresses.push(buyerKp.publicKey.toBase58());
      }
      
      console.log(`   Our Wallets: ${ourWalletAddresses.length} addresses (DEV + ${kps.length} bundler)`);
      console.log("   ⚡ Tracking starts NOW - will detect buys instantly!\n");
      
      // Start tracking (non-blocking - runs in parallel)
      const trackingStarted = websocketTrackerInstance.startTracking(
        mintAddress.toBase58(),
        ourWalletAddresses,
        autoSellEnabled,
        0.1, // threshold (not used for cumulative)
        WEBSOCKET_EXTERNAL_BUY_THRESHOLD,
        WEBSOCKET_EXTERNAL_BUY_WINDOW * 1000, // Convert to milliseconds
        false, // simulationMode = false (real mode)
        autoSellType // 'rapid-sell' or 'rapid-sell-50-percent'
      );
      
      if (trackingStarted) {
        console.log("✅✅✅ WEBSOCKET TRACKING STARTED SUCCESSFULLY! ✅✅✅\n");
      } else {
        console.error("❌ Failed to start WebSocket tracking");
      }
    } catch (error: any) {
      console.error("❌ Error starting WebSocket tracking:", error.message);
      console.error("   Tracking will NOT be active for this launch");
      console.error("   You can manually start tracking with: npm run track <mintAddress> <threshold> <window>\n");
    }
  } else {
    console.log("\n⏸️  WEBSOCKET_TRACKING_ENABLED is false in .env");
    console.log("   Real-time tracking is DISABLED");
    console.log("   Set WEBSOCKET_TRACKING_ENABLED=true to enable\n");
  }

  console.log("Creating LUT started")
  const lutAddress = await createLUT(mainKp)
  if (!lutAddress) {
    console.log("Lut creation failed")
    return
  }
  console.log("LUT Address:", lutAddress.toBase58())
  saveDataToFile([lutAddress.toBase58()], "lut.json")
  
  // Prepare buyer wallet for dev buy
  const buyerKp = Keypair.fromSecretKey(base58.decode(BUYER_WALLET))
  console.log("Dev buyer wallet:", buyerKp.publicKey.toBase58())
  
  // Fund buyer wallet if it doesn't have enough SOL (only if it's different from main wallet)
  const isBuyerSameAsMain = buyerKp.publicKey.equals(mainKp.publicKey)
  if (!isBuyerSameAsMain) {
    const buyerBalance = await connection.getBalance(buyerKp.publicKey)
    const buyerRequiredAmount = Math.floor((BUYER_AMOUNT + 0.01) * 10 ** 9) // Buy amount + buffer for fees
    if (buyerBalance < buyerRequiredAmount) {
      console.log(`Funding buyer wallet: ${(buyerBalance / 10 ** 9).toFixed(4)} SOL → ${(buyerRequiredAmount / 10 ** 9).toFixed(4)} SOL needed`)
      const fundBuyerTx = new VersionedTransaction(
        new TransactionMessage({
          payerKey: mainKp.publicKey,
          recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
          instructions: [
            ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 250_000 }),
            SystemProgram.transfer({
              fromPubkey: mainKp.publicKey,
              toPubkey: buyerKp.publicKey,
              lamports: buyerRequiredAmount
            })
          ]
        }).compileToV0Message()
      )
      fundBuyerTx.sign([mainKp])
      const fundBuyerSig = await connection.sendTransaction(fundBuyerTx, { skipPreflight: false })
      await connection.confirmTransaction(fundBuyerSig, "confirmed")
      console.log(`✅ Buyer wallet funded: https://solscan.io/tx/${fundBuyerSig}`)
    } else {
      console.log(`✅ Buyer wallet has sufficient balance: ${(buyerBalance / 10 ** 9).toFixed(4)} SOL`)
    }
  } else {
    console.log(`✅ Buyer wallet is the same as main wallet - no funding needed`)
  }
  
  // Add buyer wallet to LUT along with other wallets
  if (!(await addAddressesToTableMultiExtend(lutAddress, mintAddress, [...kps, buyerKp], mainKp))) {
    console.log("Adding addresses to table failed")
    return
  }

  // Get lookup table (needed for dev buy and bundler buys)
  const lookupTable = (await connection.getAddressLookupTable(lutAddress)).value;
  if (!lookupTable) {
    console.log("Lookup table not ready")
    return
  }

  // Store buy instructions per wallet index to handle skipped wallets correctly
  // Also track which wallets are actually used (not skipped)
  const buyIxsByWallet: { [walletIndex: number]: TransactionInstruction[] } = {}
  const walletsUsed: Keypair[] = [] // Track wallets that actually get buy instructions

  for (let i = 0; i < DISTRIBUTION_WALLETNUM; i++) {
    // Use custom amount if provided, otherwise use SWAP_AMOUNT
    let buyAmount = swapAmountsToUse[i] || SWAP_AMOUNT; // Fallback to SWAP_AMOUNT if undefined
    if (isNaN(buyAmount) || buyAmount <= 0) {
      console.error(`Invalid buy amount for wallet ${i}: ${buyAmount}. Using SWAP_AMOUNT instead.`);
      buyAmount = SWAP_AMOUNT;
    }
    const buyAmountLamports = Math.floor(buyAmount * 10 ** 9);
    if (isNaN(buyAmountLamports) || buyAmountLamports <= 0) {
      console.error(`Invalid buy amount in lamports for wallet ${i}: ${buyAmountLamports}. Skipping wallet.`);
      console.warn(`⚠️  Wallet ${i} (${kps[i].publicKey.toBase58()}) will NOT be used for buying (skipped due to invalid amount)`);
      continue; // Skip this wallet
    }
    const ix = await makeBuyIx(kps[i], buyAmountLamports, i, mainKp.publicKey, mintAddress)
    buyIxsByWallet[i] = ix // Store by wallet index
    walletsUsed.push(kps[i]) // Track this wallet as used
    console.log(`Wallet ${i} will buy ${buyAmount} SOL worth of tokens`)
  }
  
  console.log(`\n📊 Wallet Usage Summary:`)
  console.log(`   - Total wallets created: ${kps.length}`)
  console.log(`   - Wallets with buy instructions: ${walletsUsed.length}`)
  if (walletsUsed.length < kps.length) {
    console.warn(`   ⚠️  ${kps.length - walletsUsed.length} wallet(s) skipped (no buy instructions)`)
    console.warn(`   ⚠️  Skipped wallets will NOT be included in current-run.json (but remain in data.json as backup)`)
  }
  
  // DON'T save current-run.json yet - wait until bundle is confirmed successful
  // This prevents saving mint address from failed launches
  // We'll save it after token is confirmed on-chain
  console.log(`\n📝 Current run info (will save after successful launch):`)
  console.log(`   - Wallets used (with buy instructions): ${walletsUsed.length}`)
  console.log(`   - Total wallets created: ${kps.length}`)
  console.log(`   - Mint: ${mintAddress.toBase58()}`)
  console.log(`   - Will save to current-run.json ONLY after token is confirmed on-chain`)

  // Get a fresh blockhash RIGHT BEFORE creating all transactions
  // All transactions in the bundle MUST use the same blockhash for Jito bundling
  console.log("Getting fresh blockhash for bundle...")
  let latestBlockhash = await connection.getLatestBlockhash()
  console.log(`Using blockhash: ${latestBlockhash.blockhash.slice(0, 8)}... (valid until block ${latestBlockhash.lastValidBlockHeight})`)

  const tokenCreationTx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: mainKp.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: tokenCreationIxs
    }).compileToV0Message()
  )

  tokenCreationTx.sign([mainKp, mintKp])

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
  console.log("Creating DEV buy transaction (FIRST buy)...")
  console.log("   Using official pump.fun SDK - same as frontend (not a sniper)")
  const devBuyAmountLamports = Math.floor(BUYER_AMOUNT * 10 ** 9)
  const devBuyIxs = await makeBuyIx(buyerKp, devBuyAmountLamports, 0, mainKp.publicKey, mintAddress)
  
  // Use same blockhash as token creation for bundling (important!)
  // Use SAME compute budget settings as bundler wallets for consistency
  const devBuyMsg = new TransactionMessage({
    payerKey: buyerKp.publicKey,
    recentBlockhash: latestBlockhash.blockhash, // Same blockhash as token creation
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 5_000_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }),
      ...devBuyIxs
    ]
  }).compileToV0Message([lookupTable]) // Use lookup table for efficiency
  
  const devBuyTx = new VersionedTransaction(devBuyMsg)
  devBuyTx.sign([buyerKp])
  transactions.push(devBuyTx)
  console.log(`✅ DEV buy transaction created: ${BUYER_AMOUNT} SOL from ${buyerKp.publicKey.toBase58()}`)
  console.log(`   This will be the FIRST buy transaction in the bundle (right after token creation)`)
  console.log(`   Bundle order: 1) Token Creation → 2) DEV Buy → 3) Bundler Wallet Buys`)
  
  // Now create bundler wallet buy transactions
  // IMPORTANT: Use the SAME blockhash as token creation and DEV buy for proper bundling
  for (let i = 0; i < Math.ceil(DISTRIBUTION_WALLETNUM / 4); i++) {
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
  console.log(`2. DEV Buy Transaction (${BUYER_AMOUNT} SOL from ${buyerKp.publicKey.toBase58()})`)
  console.log(`3-${transactions.length}. Bundler Wallet Buy Transactions (${DISTRIBUTION_WALLETNUM} wallets)`)
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
    const newTokenCreationTx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: mainKp.publicKey,
        recentBlockhash: freshBlockhash.blockhash,
        instructions: tokenCreationIxs
      }).compileToV0Message()
    )
    newTokenCreationTx.sign([mainKp, mintKp])
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
    for (let i = 0; i < Math.ceil(DISTRIBUTION_WALLETNUM / 4); i++) {
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
  
  // Send bundle IMMEDIATELY after creation to avoid blockhash expiration
  // CRITICAL: Start bundle submission in background, don't wait for all retries
  // Rapid sell needs to start immediately, not wait for Jito rate limit retries
  console.log("\nSending bundle immediately to avoid blockhash expiration...")
  console.log("⚡⚡⚡ Bundle submission starting - rapid sell will fire IMMEDIATELY after first success ⚡⚡⚡")
  
  let bundleSuccess = false
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
  
  // Save wallet info immediately (before rapid sell) so rapid sell can use it
  // We'll update launchStatus after token confirmation
  console.log("\n💾 Saving wallet info for rapid sell...")
  const initialRunWallets = {
    count: walletsUsed.length,
    totalCreated: kps.length,
    timestamp: Date.now(),
    mintAddress: mintAddress.toBase58(),
    launchStatus: "PENDING", // Will be updated to SUCCESS/FAILED after confirmation
    walletKeys: walletsUsed.map(kp => base58.encode(kp.secretKey))
  }
  const keysPath = path.join('keys', 'current-run.json')
  fs.writeFileSync(keysPath, JSON.stringify(initialRunWallets, null, 2))
  console.log(`   ✅ Saved wallet info for rapid sell (${walletsUsed.length} wallets)`)
  
  // AUTOMATIC SELL - Start IMMEDIATELY after bundle is sent (don't wait for confirmation!)
  // BUT: If WebSocket tracking is enabled, DON'T auto-sell on launch - let WebSocket trigger it when threshold is met
  // If WebSocket tracking is disabled, use the normal auto-sell behavior
  let rapidSellPromise: Promise<void> | null = null
  
  // Check if WebSocket tracking is enabled - if so, skip automatic sell (WebSocket will trigger it)
  if (WEBSOCKET_TRACKING_ENABLED) {
    console.log("\n⏸️  WEBSOCKET TRACKING IS ENABLED - Skipping automatic sell on launch");
    console.log("⚡ Auto-sell will be triggered by WebSocket when external buy threshold is reached");
    console.log(`⚡ Threshold: ${WEBSOCKET_EXTERNAL_BUY_THRESHOLD} SOL (cumulative within ${WEBSOCKET_EXTERNAL_BUY_WINDOW}s)`);
    if (AUTO_SELL_50_PERCENT) {
      console.log("⚡ Sell type: 50% of bundler wallets (DEV excluded)");
    } else if (AUTO_RAPID_SELL) {
      console.log("⚡ Sell type: ALL wallets (bundler + DEV)");
    }
    console.log("");
  } else {
    // WebSocket tracking is disabled - use normal automatic sell behavior
    // Priority: AUTO_SELL_50_PERCENT takes precedence over AUTO_RAPID_SELL (they are mutually exclusive)
    if (AUTO_SELL_50_PERCENT) {
      console.log("\n🚀🚀🚀 AUTOMATIC SELL 50% STARTING IMMEDIATELY... 🚀🚀🚀")
      console.log("⚡⚡⚡ FIRING INSTANTLY - No waiting for token confirmation! ⚡⚡⚡")
      console.log("⚡ Sell will retry until tokens are detected (beats all bots!)")
      console.log("⚡ This will sell 100% of tokens from HALF the bundler wallets (DEV wallet EXCLUDED)\n")
      
      rapidSellPromise = (async () => {
        try {
          const { rapidSell50Percent } = await import('./rapid-sell-50-percent')
          // Start with 0ms wait - fires immediately, retries until tokens detected
          await rapidSell50Percent(mintAddress.toBase58(), 0)
          
          // AUTOMATIC GATHER - Recover SOL from all wallets after sell (if enabled)
          if (AUTO_GATHER) {
            console.log("\n💰💰💰 AUTOMATIC GATHER STARTING... 💰💰💰")
            console.log("⚡ Recovering SOL from all wallets (bundler + DEV)")
            console.log("⚡ This will sell any remaining tokens and transfer all SOL to main wallet\n")
            
            try {
              // Import and call gather function directly
              const { gather } = await import('./gather')
              await gather()
              console.log("\n✅✅✅ AUTOMATIC GATHER COMPLETED ✅✅✅")
            } catch (error: any) {
              console.error("❌ Error starting automatic gather:", error.message)
              console.error("   You can manually run: npm run gather")
            }
          } else {
            console.log("\n⏸️  AUTO_GATHER is disabled in .env")
            console.log("   Gather will NOT start automatically")
            console.log("   Run manually with: npm run gather")
          }

          // AUTOMATIC FEE COLLECTION - Collect creator fees after sell (if enabled)
          if (AUTO_COLLECT_FEES) {
            console.log("\n💰💰💰 AUTOMATIC FEE COLLECTION STARTING... 💰💰💰")
            try {
              const { collectCreatorFees } = await import('./collect-fees')
              const creatorWallet = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))
              await collectCreatorFees(creatorWallet)
              console.log("\n✅ Automatic fee collection completed")
            } catch (error: any) {
              console.error("❌ Error in automatic fee collection:", error.message)
              console.error("   You can manually run: npm run collect-fees")
            }
          } else {
            console.log("\n⏸️  AUTO_COLLECT_FEES is disabled in .env")
            console.log("   Fees will remain in creator vault")
            console.log("   Run manually with: npm run collect-fees")
          }
        } catch (error: any) {
          console.error("❌ Error in sell 50%:", error.message)
          console.error("   You can manually run: npm run rapid-sell-50-percent")
        }
      })()
    } else if (AUTO_RAPID_SELL) {
      console.log("\n🚀🚀🚀 AUTOMATIC RAPID SELL STARTING IMMEDIATELY... 🚀🚀🚀")
      console.log("⚡⚡⚡ FIRING INSTANTLY - No waiting for token confirmation! ⚡⚡⚡")
      console.log("⚡ Rapid sell will retry until tokens are detected (beats all bots!)")
      console.log("⚡ This will sell 100% of tokens from ALL wallets (bundler + DEV)\n")
      
      rapidSellPromise = (async () => {
        try {
          const { rapidSell } = await import('./rapid-sell')
          // Start with 0ms wait - fires immediately, retries until tokens detected
          await rapidSell(mintAddress.toBase58(), 0)
          
          // AUTOMATIC GATHER - Recover SOL from all wallets after rapid sell (if enabled)
          if (AUTO_GATHER) {
            console.log("\n💰💰💰 AUTOMATIC GATHER STARTING... 💰💰💰")
            console.log("⚡ Recovering SOL from all wallets (bundler + DEV)")
            console.log("⚡ This will sell any remaining tokens and transfer all SOL to main wallet\n")
            
            try {
              // Import and call gather function directly
              const { gather } = await import('./gather')
              await gather()
              console.log("\n✅✅✅ AUTOMATIC GATHER COMPLETED ✅✅✅")
            } catch (error: any) {
              console.error("❌ Error starting automatic gather:", error.message)
              console.error("   You can manually run: npm run gather")
            }
          } else {
            console.log("\n⏸️  AUTO_GATHER is disabled in .env")
            console.log("   Gather will NOT start automatically")
            console.log("   Run manually with: npm run gather")
          }

          // AUTOMATIC FEE COLLECTION - Collect creator fees after rapid sell (if enabled)
          if (AUTO_COLLECT_FEES) {
            console.log("\n💰💰💰 AUTOMATIC FEE COLLECTION STARTING... 💰💰💰")
            try {
              const { collectCreatorFees } = await import('./collect-fees')
              const creatorWallet = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))
              await collectCreatorFees(creatorWallet)
              console.log("\n✅ Automatic fee collection completed")
            } catch (error: any) {
              console.error("❌ Error in automatic fee collection:", error.message)
              console.error("   You can manually run: npm run collect-fees")
            }
          } else {
            console.log("\n⏸️  AUTO_COLLECT_FEES is disabled in .env")
            console.log("   Fees will remain in creator vault")
            console.log("   Run manually with: npm run collect-fees")
          }
        } catch (error: any) {
          console.error("❌ Error in rapid sell:", error.message)
          console.error("   You can manually run: npm run rapid-sell")
        }
      })()
    } else {
      console.log("\n⏸️  AUTO_RAPID_SELL and AUTO_SELL_50_PERCENT are disabled in .env")
      console.log("   Sell will NOT start automatically")
      console.log("   Run manually with: npm run rapid-sell or npm run rapid-sell-50-percent")
    }
  } // End of "else" block for when WebSocket tracking is disabled
  
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
      const failedRunWallets = {
        count: walletsUsed.length,
        totalCreated: kps.length,
        timestamp: Date.now(),
        mintAddress: null,
        launchStatus: "FAILED",
        walletKeys: walletsUsed.map(kp => base58.encode(kp.secretKey)),
        failureReason: "Bundle not included on-chain"
      }
      fs.writeFileSync(keysPath, JSON.stringify(failedRunWallets, null, 2))
      console.log("\n   ⚠️  Marked launch as FAILED in current-run.json")
      console.log("   💡 Run gather script to recover SOL from wallets")
      return false
    } else {
      // Update current-run.json with SUCCESS status
      const currentRunWallets = {
        count: walletsUsed.length,
        totalCreated: kps.length,
        timestamp: Date.now(),
        mintAddress: mintAddress.toBase58(),
        launchStatus: "SUCCESS",
        walletKeys: walletsUsed.map(kp => base58.encode(kp.secretKey))
      }
      fs.writeFileSync(keysPath, JSON.stringify(currentRunWallets, null, 2))
      console.log("\n✅✅✅ TOKEN LAUNCH CONFIRMED - Token is on-chain! ✅✅✅")
      
      // Mark pump address as used if we used one from the pool
      if (usedPumpAddressPublicKey) {
        markPumpAddressAsUsed(usedPumpAddressPublicKey)
        console.log(`✅ Marked pump address as used: ${usedPumpAddressPublicKey}`)
      }

      // Start volume maker if enabled
      if (VOLUME_MAKER_ENABLED && walletsUsed.length > 0) {
        console.log("\n📊 Starting volume maker in background...")
        startVolumeMaker(walletsUsed, mintAddress, {
          enabled: VOLUME_MAKER_ENABLED,
          durationMinutes: VOLUME_MAKER_DURATION_MINUTES,
          minIntervalSeconds: VOLUME_MAKER_MIN_INTERVAL_SECONDS,
          maxIntervalSeconds: VOLUME_MAKER_MAX_INTERVAL_SECONDS,
          minBuyAmount: VOLUME_MAKER_MIN_BUY_AMOUNT,
          maxBuyAmount: VOLUME_MAKER_MAX_BUY_AMOUNT,
          minSellPercentage: VOLUME_MAKER_MIN_SELL_PERCENTAGE,
          maxSellPercentage: VOLUME_MAKER_MAX_SELL_PERCENTAGE,
          walletCount: VOLUME_MAKER_WALLET_COUNT
        }).catch((error) => {
          console.error("❌ Volume maker error:", error)
        })
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
  const launchSuccess = await confirmationCheckPromise
  
  // Show interactive menu if launch was successful
  if (launchSuccess) {
    console.log("\n" + "=".repeat(60));
    console.log("✅ Launch completed successfully!");
    console.log("=".repeat(60));
    await showInteractiveMenu();
  } else {
    console.log("\n⚠️  Launch failed or not confirmed. Exiting...");
    process.exit(1);
  }
}

main()
