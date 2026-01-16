/**
 * Wallet Generator Service
 * 
 * Generates Solana wallets entirely client-side.
 * Private keys never leave the browser.
 */

import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import walletStorage, { WALLET_TYPES } from './walletStorage';
import backupService from './backupService';

/**
 * Generate a new Solana keypair
 */
export function generateKeypair() {
  const keypair = Keypair.generate();
  return {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: bs58.encode(keypair.secretKey),
    keypair, // For immediate use
  };
}

/**
 * Import wallet from private key (base58)
 */
export function importFromPrivateKey(privateKeyBase58) {
  try {
    const secretKey = bs58.decode(privateKeyBase58);
    const keypair = Keypair.fromSecretKey(secretKey);
    return {
      publicKey: keypair.publicKey.toBase58(),
      secretKey: privateKeyBase58,
      keypair,
    };
  } catch (err) {
    throw new Error(`Invalid private key: ${err.message}`);
  }
}

/**
 * Generate bundle wallets
 */
export function generateBundleWallets(count, runId) {
  const wallets = [];
  
  for (let i = 0; i < count; i++) {
    const { publicKey, secretKey } = generateKeypair();
    const wallet = {
      address: publicKey,
      privateKey: secretKey,
      type: WALLET_TYPES.BUNDLE,
      runId,
      index: i,
      createdAt: new Date().toISOString(),
    };
    wallets.push(wallet);
  }
  
  // Store in localStorage
  walletStorage.addWallets(wallets);
  
  console.log(`[WalletGenerator] Generated ${count} bundle wallets for run ${runId}`);
  return wallets;
}

/**
 * Generate holder wallets
 */
export function generateHolderWallets(count, runId) {
  const wallets = [];
  
  for (let i = 0; i < count; i++) {
    const { publicKey, secretKey } = generateKeypair();
    const wallet = {
      address: publicKey,
      privateKey: secretKey,
      type: WALLET_TYPES.HOLDER,
      runId,
      index: i,
      createdAt: new Date().toISOString(),
    };
    wallets.push(wallet);
  }
  
  walletStorage.addWallets(wallets);
  console.log(`[WalletGenerator] Generated ${count} holder wallets for run ${runId}`);
  return wallets;
}

/**
 * Generate dev/creator wallet
 */
export function generateDevWallet(runId) {
  const { publicKey, secretKey } = generateKeypair();
  const wallet = {
    address: publicKey,
    privateKey: secretKey,
    type: WALLET_TYPES.DEV,
    runId,
    createdAt: new Date().toISOString(),
  };
  
  walletStorage.addWallet(wallet);
  console.log(`[WalletGenerator] Generated dev wallet for run ${runId}`);
  return wallet;
}

/**
 * Generate intermediary wallets for fund mixing
 * Creates wallets for each hop in the mixing chain
 */
export function generateIntermediaryWallets(config = {}) {
  const {
    hop1Count = 3,  // First hop: direct from funding
    hop2Count = 9,  // Second hop: split further
    hop3Count = 0,  // Third hop (optional)
  } = config;
  
  const result = {
    hop1: [],
    hop2: [],
    hop3: [],
  };
  
  // Generate hop1 wallets
  for (let i = 0; i < hop1Count; i++) {
    const { publicKey, secretKey } = generateKeypair();
    result.hop1.push({
      publicKey,
      secretKey,
      hop: 'hop1',
      index: i,
      createdAt: new Date().toISOString(),
    });
  }
  
  // Generate hop2 wallets
  for (let i = 0; i < hop2Count; i++) {
    const { publicKey, secretKey } = generateKeypair();
    result.hop2.push({
      publicKey,
      secretKey,
      hop: 'hop2',
      index: i,
      createdAt: new Date().toISOString(),
    });
  }
  
  // Generate hop3 wallets (if needed)
  for (let i = 0; i < hop3Count; i++) {
    const { publicKey, secretKey } = generateKeypair();
    result.hop3.push({
      publicKey,
      secretKey,
      hop: 'hop3',
      index: i,
      createdAt: new Date().toISOString(),
    });
  }
  
  // Store in localStorage
  walletStorage.addIntermediaryWallets('hop1', result.hop1);
  walletStorage.addIntermediaryWallets('hop2', result.hop2);
  if (hop3Count > 0) {
    walletStorage.addIntermediaryWallets('hop3', result.hop3);
  }
  
  console.log(`[WalletGenerator] Generated intermediary wallets: hop1=${hop1Count}, hop2=${hop2Count}, hop3=${hop3Count}`);
  return result;
}

