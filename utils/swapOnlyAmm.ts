
import {
  PublicKey,
  Keypair,
  Connection,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
  SystemProgram,
  LAMPORTS_PER_SOL,
  AddressLookupTableAccount
} from '@solana/web3.js';
import { PRIORITY_FEE_LAMPORTS_HIGH, PRIORITY_FEE_LAMPORTS_MEDIUM, PRIORITY_FEE_LAMPORTS_LOW } from '../constants/constants';

const SLIPPAGE = 9900 // 99% slippage - maximum to avoid error 6001 when multiple wallets sell simultaneously

// Jito tip accounts for Helius Sender (required for dual routing)
// https://www.helius.dev/docs/sending-transactions/sender
const JITO_TIP_ACCOUNTS = [
  "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
  "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ",
  "9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta",
  "5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn",
  "2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD"
]

// Jito tip range for Helius Sender - randomized to avoid detection
// Range: 5,000 - 50,000 lamports (0.000005 - 0.00005 SOL)
// Kept very low so total fee (priority + tip) stays under 0.0001 SOL for normal trades
const JITO_TIP_MIN = 5_000 // 0.000005 SOL minimum
const JITO_TIP_MAX = 50_000 // 0.00005 SOL maximum

// Get random Jito tip amount within range
const getRandomJitoTip = (): number => {
  return JITO_TIP_MIN + Math.floor(Math.random() * (JITO_TIP_MAX - JITO_TIP_MIN))
}

// Get RPC connection for ALT lookups
const getRpcEndpoint = () => process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com'

// Add Jito tip to a Jupiter transaction (required for Helius Sender)
const addJitoTipToTransaction = async (
  transaction: VersionedTransaction,
  wallet: Keypair
): Promise<VersionedTransaction> => {
  try {
    const connection = new Connection(getRpcEndpoint(), 'confirmed')
    
    // Get Address Lookup Tables from the transaction
    const altAccounts: AddressLookupTableAccount[] = []
    for (const lookup of transaction.message.addressTableLookups) {
      const result = await connection.getAddressLookupTable(lookup.accountKey)
      if (result.value) {
        altAccounts.push(result.value)
      }
    }
    
    // Decompile the transaction message
    const decompiledMessage = TransactionMessage.decompile(transaction.message, {
      addressLookupTableAccounts: altAccounts,
    })
    
    // Add Jito tip instruction with randomized amount to avoid detection
    const tipAccount = new PublicKey(JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)])
    const jitoTipAmount = getRandomJitoTip()
    const tipIx = SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: tipAccount,
      lamports: jitoTipAmount,
    })
    decompiledMessage.instructions.push(tipIx)
    
    // Recompile and sign
    const newTx = new VersionedTransaction(decompiledMessage.compileToV0Message(altAccounts))
    newTx.sign([wallet])
    
    return newTx
  } catch (error: any) {
    console.warn(`[Jupiter] Failed to add Jito tip, using original tx: ${error.message}`)
    return transaction
  }
}

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

export const getBuyTxWithJupiter = async (wallet: Keypair, baseMint: PublicKey, amount: number, priorityFeeLamports?: number, originalFeeLevel?: 'none' | 'low' | 'medium' | 'normal' | 'high' | 'ultra') => {
  // Use provided priority fee or add random variation to avoid looking botted
  // Each tier has different variance to look organic:
  // - ULTRA/HIGH: Speed matters, small ±2-5% variation
  // - MEDIUM: ±10-20% variation for more randomness
  // - LOW/NORMAL: Wide range from 1,000 to 75,000 lamports (0.000001 to 0.000075 SOL)
  // - NONE: Minimal 100-5,000 lamports (almost free, just to vary)
  let feeToUse: number
  if (priorityFeeLamports !== undefined) {
    if (originalFeeLevel === 'none') {
      // NONE: Very minimal but still varied (100 to 5,000 lamports = 0.0000001 to 0.000005 SOL)
      feeToUse = 100 + Math.floor(Math.random() * 4900)
    } else if (priorityFeeLamports >= 5_000_000) {
      // ULTRA: ±2% variation (speed critical)
      const variationPercent = (Math.random() * 0.04 - 0.02)
      feeToUse = Math.floor(priorityFeeLamports * (1 + variationPercent))
    } else if (priorityFeeLamports >= 1_000_000) {
      // HIGH: ±5% variation
      const variationPercent = (Math.random() * 0.10 - 0.05)
      feeToUse = Math.floor(priorityFeeLamports * (1 + variationPercent))
    } else if (priorityFeeLamports >= 100_000) {
      // MEDIUM: ±20% variation for more organic look
      const variationPercent = (Math.random() * 0.40 - 0.20)
      feeToUse = Math.floor(priorityFeeLamports * (1 + variationPercent))
    } else {
      // LOW/NORMAL: Wide random range (1,000 to 75,000 lamports)
      // This gives fees between 0.000001 and 0.000075 SOL - very cheap and varied
      feeToUse = 1000 + Math.floor(Math.random() * 74000)
    }
  } else {
    // Default: random between 1,000 and 50,000 lamports (organic low fee)
    feeToUse = 1000 + Math.floor(Math.random() * 49000)
  }
  try {
    // Use new Jupiter API endpoint (old quote-api.jup.ag was deprecated)
    const quoteUrl = `https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${baseMint.toBase58()}&amount=${amount}&slippageBps=${SLIPPAGE}`
    
    const quoteRes = await fetch(quoteUrl)
    const quoteResponse = await quoteRes.json();
    
    // Check for quote errors
    if (quoteResponse.error || !quoteResponse.outAmount) {
      console.log(`[Jupiter] Quote failed for ${baseMint.toBase58().substring(0, 8)}...: ${quoteResponse.error || 'No route found'}`)
      return null
    }

    // get serialized transactions for the swap
    const swapRes = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
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
    const swapData = await swapRes.json()
    
    if (!swapData.swapTransaction) {
      console.log(`[Jupiter] Swap failed for ${baseMint.toBase58().substring(0, 8)}...: ${swapData.error || 'No swap transaction returned'}`)
      return null
    }

    // deserialize the transaction
    const swapTransactionBuf = Buffer.from(swapData.swapTransaction, "base64");
    var transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    // Add Jito tip for Helius Sender (required for dual routing to validators + Jito)
    transaction = await addJitoTipToTransaction(transaction, wallet)

    return transaction
  } catch (error: any) {
    console.log(`[Jupiter] Buy error: ${error.message}`)
    return null
  }
};


