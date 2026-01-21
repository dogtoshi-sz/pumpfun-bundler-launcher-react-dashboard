import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, TransactionInstruction, SystemProgram, AddressLookupTableAccount } from "@solana/web3.js"
import base58 from "bs58"
import { makeBuyIx } from "../src/main"
import { getSellTxWithJupiter, getBuyTxWithJupiter } from "../utils/swapOnlyAmm"
import fs from "fs"
import path from "path"
import { PumpFunSDK } from "@solana-ipfs/sdk"
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet"
import { AnchorProvider } from "@coral-xyz/anchor"

// Get RPC endpoint from env (don't import from constants to avoid PRIVATE_KEY requirement)
const getRpcEndpoint = () => process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com'
const getRpcWebSocketEndpoint = () => process.env.RPC_WEBSOCKET_ENDPOINT || 'wss://api.mainnet-beta.solana.com'

// Helius tip wallets (required for Helius Sender - minimum 200,000 lamports)
// https://www.helius.dev/docs/sending-transactions/sender
const HELIUS_TIP_WALLETS = [
  "5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn",
  "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
  "9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta",
  "wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF",
  "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ",
  "2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD",
  "3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT",
  "4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey",
  "4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or",
  "2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ",
  "D1Mc6j9xQWgR1o1Z7yU5nVVXFQiAYx7FG9AW1aVfwrUM"
]
const HELIUS_MIN_TIP = 200_000 // Minimum tip required: 200,000 lamports (0.0002 SOL)

// Add Helius tip to transaction (required for Helius Sender)
const addHeliusTip = async (transaction: VersionedTransaction, wallet: Keypair): Promise<VersionedTransaction> => {
  try {
    const connection = getConnection()
    
    // Get Address Lookup Tables from the transaction
    const altAccounts: AddressLookupTableAccount[] = []
    for (const lookup of transaction.message.addressTableLookups) {
      try {
        const alt = await connection.getAddressLookupTable(lookup.accountKey)
        if (alt.value) {
          altAccounts.push(alt.value)
        }
      } catch (e) {
        // Skip if ALT fetch fails
      }
    }
    
    // Decompile the transaction message
    const decompiledMessage = TransactionMessage.decompile(transaction.message, {
      addressLookupTableAccounts: altAccounts,
    })
    
    // Add Helius tip instruction (required minimum: 200,000 lamports)
    const tipAccount = new PublicKey(HELIUS_TIP_WALLETS[Math.floor(Math.random() * HELIUS_TIP_WALLETS.length)])
    const tipIx = SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: tipAccount,
      lamports: HELIUS_MIN_TIP, // Use minimum required tip
    })
    decompiledMessage.instructions.push(tipIx)
    
    // Recompile and sign
    const newTx = new VersionedTransaction(decompiledMessage.compileToV0Message(altAccounts))
    newTx.sign([wallet])
    
    return newTx
  } catch (error: any) {
    console.warn(`[Helius Tip] Failed to add tip, using original tx: ${error.message}`)
    return transaction
  }
}

// Helius Sender endpoint for ultra-low latency transaction submission
// Sends to BOTH validators AND Jito simultaneously for maximum inclusion speed
// Note: Helius Sender requires minimum 200,000 lamports tip to one of their tip wallets
const getHeliusSenderEndpoint = () => {
  const apiKey = process.env.HELIUS_API_KEY || process.env.RPC_ENDPOINT?.match(/api-key=([^&]+)/)?.[1]
  if (apiKey) {
    return `https://sender.helius-rpc.com/fast?api-key=${apiKey}`
  }
  return 'https://sender.helius-rpc.com/fast'
}

const getConnection = () => new Connection(getRpcEndpoint(), {
  wsEndpoint: getRpcWebSocketEndpoint(),
  commitment: "confirmed"
})

