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

import { DISTRIBUTION_WALLETNUM, LIL_JIT_MODE, PRIVATE_KEY, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, SWAP_AMOUNT, SWAP_AMOUNTS, VANITY_MODE, BUYER_WALLET, BUYER_AMOUNT, AUTO_RAPID_SELL, AUTO_GATHER, BUNDLE_WALLET_COUNT, BUNDLE_SWAP_AMOUNTS, HOLDER_WALLET_COUNT, HOLDER_SWAP_AMOUNTS, HOLDER_WALLET_AMOUNT } from "./constants"
import { generateVanityAddress, saveDataToFile, sleep, getNextPumpAddress, markPumpAddressAsUsed } from "./utils"
import { createTokenTx, distributeSol, createLUT, makeBuyIx, addAddressesToTableMultiExtend } from "./src/main";
import { executeJitoTx, stopJitoRetries } from "./executor/jito";
import { sendBundle } from "./executor/liljito";



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

  // Prepare buyer wallet for dev buy (needed for createTokenTx)
  // If BUYER_WALLET is not set, create it the SAME WAY as bundle wallets (using distributeSol)
  let buyerKp: Keypair
  let buyerWalletSource: string
  if (BUYER_WALLET && BUYER_WALLET.trim() !== '') {
    // Use BUYER_WALLET from .env (persistent wallet)
    buyerKp = Keypair.fromSecretKey(base58.decode(BUYER_WALLET))
    buyerWalletSource = 'BUYER_WALLET env var (persistent)'
    console.log("Dev buyer wallet (from .env):", buyerKp.publicKey.toBase58())
  } else {
    // Create DEV wallet FIRST using distributeSol (same as bundle wallets) - saves to data.json automatically
    console.log("   ⚠️  BUYER_WALLET not set in .env - creating DEV wallet like bundle wallets")
    console.log("   💡 This wallet will be created and saved to data.json (same as bundle wallets)")
    
    const buyerAmount = Number(process.env.BUYER_AMOUNT || '0.1');
    const devRequiredAmount = buyerAmount + 0.1 // BUYER_AMOUNT + 0.1 SOL buffer for fees/rent/safety
    console.log(`\n💰 Creating DEV wallet FIRST (same as bundle wallets)...`)
    console.log(`   Amount: ${devRequiredAmount.toFixed(4)} SOL (${buyerAmount.toFixed(4)} for buy + 0.1 SOL buffer)`)
    
    const devWalletResult = await distributeSol(connection, mainKp, 1, [devRequiredAmount])
    if (!devWalletResult || devWalletResult.length === 0) {
      console.error(`   ❌ Failed to create DEV wallet`)
      return
    }
    buyerKp = devWalletResult[0]
    buyerWalletSource = 'auto-created (saved to data.json like bundle wallets)'
    console.log(`   ✅ Created DEV wallet: ${buyerKp.publicKey.toBase58()}`)
    console.log(`   ✅ Saved to data.json (same as bundle wallets)`)
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
  const bundleSwapAmounts = bundleSwapAmountsString
    ? bundleSwapAmountsString.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n))
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
  
  let swapAmountsToUse: number[];
  if (bundleSwapAmounts.length > 0) {
    swapAmountsToUse = [...bundleSwapAmounts];
    // Pad with SWAP_AMOUNT if we have fewer amounts than wallets
    while (swapAmountsToUse.length < bundleWalletCount) {
      console.warn(`   ⚠️  BUNDLE_SWAP_AMOUNTS has ${swapAmountsToUse.length} values but need ${bundleWalletCount}. Padding with SWAP_AMOUNT (${SWAP_AMOUNT})`);
      swapAmountsToUse.push(SWAP_AMOUNT);
    }
    // Trim if we have more amounts than wallets (shouldn't happen, but be safe)
    swapAmountsToUse = swapAmountsToUse.slice(0, bundleWalletCount);
    console.log(`   ✅ Using custom amounts: [${swapAmountsToUse.join(', ')}]`);
  } else {
    console.warn(`   ⚠️  BUNDLE_SWAP_AMOUNTS is empty! All wallets will use SWAP_AMOUNT (${SWAP_AMOUNT})`);
    swapAmountsToUse = Array(bundleWalletCount).fill(SWAP_AMOUNT);
  }
  const minimumSolAmount = swapAmountsToUse.reduce((sum, amount) => sum + amount + 0.01, 0) + 0.04 + buyerAmount

  if (mainBal / 10 ** 9 < minimumSolAmount) {
    console.log("Main wallet balance is not enough to run the bundler")
    console.log(`Plz charge the wallet more than ${minimumSolAmount.toFixed(3)}SOL`)
    return
  }

  // Check if existing BUYER_WALLET has enough balance (if using persistent wallet)
  // If insufficient, fund it automatically (same as auto-created wallets)
  // BUT: Skip funding if BUYER_WALLET is the same as PRIVATE_KEY (same wallet, no transfer needed)
  if (BUYER_WALLET && BUYER_WALLET.trim() !== '') {
    const isSameWallet = mainKp.publicKey.equals(buyerKp.publicKey)
    
    if (isSameWallet) {
      // Same wallet - just check balance, no funding needed
      const existingBalance = await connection.getBalance(buyerKp.publicKey)
      const existingBalanceSol = existingBalance / 1e9
      const devRequiredAmount = buyerAmount + 0.1 // BUYER_AMOUNT + 0.1 SOL buffer for fees/rent/safety
      if (existingBalanceSol < devRequiredAmount) {
        console.log(`\n⚠️  BUYER_WALLET is the same as PRIVATE_KEY (master wallet)`)
        console.log(`   Current balance: ${existingBalanceSol.toFixed(4)} SOL`)
        console.log(`   Need at least ${devRequiredAmount.toFixed(4)} SOL for DEV buy`)
        console.log(`   Breakdown: ${buyerAmount.toFixed(4)} SOL (buy) + 0.1 SOL (buffer for fees/rent/safety)`)
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
      const devRequiredAmount = buyerAmount + 0.1 // BUYER_AMOUNT + 0.1 SOL buffer for fees/rent/safety
      if (existingBalanceSol < devRequiredAmount) {
        const fundingNeeded = devRequiredAmount - existingBalanceSol
        console.log(`\n⚠️  BUYER_WALLET has insufficient balance (${existingBalanceSol.toFixed(4)} SOL)`)
        console.log(`   Need at least ${devRequiredAmount.toFixed(4)} SOL for DEV buy`)
        console.log(`   Breakdown: ${buyerAmount.toFixed(4)} SOL (buy) + 0.1 SOL (buffer for fees/rent/safety)`)
        console.log(`\n💰 Funding BUYER_WALLET with ${fundingNeeded.toFixed(4)} SOL...`)
        
        try {
          const latestBlockhash = await connection.getLatestBlockhash()
          const fundingLamports = Math.ceil(fundingNeeded * 1e9)
          const transferMsg = new TransactionMessage({
            payerKey: mainKp.publicKey,
            recentBlockhash: latestBlockhash.blockhash,
            instructions: [
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
      } else {
        console.log(`\n✅ BUYER_WALLET has sufficient balance: ${existingBalanceSol.toFixed(4)} SOL`)
      }
    }
  }
  // Note: If BUYER_WALLET was not set, the wallet was already created and funded above using distributeSol

  if (bundleWalletCount === 0) {
    console.log("⚠️  BUNDLE_WALLET_COUNT is 0 - no bundle wallets will be created")
    console.log("   Set BUNDLE_WALLET_COUNT in .env to create bundle wallets")
  }

  console.log("Distributing SOL to wallets...")
  const swapAmountsForDistribution = bundleSwapAmounts.length > 0 ? bundleSwapAmounts : undefined
  
  let result = await distributeSol(connection, mainKp, bundleWalletCount, swapAmountsForDistribution)
  if (!result) {
    console.log("Distribution failed")
    return
  } else {
    kps = result
  }

  // Create holder wallets (buy separately, not in bundle)
  let holderWallets: Keypair[] = []
  if (holderWalletCount > 0) {
    console.log(`\n👥 Creating ${holderWalletCount} holder wallets...`)
    
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
    const holderResult = await distributeSol(connection, mainKp, holderWalletCount, holderAmounts)
    if (holderResult) {
      holderWallets = holderResult
      console.log(`   ✅ Created ${holderWallets.length} holder wallets`)
    } else {
      console.log("   ⚠️  Holder wallet distribution failed, continuing without holder wallets")
    }
  } else {
    console.log("   ℹ️  HOLDER_WALLET_COUNT is 0 - no holder wallets will be created")
  }

  // CRITICAL: Save current-run.json IMMEDIATELY after wallets are created
  // This ensures wallets are saved even if bundle fails early
  console.log("\n💾 Saving wallet info to current-run.json (immediate save)...")
  const initialRunWallets: any = {
    count: kps.length, // Will update with walletsUsed.length after buy instructions are created
    totalCreated: kps.length + holderWallets.length + (BUYER_WALLET && BUYER_WALLET.trim() !== '' ? 0 : 1),
    timestamp: Date.now(),
    mintAddress: mintAddress.toBase58(),
    launchStatus: "PENDING", // Will be updated to SUCCESS/FAILED after confirmation
    bundleWalletKeys: kps.map(kp => base58.encode(kp.secretKey)), // All bundle wallets (will filter to walletsUsed later)
    holderWalletKeys: holderWallets.map(kp => base58.encode(kp.secretKey)), // Holder wallets
    walletKeys: [...kps, ...holderWallets].map(kp => base58.encode(kp.secretKey)) // All wallets for backward compatibility
  }
  // Save creatorDevWalletKey
  initialRunWallets.creatorDevWalletKey = base58.encode(buyerKp.secretKey)
  const keysPath = path.join('keys', 'current-run.json')
  fs.writeFileSync(keysPath, JSON.stringify(initialRunWallets, null, 2))
  console.log(`   ✅ Saved ${kps.length} bundle wallets, ${holderWallets.length} holder wallets, and DEV wallet`)
  console.log(`   ✅ current-run.json will be updated as process progresses`)

  console.log("Creating LUT started")
  const lutAddress = await createLUT(mainKp)
  if (!lutAddress) {
    console.log("Lut creation failed")
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
  const lookupTable = (await connection.getAddressLookupTable(lutAddress)).value;
  if (!lookupTable) {
    console.log("Lookup table not ready")
    return
  }

  // Store buy instructions per wallet index to handle skipped wallets correctly
  // Also track which wallets are actually used (not skipped)
  const buyIxsByWallet: { [walletIndex: number]: TransactionInstruction[] } = {}
  const walletsUsed: Keypair[] = [] // Track wallets that actually get buy instructions

  for (let i = 0; i < bundleWalletCount; i++) {
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
    currentRunData.walletKeys = [...walletsUsed, ...holderWallets].map(kp => base58.encode(kp.secretKey))
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
  // CRITICAL: buyerKp is the token creator (passed to createTokenTx), so it must be the referrer
  console.log("Creating DEV buy transaction (FIRST buy)...")
  console.log("   Using official pump.fun SDK - same as frontend (not a sniper)")
  
  // Verify DEV wallet has sufficient balance before creating buy transaction
  const devBalance = await connection.getBalance(buyerKp.publicKey)
  const devBalanceSol = devBalance / 1e9
  const devRequiredAmount = buyerAmount + 0.1 // BUYER_AMOUNT + 0.1 SOL buffer
  console.log(`   DEV wallet balance: ${devBalanceSol.toFixed(4)} SOL`)
  console.log(`   Required: ${devRequiredAmount.toFixed(4)} SOL (${buyerAmount.toFixed(4)} for buy + 0.1 buffer)`)
  
  if (devBalanceSol < devRequiredAmount) {
    console.error(`\n❌ ERROR: DEV wallet has insufficient balance!`)
    console.error(`   Current: ${devBalanceSol.toFixed(4)} SOL`)
    console.error(`   Required: ${devRequiredAmount.toFixed(4)} SOL`)
    console.error(`   Please fund the wallet or check funding logic`)
    return
  }
  
  const devBuyAmountLamports = Math.floor(buyerAmount * 10 ** 9)
  const devBuyIxs = await makeBuyIx(buyerKp, devBuyAmountLamports, 0, buyerKp.publicKey, mintAddress)
  
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
        currentRunData.failureReason = "Bundle not included on-chain"
        fs.writeFileSync(keysPath, JSON.stringify(currentRunData, null, 2))
        console.log("\n   ⚠️  Updated current-run.json: launchStatus = FAILED")
        console.log("   💡 All wallets are saved in current-run.json - you can retry with: npm run retry-bundle")
        console.log("   💡 Or run gather script to recover SOL from wallets")
      } else {
        // Fallback: create new file if somehow it doesn't exist
        const failedRunWallets: any = {
          count: walletsUsed.length,
          totalCreated: kps.length + holderWallets.length + (BUYER_WALLET && BUYER_WALLET.trim() !== '' ? 0 : 1),
          timestamp: Date.now(),
          mintAddress: mintAddress.toBase58(),
          launchStatus: "FAILED",
          bundleWalletKeys: walletsUsed.map(kp => base58.encode(kp.secretKey)),
          holderWalletKeys: holderWallets.map(kp => base58.encode(kp.secretKey)),
          walletKeys: [...walletsUsed, ...holderWallets].map(kp => base58.encode(kp.secretKey)),
          creatorDevWalletKey: base58.encode(buyerKp.secretKey),
          failureReason: "Bundle not included on-chain"
        }
        fs.writeFileSync(keysPath, JSON.stringify(failedRunWallets, null, 2))
        console.log("\n   ⚠️  Created current-run.json with FAILED status")
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
        fs.writeFileSync(keysPath, JSON.stringify(currentRunData, null, 2))
        console.log(`   ✅ Updated current-run.json: launchStatus = SUCCESS`)
      } else {
        // Fallback: create new file if somehow it doesn't exist
        const currentRunWallets: any = {
          count: walletsUsed.length,
          totalCreated: kps.length + holderWallets.length + (BUYER_WALLET && BUYER_WALLET.trim() !== '' ? 0 : 1),
          timestamp: Date.now(),
          mintAddress: mintAddress.toBase58(),
          launchStatus: "SUCCESS",
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

