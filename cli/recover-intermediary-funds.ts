import base58 from "bs58"
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import dotenv from 'dotenv'
dotenv.config({ path: join(__dirname, '..', '.env') })

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { PRIVATE_KEY, RPC_ENDPOINT } from '../constants'

const connection = new Connection(RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com', 'confirmed')

if (!PRIVATE_KEY) {
  console.error("PRIVATE_KEY is not set in .env file")
  process.exit(1)
}
const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))

interface IntermediaryWallet {
  publicKey: string
  privateKey: string
}

interface IntermediaryWallets {
  hop1?: IntermediaryWallet[]
  hop2?: IntermediaryWallet[]
  hop3?: IntermediaryWallet[]
  [key: string]: any
}

interface ArchivedRun {
  bundleWalletKeys?: string[]
  holderWalletKeys?: string[]
  creatorDevWalletKey?: string
  walletKeys?: string[]
  launchStatus?: string
  mintAddress?: string
}

const KEYS_DIR = join(__dirname, '..', 'keys')
const INTERMEDIARY_JSON = join(KEYS_DIR, 'intermediary-wallets.json')
const ARCHIVE_TXT = join(KEYS_DIR, 'archive.txt')
const CURRENT_RUN_JSON = join(KEYS_DIR, 'current-run.json')

function loadIntermediaryFromJson(): Array<{ label: string; kp: Keypair }> {
  if (!existsSync(INTERMEDIARY_JSON)) return []
  try {
    const data = JSON.parse(readFileSync(INTERMEDIARY_JSON, 'utf-8')) as IntermediaryWallets
    const out: Array<{ label: string; kp: Keypair }> = []
    for (const [hop, wallets] of Object.entries(data)) {
      if (hop === 'createdAt' || hop === 'lastUsed' || !Array.isArray(wallets)) continue
      wallets.forEach((w, i) => {
        try { out.push({ label: `json.${hop}[${i}]`, kp: Keypair.fromSecretKey(base58.decode(w.privateKey)) }) } catch {}
      })
    }
    return out
  } catch { return [] }
}

function parseJsonBlock(content: string, startIdx: number): { json: any; endIdx: number } | null {
  const braceStart = content.indexOf('{', startIdx)
  if (braceStart === -1) return null
  let depth = 0, endIdx = -1
  for (let i = braceStart; i < content.length; i++) {
    if (content[i] === '{') depth++
    else if (content[i] === '}') { depth--; if (depth === 0) { endIdx = i + 1; break } }
  }
  if (endIdx === -1) return null
  try { return { json: JSON.parse(content.slice(braceStart, endIdx)), endIdx } } catch { return null }
}

function loadFromArchive(): {
  intermediaries: Array<{ label: string; kp: Keypair }>,
  runWallets: Array<{ label: string; kp: Keypair }>
} {
  const intermediaries: Array<{ label: string; kp: Keypair }> = []
  const runWallets: Array<{ label: string; kp: Keypair }> = []

  if (!existsSync(ARCHIVE_TXT)) return { intermediaries, runWallets }
  const content = readFileSync(ARCHIVE_TXT, 'utf8')

  let idx = 0
  let sectionNum = 0
  while (true) {
    const intMarker = content.indexOf('========== INTERMEDIARY WALLETS', idx)
    const runMarker = content.indexOf('========== current-run-backup', idx)

    const nextIdx = [intMarker, runMarker].filter(i => i >= 0)
    if (nextIdx.length === 0) break
    const minIdx = Math.min(...nextIdx)

    if (minIdx === intMarker && intMarker >= 0) {
      sectionNum++
      const parsed = parseJsonBlock(content, intMarker + 30)
      if (parsed) {
        const data = parsed.json as IntermediaryWallets
        for (const [hop, wallets] of Object.entries(data)) {
          if (hop === 'createdAt' || hop === 'lastUsed' || !Array.isArray(wallets)) continue
          wallets.forEach((w: IntermediaryWallet, i: number) => {
            try { intermediaries.push({ label: `archive#${sectionNum}.${hop}[${i}]`, kp: Keypair.fromSecretKey(base58.decode(w.privateKey)) }) } catch {}
          })
        }
        idx = parsed.endIdx
      } else {
        idx = intMarker + 1
      }
    } else if (minIdx === runMarker && runMarker >= 0) {
      const parsed = parseJsonBlock(content, runMarker + 30)
      if (parsed) {
        const run = parsed.json as ArchivedRun
        const keys: string[] = []
        if (run.bundleWalletKeys) keys.push(...run.bundleWalletKeys)
        if (run.holderWalletKeys) keys.push(...run.holderWalletKeys)
        if (run.creatorDevWalletKey) keys.push(run.creatorDevWalletKey)
        if (keys.length === 0 && run.walletKeys) keys.push(...run.walletKeys)
        for (const k of keys) {
          try { runWallets.push({ label: `archive-run(${run.mintAddress?.slice(0, 8) || '?'})`, kp: Keypair.fromSecretKey(base58.decode(k)) }) } catch {}
        }
        idx = parsed.endIdx
      } else {
        idx = runMarker + 1
      }
    } else {
      break
    }
  }

  return { intermediaries, runWallets }
}

