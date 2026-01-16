/**
 * Funding Wallet Widget - Compact version
 * 
 * A sleek, minimal widget that sits in the top right of the launch page.
 * Toggle between Phantom (Hot Wallet) and Private Key modes.
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
  createDepositTransaction,
  exportHotWalletBackup
} from '../services/hotWallet';

const FundingWallet = ({ onWalletReady, onSwitchToPrivateKey, className = '' }) => {
  const { publicKey, signTransaction, connected, disconnect } = useWallet();
  const { connection } = useConnection();
  
  const [mode, setMode] = useState('phantom'); // 'phantom' or 'privatekey'
  const [hotWalletAddress, setHotWalletAddress] = useState(null);
  const [hotWalletBalance, setHotWalletBalance] = useState(0);
  const [phantomBalance, setPhantomBalance] = useState(0);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
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
      if (connection) {
        const hotBalance = await getHotWalletBalance(connection);
        setHotWalletBalance(hotBalance);
      }
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
    const interval = setInterval(refreshBalances, 15000);
    return () => clearInterval(interval);
  }, [refreshBalances]);
  
  // Notify parent when wallet is ready
  useEffect(() => {
    if (mode === 'phantom' && hotWalletAddress && hotWalletBalance > 0 && onWalletReady) {
      onWalletReady({ address: hotWalletAddress, balance: hotWalletBalance, mode: 'phantom' });
    }
  }, [hotWalletAddress, hotWalletBalance, onWalletReady, mode]);
  
  // Handle mode switch
  const handleModeSwitch = (newMode) => {
    setMode(newMode);
    if (newMode === 'privatekey' && onSwitchToPrivateKey) {
      onSwitchToPrivateKey();
    }
  };
  
  // Handle deposit
  const handleDeposit = async () => {
    if (!connected || !publicKey || !signTransaction) return;
    
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0 || amount > phantomBalance) {
      setError('Invalid amount');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      const hotWallet = getOrCreateHotWallet();
      setHotWalletAddress(hotWallet.publicKey.toBase58());
      
      const tx = await createDepositTransaction(publicKey, amount, connection);
      const signedTx = await signTransaction(tx);
      const signature = await connection.sendRawTransaction(signedTx.serialize());
      await connection.confirmTransaction(signature);
      
      setDepositAmount('');
      setShowDepositModal(false);
      await refreshBalances();
    } catch (e) {
      setError(e.message || 'Deposit failed');
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div className={`${className}`}>
      {/* Compact Toggle */}
      <div className="flex items-center gap-2 bg-gray-800/80 backdrop-blur-sm rounded-lg px-3 py-2 border border-gray-700/50">
        {/* Mode Toggle */}
        <div className="flex items-center gap-1 text-xs">
          <button
            onClick={() => handleModeSwitch('phantom')}
            className={`px-2 py-1 rounded transition-all ${
              mode === 'phantom'
                ? 'bg-purple-600 text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            🦊
          </button>
          <button
            onClick={() => handleModeSwitch('privatekey')}
            className={`px-2 py-1 rounded transition-all ${
              mode === 'privatekey'
                ? 'bg-orange-600 text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            🔑
          </button>
        </div>
        
        {/* Status Display */}
        {mode === 'phantom' ? (
          <div className="flex items-center gap-2">
            {connected ? (
              <>
                {hotWalletBalance > 0 ? (
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                    <span className="text-xs text-green-400 font-medium">
                      {hotWalletBalance.toFixed(2)} SOL
                    </span>
                    <button
                      onClick={() => setShowDepositModal(true)}
                      className="text-xs text-purple-400 hover:text-purple-300 ml-1"
                      title="Add more funds"
                    >
                      +
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowDepositModal(true)}
                    className="text-xs bg-purple-600 hover:bg-purple-700 text-white px-2 py-1 rounded transition"
                  >
                    Deposit
                  </button>
                )}
                <button
                  onClick={disconnect}
                  className="text-xs text-gray-500 hover:text-gray-300"
                  title="Disconnect"
                >
                  ✕
                </button>
              </>
            ) : (
              <WalletMultiButton 
                className="!bg-purple-600 hover:!bg-purple-700 !h-7 !text-xs !px-3 !py-0 !rounded"
              />
            )}
          </div>
        ) : (
          <span className="text-xs text-orange-400">Using .env key</span>
        )}
      </div>
      
      {/* Deposit Modal */}
      {showDepositModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-white">Deposit to Hot Wallet</h3>
              <button
                onClick={() => setShowDepositModal(false)}
                className="text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            
            {error && (
              <div className="bg-red-900/50 border border-red-600 text-red-200 text-sm px-3 py-2 rounded mb-4">
                {error}
              </div>
            )}
            
            <div className="space-y-4">
              <div>
                <label className="text-sm text-gray-400 mb-1 block">From Phantom</label>
                <div className="text-sm text-white font-mono bg-gray-800 px-3 py-2 rounded">
                  {publicKey?.toBase58().slice(0, 8)}...{publicKey?.toBase58().slice(-8)}
                  <span className="text-gray-500 ml-2">({phantomBalance.toFixed(4)} SOL)</span>
                </div>
              </div>
              
              <div>
                <label className="text-sm text-gray-400 mb-1 block">To Hot Wallet</label>
                <div className="text-sm text-purple-400 font-mono bg-gray-800 px-3 py-2 rounded">
                  {hotWalletAddress?.slice(0, 8)}...{hotWalletAddress?.slice(-8) || 'Will be created'}
                </div>
              </div>
              
              <div>
                <label className="text-sm text-gray-400 mb-1 block">Amount (SOL)</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    placeholder="0.0"
                    className="flex-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700 focus:border-purple-500 focus:outline-none"
                    step="0.1"
                    min="0"
                  />
                  <button
                    onClick={() => setDepositAmount((phantomBalance * 0.95).toFixed(4))}
                    className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded text-sm"
                  >
                    MAX
                  </button>
                </div>
              </div>
              
              <button
                onClick={handleDeposit}
                disabled={loading || !depositAmount}
                className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white py-3 rounded-lg font-medium transition"
              >
                {loading ? 'Depositing...' : 'Deposit & Create Hot Wallet'}
              </button>
              
              <p className="text-xs text-gray-500 text-center">
                You'll sign once. Then all operations auto-sign!
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FundingWallet;
