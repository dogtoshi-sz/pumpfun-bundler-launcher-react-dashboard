import { Keypair, VersionedTransaction } from "@solana/web3.js";
import base58 from "bs58";
import * as fs from "fs";
import * as path from "path";

const JITO_ENDPOINTS = [
  'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
  'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
  'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
  'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
  'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
];

const JITO_TIP_ACCOUNTS = [
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
];

const COOLDOWN_FILE = path.join(process.cwd(), 'keys', '.jito-cooldown.json');
const COOLDOWN_SECONDS = 60;

function checkCooldown(): number {
  try {
    if (fs.existsSync(COOLDOWN_FILE)) {
      const data = JSON.parse(fs.readFileSync(COOLDOWN_FILE, 'utf8'));
      const elapsed = (Date.now() - (data.lastSubmission || 0)) / 1000;
      return Math.max(0, COOLDOWN_SECONDS - elapsed);
    }
  } catch {}
  return 0;
}

function updateCooldown() {
  try {
    const dir = path.dirname(COOLDOWN_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(COOLDOWN_FILE, JSON.stringify({ lastSubmission: Date.now() }, null, 2));
  } catch {}
}

let globalStopRetries = false;
export const stopJitoRetries = () => { globalStopRetries = true; };

async function sendToEndpoint(
  url: string,
  serialized: string[],
  maxRetries = 5,
): Promise<{ bundleId: string } | null> {
  const host = new URL(url).hostname;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (globalStopRetries) return null;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'sendBundle',
          params: [serialized],
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (res.status === 429 || res.status >= 500) {
        const backoff = Math.min(2000 * Math.pow(2, attempt), 10000) + Math.random() * 600;
        console.log(`[Jito] ${res.status} on ${host}, retry in ${Math.round(backoff)}ms (${attempt + 1}/${maxRetries})`);
        if (attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, backoff));
        }
        continue;
      }

      if (!res.ok) {
        let details = '';
        try {
          const bodyText = await res.text();
          details = bodyText ? ` — ${bodyText.slice(0, 300)}` : '';
        } catch {}
        console.log(`[Jito] HTTP ${res.status} on ${host} (non-retryable)${details}`);
        return null;
      }

      const data = (await res.json()) as any;
      if (data?.result) return { bundleId: data.result };
      if (data?.error) console.log(`[Jito] RPC error on ${host}:`, data.error?.message || data.error);
      return null;
    } catch (err: any) {
      const backoff = Math.min(2000 * Math.pow(2, attempt), 10000) + Math.random() * 600;
      console.log(`[Jito] Error on ${host}: ${err.message}. Retry in ${Math.round(backoff)}ms (${attempt + 1}/${maxRetries})`);
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, backoff));
      }
    }
  }
  return null;
}

function verifyBundleHasTip(transactions: VersionedTransaction[]): void {
  const tipSet = new Set(JITO_TIP_ACCOUNTS);
  for (let i = 0; i < transactions.length; i++) {
    const msg = transactions[i].message;
    const keys = msg.staticAccountKeys;
    const numSig = msg.header.numRequiredSignatures;
    const numReadonlySigned = msg.header.numReadonlySignedAccounts;
    const numReadonlyUnsigned = msg.header.numReadonlyUnsignedAccounts;
    const numWritableSigned = numSig - numReadonlySigned;
    const numWritableUnsigned = keys.length - numSig - numReadonlyUnsigned;

    const writableKeys: string[] = [];
    for (let j = 0; j < numWritableSigned; j++) writableKeys.push(keys[j].toBase58());
    for (let j = numSig; j < numSig + numWritableUnsigned; j++) writableKeys.push(keys[j].toBase58());

    const tipFound = writableKeys.find(k => tipSet.has(k));
    console.log(`[Jito] TX ${i}: ${keys.length} keys, ${writableKeys.length} writable. Tip in writable: ${tipFound || 'NONE'}`);
    if (tipFound) {
      console.log(`[Jito] ✓ Bundle tip verification PASSED (tx ${i}, account ${tipFound})`);
      return;
    }
  }
  console.error('[Jito] ✗ Bundle tip verification FAILED — no tip account found in any writable key!');
}

export const executeJitoTx = async (
  transactions: VersionedTransaction[],
  payer: Keypair,
  commitment: string,
  blockhash?: { blockhash: string; lastValidBlockHeight: number },
): Promise<string | null> => {
  globalStopRetries = false;

  if (!transactions || transactions.length === 0) {
    console.error('❌ No transactions provided to executeJitoTx');
    return null;
  }

  const cooldown = checkCooldown();
  if (cooldown > 0) {
    console.log(`[Jito] Cooldown: ${cooldown.toFixed(1)}s remaining...`);
    await new Promise(r => setTimeout(r, cooldown * 1000));
  }

  verifyBundleHasTip(transactions);

  const serialized: string[] = [];
  for (let i = 0; i < transactions.length; i++) {
    try {
      serialized.push(base58.encode(transactions[i].serialize()));
    } catch (error: any) {
      console.error(`❌ Failed to serialize transaction ${i}:`, error.message);
      return null;
    }
  }

  const firstTxSig = base58.encode(transactions[0].signatures[0]);
  console.log(`[Jito] Serialized ${serialized.length} transaction(s)`);

  const MAX_ROUNDS = 3;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (globalStopRetries) break;
    const shuffled = [...JITO_ENDPOINTS].sort(() => Math.random() - 0.5);
    console.log(`[Jito] Round ${round + 1}: sending ${serialized.length} tx(s) to ${shuffled.length} endpoint(s)`);
    const results = await Promise.all(shuffled.map(url => sendToEndpoint(url, serialized)));
    const success = results.find(r => r !== null);

    if (success) {
      console.log(`[Jito] Bundle accepted: ${success.bundleId}`);
      console.log(`[Jito] https://jito.wtf/bundle/${success.bundleId}`);
      updateCooldown();
      return firstTxSig;
    }

    if (round < MAX_ROUNDS - 1) {
      const wait = 3000 + Math.random() * 2000;
      console.log(`[Jito] No acceptance in round ${round + 1}, waiting ${(wait / 1000).toFixed(1)}s...`);
      await new Promise(r => setTimeout(r, wait));
    }
  }

  updateCooldown();
  console.error('[Jito] ❌ No endpoint accepted the bundle after all rounds');
  return null;
};