function loadCurrentRunWallets(): Array<{ label: string; kp: Keypair }> {
  if (!existsSync(CURRENT_RUN_JSON)) return []
  try {
    const data = JSON.parse(readFileSync(CURRENT_RUN_JSON, 'utf-8'))
    const out: Array<{ label: string; kp: Keypair }> = []
    const keys: string[] = []
    if (data.bundleWalletKeys) keys.push(...data.bundleWalletKeys)
    if (data.holderWalletKeys) keys.push(...data.holderWalletKeys)
    if (data.creatorDevWalletKey) keys.push(data.creatorDevWalletKey)
    if (keys.length === 0 && data.walletKeys) keys.push(...data.walletKeys)
    for (const k of keys) {
      try { out.push({ label: 'current-run', kp: Keypair.fromSecretKey(base58.decode(k)) }) } catch {}
    }
    return out
  } catch { return [] }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  console.log(`\n========================================`)
  console.log(`  SOL Recovery - All Sources`)
  console.log(`========================================`)
  console.log(`Funding wallet: ${mainKp.publicKey.toBase58()}\n`)

  const seen = new Set<string>()
  const allWallets: Array<{ label: string; kp: Keypair }> = []
  const addWallet = (w: { label: string; kp: Keypair }) => {
    const addr = w.kp.publicKey.toBase58()
    if (addr === mainKp.publicKey.toBase58()) return
    if (seen.has(addr)) return
    seen.add(addr)
    allWallets.push(w)
  }

  // 1. Current run wallets
  for (const w of loadCurrentRunWallets()) addWallet(w)

  // 2. Intermediary wallets from JSON
  for (const w of loadIntermediaryFromJson()) addWallet(w)

  // 3. Archive: intermediaries + old run wallets
  const archive = loadFromArchive()
  for (const w of archive.intermediaries) addWallet(w)
  for (const w of archive.runWallets) addWallet(w)

  console.log(`Found ${allWallets.length} unique wallets to check (excluding funding wallet)\n`)

  if (allWallets.length === 0) {
    console.log('Nothing to recover.')
    return
  }

  let totalRecovered = 0
  let successCount = 0
  let skipCount = 0

  for (let i = 0; i < allWallets.length; i++) {
    const { label, kp } = allWallets[i]
    const addr = kp.publicKey.toBase58()
    try {
      const balance = await connection.getBalance(kp.publicKey)
      const balSol = balance / LAMPORTS_PER_SOL

      if (balSol < 0.001) {
        if (balSol > 0) console.log(`[${i + 1}/${allWallets.length}] ${label} ${addr.slice(0, 8)}... ${balSol.toFixed(6)} SOL (too low, skip)`)
        skipCount++
        continue
      }

      const fee = 5000
      const amountToSend = balance - fee
      if (amountToSend <= 0) { skipCount++; continue }

      console.log(`[${i + 1}/${allWallets.length}] ${label} ${addr.slice(0, 8)}... ${balSol.toFixed(6)} SOL -> withdrawing ${(amountToSend / LAMPORTS_PER_SOL).toFixed(6)} SOL`)

      const blockhash = await connection.getLatestBlockhash()
      const message = new TransactionMessage({
        payerKey: kp.publicKey,
        recentBlockhash: blockhash.blockhash,
        instructions: [SystemProgram.transfer({
          fromPubkey: kp.publicKey,
          toPubkey: mainKp.publicKey,
          lamports: amountToSend,
        })],
      }).compileToV0Message()

      const tx = new VersionedTransaction(message)
      tx.sign([kp])
      const sig = await connection.sendTransaction(tx, { skipPreflight: true })
      await connection.confirmTransaction(sig, 'confirmed')

      console.log(`   ✅ https://solscan.io/tx/${sig}`)
      totalRecovered += amountToSend / LAMPORTS_PER_SOL
      successCount++

      await sleep(500)
    } catch (err: any) {
      console.error(`   ❌ ${addr.slice(0, 8)}...: ${err.message}`)
    }
  }

  const finalBalance = await connection.getBalance(mainKp.publicKey)
  console.log(`\n========================================`)
  console.log(`  RECOVERY COMPLETE`)
  console.log(`========================================`)
  console.log(`Wallets checked: ${allWallets.length}`)
  console.log(`Successful withdrawals: ${successCount}`)
  console.log(`Skipped (low/zero balance): ${skipCount}`)
  console.log(`Total recovered: ${totalRecovered.toFixed(6)} SOL`)
  console.log(`Funding wallet balance: ${(finalBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`)
}

main().catch(console.error)
