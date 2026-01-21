// Simple wallet warming manager
// Tracks wallets, auto-funds them, and records transaction history

import { Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js"
import base58 from "bs58"
import fs from "fs"
import path from "path"
import { buyTokenSimple, sellTokenSimple, getWalletTokenBalance } from "../cli/trading-terminal"
import { RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, PRIVATE_KEY } from "../constants"
import { sleep } from "../utils"
import { getCachedTrendingTokens } from "./fetch-trending-tokens"
import { TOKEN_PROGRAM_ID, createCloseAccountInstruction, getAssociatedTokenAddress, getAccount } from "@solana/spl-token"

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: "confirmed"
})

export interface WarmedWallet {
  privateKey: string
  address: string
  transactionCount: number // Total buy+sell transactions
  firstTransactionDate: string | null // ISO date string
  lastTransactionDate: string | null // ISO date string
  totalTrades: number // Total successful trades (buy+sell pairs)
  tradesLast7Days?: number // Trades in the last 7 days (from exact point in time)
  createdAt: string // When wallet was added
  status: 'idle' | 'warming' | 'ready' // Current status
  tags: string[] // Tags like "OLD", "recent", "recently-warmed", etc.
  solBalance?: number // Cached SOL balance (updated on demand)
  lastBalanceUpdate?: string // When balance was last updated
  lastWarmedAt?: string // ISO date string - when wallet was last warmed
}

// Resolve path relative to project root (not api-server directory)
const getProjectRoot = () => {
  // If we're in api-server, go up one level
  const cwd = process.cwd()
  if (cwd.endsWith('api-server')) {
    return path.join(cwd, '..')
  }
  return cwd
}

const WARMED_WALLETS_FILE = path.join(getProjectRoot(), 'keys', 'warmed-wallets.json')

// Load warmed wallets
// Only logs errors to reduce noise (this function is called frequently)
export function loadWarmedWallets(): WarmedWallet[] {
  try {
    if (fs.existsSync(WARMED_WALLETS_FILE)) {
      const content = fs.readFileSync(WARMED_WALLETS_FILE, 'utf8')
      const data = JSON.parse(content)
      const wallets = data.wallets || []
      // Only log if there's an issue or first load (check if file was just created)
      return wallets
    }
  } catch (error) {
    console.error('[Wallet Manager] Error loading warmed wallets:', error)
    console.error('[Wallet Manager] Error stack:', error instanceof Error ? error.stack : 'No stack')
  }
  return []
}

// Save warmed wallets
export function saveWarmedWallets(wallets: WarmedWallet[]): void {
  try {
    const dir = path.dirname(WARMED_WALLETS_FILE)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(WARMED_WALLETS_FILE, JSON.stringify({ wallets }, null, 2))
  } catch (error) {
    console.error('Error saving warmed wallets:', error)
    throw error
  }
}

// Create a new wallet
export function createWarmingWallet(tags: string[] = []): WarmedWallet {
  const kp = Keypair.generate()
  const wallet: WarmedWallet = {
    privateKey: base58.encode(kp.secretKey),
    address: kp.publicKey.toBase58(),
    transactionCount: 0,
    firstTransactionDate: null,
    lastTransactionDate: null,
    totalTrades: 0,
    tradesLast7Days: 0,
    createdAt: new Date().toISOString(),
    status: 'idle',
    tags: tags || []
  }
  
  const wallets = loadWarmedWallets()
  wallets.push(wallet)
  saveWarmedWallets(wallets)
  
  return wallet
}

// Add existing wallet
export function addWarmingWallet(privateKey: string, tags: string[] = []): WarmedWallet {
  // Validate and decode private key
  const trimmedKey = privateKey.trim()
  
  if (!trimmedKey || trimmedKey.length < 80) {
    throw new Error(`Invalid private key: too short (${trimmedKey.length} chars). Solana private keys are typically 80-200 characters in base58 format.`)
  }
  
  let decoded: Uint8Array
  try {
    decoded = base58.decode(trimmedKey)
  } catch (decodeError: any) {
    throw new Error(`Invalid private key format: ${decodeError.message}. Make sure it's a valid base58-encoded Solana private key.`)
  }
  
  if (decoded.length !== 64) {
    throw new Error(`Invalid private key: decoded length is ${decoded.length} bytes, expected 64 bytes.`)
  }
  
  let kp: Keypair
  let address: string
  try {
    kp = Keypair.fromSecretKey(decoded)
    address = kp.publicKey.toBase58()
  } catch (keypairError: any) {
    throw new Error(`Failed to create keypair from private key: ${keypairError.message}`)
  }
  
  if (!address || address.length < 32) {
    throw new Error(`Failed to derive valid wallet address from private key. Got address: ${address}`)
  }
  
  const wallets = loadWarmedWallets()
  
  // Check if wallet already exists
  const existing = wallets.find(w => w.address === address)
  if (existing) {
    // Merge tags if wallet exists
    if (tags && tags.length > 0) {
      existing.tags = [...new Set([...existing.tags, ...tags])]
      saveWarmedWallets(wallets)
    }
    return existing
  }
  
  const wallet: WarmedWallet = {
    privateKey: trimmedKey, // Store trimmed version
    address,
    transactionCount: 0,
    firstTransactionDate: null,
    lastTransactionDate: null,
    totalTrades: 0,
    tradesLast7Days: 0,
    createdAt: new Date().toISOString(),
    status: 'idle',
    tags: tags || []
  }
  
  wallets.push(wallet)
  saveWarmedWallets(wallets)
  
  return wallet
}

// Update wallet tags
export function updateWalletTags(address: string, tags: string[]): boolean {
  const wallets = loadWarmedWallets()
  const wallet = wallets.find(w => w.address === address)
  
  if (wallet) {
    wallet.tags = tags
    saveWarmedWallets(wallets)
    return true
  }
  
  return false
}

// Transfer SOL from one wallet to another
async function transferSol(fromKp: Keypair, toAddress: string, amountSol: number, keepMiniscule: boolean = false): Promise<string> {
  try {
    const toPubkey = new PublicKey(toAddress)
    const balance = await connection.getBalance(fromKp.publicKey)
    const balanceSol = balance / 1e9
    
    // Calculate amount to transfer
    let transferAmount = amountSol
    if (keepMiniscule) {
      // Keep only 0.0001 SOL (miniscule amount for rent exemption + transaction fee buffer)
      const minisculeAmount = 0.0001
      transferAmount = Math.max(0, balanceSol - minisculeAmount)
    }
    
    if (transferAmount <= 0) {
      throw new Error(`Insufficient balance to transfer (balance: ${balanceSol.toFixed(6)} SOL)`)
    }
    
    // Reserve for transaction fee (~0.000005 SOL) - subtract from transfer amount
    const feeReserve = 0.00001 // Small buffer for fees
    const actualTransferAmount = Math.max(0, transferAmount - feeReserve)
    
    if (actualTransferAmount <= 0) {
      throw new Error(`Balance too low after fee reserve (balance: ${balanceSol.toFixed(6)} SOL)`)
    }
    
    const transferLamports = Math.floor(actualTransferAmount * 1e9)
    
    console.log(`   💸 Transferring ${actualTransferAmount.toFixed(6)} SOL to ${toAddress.substring(0, 8)}... (keeping ${(balanceSol - actualTransferAmount).toFixed(6)} SOL for fees/rent)`)
    
    const latestBlockhash = await connection.getLatestBlockhash('confirmed')
    const transferMsg = new TransactionMessage({
      payerKey: fromKp.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: fromKp.publicKey,
          toPubkey: toPubkey,
          lamports: transferLamports
        })
      ]
    }).compileToV0Message()
    
    const transferTx = new VersionedTransaction(transferMsg)
    transferTx.sign([fromKp])
    
    const sig = await connection.sendTransaction(transferTx, { skipPreflight: true, maxRetries: 3 })
    
    console.log(`   ✅ Transfer sent: https://solscan.io/tx/${sig}`)
    return sig
  } catch (error: any) {
    console.error(`   ❌ Transfer failed: ${error.message}`)
    throw error
  }
}

