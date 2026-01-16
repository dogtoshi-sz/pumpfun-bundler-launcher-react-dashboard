import { VersionedTransaction, Keypair, SystemProgram, Transaction, Connection, ComputeBudgetProgram, TransactionInstruction, TransactionMessage, AddressLookupTableProgram, PublicKey, SYSVAR_RENT_PUBKEY } from "@solana/web3.js"
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { AnchorProvider } from "@coral-xyz/anchor";
import { openAsBlob } from "fs";
import base58 from "bs58"
import fs from "fs"
import path from "path"

import { DESCRIPTION, FILE, JITO_FEE, PUMP_PROGRAM, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, SWAP_AMOUNT, SWAP_AMOUNTS, TELEGRAM, TOKEN_CREATE_ON, TOKEN_NAME, TOKEN_SHOW_NAME, TOKEN_SYMBOL, TWITTER, WEBSITE } from "../constants"
import { saveDataToFile, sleep } from "../utils"
import { NUM_INTERMEDIARY_HOPS, USE_MULTI_INTERMEDIARY_SYSTEM } from "../constants"
import { createAndSendV0Tx, execute } from "../executor/legacy"
import { PumpFunSDK } from "@solana-ipfs/sdk"

const commitment = "confirmed"

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT, commitment
})
let sdk = new PumpFunSDK(new AnchorProvider(connection, new NodeWallet(new Keypair()), { commitment }));
let kps: Keypair[] = []

