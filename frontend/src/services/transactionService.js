/**
 * Transaction Service
 * 
 * Handles transaction creation and LOCAL signing.
 * Private keys never leave the browser.
 * 
 * Flow:
 * 1. Frontend requests unsigned transaction from API
 * 2. API returns serialized unsigned transaction
 * 3. Frontend signs transaction locally using stored keys
 * 4. Frontend sends signed transaction back to API
 * 5. API submits to Solana network
 */

import { Connection, Transaction, VersionedTransaction, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import walletGenerator from './walletGenerator';
import walletStorage from './walletStorage';
import backupService from './backupService';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/**
 * Sign a transaction locally
 */
export function signTransaction(transaction, signerAddresses) {
  const keypairs = walletGenerator.getKeypairsForAddresses(signerAddresses);
  
  if (transaction instanceof VersionedTransaction) {
    transaction.sign(keypairs);
  } else {
    for (const keypair of keypairs) {
      transaction.sign(keypair);
    }
  }
  
  return transaction;
}

/**
 * Sign a serialized transaction
 */
export function signSerializedTransaction(serializedTx, signerAddresses, isVersioned = false) {
  const buffer = bs58.decode(serializedTx);
  
  let transaction;
  if (isVersioned) {
    transaction = VersionedTransaction.deserialize(buffer);
  } else {
    transaction = Transaction.from(buffer);
  }
  
  return signTransaction(transaction, signerAddresses);
}

/**
 * Request unsigned transaction from API and sign it locally
 */
export async function requestAndSignTransaction(endpoint, params, signerAddresses) {
  // Request unsigned transaction from API
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...params,
      // Only send public addresses, NEVER private keys
      signers: signerAddresses,
    }),
  });
  
  if (!response.ok) {
    throw new Error(`API error: ${response.statusText}`);
  }
  
  const { transaction: serializedTx, isVersioned } = await response.json();
  
  // Sign locally
  const signedTx = signSerializedTransaction(serializedTx, signerAddresses, isVersioned);
  
  return signedTx;
}

/**
 * Submit signed transaction to API for broadcast
 */
export async function submitSignedTransaction(signedTransaction, options = {}) {
  const serialized = signedTransaction instanceof VersionedTransaction
    ? bs58.encode(signedTransaction.serialize())
    : bs58.encode(signedTransaction.serialize({ requireAllSignatures: true }));
  
  const response = await fetch(`${API_BASE}/api/transactions/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transaction: serialized,
      isVersioned: signedTransaction instanceof VersionedTransaction,
      ...options,
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Submit error: ${response.statusText}`);
  }
  
  return response.json();
}

/**
 * Full flow: request, sign locally, submit
 */
export async function executeTransaction(endpoint, params, signerAddresses, options = {}) {
  // Step 1: Request unsigned tx from API
  const signedTx = await requestAndSignTransaction(endpoint, params, signerAddresses);
  
  // Step 2: Submit signed tx
  const result = await submitSignedTransaction(signedTx, options);
  
  return result;
}

// ============================================
// BUNDLE OPERATIONS (Local Signing)
// ============================================

/**
 * Create and launch a bundle with local signing
 */
