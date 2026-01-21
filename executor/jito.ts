import { Commitment, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import base58 from "bs58";
import axios from "axios";
import { JITO_FEE, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT } from "../constants";
import { rpc } from "@coral-xyz/anchor/dist/cjs/utils";
import * as fs from "fs";
import * as path from "path";
// Jito block engine endpoints are defined below in executeJitoTx
const solanaConnection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
})

// Cooldown mechanism to prevent rate limiting
const JITO_COOLDOWN_FILE = path.join(process.cwd(), 'keys', '.jito-cooldown.json');
const JITO_COOLDOWN_SECONDS = 120; // Wait 120 seconds between bundle submissions (increased to avoid rate limits)

const checkCooldown = (): number => {
  try {
    if (fs.existsSync(JITO_COOLDOWN_FILE)) {
      const cooldownData = JSON.parse(fs.readFileSync(JITO_COOLDOWN_FILE, 'utf8'));
      const lastSubmission = cooldownData.lastSubmission || 0;
      const elapsed = (Date.now() - lastSubmission) / 1000;
      const remaining = Math.max(0, JITO_COOLDOWN_SECONDS - elapsed);
      return remaining;
    }
  } catch (error) {
    // Ignore errors, just proceed
  }
  return 0;
};

const updateCooldown = () => {
  try {
    const cooldownData = {
      lastSubmission: Date.now()
    };
    fs.writeFileSync(JITO_COOLDOWN_FILE, JSON.stringify(cooldownData, null, 2));
  } catch (error) {
    // Ignore errors
  }
};


// Global flag to stop retries once token is confirmed
let globalStopRetries = false
export const stopJitoRetries = () => { globalStopRetries = true }