// create token instructions
// creatorKp should be BUYER_WALLET (wallet that creates tokens, buys as DEV, and collects fees)
export const createTokenTx = async (creatorKp: Keypair, mintKp: Keypair, mainKp: Keypair) => {
  // Handle FILE - can be a URL or local file path
  let fileBlob: Blob;
  if (FILE.startsWith('http://') || FILE.startsWith('https://')) {
    // FILE is a URL - fetch it
    console.log(`📥 Fetching image from URL: ${FILE}`);
    const response = await fetch(FILE);
    if (!response.ok) {
      throw new Error(`Failed to fetch image from URL: ${response.statusText}`);
    }
    fileBlob = await response.blob();
    console.log(`✅ Fetched image from URL (${fileBlob.size} bytes)`);
  } else {
    // FILE is a local path - open it
    const filePath = path.isAbsolute(FILE) ? FILE : path.join(process.cwd(), FILE);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Image file not found: ${filePath}`);
    }
    console.log(`📂 Opening local image file: ${filePath}`);
    fileBlob = await openAsBlob(filePath);
    console.log(`✅ Opened local image file (${fileBlob.size} bytes)`);
  }

  const tokenInfo = {
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    description: DESCRIPTION,
    showName: TOKEN_SHOW_NAME,
    createOn: TOKEN_CREATE_ON,
    twitter: TWITTER,
    telegram: TELEGRAM,
    website: WEBSITE,
    file: fileBlob,
  };
  let tokenMetadata = await sdk.createTokenMetadata(tokenInfo) as any;

  let createIx = await sdk.getCreateInstructions(
    creatorKp.publicKey,
    tokenInfo.name,
    tokenInfo.symbol,
    tokenMetadata.metadataUri,
    mintKp
  );

  const tipAccounts = [
    'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
    'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
    '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
    '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
    'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
    'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
    'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
    'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  ];
  const jitoFeeWallet = new PublicKey(tipAccounts[Math.floor(tipAccounts.length * Math.random())])
  // CRITICAL: Jito fee should come from creator wallet (creatorKp), not funding wallet (mainKp)
  // This ensures the creator wallet is the one paying for everything
  // Priority fees: Much lower for normal launches (not competing in bundles)
  // - Token creation typically needs ~200k-500k compute units
  // - Standard priority fee: ~1,000-5,000 microLamports per unit
  // - High priority (for bundles): 20,000 microLamports per unit
  // For normal launches, we use lower fees since we're not in a bundle
  // Calculation: (units * price) / 1,000,000 = lamports
  // Bundle: (5M * 20k) / 1M = 100k lamports = 0.0001 SOL per tx
  // Normal: (500k * 5k) / 1M = 2.5k lamports = 0.0000025 SOL per tx (much cheaper!)
  const isNormalLaunch = process.env.USE_NORMAL_LAUNCH === 'true' && Number(process.env.BUNDLE_WALLET_COUNT || '0') === 0
  const computeUnitLimit = isNormalLaunch ? 500_000 : 5_000_000 // Lower limit for normal launch
  const computeUnitPrice = isNormalLaunch ? 5_000 : 20_000 // Lower price for normal launch (~0.0025 SOL vs ~0.1 SOL per tx)
  
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: computeUnitPrice }),
    SystemProgram.transfer({
      fromPubkey: creatorKp.publicKey, // CRITICAL: Creator wallet pays Jito fee, not funding wallet
      toPubkey: jitoFeeWallet,
      lamports: Math.floor(JITO_FEE * 10 ** 9),
    }),
    createIx as TransactionInstruction
  ]
}


// Load mixing wallets from file (if exists)
export const loadMixingWallets = (): Keypair[] => {
  try {
    const mixingPath = path.join(process.cwd(), 'keys', 'mixing-wallets.json')
    if (fs.existsSync(mixingPath)) {
      const data = JSON.parse(fs.readFileSync(mixingPath, 'utf8'))
      const wallets: Keypair[] = []
      for (const key in data) {
        if (key !== 'createdAt' && key !== 'lastUsed' && data[key]?.privateKey) {
          try {
            wallets.push(Keypair.fromSecretKey(base58.decode(data[key].privateKey)))
          } catch (e) {
            // Skip invalid keys
          }
        }
      }
      return wallets
    }
  } catch (e) {
    // If file doesn't exist or is invalid, return empty array
  }
  return []
}

// Save/update mixing wallets to file
// IMPORTANT: This function PRESERVES all existing wallets and only adds/updates new ones
// Mixing wallets are stored separately from data.json to avoid confusion
const saveMixingWallets = (mixingWallets: Keypair[]) => {
  try {
    const mixingPath = path.join(process.cwd(), 'keys', 'mixing-wallets.json')
    const keysDir = path.dirname(mixingPath)
    
    // Create keys directory if it doesn't exist
    if (!fs.existsSync(keysDir)) {
      fs.mkdirSync(keysDir, { recursive: true })
    }
    
    let existingData: any = {}
    if (fs.existsSync(mixingPath)) {
      try {
        existingData = JSON.parse(fs.readFileSync(mixingPath, 'utf8'))
      } catch (e) {
        // If file is corrupted, start fresh
        existingData = {}
      }
    }
    
    // PRESERVE all existing wallets (don't delete any)
    // Only update/add the wallets from the new array
    const existingPublicKeys = new Set<string>()
    const walletKeys: string[] = []
    
    // First, collect all existing wallet keys and their public keys
    for (const key in existingData) {
      if (key !== 'createdAt' && key !== 'lastUsed' && existingData[key]?.publicKey) {
        existingPublicKeys.add(existingData[key].publicKey)
        walletKeys.push(key)
      }
    }
    
    // Update or add mixing wallets from the new array
    mixingWallets.forEach((wallet, index) => {
      const publicKey = wallet.publicKey.toBase58()
      const privateKey = base58.encode(wallet.secretKey)
      
      // Check if this wallet already exists (by public key)
      let existingKey: string | null = null
      for (const key in existingData) {
        if (key !== 'createdAt' && key !== 'lastUsed' && existingData[key]?.publicKey === publicKey) {
          existingKey = key
          break
        }
      }
      
      // If wallet exists, update it; otherwise find next available key
      if (existingKey) {
        existingData[existingKey] = { publicKey, privateKey }
      } else {
        // Find next available wallet key (wallet1, wallet2, etc.)
        let newKeyIndex = walletKeys.length + 1
        let newKey = `wallet${newKeyIndex}`
        while (existingData[newKey]) {
          newKeyIndex++
          newKey = `wallet${newKeyIndex}`
        }
        existingData[newKey] = { publicKey, privateKey }
        walletKeys.push(newKey)
      }
    })
    
    // Update metadata
    if (!existingData.createdAt) {
      existingData.createdAt = new Date().toISOString()
    }
    existingData.lastUsed = new Date().toISOString()
    
    // Save to file (preserves ALL wallets - existing + new)
    fs.writeFileSync(mixingPath, JSON.stringify(existingData, null, 2))
    const totalWallets = Object.keys(existingData).filter(k => k !== 'createdAt' && k !== 'lastUsed').length
    console.log(`💾 Saved ${totalWallets} mixing wallet(s) to ${mixingPath} (preserved all existing wallets)`)
  } catch (error) {
    console.log(`⚠️  Failed to save mixing wallets:`, error)
  }
}

export const distributeSol = async (connection: Connection, mainKp: Keypair, distritbutionNum: number, swapAmounts?: number[], useMixing: boolean = true, intermediaryHops?: number) => {
  try {
    // Reset kps array at the start to avoid accumulating wallets from previous runs
    kps = []
    const USE_MIXING = useMixing && (process.env.USE_MIXING_WALLETS !== 'false')
    
    // Load mixing wallets if enabled
    let mixingWallets: Keypair[] = []
    if (USE_MIXING) {
      // Check if we should create fresh mixing wallets for each launch (better privacy)
      const CREATE_FRESH_MIXERS = (process.env.CREATE_FRESH_MIXING_WALLETS || 'true').toLowerCase() === 'true'
      
      if (CREATE_FRESH_MIXERS) {
        // Create fresh mixing wallets for each launch (better privacy - no reuse)
        console.log("🔀 Creating fresh mixing wallets for this launch (better privacy)...")
        const numMixers = Math.max(10, distritbutionNum + 5) // At least 10, or enough for all wallets + buffer
        for (let i = 0; i < numMixers; i++) {
          mixingWallets.push(Keypair.generate())
        }
        // Save fresh mixers (preserves old ones in history, but uses new ones)
        saveMixingWallets(mixingWallets)
        console.log(`✅ Created ${mixingWallets.length} fresh mixing wallets for this launch`)
      } else {
        // Legacy behavior: reuse existing mixing wallets
        mixingWallets = loadMixingWallets()
        if (mixingWallets.length === 0) {
          console.log("⚠️  No mixing wallets found - creating new ones...")
          // Create 10 mixing wallets if none exist (more wallets = better distribution)
          for (let i = 0; i < 10; i++) {
            mixingWallets.push(Keypair.generate())
          }
          saveMixingWallets(mixingWallets)
          console.log(`✅ Created and saved ${mixingWallets.length} new mixing wallets`)
        } else {
          console.log(`🔀 Using ${mixingWallets.length} existing mixing wallets (reusing - less private)`)
          // If we have fewer than 10 mixers and will create many wallets, add more mixers
          if (mixingWallets.length < 10 && distritbutionNum > mixingWallets.length) {
            const additionalNeeded = Math.max(10 - mixingWallets.length, distritbutionNum - mixingWallets.length)
            console.log(`⚠️  Only ${mixingWallets.length} mixing wallets available, but need ${distritbutionNum} wallets. Adding ${additionalNeeded} more mixers...`)
            for (let i = 0; i < additionalNeeded; i++) {
              mixingWallets.push(Keypair.generate())
            }
            saveMixingWallets(mixingWallets)
            console.log(`✅ Now using ${mixingWallets.length} mixing wallets`)
          }
          // Update lastUsed timestamp
          saveMixingWallets(mixingWallets)
        }
      }
    }

    const mainSolBal = await connection.getBalance(mainKp.publicKey)
    if (mainSolBal <= 4 * 10 ** 6) {
      console.log("Main wallet balance is not enough")
      return []
    }

    // Check if using multi-intermediary system (takes priority over mixing)
    const USE_MULTI_INTERMEDIARY = (process.env.USE_MULTI_INTERMEDIARY_SYSTEM || 'false').toLowerCase() === 'true'
    // Use provided intermediaryHops, or fall back to NUM_INTERMEDIARY_HOPS from env
    const NUM_HOPS = intermediaryHops !== undefined ? intermediaryHops : Number(process.env.NUM_INTERMEDIARY_HOPS || '2')
    
    if (USE_MULTI_INTERMEDIARY) {
      console.log(`🔀 Using multi-intermediary system (${NUM_HOPS} hops) for fresh wallets...`)
      // Generate fresh wallets first, then fund them through intermediaries
      const freshWallets: Keypair[] = []
      for (let i = 0; i < distritbutionNum; i++) {
        freshWallets.push(Keypair.generate())
      }
      
      // Fund each wallet through intermediaries in parallel batches
      // Increased batch size for faster funding - process up to 10 wallets in parallel
      const parallelBatchSize = Math.min(10, distritbutionNum) // Process up to 10 wallets simultaneously
      const randomDelay = () => Math.random() * 300 + 100 // Reduced delay: 100-400ms (was 200-700ms)
      
      for (let batchStart = 0; batchStart < freshWallets.length; batchStart += parallelBatchSize) {
        const batchEnd = Math.min(batchStart + parallelBatchSize, freshWallets.length)
        const batch = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i)
        
        console.log(`🔀 Funding fresh wallets batch ${Math.floor(batchStart / parallelBatchSize) + 1}/${Math.ceil(freshWallets.length / parallelBatchSize)} (wallets ${batchStart + 1}-${batchEnd}) through intermediaries...`)
        
        await Promise.all(batch.map(async (i) => {
          const swapAmount = swapAmounts && swapAmounts[i] !== undefined ? swapAmounts[i] : SWAP_AMOUNT
          const requiredAmount = swapAmount + 0.01 // Add buffer for fees
          const wallet = freshWallets[i]
          
          try {
            const success = await fundExistingWalletWithMultipleIntermediaries(connection, mainKp, wallet, requiredAmount, NUM_HOPS)
            if (!success) {
              console.error(`   ❌ Failed to fund fresh wallet ${i + 1} through intermediaries`)
            } else {
              console.log(`   ✅ Fresh wallet ${i + 1} funded through ${NUM_HOPS} intermediaries`)
            }
          } catch (error: any) {
            console.error(`   ❌ Error funding fresh wallet ${i + 1}: ${error.message || error}`)
          }
        }))
        
        // Small delay between batches
        if (batchEnd < freshWallets.length) {
          await sleep(randomDelay() * 2)
        }
      }
      
      // Save wallets to data.json
      try {
        saveDataToFile(freshWallets.map(kp => base58.encode(kp.secretKey)))
      } catch (error) {
        console.error('Failed to save fresh wallets:', error)
      }
      
      kps = freshWallets
      return freshWallets
    }
    
    // If using mixing wallets, fund through intermediate wallets
    // Route: mainKp -> mixing wallet -> target wallet
    // This breaks the direct connection trail that bubble maps detect
    if (USE_MIXING && mixingWallets.length > 0) {
      console.log("🔀 Using mixing wallets to break connection trail...")
      return await distributeSolWithMixing(connection, mainKp, distritbutionNum, swapAmounts, mixingWallets)
    }

    // Original direct funding (no mixing)
    const sendSolTx: TransactionInstruction[] = []
    sendSolTx.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 250_000 })
    )

    for (let i = 0; i < distritbutionNum; i++) {
      // Use custom amount if provided, otherwise use SWAP_AMOUNT
      const swapAmount = swapAmounts && swapAmounts[i] !== undefined ? swapAmounts[i] : SWAP_AMOUNT
      let solAmount = Math.floor((swapAmount + 0.01) * 10 ** 9)

      const wallet = Keypair.generate()
      kps.push(wallet)

      sendSolTx.push(
        SystemProgram.transfer({
          fromPubkey: mainKp.publicKey,
          toPubkey: wallet.publicKey,
          lamports: solAmount
        })
      )
    }

    try {
      saveDataToFile(kps.map(kp => base58.encode(kp.secretKey)))
    } catch (error) {

    }

    let index = 0
    while (true) {
      try {
        if (index > 5) {
          console.log("Error in distribution after 5 retries")
          console.log("This might be due to:")
          console.log("1. RPC rate limiting (try using a premium RPC)")
          console.log("2. Transaction too large (try fewer wallets)")
          console.log("3. Network congestion")
          return null
        }
        console.log(`Attempting to distribute SOL (attempt ${index + 1}/6)...`)
        const latestBlockhash = await connection.getLatestBlockhash()
        const messageV0 = new TransactionMessage({
          payerKey: mainKp.publicKey,
          recentBlockhash: latestBlockhash.blockhash,
          instructions: sendSolTx,
        }).compileToV0Message()
        const transaction = new VersionedTransaction(messageV0)
        transaction.sign([mainKp])
        
        // Check transaction size
        const txSize = transaction.serialize().length
        console.log(`Transaction size: ${txSize} bytes`)
        if (txSize > 1232) {
          console.log("Warning: Transaction size exceeds recommended limit (1232 bytes)")
        }
        
        // console.log(await connection.simulateTransaction(transaction))
        let txSig = await execute(transaction, latestBlockhash, 1)

        if (txSig) {
          const distibuteTx = txSig ? `https://solscan.io/tx/${txSig}` : ''
          console.log("SOL distributed successfully: ", distibuteTx)
          break
        }
        console.log(`Distribution attempt ${index + 1} failed, retrying...`)
        await sleep(2000) // Wait 2 seconds before retry
        index++
      } catch (error) {
        console.log(`Distribution error (attempt ${index + 1}):`, error instanceof Error ? error.message : error)
        await sleep(2000) // Wait 2 seconds before retry
        index++
      }
    }
    console.log("Success in distribution")
    return kps
  } catch (error) {
    console.log(`Failed to transfer SOL`, error)
    return null
  }
}

