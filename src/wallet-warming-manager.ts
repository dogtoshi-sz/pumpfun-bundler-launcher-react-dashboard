// Simple wallet warming manager
// Tracks wallets, auto-funds them, and records transaction history

import { Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js"
import base58 from "bs58"
import fs from "fs"
import path from "path"
import { buyTokenSimple, sellTokenSimple, getWalletTokenBalance } from "../trading-terminal"
import { RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, PRIVATE_KEY } from "../constants"
import { sleep } from "../utils"
import { getCachedTrendingTokens } from "./fetch-trending-tokens"

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
export function loadWarmedWallets(): WarmedWallet[] {
  try {
    console.log(`[Wallet Manager] Loading wallets from: ${WARMED_WALLETS_FILE}`)
    console.log(`[Wallet Manager] File exists: ${fs.existsSync(WARMED_WALLETS_FILE)}`)
    
    if (fs.existsSync(WARMED_WALLETS_FILE)) {
      const content = fs.readFileSync(WARMED_WALLETS_FILE, 'utf8')
      const data = JSON.parse(content)
      const wallets = data.wallets || []
      console.log(`[Wallet Manager] Loaded ${wallets.length} wallets from file`)
      return wallets
    } else {
      console.log(`[Wallet Manager] File does not exist: ${WARMED_WALLETS_FILE}`)
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
  const kp = Keypair.fromSecretKey(base58.decode(privateKey))
  const address = kp.publicKey.toBase58()
  
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
    privateKey,
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
  
  // Check balance (wallet should already be funded via chained transfer)
  const balance = await connection.getBalance(walletKp.publicKey)
  const balanceSol = balance / 1e9
  console.log(`   💰 Current balance: ${balanceSol.toFixed(6)} SOL`)
  
  for (let i = 0; i < config.tradesPerWallet; i++) {
    if (tokenList.length === 0) {
      console.log(`   ⚠️  No tokens available`)
      break
    }
    
    const buyAmount = config.minBuyAmount + Math.random() * (config.maxBuyAmount - config.minBuyAmount)
    
    // Try up to 20 different tokens if Jupiter fails (token might be dead/rugged)
    // Jupiter CAN trade pump.fun tokens via bonding curve - issue is dead/no-volume tokens
    let buySuccess = false
    let randomToken = ''
    const maxTokenRetries = 20
    
    // Use all tokens - the fetch already filtered for volume/liquidity
    const tokensToTry = tokenList
    
    for (let tokenAttempt = 0; tokenAttempt < maxTokenRetries && !buySuccess; tokenAttempt++) {
      randomToken = tokensToTry[Math.floor(Math.random() * tokensToTry.length)]
      
      try {
        // Buy
        console.log(`   [${i + 1}/${config.tradesPerWallet}] Buying ${buyAmount.toFixed(4)} SOL of ${randomToken.substring(0, 8)}...${tokenAttempt > 0 ? ` (token retry ${tokenAttempt + 1})` : ''}`)
        await buyTokenSimple(
          wallet.privateKey,
          randomToken,
          buyAmount,
          undefined,
          config.useJupiter,
          config.priorityFee
        )
        buySuccess = true
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
      console.log(`   ⚠️  Skipping trade ${i + 1} - no tradable token found after ${maxTokenRetries} attempts`)
      failedCount++
      continue // Continue to next trade instead of crashing
    }
    
    try {
      // Buy succeeded, continue with the rest of the trade logic
      
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
      
      while (!tokensReady && retries < maxRetries) {
        const tokenBalance = await getWalletTokenBalance(wallet.privateKey, randomToken)
        if (tokenBalance.hasTokens && tokenBalance.balance > 0) {
          tokensReady = true
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
      
      // Sell 99.9% to maximize SOL recovery while keeping tiny token dust
      console.log(`   💸 Selling 99.9% (keeping 0.1% token dust)...`)
      await sellTokenSimple(
        wallet.privateKey,
        randomToken,
        99.9,
        config.priorityFee
      )
      
      updateWalletStats(address, false)
      if (onProgress) {
        const updated = loadWarmedWallets().find(w => w.address === address)
        if (updated) onProgress(updated)
      }
      
      successCount++
      
      // Minimal delay before next trade (0.2 seconds for speed)
      if (i < config.tradesPerWallet - 1) {
        await sleep(200)
      }
    } catch (error: any) {
      failedCount++
      console.log(`   ❌ Trade ${i + 1} failed: ${error.message}`)
      await sleep(10000) // Wait on error
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

// Warm multiple wallets (CHAINED: Wallet 1 -> Wallet 2 -> Wallet 3 -> Funding Wallet)
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
  },
  onProgress?: (wallet: WarmedWallet) => void
): Promise<void> {
  const wallets = loadWarmedWallets()
  const walletsToWarm = wallets.filter(w => walletAddresses.includes(w.address))
  
  if (walletsToWarm.length === 0) {
    console.log('❌ No wallets found to warm')
    return
  }
  
  console.log(`\n🔥🔥🔥 CHAINED WALLET WARMING 🔥🔥🔥`)
  console.log(`📊 Wallets to warm: ${walletsToWarm.length}`)
  console.log(`💰 Funding amount per wallet: 0.2 SOL`)
  console.log(`📈 Trades per wallet: ${config.tradesPerWallet}`)
  
  // Get tokens
  let tokenList: string[] = []
  if (config.useTrendingTokens) {
    const minTokensNeeded = Math.max(100, walletsToWarm.length * 10)
    const tokens = await getCachedTrendingTokens(minTokensNeeded)
    tokenList = tokens.map(t => t.mint)
    console.log(`✅ Fetched ${tokenList.length} tokens from Moralis`)
  }
  
  if (tokenList.length === 0) {
    console.log('❌ No tokens available')
    return
  }
  
  const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))
  const FUNDING_AMOUNT = 0.2 // 0.2 SOL per wallet
  
  // Process wallets sequentially (chained)
  for (let i = 0; i < walletsToWarm.length; i++) {
    const wallet = walletsToWarm[i]
    const walletKp = Keypair.fromSecretKey(base58.decode(wallet.privateKey))
    
    console.log(`\n${'='.repeat(80)}`)
    console.log(`🔥 WALLET ${i + 1}/${walletsToWarm.length}: ${wallet.address.substring(0, 8)}...${wallet.address.substring(wallet.address.length - 8)}`)
    console.log(`${'='.repeat(80)}`)
    
    // Fund wallet (first wallet gets from funding wallet, others get from previous wallet)
    if (i === 0) {
      // First wallet: fund from main wallet
      console.log(`\n💰 Funding wallet ${i + 1} with ${FUNDING_AMOUNT} SOL from funding wallet...`)
      const funded = await autoFundWallet(walletKp, FUNDING_AMOUNT)
      if (!funded) {
        console.log(`   ⚠️  Failed to fund wallet ${i + 1}, skipping`)
        continue
      }
      await sleep(1000) // Wait for funding to settle
    } else {
      // Subsequent wallets: get SOL from previous wallet
      const prevWallet = walletsToWarm[i - 1]
      const prevWalletKp = Keypair.fromSecretKey(base58.decode(prevWallet.privateKey))
      
      console.log(`\n💰 Transferring ${FUNDING_AMOUNT} SOL from wallet ${i} to wallet ${i + 1}...`)
      try {
        // Check if previous wallet has enough
        const prevBalance = await connection.getBalance(prevWalletKp.publicKey)
        const prevBalanceSol = prevBalance / 1e9
        
        if (prevBalanceSol < FUNDING_AMOUNT) {
          console.log(`   ⚠️  Previous wallet has insufficient balance (${prevBalanceSol.toFixed(6)} SOL), using available amount`)
          // Transfer what's available (minus miniscule amount)
          await transferSol(prevWalletKp, wallet.address, prevBalanceSol, true)
        } else {
          // Transfer exactly 0.2 SOL
          await transferSol(prevWalletKp, wallet.address, FUNDING_AMOUNT, false)
        }
        await sleep(1000) // Wait for transfer to settle
      } catch (error: any) {
        console.log(`   ❌ Failed to transfer from wallet ${i} to wallet ${i + 1}: ${error.message}`)
        console.log(`   ⚠️  Skipping wallet ${i + 1}`)
        continue
      }
    }
    
    // Warm this wallet
    const warmConfig = {
      tradesPerWallet: config.tradesPerWallet,
      minBuyAmount: config.minBuyAmount,
      maxBuyAmount: config.maxBuyAmount,
      minIntervalSeconds: config.minIntervalSeconds,
      maxIntervalSeconds: config.maxIntervalSeconds,
      priorityFee: config.priorityFee,
      useJupiter: config.useJupiter
    }
    
    const result = await warmWallet(wallet, warmConfig, tokenList, onProgress)
    
    // Transfer remaining SOL to next wallet (or back to funding wallet if last)
    if (i < walletsToWarm.length - 1) {
      // Not last wallet: transfer to next wallet
      const nextWallet = walletsToWarm[i + 1]
      console.log(`\n💸 Transferring remaining SOL to wallet ${i + 2}...`)
      try {
        await transferSol(walletKp, nextWallet.address, result.remainingBalance, true)
        await sleep(1000)
      } catch (error: any) {
        console.log(`   ⚠️  Failed to transfer to next wallet: ${error.message}`)
      }
    } else {
      // Last wallet: transfer back to funding wallet
      console.log(`\n💸 Transferring remaining SOL back to funding wallet...`)
      try {
        await transferSol(walletKp, mainKp.publicKey.toBase58(), result.remainingBalance, true)
        await sleep(1000)
      } catch (error: any) {
        console.log(`   ⚠️  Failed to transfer back to funding wallet: ${error.message}`)
      }
    }
  }
  
  console.log(`\n${'='.repeat(80)}`)
  console.log(`✅ CHAINED WARMING COMPLETED FOR ${walletsToWarm.length} WALLET(S)`)
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
    
    // Estimate trades: look for token transfers (buy/sell pairs)
    // This is an approximation - we count transactions that involve token programs
    // A more accurate method would parse each transaction, but that's expensive
    // For now, we'll estimate: transactions / 2 = trades (since each trade = buy + sell)
    const totalTrades = Math.floor(transactionCount / 2)
    
    // Calculate trades in last 7 days (from exact point in time)
    const now = Date.now() / 1000 // Current time in seconds
    const sevenDaysAgo = now - (7 * 24 * 60 * 60) // 7 days ago in seconds
    
    // Filter transactions from last 7 days
    const transactionsLast7Days = signatures.filter(sig => {
      if (!sig.blockTime) return false
      return sig.blockTime >= sevenDaysAgo
    })
    
    // Estimate trades in last 7 days (transactions / 2)
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