export const getSellTxWithJupiter = async (wallet: Keypair, baseMint: PublicKey, amount: string, priorityFeeLamports?: number, originalFeeLevel?: 'none' | 'low' | 'medium' | 'normal' | 'high' | 'ultra') => {
  try {
    // Use provided priority fee or add random variation to avoid looking botted
    // Each tier has different variance to look organic:
    // - ULTRA/HIGH: Speed matters, small ±2-5% variation
    // - MEDIUM: ±10-20% variation for more randomness
    // - LOW/NORMAL: Wide range from 1,000 to 75,000 lamports (0.000001 to 0.000075 SOL)
    // - NONE: Minimal 100-5,000 lamports (almost free, just to vary)
    let feeToUse: number
    if (priorityFeeLamports !== undefined) {
      if (originalFeeLevel === 'none') {
        // NONE: Very minimal but still varied (100 to 5,000 lamports = 0.0000001 to 0.000005 SOL)
        feeToUse = 100 + Math.floor(Math.random() * 4900)
      } else if (priorityFeeLamports >= 5_000_000) {
        // ULTRA: ±2% variation (speed critical)
        const variationPercent = (Math.random() * 0.04 - 0.02)
        feeToUse = Math.floor(priorityFeeLamports * (1 + variationPercent))
      } else if (priorityFeeLamports >= 1_000_000) {
        // HIGH: ±5% variation
        const variationPercent = (Math.random() * 0.10 - 0.05)
        feeToUse = Math.floor(priorityFeeLamports * (1 + variationPercent))
      } else if (priorityFeeLamports >= 100_000) {
        // MEDIUM: ±20% variation for more organic look
        const variationPercent = (Math.random() * 0.40 - 0.20)
        feeToUse = Math.floor(priorityFeeLamports * (1 + variationPercent))
      } else {
        // LOW/NORMAL: Wide random range (1,000 to 75,000 lamports)
        // This gives fees between 0.000001 and 0.000075 SOL - very cheap and varied
        feeToUse = 1000 + Math.floor(Math.random() * 74000)
      }
    } else {
      // Default: random between 1,000 and 50,000 lamports (organic low fee)
      feeToUse = 1000 + Math.floor(Math.random() * 49000)
    }
    
    // Get quote from Jupiter (fast, no retry wrapper - same as buy)
    const quoteResponse = await (
      await fetch(
        `https://lite-api.jup.ag/swap/v1/quote?inputMint=${baseMint.toBase58()}&outputMint=So11111111111111111111111111111111111111112&amount=${amount}&slippageBps=${SLIPPAGE}`
      )
    ).json();
    
    // Check for quote errors
    if (quoteResponse.error || !quoteResponse.outAmount) {
      console.log(`[Jupiter Sell] No route for ${baseMint.toBase58().substring(0, 8)}...`)
      return null
    }

    // Get swap transaction (fast, no retry wrapper - same as buy)
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
          prioritizationFeeLamports: feeToUse
        }),
      })
    ).json();
    
    if (!swapTransaction) {
      console.log(`[Jupiter Sell] No swap transaction for ${baseMint.toBase58().substring(0, 8)}...`)
      return null
    }

    // deserialize the transaction
    const swapTransactionBuf = Buffer.from(swapTransaction, "base64");
    var transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    // Add Jito tip for Helius Sender (required for dual routing to validators + Jito)
    transaction = await addJitoTipToTransaction(transaction, wallet)

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