// Auto-fund wallet if needed
async function autoFundWallet(walletKp: Keypair, requiredSol: number): Promise<boolean> {
  try {
    const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))
    const balance = await connection.getBalance(walletKp.publicKey)
    const balanceSol = balance / 1e9
    
    if (balanceSol >= requiredSol) {
      console.log(`   ✅ Wallet ${walletKp.publicKey.toBase58().substring(0, 8)}... already has ${balanceSol.toFixed(6)} SOL (sufficient, skipping funding)`)
      return true // Already has enough
    }
    
    const needed = requiredSol - balanceSol
    console.log(`   💰 Auto-funding wallet ${walletKp.publicKey.toBase58().substring(0, 8)}... with ${needed.toFixed(4)} SOL`)
    
    const latestBlockhash = await connection.getLatestBlockhash()
    const transferMsg = new TransactionMessage({
      payerKey: mainKp.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: mainKp.publicKey,
          toPubkey: walletKp.publicKey,
          lamports: Math.ceil(needed * 1e9)
        })
      ]
    }).compileToV0Message()
    
    const transferTx = new VersionedTransaction(transferMsg)
    transferTx.sign([mainKp])
    
    const sig = await connection.sendTransaction(transferTx, { skipPreflight: true, maxRetries: 3 })
    
    console.log(`   ✅ Auto-funded: https://solscan.io/tx/${sig}`)
    // Small delay for transaction to settle
    await sleep(1000)
    return true
  } catch (error: any) {
    console.error(`   ❌ Auto-funding failed: ${error.message}`)
    return false
  }
}

// Update wallet transaction stats
function updateWalletStats(address: string, isFirstTransaction: boolean): void {
  const wallets = loadWarmedWallets()
  const wallet = wallets.find(w => w.address === address)
  
  if (wallet) {
    wallet.transactionCount += 1
    wallet.totalTrades = Math.floor(wallet.transactionCount / 2) // Each trade = buy + sell = 2 transactions
    const now = new Date().toISOString()
    
    if (isFirstTransaction) {
      wallet.firstTransactionDate = now
    }
    wallet.lastTransactionDate = now
    
    saveWarmedWallets(wallets)
  }
}

