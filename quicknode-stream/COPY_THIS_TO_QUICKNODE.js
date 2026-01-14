/**
 * Pump.fun -> Clean Event Objects (QuickNode Block Stream)
 *
 * Outputs small, bot-friendly events:
 * - buy/sell side
 * - SOL amount (lamports delta for trader)
 * - token amount (token delta for trader + mint)
 * - implied price (SOL/token)
 * - optional SOL marketcap approx (price * TOTAL_SUPPLY)
 *
 * NOTE: USD + true marketcap in USD are NOT in block payload.
 * You must add SOL/USD from an external feed (Pyth/Coingecko/etc) in your backend.
 */

function main(payload) {
  const blocks = normalizeBlocks(payload);
  if (!blocks.length) return null;

  const out = [];

  for (const block of blocks) {
    if (!block || !Array.isArray(block.transactions)) continue;

    const events = [];
    for (const tx of block.transactions) {
      // Parse ALL Pump.fun trades in this transaction (not just one)
      const evts = parsePumpFunTx(tx, block);
      if (evts) {
        // Handle both single event and array of events
        if (Array.isArray(evts)) {
          events.push(...evts);
        } else {
          events.push(evts);
        }
      }
    }

    if (events.length) {
      out.push({
        slot: (block.parentSlot ?? 0) + 1,
        blockTime: block.blockTime,
        events,
      });
    }
  }

  return out.length ? out : null;
}

const CONFIG = {
  LAMPORTS_PER_SOL: 1_000_000_000,
  TOTAL_SUPPLY: 1_000_000_000, // pump.fun common supply (adjust if needed)
  BIG_BUY_SOL: 1.0,            // mark isBigBuy if buy >= this SOL
};

const PROTOCOL = {
  PUMPFUN_PROGRAM_ID: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  DISCRIMINATOR: {
    BUY:  new Uint8Array([102, 6, 61, 18, 1, 218, 235, 234]),
    SELL: new Uint8Array([51, 230, 133, 164, 1, 127, 131, 173]),
  },
};

function normalizeBlocks(payload) {
  if (!payload || typeof payload !== "object") return [];
  const d = payload.data;
  if (!d) return [];
  if (Array.isArray(d)) return d.filter(Boolean);
  if (typeof d === "object") return [d];
  return [];
}

function parsePumpFunTx(tx, block) {
  if (!tx?.transaction?.message || !tx?.meta) return null;
  if (tx.meta.err) return null; // ignore failed txs

  const sig = tx.transaction.signatures?.[0];
  if (!sig) return null;

  const msg = tx.transaction.message;
  const ixs = msg.instructions || [];
  if (!ixs.length) return null;

  // Find ALL Pump.fun instruction(s) - there can be multiple in bundle transactions
  const pumpIxs = ixs.filter(ix => ix?.programId === PROTOCOL.PUMPFUN_PROGRAM_ID);
  if (!pumpIxs.length) return null;

  // Extract ALL trades from this transaction (one per Pump.fun instruction)
  const events = [];
  
  // Get all account keys for this transaction
  const accountKeys = msg.accountKeys || [];
  const accountKeysArray = accountKeys.map(k => typeof k === 'string' ? k : k.pubkey);
  
  // Get all token balance changes
  const preBalances = tx.meta.preTokenBalances || [];
  const postBalances = tx.meta.postTokenBalances || [];
  const preSolBalances = tx.meta.preBalances || [];
  const postSolBalances = tx.meta.postBalances || [];
  
  // Process each Pump.fun instruction separately
  // For bundle transactions, each instruction might be a separate trade
  for (let i = 0; i < pumpIxs.length; i++) {
    const pumpIx = pumpIxs[i];
    const side = determineSideFromIx(pumpIx);
    if (!side) continue;
    
    // Get instruction account indices
    const ixAccountIndices = pumpIx.accounts || [];
    
    // Find trader: look for signer in instruction accounts or use first signer
    let trader = null;
    for (const accIdx of ixAccountIndices) {
      if (accIdx < accountKeys.length) {
        const accKeyObj = accountKeys[accIdx];
        if (accKeyObj && accKeyObj.signer === true) {
          trader = typeof accKeyObj === 'string' ? accKeyObj : accKeyObj.pubkey;
          break;
        }
      }
    }
    
    // Fallback: use first signer from transaction
    if (!trader) {
      trader = extractTrader(msg);
    }
    if (!trader) continue;
    
    // Find mint: extract from token balance changes
    const mint = extractMostLikelyMint(tx.meta);
    if (!mint) continue;
    
    // For bundle transactions, we need to parse inner instructions to get per-trade amounts
    // Check if there are inner instructions for this instruction index
    const innerIxs = tx.meta.innerInstructions || [];
    const innerIxForThis = innerIxs.find(inner => inner.index === i);
    
    // Calculate SOL and token amounts
    // If single instruction, use total amounts
    // If multiple instructions, try to estimate per-instruction (this is approximate)
    const totalSolChange = solDeltaForPubkey(tx, trader);
    const totalTokenChange = tokenDeltaForOwnerAndMint(tx.meta, trader, mint);
    
    // For now, if there's only one Pump.fun instruction, use full amounts
    // If multiple, divide (this is approximate - perfect would require parsing inner instructions)
    let solAmount = null;
    let tokenAmount = null;
    
    if (pumpIxs.length === 1) {
      // Single instruction - use full amounts
      solAmount = totalSolChange != null ? Math.abs(totalSolChange) : null;
      tokenAmount = totalTokenChange != null ? Math.abs(totalTokenChange) : null;
    } else {
      // Multiple instructions - approximate by dividing
      // NOTE: This is not perfect but better than missing trades
      solAmount = totalSolChange != null ? Math.abs(totalSolChange) / pumpIxs.length : null;
      tokenAmount = totalTokenChange != null ? Math.abs(totalTokenChange) / pumpIxs.length : null;
    }
    
    // Implied price (SOL per token) if both are present
    const priceSolPerToken =
      solAmount != null && tokenAmount != null && tokenAmount > 0
        ? solAmount / tokenAmount
        : null;

    // Approx mcap in SOL using TOTAL_SUPPLY
    const mcapSolApprox =
      priceSolPerToken != null ? priceSolPerToken * CONFIG.TOTAL_SUPPLY : null;

    const isBigBuy = side === "buy" && solAmount != null && solAmount >= CONFIG.BIG_BUY_SOL;

    events.push({
      type: "pumpfun_trade",
      side,
      mint,
      trader,
      solAmount,
      tokenAmount,
      priceSolPerToken,
      mcapSolApprox,
      signature: sig + (pumpIxs.length > 1 ? `_ix${i}` : ''), // Add index for multiple trades in same tx
      timestamp: block.blockTime,
      isBigBuy,
      pumpIxCount: pumpIxs.length,
      instructionIndex: i,
    });
  }
  
  // Return array if multiple events, single event if one
  if (events.length === 0) return null;
  if (events.length === 1) return events[0];
  return events;
}