// New function: Distribute SOL through mixing wallets to break connection trail
// Route: mainKp -> mixing wallet -> target wallet
// This makes it harder for bubble maps to connect wallets
// PARALLEL VERSION: Processes multiple wallets concurrently for speed
const distributeSolWithMixing = async (
  connection: Connection,
  mainKp: Keypair,
  distributionNum: number,
  swapAmounts?: number[],
  mixingWallets: Keypair[] = []
): Promise<Keypair[] | null> => {
  try {
    const wallets: Keypair[] = []
    const parallelBatchSize = 5 // Process 5 wallets in parallel at a time
    const randomDelay = () => Math.random() * 500 + 200 // 200-700ms random delay for privacy

    // Step 1: Generate all target wallets
    console.log(`🔀 Generating ${distributionNum} target wallets...`)
    for (let i = 0; i < distributionNum; i++) {
      wallets.push(Keypair.generate())
    }

    // Step 2: Check mixer balances in parallel and prepare funding transactions
    console.log(`🔀 Checking mixer balances and preparing funding...`)
    const latestBlockhash = await connection.getLatestBlockhash()
    const mixerBalances = await Promise.all(
      mixingWallets.map(mixer => connection.getBalance(mixer.publicKey))
    )

    // Step 3: Process wallets in parallel batches
    // Pre-assign unique mixers to each wallet to ensure no collisions
    const mixerAssignments: number[] = []
    const mixerUsageCount = new Array(mixingWallets.length).fill(0)
    
    // Assign mixers using round-robin with random start, ensuring even distribution
    const startMixer = Math.floor(Math.random() * mixingWallets.length)
    for (let i = 0; i < distributionNum; i++) {
      // Round-robin with random start, but prefer less-used mixers
      const leastUsedCount = Math.min(...mixerUsageCount)
      const leastUsedMixers = mixerUsageCount
        .map((count, idx) => count === leastUsedCount ? idx : -1)
        .filter(idx => idx !== -1)
      const mixerIndex = leastUsedMixers[Math.floor(Math.random() * leastUsedMixers.length)]
      mixerAssignments.push(mixerIndex)
      mixerUsageCount[mixerIndex]++
    }
    
    for (let batchStart = 0; batchStart < distributionNum; batchStart += parallelBatchSize) {
      const batchEnd = Math.min(batchStart + parallelBatchSize, distributionNum)
      const batch = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i)
      
      console.log(`🔀 Processing batch ${Math.floor(batchStart / parallelBatchSize) + 1}/${Math.ceil(distributionNum / parallelBatchSize)} (wallets ${batchStart + 1}-${batchEnd})...`)

      // Process this batch in parallel
      await Promise.all(batch.map(async (i) => {
        const swapAmount = swapAmounts && swapAmounts[i] !== undefined ? swapAmounts[i] : SWAP_AMOUNT
        const solAmount = Math.floor((swapAmount + 0.01) * 10 ** 9)
        const targetWallet = wallets[i]

        // Use pre-assigned unique mixer for this wallet
        const mixerIndex = mixerAssignments[i]
        const mixer = mixingWallets[mixerIndex]
        const mixerBalance = mixerBalances[mixerIndex]
        const mixerNeedsFunding = mixerBalance < solAmount + 0.01 * 1e9

        try {
          // Step 1: Fund mixing wallet from mainKp (if needed)
          if (mixerNeedsFunding) {
            const fundingAmount = solAmount + 0.02 * 1e9 // Extra buffer for fees and rent
            const blockhash = await connection.getLatestBlockhash()
            
            const fundMixerTx = new TransactionMessage({
              payerKey: mainKp.publicKey,
              recentBlockhash: blockhash.blockhash,
              instructions: [
                ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
                ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
                SystemProgram.transfer({
                  fromPubkey: mainKp.publicKey,
                  toPubkey: mixer.publicKey,
                  lamports: fundingAmount
                })
              ]
            }).compileToV0Message()
            
            const fundMixerV0 = new VersionedTransaction(fundMixerTx)
            fundMixerV0.sign([mainKp])
            const fundMixerSig = await execute(fundMixerV0, blockhash, 1)
            
            if (!fundMixerSig) {
              console.log(`   ⚠️  Wallet ${i + 1}: Failed to fund mixer (tx: ${fundMixerSig || 'no signature'}), using direct funding...`)
              // Fallback: fund directly
              const directBlockhash = await connection.getLatestBlockhash()
              const directTx = new TransactionMessage({
                payerKey: mainKp.publicKey,
                recentBlockhash: directBlockhash.blockhash,
                instructions: [
                  ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
                  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
                  SystemProgram.transfer({
                    fromPubkey: mainKp.publicKey,
                    toPubkey: targetWallet.publicKey,
                    lamports: solAmount
                  })
                ]
              }).compileToV0Message()
              const directV0 = new VersionedTransaction(directTx)
              directV0.sign([mainKp])
              const directSig = await execute(directV0, directBlockhash, 1)
              if (directSig) {
                console.log(`   ✅ Wallet ${i + 1}: Direct funding successful`)
              }
              return
            }
            
            // CRITICAL: Wait for funding to confirm and verify balance before proceeding
            // Poll balance up to 10 times (5 seconds max) to ensure funding is confirmed
            const initialBalance = mixerBalances[mixerIndex]
            let confirmedBalance = initialBalance
            let attempts = 0
            const maxAttempts = 10
            while (attempts < maxAttempts) {
              await sleep(500) // Wait 500ms between checks
              confirmedBalance = await connection.getBalance(mixer.publicKey)
              if (confirmedBalance >= initialBalance + fundingAmount - 1000) { // Allow 1000 lamport tolerance
                break
              }
              attempts++
            }
            
            if (confirmedBalance < initialBalance + fundingAmount - 1000) {
              console.log(`   ⚠️  Wallet ${i + 1}: Mixer funding not confirmed after ${maxAttempts} attempts (expected: ${((initialBalance + fundingAmount) / 1e9).toFixed(6)} SOL, got: ${(confirmedBalance / 1e9).toFixed(6)} SOL), using direct funding...`)
              // Fallback: fund directly
              const directBlockhash = await connection.getLatestBlockhash()
              const directTx = new TransactionMessage({
                payerKey: mainKp.publicKey,
                recentBlockhash: directBlockhash.blockhash,
                instructions: [
                  ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
                  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
                  SystemProgram.transfer({
                    fromPubkey: mainKp.publicKey,
                    toPubkey: targetWallet.publicKey,
                    lamports: solAmount
                  })
                ]
              }).compileToV0Message()
              const directV0 = new VersionedTransaction(directTx)
              directV0.sign([mainKp])
              const directSig = await execute(directV0, directBlockhash, 1)
              if (directSig) {
                console.log(`   ✅ Wallet ${i + 1}: Direct funding successful`)
              }
              return
            }
            
            // Update balance cache with confirmed balance
            mixerBalances[mixerIndex] = confirmedBalance
            console.log(`   ✅ Wallet ${i + 1}: Mixer funded and confirmed (balance: ${(confirmedBalance / 1e9).toFixed(6)} SOL)`)
          }

          // Step 2: Transfer from mixer to target wallet
          // Use confirmed balance from cache (or re-fetch if needed)
          const actualMixerBalance = mixerBalances[mixerIndex] || await connection.getBalance(mixer.publicKey)
          const routeBlockhash = await connection.getLatestBlockhash()
          
          // Calculate amount to transfer: balance minus rent exemption and transaction fees
          // Leave enough for rent exemption (~0.00089 SOL) and fees (~0.0001 SOL)
          const rentExemption = 890_880 // Base account rent exemption
          const estimatedTxFee = 10_000 // Higher estimate for safety
          const safetyBuffer = 5_000 // Extra buffer
          const amountToTransfer = actualMixerBalance - rentExemption - estimatedTxFee - safetyBuffer
          
          // Only transfer if we have enough (at least the target amount)
          if (amountToTransfer >= solAmount) {
            const routeTx = new TransactionMessage({
              payerKey: mixer.publicKey,
              recentBlockhash: routeBlockhash.blockhash,
              instructions: [
                ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
                ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
                SystemProgram.transfer({
                  fromPubkey: mixer.publicKey,
                  toPubkey: targetWallet.publicKey,
                  lamports: amountToTransfer
                })
              ]
            }).compileToV0Message()
            
            const routeV0 = new VersionedTransaction(routeTx)
            routeV0.sign([mixer])
            const routeSig = await execute(routeV0, routeBlockhash, 1)
            
            if (!routeSig) {
              console.log(`   ⚠️  Wallet ${i + 1}: Failed to route through mixer (tx: ${routeSig || 'no signature'}), using direct funding...`)
              // Fallback: fund directly
              const directBlockhash = await connection.getLatestBlockhash()
              const directTx = new TransactionMessage({
                payerKey: mainKp.publicKey,
                recentBlockhash: directBlockhash.blockhash,
                instructions: [
                  ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
                  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
                  SystemProgram.transfer({
                    fromPubkey: mainKp.publicKey,
                    toPubkey: targetWallet.publicKey,
                    lamports: solAmount
                  })
                ]
              }).compileToV0Message()
              const directV0 = new VersionedTransaction(directTx)
              directV0.sign([mainKp])
              const directSig = await execute(directV0, directBlockhash, 1)
              if (directSig) {
                console.log(`   ✅ Wallet ${i + 1}: Direct funding successful`)
              }
            } else {
              // Update balance cache (mixer should now have only rent exemption + buffer left)
              mixerBalances[mixerIndex] = rentExemption + estimatedTxFee + safetyBuffer
              console.log(`   ✅ Wallet ${i + 1}: Transferred ${(amountToTransfer / 1e9).toFixed(6)} SOL from mixer to target wallet`)
            }
          } else {
            // Not enough balance, fund directly
            console.log(`   ⚠️  Wallet ${i + 1}: Mixer balance too low (${(actualMixerBalance / 1e9).toFixed(6)} SOL, need ${(solAmount / 1e9).toFixed(6)} SOL), using direct funding...`)
            const directBlockhash = await connection.getLatestBlockhash()
            const directTx = new TransactionMessage({
              payerKey: mainKp.publicKey,
              recentBlockhash: directBlockhash.blockhash,
              instructions: [
                ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
                ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
                SystemProgram.transfer({
                  fromPubkey: mainKp.publicKey,
                  toPubkey: targetWallet.publicKey,
                  lamports: solAmount
                })
              ]
            }).compileToV0Message()
            const directV0 = new VersionedTransaction(directTx)
            directV0.sign([mainKp])
            const directSig = await execute(directV0, directBlockhash, 1)
            if (directSig) {
              console.log(`   ✅ Wallet ${i + 1}: Direct funding successful`)
            }
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error)
          console.log(`   ⚠️  Wallet ${i + 1}: Error during mixing (${errorMsg}), using direct funding...`)
          // Fallback: fund directly
          try {
            const directBlockhash = await connection.getLatestBlockhash()
            const directTx = new TransactionMessage({
              payerKey: mainKp.publicKey,
              recentBlockhash: directBlockhash.blockhash,
              instructions: [
                ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
                ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
                SystemProgram.transfer({
                  fromPubkey: mainKp.publicKey,
                  toPubkey: targetWallet.publicKey,
                  lamports: solAmount
                })
              ]
            }).compileToV0Message()
            const directV0 = new VersionedTransaction(directTx)
            directV0.sign([mainKp])
            const directSig = await execute(directV0, directBlockhash, 1)
            if (directSig) {
              console.log(`   ✅ Wallet ${i + 1}: Direct funding successful after error`)
            } else {
              console.log(`   ❌ Wallet ${i + 1}: Direct funding also failed`)
            }
          } catch (fallbackError) {
            console.log(`   ❌ Wallet ${i + 1}: Direct funding also failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`)
          }
        }
      }))

      // Small delay between batches for privacy (randomized)
      if (batchEnd < distributionNum) {
        await sleep(randomDelay() * 2)
      }
    }

    // Save target wallets to file
    try {
      saveDataToFile(wallets.map(kp => base58.encode(kp.secretKey)))
    } catch (error) {
      // Ignore save errors
    }

    // Save/update mixing wallets (update lastUsed timestamp)
    if (mixingWallets.length > 0) {
      saveMixingWallets(mixingWallets)
    }

    console.log("✅ Successfully distributed SOL through mixing wallets")
    return wallets
  } catch (error) {
    console.log(`❌ Failed to distribute SOL with mixing:`, error)
    return null
  }
}