// Warm a single wallet
export async function warmWallet(
  wallet: WarmedWallet,
  config: {
    tradesPerWallet: number
    minBuyAmount: number
    maxBuyAmount: number
    minIntervalSeconds: number
    maxIntervalSeconds: number
    priorityFee: 'low' | 'medium' | 'high'
    useJupiter: boolean
    closeTokenAccounts?: boolean // If true, sell 100% and close accounts to recover rent. If false, sell 99.9% and keep dust (cheaper for many trades)
    tradingPattern?: 'sequential' | 'randomized' | 'accumulate' // Trading pattern strategy
  },
  tokenList: string[],
  onProgress?: (wallet: WarmedWallet) => void
): Promise<{ success: number; failed: number; remainingBalance: number }> {
  const walletKp = Keypair.fromSecretKey(base58.decode(wallet.privateKey))
  const address = walletKp.publicKey.toBase58()
  
  // Update status
  const wallets = loadWarmedWallets()
  const walletIndex = wallets.findIndex(w => w.address === address)
  if (walletIndex >= 0) {
    wallets[walletIndex].status = 'warming'
    saveWarmedWallets(wallets)
  }
  
  console.log(`\n🔥 Warming wallet: ${address.substring(0, 8)}...${address.substring(address.length - 8)}`)
  
  let successCount = 0
  let failedCount = 0
  const isFirstTransaction = wallet.transactionCount === 0
  
  // Check balance (wallet should already be funded from main funding wallet)
  const balance = await connection.getBalance(walletKp.publicKey)
  const balanceSol = balance / 1e9
  console.log(`   💰 Current balance: ${balanceSol.toFixed(6)} SOL`)
  
  // Track tokens we've bought but not sold yet (for randomized/accumulate patterns)
  const heldTokens: Array<{ mint: string; balance: number }> = []
  
  // Track which tokens we've already used to avoid repeating the same token
  const usedTokens = new Set<string>()
  
  // Generate pattern based on trading pattern type
  const pattern = config.tradingPattern || 'sequential'
  console.log(`   🎲 Trading pattern: ${pattern} (from config: ${config.tradingPattern || 'undefined'})`)
  
  // For randomized: create a pattern like [buy, buy, sell, buy, sell, sell] based on tradesPerWallet
  let tradePlan: Array<'buy' | 'sell'> = []
  if (pattern === 'randomized') {
    // Create a balanced pattern: roughly half buys, half sells
    const numBuys = Math.ceil(config.tradesPerWallet / 2)
    const numSells = config.tradesPerWallet - numBuys
    tradePlan = Array(numBuys).fill('buy').concat(Array(numSells).fill('sell'))
    // Shuffle the pattern for randomness (but ensure we have tokens before selling)
    for (let i = tradePlan.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tradePlan[i], tradePlan[j]] = [tradePlan[j], tradePlan[i]]
    }
    // Ensure we always have at least one buy before first sell
    if (tradePlan[0] === 'sell' && numBuys > 0) {
      const firstBuy = tradePlan.indexOf('buy')
      if (firstBuy > 0) {
        [tradePlan[0], tradePlan[firstBuy]] = [tradePlan[firstBuy], tradePlan[0]]
      }
    }
    console.log(`   🎲 Randomized pattern: ${tradePlan.join(' → ')}`)
  } else if (pattern === 'accumulate') {
    // Buy all first, then sell all
    const numBuys = Math.ceil(config.tradesPerWallet / 2)
    const numSells = Math.floor(config.tradesPerWallet / 2)
    tradePlan = Array(numBuys).fill('buy').concat(Array(numSells).fill('sell'))
    console.log(`   📦 Accumulate pattern: ${tradePlan.join(' → ')}`)
  } else {
    // Sequential: alternate buy/sell
    for (let i = 0; i < config.tradesPerWallet; i++) {
      tradePlan.push(i % 2 === 0 ? 'buy' : 'sell')
    }
  }
  
  for (let i = 0; i < tradePlan.length; i++) {
    const action = tradePlan[i]
    console.log(`   📋 Action ${i + 1}/${tradePlan.length}: ${action.toUpperCase()} (pattern: ${pattern})`)
    if (tokenList.length === 0) {
      console.log(`   ⚠️  No tokens available`)
      break
    }
    
    // Execute based on action type
    if (action === 'buy') {
      const buyAmount = config.minBuyAmount + Math.random() * (config.maxBuyAmount - config.minBuyAmount)
      
      // Track balance before buy to measure full trade costs
      const balanceBeforeBuy = await connection.getBalance(walletKp.publicKey)
      const balanceBeforeBuySol = balanceBeforeBuy / 1e9
      
      // Try up to 20 different tokens if Jupiter fails (token might be dead/rugged)
      // Jupiter CAN trade pump.fun tokens via bonding curve - issue is dead/no-volume tokens
      let buySuccess = false
      let randomToken = ''
      const maxTokenRetries = 20
    
    // Use all tokens - the sell function will automatically fallback to pump.fun SDK if Jupiter fails
    // This ensures we can trade both graduated tokens (via Jupiter) and bonding curve tokens (via pump.fun SDK)
    // Prefer unused tokens, but allow reuse if we've used all available tokens
    const unusedTokens = tokenList.filter(t => !usedTokens.has(t))
    const tokensToTry = unusedTokens.length > 0 ? unusedTokens : tokenList // Fallback to all tokens if we've used them all
    
    for (let tokenAttempt = 0; tokenAttempt < maxTokenRetries && !buySuccess; tokenAttempt++) {
      randomToken = tokensToTry[Math.floor(Math.random() * tokensToTry.length)]
      
      try {
        // Buy
        console.log(`   [${i + 1}/${tradePlan.length}] 🛒 ${action === 'buy' ? 'Buying' : 'Selling'} ${buyAmount.toFixed(4)} SOL of ${randomToken.substring(0, 8)}...${tokenAttempt > 0 ? ` (token retry ${tokenAttempt + 1})` : ''}`)
        console.log(`   💰 Balance before buy: ${balanceBeforeBuySol.toFixed(6)} SOL`)
        await buyTokenSimple(
          wallet.privateKey,
          randomToken,
          buyAmount,
          undefined,
          config.useJupiter,
          config.priorityFee,
          true // skipHeliusSender = true (save 0.0002 SOL per tx for wallet warming)
        )
        buySuccess = true
        // Check balance after buy
        await sleep(1000) // Wait for buy to settle
        const balanceAfterBuy = await connection.getBalance(walletKp.publicKey)
        const balanceAfterBuySol = balanceAfterBuy / 1e9
        const buyCost = balanceBeforeBuySol - balanceAfterBuySol
        console.log(`   💰 Balance after buy: ${balanceAfterBuySol.toFixed(6)} SOL (cost: ${buyCost.toFixed(6)} SOL)`)
        console.log(`   💡 Buy cost includes: ${buyAmount.toFixed(6)} SOL tokens + ~0.002 SOL rent (token account creation) + tx fees`)
      } catch (buyError: any) {
        const errMsg = buyError.message?.toLowerCase() || ''
        // If Jupiter failed (no route/no liquidity), try a different token
        const isNoRouteError = errMsg.includes('failed to get buy transaction') || 
                               errMsg.includes('no route') ||
                               errMsg.includes('quote failed') ||
                               errMsg.includes('no swap transaction') ||
                               errMsg.includes('not tradable')
        
        if (isNoRouteError) {
          console.log(`   ⚠️  Token ${randomToken.substring(0, 8)}... failed (${buyError.message.substring(0, 50)}), trying another...`)
          if (tokenAttempt < maxTokenRetries - 1) {
            continue
          }
        }
        // Only throw for non-route errors (like network issues)
        if (!isNoRouteError) {
          throw buyError
        }
      }
    }
    
      // DON'T crash if no tradable token found - just skip this trade and continue
      if (!buySuccess) {
        console.log(`   ⚠️  Skipping buy action ${i + 1} - no tradable token found after ${maxTokenRetries} attempts`)
        failedCount++
        continue // Continue to next action instead of crashing
      }
      
      try {
        // Buy succeeded, wait for tokens and add to heldTokens
      
      updateWalletStats(address, i === 0 && isFirstTransaction)
      if (onProgress) {
        const updated = loadWarmedWallets().find(w => w.address === address)
        if (updated) onProgress(updated)
      }
      
      // Wait for tokens to settle before selling
      // Give RPC a moment to index the new token account after confirmation
      console.log(`   ⏳ Waiting for tokens to settle...`)
      await sleep(2000) // Initial 2s delay for RPC indexing
      
      let tokensReady = false
      let retries = 0
      const maxRetries = 40 // Wait up to 20 seconds (40 * 500ms) after initial delay
      let finalTokenBalance = 0
      
      while (!tokensReady && retries < maxRetries) {
        const tokenBalance = await getWalletTokenBalance(wallet.privateKey, randomToken)
        if (tokenBalance.hasTokens && tokenBalance.balance > 0) {
          tokensReady = true
          finalTokenBalance = tokenBalance.balance
          console.log(`   ✅ Tokens received: ${tokenBalance.balance.toFixed(6)}`)
        } else {
          retries++
          if (retries % 6 === 0) {
            console.log(`   ⏳ Still waiting for tokens... (${2 + retries * 0.5}s)`)
          }
          await sleep(500)
        }
      }
      
        if (!tokensReady) {
          throw new Error(`Tokens did not settle after ${2 + maxRetries * 0.5} seconds`)
        }
        
        // Add to held tokens (don't sell yet unless sequential pattern)
        heldTokens.push({ mint: randomToken, balance: finalTokenBalance })
        usedTokens.add(randomToken) // Mark this token as used
        console.log(`   ✅ Token added to held tokens (total: ${heldTokens.length}) - pattern: ${pattern}`)
        console.log(`   📝 Used tokens so far: ${usedTokens.size}/${tokenList.length}`)
        
        updateWalletStats(address, i === 0 && isFirstTransaction)
        if (onProgress) {
          const updated = loadWarmedWallets().find(w => w.address === address)
          if (updated) onProgress(updated)
        }
        
        // For sequential pattern, sell immediately after buy
        console.log(`   🔍 Pattern check: pattern === 'sequential'? ${pattern === 'sequential'} (pattern value: "${pattern}")`)
        if (pattern === 'sequential') {
          console.log(`   ✅ Sequential pattern detected - selling immediately after buy`)
          // Choose sell strategy based on config
          const closeAccounts = config.closeTokenAccounts !== false; // Default to true (close accounts)
      
          // Track balance before sell to measure costs
          const balanceBeforeSell = await connection.getBalance(walletKp.publicKey)
          const balanceBeforeSellSol = balanceBeforeSell / 1e9
          
          if (closeAccounts) {
        // Mode 1: Sell 100% and close account to recover rent (~0.002 SOL per trade)
        // More expensive per trade (extra close tx) but recovers rent - good for cleanup
        console.log(`   💸 Selling 100% and closing account (recovering rent)...`)
        console.log(`   💰 Balance before sell: ${balanceBeforeSellSol.toFixed(6)} SOL`)
        const sellResult = await sellTokenSimple(
          wallet.privateKey,
          randomToken,
          100, // Sell 100% so we can close the account
          config.priorityFee,
          true // skipHeliusSender = true (save 0.0002 SOL per tx for wallet warming)
        )
        
        // Check balance after sell
        await sleep(1000) // Wait for sell to settle
        const balanceAfterSell = await connection.getBalance(walletKp.publicKey)
        const balanceAfterSellSol = balanceAfterSell / 1e9
        const sellCost = balanceBeforeSellSol - balanceAfterSellSol
        console.log(`   💰 Balance after sell: ${balanceAfterSellSol.toFixed(6)} SOL (cost: ${sellCost.toFixed(6)} SOL)`)
        
        // Close the token account to recover rent (~0.002 SOL)
        try {
          console.log(`   🗑️ Closing token account to recover rent...`)
          const balanceBeforeClose = await connection.getBalance(walletKp.publicKey)
          const balanceBeforeCloseSol = balanceBeforeClose / 1e9
          const mintPubkey = new PublicKey(randomToken)
          
          // Wait longer to ensure sell transaction is fully processed
          await sleep(2000)
          
          // Check if sell transaction already closed the account (check balance change)
          // If Jupiter/sell tx closed it, rent should already be refunded
          const balanceAfterSellWait = await connection.getBalance(walletKp.publicKey)
          const balanceAfterSellWaitSol = balanceAfterSellWait / 1e9
          const potentialRentRefund = balanceAfterSellWaitSol - balanceAfterSellSol
          
          if (potentialRentRefund > 0.001) {
            console.log(`   💰 Balance increased by ${potentialRentRefund.toFixed(6)} SOL after sell (rent may have been auto-refunded)`)
          }
          
          // Find ALL token accounts for this mint (check both Token and Token-2022 programs)
          // Jupiter might use either program depending on the token
          const tokenAccounts = await connection.getTokenAccountsByOwner(walletKp.publicKey, {
            mint: mintPubkey,
            programId: TOKEN_PROGRAM_ID
          })
          
          // Token-2022 program ID (hardcoded since TOKEN_2022_PROGRAM_ID may not be available in older versions)
          const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
          
          const token2022Accounts = await connection.getTokenAccountsByOwner(walletKp.publicKey, {
            mint: mintPubkey,
            programId: TOKEN_2022_PROGRAM_ID
          })
          
          // Deduplicate accounts by pubkey (same account might be returned from both Token and Token-2022 queries)
          const accountMap = new Map<string, typeof tokenAccounts.value[0]>()
          for (const account of tokenAccounts.value) {
            accountMap.set(account.pubkey.toBase58(), account)
          }
          for (const account of token2022Accounts.value) {
            if (!accountMap.has(account.pubkey.toBase58())) {
              accountMap.set(account.pubkey.toBase58(), account)
            }
          }
          const allTokenAccounts = Array.from(accountMap.values())
          
          if (allTokenAccounts.length === 0) {
            console.log(`   ℹ️ No token account found for ${randomToken.substring(0, 8)}... (may have been auto-closed or never created)`)
            // Don't return - just skip closing for this token
            console.log(`   ℹ️ Skipping account close (no account found)`)
          } else {
          
          console.log(`   🔍 Found ${allTokenAccounts.length} unique token account(s) for mint ${randomToken.substring(0, 8)}...`)
          
          // Process each token account - close all empty ones (should only be one per mint, but be safe)
          let closedCount = 0
          let totalRentRecovered = 0
          
          for (const tokenAccountInfo of allTokenAccounts) {
            const tokenAccount = tokenAccountInfo.pubkey
            const rawAccountData = tokenAccountInfo.account.data
            const accountProgramId = tokenAccountInfo.account.owner // The program that owns this account (Token or Token-2022)
            
            // Get account info to check lamports (rent)
            const accountInfo = await connection.getAccountInfo(tokenAccount)
            if (!accountInfo) {
              console.log(`   ℹ️ Account ${tokenAccount.toBase58()} no longer exists, skipping`)
              continue
            }
            
            const lamportsOnAccount = accountInfo.lamports
            const TOKEN_2022_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
            const isToken2022 = accountProgramId.equals(TOKEN_2022_ID)
            const programName = isToken2022 ? 'Token-2022' : 'Token'
            
            console.log(`   🔍 Found token account: ${tokenAccount.toBase58()} (${programName}, lamports: ${(lamportsOnAccount / 1e9).toFixed(6)} SOL)`)
          
            // Parse account data to get balance and owner
            try {
              // Read balance from raw account data (bytes 64-72)
              // SPL Token account layout: mint(32) + owner(32) + amount(8) + ...
              if (rawAccountData.length < 72) {
                console.log(`   ⚠️ Invalid token account data length: ${rawAccountData.length}, skipping`)
                continue
              }
              
              // Read balance (BigUInt64LE at offset 64)
              const balanceBigInt = rawAccountData.readBigUInt64LE(64)
              const balance = Number(balanceBigInt)
              
              // Read owner/authority (PublicKey at offset 32-64)
              const ownerBytes = rawAccountData.slice(32, 64)
              const accountOwner = new PublicKey(ownerBytes)
              
              // Check if there's a delegate (offset 72: 0 = None, 1 = Some)
              const hasDelegate = rawAccountData.length > 72 && rawAccountData.readUInt8(72) === 1
              let delegate: PublicKey | null = null
              if (hasDelegate && rawAccountData.length >= 105) {
                const delegateBytes = rawAccountData.slice(73, 105)
                delegate = new PublicKey(delegateBytes)
              }
              
              console.log(`   📊   Balance: ${balance}, Owner: ${accountOwner.toBase58()}, Rent: ${(lamportsOnAccount / 1e9).toFixed(6)} SOL${delegate ? `, Delegate: ${delegate.toBase58()}` : ''}`)
              
              // Only close if balance is 0 (empty account)
              if (balance > 0) {
                console.log(`   ⚠️   Account has ${balance} tokens remaining (dust). Cannot close account with balance.`)
                console.log(`   ⚠️   This means ${(lamportsOnAccount / 1e9).toFixed(6)} SOL rent will remain locked.`)
                continue // Skip this account, try next one
              }
              
              // If there's a delegate, we can't close without the delegate's signature
              if (delegate && !delegate.equals(new PublicKey('11111111111111111111111111111111'))) {
                console.log(`   ⚠️   Account has delegate ${delegate.toBase58()}. Cannot close without delegate signature.`)
                continue // Skip this account
              }
              
              // Verify the account owner matches the wallet
              if (!accountOwner.equals(walletKp.publicKey)) {
                console.log(`   ⚠️   Owner mismatch! Account owner: ${accountOwner.toBase58()}, Wallet: ${walletKp.publicKey.toBase58()}`)
                continue // Skip this account
              }
              
              console.log(`   ✅   Account is empty (balance: 0) and verified, closing to recover ${(lamportsOnAccount / 1e9).toFixed(6)} SOL rent...`)
              
              // Re-verify account still exists right before closing (avoid stale data)
              const accountCheck = await connection.getAccountInfo(tokenAccount)
              if (!accountCheck) {
                console.log(`   ⚠️   Account ${tokenAccount.toBase58()} no longer exists (may have been auto-closed by sell tx)`)
                console.log(`   ⚠️   Rent ${(lamportsOnAccount / 1e9).toFixed(6)} SOL was likely auto-refunded or lost`)
                continue // Skip this account
              }
              
              const currentLamports = accountCheck.lamports
              if (currentLamports === 0) {
                console.log(`   ⚠️   Account ${tokenAccount.toBase58()} has 0 lamports (already closed/being closed)`)
                continue
              }
              
              console.log(`   🔍   Account still exists with ${(currentLamports / 1e9).toFixed(6)} SOL rent, proceeding to close...`)
              
              const latestBlockhash = await connection.getLatestBlockhash('confirmed')
              
              // Use the correct close instruction based on program (Token vs Token-2022)
              // For Token-2022, we MUST pass the program ID, otherwise it defaults to regular Token program
              const TOKEN_2022_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
              const programIdForClose = isToken2022 ? TOKEN_2022_ID : TOKEN_PROGRAM_ID
              
              console.log(`   🔧   Using ${programName} program ID for close instruction`)
              
              const closeMsg = new TransactionMessage({
                payerKey: walletKp.publicKey,
                recentBlockhash: latestBlockhash.blockhash,
                instructions: [
                  createCloseAccountInstruction(
                    tokenAccount,      // Token account to close (actual account found)
                    walletKp.publicKey, // Destination for rent refund
                    accountOwner,       // Authority (use the actual owner from account data)
                    [],                 // Multi-signers (not needed)
                    programIdForClose   // CRITICAL: Must pass program ID for Token-2022!
                  )
                ]
              }).compileToV0Message()
            
              const closeTx = new VersionedTransaction(closeMsg)
              closeTx.sign([walletKp])
              
              try {
                const closeSig = await connection.sendTransaction(closeTx, { skipPreflight: false, maxRetries: 3 })
                const confirmation = await connection.confirmTransaction(closeSig, 'confirmed')
                
                if (confirmation.value.err) {
                  const errStr = JSON.stringify(confirmation.value.err)
                  if (errStr.includes('InvalidAccountData') || errStr.includes('invalid account data')) {
                    console.log(`   ℹ️   Account was already closed before our transaction`)
                    // Check if rent was auto-refunded
                    const balanceAfterFailed = await connection.getBalance(walletKp.publicKey)
                    const balanceAfterFailedSol = balanceAfterFailed / 1e9
                    console.log(`   💰   Current balance: ${balanceAfterFailedSol.toFixed(6)} SOL`)
                    continue // Try next account
                  }
                  throw new Error(`Close transaction failed: ${errStr}`)
                }
                
                closedCount++
                totalRentRecovered += currentLamports
                console.log(`   ✅   Closed ${tokenAccount.toBase58()}: https://solscan.io/tx/${closeSig}`)
                
                // Verify rent was actually refunded by checking balance
                await sleep(500)
                const balanceAfterClose = await connection.getBalance(walletKp.publicKey)
                const balanceAfterCloseSol = balanceAfterClose / 1e9
                console.log(`   💰   Balance after close: ${balanceAfterCloseSol.toFixed(6)} SOL`)
                
              } catch (txError: any) {
                const errorMsg = txError.message || String(txError)
                if (errorMsg.includes('InvalidAccountData') || 
                    errorMsg.includes('invalid account data') || 
                    errorMsg.includes('could not find account') ||
                    errorMsg.includes('AccountNotInitialized') ||
                    errorMsg.includes('attempt to debit an account but found no record')) {
                  console.log(`   ⚠️   Account ${tokenAccount.toBase58()} already closed or doesn't exist`)
                  console.log(`   ⚠️   This means ${(currentLamports / 1e9).toFixed(6)} SOL rent was NOT recovered via our close`)
                  
                  // Check if the account still exists
                  const accountStillExists = await connection.getAccountInfo(tokenAccount)
                  if (!accountStillExists) {
                    console.log(`   ⚠️   Account confirmed gone. Checking if rent was auto-refunded...`)
                    // Check balance to see if rent was automatically refunded
                    const balanceAfterFailedClose = await connection.getBalance(walletKp.publicKey)
                    const balanceAfterFailedCloseSol = balanceAfterFailedClose / 1e9
                    const balanceChange = balanceAfterFailedCloseSol - balanceBeforeCloseSol
                    
                    if (balanceChange > 0.001) {
                      console.log(`   ✅   Balance increased by ${balanceChange.toFixed(6)} SOL - rent WAS auto-refunded!`)
                    } else {
                      console.log(`   ❌   Balance unchanged (${balanceChange.toFixed(6)} SOL) - rent was NOT refunded`)
                      console.log(`   ❌   ~${(currentLamports / 1e9).toFixed(6)} SOL rent is LOST`)
                    }
                  } else {
                    console.log(`   ⚠️   Account still exists with ${(accountStillExists.lamports / 1e9).toFixed(6)} SOL. Close transaction failed.`)
                  }
                  continue // Try next account
                }
                console.log(`   ⚠️   Failed to close ${tokenAccount.toBase58()}: ${errorMsg}`)
                // Continue to try other accounts
              }
            } catch (accountError: any) {
              console.log(`   ⚠️   Error processing account ${tokenAccount.toBase58()}: ${accountError.message}`)
              // Continue to next account
            }
          }
          
          // Final summary
          if (closedCount > 0) {
            // Check final balance to verify rent recovery
            await sleep(1000) // Wait for all closes to settle
            const balanceAfterClose = await connection.getBalance(walletKp.publicKey)
            const balanceAfterCloseSol = balanceAfterClose / 1e9
            const rentRecovered = balanceAfterCloseSol - balanceBeforeCloseSol
            const totalTradeCost = balanceBeforeBuySol - balanceAfterCloseSol
            const netSellPlusClose = balanceAfterCloseSol - balanceBeforeSellSol
            
            console.log(`   ✅ Closed ${closedCount} token account(s), recovered ${(totalRentRecovered / 1e9).toFixed(6)} SOL rent`)
            console.log(`   💰 Balance after close: ${balanceAfterCloseSol.toFixed(6)} SOL (rent recovered: ${rentRecovered.toFixed(6)} SOL)`)
            console.log(`   💰 Net from sell+close: ${netSellPlusClose.toFixed(6)} SOL (should be positive if rent was recovered)`)
            console.log(`   💰 TOTAL TRADE COST: ${totalTradeCost.toFixed(6)} SOL (from buy start to close end)`)
          } else {
            console.log(`   ℹ️ No empty token accounts to close (all may have balance or already closed)`)
          }
          }
        } catch (closeError: any) {
          // Log the actual error so we can see what's happening
          const balanceAfterFailedClose = await connection.getBalance(walletKp.publicKey)
          const balanceAfterFailedCloseSol = balanceAfterFailedClose / 1e9
          const totalTradeCostWithLockedRent = balanceBeforeBuySol - balanceAfterFailedCloseSol
          const rentLost = balanceAfterFailedCloseSol - balanceBeforeSellSol - (balanceBeforeSellSol - balanceAfterBuySol)
          
          console.error(`   ❌ Failed to close token account: ${closeError.message || closeError}`)
          console.error(`   ❌ Full error: ${JSON.stringify(closeError, Object.getOwnPropertyNames(closeError))}`)
          console.error(`   ❌ This means ~0.002 SOL rent will remain locked in the token account.`)
          console.error(`   💰 Balance after failed close: ${balanceAfterFailedCloseSol.toFixed(6)} SOL`)
          console.error(`   💰 TOTAL TRADE COST (WITH LOCKED RENT): ${totalTradeCostWithLockedRent.toFixed(6)} SOL`)
          console.error(`   ⚠️  Expected cost: ~0.00001-0.00005 SOL (just fees). Actual: ${totalTradeCostWithLockedRent.toFixed(6)} SOL`)
          console.error(`   ⚠️  The difference (~${(totalTradeCostWithLockedRent - 0.00003).toFixed(6)} SOL) is likely the locked rent.`)
          // Don't throw - continue with next trade even if close fails
        }
      } else {
        // Mode 2: Sell 99.9% and keep dust (don't close account)
        // Cheaper per trade (no close tx) but rent stays locked - good for building many tx history
        console.log(`   💸 Selling 99.9% (keeping 0.1% dust, no close - cheap mode)...`)
        await sellTokenSimple(
          wallet.privateKey,
          randomToken,
          99.9, // Sell 99.9%, keep tiny dust so account stays open
          config.priorityFee,
          true // skipHeliusSender = true (save 0.0002 SOL per tx for wallet warming)
        )
      }
      
          updateWalletStats(address, false)
          if (onProgress) {
            const updated = loadWarmedWallets().find(w => w.address === address)
            if (updated) onProgress(updated)
          }
          
          successCount++
          
          // Remove from heldTokens if we sold 100% (sequential pattern always sells 100%)
          const index = heldTokens.findIndex(t => t.mint === randomToken)
          if (index >= 0) heldTokens.splice(index, 1)
        } else {
          // For randomized/accumulate patterns, don't sell yet - just hold the token
          // Token already added to heldTokens above
          console.log(`   ✅ Non-sequential pattern (${pattern}) - holding token, will sell later`)
        }
        
        // Minimal delay before next action
        if (i < tradePlan.length - 1) {
          const interval = config.minIntervalSeconds + 
            Math.random() * (config.maxIntervalSeconds - config.minIntervalSeconds)
          await sleep(interval * 1000)
        }
      } catch (error: any) {
        failedCount++
        console.log(`   ❌ Buy action ${i + 1} failed: ${error.message}`)
        if (i < tradePlan.length - 1) await sleep(10000) // Wait on error
      }
    } else if (action === 'sell' && heldTokens.length > 0) {
      // Sell action - pick a random held token (or last token for accumulate)
      console.log(`   💸 Executing SELL action - ${heldTokens.length} token(s) available to sell`)
      let tokenToSell: { mint: string; balance: number }
      if (pattern === 'accumulate' && i === tradePlan.length - 1) {
        // Last action in accumulate: sell all held tokens
        tokenToSell = heldTokens[Math.floor(Math.random() * heldTokens.length)]
      } else {
        tokenToSell = heldTokens[Math.floor(Math.random() * heldTokens.length)]
      }
      
      const sellPercentage = pattern === 'accumulate' && i === tradePlan.length - 1 ? 100 : (80 + Math.random() * 20)
      
      try {
        console.log(`   [${i + 1}/${tradePlan.length}] 💸 Selling ${sellPercentage.toFixed(1)}% of ${tokenToSell.mint.substring(0, 8)}...`)
        
        // Choose sell strategy based on config
        const closeAccounts = config.closeTokenAccounts !== false; // Default to true (close accounts)
        
        // Track balance before sell to measure costs
        const balanceBeforeSell = await connection.getBalance(walletKp.publicKey)
        const balanceBeforeSellSol = balanceBeforeSell / 1e9
        
        if (closeAccounts && sellPercentage >= 100) {
          // Mode 1: Sell 100% and close account to recover rent (~0.002 SOL per trade)
          console.log(`   💸 Selling 100% and closing account (recovering rent)...`)
          console.log(`   💰 Balance before sell: ${balanceBeforeSellSol.toFixed(6)} SOL`)
          await sellTokenSimple(
            wallet.privateKey,
            tokenToSell.mint,
            100, // Sell 100% so we can close the account
            config.priorityFee,
            true // skipHeliusSender = true (save 0.0002 SOL per tx for wallet warming)
          )
          
          // Wait and close account (reuse existing close logic)
          await sleep(2000)
          const mintPubkey = new PublicKey(tokenToSell.mint)
          const tokenAccounts = await connection.getTokenAccountsByOwner(walletKp.publicKey, {
            mint: mintPubkey,
            programId: TOKEN_PROGRAM_ID
          })
          const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
          const token2022Accounts = await connection.getTokenAccountsByOwner(walletKp.publicKey, {
            mint: mintPubkey,
            programId: TOKEN_2022_PROGRAM_ID
          })
          
          // Try to close empty accounts (reuse existing logic, simplified)
          if (tokenAccounts.value.length > 0 || token2022Accounts.value.length > 0) {
            const allAccounts = [...tokenAccounts.value, ...token2022Accounts.value]
            for (const accountInfo of allAccounts) {
              try {
                const accountInfo_check = await connection.getAccountInfo(accountInfo.pubkey)
                if (accountInfo_check && accountInfo_check.lamports > 0) {
                  const rawData = accountInfo.account.data
                  if (rawData.length >= 72) {
                    const balance = Number(rawData.readBigUInt64LE(64))
                    if (balance === 0) {
                      const ownerBytes = rawData.slice(32, 64)
                      const accountOwner = new PublicKey(ownerBytes)
                      const isToken2022 = accountInfo.account.owner.equals(TOKEN_2022_PROGRAM_ID)
                      const programIdForClose = isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
                      
                      const latestBlockhash = await connection.getLatestBlockhash('confirmed')
                      const closeMsg = new TransactionMessage({
                        payerKey: walletKp.publicKey,
                        recentBlockhash: latestBlockhash.blockhash,
                        instructions: [
                          createCloseAccountInstruction(
                            accountInfo.pubkey,
                            walletKp.publicKey,
                            accountOwner,
                            [],
                            programIdForClose
                          )
                        ]
                      }).compileToV0Message()
                      const closeTx = new VersionedTransaction(closeMsg)
                      closeTx.sign([walletKp])
                      await connection.sendTransaction(closeTx, { skipPreflight: false, maxRetries: 3 })
                      console.log(`   ✅ Closed token account`)
                    }
                  }
                }
              } catch (closeErr) {
                // Ignore close errors for pattern trading
              }
            }
          }
        } else {
          // Mode 2: Sell percentage (99.9% for cheap mode or partial for accumulate)
          await sellTokenSimple(
            wallet.privateKey,
            tokenToSell.mint,
            sellPercentage,
            config.priorityFee,
            true // skipHeliusSender = true (save 0.0002 SOL per tx for wallet warming)
          )
        }
        
        console.log(`   ✅ Sell successful`)
        // Remove from held tokens if we sold 100%
        if (sellPercentage >= 100) {
          const index = heldTokens.findIndex(t => t.mint === tokenToSell.mint)
          if (index >= 0) heldTokens.splice(index, 1)
        }
        
        updateWalletStats(address, false)
        if (onProgress) {
          const updated = loadWarmedWallets().find(w => w.address === address)
          if (updated) onProgress(updated)
        }
        
        successCount++
        
        // Minimal delay before next action
        if (i < tradePlan.length - 1) {
          const interval = config.minIntervalSeconds + 
            Math.random() * (config.maxIntervalSeconds - config.minIntervalSeconds)
          await sleep(interval * 1000)
        }
      } catch (error: any) {
        failedCount++
        console.log(`   ❌ Sell action ${i + 1} failed: ${error.message}`)
        if (i < tradePlan.length - 1) await sleep(10000) // Wait on error
      }
    } else if (action === 'sell' && heldTokens.length === 0) {
      // Can't sell if we have no tokens - skip this sell action or do a buy instead
      console.log(`   ⚠️  Skipping sell action ${i + 1} (no tokens held yet) - executing buy instead`)
      // Replace sell with buy
      const buyAmount = config.minBuyAmount + Math.random() * (config.maxBuyAmount - config.minBuyAmount)
      // Prefer unused tokens, but allow reuse if we've used all available tokens
      const unusedTokens = tokenList.filter(t => !usedTokens.has(t))
      const tokensToTry = unusedTokens.length > 0 ? unusedTokens : tokenList
      let randomToken = tokensToTry[Math.floor(Math.random() * tokensToTry.length)]
      
      try {
        console.log(`   [${i + 1}/${tradePlan.length}] 🛒 Buying ${buyAmount.toFixed(4)} SOL of token ${randomToken.substring(0, 8)}... (replacing sell)`)
        await buyTokenSimple(
          wallet.privateKey,
          randomToken,
          buyAmount,
          undefined,
          config.useJupiter,
          config.priorityFee,
          true
        )
        await sleep(2000)
        const tokenBalance = await getWalletTokenBalance(wallet.privateKey, randomToken)
        if (tokenBalance.hasTokens && tokenBalance.balance > 0) {
          heldTokens.push({ mint: randomToken, balance: tokenBalance.balance })
          usedTokens.add(randomToken) // Mark this token as used
          console.log(`   ✅ Buy successful, token added to held tokens`)
          console.log(`   📝 Used tokens so far: ${usedTokens.size}/${tokenList.length}`)
          successCount++
        }
      } catch (error: any) {
        failedCount++
        console.log(`   ❌ Buy (replacement) failed: ${error.message}`)
      }
    }
  }
  
  // Final sell for accumulate pattern - sell any remaining tokens
  if (pattern === 'accumulate' && heldTokens.length > 0) {
    console.log(`   💸 Final sell: Selling remaining ${heldTokens.length} token(s)...`)
    for (const token of heldTokens) {
      try {
        await sellTokenSimple(wallet.privateKey, token.mint, 100, config.priorityFee, true)
        console.log(`   ✅ Sold ${token.mint.substring(0, 8)}...`)
        successCount++
      } catch (error: any) {
        console.log(`   ❌ Failed to sell ${token.mint.substring(0, 8)}...: ${error.message}`)
        failedCount++
      }
    }
  }
  
  // Update status to ready and mark as recently warmed
  const finalWallets = loadWarmedWallets()
  const finalWalletIndex = finalWallets.findIndex(w => w.address === address)
  if (finalWalletIndex >= 0) {
    finalWallets[finalWalletIndex].status = 'ready'
    finalWallets[finalWalletIndex].lastWarmedAt = new Date().toISOString()
    
    // Add "recently-warmed" tag if not already present
    if (!finalWallets[finalWalletIndex].tags.includes('recently-warmed')) {
      finalWallets[finalWalletIndex].tags.push('recently-warmed')
    }
    
    // Remove "recently-warmed" tag from wallets warmed more than 24 hours ago
    const now = Date.now()
    finalWallets.forEach((w, idx) => {
      if (w.lastWarmedAt) {
        const warmedTime = new Date(w.lastWarmedAt).getTime()
        const hoursSinceWarmed = (now - warmedTime) / (1000 * 60 * 60)
        if (hoursSinceWarmed > 24 && w.tags.includes('recently-warmed')) {
          finalWallets[idx].tags = w.tags.filter(tag => tag !== 'recently-warmed')
        }
      }
    })
    
    saveWarmedWallets(finalWallets)
  }
  
  // Get final balance
  const finalBalance = await connection.getBalance(walletKp.publicKey)
  const finalBalanceSol = finalBalance / 1e9
  
  console.log(`   📊 Completed: ${successCount} successful, ${failedCount} failed`)
  console.log(`   💰 Remaining balance: ${finalBalanceSol.toFixed(6)} SOL`)
  return { success: successCount, failed: failedCount, remainingBalance: finalBalanceSol }
}