/**
 * Generate warmed wallets (pre-created wallets for future runs)
 */
export function generateWarmedWallets(count, type = 'bundle') {
  const wallets = [];
  
  for (let i = 0; i < count; i++) {
    const { publicKey, secretKey } = generateKeypair();
    const wallet = {
      address: publicKey,
      privateKey: secretKey,
      type: `warmed_${type}`,
      isWarmed: true,
      createdAt: new Date().toISOString(),
    };
    wallets.push(wallet);
    walletStorage.addWarmedWallet(wallet);
  }
  
  console.log(`[WalletGenerator] Generated ${count} warmed ${type} wallets`);
  return wallets;
}

/**
 * Generate a complete wallet set for a new run
 */
export function generateRunWalletSet(runId, config = {}) {
  const {
    bundleCount = 24,
    holderCount = 0,
    createDevWallet = true,
    createIntermediaryWallets = true,
    intermediaryConfig = { hop1Count: 3, hop2Count: 9 },
  } = config;
  
  const result = {
    runId,
    bundleWallets: [],
    holderWallets: [],
    devWallet: null,
    intermediaryWallets: null,
    createdAt: new Date().toISOString(),
  };
  
  // Generate bundle wallets
  result.bundleWallets = generateBundleWallets(bundleCount, runId);
  
  // Generate holder wallets
  if (holderCount > 0) {
    result.holderWallets = generateHolderWallets(holderCount, runId);
  }
  
  // Generate dev wallet
  if (createDevWallet) {
    result.devWallet = generateDevWallet(runId);
  }
  
  // Generate intermediary wallets
  if (createIntermediaryWallets) {
    result.intermediaryWallets = generateIntermediaryWallets(intermediaryConfig);
  }
  
  // Auto-backup after generation
  console.log('[WalletGenerator] Triggering auto-backup after wallet generation');
  backupService.scheduleAutoBackup(500);
  
  return result;
}

/**
 * Use warmed wallets for a run instead of generating new ones
 */
export function useWarmedWalletsForRun(runId, count, type = 'bundle') {
  const warmed = walletStorage.getWarmedWallets();
  const available = warmed.filter(w => w.type === `warmed_${type}` && !w.usedInRun);
  
  if (available.length < count) {
    throw new Error(`Not enough warmed ${type} wallets. Have ${available.length}, need ${count}`);
  }
  
  const selected = available.slice(0, count);
  const wallets = [];
  
  for (const w of selected) {
    // Convert warmed wallet to run wallet
    const wallet = {
      address: w.address,
      privateKey: w.privateKey,
      type: type === 'bundle' ? WALLET_TYPES.BUNDLE : WALLET_TYPES.HOLDER,
      runId,
      wasWarmed: true,
      warmedAt: w.createdAt,
      createdAt: new Date().toISOString(),
    };
    
    // Add to wallets storage
    walletStorage.addWallet(wallet);
    
    // Mark warmed wallet as used
    walletStorage.removeWarmedWallet(w.address);
    
    wallets.push(wallet);
  }
  
  console.log(`[WalletGenerator] Used ${count} warmed ${type} wallets for run ${runId}`);
  return wallets;
}

/**
 * Get keypair from stored wallet (for signing)
 */
export function getKeypairForAddress(address) {
  const wallet = walletStorage.getWalletByAddress(address);
  if (!wallet) {
    // Check intermediary wallets
    const intermediary = walletStorage.getAllIntermediaryWalletsFlat();
    const intWallet = intermediary.find(w => w.publicKey === address);
    if (intWallet) {
      return Keypair.fromSecretKey(bs58.decode(intWallet.secretKey));
    }
    throw new Error(`Wallet not found: ${address}`);
  }
  
  return Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
}

/**
 * Get multiple keypairs for batch signing
 */
export function getKeypairsForAddresses(addresses) {
  return addresses.map(addr => getKeypairForAddress(addr));
}

/**
 * Validate private key format
 */
export function isValidPrivateKey(privateKey) {
  try {
    const decoded = bs58.decode(privateKey);
    return decoded.length === 64;
  } catch {
    return false;
  }
}

export default {
  generateKeypair,
  importFromPrivateKey,
  generateBundleWallets,
  generateHolderWallets,
  generateDevWallet,
  generateIntermediaryWallets,
  generateWarmedWallets,
  generateRunWalletSet,
  useWarmedWalletsForRun,
  getKeypairForAddress,
  getKeypairsForAddresses,
  isValidPrivateKey,
};
