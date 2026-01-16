/**
 * Browser Signing Service
 * 
 * Handles transaction signing in the browser using the Hot Wallet.
 * This is used in PRODUCTION MODE only.
 * 
 * In production:
 * 1. Server creates unsigned transactions
 * 2. Browser signs with Hot Wallet
 * 3. Server broadcasts signed transactions
 */

import { Connection, Transaction, VersionedTransaction, LAMPORTS_PER_SOL, SystemProgram, PublicKey } from '@solana/web3.js';
import { getHotWallet, getHotWalletAddress, getHotWalletPrivateKey } from './hotWallet';
import { isProductionMode } from './productionMode';
import bs58 from 'bs58';

// Get RPC connection
const getRpcEndpoint = () => {
  return import.meta.env.VITE_RPC_ENDPOINT || 
         (import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api/rpc-proxy` : 'https://api.mainnet-beta.solana.com');
};

let connection = null;
export const getConnection = () => {
  if (!connection) {
    connection = new Connection(getRpcEndpoint(), 'confirmed');
  }
  return connection;
};

/**
 * Check if browser signing is available and ready
 */
export const isBrowserSigningReady = () => {
  if (!isProductionMode()) return false;
  const wallet = getHotWallet();
  return wallet !== null;
};

/**
 * Get the funding wallet address (hot wallet in production, server wallet in local)
 */
export const getFundingWalletAddress = async () => {
  if (isProductionMode()) {
    return getHotWalletAddress();
  }
  // In local mode, fetch from server
  const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/deployer-wallet`);
  const data = await response.json();
  return data.address;
};

/**
 * Get funding wallet balance
 */
export const getFundingWalletBalance = async () => {
  const address = await getFundingWalletAddress();
  if (!address) return 0;
  
  const conn = getConnection();
  const balance = await conn.getBalance(new PublicKey(address));
  return balance / LAMPORTS_PER_SOL;
};

/**
 * Create a funding transaction to distribute SOL to multiple wallets
 * @param {Array<{address: string, amount: number}>} recipients - Array of recipients with addresses and amounts in SOL
 * @returns {Transaction} Unsigned transaction
 */
export const createFundingTransaction = async (recipients) => {
  const hotWallet = getHotWallet();
  if (!hotWallet) throw new Error('Hot wallet not available');
  
  const conn = getConnection();
  const transaction = new Transaction();
  
  for (const recipient of recipients) {
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: hotWallet.publicKey,
        toPubkey: new PublicKey(recipient.address),
        lamports: Math.floor(recipient.amount * LAMPORTS_PER_SOL)
      })
    );
  }
  
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = hotWallet.publicKey;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  
  return transaction;
};

/**
 * Sign a transaction with the hot wallet
 * @param {Transaction} transaction 
 * @returns {Transaction} Signed transaction
 */
export const signTransaction = (transaction) => {
  const hotWallet = getHotWallet();
  if (!hotWallet) throw new Error('Hot wallet not available');
  
  transaction.sign(hotWallet);
  return transaction;
};

/**
 * Sign and send a transaction
 * @param {Transaction} transaction 
 * @returns {string} Transaction signature
 */
export const signAndSendTransaction = async (transaction) => {
  const hotWallet = getHotWallet();
  if (!hotWallet) throw new Error('Hot wallet not available');
  
  const conn = getConnection();
  
  // Ensure transaction has recent blockhash
  if (!transaction.recentBlockhash) {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.lastValidBlockHeight = lastValidBlockHeight;
  }
  
  // Set fee payer if not set
  if (!transaction.feePayer) {
    transaction.feePayer = hotWallet.publicKey;
  }
  
  // Sign
  transaction.sign(hotWallet);
  
  // Send
  const signature = await conn.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed'
  });
  
  // Confirm
  await conn.confirmTransaction(signature, 'confirmed');
  
  return signature;
};

/**
 * Fund multiple wallets from the hot wallet
 * @param {Array<{address: string, amount: number}>} recipients 
 * @returns {Object} Result with signature and details
 */