function determineSideFromIx(ix) {
  const data = base58Decode(ix.data);
  if (!data || data.length < 8) return null;

  if (matchesDiscriminator(data, PROTOCOL.DISCRIMINATOR.BUY)) return "buy";
  if (matchesDiscriminator(data, PROTOCOL.DISCRIMINATOR.SELL)) return "sell";
  return null;
}

function matchesDiscriminator(data, disc) {
  for (let i = 0; i < disc.length; i++) {
    if (data[i] !== disc[i]) return false;
  }
  return true;
}

function extractTrader(message) {
  const keys = message.accountKeys;
  if (!Array.isArray(keys) || !keys.length) return null;

  // Your payload uses objects: { pubkey, signer, writable, ... }
  const signer = keys.find(k => k && k.signer === true && typeof k.pubkey === "string");
  if (signer?.pubkey) return signer.pubkey;

  // fallback if keys are strings
  if (typeof keys[0] === "string") return keys[0];

  return keys[0]?.pubkey ?? null;
}

function solDeltaForPubkey(tx, pubkey) {
  const keys = tx.transaction.message.accountKeys;
  if (!Array.isArray(keys)) return null;

  const idx = keys.findIndex(k => (typeof k === "string" ? k === pubkey : k?.pubkey === pubkey));
  if (idx < 0) return null;

  const pre = tx.meta.preBalances?.[idx];
  const post = tx.meta.postBalances?.[idx];
  if (typeof pre !== "number" || typeof post !== "number") return null;

  return (post - pre) / CONFIG.LAMPORTS_PER_SOL;
}

function extractMostLikelyMint(meta) {
  const pre = meta.preTokenBalances || [];
  const post = meta.postTokenBalances || [];

  // Compute biggest absolute delta by mint (across all accounts)
  const mintToDelta = new Map();

  for (const b of pre) {
    if (!b?.mint) continue;
    const amt = b.uiTokenAmount?.uiAmount || 0;
    mintToDelta.set(b.mint, (mintToDelta.get(b.mint) || 0) - amt);
  }

  for (const b of post) {
    if (!b?.mint) continue;
    const amt = b.uiTokenAmount?.uiAmount || 0;
    mintToDelta.set(b.mint, (mintToDelta.get(b.mint) || 0) + amt);
  }

  let bestMint = null;
  let bestAbs = 0;

  for (const [mint, delta] of mintToDelta.entries()) {
    const abs = Math.abs(delta);
    if (abs > bestAbs) {
      bestAbs = abs;
      bestMint = mint;
    }
  }

  return bestMint;
}

function tokenDeltaForOwnerAndMint(meta, owner, mint) {
  const pre = meta.preTokenBalances || [];
  const post = meta.postTokenBalances || [];

  // Prefer the exact owner+mint row if present
  const preRow = pre.find(b => b?.mint === mint && b?.owner === owner);
  const postRow = post.find(b => b?.mint === mint && b?.owner === owner);

  const preAmt = preRow?.uiTokenAmount?.uiAmount ?? 0;
  const postAmt = postRow?.uiTokenAmount?.uiAmount ?? 0;

  // If both rows missing, return null
  const hadAny = Boolean(preRow || postRow);
  if (!hadAny) return null;

  return postAmt - preAmt;
}

/** Base58 decode */
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Decode(encoded) {
  if (typeof encoded !== "string") return null;
  let bytes = [0];
  for (let i = 0; i < encoded.length; i++) {
    const c = encoded[i];
    const value = BASE58_ALPHABET.indexOf(c);
    if (value < 0) return null;

    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // deal with leading zeros
  for (let k = 0; k < encoded.length && encoded[k] === "1"; k++) {
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}