// Send transaction via Helius Sender for ultra-low latency
// https://www.helius.dev/docs/sending-transactions/sender
const sendViaHeliusSender = async (transaction: VersionedTransaction): Promise<string> => {
  try {
    const serialized = transaction.serialize()
    const base64Tx = Buffer.from(serialized).toString('base64')
    
    const endpoint = getHeliusSenderEndpoint()
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now().toString(),
        method: 'sendTransaction',
        params: [
          base64Tx,
          {
            encoding: 'base64',
            skipPreflight: true, // Required for Sender
            maxRetries: 0
          }
        ]
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[Helius Sender] HTTP error ${response.status}: ${errorText}`)
      throw new Error(`Helius Sender HTTP error: ${response.status} - ${errorText}`)
    }

    const json = await response.json()
    
    if (json.error) {
      console.error(`[Helius Sender] API error:`, json.error)
      throw new Error(`Helius Sender error: ${json.error.message || JSON.stringify(json.error)}`)
    }

    if (!json.result) {
      console.error(`[Helius Sender] No result in response:`, JSON.stringify(json))
      throw new Error(`Helius Sender returned no result. Response: ${JSON.stringify(json)}`)
    }

    return json.result
  } catch (error: any) {
    console.error(`[Helius Sender] Exception:`, error.message || error)
    throw error
  }
}

// Fast confirmation helper - waits for "confirmed" status (usually ~400ms) for faster GMGN indexing
const waitForConfirmation = async (connection: Connection, signature: string, timeout: number = 3000): Promise<boolean> => {
  const startTime = Date.now()
  const checkInterval = 100 // Check every 100ms
  
  while (Date.now() - startTime < timeout) {
    try {
      const status = await connection.getSignatureStatus(signature)
      
      if (status.value) {
        if (status.value.err) {
          // Transaction failed
          return false
        }
        // Check if confirmed (included in a block)
        if (status.value.confirmationStatus === 'confirmed' || status.value.confirmationStatus === 'finalized') {
          return true
        }
      }
      
      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, checkInterval))
    } catch (error) {
      // Continue checking
      await new Promise(resolve => setTimeout(resolve, checkInterval))
    }
  }
  
  // Timeout - transaction might still be processing
  return false
}

// mainKp removed - buyTokenSimple now uses wallet's own public key as referrer
// This avoids requiring PRIVATE_KEY to be loaded when called from API server

// File to store additional trading wallets
const TRADING_WALLETS_FILE = path.join(process.cwd(), 'keys', 'trading-wallets.json')

// Load trading wallets from file
export const loadTradingWallets = (): string[] => {
  try {
    if (fs.existsSync(TRADING_WALLETS_FILE)) {
      const data = JSON.parse(fs.readFileSync(TRADING_WALLETS_FILE, 'utf8'))
      return data.wallets || []
    }
  } catch (error) {
    console.error('Error loading trading wallets:', error)
  }
  return []
}

// Save trading wallets to file
export const saveTradingWallets = (wallets: string[]): void => {
  try {
    const dir = path.dirname(TRADING_WALLETS_FILE)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(TRADING_WALLETS_FILE, JSON.stringify({ wallets }, null, 2))
  } catch (error) {
    console.error('Error saving trading wallets:', error)
    throw error
  }
}

// Add a new trading wallet
export const addTradingWallet = (privateKey: string): { address: string } => {
  try {
    const kp = Keypair.fromSecretKey(base58.decode(privateKey))
    const wallets = loadTradingWallets()
    
    // Check if wallet already exists
    const address = kp.publicKey.toBase58()
    if (wallets.includes(privateKey)) {
      return { address }
    }
    
    wallets.push(privateKey)
    saveTradingWallets(wallets)
    return { address }
  } catch (error) {
    throw new Error(`Invalid private key: ${error.message}`)
  }
}

// Remove a trading wallet
export const removeTradingWallet = (privateKey: string): void => {
  const wallets = loadTradingWallets()
  const filtered = wallets.filter(w => w !== privateKey)
  saveTradingWallets(filtered)
}

// Get all trading wallets with balances
export const getTradingWallets = async (): Promise<Array<{ address: string; balance: number; privateKey: string }>> => {
  const wallets = loadTradingWallets()
  const result: Array<{ address: string; balance: number; privateKey: string }> = []
  const connection = getConnection()
  
  for (const privateKey of wallets) {
    try {
      const kp = Keypair.fromSecretKey(base58.decode(privateKey))
      const balance = await connection.getBalance(kp.publicKey)
      result.push({
        address: kp.publicKey.toBase58(),
        balance: balance / 1e9,
        privateKey: privateKey // Include for reference (be careful with security)
      })
    } catch (error) {
      console.error(`Error getting balance for wallet:`, error)
    }
  }
  
  return result
}

// Buy tokens using simple RPC (not Jito bundles)
export const buyTokenSimple = async (
  walletPrivateKey: string,
  mintAddress: string,
  solAmount: number,
  referrerPrivateKey?: string, // Optional: if provided, use this as referrer (must be token creator for pump.fun)
  useJupiter: boolean = false, // If true, use Jupiter swap instead of pump.fun SDK (works with any token)
  priorityFee: 'none' | 'low' | 'medium' | 'normal' | 'high' | 'ultra' = 'low', // Priority fee level: 'none' (0 SOL), 'low'/'normal' (random 0.000025-0.0001 SOL), 'high' (0.005 SOL), 'ultra' (0.01 SOL)
  skipHeliusSender: boolean = false // If true, skip Helius Sender and use regular RPC (saves 0.0002 SOL per tx for wallet warming)
): Promise<{ signature: string; txUrl: string }> => {
  try {
    const connection = getConnection()
    const walletKp = Keypair.fromSecretKey(base58.decode(walletPrivateKey))
    const mintPubkey = new PublicKey(mintAddress)
    
    // If useJupiter is true, use Jupiter swap (works with any token, no referrer needed)
    if (useJupiter) {
      console.log(`Using Jupiter swap for buy (works with any token) - Priority: ${priorityFee}`)
      const buyAmountLamports = Math.floor(solAmount * 1e9)
      const { PRIORITY_FEE_LAMPORTS_ULTRA, PRIORITY_FEE_LAMPORTS_HIGH, PRIORITY_FEE_LAMPORTS_MEDIUM, PRIORITY_FEE_LAMPORTS_LOW, PRIORITY_FEE_LAMPORTS_NONE } = require('../constants/constants')
      let priorityFeeLamports: number
      if (priorityFee === 'ultra') {
        priorityFeeLamports = PRIORITY_FEE_LAMPORTS_ULTRA
      } else if (priorityFee === 'high') {
        priorityFeeLamports = PRIORITY_FEE_LAMPORTS_HIGH
      } else if (priorityFee === 'normal' || priorityFee === 'low' || priorityFee === 'medium') {
        // NORMAL: Random variance between LOW and MEDIUM for natural-looking trades
        const lowFee = PRIORITY_FEE_LAMPORTS_LOW || 25000
        const medFee = PRIORITY_FEE_LAMPORTS_MEDIUM || 100000
        priorityFeeLamports = lowFee + Math.floor(Math.random() * (medFee - lowFee))
        console.log(`[Buy] Using NORMAL priority fee (random): ${priorityFeeLamports} lamports (${(priorityFeeLamports / 1e9).toFixed(6)} SOL)`)
      } else {
        // NONE fee: No priority fee (Jito tip only)
        priorityFeeLamports = PRIORITY_FEE_LAMPORTS_NONE || 0
        console.log(`[Buy] Using NONE priority fee: Jito tip only`)
      }
      const tx = await getBuyTxWithJupiter(walletKp, mintPubkey, buyAmountLamports, priorityFeeLamports, priorityFee)
      
      if (!tx) {
        throw new Error('Failed to get buy transaction from Jupiter')
      }
      
      // Send transaction (skip Helius Sender for wallet warming to save 0.0002 SOL per tx)
      let signature: string
      if (skipHeliusSender) {
        // Skip Helius Sender - use regular RPC (cheaper for wallet warming)
        signature = await connection.sendTransaction(tx, {
          skipPreflight: false,
          maxRetries: 3
        })
        console.log(`[Buy] 💰 Sent via regular RPC (no Helius tip): ${signature}`)
      } else {
        // Send via Helius Sender for ultra-low latency (dual routing: validators + Jito)
        // NOTE: Helius Sender requires minimum 200,000 lamports tip to one of their tip wallets
        // Add tip proactively to avoid retry delay
        const txWithTip = await addHeliusTip(tx, walletKp)
        try {
          signature = await sendViaHeliusSender(txWithTip)
          console.log(`[Buy] ⚡ Sent via Helius Sender (with tip): ${signature}`)
        } catch (heliusError: any) {
          // If Helius Sender fails, fallback to regular RPC send
          console.warn(`[Buy] ⚠️ Helius Sender failed: ${heliusError.message}`)
          console.log(`[Buy] Falling back to regular RPC send...`)
          signature = await connection.sendTransaction(txWithTip, {
            skipPreflight: false,
            maxRetries: 3
          })
          console.log(`[Buy] ✅ Sent via regular RPC: ${signature}`)
        }
      }
      
      // Wait for confirmation and VERIFY transaction succeeded
      console.log(`[Buy] Waiting for confirmation...`)
      const confirmed = await waitForConfirmation(connection, signature)
      
      if (confirmed) {
        // Double-check the transaction actually succeeded (not just confirmed)
        const txStatus = await connection.getSignatureStatus(signature)
        if (txStatus.value?.err) {
          const errMsg = JSON.stringify(txStatus.value.err)
          console.log(`[Buy] ❌ Transaction FAILED on-chain: ${errMsg}`)
          throw new Error(`Buy transaction failed: ${errMsg}`)
        }
        console.log(`[Buy] ✅ Transaction confirmed and successful!`)
      } else {
        // Even if timeout, check if it landed
        console.log(`[Buy] ⏳ Confirmation timeout, checking status...`)
        await new Promise(resolve => setTimeout(resolve, 2000)) // Wait 2 more seconds
        const txStatus = await connection.getSignatureStatus(signature)
        if (txStatus.value?.err) {
          const errMsg = JSON.stringify(txStatus.value.err)
          console.log(`[Buy] ❌ Transaction FAILED on-chain: ${errMsg}`)
          throw new Error(`Buy transaction failed: ${errMsg}`)
        }
        if (!txStatus.value) {
          console.log(`[Buy] ⚠️ Transaction not found - may still be processing`)
        } else {
          console.log(`[Buy] ✅ Transaction landed successfully!`)
        }
      }
      
      return {
        signature,
        txUrl: `https://solscan.io/tx/${signature}`
      }
    }
    
    // Otherwise, use pump.fun SDK (requires referrer to be token creator)
    // Determine referrer public key - MUST be the token creator for pump.fun
    let referrerPublicKey: PublicKey
    
    if (referrerPrivateKey) {
      // Use provided referrer (must be token creator)
      try {
        const referrerKp = Keypair.fromSecretKey(base58.decode(referrerPrivateKey))
        referrerPublicKey = referrerKp.publicKey
        console.log("Using provided referrer key for buy (must be token creator)")
      } catch (e) {
        throw new Error("Invalid referrer private key format")
      }
    } else {
      // Use PRIVATE_KEY from env (assumes it's the token creator)
      const mainPrivateKey = process.env.PRIVATE_KEY
      if (mainPrivateKey) {
        try {
          const mainKp = Keypair.fromSecretKey(base58.decode(mainPrivateKey))
          referrerPublicKey = mainKp.publicKey
          console.log("Using PRIVATE_KEY from .env as referrer (token creator)")
        } catch (e) {
          throw new Error("Invalid PRIVATE_KEY in .env file")
        }
      } else {
        throw new Error("No referrer provided. For pump.fun buys, you must provide the token creator's private key as referrer, or use Jupiter swap (set useJupiter=true)")
      }
    }
    
    // Get buy instructions using pump.fun SDK
    const buyAmountLamports = Math.floor(solAmount * 1e9)
    const buyIxs = await makeBuyIx(walletKp, buyAmountLamports, 0, referrerPublicKey, mintPubkey)
    
    // Get latest blockhash
    const latestBlockhash = await connection.getLatestBlockhash('confirmed')
    
    // Create transaction
    const msg = new TransactionMessage({
      payerKey: walletKp.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), // Reduced compute units
        // Add random variation to compute unit price to avoid looking botted
        // Base: 0-2 microLamports per unit (adds natural variation between trades)
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Math.floor(Math.random() * 3) }), // 0-2 microLamports random variation
        ...buyIxs
      ]
    }).compileToV0Message()
    
    const tx = new VersionedTransaction(msg)
    tx.sign([walletKp])
    
    // Retry logic for pump.fun buys (handles slippage/price movement)
    // When multiple wallets buy simultaneously, price moves on bonding curve
    // We retry with fresh blockhash and recalculated buy instructions
    let signature: string | null = null
    let lastError: Error | null = null
    const maxRetries = 3
    const retryDelay = 500 // 500ms delay between retries
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Recalculate buy instructions on retry (price may have moved)
        // This ensures we get the correct amount for current price
        const buyAmountLamports = Math.floor(solAmount * 1e9)
        const currentBuyIxs = await makeBuyIx(walletKp, buyAmountLamports, 0, referrerPublicKey, mintPubkey)
        
        // Get fresh blockhash for each retry (important for price changes)
        const latestBlockhash = await connection.getLatestBlockhash('confirmed')
        
        // Recreate transaction with fresh blockhash and recalculated instructions
        const msg = new TransactionMessage({
          payerKey: walletKp.publicKey,
          recentBlockhash: latestBlockhash.blockhash,
          instructions: [
            ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Math.floor(Math.random() * 3) }),
            ...currentBuyIxs
          ]
        }).compileToV0Message()
        
        const tx = new VersionedTransaction(msg)
        tx.sign([walletKp])

        // Send transaction (skip Helius Sender for wallet warming to save 0.0002 SOL per tx)
        if (skipHeliusSender) {
          // Skip Helius Sender - use regular RPC (cheaper for wallet warming)
          signature = await connection.sendTransaction(tx, {
            skipPreflight: false,
            maxRetries: 3
          })
          console.log(`[Buy] 💰 Sent via regular RPC (no Helius tip, attempt ${attempt}/${maxRetries}): ${signature}`)
        } else {
          // Add Helius tip before sending (required for Helius Sender - minimum 200,000 lamports)
          // NOTE: Helius Sender requires minimum 200,000 lamports tip to one of their tip wallets
          const txWithTip = await addHeliusTip(tx, walletKp)

          // Send via Helius Sender for ultra-low latency
          // If Helius Sender fails, fallback to regular RPC send
          try {
            signature = await sendViaHeliusSender(txWithTip)
            console.log(`[Buy] ⚡ Sent via Helius Sender (with tip, attempt ${attempt}/${maxRetries}): ${signature}`)
          } catch (heliusError: any) {
            console.warn(`[Buy] ⚠️ Helius Sender failed: ${heliusError.message}`)
            console.log(`[Buy] Falling back to regular RPC send...`)
            // Fallback to regular RPC send (txWithTip still has the tip, which is fine for regular RPC too)
            signature = await connection.sendTransaction(txWithTip, {
              skipPreflight: false,
              maxRetries: 3
            })
            console.log(`[Buy] ✅ Sent via regular RPC (attempt ${attempt}/${maxRetries}): ${signature}`)
          }
        }
        
        // Wait for confirmation and check if it succeeded
        console.log(`[Buy] Waiting for confirmation...`)
        const confirmed = await waitForConfirmation(connection, signature, 5000) // 5 second timeout
        
        if (confirmed) {
          // Double-check transaction actually succeeded
          const status = await connection.getSignatureStatus(signature)
          if (status.value && status.value.err) {
            const errorMsg = JSON.stringify(status.value.err)
            // Check if it's a slippage/price movement error
            if (errorMsg.includes('0x1') || errorMsg.includes('insufficient') || errorMsg.includes('slippage') ||
                errorMsg.includes('BlockhashNotFound') || errorMsg.includes('blockhash')) {
              console.log(`[Buy] ⚠️ Transaction failed (attempt ${attempt}/${maxRetries}): ${errorMsg}`)
              lastError = new Error(`Buy failed: ${errorMsg}`)
              if (attempt < maxRetries) {
                console.log(`[Buy] Retrying with fresh blockhash and recalculated buy instructions in ${retryDelay}ms...`)
                await new Promise(resolve => setTimeout(resolve, retryDelay))
                continue // Retry with fresh blockhash and recalculated instructions
              }
            } else {
              throw new Error(`Transaction failed: ${errorMsg}`)
            }
          } else {
            // Transaction succeeded!
            console.log(`[Buy] ✅ Transaction confirmed! GMGN should index within 1-2 seconds.`)
            return {
              signature,
              txUrl: `https://solscan.io/tx/${signature}`
            }
          }
        } else {
          // Check if transaction failed
          const status = await connection.getSignatureStatus(signature)
          if (status.value && status.value.err) {
            const errorMsg = JSON.stringify(status.value.err)
            // Check if it's a slippage/price movement error
            if (errorMsg.includes('0x1') || errorMsg.includes('insufficient') || errorMsg.includes('slippage') ||
                errorMsg.includes('BlockhashNotFound') || errorMsg.includes('blockhash')) {
              console.log(`[Buy] ⚠️ Transaction failed due to price movement/slippage (attempt ${attempt}/${maxRetries}): ${errorMsg}`)
              lastError = new Error(`Buy failed: Price moved during transaction. ${errorMsg}`)
              if (attempt < maxRetries) {
                console.log(`[Buy] Retrying with fresh blockhash and recalculated buy instructions in ${retryDelay}ms...`)
                await new Promise(resolve => setTimeout(resolve, retryDelay))
                continue // Retry
              }
            } else {
              throw new Error(`Transaction failed: ${errorMsg}`)
            }
          } else {
            // Transaction still pending - might succeed later
            console.log(`[Buy] ⚠️ Transaction still pending (attempt ${attempt}/${maxRetries})`)
            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, retryDelay))
              continue // Retry
            }
          }
        }
      } catch (error: any) {
        lastError = error
        const errorMsg = error.message || JSON.stringify(error)
        
        // Check if it's a slippage/price movement error
        if (errorMsg.includes('insufficient') || errorMsg.includes('slippage') || errorMsg.includes('0x1') || 
            errorMsg.includes('price') || errorMsg.includes('amount') || errorMsg.includes('BlockhashNotFound') ||
            errorMsg.includes('blockhash')) {
          console.log(`[Buy] ⚠️ Buy failed due to price movement/slippage (attempt ${attempt}/${maxRetries}): ${errorMsg}`)
          if (attempt < maxRetries) {
            console.log(`[Buy] Retrying with fresh blockhash and recalculated buy instructions in ${retryDelay}ms...`)
            await new Promise(resolve => setTimeout(resolve, retryDelay))
            continue // Retry
          }
        } else {
          // Non-retryable error
          throw error
        }
      }
    }
    
    // All retries failed
    if (lastError) {
      throw new Error(`Buy failed after ${maxRetries} attempts: ${lastError.message}. This is likely due to price movement/slippage when multiple wallets buy simultaneously. Try reducing the number of parallel buys or increasing the delay between buys.`)
    }
    
    throw new Error(`Buy failed: Transaction not confirmed after ${maxRetries} attempts`)
  } catch (error: any) {
    // Provide more detailed error messages
    let errorMessage = error.message || 'Unknown error'
    
    // Check for common issues
    if (errorMessage.includes('Simulation failed')) {
      // Check if it's a referrer error - suggest using Jupiter
      if (errorMessage.includes('ConstraintSeeds') || errorMessage.includes('creator_vault')) {
        errorMessage = `${errorMessage}. Note: For tokens you didn't create, use Jupiter swap instead (set useJupiter=true)`
      }
    } else if (errorMessage.includes('insufficient funds')) {
      errorMessage = `Insufficient SOL balance. Make sure your wallet has enough SOL for the transaction.`
    } else if (errorMessage.includes('Invalid')) {
      errorMessage = `Invalid transaction: ${errorMessage}. Check token address and wallet balance.`
    }
    
    throw new Error(`Buy failed: ${errorMessage}`)
  }
}