export async function launchBundle(config) {
  const {
    tokenName,
    tokenSymbol,
    tokenDescription,
    imageUrl,
    twitter,
    telegram,
    website,
    initialBuyAmount,
    bundleWalletCount = 24,
    useWarmedWallets = false,
  } = config;
  
  // Generate or get wallets
  const runId = `run-${Date.now()}`;
  let bundleWallets, devWallet, intermediaryWallets;
  
  if (useWarmedWallets) {
    bundleWallets = walletGenerator.useWarmedWalletsForRun(runId, bundleWalletCount, 'bundle');
    devWallet = walletGenerator.generateDevWallet(runId);
    intermediaryWallets = walletStorage.getIntermediaryWallets();
  } else {
    const walletSet = walletGenerator.generateRunWalletSet(runId, {
      bundleCount: bundleWalletCount,
      createDevWallet: true,
      createIntermediaryWallets: true,
    });
    bundleWallets = walletSet.bundleWallets;
    devWallet = walletSet.devWallet;
    intermediaryWallets = walletSet.intermediaryWallets;
  }
  
  // Create run in storage
  walletStorage.createNewRun(null, {
    tokenName,
    tokenSymbol,
    bundleWalletCount,
  });
  
  // Step 1: Request unsigned bundle creation transaction
  const response = await fetch(`${API_BASE}/api/bundles/create-unsigned`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // Token info
      tokenName,
      tokenSymbol,
      tokenDescription,
      imageUrl,
      twitter,
      telegram,
      website,
      initialBuyAmount,
      
      // Only addresses, NEVER keys
      devWalletAddress: devWallet.address,
      bundleWalletAddresses: bundleWallets.map(w => w.address),
      intermediaryAddresses: {
        hop1: intermediaryWallets.hop1?.map(w => w.publicKey) || [],
        hop2: intermediaryWallets.hop2?.map(w => w.publicKey) || [],
      },
    }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to create bundle');
  }
  
  const { transactions, mintAddress } = await response.json();
  
  // Update run with mint address
  walletStorage.updateRunStatus('signing', { mintAddress });
  
  // Step 2: Sign all transactions locally
  const signedTransactions = [];
  
  for (const txData of transactions) {
    const { transaction: serializedTx, signers: signerAddresses, isVersioned } = txData;
    const signedTx = signSerializedTransaction(serializedTx, signerAddresses, isVersioned);
    signedTransactions.push({
      transaction: signedTx instanceof VersionedTransaction
        ? bs58.encode(signedTx.serialize())
        : bs58.encode(signedTx.serialize({ requireAllSignatures: true })),
      isVersioned,
    });
  }
  
  // Step 3: Submit signed transactions
  walletStorage.updateRunStatus('submitting');
  
  const submitResponse = await fetch(`${API_BASE}/api/bundles/submit-signed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transactions: signedTransactions,
      mintAddress,
      runId,
    }),
  });
  
  if (!submitResponse.ok) {
    walletStorage.updateRunStatus('failed');
    throw new Error('Failed to submit bundle');
  }
  
  const result = await submitResponse.json();
  
  // Update run status
  if (result.success) {
    walletStorage.updateRunStatus('launched', {
      signature: result.signature,
      mintAddress: result.mintAddress,
    });
    
    // Auto-backup after successful launch
    backupService.autoBackupCurrentRun();
  } else {
    walletStorage.updateRunStatus('failed', { error: result.error });
  }
  
  return result;
}

/**
 * Sell tokens from bundle wallets (local signing)
 */
export async function sellFromWallets(walletAddresses, percentage = 100, options = {}) {
  // Request unsigned sell transactions
  const response = await fetch(`${API_BASE}/api/bundles/sell-unsigned`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      walletAddresses,
      percentage,
      ...options,
    }),
  });
  
  if (!response.ok) {
    throw new Error('Failed to create sell transactions');
  }
  
  const { transactions } = await response.json();
  
  // Sign all locally
  const signedTransactions = [];
  for (const txData of transactions) {
    const { transaction: serializedTx, signers, isVersioned } = txData;
    const signedTx = signSerializedTransaction(serializedTx, signers, isVersioned);
    signedTransactions.push({
      transaction: signedTx instanceof VersionedTransaction
        ? bs58.encode(signedTx.serialize())
        : bs58.encode(signedTx.serialize({ requireAllSignatures: true })),
      isVersioned,
      wallet: signers[0],
    });
  }
  
  // Submit signed transactions
  const submitResponse = await fetch(`${API_BASE}/api/bundles/submit-sells`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactions: signedTransactions }),
  });
  
  return submitResponse.json();
}

/**
 * Gather SOL from bundle wallets back to funding (local signing)
 */
export async function gatherFunds(walletAddresses, destinationAddress) {
  // Request unsigned gather transactions
  const response = await fetch(`${API_BASE}/api/bundles/gather-unsigned`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      walletAddresses,
      destinationAddress,
    }),
  });
  
  if (!response.ok) {
    throw new Error('Failed to create gather transactions');
  }
  
  const { transactions } = await response.json();
  
  // Sign all locally
  const signedTransactions = [];
  for (const txData of transactions) {
    const { transaction: serializedTx, signers, isVersioned } = txData;
    const signedTx = signSerializedTransaction(serializedTx, signers, isVersioned);
    signedTransactions.push({
      transaction: signedTx instanceof VersionedTransaction
        ? bs58.encode(signedTx.serialize())
        : bs58.encode(signedTx.serialize({ requireAllSignatures: true })),
      isVersioned,
    });
  }
  
  // Submit signed transactions
  const submitResponse = await fetch(`${API_BASE}/api/bundles/submit-gathers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactions: signedTransactions }),
  });
  
  return submitResponse.json();
}

