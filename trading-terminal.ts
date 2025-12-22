import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from "@solana/web3.js"
import base58 from "bs58"
import { RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, PRIVATE_KEY } from "./constants"
import { makeBuyIx } from "./src/main"
import { getSellTxWithJupiter } from "./utils/swapOnlyAmm"
import fs from "fs"
import path from "path"

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: "confirmed"
})

const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))

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
  const result = []
  
  for (const privateKey of wallets) {
    try {
      const kp = Keypair.fromSecretKey(base58.decode(privateKey))
      const balance = await connection.getBalance(kp.publicKey)
      result.push({
        address: kp.publicKey.toBase58(),
        balance: balance / 1e9,
        privateKey: privateKey // Include for frontend reference (be careful with security)
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
  solAmount: number
): Promise<{ signature: string; txUrl: string }> => {
  try {
    const walletKp = Keypair.fromSecretKey(base58.decode(walletPrivateKey))
    const mintPubkey = new PublicKey(mintAddress)
    
    // Get buy instructions using pump.fun SDK
    const buyAmountLamports = Math.floor(solAmount * 1e9)
    const buyIxs = await makeBuyIx(walletKp, buyAmountLamports, 0, mainKp.publicKey, mintPubkey)
    
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
    
    // Send transaction
    const signature = await connection.sendTransaction(tx, {
      skipPreflight: false,
      maxRetries: 5
    })
    
    console.log(`Trade sent: ${signature}`);
    
    // Modern confirmation logic
    const confirmation = await connection.confirmTransaction({
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
    }, 'confirmed');

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }
    
    return {
      signature,
      txUrl: `https://solscan.io/tx/${signature}`
    }
  } catch (error) {
    throw new Error(`Buy failed: ${error.message}`)
  }
}

// Sell tokens using simple RPC (Jupiter)
export const sellTokenSimple = async (
  walletPrivateKey: string,
  mintAddress: string,
  percentage: number = 100 // Percentage of tokens to sell (default 100%)
): Promise<{ signature: string; txUrl: string }> => {
  try {
    const walletKp = Keypair.fromSecretKey(base58.decode(walletPrivateKey))
    const mintPubkey = new PublicKey(mintAddress)
    
    // First, get the token balance
    const tokenBalance = await getWalletTokenBalance(walletPrivateKey, mintAddress)
    if (!tokenBalance.hasTokens || tokenBalance.balance === 0) {
      throw new Error('No tokens to sell')
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
      const parsed = account.account.data.parsed?.info
      if (parsed?.mint === mintAddress) {
        decimals = parsed.tokenAmount?.decimals || 6
        break
      }
    }
    
    // Convert UI amount to raw amount
    const rawAmount = Math.floor(amountToSell * Math.pow(10, decimals))
    
    // Get sell transaction from Jupiter
    const sellTx = await getSellTxWithJupiter(walletKp, mintPubkey, rawAmount.toString())
    
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
    const walletKp = Keypair.fromSecretKey(base58.decode(walletPrivateKey))
    const mintPubkey = new PublicKey(mintAddress)
    const { TOKEN_PROGRAM_ID } = require("@solana/spl-token")
    
    const tokenAccounts = await connection.getTokenAccountsByOwner(walletKp.publicKey, {
      programId: TOKEN_PROGRAM_ID,
    })
    
    for (const account of tokenAccounts.value) {
      const parsed = account.account.data.parsed?.info
      if (parsed?.mint === mintAddress) {
        const balance = parsed.tokenAmount?.uiAmount || 0
        return { balance, hasTokens: balance > 0 }
      }
    }
    
    return { balance: 0, hasTokens: false }
  } catch (error) {
    throw new Error(`Error getting token balance: ${error.message}`)
  }
}