export const fundWallets = async (recipients) => {
  if (!isProductionMode()) {
    throw new Error('fundWallets should only be called in production mode');
  }
  
  const hotWallet = getHotWallet();
  if (!hotWallet) {
    throw new Error('Hot wallet not available. Please set up your funding wallet first.');
  }
  
  // Calculate total needed
  const totalSol = recipients.reduce((sum, r) => sum + r.amount, 0);
  const estimatedFees = 0.001 * recipients.length; // Rough estimate
  const totalNeeded = totalSol + estimatedFees;
  
  // Check balance
  const balance = await getFundingWalletBalance();
  if (balance < totalNeeded) {
    throw new Error(`Insufficient balance. Need ${totalNeeded.toFixed(4)} SOL but only have ${balance.toFixed(4)} SOL`);
  }
  
  console.log(`[BrowserSigning] Funding ${recipients.length} wallets with ${totalSol.toFixed(4)} SOL total`);
  
  // Create and sign transaction
  const transaction = await createFundingTransaction(recipients);
  const signature = await signAndSendTransaction(transaction);
  
  console.log(`[BrowserSigning] ✅ Funded wallets successfully! Signature: ${signature}`);
  
  return {
    success: true,
    signature,
    totalSol,
    recipientCount: recipients.length,
    explorerUrl: `https://solscan.io/tx/${signature}`
  };
};

/**
 * Fund wallets in batches (for large numbers of wallets)
 * Solana has a limit of ~20-22 transfers per transaction
 * @param {Array<{address: string, amount: number}>} recipients 
 * @param {function} onProgress - Progress callback
 * @returns {Array<Object>} Array of results
 */
export const fundWalletsInBatches = async (recipients, onProgress = null) => {
  const BATCH_SIZE = 20; // Safe limit for transfers per tx
  const results = [];
  
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(recipients.length / BATCH_SIZE);
    
    if (onProgress) {
      onProgress({
        batch: batchNum,
        totalBatches,
        processing: batch.length,
        total: recipients.length
      });
    }
    
    console.log(`[BrowserSigning] Processing batch ${batchNum}/${totalBatches} (${batch.length} wallets)`);
    
    try {
      const result = await fundWallets(batch);
      results.push(result);
      
      // Small delay between batches
      if (i + BATCH_SIZE < recipients.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`[BrowserSigning] Batch ${batchNum} failed:`, error);
      results.push({
        success: false,
        error: error.message,
        batch: batchNum
      });
    }
  }
  
  return results;
};

/**
 * Sign a serialized transaction (from server) with hot wallet
 * @param {string} serializedTx - Base64 or base58 encoded transaction
 * @returns {string} Signed and serialized transaction
 */
export const signSerializedTransaction = async (serializedTx) => {
  const hotWallet = getHotWallet();
  if (!hotWallet) throw new Error('Hot wallet not available');
  
  // Decode transaction
  let txBuffer;
  try {
    // Try base64 first
    txBuffer = Buffer.from(serializedTx, 'base64');
  } catch {
    // Try base58
    txBuffer = bs58.decode(serializedTx);
  }
  
  // Try to deserialize as versioned transaction first, then legacy
  let transaction;
  try {
    transaction = VersionedTransaction.deserialize(txBuffer);
    transaction.sign([hotWallet]);
  } catch {
    transaction = Transaction.from(txBuffer);
    transaction.sign(hotWallet);
  }
  
  // Serialize back
  const signedBuffer = transaction.serialize();
  return Buffer.from(signedBuffer).toString('base64');
};

/**
 * Get hot wallet private key for server operations (only in production)
 * This is used when the server needs to include the private key in operations
 * that can't be done client-side (like Jito bundles)
 */
export const getHotWalletKeyForServer = () => {
  if (!isProductionMode()) {
    return null; // Server uses its own key in local mode
  }
  return getHotWalletPrivateKey();
};

export default {
  isBrowserSigningReady,
  getFundingWalletAddress,
  getFundingWalletBalance,
  createFundingTransaction,
  signTransaction,
  signAndSendTransaction,
  fundWallets,
  fundWalletsInBatches,
  signSerializedTransaction,
  getHotWalletKeyForServer,
  getConnection
};