/**
 * Recover funds from intermediary wallets (local signing)
 */
export async function recoverIntermediaryFunds(destinationAddress) {
  const intermediary = walletStorage.getAllIntermediaryWalletsFlat();
  
  if (intermediary.length === 0) {
    throw new Error('No intermediary wallets found');
  }
  
  // Request unsigned recovery transactions
  const response = await fetch(`${API_BASE}/api/bundles/recover-intermediary-unsigned`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intermediaryAddresses: intermediary.map(w => w.publicKey),
      destinationAddress,
    }),
  });
  
  if (!response.ok) {
    throw new Error('Failed to create recovery transactions');
  }
  
  const { transactions, totalBalance } = await response.json();
  
  if (transactions.length === 0) {
    return { success: true, message: 'No funds to recover', recovered: 0 };
  }
  
  // Sign all locally
  const signedTransactions = [];
  for (const txData of transactions) {
    const { transaction: serializedTx, signerAddress, isVersioned } = txData;
    
    // Find the intermediary wallet with this address
    const intWallet = intermediary.find(w => w.publicKey === signerAddress);
    if (!intWallet) {
      console.warn(`Signer not found: ${signerAddress}`);
      continue;
    }
    
    // Sign with intermediary wallet
    const buffer = bs58.decode(serializedTx);
    let transaction;
    if (isVersioned) {
      transaction = VersionedTransaction.deserialize(buffer);
    } else {
      transaction = Transaction.from(buffer);
    }
    
    const keypair = walletGenerator.importFromPrivateKey(intWallet.secretKey).keypair;
    if (isVersioned) {
      transaction.sign([keypair]);
    } else {
      transaction.sign(keypair);
    }
    
    signedTransactions.push({
      transaction: transaction instanceof VersionedTransaction
        ? bs58.encode(transaction.serialize())
        : bs58.encode(transaction.serialize({ requireAllSignatures: true })),
      isVersioned,
      wallet: signerAddress,
    });
  }
  
  // Submit signed transactions
  const submitResponse = await fetch(`${API_BASE}/api/bundles/submit-recovery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactions: signedTransactions }),
  });
  
  const result = await submitResponse.json();
  
  // Clear intermediary wallets if successful
  if (result.success) {
    walletStorage.clearIntermediaryWallets();
    backupService.autoBackupFull();
  }
  
  return result;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Check balances for wallets (doesn't need signing)
 */
export async function checkBalances(walletAddresses) {
  const response = await fetch(`${API_BASE}/api/wallets/balances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addresses: walletAddresses }),
  });
  
  return response.json();
}

/**
 * Get token holdings for wallets
 */
export async function getTokenHoldings(walletAddresses, mintAddress) {
  const response = await fetch(`${API_BASE}/api/wallets/holdings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addresses: walletAddresses, mintAddress }),
  });
  
  return response.json();
}

export default {
  signTransaction,
  signSerializedTransaction,
  requestAndSignTransaction,
  submitSignedTransaction,
  executeTransaction,
  launchBundle,
  sellFromWallets,
  gatherFunds,
  recoverIntermediaryFunds,
  checkBalances,
  getTokenHoldings,
};