// Sell tokens using simple RPC (Jupiter)
export const sellTokenSimple = async (
  walletPrivateKey: string,
  mintAddress: string,
  percentage: number = 100, // Percentage of tokens to sell (default 100%)
  priorityFee: 'none' | 'low' | 'medium' | 'normal' | 'high' | 'ultra' = 'low', // Priority fee level: 'none' (0 SOL), 'low'/'normal' (random 0.000025-0.0001 SOL), 'high' (0.005 SOL), 'ultra' (0.01 SOL)
  skipHeliusSender: boolean = false // If true, skip Helius Sender and use regular RPC (saves 0.0002 SOL per tx for wallet warming)
): Promise<{ signature: string; txUrl: string }> => {
  try {
    const connection = getConnection()
    const walletKp = Keypair.fromSecretKey(base58.decode(walletPrivateKey))
    const mintPubkey = new PublicKey(mintAddress)
    
    // Get token balance - retry a few times if tokens were just bought (they might not be settled yet)
    let tokenBalance = await getWalletTokenBalance(walletPrivateKey, mintAddress)
    let retries = 0
    const maxRetries = 5
    
    // If no tokens found, retry a few times (tokens might still be settling after buy)
    while ((!tokenBalance.hasTokens || tokenBalance.balance === 0) && retries < maxRetries) {
      retries++
      console.log(`[Sell] Tokens not found, retrying... (attempt ${retries}/${maxRetries})`)
      await new Promise(resolve => setTimeout(resolve, 1000)) // Wait 1 second
      tokenBalance = await getWalletTokenBalance(walletPrivateKey, mintAddress)
    }
    
    if (!tokenBalance.hasTokens || tokenBalance.balance === 0) {
      throw new Error(`No tokens to sell. Current balance: ${tokenBalance.balance || 0}. Make sure the buy transaction has been confirmed and tokens have settled.`)
    }
    
    // Calculate amount to sell based on percentage
    // Use the actual balance, not rounded
    const amountToSell = tokenBalance.balance * (percentage / 100)
    
    // Check if amount is too small (less than 0.000001 tokens)
    if (amountToSell < 0.000001) {
      // For very small amounts, try selling 100% instead
      if (tokenBalance.balance > 0 && tokenBalance.balance < 0.000001) {
        throw new Error(`Amount to sell is too small (balance: ${tokenBalance.balance}). Try selling 100% instead.`)
      }
      throw new Error(`Amount to sell is too small (calculated: ${amountToSell}, balance: ${tokenBalance.balance})`)
    }
    
    // Convert to raw token amount (Jupiter expects raw amount as string)
    // We need to get the token decimals first
    const { TOKEN_PROGRAM_ID } = require("@solana/spl-token")
    const tokenAccounts = await connection.getTokenAccountsByOwner(walletKp.publicKey, {
      programId: TOKEN_PROGRAM_ID,
    })
    
    let decimals = 6 // Default for most tokens
    for (const account of tokenAccounts.value) {
      try {
        const parsed = (account.account.data as any).parsed?.info
        if (parsed?.mint === mintAddress) {
          decimals = parsed.tokenAmount?.decimals || 6
          break
        }
      } catch {
        // Skip if data is not in parsed format
      }
    }
    
    // Convert UI amount to raw amount
    // Use Math.ceil to avoid rounding down to 0 for very small amounts
    const rawAmount = Math.ceil(amountToSell * Math.pow(10, decimals))
    
    // Ensure raw amount is at least 1 (minimum token unit)
    if (rawAmount === 0 && amountToSell > 0) {
      throw new Error(`Raw amount is 0 after conversion (UI amount: ${amountToSell}, decimals: ${decimals}). Token amount is too small to sell.`)
    }
    
    // Get priority fee lamports based on selection
    const { PRIORITY_FEE_LAMPORTS_ULTRA, PRIORITY_FEE_LAMPORTS_HIGH, PRIORITY_FEE_LAMPORTS_MEDIUM, PRIORITY_FEE_LAMPORTS_LOW, PRIORITY_FEE_LAMPORTS_NONE } = require('../constants/constants')
    let priorityFeeLamports: number
    if (priorityFee === 'ultra') {
      priorityFeeLamports = PRIORITY_FEE_LAMPORTS_ULTRA
    } else if (priorityFee === 'high') {
      priorityFeeLamports = PRIORITY_FEE_LAMPORTS_HIGH
    } else if (priorityFee === 'normal' || priorityFee === 'low' || priorityFee === 'medium') {
      // NORMAL: Random variance between LOW and MEDIUM for natural-looking trades
      const lowFee = PRIORITY_FEE_LAMPORTS_LOW || 25000
      const medFee = PRIORITY_FEE_LAMPORTS_MEDIUM || 100000
      priorityFeeLamports = lowFee + Math.floor(Math.random() * (medFee - lowFee))
      console.log(`[Sell] Using NORMAL priority fee (random): ${priorityFeeLamports} lamports (${(priorityFeeLamports / 1e9).toFixed(6)} SOL)`)
    } else {
      // NONE fee: No priority fee (Jito tip only)
      priorityFeeLamports = PRIORITY_FEE_LAMPORTS_NONE || 0
      console.log(`[Sell] Using NONE priority fee: Jito tip only`)
    }
    
    // Try Jupiter first (for graduated tokens on Raydium)
    console.log(`[Sell] Requesting Jupiter sell transaction: mint=${mintAddress.substring(0, 8)}..., rawAmount=${rawAmount}, decimals=${decimals}, uiAmount=${amountToSell.toFixed(6)}`)
    let sellTx = await getSellTxWithJupiter(walletKp, mintPubkey, rawAmount.toString(), priorityFeeLamports, priorityFee)
    
    // If Jupiter fails (no route), fallback to pump.fun SDK sell (for tokens still on bonding curve)
    if (!sellTx) {
      console.log(`[Sell] ⚠️ Jupiter has no route for ${mintAddress.substring(0, 8)}... (token likely still on pump.fun bonding curve)`)
      console.log(`[Sell] Falling back to pump.fun SDK sell...`)
      
      try {
        const connection = getConnection()
        const sdk = new PumpFunSDK(new AnchorProvider(connection, new NodeWallet(walletKp), { commitment: 'confirmed' }))
        
        // Convert raw amount to bigint (token amount in smallest unit)
        const sellTokenAmount = BigInt(rawAmount)
        
        // Get sell transaction from pump.fun SDK
        // Use 1% slippage (100 basis points) for pump.fun sells
        const slippageBps = BigInt(100) // 1% slippage
        const sellTransaction = await sdk.getSellInstructionsByTokenAmount(
          walletKp.publicKey,
          mintPubkey,
          sellTokenAmount,
          slippageBps
        )
        
        // The SDK returns a Transaction, we need to convert it to VersionedTransaction
        // Get the latest blockhash
        const latestBlockhash = await connection.getLatestBlockhash('confirmed')
        
        // Decompile the transaction to get instructions
        const instructions = sellTransaction.instructions
        
        // Add priority fee if specified
        const finalInstructions: TransactionInstruction[] = []
        if (priorityFeeLamports && priorityFeeLamports > 0) {
          finalInstructions.push(
            ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Math.floor(priorityFeeLamports / 200_000) })
          )
        }
        finalInstructions.push(...instructions)
        
        // Create VersionedTransaction
        const msg = new TransactionMessage({
          payerKey: walletKp.publicKey,
          recentBlockhash: latestBlockhash.blockhash,
          instructions: finalInstructions
        }).compileToV0Message()
        
        sellTx = new VersionedTransaction(msg)
        sellTx.sign([walletKp])
        
        console.log(`[Sell] ✅ Got sell transaction from pump.fun SDK for ${mintAddress.substring(0, 8)}...`)
      } catch (pumpFunError: any) {
        console.error(`[Sell] ❌ Pump.fun SDK sell also failed: ${pumpFunError.message}`)
        console.error(`[Sell] Error details:`, pumpFunError)
        throw new Error(`Failed to get sell transaction from both Jupiter and pump.fun SDK for ${mintAddress.substring(0, 8)}... (amount: ${amountToSell.toFixed(6)}, raw: ${rawAmount}). Jupiter error: No route. Pump.fun error: ${pumpFunError.message}`)
      }
    } else {
      console.log(`[Sell] ✅ Got sell transaction from Jupiter for ${mintAddress.substring(0, 8)}...`)
    }
    
    // Send transaction (skip Helius Sender for wallet warming to save 0.0002 SOL per tx)
    let signature: string
    if (skipHeliusSender) {
      // Skip Helius Sender - use regular RPC (cheaper for wallet warming)
      signature = await connection.sendTransaction(sellTx, {
        skipPreflight: false,
        maxRetries: 3
      })
      console.log(`[Sell] 💰 Sent via regular RPC (no Helius tip): ${signature}`)
    } else {
      // Send via Helius Sender for ultra-low latency (dual routing: validators + Jito)
      // If Helius Sender fails, fallback to regular RPC send
      // NOTE: Helius Sender requires minimum 200,000 lamports tip to one of their tip wallets
      try {
        // Add Helius tip proactively (Helius Sender requires minimum 200,000 lamports tip)
        // NOTE: Helius Sender requires minimum 200,000 lamports tip to one of their tip wallets
        // Add tip proactively to avoid retry delay
        const txWithTip = await addHeliusTip(sellTx, walletKp)
        // Try Helius Sender first
        signature = await sendViaHeliusSender(txWithTip)
        console.log(`[Sell] ⚡ Sent via Helius Sender (with tip): ${signature}`)
      } catch (heliusError: any) {
        // If Helius Sender fails, fallback to regular RPC send
        console.warn(`[Sell] ⚠️ Helius Sender failed: ${heliusError.message}`)
        console.log(`[Sell] Falling back to regular RPC send...`)
        signature = await connection.sendTransaction(sellTx, {
          skipPreflight: false,
          maxRetries: 3
        })
        console.log(`[Sell] ✅ Sent via regular RPC: ${signature}`)
      }
    }
    
    // Wait for fast confirmation (~400ms) for GMGN indexing
    // This ensures transaction is included in a block before returning
    // GMGN indexes faster when transaction is already confirmed
    console.log(`[Sell] Waiting for fast confirmation for GMGN indexing...`)
    const confirmed = await waitForConfirmation(connection, signature)
    if (confirmed) {
      console.log(`[Sell] ✅ Transaction confirmed! GMGN should index within 1-2 seconds.`)
    } else {
      console.log(`[Sell] ⚠️ Confirmation check timeout (transaction likely still processing)`)
    }
    
    return {
      signature,
      txUrl: `https://solscan.io/tx/${signature}`
    }
  } catch (error) {
    throw new Error(`Sell failed: ${error.message}`)
  }
}