// Warm multiple wallets in PARALLEL batches
// SECURITY/ANONYMITY: ALL wallets are funded from main funding wallet ONLY. NO wallet-to-wallet transfers.
export async function warmWallets(
  walletAddresses: string[],
  config: {
    walletsPerBatch: number
    tradesPerWallet: number
    minBuyAmount: number
    maxBuyAmount: number
    minIntervalSeconds: number
    maxIntervalSeconds: number
    priorityFee: 'low' | 'medium' | 'high'
    useJupiter: boolean
    useTrendingTokens: boolean
    tradingPattern?: 'sequential' | 'randomized' | 'accumulate'
    closeTokenAccounts?: boolean
    fundingAmount?: number
    skipFunding?: boolean
  },
  onProgress?: (wallet: WarmedWallet) => void
): Promise<void> {
  const wallets = loadWarmedWallets()
  const walletsToWarm = wallets.filter(w => walletAddresses.includes(w.address))
  
  if (walletsToWarm.length === 0) {
    console.log('❌ No wallets found to warm')
    return
  }
  
  console.log(`\n🔥🔥🔥 PARALLEL WALLET WARMING 🔥🔥🔥`)
  console.log(`📊 Wallets to warm: ${walletsToWarm.length}`)
  console.log(`⚡ Parallel batches: ${config.walletsPerBatch} wallets at a time`)
  console.log(`💰 Funding amount per wallet: ${config.fundingAmount || 0.2} SOL`)
  console.log(`📈 Trades per wallet: ${config.tradesPerWallet}`)
  console.log(`🕵️  ANONYMITY: All wallets funded from main funding wallet ONLY - NO wallet-to-wallet transfers!`)
  
  // Get tokens
  let tokenList: string[] = []
  if (config.useTrendingTokens) {
    const minTokensNeeded = Math.max(100, walletsToWarm.length * 10)
    const tokens = await getCachedTrendingTokens(minTokensNeeded)
    tokenList = tokens.map(t => t.mint)
    console.log(`✅ Fetched ${tokenList.length} tokens from Moralis`)
  }
  
  if (tokenList.length === 0) {
    console.log('❌ No pump.fun tokens available')
    return
  }
  
  const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))
  const FUNDING_AMOUNT = config.fundingAmount || 0.2
  
  // Fund ALL wallets from main funding wallet (NO wallet-to-wallet transfers!)
  console.log(`\n💰 Funding ${walletsToWarm.length} wallet(s) from main funding wallet...`)
  const fundingPromises = walletsToWarm.map(async (wallet) => {
    if (config.skipFunding) {
      // Check if wallet already has enough balance
      const walletKp = Keypair.fromSecretKey(base58.decode(wallet.privateKey))
      const balance = await connection.getBalance(walletKp.publicKey)
      const balanceSol = balance / 1e9
      const estimatedNeeded = (config.maxBuyAmount * 2) * config.tradesPerWallet + 0.1
      if (balanceSol >= estimatedNeeded) {
        console.log(`   ✅ Wallet ${wallet.address.substring(0, 8)}... already has ${balanceSol.toFixed(6)} SOL (sufficient)`)
        return { success: true, wallet: wallet.address }
      }
    }
    
    const walletKp = Keypair.fromSecretKey(base58.decode(wallet.privateKey))
    // autoFundWallet will check balance and skip if wallet already has enough
    const funded = await autoFundWallet(walletKp, FUNDING_AMOUNT)
    if (funded) {
      // Only add delay if we actually funded (not if it was skipped)
      const currentBalance = await connection.getBalance(walletKp.publicKey)
      const currentBalanceSol = currentBalance / 1e9
      if (currentBalanceSol < FUNDING_AMOUNT * 1.1) {
        // We just funded it, wait for settlement
        await sleep(500)
      }
      return { success: true, wallet: wallet.address }
    } else {
      console.log(`   ❌ Failed to fund wallet ${wallet.address.substring(0, 8)}...`)
      return { success: false, wallet: wallet.address }
    }
  })
  
  const fundingResults = await Promise.all(fundingPromises)
  const fundedWallets = fundingResults.filter(r => r.success).map(r => r.wallet)
  const failedWallets = fundingResults.filter(r => !r.success).map(r => r.wallet)
  
  if (failedWallets.length > 0) {
    console.log(`\n⚠️  Failed to fund ${failedWallets.length} wallet(s): ${failedWallets.map(a => a.substring(0, 8)).join(', ')}`)
  }
  
  if (fundedWallets.length === 0) {
    console.log('❌ No wallets were successfully funded')
    return
  }
  
  console.log(`\n✅ Successfully funded ${fundedWallets.length}/${walletsToWarm.length} wallet(s) from main funding wallet`)
  await sleep(2000) // Wait for all funding transactions to settle
  
  // Warm wallets in parallel batches
  const walletsPerBatch = config.walletsPerBatch || 2
  const walletsToWarmFunded = walletsToWarm.filter(w => fundedWallets.includes(w.address))
  
  console.log(`\n🚀 Starting parallel warming: ${walletsToWarmFunded.length} wallet(s) in batches of ${walletsPerBatch}...`)
  
  const results: Array<{ address: string; success: number; failed: number }> = []
  
  // Process wallets in batches to avoid rate limits
  for (let i = 0; i < walletsToWarmFunded.length; i += walletsPerBatch) {
    const batch = walletsToWarmFunded.slice(i, i + walletsPerBatch)
    const batchNumber = Math.floor(i / walletsPerBatch) + 1
    const totalBatches = Math.ceil(walletsToWarmFunded.length / walletsPerBatch)
    
    console.log(`\n${'='.repeat(80)}`)
    console.log(`📦 BATCH ${batchNumber}/${totalBatches}: Warming ${batch.length} wallet(s) in PARALLEL`)
    console.log(`${'='.repeat(80)}`)
    
    // Process batch in parallel
    const batchPromises = batch.map(async (wallet) => {
      const warmConfig = {
        tradesPerWallet: config.tradesPerWallet,
        minBuyAmount: config.minBuyAmount,
        maxBuyAmount: config.maxBuyAmount,
        minIntervalSeconds: config.minIntervalSeconds,
        maxIntervalSeconds: config.maxIntervalSeconds,
        priorityFee: config.priorityFee,
        useJupiter: config.useJupiter,
        closeTokenAccounts: config.closeTokenAccounts,
        tradingPattern: config.tradingPattern || 'sequential'
      }
      
      try {
        const result = await warmWallet(wallet, warmConfig, tokenList, onProgress)
        return { 
          address: wallet.address, 
          success: result.success, 
          failed: result.failed 
        }
      } catch (error: any) {
        console.error(`   ❌ Failed to warm wallet ${wallet.address.substring(0, 8)}...: ${error.message}`)
        return { 
          address: wallet.address, 
          success: 0, 
          failed: config.tradesPerWallet 
        }
      }
    })
    
    const batchResults = await Promise.all(batchPromises)
    results.push(...batchResults)
    
    // Wait between batches to avoid rate limits (unless it's the last batch)
    if (i + walletsPerBatch < walletsToWarmFunded.length) {
      console.log(`\n⏸️  Waiting 10s before next batch...`)
      await sleep(10000)
    }
  }
  
  // Summary
  const totalSuccess = results.reduce((sum, r) => sum + r.success, 0)
  const totalFailed = results.reduce((sum, r) => sum + r.failed, 0)
  
  console.log(`\n${'='.repeat(80)}`)
  console.log(`✅ PARALLEL WARMING COMPLETED FOR ${walletsToWarmFunded.length} WALLET(S)`)
  console.log(`📊 Total successful trades: ${totalSuccess}`)
  console.log(`📊 Total failed trades: ${totalFailed}`)
  console.log(`🕵️  ANONYMITY: All wallets funded from main wallet only - NO wallet-to-wallet links!`)
  console.log(`${'='.repeat(80)}\n`)
}

