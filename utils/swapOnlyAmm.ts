
import {
  PublicKey,
  Keypair,
  Connection,
  VersionedTransaction
} from '@solana/web3.js';
import { PRIORITY_FEE_LAMPORTS_HIGH, PRIORITY_FEE_LAMPORTS_LOW } from '../constants/constants';

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

export const getBuyTxWithJupiter = async (wallet: Keypair, baseMint: PublicKey, amount: number, priorityFeeLamports?: number) => {
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
          prioritizationFeeLamports: PRIORITY_FEE_LAMPORTS_LOW // Low priority fee for manual sells (default: 0.0001 SOL) - cheap but slower
        }),
      })
    ).json();

    // deserialize the transaction
    const swapTransactionBuf = Buffer.from(swapTransaction, "base64");
    var transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    // sign the transaction
    transaction.sign([wallet]);
    return transaction
  } catch (error) {
    console.log("Failed to get buy transaction")
    return null
  }
};


export const getSellTxWithJupiter = async (wallet: Keypair, baseMint: PublicKey, amount: string, priorityFeeLamports?: number) => {
  try {
    // Get quote from Jupiter with timeout and retry (increased retries for network resilience)
    // Using new Jupiter API endpoint (old quote-api.jup.ag was deprecated)
    const quoteUrl = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${baseMint.toBase58()}&outputMint=So11111111111111111111111111111111111111112&amount=${amount}&slippageBps=${SLIPPAGE}`
    const quoteResponseData = await fetchWithTimeout(quoteUrl, {}, 30000, 10);
    const quoteResponse = await quoteResponseData.json();
    
    // Check for quote errors
    if (quoteResponse.error) {
      console.log(`Jupiter quote error: ${JSON.stringify(quoteResponse.error)}`)
      return null
    }
    
    if (!quoteResponse || !quoteResponse.outAmount) {
      console.log(`No quote available for ${baseMint.toBase58()}, amount: ${amount}`)
      return null
    }

    // get serialized transactions for the swap with timeout and retry (increased retries for network resilience)
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
        prioritizationFeeLamports: priorityFeeLamports ?? PRIORITY_FEE_LAMPORTS_LOW // Use provided priority fee or default to LOW (cheap)
      }),
    }, 20000, 5);
    
    const swapData = await swapResponse.json();
    
    // Check for swap errors
    if (swapData.error) {
      console.log(`Jupiter swap error: ${JSON.stringify(swapData.error)}`)
      return null
    }
    
    if (!swapData.swapTransaction) {
      console.log(`No swap transaction returned from Jupiter`)
      return null
    }

    // deserialize the transaction
    const swapTransactionBuf = Buffer.from(swapData.swapTransaction, "base64");
    var transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    // sign the transaction
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