// Helper function: Fund an existing wallet through mixer wallets
// Route: mainKp -> mixing wallet -> existing wallet
// This breaks the direct connection trail for existing wallets
export const fundExistingWalletWithMixing = async (
  connection: Connection,
  mainKp: Keypair,
  targetWallet: Keypair,
  amount: number,
  mixingWallets: Keypair[] = []
): Promise<boolean> => {
  try {
    if (mixingWallets.length === 0) {
      console.log(`   ⚠️  No mixing wallets available, using direct funding...`)
      return await fundExistingWalletDirect(connection, mainKp, targetWallet, amount)
    }

    const solAmount = Math.floor(amount * 1e9)
    const randomDelay = () => Math.random() * 500 + 200 // 200-700ms random delay for privacy

    // Select a random mixer
    const mixerIndex = Math.floor(Math.random() * mixingWallets.length)
    const mixer = mixingWallets[mixerIndex]
    const mixerBalance = await connection.getBalance(mixer.publicKey)
    const mixerNeedsFunding = mixerBalance < solAmount + 0.02 * 1e9

    try {
      // Step 1: Fund mixing wallet from mainKp (if needed)
      if (mixerNeedsFunding) {
        const fundingAmount = solAmount + 0.02 * 1e9 // Extra buffer for fees and rent
        const blockhash = await connection.getLatestBlockhash()
        
        const fundMixerTx = new TransactionMessage({
          payerKey: mainKp.publicKey,
          recentBlockhash: blockhash.blockhash,
          instructions: [
            ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
            SystemProgram.transfer({
              fromPubkey: mainKp.publicKey,
              toPubkey: mixer.publicKey,
              lamports: fundingAmount
            })
          ]
        }).compileToV0Message()
        
        const fundMixerV0 = new VersionedTransaction(fundMixerTx)
        fundMixerV0.sign([mainKp])
        const fundMixerSig = await execute(fundMixerV0, blockhash, 1)
        
        if (!fundMixerSig) {
          console.log(`   ⚠️  Failed to fund mixer (tx: ${fundMixerSig || 'no signature'}), using direct funding...`)
          return await fundExistingWalletDirect(connection, mainKp, targetWallet, amount)
        }
        
        // CRITICAL: Wait for funding to confirm and verify balance before proceeding
        const initialBalance = mixerBalance
        let confirmedBalance = initialBalance
        let attempts = 0
        const maxAttempts = 10
        while (attempts < maxAttempts) {
          await sleep(500) // Wait 500ms between checks
          confirmedBalance = await connection.getBalance(mixer.publicKey)
          if (confirmedBalance >= initialBalance + fundingAmount - 1000) { // Allow 1000 lamport tolerance
            break
          }
          attempts++
        }
        
        if (confirmedBalance < initialBalance + fundingAmount - 1000) {
          console.log(`   ⚠️  Mixer funding not confirmed after ${maxAttempts} attempts, using direct funding...`)
          return await fundExistingWalletDirect(connection, mainKp, targetWallet, amount)
        }
        
        console.log(`   ✅ Mixer funded and confirmed (balance: ${(confirmedBalance / 1e9).toFixed(6)} SOL)`)
      }

      // Step 2: Transfer from mixer to target wallet
      const actualMixerBalance = await connection.getBalance(mixer.publicKey)
      const routeBlockhash = await connection.getLatestBlockhash()
      
      // Calculate amount to transfer: balance minus rent exemption and transaction fees
      const rentExemption = 890_880 // Base account rent exemption
      const estimatedTxFee = 10_000 // Higher estimate for safety
      const safetyBuffer = 5_000 // Extra buffer
      const amountToTransfer = actualMixerBalance - rentExemption - estimatedTxFee - safetyBuffer
      
      // Only transfer if we have enough (at least the target amount)
      if (amountToTransfer >= solAmount) {
        const routeTx = new TransactionMessage({
          payerKey: mixer.publicKey,
          recentBlockhash: routeBlockhash.blockhash,
          instructions: [
            ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
            SystemProgram.transfer({
              fromPubkey: mixer.publicKey,
              toPubkey: targetWallet.publicKey,
              lamports: amountToTransfer
            })
          ]
        }).compileToV0Message()
        
        const routeV0 = new VersionedTransaction(routeTx)
        routeV0.sign([mixer])
        const routeSig = await execute(routeV0, routeBlockhash, 1)
        
        if (!routeSig) {
          console.log(`   ⚠️  Failed to route through mixer, using direct funding...`)
          return await fundExistingWalletDirect(connection, mainKp, targetWallet, amount)
        } else {
          console.log(`   ✅ Transferred ${(amountToTransfer / 1e9).toFixed(6)} SOL from mixer to ${targetWallet.publicKey.toBase58().slice(0, 8)}...`)
          return true
        }
      } else {
        // Not enough balance, fund directly
        console.log(`   ⚠️  Mixer balance too low, using direct funding...`)
        return await fundExistingWalletDirect(connection, mainKp, targetWallet, amount)
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.log(`   ⚠️  Error during mixing (${errorMsg}), using direct funding...`)
      return await fundExistingWalletDirect(connection, mainKp, targetWallet, amount)
    }
  } catch (error) {
    console.log(`❌ Failed to fund existing wallet with mixing:`, error)
    return await fundExistingWalletDirect(connection, mainKp, targetWallet, amount)
  }
}

// Helper function: Fund an existing wallet directly (fallback)
const fundExistingWalletDirect = async (
  connection: Connection,
  mainKp: Keypair,
  targetWallet: Keypair,
  amount: number
): Promise<boolean> => {
  try {
    const latestBlockhash = await connection.getLatestBlockhash()
    const fundingLamports = Math.ceil(amount * 1e9)
    const transferMsg = new TransactionMessage({
      payerKey: mainKp.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
        SystemProgram.transfer({
          fromPubkey: mainKp.publicKey,
          toPubkey: targetWallet.publicKey,
          lamports: fundingLamports
        })
      ]
    }).compileToV0Message()

    const transferTx = new VersionedTransaction(transferMsg)
    transferTx.sign([mainKp])

    const sig = await execute(transferTx, latestBlockhash, 1)
    if (!sig) {
      console.error(`   ❌ Failed to fund wallet directly`)
      return false
    }

    const newBalance = await connection.getBalance(targetWallet.publicKey)
    console.log(`   ✅ Funded wallet! New balance: ${(newBalance / 1e9).toFixed(4)} SOL`)
    console.log(`   Transaction: https://solscan.io/tx/${sig}`)
    return true
  } catch (error: any) {
    console.error(`   ❌ Failed to fund wallet directly: ${error.message}`)
    return false
  }
}