// Delete wallet
export function deleteWarmingWallet(address: string): boolean {
  const wallets = loadWarmedWallets()
  const filtered = wallets.filter(w => w.address !== address)
  
  if (filtered.length === wallets.length) {
    return false // Wallet not found
  }
  
  saveWarmedWallets(filtered)
  return true
}

// Fetch transaction history from blockchain for a wallet
export async function fetchWalletTransactionHistory(address: string): Promise<{
  transactionCount: number
  firstTransactionDate: string | null
  lastTransactionDate: string | null
  totalTrades: number
  tradesLast7Days: number
}> {
  try {
    const pubkey = new PublicKey(address)
    
    // Get transaction signatures (up to 1000 most recent)
    const signatures = await connection.getSignaturesForAddress(pubkey, { limit: 1000 })
    
    if (signatures.length === 0) {
      return {
        transactionCount: 0,
        firstTransactionDate: null,
        lastTransactionDate: null,
        totalTrades: 0,
        tradesLast7Days: 0
      }
    }
    
    // Sort by block time (oldest first)
    const sorted = signatures
      .filter(sig => sig.blockTime !== null)
      .sort((a, b) => (a.blockTime || 0) - (b.blockTime || 0))
    
    const firstTx = sorted[0]
    const lastTx = signatures[0] // Most recent is first in array
    
    // Count transactions (each signature = 1 transaction)
    const transactionCount = signatures.length
    
    // Count trades more accurately by filtering successful transactions
    // Failed transactions (simulation failures, etc.) shouldn't count as trades
    // Successful transactions are more likely to be actual token swaps
    const successfulTxs = signatures.filter(sig => sig.err === null)
    
    // Estimate trades: successful transactions / 2
    // Each trade typically = buy + sell = 2 transactions
    // This is more accurate than counting all transactions (including failures)
    const totalTrades = Math.floor(successfulTxs.length / 2)
    
    // Calculate trades in last 7 days
    const now = Date.now() / 1000
    const sevenDaysAgo = now - (7 * 24 * 60 * 60)
    const transactionsLast7Days = successfulTxs.filter(sig => {
      if (!sig.blockTime) return false
      return sig.blockTime >= sevenDaysAgo
    })
    
    const tradesLast7Days = Math.floor(transactionsLast7Days.length / 2)
    
    return {
      transactionCount,
      firstTransactionDate: firstTx?.blockTime ? new Date(firstTx.blockTime * 1000).toISOString() : null,
      lastTransactionDate: lastTx?.blockTime ? new Date(lastTx.blockTime * 1000).toISOString() : null,
      totalTrades,
      tradesLast7Days
    }
  } catch (error: any) {
    console.error(`[Wallet Manager] Error fetching transaction history for ${address}:`, error.message)
    throw error
  }
}

