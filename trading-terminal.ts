import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from "@solana/web3.js"
import base58 from "bs58"
import { makeBuyIx } from "./src/main"
import { getSellTxWithJupiter, getBuyTxWithJupiter } from "./utils/swapOnlyAmm"
import fs from "fs"
import path from "path"

// Get RPC endpoint from env (don't import from constants to avoid PRIVATE_KEY requirement)
const getRpcEndpoint = () => process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com'
const getRpcWebSocketEndpoint = () => process.env.RPC_WEBSOCKET_ENDPOINT || 'wss://api.mainnet-beta.solana.com'

const getConnection = () => new Connection(getRpcEndpoint(), {
  wsEndpoint: getRpcWebSocketEndpoint(),
  commitment: "confirmed"
})

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
  priorityFee: 'low' | 'medium' | 'high' = 'low' // Priority fee level: 'low' (0.0001 SOL), 'medium' (0.0005 SOL), or 'high' (0.005 SOL) - only used for Jupiter swaps
): Promise<{ signature: string; txUrl: string }> => {
  try {
    const connection = getConnection()
    const walletKp = Keypair.fromSecretKey(base58.decode(walletPrivateKey))
    const mintPubkey = new PublicKey(mintAddress)
    
    // If useJupiter is true, use Jupiter swap (works with any token, no referrer needed)
    if (useJupiter) {
      console.log(`Using Jupiter swap for buy (works with any token) - Priority: ${priorityFee}`)
      const buyAmountLamports = Math.floor(solAmount * 1e9)
      const { PRIORITY_FEE_LAMPORTS_HIGH, PRIORITY_FEE_LAMPORTS_MEDIUM, PRIORITY_FEE_LAMPORTS_LOW } = require('./constants/constants')
      const priorityFeeLamports = priorityFee === 'high' ? PRIORITY_FEE_LAMPORTS_HIGH : 
                                  priorityFee === 'medium' ? PRIORITY_FEE_LAMPORTS_MEDIUM : 
                                  PRIORITY_FEE_LAMPORTS_LOW
      const tx = await getBuyTxWithJupiter(walletKp, mintPubkey, buyAmountLamports, priorityFeeLamports)
      
      if (!tx) {
        throw new Error('Failed to get buy transaction from Jupiter')
      }
      
      const signature = await connection.sendTransaction(tx, {
        skipPreflight: false,
        maxRetries: 5
      })
      
      console.log(`Jupiter buy sent: ${signature}`)
      
      const latestBlockhash = await connection.getLatestBlockhash('confirmed')
      const confirmation = await connection.confirmTransaction({
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
      }, 'confirmed')

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`)
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
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 }), // 0.001 SOL priority fee for fast inclusion
        ...buyIxs
      ]
    }).compileToV0Message()
    
    const tx = new VersionedTransaction(msg)
    tx.sign([walletKp])
    
    // Simulate transaction first to get better error messages
    try {
      const simulation = await connection.simulateTransaction(tx, {
        sigVerify: false,
        replaceRecentBlockhash: true
      })
      
      if (simulation.value.err) {
        const errorDetails = JSON.stringify(simulation.value.err)
        const logs = simulation.value.logs || []
        const lastLogs = logs.slice(-10).join('; ')
        throw new Error(`Simulation failed: ${errorDetails}. Last logs: ${lastLogs}`)
      }
      
      console.log(`Simulation successful. Compute units: ${simulation.value.unitsConsumed || 'N/A'}`)
    } catch (simError: any) {
      // If simulation fails, provide detailed error
      if (simError.message.includes('Simulation failed')) {
        throw simError // Re-throw simulation errors with details
      }
      // Other simulation errors, log but continue
      console.warn(`Simulation warning: ${simError.message}`)
    }
    
    // Send transaction
    const signature = await connection.sendTransaction(tx, {
      skipPreflight: false,
      maxRetries: 5
    })
    
    console.log(`Trade sent: ${signature}`)
    
    // Modern confirmation logic
    const confirmation = await connection.confirmTransaction({
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
    }, 'confirmed')

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`)
    }
    
    return {
      signature,
      txUrl: `https://solscan.io/tx/${signature}`
    }
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
  priorityFee: 'low' | 'medium' | 'high' = 'low' // Priority fee level: 'low' (0.0001 SOL), 'medium' (0.0005 SOL), or 'high' (0.005 SOL)
): Promise<{ signature: string; txUrl: string }> => {
  try {
    const connection = getConnection()
    const walletKp = Keypair.fromSecretKey(base58.decode(walletPrivateKey))
    const mintPubkey = new PublicKey(mintAddress)
    
    // First, get the token balance - try multiple times in case tokens are still settling
    let tokenBalance = await getWalletTokenBalance(walletPrivateKey, mintAddress)
    
    // If no tokens found, wait a bit and retry (tokens might still be settling after buy)
    if (!tokenBalance.hasTokens || tokenBalance.balance === 0) {
      console.log("No tokens found, waiting 2 seconds and retrying...")
      await new Promise(resolve => setTimeout(resolve, 2000))
      tokenBalance = await getWalletTokenBalance(walletPrivateKey, mintAddress)
    }
    
    if (!tokenBalance.hasTokens || tokenBalance.balance === 0) {
      // Try one more time with a longer wait
      console.log("Still no tokens found, waiting 3 more seconds...")
      await new Promise(resolve => setTimeout(resolve, 3000))
      tokenBalance = await getWalletTokenBalance(walletPrivateKey, mintAddress)
    }
    
    if (!tokenBalance.hasTokens || tokenBalance.balance === 0) {
      throw new Error(`No tokens to sell. Current balance: ${tokenBalance.balance || 0}. Make sure the buy transaction has been confirmed and tokens have settled.`)
    }
    
    // Calculate amount to sell based on percentage
    const amountToSell = Math.floor(tokenBalance.balance * (percentage / 100))
    if (amountToSell === 0) {
      throw new Error('Amount to sell is too small')
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
    const rawAmount = Math.floor(amountToSell * Math.pow(10, decimals))
    
    // Get priority fee lamports based on selection
    const { PRIORITY_FEE_LAMPORTS_HIGH, PRIORITY_FEE_LAMPORTS_MEDIUM, PRIORITY_FEE_LAMPORTS_LOW } = require('./constants/constants')
    const priorityFeeLamports = priorityFee === 'high' ? PRIORITY_FEE_LAMPORTS_HIGH : 
                                priorityFee === 'medium' ? PRIORITY_FEE_LAMPORTS_MEDIUM : 
                                PRIORITY_FEE_LAMPORTS_LOW
    
    // Get sell transaction from Jupiter with selected priority fee
    const sellTx = await getSellTxWithJupiter(walletKp, mintPubkey, rawAmount.toString(), priorityFeeLamports)
    
    if (!sellTx) {
      throw new Error('Failed to get sell transaction from Jupiter')
    }
    
    // Send transaction
    const signature = await connection.sendTransaction(sellTx, {
      skipPreflight: false,
      maxRetries: 5
    })
    
    console.log(`Sell sent: ${signature}`);
    
    // Get fresh blockhash for confirmation if needed
    const latestBlockhash = await connection.getLatestBlockhash('confirmed');
    
    // Modern confirmation logic
    const confirmation = await connection.confirmTransaction({
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
    }, 'confirmed');

    if (confirmation.value.err) {
      throw new Error(`Sell failed: ${JSON.stringify(confirmation.value.err)}`);
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
      const accountInfo = await connection.getParsedAccountInfo(ata)
      
      if (accountInfo.value && accountInfo.value.data) {
        const data = accountInfo.value.data
        // Type guard: check if data is ParsedAccountData (has 'parsed' property)
        if ('parsed' in data && data.parsed) {
          const balance = (data.parsed as any).info?.tokenAmount?.uiAmount || 0
          return { balance, hasTokens: balance > 0 }
        }
      }
    } catch (ataError) {
      // ATA doesn't exist yet or error - fall back to scanning all token accounts
      console.log("ATA check failed, scanning all token accounts...")
    }
    
    // Fallback: Scan all token accounts
    const tokenAccounts = await connection.getTokenAccountsByOwner(walletKp.publicKey, {
      programId: TOKEN_PROGRAM_ID,
    })
    
    for (const account of tokenAccounts.value) {
      try {
        const parsed = (account.account.data as any).parsed?.info
        if (parsed?.mint === mintAddress) {
          const balance = parsed.tokenAmount?.uiAmount || 0
          return { balance, hasTokens: balance > 0 }
        }
      } catch {
        // Skip if data is not in parsed format
      }
    }
    
    return { balance: 0, hasTokens: false }
  } catch (error: any) {
    console.error(`Error getting token balance: ${error.message}`)
    return { balance: 0, hasTokens: false }
  }
}