// Load intermediary wallets from file (organized by hop number)
export const loadIntermediaryWallets = (): { [hopNumber: number]: Keypair[] } => {
  try {
    const intermediaryPath = path.join(process.cwd(), 'keys', 'intermediary-wallets.json')
    if (fs.existsSync(intermediaryPath)) {
      const data = JSON.parse(fs.readFileSync(intermediaryPath, 'utf8'))
      const walletsByHop: { [hopNumber: number]: Keypair[] } = {}
      
      // Parse wallets organized by hop number
      for (const hopStr in data) {
        if (hopStr !== 'createdAt' && hopStr !== 'lastUsed' && hopStr.startsWith('hop')) {
          const hopNumber = parseInt(hopStr.replace('hop', ''))
          if (!isNaN(hopNumber) && Array.isArray(data[hopStr])) {
            walletsByHop[hopNumber] = []
            for (const walletData of data[hopStr]) {
              if (walletData?.privateKey) {
                try {
                  walletsByHop[hopNumber].push(Keypair.fromSecretKey(base58.decode(walletData.privateKey)))
                } catch (e) {
                  // Skip invalid keys
                }
              }
            }
          }
        }
      }
      return walletsByHop
    }
  } catch (e) {
    // If file doesn't exist or is invalid, return empty object
  }
  return {}
}

// Save intermediary wallets to file (organized by hop number)
const saveIntermediaryWallets = (walletsByHop: { [hopNumber: number]: Keypair[] }) => {
  try {
    const intermediaryPath = path.join(process.cwd(), 'keys', 'intermediary-wallets.json')
    const keysDir = path.dirname(intermediaryPath)
    
    // Create keys directory if it doesn't exist
    if (!fs.existsSync(keysDir)) {
      fs.mkdirSync(keysDir, { recursive: true })
    }
    
    let existingData: any = {}
    if (fs.existsSync(intermediaryPath)) {
      try {
        existingData = JSON.parse(fs.readFileSync(intermediaryPath, 'utf8'))
      } catch (e) {
        existingData = {}
      }
    }
    
    // Update or add wallets for each hop
    for (const hopNumber in walletsByHop) {
      const hopKey = `hop${hopNumber}`
      const wallets = walletsByHop[parseInt(hopNumber)]
      
      // Get existing wallets for this hop (preserve them)
      const existingWallets = existingData[hopKey] || []
      const existingPublicKeys = new Set(existingWallets.map((w: any) => w.publicKey))
      
      // Add new wallets that don't already exist
      const allWallets = [...existingWallets]
      wallets.forEach((wallet) => {
        const publicKey = wallet.publicKey.toBase58()
        const privateKey = base58.encode(wallet.secretKey)
        
        if (!existingPublicKeys.has(publicKey)) {
          allWallets.push({ publicKey, privateKey })
          existingPublicKeys.add(publicKey)
        }
      })
      
      existingData[hopKey] = allWallets
    }
    
    // Update metadata
    if (!existingData.createdAt) {
      existingData.createdAt = new Date().toISOString()
    }
    existingData.lastUsed = new Date().toISOString()
    
    // Save to file
    fs.writeFileSync(intermediaryPath, JSON.stringify(existingData, null, 2))
    const totalWallets = Object.keys(existingData)
      .filter(k => k.startsWith('hop'))
      .reduce((sum, k) => sum + (Array.isArray(existingData[k]) ? existingData[k].length : 0), 0)
    console.log(`💾 Saved ${totalWallets} intermediary wallet(s) to ${intermediaryPath}`)
  } catch (error) {
    console.log(`⚠️  Failed to save intermediary wallets:`, error)
  }
}

