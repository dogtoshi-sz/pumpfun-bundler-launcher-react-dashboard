// JavaScript wrapper for trading terminal API
// This file allows the Express server to call TypeScript functions

const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const execAsync = promisify(exec);

// Since we can't directly require TypeScript, we'll use ts-node to execute functions
// For now, let's implement the core functions directly in JavaScript

const base58 = require('bs58').default || require('bs58');
const { Keypair, Connection, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');

const TRADING_WALLETS_FILE = path.join(__dirname, 'keys', 'trading-wallets.json');

// Load trading wallets
const loadTradingWallets = () => {
  try {
    if (fs.existsSync(TRADING_WALLETS_FILE)) {
      const data = JSON.parse(fs.readFileSync(TRADING_WALLETS_FILE, 'utf8'));
      return data.wallets || [];
    }
  } catch (error) {
    console.error('Error loading trading wallets:', error);
  }
  return [];
};

// Save trading wallets
const saveTradingWallets = (wallets) => {
  try {
    const dir = path.dirname(TRADING_WALLETS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(TRADING_WALLETS_FILE, JSON.stringify({ wallets }, null, 2));
  } catch (error) {
    console.error('Error saving trading wallets:', error);
    throw error;
  }
};

// Add trading wallet
const addTradingWallet = (privateKey) => {
  try {
    const kp = Keypair.fromSecretKey(base58.decode(privateKey));
    const wallets = loadTradingWallets();
    
    if (wallets.includes(privateKey)) {
      return { address: kp.publicKey.toBase58() };
    }
    
    wallets.push(privateKey);
    saveTradingWallets(wallets);
    return { address: kp.publicKey.toBase58() };
  } catch (error) {
    throw new Error(`Invalid private key: ${error.message}`);
  }
};

// Remove trading wallet
const removeTradingWallet = (privateKey) => {
  const wallets = loadTradingWallets();
  const filtered = wallets.filter(w => w !== privateKey);
  saveTradingWallets(filtered);
};

// Get trading wallets with balances
const getTradingWallets = async () => {
  const wallets = loadTradingWallets();
  const result = [];
  
  const connection = new Connection(process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com', 'confirmed');
  
  for (const privateKey of wallets) {
    try {
      const kp = Keypair.fromSecretKey(base58.decode(privateKey));
      const balance = await connection.getBalance(kp.publicKey);
      result.push({
        address: kp.publicKey.toBase58(),
        balance: balance / LAMPORTS_PER_SOL,
        privateKey: privateKey.substring(0, 8) + '...' // Only show first 8 chars for security
      });
    } catch (error) {
      console.error(`Error getting balance for wallet:`, error);
    }
  }
  
  return result;
};

// Get wallet token balance
const getWalletTokenBalance = async (walletPrivateKey, mintAddress) => {
  try {
    const walletKp = Keypair.fromSecretKey(base58.decode(walletPrivateKey));
    const mintPubkey = new PublicKey(mintAddress);
    const connection = new Connection(process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com', 'confirmed');
    
    const tokenAccounts = await connection.getTokenAccountsByOwner(walletKp.publicKey, {
      programId: TOKEN_PROGRAM_ID,
    });
    
    for (const account of tokenAccounts.value) {
      const parsed = account.account.data.parsed?.info;
      if (parsed?.mint === mintAddress) {
        const balance = parsed.tokenAmount?.uiAmount || 0;
        return { balance, hasTokens: balance > 0 };
      }
    }
    
    return { balance: 0, hasTokens: false };
  } catch (error) {
    throw new Error(`Error getting token balance: ${error.message}`);
  }
};

// Get private key by wallet address
const getPrivateKeyByAddress = (address) => {
  try {
    const wallets = loadTradingWallets();
    const targetPubkey = new PublicKey(address);
    
    for (const privateKey of wallets) {
      try {
        const kp = Keypair.fromSecretKey(base58.decode(privateKey));
        if (kp.publicKey.equals(targetPubkey)) {
          return privateKey;
        }
      } catch (error) {
        // Skip invalid private keys
        continue;
      }
    }
    
    return null; // Wallet not found
  } catch (error) {
    console.error('Error getting private key by address:', error);
    return null;
  }
};

// Buy/Sell functions - these need to call TypeScript functions via ts-node
// For now, we'll use a simpler approach: call the TypeScript file as a script
const callTradingFunction = async (functionName, args) => {
  const scriptPath = path.join(__dirname, 'trading-terminal-exec.js');
  // We'll create a helper script that can be called
  // For now, return a promise that will be handled by the actual implementation
  throw new Error('Direct TypeScript calls not yet implemented - use API endpoints');
};

module.exports = {
  loadTradingWallets,
  saveTradingWallets,
  addTradingWallet,
  removeTradingWallet,
  getTradingWallets,
  getWalletTokenBalance,
  getPrivateKeyByAddress
};