// Get wallet token balance
export const getWalletTokenBalance = async (
  walletPrivateKey: string,
  mintAddress: string
): Promise<{ balance: number; hasTokens: boolean }> => {
  try {
    const connection = getConnection()
    const walletKp = Keypair.fromSecretKey(base58.decode(walletPrivateKey))
    const mintPubkey = new PublicKey(mintAddress)
    const { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } = require("@solana/spl-token")
    
    // First try: Use associated token address (more reliable)
    try {
      const ata = await getAssociatedTokenAddress(mintPubkey, walletKp.publicKey, true)
      console.log(`[TokenBalance] Checking ATA ${ata.toBase58().substring(0, 8)}... for mint ${mintAddress.substring(0, 8)}...`)
      
      // Use confirmed commitment explicitly for freshest data after tx confirmation
      const accountInfo = await connection.getParsedAccountInfo(ata, 'confirmed')
      
      if (accountInfo.value && accountInfo.value.data) {
        const data = accountInfo.value.data
        // Type guard: check if data is ParsedAccountData (has 'parsed' property)
        if ('parsed' in data && data.parsed) {
          const balance = (data.parsed as any).info?.tokenAmount?.uiAmount || 0
          console.log(`[TokenBalance] ATA exists with balance: ${balance}`)
          if (balance > 0) {
            console.log(`[TokenBalance] ✅ Found ${balance} tokens via ATA for ${mintAddress.substring(0, 8)}...`)
          }
          return { balance, hasTokens: balance > 0 }
        } else {
          console.log(`[TokenBalance] ATA exists but data not parsed`)
        }
      } else {
        console.log(`[TokenBalance] ATA does not exist yet`)
      }
    } catch (ataError: any) {
      // ATA doesn't exist yet or error - fall back to scanning all token accounts
      console.log(`[TokenBalance] ATA check error: ${ataError.message}`)
    }
    
    // Fallback: Scan all token accounts with confirmed commitment
    // Also try Token-2022 program in case the token uses that
    const { TOKEN_2022_PROGRAM_ID } = require("@solana/spl-token")
    
    for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      try {
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
          walletKp.publicKey,
          { programId },
          'confirmed'
        )
        
        if (tokenAccounts.value.length > 0) {
          // Log first few mints we find to debug
          const mints = tokenAccounts.value.slice(0, 3).map(a => 
            (a.account.data as any).parsed?.info?.mint?.substring(0, 8) || 'unknown'
          )
          console.log(`[TokenBalance] Found ${tokenAccounts.value.length} accounts. Sample mints: ${mints.join(', ')}`)
        }
        
        for (const account of tokenAccounts.value) {
          try {
            const parsed = (account.account.data as any).parsed?.info
            const accountMint = parsed?.mint
            if (accountMint === mintAddress) {
              const balance = parsed.tokenAmount?.uiAmount || 0
              console.log(`[TokenBalance] ✅ MATCH! Found ${balance} tokens for ${mintAddress.substring(0, 8)}...`)
              return { balance, hasTokens: balance > 0 }
            }
          } catch {
            // Skip if data is not in parsed format
          }
        }
      } catch (scanError: any) {
        console.log(`[TokenBalance] Scan failed for program: ${scanError.message}`)
      }
    }
    
    console.log(`[TokenBalance] ❌ No tokens found for ${mintAddress.substring(0, 8)}...`)
    return { balance: 0, hasTokens: false }
  } catch (error: any) {
    console.error(`[TokenBalance] Error: ${error.message}`)
    return { balance: 0, hasTokens: false }
  }
}