// Update wallet stats from blockchain (only when user requests)
export async function updateWalletStatsFromBlockchain(address: string): Promise<WarmedWallet | null> {
  try {
    console.log(`[Wallet Manager] Fetching blockchain data for ${address}...`)
    const history = await fetchWalletTransactionHistory(address)
    
    const wallets = loadWarmedWallets()
    const walletIndex = wallets.findIndex(w => w.address === address)
    
    if (walletIndex < 0) {
      console.log(`[Wallet Manager] Wallet not found: ${address}`)
      return null
    }
    
    const wallet = wallets[walletIndex]
    
    // Update stats (preserve existing if blockchain data is missing)
    wallet.transactionCount = history.transactionCount || wallet.transactionCount
    wallet.totalTrades = history.totalTrades || wallet.totalTrades
    wallet.tradesLast7Days = history.tradesLast7Days !== undefined ? history.tradesLast7Days : wallet.tradesLast7Days
    
    // Only update dates if we got them from blockchain and they're more accurate
    if (history.firstTransactionDate) {
      if (!wallet.firstTransactionDate || 
          new Date(history.firstTransactionDate) < new Date(wallet.firstTransactionDate)) {
        wallet.firstTransactionDate = history.firstTransactionDate
      }
    }
    
    if (history.lastTransactionDate) {
      if (!wallet.lastTransactionDate || 
          new Date(history.lastTransactionDate) > new Date(wallet.lastTransactionDate)) {
        wallet.lastTransactionDate = history.lastTransactionDate
      }
    }
    
    saveWarmedWallets(wallets)
    console.log(`[Wallet Manager] Updated wallet ${address}: ${history.transactionCount} transactions, ${history.totalTrades} trades`)
    
    return wallet
  } catch (error: any) {
    console.error(`[Wallet Manager] Error updating wallet stats:`, error.message)
    throw error
  }
}

