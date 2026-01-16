/**
 * Funding Wallet Component
 * 
 * Provides two options for users to set up their funding wallet:
 * 1. Connect Phantom → Deposit to Hot Wallet (recommended)
 * 2. Paste Private Key directly
 * 
 * The Hot Wallet allows all subsequent operations to auto-sign.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  getOrCreateHotWallet,
  getHotWallet,
  getHotWalletAddress,
  getHotWalletBalance,
  importHotWallet,
  clearHotWallet,
  createDepositTransaction,
  createWithdrawTransaction,
  signAndSendWithHotWallet,
  exportHotWalletBackup
} from '../services/hotWallet';

const FundingWallet = ({ onWalletReady, className = '' }) => {
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();
  
  const [mode, setMode] = useState('phantom'); // 'phantom' or 'privatekey'
  const [hotWalletAddress, setHotWalletAddress] = useState(null);
  const [hotWalletBalance, setHotWalletBalance] = useState(0);
  const [phantomBalance, setPhantomBalance] = useState(0);
  const [depositAmount, setDepositAmount] = useState('');
  const [privateKeyInput, setPrivateKeyInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Initialize hot wallet on mount
  useEffect(() => {
    const wallet = getHotWallet();
    if (wallet) {
      setHotWalletAddress(wallet.publicKey.toBase58());
    }
  }, []);
  
  // Fetch balances
  const refreshBalances = useCallback(async () => {
    try {
      // Hot wallet balance
      if (connection) {
        const hotBalance = await getHotWalletBalance(connection);
        setHotWalletBalance(hotBalance);
      }
      
      // Phantom balance
      if (connected && publicKey && connection) {
        const balance = await connection.getBalance(publicKey);
        setPhantomBalance(balance / LAMPORTS_PER_SOL);
      }
    } catch (e) {
      console.error('[FundingWallet] Error fetching balances:', e);
    }
  }, [connection, connected, publicKey]);
  
  useEffect(() => {
    refreshBalances();
    const interval = setInterval(refreshBalances, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, [refreshBalances]);
  
  // Notify parent when wallet is ready
  useEffect(() => {
    if (hotWalletAddress && hotWalletBalance > 0 && onWalletReady) {
      onWalletReady({
        address: hotWalletAddress,
        balance: hotWalletBalance
      });
    }
  }, [hotWalletAddress, hotWalletBalance, onWalletReady]);
  
  // Handle deposit from Phantom to Hot Wallet
  const handleDeposit = async () => {
    if (!connected || !publicKey || !signTransaction) {
      setError('Please connect your Phantom wallet first');
      return;
    }
    
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    
    if (amount > phantomBalance) {
      setError('Insufficient balance in Phantom');
      return;
    }
    
    setLoading(true);
    setError('');
    setSuccess('');
    
    try {
      // Create or get hot wallet
      const hotWallet = getOrCreateHotWallet();
      setHotWalletAddress(hotWallet.publicKey.toBase58());
      
      // Create deposit transaction
      const tx = await createDepositTransaction(publicKey, amount, connection);
      
      // Sign with Phantom
      const signedTx = await signTransaction(tx);
      
      // Send transaction
      const signature = await connection.sendRawTransaction(signedTx.serialize());
      await connection.confirmTransaction(signature);
      
      setSuccess(`Deposited ${amount} SOL to Hot Wallet! Tx: ${signature.slice(0, 8)}...`);
      setDepositAmount('');
      await refreshBalances();
    } catch (e) {
      console.error('[FundingWallet] Deposit error:', e);
      setError(e.message || 'Deposit failed');
    } finally {
      setLoading(false);
    }
  };
  
  // Handle withdraw from Hot Wallet back to Phantom
  const handleWithdraw = async () => {
    if (!connected || !publicKey) {
      setError('Please connect your Phantom wallet first');
      return;
    }
    
    if (hotWalletBalance <= 0) {
      setError('No funds in Hot Wallet to withdraw');
      return;
    }
    
    setLoading(true);
    setError('');
    setSuccess('');
    
    try {
      const tx = await createWithdrawTransaction(publicKey, 0, connection); // 0 = withdraw all
      const signature = await signAndSendWithHotWallet(tx, connection);
      
      setSuccess(`Withdrew all funds back to Phantom! Tx: ${signature.slice(0, 8)}...`);
      await refreshBalances();
    } catch (e) {
      console.error('[FundingWallet] Withdraw error:', e);
      setError(e.message || 'Withdraw failed');
    } finally {
      setLoading(false);
    }
  };
  
  // Handle private key import
  const handleImportPrivateKey = () => {
    if (!privateKeyInput.trim()) {
      setError('Please enter a private key');
      return;
    }
    
    setLoading(true);
    setError('');
    setSuccess('');
    
    try {
      const wallet = importHotWallet(privateKeyInput);
      setHotWalletAddress(wallet.publicKey.toBase58());
      setPrivateKeyInput('');
      setSuccess('Private key imported successfully!');
      refreshBalances();
    } catch (e) {
      setError(e.message || 'Invalid private key');
    } finally {
      setLoading(false);
    }
  };
  
  // Handle hot wallet reset
  const handleResetHotWallet = () => {
    if (window.confirm('Are you sure? Make sure you have backed up your hot wallet or withdrawn all funds!')) {
      clearHotWallet();
      setHotWalletAddress(null);
      setHotWalletBalance(0);
      setSuccess('Hot wallet cleared');
    }
  };
  
  // Download backup
  const handleDownloadBackup = () => {
    const backup = exportHotWalletBackup();
    if (!backup) {
      setError('No hot wallet to backup');
      return;
    }
    
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hot-wallet-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setSuccess('Backup downloaded!');
  };
  
  return (
    <div className={`bg-gray-800 rounded-lg p-6 ${className}`}>
      <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
        🔥 Funding Wallet
      </h2>
      
      {/* Mode Toggle */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setMode('phantom')}
          className={`flex-1 py-2 px-4 rounded-lg font-medium transition ${
            mode === 'phantom'
              ? 'bg-purple-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          🦊 Connect Phantom
        </button>
        <button
          onClick={() => setMode('privatekey')}
          className={`flex-1 py-2 px-4 rounded-lg font-medium transition ${
            mode === 'privatekey'
              ? 'bg-orange-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          🔑 Use Private Key
        </button>
      </div>
      
      {/* Error/Success Messages */}
      {error && (
        <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-2 rounded-lg mb-4">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-900/50 border border-green-500 text-green-200 px-4 py-2 rounded-lg mb-4">
          {success}
        </div>
      )}
      
      {/* Hot Wallet Status */}
      {hotWalletAddress && (
        <div className="bg-gray-700/50 rounded-lg p-4 mb-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-gray-400">🔥 Hot Wallet</span>
            <span className="text-green-400 font-bold">{hotWalletBalance.toFixed(4)} SOL</span>
          </div>
          <div className="text-sm text-gray-400 font-mono break-all">
            {hotWalletAddress}
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleDownloadBackup}
              className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded"
            >
              📥 Backup
            </button>
            <button
              onClick={handleResetHotWallet}
              className="text-xs bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded"
            >
              🗑️ Reset
            </button>
          </div>
        </div>
      )}
      
      {/* Phantom Mode */}
      {mode === 'phantom' && (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <WalletMultiButton className="!bg-purple-600 hover:!bg-purple-700" />
            {connected && (
              <span className="text-gray-400">
                Balance: <span className="text-white font-bold">{phantomBalance.toFixed(4)} SOL</span>
              </span>
            )}
          </div>
          
          {connected && (
            <>
              {/* Deposit Section */}
              <div className="bg-gray-700/30 rounded-lg p-4">
                <h3 className="text-white font-medium mb-3">Deposit to Hot Wallet</h3>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    placeholder="Amount in SOL"
                    className="flex-1 bg-gray-700 text-white px-4 py-2 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                    step="0.1"
                    min="0"
                  />
                  <button
                    onClick={() => setDepositAmount(phantomBalance.toFixed(4))}
                    className="bg-gray-600 hover:bg-gray-500 text-white px-3 py-2 rounded-lg text-sm"
                  >
                    MAX
                  </button>
                  <button
                    onClick={handleDeposit}
                    disabled={loading || !depositAmount}
                    className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-medium"
                  >
                    {loading ? '...' : 'Deposit'}
                  </button>
                </div>
                <p className="text-gray-500 text-xs mt-2">
                  ✨ One signature deposits SOL to your Hot Wallet for unlimited auto-signing
                </p>
              </div>
              
              {/* Withdraw Section */}
              {hotWalletBalance > 0 && (
                <div className="bg-gray-700/30 rounded-lg p-4">
                  <h3 className="text-white font-medium mb-3">Withdraw to Phantom</h3>
                  <button
                    onClick={handleWithdraw}
                    disabled={loading}
                    className="bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-medium"
                  >
                    {loading ? '...' : `Withdraw All (${hotWalletBalance.toFixed(4)} SOL)`}
                  </button>
                </div>
              )}
            </>
          )}
          
          {!connected && (
            <p className="text-gray-400 text-sm">
              Connect your Phantom wallet to deposit funds to your Hot Wallet.
              You'll sign once to deposit, then all operations will auto-sign!
            </p>
          )}
        </div>
      )}
      
      {/* Private Key Mode */}
      {mode === 'privatekey' && (
        <div className="space-y-4">
          <div className="bg-yellow-900/30 border border-yellow-600 rounded-lg p-3 mb-4">
            <p className="text-yellow-200 text-sm">
              ⚠️ Your private key is stored in your browser only and never sent to any server.
              Make sure to backup your key and clear it when done.
            </p>
          </div>
          
          <div className="flex gap-2">
            <input
              type="password"
              value={privateKeyInput}
              onChange={(e) => setPrivateKeyInput(e.target.value)}
              placeholder="Paste your private key (base58)"
              className="flex-1 bg-gray-700 text-white px-4 py-2 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none font-mono"
            />
            <button
              onClick={handleImportPrivateKey}
              disabled={loading || !privateKeyInput}
              className="bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-medium"
            >
              {loading ? '...' : 'Import'}
            </button>
          </div>
        </div>
      )}
      
      {/* Ready Status */}
      {hotWalletAddress && hotWalletBalance > 0 && (
        <div className="mt-4 bg-green-900/30 border border-green-600 rounded-lg p-3">
          <p className="text-green-200 text-sm flex items-center gap-2">
            ✅ Hot Wallet ready with {hotWalletBalance.toFixed(4)} SOL - All operations will auto-sign!
          </p>
        </div>
      )}
    </div>
  );
};

export default FundingWallet;
