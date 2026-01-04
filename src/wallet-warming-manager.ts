// Simple wallet warming manager
// Tracks wallets, auto-funds them, and records transaction history

import { Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js"
import base58 from "bs58"
import fs from "fs"
import path from "path"
import { buyTokenSimple, sellTokenSimple } from "../trading-terminal"
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
  createdAt: string // When wallet was added
  status: 'idle' | 'warming' | 'ready' // Current status
  tags: string[] // Tags like "OLD", "recent", etc.
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

// Auto-fund wallet if needed
async function autoFundWallet(walletKp: Keypair, requiredSol: number): Promise<boolean> {
  try {
    const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))
    const balance = await connection.getBalance(walletKp.publicKey)
    const balanceSol = balance / 1e9
    
    if (balanceSol >= requiredSol) {
      return true // Already has enough
    }
    
    const needed = requiredSol - balanceSol + 0.01 // Add small buffer
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
    
    const sig = await connection.sendTransaction(transferTx, { skipPreflight: false, maxRetries: 3 })
    await connection.confirmTransaction(sig, 'confirmed')
    
    console.log(`   ✅ Auto-funded: https://solscan.io/tx/${sig}`)
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
): Promise<{ success: number; failed: number }> {
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
  
  // Calculate required SOL and auto-fund if needed
  const estimatedRequired = (config.maxBuyAmount * 2) * config.tradesPerWallet + 0.1
  const funded = await autoFundWallet(walletKp, estimatedRequired)
  
  if (!funded) {
    console.log(`   ⚠️  Failed to fund wallet, skipping`)
    if (walletIndex >= 0) {
      wallets[walletIndex].status = 'idle'
      saveWarmedWallets(wallets)
    }
    return { success: 0, failed: 0 }
  }
  
  // Wait a bit for funding to settle
  await sleep(2000)
  
  for (let i = 0; i < config.tradesPerWallet; i++) {
    if (tokenList.length === 0) {
      console.log(`   ⚠️  No tokens available`)
      break
    }
    
    const randomToken = tokenList[Math.floor(Math.random() * tokenList.length)]
    const buyAmount = config.minBuyAmount + Math.random() * (config.maxBuyAmount - config.minBuyAmount)
    
    try {
      // Buy
      console.log(`   [${i + 1}/${config.tradesPerWallet}] Buying ${buyAmount.toFixed(4)} SOL of ${randomToken.substring(0, 8)}...`)
      await buyTokenSimple(
        wallet.privateKey,
        randomToken,
        buyAmount,
        undefined,
        config.useJupiter,
        config.priorityFee
      )
      
      updateWalletStats(address, i === 0 && isFirstTransaction)
      if (onProgress) {
        const updated = loadWarmedWallets().find(w => w.address === address)
        if (updated) onProgress(updated)
      }
      
      // Wait before selling
      const sellDelay = 5 + Math.random() * 25
      await sleep(sellDelay * 1000)
      
      // Sell (keep 1-5% to make wallet look active)
      const keepPercentage = 1 + Math.random() * 4 // Keep 1-5% of tokens
      const sellPercentage = 100 - keepPercentage
      console.log(`   💸 Selling ${sellPercentage.toFixed(1)}% (keeping ${keepPercentage.toFixed(1)}% for activity)...`)
      await sellTokenSimple(
        wallet.privateKey,
        randomToken,
        sellPercentage,
        config.priorityFee
      )
      
      updateWalletStats(address, false)
      if (onProgress) {
        const updated = loadWarmedWallets().find(w => w.address === address)
        if (updated) onProgress(updated)
      }
      
      successCount++
      
      // Random interval before next trade
      if (i < config.tradesPerWallet - 1) {
        const interval = config.minIntervalSeconds + Math.random() * (config.maxIntervalSeconds - config.minIntervalSeconds)
        await sleep(interval * 1000)
      }
    } catch (error: any) {
      failedCount++
      console.log(`   ❌ Trade ${i + 1} failed: ${error.message}`)
      await sleep(10000) // Wait on error
    }
  }
  
  // Update status to ready
  const finalWallets = loadWarmedWallets()
  const finalWalletIndex = finalWallets.findIndex(w => w.address === address)
  if (finalWalletIndex >= 0) {
    finalWallets[finalWalletIndex].status = 'ready'
    saveWarmedWallets(finalWallets)
  }
  
  console.log(`   📊 Completed: ${successCount} successful, ${failedCount} failed`)
  return { success: successCount, failed: failedCount }
}

// Warm multiple wallets
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
  
  // Process in batches
  for (let i = 0; i < walletsToWarm.length; i += config.walletsPerBatch) {
    const batch = walletsToWarm.slice(i, i + config.walletsPerBatch)
    console.log(`\n📦 Processing batch ${Math.floor(i / config.walletsPerBatch) + 1}/${Math.ceil(walletsToWarm.length / config.walletsPerBatch)}`)
    
    await Promise.all(
      batch.map(wallet => 
        warmWallet(wallet, config, tokenList, onProgress)
      )
    )
    
    if (i + config.walletsPerBatch < walletsToWarm.length) {
      await sleep(10000) // Wait between batches
    }
  }
  
  console.log(`\n✅ Warming completed for ${walletsToWarm.length} wallet(s)`)
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

