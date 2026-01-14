// QuickNode Webhook Handler
// Processes QuickNode stream webhooks and converts them to live trades format

const liveTradesTracker = require('./live-trades-tracker');

// Track stats for periodic logging
let webhookStats = { received: 0, matched: 0, lastLog: Date.now() };

/**
 * Process QuickNode webhook payload
 * Silently filters to only return trades matching our token
 */
// DEBUG: Track first few mints we see
let debugMintsSeen = new Set();
let debugLogCount = 0;

function processQuickNodeWebhook(payload, currentMintAddress) {
  if (!payload || !Array.isArray(payload)) {
    return [];
  }

  const trades = [];
  const currentMintLower = currentMintAddress ? currentMintAddress.toLowerCase().trim() : null;
  
  // DEBUG: Log current mint once
  if (debugLogCount < 3) {
    console.log(`[QuickNode] 🎯 Looking for mint: ${currentMintAddress || 'NOT SET'}`);
    debugLogCount++;
  }

  for (const block of payload) {
    if (!block) continue;
    
    const events = block.events || block.transactions || [];
    if (!Array.isArray(events)) continue;

    for (const event of events) {
      // Determine format and extract data
      let mint, trader, solAmount, tokenAmount, side, signature, timestamp;
      
      // Format 1: ChatGPT detailed format
      if (event.type === 'pumpfun_trade') {
        mint = event.mint;
        trader = event.trader;
        solAmount = event.solAmount;
        tokenAmount = event.tokenAmount;
        side = event.side;
        signature = event.signature;
        timestamp = event.timestamp;
      }
      // Format 2: Simple format
      else if (event.owner && event.mint) {
        mint = event.mint;
        trader = event.owner;
        solAmount = event.solChange ? Math.abs(event.solChange) : null;
        tokenAmount = event.tokenChange ? Math.abs(event.tokenChange) : null;
        side = event.solChange < 0 ? 'buy' : (event.solChange > 0 ? 'sell' : null);
        signature = event.signature;
        timestamp = event.timestamp;
      } else {
        continue;
      }

      // DEBUG: Log first 5 unique mints we see
      if (mint && debugMintsSeen.size < 5 && !debugMintsSeen.has(mint)) {
        debugMintsSeen.add(mint);
        console.log(`[QuickNode] 📋 Seen mint #${debugMintsSeen.size}: ${mint}`);
      }

      // Skip if no mint or doesn't match our token
      if (!mint || !currentMintLower) continue;
      
      const mintLower = mint.toLowerCase().trim();
      if (mintLower !== currentMintLower) continue;

      // Skip if no side (buy/sell) or no trader
      if (!side || !trader) continue;
      
      // ✅ FOUND A MATCH - Log it!
      console.log(`[QuickNode] ✅ MATCH! ${side.toUpperCase()} | ${trader.slice(0, 8)}... | ${solAmount?.toFixed(6)} SOL | ${tokenAmount?.toFixed(0)} tokens`);

      // Convert QuickNode event to live trades format
      const tradeTimestamp = timestamp ? timestamp * 1000 : (block.blockTime ? block.blockTime * 1000 : Date.now());
      const age = Math.floor((Date.now() - tradeTimestamp) / 60000);

      // Check if it's our wallet
      const traderLower = trader.toLowerCase();
      const isOurWallet = liveTradesTracker.ourWallets ? liveTradesTracker.ourWallets.has(traderLower) : false;
      const walletType = isOurWallet && liveTradesTracker.walletTypes ? (liveTradesTracker.walletTypes.get(traderLower) || 'Unknown') : null;

      // Calculate market cap
      let marketCap = null;
      if (event.mcapSolApprox) {
        marketCap = event.mcapSolApprox;
      } else if (event.priceSolPerToken) {
        marketCap = event.priceSolPerToken * 1000000000;
      } else if (solAmount && tokenAmount && tokenAmount > 0) {
        const pricePerToken = solAmount / tokenAmount;
        marketCap = pricePerToken * 1000000000;
      }

      const trade = {
        signature: signature ? (signature.slice(0, 8) + '...') : 'unknown',
        fullSignature: signature || 'unknown',
        age: age,
        type: side,
        marketCap: marketCap,
        amount: tokenAmount || 0,
        totalUSD: solAmount ? solAmount * 150 : 0,
        gas: 0.000005,
        trader: trader ? (trader.slice(0, 4) + '...' + trader.slice(-4)) : 'unknown',
        fullTrader: trader || 'unknown',
        timestamp: tradeTimestamp,
        solAmount: solAmount || 0,
        isOurWallet: isOurWallet,
        walletType: walletType,
        slot: block.slot || null,
        mintAddress: mint
      };

      trades.push(trade);
    }
  }

  return trades;
}

/**
 * Handle QuickNode webhook and add trades to tracker
 */
function handleQuickNodeWebhook(payload) {
  try {
    webhookStats.received++;
    
    // Periodic stats log (every 60 seconds)
    const now = Date.now();
    if (now - webhookStats.lastLog > 60000) {
      console.log(`[QuickNode] 📊 Stats: ${webhookStats.received} webhooks received, ${webhookStats.matched} trades matched (last 60s)`);
      webhookStats = { received: 0, matched: 0, lastLog: now };
    }
    
    // Get current mint address from tracker
    const currentMintAddress = liveTradesTracker.currentMintAddress;
    
    if (!currentMintAddress) {
      return { processed: 0, skipped: 0 };
    }

    // Process webhook payload (silently filters to our token)
    const trades = processQuickNodeWebhook(payload, currentMintAddress);

    if (trades.length === 0) {
      return { processed: 0, skipped: 0 };
    }
    
    webhookStats.matched += trades.length;

    // Add trades to tracker
    let processed = 0;
    let skipped = 0;
    for (const trade of trades) {
      // Check if signature already processed
      if (liveTradesTracker.processedSignatures && liveTradesTracker.processedSignatures.has(trade.fullSignature)) {
        skipped++;
        continue;
      }

      // Add to processed signatures
      if (liveTradesTracker.processedSignatures) {
        liveTradesTracker.processedSignatures.add(trade.fullSignature);
        
        if (liveTradesTracker.processedSignatures.size > 1000) {
          const first = liveTradesTracker.processedSignatures.values().next().value;
          liveTradesTracker.processedSignatures.delete(first);
        }
      }

      // Add trade to tracker
      liveTradesTracker.addTrade(trade);
      processed++;

      // Send to all listeners
      liveTradesTracker.sendToAllListeners(trade);
      
      // Log individual trade
      console.log(`[QuickNode] 🔔 NEW TRADE: ${trade.type.toUpperCase()} | ${trade.fullTrader?.slice(0, 8)}... | ${trade.solAmount} SOL${trade.isOurWallet ? ` | 🎯 ${trade.walletType}` : ''}`);
    }

    if (processed > 0) {
      console.log(`[QuickNode] ✅ Added ${processed} trade(s) to tracker`);
    }
    
    return { processed, skipped };
  } catch (error) {
    console.error('[QuickNode] ❌ Error:', error.message);
    return { processed: 0, skipped: 0, error: error.message };
  }
}

module.exports = {
  processQuickNodeWebhook,
  handleQuickNodeWebhook
};
