/**
 * Hot Wallet Service
 * 
 * Manages a browser-side "hot" funding wallet that users deposit to from their
 * Phantom wallet. This allows all subsequent operations to auto-sign without
 * requiring wallet popups for each transaction.
 * 
 * Flow:
 * 1. User connects Phantom
 * 2. User deposits SOL from Phantom to Hot Wallet (1 signature)
 * 3. All bundler operations use Hot Wallet (auto-sign, no popups)
 * 4. User can withdraw remaining funds back to Phantom anytime
 */

import { Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, Connection } from '@solana/web3.js';
import bs58 from 'bs58';

const HOT_WALLET_KEY = 'goattools_hot_wallet';
const HOT_WALLET_BACKUP_KEY = 'goattools_hot_wallet_backup';

/**
 * Get or create the hot wallet
 * @returns {Keypair} The hot wallet keypair
 */
export const getOrCreateHotWallet = () => {
  const stored = localStorage.getItem(HOT_WALLET_KEY);
  
  if (stored) {
    try {
      const secretKey = bs58.decode(stored);
      return Keypair.fromSecretKey(secretKey);
    } catch (e) {
      console.error('[HotWallet] Failed to load stored wallet, creating new one');
    }
  }
  
  // Create new hot wallet
  const newWallet = Keypair.generate();
  const privateKeyBase58 = bs58.encode(newWallet.secretKey);
  
  // Store in localStorage
  localStorage.setItem(HOT_WALLET_KEY, privateKeyBase58);
  
  // Also store a backup with timestamp
  const backups = JSON.parse(localStorage.getItem(HOT_WALLET_BACKUP_KEY) || '[]');
  backups.push({
    privateKey: privateKeyBase58,
    publicKey: newWallet.publicKey.toBase58(),
    createdAt: new Date().toISOString()
  });
  localStorage.setItem(HOT_WALLET_BACKUP_KEY, JSON.stringify(backups));
  
  console.log('[HotWallet] Created new hot wallet:', newWallet.publicKey.toBase58());
  return newWallet;
};

/**
 * Get the hot wallet if it exists
 * @returns {Keypair|null}
 */
export const getHotWallet = () => {
  const stored = localStorage.getItem(HOT_WALLET_KEY);
  if (!stored) return null;
  
  try {
    const secretKey = bs58.decode(stored);
    return Keypair.fromSecretKey(secretKey);
  } catch (e) {
    console.error('[HotWallet] Failed to load wallet:', e);
    return null;
  }
};

/**
 * Get hot wallet public key
 * @returns {string|null}
 */
export const getHotWalletAddress = () => {
  const wallet = getHotWallet();
  return wallet ? wallet.publicKey.toBase58() : null;
};

/**
 * Get hot wallet private key (base58)
 * @returns {string|null}
 */
export const getHotWalletPrivateKey = () => {
  return localStorage.getItem(HOT_WALLET_KEY);
};

/**
 * Import an existing private key as the hot wallet
 * @param {string} privateKeyBase58 
 * @returns {Keypair}
 */
export const importHotWallet = (privateKeyBase58) => {
  try {
    const secretKey = bs58.decode(privateKeyBase58.trim());
    const wallet = Keypair.fromSecretKey(secretKey);
    
    // Store it
    localStorage.setItem(HOT_WALLET_KEY, privateKeyBase58.trim());
    
    // Backup
    const backups = JSON.parse(localStorage.getItem(HOT_WALLET_BACKUP_KEY) || '[]');
    backups.push({
      privateKey: privateKeyBase58.trim(),
      publicKey: wallet.publicKey.toBase58(),
      importedAt: new Date().toISOString()
    });
    localStorage.setItem(HOT_WALLET_BACKUP_KEY, JSON.stringify(backups));
    
    console.log('[HotWallet] Imported wallet:', wallet.publicKey.toBase58());
    return wallet;
  } catch (e) {
    throw new Error('Invalid private key format');
  }
};

/**
 * Clear the hot wallet (for logout/reset)
 */