// Update multiple wallets from blockchain
export async function updateMultipleWalletsFromBlockchain(addresses: string[]): Promise<{
  updated: number
  failed: number
  errors: string[]
}> {
  let updated = 0
  let failed = 0
  const errors: string[] = []
  
  for (const address of addresses) {
    try {
      await updateWalletStatsFromBlockchain(address)
      updated++
      // Small delay to avoid rate limiting
      await sleep(500)
    } catch (error: any) {
      failed++
      errors.push(`${address}: ${error.message}`)
      console.error(`[Wallet Manager] Failed to update ${address}:`, error.message)
    }
  }
  
  return { updated, failed, errors }
}

// Update SOL balance for a wallet
export async function updateWalletBalance(address: string): Promise<number> {
  try {
    const pubkey = new PublicKey(address)
    const balance = await connection.getBalance(pubkey)
    const balanceSol = balance / 1e9
    
    const wallets = loadWarmedWallets()
    const walletIndex = wallets.findIndex(w => w.address === address)
    
    if (walletIndex >= 0) {
      wallets[walletIndex].solBalance = balanceSol
      wallets[walletIndex].lastBalanceUpdate = new Date().toISOString()
      saveWarmedWallets(wallets)
    }
    
    return balanceSol
  } catch (error: any) {
    console.error(`[Wallet Manager] Error fetching balance for ${address}:`, error.message)
    throw error
  }
}

