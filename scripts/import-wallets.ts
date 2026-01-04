// Import wallets from various sources with tags
import fs from "fs"
import path from "path"
import { Keypair } from "@solana/web3.js"
import base58 from "bs58"

const WARMED_WALLETS_FILE = path.join(process.cwd(), 'keys', 'warmed-wallets.json')

interface WarmedWallet {
  privateKey: string
  address: string
  transactionCount: number
  firstTransactionDate: string | null
  lastTransactionDate: string | null
  totalTrades: number
  createdAt: string
  status: 'idle' | 'warming' | 'ready'
  tags: string[]
}

function loadWarmedWallets(): WarmedWallet[] {
  try {
    if (fs.existsSync(WARMED_WALLETS_FILE)) {
      const data = JSON.parse(fs.readFileSync(WARMED_WALLETS_FILE, 'utf8'))
      return data.wallets || []
    }
  } catch (error) {
    console.error('Error loading warmed wallets:', error)
  }
  return []
}

function saveWarmedWallets(wallets: WarmedWallet[]): void {
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

function addWarmingWallet(privateKey: string, tags: string[] = []): WarmedWallet | null {
  try {
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
  } catch (error: any) {
    console.error(`Failed to add wallet: ${error.message}`)
    return null
  }
}

// Parse phantom wallets file
function parsePhantomWallets(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split('\n')
  const privateKeys: string[] = []
  
  // Skip header line (line 2)
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    
    // Split by | and get Full Keypair column (usually column 4, but let's find it)
    const parts = line.split('|').map(p => p.trim())
    // Find the longest part that looks like a private key (base58, 80+ chars)
    for (const part of parts) {
      if (part && part.length >= 80 && part.length <= 100) {
        // Check if it's base58-like (alphanumeric, no special chars except maybe some)
        if (/^[A-Za-z0-9]+$/.test(part)) {
          privateKeys.push(part)
          break // Found it, move to next line
        }
      }
    }
  }
  
  return privateKeys
}

// Randomly select wallets from array
function randomSelect<T>(array: T[], count: number): T[] {
  const shuffled = [...array].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, Math.min(count, shuffled.length))
}

async function importWallets() {
  console.log('📥 Importing wallets...\n')
  
  // 1. Import OLD wallets from phantom file
  const phantomPath = path.join(process.cwd(), 'keys', 'OLD-KEYS', 'phantom_wallets_summary_NEW.txt')
  if (fs.existsSync(phantomPath)) {
    console.log('📂 Reading OLD wallets from phantom_wallets_summary_NEW.txt...')
    const oldPrivateKeys = parsePhantomWallets(phantomPath)
    console.log(`   Found ${oldPrivateKeys.length} wallets`)
    
    let added = 0
    for (const privateKey of oldPrivateKeys) {
      const result = addWarmingWallet(privateKey, ['OLD'])
      if (result) added++
    }
    console.log(`   ✅ Added ${added} OLD wallets\n`)
  } else {
    console.log('   ⚠️  phantom_wallets_summary_NEW.txt not found\n')
  }
  
  // 2. Import RECENT wallets from data-history files (randomly select 10-20)
  const history1Path = path.join(process.cwd(), 'keys', 'data-history1.json')
  const history2Path = path.join(process.cwd(), 'keys', 'data-history2.json')
  
  const recentWallets: string[] = []
  
  if (fs.existsSync(history1Path)) {
    console.log('📂 Reading data-history1.json...')
    const history1 = JSON.parse(fs.readFileSync(history1Path, 'utf8'))
    if (Array.isArray(history1)) {
      recentWallets.push(...history1)
      console.log(`   Found ${history1.length} wallets`)
    }
  }
  
  if (fs.existsSync(history2Path)) {
    console.log('📂 Reading data-history2.json...')
    const history2 = JSON.parse(fs.readFileSync(history2Path, 'utf8'))
    if (Array.isArray(history2)) {
      recentWallets.push(...history2)
      console.log(`   Found ${history2.length} wallets`)
    }
  }
  
  // Remove duplicates
  const uniqueRecent = [...new Set(recentWallets)]
  console.log(`   Total unique wallets: ${uniqueRecent.length}`)
  
  // Randomly select 10-20 wallets
  const selectCount = Math.min(20, Math.max(10, Math.floor(uniqueRecent.length * 0.1)))
  const selectedWallets = randomSelect(uniqueRecent, selectCount)
  
  console.log(`\n🎲 Randomly selected ${selectedWallets.length} wallets for "recent" tag`)
  
  let added = 0
  for (const privateKey of selectedWallets) {
    const result = addWarmingWallet(privateKey, ['recent'])
    if (result) added++
  }
  console.log(`   ✅ Added ${added} RECENT wallets\n`)
  
  console.log('✅ Import complete!')
}

importWallets().catch(console.error)