// ============================================================================
// BATCH SELL FUNCTIONS - Instant parallel sells from multiple wallets
// ============================================================================

interface BatchSellResult {
  success: boolean
  wallet: string
  signature?: string
  error?: string
  tokensHeld?: number
}

// Get wallet data from current-run.json
const getCurrentRunWallets = (): {
  mintAddress: string | null
  devWallet: { address: string; privateKey: string } | null
  bundleWallets: Array<{ address: string; privateKey: string }>
  holderWallets: Array<{ address: string; privateKey: string }>
} => {
  const fs = require('fs')
  const path = require('path')
  
  const currentRunPath = path.join(__dirname, '..', 'keys', 'current-run.json')
  
  if (!fs.existsSync(currentRunPath)) {
    console.log('[BatchSell] No current-run.json found')
    return { mintAddress: null, devWallet: null, bundleWallets: [], holderWallets: [] }
  }
  
  const data = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'))
  const mintAddress = data.mintAddress || null
  
  // Get DEV wallet
  let devWallet: { address: string; privateKey: string } | null = null
  if (data.creatorDevWalletKey) {
    const kp = Keypair.fromSecretKey(base58.decode(data.creatorDevWalletKey))
    devWallet = { address: kp.publicKey.toBase58(), privateKey: data.creatorDevWalletKey }
  }
  
  // Get bundle wallets
  const bundleWallets: Array<{ address: string; privateKey: string }> = []
  if (data.bundleWalletKeys && Array.isArray(data.bundleWalletKeys)) {
    for (const key of data.bundleWalletKeys) {
      const kp = Keypair.fromSecretKey(base58.decode(key))
      bundleWallets.push({ address: kp.publicKey.toBase58(), privateKey: key })
    }
  }
  
  // Get holder wallets
  const holderWallets: Array<{ address: string; privateKey: string }> = []
  if (data.holderWalletKeys && Array.isArray(data.holderWalletKeys)) {
    for (const key of data.holderWalletKeys) {
      const kp = Keypair.fromSecretKey(base58.decode(key))
      holderWallets.push({ address: kp.publicKey.toBase58(), privateKey: key })
    }
  }
  
  return { mintAddress, devWallet, bundleWallets, holderWallets }
}

