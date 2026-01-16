/**
 * Browser Signing Routes
 * 
 * These routes support the browser-based key storage model.
 * They create UNSIGNED transactions that the frontend signs locally.
 * 
 * Security model:
 * - Private keys NEVER sent to server
 * - Server only receives public addresses
 * - Server creates unsigned transactions
 * - Frontend signs locally
 * - Frontend sends signed transactions back
 * - Server submits to Solana network
 */

const express = require('express');
const router = express.Router();

// ============================================
// 🔒 SECURITY MIDDLEWARE - BLOCK PRIVATE KEYS
// ============================================
// This middleware REJECTS any request that contains private keys
// to prevent accidental or malicious key leakage

const PRIVATE_KEY_PATTERNS = [
  /privateKey/i,
  /secretKey/i,
  /private_key/i,
  /secret_key/i,
  /privKey/i,
  /secKey/i,
];

// Check if a string looks like a base58 private key (64 bytes = ~87-88 chars)
function looksLikePrivateKey(value) {
  if (typeof value !== 'string') return false;
  // Base58 private keys are typically 87-88 characters
  // Public keys are typically 43-44 characters
  if (value.length >= 80 && value.length <= 95) {
    // Check if it's valid base58
    const base58Chars = /^[1-9A-HJ-NP-Za-km-z]+$/;
    return base58Chars.test(value);
  }
  return false;
}

// Recursively check object for private keys
function containsPrivateKey(obj, path = '') {
  if (!obj || typeof obj !== 'object') {
    if (looksLikePrivateKey(obj)) {
      console.error(`🚨 SECURITY: Blocked potential private key at ${path}`);
      return true;
    }
    return false;
  }
  
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key;
    
    // Check if key name suggests private key
    if (PRIVATE_KEY_PATTERNS.some(pattern => pattern.test(key))) {
      console.error(`🚨 SECURITY: Blocked private key field: ${currentPath}`);
      return true;
    }
    
    // Recursively check values
    if (containsPrivateKey(value, currentPath)) {
      return true;
    }
  }
  
  return false;
}

// Security middleware - apply to ALL routes
router.use((req, res, next) => {
  // Check request body for private keys
  if (req.body && containsPrivateKey(req.body, 'body')) {
    console.error(`🚨 SECURITY VIOLATION: Request to ${req.path} contained private key data!`);
    console.error(`🚨 IP: ${req.ip}, User-Agent: ${req.get('user-agent')}`);
    return res.status(400).json({
      error: 'SECURITY_VIOLATION',
      message: 'Private keys must NEVER be sent to the server. Sign transactions locally in your browser.',
    });
  }
  
  // Log clean requests
  console.log(`✅ [Browser Signing] ${req.method} ${req.path} - No private keys detected`);
  next();
});
const { 
  Connection, 
  PublicKey, 
  LAMPORTS_PER_SOL, 
  SystemProgram, 
  Transaction,
  VersionedTransaction,
  TransactionMessage,
} = require('@solana/web3.js');
const { 
  TOKEN_PROGRAM_ID, 
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} = require('@solana/spl-token');
const base58 = require('bs58').default || require('bs58');

// RPC connection
const getRpcUrl = () => process.env.HELIUS_RPC_URL || process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const getConnection = () => new Connection(getRpcUrl(), 'confirmed');

// ============================================
// BALANCE & STATUS ENDPOINTS
// ============================================

/**
 * Get SOL balances for multiple wallets
 */