// Generate variable gas fee (randomized for privacy)
const getVariableGasFee = (): number => {
  const baseFee = 1_000 // microLamports
  const variation = Math.random() * 0.5 + 0.75 // 0.75-1.25 multiplier (750-1,250 microLamports)
  return Math.floor(baseFee * variation)
}

// New function: Fund wallet through multiple intermediaries
// Route: Funding → Inter1 → Inter2 → Final Wallet
// Saves ALL intermediary wallets and uses variable gas fees
// IMPORTANT: Creates UNIQUE intermediaries for EACH wallet (better privacy - each wallet appears from different source)
export const fundExistingWalletWithMultipleIntermediaries = async (
  connection: Connection,
  mainKp: Keypair,
  targetWallet: Keypair,
  amount: number,
  numIntermediaries: number = 2
): Promise<boolean> => {
  // Declare walletsByHop outside try block so it's accessible in catch block
  let walletsByHop: { [hopNumber: number]: Keypair[] } | undefined = undefined
  
  try {
    const solAmount = Math.floor(amount * 1e9)
    const randomDelay = () => Math.random() * 500 + 200 // 200-700ms random delay
    
    // CRITICAL: Create FRESH intermediaries for EACH wallet transfer
    // This ensures each wallet (DEV, bundle, holder) gets its own unique chain
    // Better privacy: each wallet appears to come from a different source
    console.log(`🔀 Creating ${numIntermediaries} unique intermediary wallet(s) for this transfer...`)
    walletsByHop = {}
    for (let hop = 1; hop <= numIntermediaries; hop++) {
      walletsByHop[hop] = [Keypair.generate()]
    }
    
    // CRITICAL: Save intermediaries IMMEDIATELY after creation
    // This ensures funds are recoverable even if transfer fails mid-chain
    saveIntermediaryWallets(walletsByHop)
    console.log(`💾 Intermediary wallets saved - funds are recoverable if transfer fails`)
    
    // Build the chain: Funding → Inter1 → Inter2 → ... → Final
    const chain: Keypair[] = [mainKp]
    for (let hop = 1; hop <= numIntermediaries; hop++) {
      if (!walletsByHop[hop] || walletsByHop[hop].length === 0) {
        throw new Error(`No intermediary wallet found for hop ${hop}`)
      }
      chain.push(walletsByHop[hop][0]) // Use first wallet for each hop
    }
    chain.push(targetWallet)
    
    console.log(`🔀 Routing through ${numIntermediaries} unique intermediary wallet(s)...`)
    console.log(`   Route: ${mainKp.publicKey.toBase58().slice(0, 8)}... → Inter1 → Inter2 → ${targetWallet.publicKey.toBase58().slice(0, 8)}...`)
    
    // Transfer through each hop
    let currentAmount = solAmount
    const rentExemption = 890_880 // Base account rent exemption
    const estimatedTxFee = 10_000 // Estimated transaction fee
    const safetyBuffer = 5_000 // Extra buffer
    
    for (let i = 0; i < chain.length - 1; i++) {
      const fromWallet = chain[i]
      const toWallet = chain[i + 1]
      const isLastHop = i === chain.length - 2
      
      // Calculate amount needed for this transfer
      // CRITICAL: Only send what's needed, NOT 100% of balance!
      let transferAmount: number
      if (isLastHop) {
        // Final hop: send exact target amount
        transferAmount = solAmount
      } else if (fromWallet === mainKp) {
        // FIRST hop from main wallet: send ONLY target amount + fees for all remaining hops
        // Calculate total fees needed: fees for each remaining hop + final transfer
        const feesPerHop = rentExemption + estimatedTxFee + safetyBuffer
        const remainingHops = numIntermediaries - i // How many hops left after this one
        transferAmount = solAmount + (feesPerHop * (remainingHops + 1)) // +1 for final transfer
      } else {
        // Intermediate hops: send what they need to forward (target + fees for remaining hops)
        const feesPerHop = rentExemption + estimatedTxFee + safetyBuffer
        const remainingHops = numIntermediaries - i
        transferAmount = solAmount + (feesPerHop * remainingHops)
      }
      
      // Check balance of source wallet
      const sourceBalance = await connection.getBalance(fromWallet.publicKey)
      
      // If source is main wallet, fund it if needed
      if (fromWallet === mainKp && sourceBalance < transferAmount + 0.02 * 1e9) {
        throw new Error(`Insufficient balance in funding wallet. Need ${((transferAmount + 0.02 * 1e9) / 1e9).toFixed(4)} SOL, have ${(sourceBalance / 1e9).toFixed(4)} SOL`)
      }
      
      // If source is intermediary, fund it first if needed
      if (fromWallet !== mainKp && sourceBalance < transferAmount + rentExemption + estimatedTxFee + safetyBuffer) {
        // Need to fund this intermediary from previous wallet
        const fundingNeeded = transferAmount + rentExemption + estimatedTxFee + safetyBuffer - sourceBalance
        const previousWallet = chain[i - 1]
        
        console.log(`   💰 Funding intermediary ${i}/${numIntermediaries} with ${(fundingNeeded / 1e9).toFixed(6)} SOL...`)
        
        const fundBlockhash = await connection.getLatestBlockhash()
        const variableGasFee = getVariableGasFee()
        
        const fundTx = new TransactionMessage({
          payerKey: previousWallet.publicKey,
          recentBlockhash: fundBlockhash.blockhash,
          instructions: [
            ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: variableGasFee }),
            SystemProgram.transfer({
              fromPubkey: previousWallet.publicKey,
              toPubkey: fromWallet.publicKey,
              lamports: fundingNeeded
            })
          ]
        }).compileToV0Message()
        
        const fundV0 = new VersionedTransaction(fundTx)
        fundV0.sign([previousWallet])
        const fundSig = await execute(fundV0, fundBlockhash, 1)
        
        if (!fundSig) {
          throw new Error(`Failed to fund intermediary ${i}`)
        }
        
        // Wait for funding to confirm
        let confirmedBalance = sourceBalance
        let attempts = 0
        while (attempts < 10) {
          await sleep(500)
          confirmedBalance = await connection.getBalance(fromWallet.publicKey)
          if (confirmedBalance >= sourceBalance + fundingNeeded - 1000) {
            break
          }
          attempts++
        }
        
        if (confirmedBalance < sourceBalance + fundingNeeded - 1000) {
          throw new Error(`Intermediary ${i} funding not confirmed`)
        }
        
        console.log(`   ✅ Intermediary ${i} funded and confirmed`)
        // Reduced delay - no need to wait long after funding
        await sleep(100) // Minimal delay: 100ms
      }
      
      // Now perform the transfer
      const actualBalance = await connection.getBalance(fromWallet.publicKey)
      const variableGasFee = getVariableGasFee()
      
      // CRITICAL: Intermediary wallets send ALL SOL except minimal rent exemption
      // This ensures we don't lose any SOL - only keep ~0.00089 SOL for rent
      let amountToTransfer: number
      if (isLastHop) {
        // Last hop: send exact target amount
        amountToTransfer = solAmount
      } else if (fromWallet === mainKp) {
        // First hop from main wallet: send calculated amount (target + fees for remaining hops)
        amountToTransfer = transferAmount
      } else {
        // Intermediate hops: send ALL balance except rent + transaction fees
        // CRITICAL: Must keep rent exemption + transaction fee + safety buffer
        // Transaction fee is deducted from sender, so we need to reserve it
        const reservedAmount = rentExemption + estimatedTxFee + safetyBuffer
        amountToTransfer = actualBalance - reservedAmount
        
        // Safety check: ensure we're sending at least what's needed
        if (amountToTransfer < transferAmount) {
          throw new Error(`Insufficient balance in intermediary ${i}. Need ${(transferAmount / 1e9).toFixed(6)} SOL, have ${(actualBalance / 1e9).toFixed(6)} SOL`)
        }
      }
      
      // Verify we have enough balance
      const requiredAmount = isLastHop ? solAmount : transferAmount
      if (amountToTransfer < requiredAmount) {
        throw new Error(`Insufficient balance in ${fromWallet === mainKp ? 'main wallet' : `intermediary ${i}`}. Need ${(requiredAmount / 1e9).toFixed(6)} SOL, have ${(actualBalance / 1e9).toFixed(6)} SOL`)
      }
      
      // Log transfer details
      if (fromWallet !== mainKp && !isLastHop) {
        // Intermediate hops: show detailed breakdown
        const reservedAmount = rentExemption + estimatedTxFee + safetyBuffer
        console.log(`   🔀 Transferring ${(amountToTransfer / 1e9).toFixed(6)} SOL through hop ${i + 1}/${numIntermediaries + 1}`)
        console.log(`      💰 Balance: ${(actualBalance / 1e9).toFixed(6)} SOL → Sending: ${(amountToTransfer / 1e9).toFixed(6)} SOL (keeping ${(reservedAmount / 1e9).toFixed(6)} SOL for rent+fees)` + ` (gas: ${variableGasFee} microLamports)`)
      } else {
        // First hop or last hop: simple message
        console.log(`   🔀 Transferring ${(amountToTransfer / 1e9).toFixed(6)} SOL through hop ${i + 1}/${numIntermediaries + 1} (gas: ${variableGasFee} microLamports)...`)
      }
      
      const transferBlockhash = await connection.getLatestBlockhash()
      const transferTx = new TransactionMessage({
        payerKey: fromWallet.publicKey,
        recentBlockhash: transferBlockhash.blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: variableGasFee }),
          SystemProgram.transfer({
            fromPubkey: fromWallet.publicKey,
            toPubkey: toWallet.publicKey,
            lamports: amountToTransfer
          })
        ]
      }).compileToV0Message()
      
      const transferV0 = new VersionedTransaction(transferTx)
      transferV0.sign([fromWallet])
      const transferSig = await execute(transferV0, transferBlockhash, 1)
      
      if (!transferSig) {
        throw new Error(`Failed to transfer through hop ${i + 1}`)
      }
      
      console.log(`   ✅ Hop ${i + 1} complete: ${fromWallet.publicKey.toBase58().slice(0, 8)}... → ${toWallet.publicKey.toBase58().slice(0, 8)}...`)
      console.log(`      Transaction: https://solscan.io/tx/${transferSig}`)
      
      // CRITICAL: Update currentAmount to what the NEXT wallet actually received
      // For intermediate hops, the next wallet receives amountToTransfer minus transaction fees
      // We must check actual balance to track the real amount received
      // Reduced wait time - check balance faster (was 500ms, now 300ms)
      await sleep(300) // Wait for transaction to confirm
      const nextWalletBalance = await connection.getBalance(toWallet.publicKey)
      
      if (isLastHop) {
        // Last hop: should have received solAmount (or very close due to fees)
        currentAmount = nextWalletBalance
        console.log(`   📊 Final wallet received: ${(currentAmount / 1e9).toFixed(6)} SOL`)
      } else {
        // Intermediate hop: next wallet receives amountToTransfer minus transaction fees
        currentAmount = nextWalletBalance // Use actual received amount for next hop calculation
        console.log(`   📊 Inter${i + 1} received: ${(currentAmount / 1e9).toFixed(6)} SOL (will forward to next hop)`)
      }
      
      // Reduced delay between hops - minimal delay for speed (was randomDelay, now 100ms)
      await sleep(100) // Minimal delay: 100ms between hops
    }
    
    // CRITICAL: Verify final balance - ensure funds actually arrived
    const finalBalance = await connection.getBalance(targetWallet.publicKey)
    const balanceDifference = finalBalance - solAmount
    if (finalBalance < solAmount - 1000) { // Allow 1000 lamport tolerance
      console.error(`   ❌ CRITICAL: Final balance (${(finalBalance / 1e9).toFixed(6)} SOL) is less than expected (${(solAmount / 1e9).toFixed(6)} SOL)`)
      console.error(`   ⚠️  Missing: ${(Math.abs(balanceDifference) / 1e9).toFixed(6)} SOL`)
      console.error(`   💡 Check intermediaries in keys/intermediary-wallets.json for stuck funds`)
      throw new Error(`Final wallet balance insufficient: expected ${(solAmount / 1e9).toFixed(6)} SOL, got ${(finalBalance / 1e9).toFixed(6)} SOL`)
    } else {
      console.log(`   ✅ Final wallet funded! Balance: ${(finalBalance / 1e9).toFixed(6)} SOL`)
      if (balanceDifference > 1000) {
        console.log(`   ℹ️  Received ${(balanceDifference / 1e9).toFixed(6)} SOL more than expected (due to 100% routing)`)
      }
    }
    
    // CRITICAL: Save intermediaries again at end (in case of any updates)
    // This ensures we have the latest state even if something went wrong
    saveIntermediaryWallets(walletsByHop)
    console.log(`💾 All intermediary wallets saved successfully`)
    
    return true
  } catch (error: any) {
    console.error(`❌ Failed to fund wallet through intermediaries:`, error.message || error)
    console.error(`💡 IMPORTANT: Intermediary wallets have been saved to keys/intermediary-wallets.json`)
    console.error(`💡 You can recover any stuck funds using the saved private keys`)
    
    // CRITICAL: Save intermediaries even on error so funds are recoverable
    try {
      if (typeof walletsByHop !== 'undefined' && walletsByHop !== null) {
        saveIntermediaryWallets(walletsByHop)
        console.log(`💾 Saved intermediary wallets for fund recovery`)
      }
    } catch (saveError) {
      console.error(`⚠️  Failed to save intermediaries on error:`, saveError)
    }
    
    return false
  }
}