// Batch sell from multiple wallets in PARALLEL (instant!)
export const batchSell = async (
  walletType: 'all' | 'bundles' | 'holders',
  percentage: number = 100,
  priorityFee: 'none' | 'low' | 'medium' | 'normal' | 'high' | 'ultra' = 'high'
): Promise<{ results: BatchSellResult[]; successful: number; failed: number; elapsed: number }> => {
  const startTime = Date.now()
  console.log(`\nBATCH SELL - ${walletType.toUpperCase()} (${percentage}%)`)
  console.log(`Priority: ${priorityFee.toUpperCase()}`)
  
  const { mintAddress, devWallet, bundleWallets, holderWallets } = getCurrentRunWallets()
  
  if (!mintAddress) {
    console.log('[BatchSell] No mint address found in current-run.json')
    return { results: [], successful: 0, failed: 0, elapsed: 0 }
  }
  
  console.log(`Mint: ${mintAddress}`)
  
  // Build wallet list based on type
  let walletsToSell: Array<{ address: string; privateKey: string; label: string }> = []
  
  // DEV wallet only included in 'all'
  if (walletType === 'all' && devWallet) {
    walletsToSell.push({ ...devWallet, label: 'DEV' })
  }
  
  // Bundle wallets for 'all' or 'bundles'
  if (walletType === 'all' || walletType === 'bundles') {
    bundleWallets.forEach((w, i) => {
      walletsToSell.push({ ...w, label: `Bundle ${i + 1}` })
    })
  }
  
  if (walletType === 'all' || walletType === 'holders') {
    holderWallets.forEach((w, i) => {
      walletsToSell.push({ ...w, label: `Holder ${i + 1}` })
    })
  }
  
  if (walletsToSell.length === 0) {
    console.log('[BatchSell] No wallets found to sell from')
    return { results: [], successful: 0, failed: 0, elapsed: 0 }
  }
  
  console.log(`\nSelling from ${walletsToSell.length} wallets in PARALLEL...`)
  
  // Check which wallets have tokens first
  const balanceChecks = await Promise.all(
    walletsToSell.map(async (wallet) => {
      const balance = await getWalletTokenBalance(wallet.privateKey, mintAddress)
      return { ...wallet, hasTokens: balance.hasTokens, tokensHeld: balance.balance }
    })
  )
  
  const walletsWithTokens = balanceChecks.filter(w => w.hasTokens)
  const walletsWithoutTokens = balanceChecks.filter(w => !w.hasTokens)
  
  console.log(`${walletsWithTokens.length} wallets have tokens`)
  console.log(`${walletsWithoutTokens.length} wallets skipped (no tokens)`)
  
  if (walletsWithTokens.length === 0) {
    console.log('[BatchSell] No wallets have tokens to sell')
    const elapsed = Date.now() - startTime
    return { 
      results: walletsWithoutTokens.map(w => ({ success: false, wallet: w.address, error: 'No tokens', tokensHeld: 0 })), 
      successful: 0, failed: 0, elapsed 
    }
  }
  
  // Execute all sells in PARALLEL
  console.log(`\nFIRING ${walletsWithTokens.length} SELLS IN PARALLEL...`)
  
  const sellPromises = walletsWithTokens.map(async (wallet) => {
    try {
      console.log(`[${wallet.label}] Selling ${percentage}% from ${wallet.address.substring(0, 8)}...`)
      const result = await sellTokenSimple(wallet.privateKey, mintAddress, percentage, priorityFee)
      console.log(`[${wallet.label}] SUCCESS: ${result.signature?.substring(0, 16)}...`)
      return { success: true, wallet: wallet.address, signature: result.signature, tokensHeld: wallet.tokensHeld } as BatchSellResult
    } catch (error: any) {
      console.log(`[${wallet.label}] FAILED: ${error.message}`)
      return { success: false, wallet: wallet.address, error: error.message, tokensHeld: wallet.tokensHeld } as BatchSellResult
    }
  })
  
  const results = await Promise.all(sellPromises)
  
  const skippedResults: BatchSellResult[] = walletsWithoutTokens.map(w => ({
    success: false, wallet: w.address, error: 'No tokens to sell', tokensHeld: 0
  }))
  
  const allResults = [...results, ...skippedResults]
  const successful = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length
  const elapsed = Date.now() - startTime
  
  console.log(`\nBATCH SELL COMPLETE!`)
  console.log(`   Successful: ${successful}`)
  console.log(`   Failed: ${failed}`)
  console.log(`   Skipped: ${walletsWithoutTokens.length}`)
  console.log(`   Time: ${elapsed}ms`)
  
  return { results: allResults, successful, failed, elapsed }
}

// Convenience exports
export const batchSellAll = (percentage: number = 100, priorityFee: 'none' | 'low' | 'medium' | 'normal' | 'high' | 'ultra' = 'high') => 
  batchSell('all', percentage, priorityFee)

export const batchSellBundles = (percentage: number = 100, priorityFee: 'none' | 'low' | 'medium' | 'normal' | 'high' | 'ultra' = 'high') => 
  batchSell('bundles', percentage, priorityFee)

export const batchSellHolders = (percentage: number = 100, priorityFee: 'none' | 'low' | 'medium' | 'normal' | 'high' | 'ultra' = 'high') => 
  batchSell('holders', percentage, priorityFee)