export const clearHotWallet = () => {
  // Don't delete backup, just the active wallet
  localStorage.removeItem(HOT_WALLET_KEY);
  console.log('[HotWallet] Cleared active hot wallet');
};

/**
 * Get all hot wallet backups
 * @returns {Array}
 */
export const getHotWalletBackups = () => {
  return JSON.parse(localStorage.getItem(HOT_WALLET_BACKUP_KEY) || '[]');
};

/**
 * Create a deposit transaction from Phantom to Hot Wallet
 * @param {PublicKey} phantomPublicKey - The connected Phantom wallet
 * @param {number} amountSol - Amount in SOL to deposit
 * @param {Connection} connection - Solana connection
 * @returns {Transaction}
 */
export const createDepositTransaction = async (phantomPublicKey, amountSol, connection) => {
  const hotWallet = getOrCreateHotWallet();
  
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: phantomPublicKey,
      toPubkey: hotWallet.publicKey,
      lamports: Math.floor(amountSol * LAMPORTS_PER_SOL)
    })
  );
  
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = phantomPublicKey;
  
  return transaction;
};

/**
 * Create a withdrawal transaction from Hot Wallet back to Phantom
 * @param {PublicKey} phantomPublicKey - The connected Phantom wallet
 * @param {number} amountSol - Amount in SOL to withdraw (0 = all)
 * @param {Connection} connection - Solana connection
 * @returns {Transaction}
 */
export const createWithdrawTransaction = async (phantomPublicKey, amountSol, connection) => {
  const hotWallet = getHotWallet();
  if (!hotWallet) throw new Error('No hot wallet found');
  
  let lamports;
  if (amountSol === 0) {
    // Withdraw all (minus rent + fee)
    const balance = await connection.getBalance(hotWallet.publicKey);
    lamports = balance - 5000; // Leave small amount for fee
  } else {
    lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
  }
  
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: hotWallet.publicKey,
      toPubkey: phantomPublicKey,
      lamports
    })
  );
  
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = hotWallet.publicKey;
  
  return transaction;
};

/**
 * Sign a transaction with the hot wallet
 * @param {Transaction} transaction 
 * @returns {Transaction}
 */
export const signWithHotWallet = (transaction) => {
  const hotWallet = getHotWallet();
  if (!hotWallet) throw new Error('No hot wallet found');
  
  transaction.sign(hotWallet);
  return transaction;
};

/**
 * Sign and send a transaction using hot wallet
 * @param {Transaction} transaction 
 * @param {Connection} connection 
 * @returns {string} Transaction signature
 */
export const signAndSendWithHotWallet = async (transaction, connection) => {
  const hotWallet = getHotWallet();
  if (!hotWallet) throw new Error('No hot wallet found');
  
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = hotWallet.publicKey;
  
  transaction.sign(hotWallet);
  
  const signature = await connection.sendRawTransaction(transaction.serialize());
  await connection.confirmTransaction(signature);
  
  return signature;
};

/**
 * Get hot wallet balance
 * @param {Connection} connection 
 * @returns {number} Balance in SOL
 */
export const getHotWalletBalance = async (connection) => {
  const hotWallet = getHotWallet();
  if (!hotWallet) return 0;
  
  const balance = await connection.getBalance(hotWallet.publicKey);
  return balance / LAMPORTS_PER_SOL;
};

/**
 * Export hot wallet data for backup
 * @returns {Object}
 */
export const exportHotWalletBackup = () => {
  const hotWallet = getHotWallet();
  if (!hotWallet) return null;
  
  return {
    privateKey: bs58.encode(hotWallet.secretKey),
    publicKey: hotWallet.publicKey.toBase58(),
    exportedAt: new Date().toISOString()
  };
};

export default {
  getOrCreateHotWallet,
  getHotWallet,
  getHotWalletAddress,
  getHotWalletPrivateKey,
  importHotWallet,
  clearHotWallet,
  getHotWalletBackups,
  createDepositTransaction,
  createWithdrawTransaction,
  signWithHotWallet,
  signAndSendWithHotWallet,
  getHotWalletBalance,
  exportHotWalletBackup
};
