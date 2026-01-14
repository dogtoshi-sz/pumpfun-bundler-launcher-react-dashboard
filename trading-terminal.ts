import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from "@solana/web3.js"
import base58 from "bs58"
import { makeBuyIx } from "./src/main"
import { getSellTxWithJupiter, getBuyTxWithJupiter } from "./utils/swapOnlyAmm"
import fs from "fs"
import path from "path"

// Get RPC endpoint from env (don't import from constants to avoid PRIVATE_KEY requirement)
const getRpcEndpoint = () => process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com'
const getRpcWebSocketEndpoint = () => process.env.RPC_WEBSOCKET_ENDPOINT || 'wss://api.mainnet-beta.solana.com'

// Helius Sender endpoint for ultra-low latency transaction submission
// Sends to BOTH validators AND Jito simultaneously for maximum inclusion speed
const HELIUS_SENDER_ENDPOINT = 'https://sender.helius-rpc.com/fast'

const getConnection = () => new Connection(getRpcEndpoint(), {
  wsEndpoint: getRpcWebSocketEndpoint(),
  commitment: "confirmed"
})

// Send transaction via Helius Sender for ultra-low latency
// https://www.helius.dev/docs/sending-transactions/sender
const sendViaHeliusSender = async (transaction: VersionedTransaction): Promise<string> => {
  const response = await fetch(HELIUS_SENDER_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now().toString(),
      method: 'sendTransaction',
      params: [
        Buffer.from(transaction.serialize()).toString('base64'),
        {
          encoding: 'base64',
          skipPreflight: true, // Required for Sender
          maxRetries: 0
        }
      ]
    })
  })

  const json = await response.json()
  if (json.error) {
    throw new Error(`Helius Sender error: ${json.error.message}`)
  }

  return json.result
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
  priorityFee: 'none' | 'low' | 'medium' | 'normal' | 'high' | 'ultra' = 'low' // Priority fee level: 'none' (0 SOL), 'low'/'normal' (random 0.000025-0.0001 SOL), 'high' (0.005 SOL), 'ultra' (0.01 SOL)
): Promise<{ signature: string; txUrl: string }> => {
  try {
    const connection = getConnection()
    const walletKp = Keypair.fromSecretKey(base58.decode(walletPrivateKey))
    const mintPubkey = new PublicKey(mintAddress)
    
    // If useJupiter is true, use Jupiter swap (works with any token, no referrer needed)
    if (useJupiter) {
      console.log(`Using Jupiter swap for buy (works with any token) - Priority: ${priorityFee}`)
      const buyAmountLamports = Math.floor(solAmount * 1e9)
      const { PRIORITY_FEE_LAMPORTS_ULTRA, PRIORITY_FEE_LAMPORTS_HIGH, PRIORITY_FEE_LAMPORTS_MEDIUM, PRIORITY_FEE_LAMPORTS_LOW, PRIORITY_FEE_LAMPORTS_NONE } = require('./constants/constants')
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
      
      // Send via Helius Sender for ultra-low latency (dual routing: validators + Jito)
      const signature = await sendViaHeliusSender(tx)

      console.log(`[Buy] ⚡ Sent via Helius Sender: ${signature}`)
      
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

        // Send via Helius Sender for ultra-low latency
        signature = await sendViaHeliusSender(tx)

        console.log(`[Buy] ⚡ Sent via Helius Sender (attempt ${attempt}/${maxRetries}): ${signature}`)
        
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
  priorityFee: 'none' | 'low' | 'medium' | 'normal' | 'high' | 'ultra' = 'low' // Priority fee level: 'none' (0 SOL), 'low'/'normal' (random 0.000025-0.0001 SOL), 'high' (0.005 SOL), 'ultra' (0.01 SOL)
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
    const { PRIORITY_FEE_LAMPORTS_ULTRA, PRIORITY_FEE_LAMPORTS_HIGH, PRIORITY_FEE_LAMPORTS_MEDIUM, PRIORITY_FEE_LAMPORTS_LOW, PRIORITY_FEE_LAMPORTS_NONE } = require('./constants/constants')
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
    
    // Get sell transaction from Jupiter with selected priority fee
    console.log(`[Sell] Requesting Jupiter sell transaction: mint=${mintAddress.substring(0, 8)}..., rawAmount=${rawAmount}, decimals=${decimals}, uiAmount=${amountToSell.toFixed(6)}`)
    const sellTx = await getSellTxWithJupiter(walletKp, mintPubkey, rawAmount.toString(), priorityFeeLamports, priorityFee)
    
    if (!sellTx) {
      console.error(`[Sell] Jupiter returned null transaction for ${mintAddress.substring(0, 8)}...`)
      console.error(`[Sell] This could mean: 1) Token has no liquidity on Jupiter, 2) Amount is too small, 3) Jupiter API error`)
      throw new Error(`Failed to get sell transaction from Jupiter for ${mintAddress.substring(0, 8)}... (amount: ${amountToSell.toFixed(6)}, raw: ${rawAmount})`)
    }
    
    console.log(`[Sell] ✅ Got sell transaction from Jupiter for ${mintAddress.substring(0, 8)}...`)
    
    // Send via Helius Sender for ultra-low latency (dual routing: validators + Jito)
    const signature = await sendViaHeliusSender(sellTx)
    
    console.log(`[Sell] ⚡ Sent via Helius Sender: ${signature}`);
    
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