router.post('/balances', async (req, res) => {
  try {
    const { addresses } = req.body;
    
    if (!addresses || !Array.isArray(addresses)) {
      return res.status(400).json({ error: 'addresses array required' });
    }
    
    const connection = getConnection();
    const balances = await Promise.all(
      addresses.map(async (address) => {
        try {
          const pubkey = new PublicKey(address);
          const balance = await connection.getBalance(pubkey);
          return {
            address,
            balance: balance / LAMPORTS_PER_SOL,
            lamports: balance,
          };
        } catch (err) {
          return { address, balance: 0, error: err.message };
        }
      })
    );
    
    const totalSol = balances.reduce((sum, b) => sum + (b.balance || 0), 0);
    
    res.json({
      success: true,
      balances,
      totalSol,
      walletCount: addresses.length,
    });
  } catch (error) {
    console.error('[Browser Signing] Balance check error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get token holdings for multiple wallets
 */
router.post('/holdings', async (req, res) => {
  try {
    const { addresses, mintAddress } = req.body;
    
    if (!addresses || !mintAddress) {
      return res.status(400).json({ error: 'addresses array and mintAddress required' });
    }
    
    const connection = getConnection();
    const mint = new PublicKey(mintAddress);
    
    const holdings = await Promise.all(
      addresses.map(async (address) => {
        try {
          const owner = new PublicKey(address);
          const ata = await getAssociatedTokenAddress(mint, owner);
          
          const accountInfo = await connection.getTokenAccountBalance(ata);
          return {
            address,
            tokenAccount: ata.toBase58(),
            balance: accountInfo.value.uiAmount,
            rawBalance: accountInfo.value.amount,
          };
        } catch (err) {
          return { address, balance: 0, error: 'No token account' };
        }
      })
    );
    
    const totalTokens = holdings.reduce((sum, h) => sum + (h.balance || 0), 0);
    
    res.json({
      success: true,
      holdings,
      totalTokens,
      mintAddress,
    });
  } catch (error) {
    console.error('[Browser Signing] Holdings check error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// UNSIGNED TRANSACTION CREATION
// ============================================

/**
 * Create unsigned gather transactions
 * Sends SOL from multiple wallets to a single destination
 */
router.post('/gather-unsigned', async (req, res) => {
  try {
    const { walletAddresses, destinationAddress } = req.body;
    
    if (!walletAddresses || !destinationAddress) {
      return res.status(400).json({ error: 'walletAddresses and destinationAddress required' });
    }
    
    const connection = getConnection();
    const destination = new PublicKey(destinationAddress);
    
    // Get recent blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    
    const transactions = [];
    
    for (const address of walletAddresses) {
      const from = new PublicKey(address);
      const balance = await connection.getBalance(from);
      
      // Skip if balance too low (need some for tx fee)
      if (balance < 6000) continue;
      
      // Leave ~5000 lamports for fee
      const transferAmount = balance - 5000;
      
      const instruction = SystemProgram.transfer({
        fromPubkey: from,
        toPubkey: destination,
        lamports: transferAmount,
      });
      
      const messageV0 = new TransactionMessage({
        payerKey: from,
        recentBlockhash: blockhash,
        instructions: [instruction],
      }).compileToV0Message();
      
      const tx = new VersionedTransaction(messageV0);
      
      transactions.push({
        transaction: base58.encode(tx.serialize()),
        signers: [address],
        isVersioned: true,
        fromAddress: address,
        amount: transferAmount / LAMPORTS_PER_SOL,
      });
    }
    
    res.json({
      success: true,
      transactions,
      destination: destinationAddress,
      blockhash,
      lastValidBlockHeight,
    });
  } catch (error) {
    console.error('[Browser Signing] Gather unsigned error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Create unsigned intermediary recovery transactions
 */
router.post('/recover-intermediary-unsigned', async (req, res) => {
  try {
    const { intermediaryAddresses, destinationAddress } = req.body;
    
    if (!intermediaryAddresses || !destinationAddress) {
      return res.status(400).json({ error: 'intermediaryAddresses and destinationAddress required' });
    }
    
    const connection = getConnection();
    const destination = new PublicKey(destinationAddress);
    
    // Check balances first
    const balances = await Promise.all(
      intermediaryAddresses.map(async (address) => {
        try {
          const pubkey = new PublicKey(address);
          const balance = await connection.getBalance(pubkey);
          return { address, balance };
        } catch {
          return { address, balance: 0 };
        }
      })
    );
    
    const totalBalance = balances.reduce((sum, b) => sum + b.balance, 0);
    const walletsWithBalance = balances.filter(b => b.balance > 6000);
    
    if (walletsWithBalance.length === 0) {
      return res.json({
        success: true,
        transactions: [],
        totalBalance: 0,
        message: 'No intermediary wallets with balance to recover',
      });
    }
    
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const transactions = [];
    
    for (const { address, balance } of walletsWithBalance) {
      const from = new PublicKey(address);
      const transferAmount = balance - 5000; // Leave for fee
      
      const instruction = SystemProgram.transfer({
        fromPubkey: from,
        toPubkey: destination,
        lamports: transferAmount,
      });
      
      const messageV0 = new TransactionMessage({
        payerKey: from,
        recentBlockhash: blockhash,
        instructions: [instruction],
      }).compileToV0Message();
      
      const tx = new VersionedTransaction(messageV0);
      
      transactions.push({
        transaction: base58.encode(tx.serialize()),
        signerAddress: address,
        isVersioned: true,
        amount: transferAmount / LAMPORTS_PER_SOL,
      });
    }
    
    res.json({
      success: true,
      transactions,
      totalBalance: totalBalance / LAMPORTS_PER_SOL,
      walletsToRecover: walletsWithBalance.length,
      blockhash,
      lastValidBlockHeight,
    });
  } catch (error) {
    console.error('[Browser Signing] Recover intermediary error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// SIGNED TRANSACTION SUBMISSION
// ============================================

/**
 * Submit signed transactions
 */
router.post('/submit-signed', async (req, res) => {
  try {
    const { transactions } = req.body;
    
    if (!transactions || !Array.isArray(transactions)) {
      return res.status(400).json({ error: 'transactions array required' });
    }
    
    const connection = getConnection();
    const results = [];
    
    for (const txData of transactions) {
      try {
        const { transaction: serialized, isVersioned } = txData;
        const buffer = base58.decode(serialized);
        
        let tx;
        if (isVersioned) {
          tx = VersionedTransaction.deserialize(buffer);
        } else {
          tx = Transaction.from(buffer);
        }
        
        const signature = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
        });
        
        results.push({
          success: true,
          signature,
          wallet: txData.wallet,
        });
      } catch (err) {
        results.push({
          success: false,
          error: err.message,
          wallet: txData.wallet,
        });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    
    res.json({
      success: successCount > 0,
      results,
      successCount,
      failCount: results.length - successCount,
    });
  } catch (error) {
    console.error('[Browser Signing] Submit signed error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Submit recovery transactions
 */
router.post('/submit-recovery', async (req, res) => {
  try {
    const { transactions } = req.body;
    
    if (!transactions || !Array.isArray(transactions)) {
      return res.status(400).json({ error: 'transactions array required' });
    }
    
    const connection = getConnection();
    const results = [];
    let totalRecovered = 0;
    
    for (const txData of transactions) {
      try {
        const { transaction: serialized, isVersioned } = txData;
        const buffer = base58.decode(serialized);
        
        let tx;
        if (isVersioned) {
          tx = VersionedTransaction.deserialize(buffer);
        } else {
          tx = Transaction.from(buffer);
        }
        
        const signature = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
        });
        
        // Confirm transaction
        await connection.confirmTransaction(signature, 'confirmed');
        
        results.push({
          success: true,
          signature,
          wallet: txData.wallet,
        });
        totalRecovered += txData.amount || 0;
      } catch (err) {
        results.push({
          success: false,
          error: err.message,
          wallet: txData.wallet,
        });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    
    res.json({
      success: successCount > 0,
      results,
      successCount,
      failCount: results.length - successCount,
      totalRecovered,
    });
  } catch (error) {
    console.error('[Browser Signing] Submit recovery error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Submit gather transactions
 */
router.post('/submit-gathers', async (req, res) => {
  try {
    const { transactions } = req.body;
    
    if (!transactions || !Array.isArray(transactions)) {
      return res.status(400).json({ error: 'transactions array required' });
    }
    
    const connection = getConnection();
    const results = [];
    let totalGathered = 0;
    
    // Submit in parallel for speed
    const promises = transactions.map(async (txData) => {
      try {
        const { transaction: serialized, isVersioned } = txData;
        const buffer = base58.decode(serialized);
        
        let tx;
        if (isVersioned) {
          tx = VersionedTransaction.deserialize(buffer);
        } else {
          tx = Transaction.from(buffer);
        }
        
        const signature = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
        });
        
        return {
          success: true,
          signature,
          wallet: txData.wallet,
          amount: txData.amount,
        };
      } catch (err) {
        return {
          success: false,
          error: err.message,
          wallet: txData.wallet,
        };
      }
    });
    
    const results2 = await Promise.all(promises);
    
    for (const result of results2) {
      results.push(result);
      if (result.success && result.amount) {
        totalGathered += result.amount;
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    
    res.json({
      success: successCount > 0,
      results,
      successCount,
      failCount: results.length - successCount,
      totalGathered,
    });
  } catch (error) {
    console.error('[Browser Signing] Submit gathers error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