export const createLUT = async (mainKp: Keypair) => {
  // Check SOL balance first - LUT creation needs ~0.001-0.002 SOL (rent for account)
  const balance = await connection.getBalance(mainKp.publicKey)
  const minBalance = 0.002 * 1e9 // 0.002 SOL minimum (safe estimate for rent + fees)
  if (balance < minBalance) {
    console.log(`❌ Insufficient SOL balance for LUT creation: ${(balance / 1e9).toFixed(4)} SOL`)
    console.log(`   Required: ${(minBalance / 1e9).toFixed(4)} SOL minimum`)
    console.log("   Please fund your main wallet and try again")
    return null
  }
  
  let i = 0
  while (true) {
    if (i > 5) {
      console.log("❌ LUT creation failed after 5 retries, Exiting...")
      console.log("   Possible causes:")
      console.log("   1. Network congestion - try again later")
      console.log("   2. RPC rate limiting - wait a few minutes")
      console.log("   3. Insufficient SOL for fees")
      console.log("   4. Transaction confirmation timeout")
      return null
    }
    // Get fresh slot right before creating LUT instruction to avoid stale slot errors
    // Use "finalized" commitment for more reliable slot (less likely to be stale)
    const slot = await connection.getSlot("finalized")
    
    try {
      const [lookupTableInst, lookupTableAddress] =
        AddressLookupTableProgram.createLookupTable({
          authority: mainKp.publicKey,
          payer: mainKp.publicKey,
          recentSlot: slot,
        });

      // Step 2 - Log Lookup Table Address
      console.log("Lookup Table Address:", lookupTableAddress.toBase58());

      // Step 3 - Generate a create transaction and send it to the network
      const result = await createAndSendV0Tx([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500_000 }),
        lookupTableInst
      ], mainKp, connection);

      if (!result) {
        const errorMsg = "Transaction sent but confirmation failed or returned false"
        console.log(`❌ ${errorMsg}`)
        throw new Error(errorMsg)
      }

      console.log("Lookup Table Address created successfully!")
      console.log("Please wait for about 15 seconds...")
      await sleep(15000)

      return lookupTableAddress
    } catch (err: any) {
      const errorMsg = err?.message || String(err)
      console.log(`❌ LUT creation attempt ${i + 1}/5 failed: ${errorMsg}`)
      console.log("Retrying to create Lookuptable until it is created...")
      i++
      await sleep(2000) // Wait 2 seconds before retry to avoid rate limiting
    }
  }
}