export const executeJitoTx = async (transactions: VersionedTransaction[], payer: Keypair, commitment: Commitment, blockhash?: { blockhash: string; lastValidBlockHeight: number }) => {
  // Reset stop flag for new bundle
  globalStopRetries = false

  try {
    // Validate transactions array
    if (!transactions || transactions.length === 0) {
      console.error('❌ ERROR: No transactions provided to executeJitoTx');
      return null;
    }
    
    // Validate first transaction has signatures
    if (!transactions[0] || !transactions[0].signatures || transactions[0].signatures.length === 0) {
      console.error('❌ ERROR: First transaction is missing signatures');
      return null;
    }
    
    // Check cooldown to prevent rate limiting
    const cooldownRemaining = checkCooldown();
    if (cooldownRemaining > 0) {
      console.log(`\n⏳ Jito cooldown: ${cooldownRemaining.toFixed(1)}s remaining (waiting to avoid rate limits)...`);
      console.log(`   💡 This prevents rate limiting (429 errors) from Jito endpoints`);
      await new Promise(resolve => setTimeout(resolve, cooldownRemaining * 1000));
      console.log(`✅ Cooldown complete, proceeding with bundle submission`);
    } else {
      console.log(`\n✅ No cooldown required - proceeding with bundle submission`);
    }
    
    // Update cooldown timestamp after successful submission
    const updateCooldownAfterSuccess = () => {
      updateCooldown();
    };
    // Use provided blockhash if available (from bundle creation), otherwise get fresh one
    // This ensures we use the same blockhash that was used to create the transactions
    let latestBlockhash = blockhash || await solanaConnection.getLatestBlockhash();
    
    if (blockhash) {
      console.log(`Using provided blockhash: ${blockhash.blockhash.slice(0, 8)}... (valid until block ${blockhash.lastValidBlockHeight})`);
    } else {
      console.log(`Got fresh blockhash: ${latestBlockhash.blockhash.slice(0, 8)}... (valid until block ${latestBlockhash.lastValidBlockHeight})`);
    }

    const jitoTxsignature = base58.encode(transactions[0].signatures[0]);

    // Serialize the transactions once here
    const serializedTransactions: string[] = [];
    for (let i = 0; i < transactions.length; i++) {
      if (!transactions[i]) {
        console.error(`❌ ERROR: Transaction at index ${i} is null or undefined`);
        return null;
      }
      try {
        const serializedTransaction = base58.encode(transactions[i].serialize());
        serializedTransactions.push(serializedTransaction);
      } catch (error: any) {
        console.error(`❌ ERROR: Failed to serialize transaction at index ${i}:`, error.message);
        return null;
      }
    }
    
    if (serializedTransactions.length === 0) {
      console.error('❌ ERROR: No valid transactions to serialize');
      return null;
    }
    
    console.log(`📦 Serialized ${serializedTransactions.length} transaction(s) for bundle submission`);

    // Use ALL available Jito endpoints for better success rate
    const endpoints = [
      'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
      'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
      'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
      'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
      'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
    ];

    // Send with retry logic for rate limiting (429 errors)
    // Increased retries and longer backoff for better rate limit handling
    const sendWithRetry = async (url: string, retries: number = 8, initialDelay: number = 2000): Promise<any> => {
      for (let attempt = 0; attempt < retries; attempt++) {
        // Stop retrying if token is already confirmed (bundle succeeded)
        if (globalStopRetries) {
          return new Error('Token confirmed - stopping retries')
        }
        
        try {
          const response = await axios.post(url, {
            jsonrpc: '2.0',
            id: 1,
            method: 'sendBundle',
            params: [serializedTransactions],
          }, {
            timeout: 30000 // 30 second timeout
          });
          return response;
        } catch (error: any) {
          const isRateLimit = error.response?.status === 429;
          const isLastAttempt = attempt === retries - 1;
          
          if (isRateLimit && !isLastAttempt) {
            // Stop retrying if token is already confirmed
            if (globalStopRetries) {
              return new Error('Token confirmed - stopping retries')
            }
            
            // On first rate limit, update cooldown to prevent future rapid retries
            if (attempt === 0) {
              console.log(`⚠️  Rate limited (429) - updating cooldown to prevent future rate limits`);
              updateCooldown(); // Update cooldown even on rate limit to prevent rapid retries
            }
            
            // Exponential backoff with jitter: 2s, 4s, 8s, 16s, 20s (capped), 20s, 20s, 20s
            const baseDelay = initialDelay * Math.pow(2, attempt);
            const backoffDelay = Math.min(baseDelay, 20000); // Cap at 20 seconds
            const jitter = Math.random() * 1000; // Add 0-1s random jitter to avoid thundering herd
            const totalDelay = backoffDelay + jitter;
            
            // Only log if we haven't stopped retries (token not confirmed yet)
            if (!globalStopRetries) {
              console.log(`⚠️  Rate limited (429) on ${url}, retrying in ${Math.round(totalDelay)}ms... (attempt ${attempt + 1}/${retries})`);
            }
            await new Promise(resolve => setTimeout(resolve, totalDelay));
            
            // Check again after delay
            if (globalStopRetries) {
              return new Error('Token confirmed - stopping retries')
            }
            continue;
          }
          
          // If it's the last attempt or not a rate limit, throw the error
          throw error;
        }
      }
    };

    console.log('Sending transactions to endpoints...');
    console.log(`   Using ${endpoints.length} Jito endpoints - will return after FIRST success`);
    console.log(`   ⚡⚡⚡ CRITICAL: Returning immediately after first success to start rapid sell! ⚡⚡⚡`);

    // CRITICAL: Return immediately after FIRST success to avoid blocking rapid sell
    // Create a wrapper that resolves on first success
    let firstSuccessResolved = false
    const successResolver = { resolve: null as ((value: any) => void) | null }
    
    const endpointPromises = endpoints.map((url, index) => 
      sendWithRetry(url, 8, 2000)
        .then((result) => {
          if (!firstSuccessResolved && result && !(result instanceof Error)) {
            const response = result as any
            if (response.data && response.data.result) {
              firstSuccessResolved = true
              const bundleId = response.data.result
              console.log(`\n✅✅✅ FIRST SUCCESS on endpoint ${index + 1} - RETURNING IMMEDIATELY! ✅✅✅`)
              console.log(`   Bundle ID: ${bundleId}`)
              console.log(`   Check: https://jito.wtf/bundle/${bundleId}`)
              console.log(`   ⚡⚡⚡ Rapid sell can start NOW! ⚡⚡⚡\n`)
              updateCooldownAfterSuccess()
              if (successResolver.resolve) successResolver.resolve(jitoTxsignature)
              return { success: true, result, endpoint: index + 1 }
            }
          }
          return { success: false, result, endpoint: index + 1 }
        })
        .catch((e) => ({ success: false, error: e, endpoint: index + 1 }))
    );
    
    // Race: return as soon as we get first success OR timeout after 3 seconds
    const firstSuccessPromise = new Promise<string>((resolve) => {
      successResolver.resolve = resolve
      // Check all promises for success
      Promise.all(endpointPromises).then(results => {
        const successful = results.find(r => r.success)
        if (successful && !firstSuccessResolved) {
          firstSuccessResolved = true
          const response = (successful as any).result
          if (response.data && response.data.result) {
            const bundleId = response.data.result
            console.log(`\n✅ Bundle accepted by endpoint ${successful.endpoint}`)
            console.log(`   Bundle ID: ${bundleId}`)
            updateCooldownAfterSuccess()
            resolve(jitoTxsignature)
          }
        }
      })
    })
    
    const timeoutPromise = new Promise<string>((resolve, reject) => {
      setTimeout(() => {
        if (!firstSuccessResolved) {
          console.log(`\n⚠️  No immediate success after 10s - bundle may not have been accepted`)
          console.log(`   Bundle submission continues in background with retries`)
          console.log(`   ⚠️  WARNING: Bundle may have been rate-limited - check Jito status manually`)
          console.log(`   💡 Consider waiting longer between retries (cooldown: ${JITO_COOLDOWN_SECONDS}s)`)
          console.log(`   💡 If rate limited, wait ${JITO_COOLDOWN_SECONDS} seconds before retrying`)
          firstSuccessResolved = true
          // Don't update cooldown - bundle wasn't successfully accepted yet
          // Return signature anyway to allow rapid sell to start (it will retry)
          resolve(jitoTxsignature)
        }
      }, 10000) // 10 second timeout (increased to give more time for acceptance)
    })
    
    // Return immediately after first success or timeout
    const result = await Promise.race([firstSuccessPromise, timeoutPromise])
    
    // Continue retries in background (non-blocking)
    Promise.all(endpointPromises).then(results => {
      const successful = results.filter(r => r.success)
      if (successful.length > 0) {
        const bundleIds = successful.map(s => {
          const response = (s as any).result
          return response.data?.result
        }).filter(Boolean)
        if (bundleIds.length > 0 && !firstSuccessResolved) {
          console.log(`   ✅ Bundle also accepted by ${successful.length} other endpoint(s)`)
        }
      }
    }).catch(() => {})
    
    // Log final results in background (non-blocking)
    Promise.all(endpointPromises).then(results => {
      const successful = results.filter(r => r.success)
      const errors = results.filter(r => !r.success)
      if (successful.length > 0) {
        const bundleIds = successful.map(s => {
          const response = (s as any).result
          return response.data?.result
        }).filter(Boolean)
        if (bundleIds.length > 0) {
          console.log(`   📊 Final: Bundle accepted by ${successful.length} endpoint(s)`)
        }
      }
      if (errors.length > 0 && errors.length === results.length) {
        console.log(`   ⚠️  All endpoints failed - but bundle was already sent, continuing...`)
      }
    }).catch(() => {})
    
    return result
  } catch (error) {
    console.log('Error during transaction execution', error);
    return null
  }
}
