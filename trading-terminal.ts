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
      let priorityFeeLamports: number
      if (priorityFee === 'high') {
        priorityFeeLamports = PRIORITY_FEE_LAMPORTS_HIGH
      } else if (priorityFee === 'medium') {
        priorityFeeLamports = PRIORITY_FEE_LAMPORTS_MEDIUM
      } else {
        // LOW fee: Use minimal fee with random variation to avoid looking botted
        // Variation: 0-50,000 lamports (0 to 0.00005 SOL) - adds natural variation
        // This makes each trade have slightly different fees (looks more natural)
        // Jupiter defaults to ~800k lamports (0.0008 SOL), so we vary between 0-50k to stay low but varied
        const baseFee = PRIORITY_FEE_LAMPORTS_LOW || 0
        const variation = Math.floor(Math.random() * 50000) // 0-50,000 lamports random variation
        priorityFeeLamports = baseFee + variation
        console.log(`[Buy] Using LOW priority fee with variation: ${priorityFeeLamports} lamports (${(priorityFeeLamports / 1e9).toFixed(9)} SOL)`)
      }
      const tx = await getBuyTxWithJupiter(walletKp, mintPubkey, buyAmountLamports, priorityFeeLamports, priorityFee)
      
      if (!tx) {
        throw new Error('Failed to get buy transaction from Jupiter')
      }
      
      // Send instantly (GMGN-style - skip preflight and don't wait for confirmation)
      const signature = await connection.sendTransaction(tx, {
        skipPreflight: true, // Skip preflight for instant execution (like GMGN)
        maxRetries: 3
      })
      
      console.log(`Jupiter buy sent instantly: ${signature}`)
      
      // Don't wait for confirmation - return immediately (GMGN-style)
      // Transaction will confirm in background, but we return signature immediately
      // This makes execution instant like GMGN
      
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
    
    // Skip simulation for speed (GMGN-style instant execution)
    // Send transaction immediately with skipPreflight for instant execution
    const signature = await connection.sendTransaction(tx, {
      skipPreflight: true, // Skip preflight for instant execution (like GMGN)
      maxRetries: 3
    })
    
    console.log(`Trade sent instantly: ${signature}`)
    
    // Don't wait for confirmation - return immediately (GMGN-style)
    // Transaction will confirm in background, but we return signature immediately
    // This makes execution instant like GMGN
    
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
    
    // Get priority fee lamports based on selection (with slight variation for low fee to avoid exact same fee)
    const { PRIORITY_FEE_LAMPORTS_HIGH, PRIORITY_FEE_LAMPORTS_MEDIUM, PRIORITY_FEE_LAMPORTS_LOW } = require('./constants/constants')
    let priorityFeeLamports: number
    if (priorityFee === 'high') {
      priorityFeeLamports = PRIORITY_FEE_LAMPORTS_HIGH
    } else if (priorityFee === 'medium') {
      priorityFeeLamports = PRIORITY_FEE_LAMPORTS_MEDIUM
      } else {
        // LOW fee: Use minimal fee with random variation to avoid looking botted
        // Variation: 0-50,000 lamports (0 to 0.00005 SOL) - adds natural variation
        // This makes each trade have slightly different fees (looks more natural)
        // Jupiter defaults to ~800k lamports (0.0008 SOL), so we vary between 0-50k to stay low but varied
        const baseFee = PRIORITY_FEE_LAMPORTS_LOW || 0
        const variation = Math.floor(Math.random() * 50000) // 0-50,000 lamports random variation
        priorityFeeLamports = baseFee + variation
        console.log(`[Sell] Using LOW priority fee with variation: ${priorityFeeLamports} lamports (${(priorityFeeLamports / 1e9).toFixed(9)} SOL)`)
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
    
    // Send transaction instantly (GMGN-style - skip preflight and don't wait for confirmation)
    const signature = await connection.sendTransaction(sellTx, {
      skipPreflight: true, // Skip preflight for instant execution (like GMGN)
      maxRetries: 3
    })
    
    console.log(`Sell sent instantly: ${signature}`);
    
    // Don't wait for confirmation - return immediately (GMGN-style)
    // Transaction will confirm in background, but we return signature immediately
    // This makes execution instant like GMGN
    
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