export async function addAddressesToTableMultiExtend(
  lutAddress: PublicKey,
  mint: PublicKey,
  walletKPs: Keypair[],
  mainKp: Keypair
) {
  const walletPKs = walletKPs.map(w => w.publicKey);

  async function extendWithRetry(addresses: PublicKey[], stepName: string, maxRetries = 5) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const instruction = AddressLookupTableProgram.extendLookupTable({
        payer: mainKp.publicKey,
        authority: mainKp.publicKey,
        lookupTable: lutAddress,
        addresses,
      });

      const result = await createAndSendV0Tx([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500_000 }),
        instruction
      ], mainKp, connection);

      if (result) {
        console.log(`✅ ${stepName} successful.`);
        return true;
      } else {
        console.log(`⚠️ Retry ${attempt}/${maxRetries} for ${stepName}`);
      }
    }

    console.log(`❌ ${stepName} failed after ${maxRetries} attempts.`);
    return false;
  }

  try {
    // Step 1: Add wallet addresses
    if (!(await extendWithRetry(walletPKs, "Adding wallet addresses"))) return;
    await sleep(10_000);

    // Step 2: Add wallets' ATAs and global accumulators
    const baseAtas = walletKPs.map(w => PublicKey.findProgramAddressSync([w.publicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0]);
    const step2Addresses = [...baseAtas];

    if (!(await extendWithRetry(step2Addresses, `Adding base ATA & volume addresses for token ${mint.toBase58()}`))) return;
    await sleep(10_000);

    // Step 3: Add global volume accumulators
    const globalVolumeAccumulators = walletKPs.map(w => sdk.getUserVolumeAccumulator(w.publicKey));
    const step3Addresses = [...globalVolumeAccumulators];

    if (!(await extendWithRetry(step3Addresses, `Adding global volume accumulators for token ${mint.toBase58()}`))) return;
    await sleep(10_000);


    // Step 4: Add main wallet and static addresses
    const creatorVault = sdk.getCreatorVaultPda(sdk.program.programId, mainKp.publicKey);
    const GLOBAL_VOLUME_ACCUMULATOR = new PublicKey("Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y");
    const global = new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");
    const eventAuthority = new PublicKey("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1");
    const feeConfig = new PublicKey("8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt");
    const feeProgram = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
    const bondingCurve = await sdk.getBondingCurvePDA(mint);
    const associatedBondingCurve = PublicKey.findProgramAddressSync([bondingCurve.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
    const feeRecipient = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM");

    const staticAddresses = [
      mainKp.publicKey,
      mint,
      PUMP_PROGRAM,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
      SystemProgram.programId,
      SYSVAR_RENT_PUBKEY,
      NATIVE_MINT,
      ComputeBudgetProgram.programId,
      creatorVault,
      GLOBAL_VOLUME_ACCUMULATOR,
      feeConfig,
      feeProgram,
      bondingCurve,
      associatedBondingCurve,
      feeRecipient,
      eventAuthority,
      global,
    ];

    if (!(await extendWithRetry(staticAddresses, "Adding main wallet & static addresses"))) return;

    await sleep(10_000);
    console.log("🎉 Lookup Table successfully extended!");
    console.log(`🔗 LUT Entries: https://explorer.solana.com/address/${lutAddress.toString()}/entries`);
    return true;
  } catch (err) {
    console.error("Error extending LUT:", err);
    return false;
  }
}



export async function addAddressesToTable(lutAddress: PublicKey, mint: PublicKey, walletKPs: Keypair[], mainKp: Keypair) {
  const walletPKs: PublicKey[] = walletKPs.map(wallet => wallet.publicKey);
  try {
    let i = 0
    while (true) {
      if (i > 5) {
        console.log("Extending LUT failed, Exiting...")
        return
      }
      // Step 1 - Adding bundler wallets
      const addAddressesInstruction = AddressLookupTableProgram.extendLookupTable({
        payer: mainKp.publicKey,
        authority: mainKp.publicKey,
        lookupTable: lutAddress,
        addresses: walletPKs,
      });
      const result = await createAndSendV0Tx([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500_000 }),
        addAddressesInstruction
      ], mainKp, connection);
      if (result) {
        console.log("Successfully added wallet addresses.")
        i = 0
        break
      } else {
        console.log("Trying again with step 1")
      }
    }
    await sleep(10000)

    // Step 2 - Adding wallets' token ata
    while (true) {
      if (i > 5) {
        console.log("Extending LUT failed, Exiting...")
        return
      }

      console.log(`Adding atas for the token ${mint.toBase58()}`)
      const baseAtas: PublicKey[] = []
      const globalVolumeAccumulators: PublicKey[] = []

      for (const wallet of walletKPs) {
        const baseAta = getAssociatedTokenAddressSync(mint, wallet.publicKey)
        baseAtas.push(baseAta);
        const globalVolumeAccumulator = sdk.getUserVolumeAccumulator(wallet.publicKey)
        globalVolumeAccumulators.push(globalVolumeAccumulator);
      }
      console.log("Base atas address num to extend: ", baseAtas.length)
      const addAddressesInstruction1 = AddressLookupTableProgram.extendLookupTable({
        payer: mainKp.publicKey,
        authority: mainKp.publicKey,
        lookupTable: lutAddress,
        addresses: baseAtas.concat(globalVolumeAccumulators),
      });
      const result = await createAndSendV0Tx([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500_000 }),
        addAddressesInstruction1
      ], mainKp, connection);

      if (result) {
        console.log("Successfully added base ata addresses.")
        i = 0
        break
      } else {
        console.log("Trying again with step 2")
      }
    }
    await sleep(10000)



    // Step 3 - Adding main wallet and static keys
    while (true) {
      if (i > 5) {
        console.log("Extending LUT failed, Exiting...")
        return
      }
      const creatorVault = sdk.getCreatorVaultPda(sdk.program.programId, mainKp.publicKey)

      const GLOBAL_VOLUME_ACCUMULATOR = new PublicKey(
        "Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y"
      );

      const global = new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf")
      const eventAuthority = new PublicKey("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1")
      const feeConfig = new PublicKey("8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt");
      const feeProgram = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
      const bondingCurve = await sdk.getBondingCurvePDA(mint)
      const associatedBondingCurve = getAssociatedTokenAddressSync(mint, bondingCurve)
      const feeRecipient = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM")

      const addAddressesInstruction3 = AddressLookupTableProgram.extendLookupTable({
        payer: mainKp.publicKey,
        authority: mainKp.publicKey,
        lookupTable: lutAddress,
        addresses: [mainKp.publicKey, mint, PUMP_PROGRAM, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, SystemProgram.programId, SYSVAR_RENT_PUBKEY, NATIVE_MINT, ComputeBudgetProgram.programId, creatorVault, GLOBAL_VOLUME_ACCUMULATOR, feeConfig, feeProgram, bondingCurve, associatedBondingCurve, feeRecipient, eventAuthority, global],
      });

      const result = await createAndSendV0Tx([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500_000 }),
        addAddressesInstruction3
      ], mainKp, connection);

      if (result) {
        console.log("Successfully added main wallet address.")
        i = 0
        break
      } else {
        console.log("Trying again with step 4")
      }
    }
    await sleep(10000)
    console.log("Lookup Table Address extended successfully!")
    console.log(`Lookup Table Entries: `, `https://explorer.solana.com/address/${lutAddress.toString()}/entries`)
  }
  catch (err) {
    console.log("There is an error in adding addresses in LUT. Please retry it.")
    return;
  }
}

export const makeBuyIx = async (kp: Keypair, buyAmount: number, index: number, creator: PublicKey, mintAddress: PublicKey) => {
  let buyIx = await sdk.getBuyInstructionsBySolAmount(
    kp.publicKey,
    mintAddress,
    BigInt(buyAmount),
    index,
    false,
    creator
  );

  return buyIx as TransactionInstruction[]
}