// Update SOL balances for multiple wallets
export async function updateMultipleWalletBalances(addresses: string[]): Promise<{
  updated: number
  failed: number
  errors: string[]
  totalSol: number
}> {
  let updated = 0
  let failed = 0
  const errors: string[] = []
  let totalSol = 0
  
  for (const address of addresses) {
    try {
      const balance = await updateWalletBalance(address)
      totalSol += balance
      updated++
      // Small delay to avoid rate limiting
      await sleep(200)
    } catch (error: any) {
      failed++
      errors.push(`${address}: ${error.message}`)
      console.error(`[Wallet Manager] Failed to update balance for ${address}:`, error.message)
    }
  }
  
  return { updated, failed, errors, totalSol }
}

// Gather SOL from wallets back to main wallet
export async function gatherSolFromWallets(addresses: string[]): Promise<{
  gathered: number
  failed: number
  errors: string[]
  totalSolGathered: number
}> {
  try {
    const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))
    let gathered = 0
    let failed = 0
    const errors: string[] = []
    let totalSolGathered = 0
    
    for (const address of addresses) {
      try {
        const wallets = loadWarmedWallets()
        const wallet = wallets.find(w => w.address === address)
        
        if (!wallet) {
          failed++
          errors.push(`${address}: Wallet not found`)
          continue
        }
        
        const walletKp = Keypair.fromSecretKey(base58.decode(wallet.privateKey))
        const balance = await connection.getBalance(walletKp.publicKey)
        const balanceSol = balance / 1e9
        
        // Keep 0.001 SOL for rent exemption
        const rentExemption = 0.001
        const amountToTransfer = balanceSol - rentExemption
        
        if (amountToTransfer <= 0) {
          console.log(`   ⚠️  ${address}: Insufficient balance (${balanceSol.toFixed(6)} SOL)`)
          continue
        }
        
        console.log(`   💰 Gathering ${amountToTransfer.toFixed(6)} SOL from ${address.substring(0, 8)}...`)
        
        const latestBlockhash = await connection.getLatestBlockhash()
        const transferMsg = new TransactionMessage({
          payerKey: walletKp.publicKey,
          recentBlockhash: latestBlockhash.blockhash,
          instructions: [
            SystemProgram.transfer({
              fromPubkey: walletKp.publicKey,
              toPubkey: mainKp.publicKey,
              lamports: Math.floor(amountToTransfer * 1e9)
            })
          ]
        }).compileToV0Message()
        
        const transferTx = new VersionedTransaction(transferMsg)
        transferTx.sign([walletKp])
        
        const sig = await connection.sendTransaction(transferTx, { skipPreflight: false, maxRetries: 3 })
        await connection.confirmTransaction(sig, 'confirmed')
        
        totalSolGathered += amountToTransfer
        gathered++
        
        // Update balance in wallet record
        const walletIndex = wallets.findIndex(w => w.address === address)
        if (walletIndex >= 0) {
          wallets[walletIndex].solBalance = rentExemption
          wallets[walletIndex].lastBalanceUpdate = new Date().toISOString()
          saveWarmedWallets(wallets)
        }
        
        console.log(`   ✅ Gathered ${amountToTransfer.toFixed(6)} SOL. Tx: https://solscan.io/tx/${sig}`)
        
        // Small delay between transfers
        await sleep(1000)
      } catch (error: any) {
        failed++
        errors.push(`${address}: ${error.message}`)
        console.error(`[Wallet Manager] Failed to gather from ${address}:`, error.message)
      }
    }
    
    return { gathered, failed, errors, totalSolGathered }
  } catch (error: any) {
    console.error('[Wallet Manager] Error gathering SOL:', error.message)
    throw error
  }
}

