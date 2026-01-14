/**
 * Pump.fun Trade Filter for QuickNode Streams
 * Extracts all Pump.fun buy/sell trades and sends to webhook
 */

function main(payload) {
  // Handle different payload formats
  let blocks = [];
  
  if (payload && payload.data) {
    if (Array.isArray(payload.data)) {
      blocks = payload.data;
    } else if (typeof payload.data === 'object') {
      blocks = [payload.data];
    }
  } else if (Array.isArray(payload)) {
    blocks = payload;
  } else if (payload && typeof payload === 'object') {
    blocks = [payload];
  }
  
  if (!blocks.length) return null;

  const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
  const BUY_DISC = [102, 6, 61, 18, 1, 218, 235, 234];
  const SELL_DISC = [51, 230, 133, 164, 1, 127, 131, 173];
  
  const results = [];

  for (const block of blocks) {
    if (!block) continue;
    
    const txs = block.transactions || [];
    if (!txs.length) continue;
    
    const events = [];
    
    for (const tx of txs) {
      if (!tx || !tx.transaction || !tx.meta) continue;
      if (tx.meta.err) continue;
      
      const sig = tx.transaction.signatures && tx.transaction.signatures[0];
      if (!sig) continue;
      
      const msg = tx.transaction.message;
      if (!msg || !msg.instructions) continue;
      
      // Find pump.fun instructions
      const pumpIxs = msg.instructions.filter(function(ix) {
        return ix && ix.programId === PUMP_PROGRAM;
      });
      
      if (!pumpIxs.length) continue;
      
      // Get trader (first signer)
      let trader = null;
      const keys = msg.accountKeys || [];
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (typeof k === 'string') {
          trader = k;
          break;
        } else if (k && k.pubkey && k.signer) {
          trader = k.pubkey;
          break;
        }
      }
      if (!trader && keys.length > 0) {
        trader = typeof keys[0] === 'string' ? keys[0] : (keys[0] && keys[0].pubkey);
      }
      if (!trader) continue;
      
      // Find mint from token balances
      let mint = null;
      const preTokens = tx.meta.preTokenBalances || [];
      const postTokens = tx.meta.postTokenBalances || [];
      const allTokens = preTokens.concat(postTokens);
      for (let i = 0; i < allTokens.length; i++) {
        if (allTokens[i] && allTokens[i].mint) {
          mint = allTokens[i].mint;
          break;
        }
      }
      if (!mint) continue;
      
      // Determine side from instruction data
      let side = null;
      for (let i = 0; i < pumpIxs.length; i++) {
        const ix = pumpIxs[i];
        if (!ix.data) continue;
        const decoded = decodeBase58(ix.data);
        if (!decoded || decoded.length < 8) continue;
        
        if (matchDisc(decoded, BUY_DISC)) {
          side = "buy";
          break;
        }
        if (matchDisc(decoded, SELL_DISC)) {
          side = "sell";
          break;
        }
      }
      if (!side) continue;
      
      // Calculate SOL change
      let solAmount = 0;
      const traderIdx = findAccountIndex(keys, trader);
      if (traderIdx >= 0) {
        const pre = tx.meta.preBalances && tx.meta.preBalances[traderIdx];
        const post = tx.meta.postBalances && tx.meta.postBalances[traderIdx];
        if (typeof pre === 'number' && typeof post === 'number') {
          solAmount = Math.abs(post - pre) / 1000000000;
        }
      }
      
      // Calculate token change
      let tokenAmount = 0;
      for (let i = 0; i < postTokens.length; i++) {
        const b = postTokens[i];
        if (b && b.mint === mint && b.owner === trader) {
          const postAmt = b.uiTokenAmount && b.uiTokenAmount.uiAmount || 0;
          let preAmt = 0;
          for (let j = 0; j < preTokens.length; j++) {
            const pb = preTokens[j];
            if (pb && pb.mint === mint && pb.owner === trader) {
              preAmt = pb.uiTokenAmount && pb.uiTokenAmount.uiAmount || 0;
              break;
            }
          }
          tokenAmount = Math.abs(postAmt - preAmt);
          break;
        }
      }
      
      // Build event
      events.push({
        type: "pumpfun_trade",
        side: side,
        mint: mint,
        trader: trader,
        solAmount: solAmount,
        tokenAmount: tokenAmount,
        signature: sig,
        timestamp: block.blockTime || 0
      });
    }
    
    if (events.length > 0) {
      results.push({
        slot: block.slot || (block.parentSlot ? block.parentSlot + 1 : 0),
        blockTime: block.blockTime || 0,
        events: events
      });
    }
  }

  return results.length > 0 ? results : null;
}

function findAccountIndex(keys, target) {
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (typeof k === 'string' && k === target) return i;
    if (k && k.pubkey === target) return i;
  }
  return -1;
}

function matchDisc(data, disc) {
  for (let i = 0; i < 8; i++) {
    if (data[i] !== disc[i]) return false;
  }
  return true;
}

function decodeBase58(str) {
  if (typeof str !== 'string') return null;
  var ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  var bytes = [0];
  for (var i = 0; i < str.length; i++) {
    var value = ALPHABET.indexOf(str[i]);
    if (value < 0) return null;
    var carry = value;
    for (var j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry = carry >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry = carry >> 8;
    }
  }
  for (var k = 0; k < str.length && str[k] === '1'; k++) {
    bytes.push(0);
  }
  bytes.reverse();
  return bytes;
}
