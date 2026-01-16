/**
 * Funding Wallet Widget - Sleek Header Component
 * 
 * A minimal, elegant widget for the header.
 * Toggle between Phantom and Private Key modes.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  WalletIcon,
  KeyIcon,
  ArrowDownTrayIcon,
  XMarkIcon,
  CheckCircleIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';
import {
  getOrCreateHotWallet,
  getHotWallet,
  getHotWalletBalance,
  createDepositTransaction,
} from '../services/hotWallet';

// Phantom logo SVG
const PhantomLogo = ({ className = "w-4 h-4" }) => (
  <svg className={className} viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="64" cy="64" r="64" fill="url(#phantom-gradient)"/>
    <path d="M110.584 64.9142H99.142C99.142 41.7651 80.173 23 56.7724 23C33.6612 23 14.8716 41.3057 14.4169 64.0026C13.9504 87.2909 33.2571 107.166 56.7724 107.166H60.6927C81.9873 107.166 110.584 85.1728 110.584 64.9142Z" fill="url(#phantom-gradient-2)"/>
    <path d="M86.7918 64.9142C86.7918 68.1764 84.1172 70.8274 80.8254 70.8274C77.5337 70.8274 74.859 68.1764 74.859 64.9142C74.859 61.6521 77.5337 59.001 80.8254 59.001C84.1172 59.001 86.7918 61.6521 86.7918 64.9142Z" fill="#fff"/>
    <path d="M66.0137 64.9142C66.0137 68.1764 63.339 70.8274 60.0473 70.8274C56.7556 70.8274 54.0809 68.1764 54.0809 64.9142C54.0809 61.6521 56.7556 59.001 60.0473 59.001C63.339 59.001 66.0137 61.6521 66.0137 64.9142Z" fill="#fff"/>
    <path d="M45.2357 64.9142C45.2357 68.1764 42.561 70.8274 39.2693 70.8274C35.9776 70.8274 33.3029 68.1764 33.3029 64.9142C33.3029 61.6521 35.9776 59.001 39.2693 59.001C42.561 59.001 45.2357 61.6521 45.2357 64.9142Z" fill="#fff"/>
    <defs>
      <linearGradient id="phantom-gradient" x1="64" y1="0" x2="64" y2="128" gradientUnits="userSpaceOnUse">
        <stop stopColor="#534BB1"/>
        <stop offset="1" stopColor="#551BF9"/>
      </linearGradient>
      <linearGradient id="phantom-gradient-2" x1="62.5" y1="23" x2="62.5" y2="107.166" gradientUnits="userSpaceOnUse">
        <stop stopColor="#fff"/>
        <stop offset="1" stopColor="#fff" stopOpacity="0.82"/>
      </linearGradient>
    </defs>
  </svg>
);

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
  const [refreshing, setRefreshing] = useState(false);
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
    setRefreshing(true);
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
    } finally {
      setRefreshing(false);
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
      {/* Compact Header Widget */}
      <div className="flex items-center h-9">
        {/* Mode Toggle - Pill Style */}
        <div className="flex items-center bg-gray-900/80 rounded-l-lg border border-gray-800 border-r-0 h-full">
          <button
            onClick={() => handleModeSwitch('phantom')}
            className={`flex items-center gap-1.5 px-3 h-full rounded-l-lg transition-all text-xs font-medium ${
              mode === 'phantom'
                ? 'bg-purple-600/20 text-purple-400 border-r border-purple-500/30'
                : 'text-gray-500 hover:text-gray-300'
            }`}
            title="Connect Phantom"
          >
            <PhantomLogo className="w-3.5 h-3.5" />
            {mode === 'phantom' && <span className="hidden sm:inline">Phantom</span>}
          </button>
          <button
            onClick={() => handleModeSwitch('privatekey')}
            className={`flex items-center gap-1.5 px-3 h-full transition-all text-xs font-medium ${
              mode === 'privatekey'
                ? 'bg-amber-600/20 text-amber-400'
                : 'text-gray-500 hover:text-gray-300'
            }`}
            title="Use Private Key"
          >
            <KeyIcon className="w-3.5 h-3.5" />
            {mode === 'privatekey' && <span className="hidden sm:inline">Key</span>}
          </button>
        </div>
        
        {/* Status/Action Area */}
        <div className="flex items-center bg-gray-900/80 rounded-r-lg border border-gray-800 h-full px-3 gap-2">
          {mode === 'phantom' ? (
            connected ? (
              <>
                {hotWalletBalance > 0 ? (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                      <span className="text-xs text-emerald-400 font-mono font-medium">
                        {hotWalletBalance.toFixed(3)}
                      </span>
                      <span className="text-[10px] text-gray-500">SOL</span>
                    </div>
                    <button
                      onClick={() => setShowDepositModal(true)}
                      className="p-1 hover:bg-gray-800 rounded transition-colors"
                      title="Add funds"
                    >
                      <ArrowDownTrayIcon className="w-3.5 h-3.5 text-gray-400 hover:text-purple-400" />
                    </button>
                    <button
                      onClick={refreshBalances}
                      className={`p-1 hover:bg-gray-800 rounded transition-colors ${refreshing ? 'animate-spin' : ''}`}
                      title="Refresh"
                    >
                      <ArrowPathIcon className="w-3.5 h-3.5 text-gray-400 hover:text-white" />
                    </button>
                    <button
                      onClick={disconnect}
                      className="p-1 hover:bg-gray-800 rounded transition-colors"
                      title="Disconnect"
                    >
                      <XMarkIcon className="w-3.5 h-3.5 text-gray-500 hover:text-red-400" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowDepositModal(true)}
                    className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors font-medium"
                  >
                    <ArrowDownTrayIcon className="w-3.5 h-3.5" />
                    <span>Deposit</span>
                  </button>
                )}
              </>
            ) : (
              <WalletMultiButton 
                className="!bg-transparent hover:!bg-purple-600/20 !h-7 !text-xs !px-2 !py-0 !rounded !text-purple-400 hover:!text-purple-300 !font-medium !border-0"
              />
            )
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-amber-400/80">
              <CheckCircleIcon className="w-3.5 h-3.5" />
              <span className="font-medium">Using .env</span>
            </div>
          )}
        </div>
      </div>
      
      {/* Deposit Modal */}
      {showDepositModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-purple-600/20 rounded-lg flex items-center justify-center">
                  <WalletIcon className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">Fund Hot Wallet</h3>
                  <p className="text-xs text-gray-500">Transfer SOL from Phantom</p>
                </div>
              </div>
              <button
                onClick={() => setShowDepositModal(false)}
                className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
              >
                <XMarkIcon className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            
            {error && (
              <div className="bg-red-900/30 border border-red-800/50 text-red-300 text-sm px-4 py-3 rounded-lg mb-4">
                {error}
              </div>
            )}
            
            <div className="space-y-4">
              {/* Source */}
              <div className="bg-gray-800/50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500 uppercase tracking-wide">From</span>
                  <div className="flex items-center gap-1.5">
                    <PhantomLogo className="w-4 h-4" />
                    <span className="text-xs text-purple-400">Phantom</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white font-mono">
                    {publicKey?.toBase58().slice(0, 6)}...{publicKey?.toBase58().slice(-4)}
                  </span>
                  <span className="text-sm text-gray-400">{phantomBalance.toFixed(4)} SOL</span>
                </div>
              </div>
              
              {/* Arrow */}
              <div className="flex justify-center">
                <div className="w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center">
                  <ArrowDownTrayIcon className="w-4 h-4 text-gray-400" />
                </div>
              </div>
              
              {/* Destination */}
              <div className="bg-gray-800/50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500 uppercase tracking-wide">To</span>
                  <div className="flex items-center gap-1.5">
                    <WalletIcon className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs text-emerald-400">Hot Wallet</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white font-mono">
                    {hotWalletAddress?.slice(0, 6)}...{hotWalletAddress?.slice(-4) || 'New wallet'}
                  </span>
                  <span className="text-sm text-gray-400">{hotWalletBalance.toFixed(4)} SOL</span>
                </div>
              </div>
              
              {/* Amount Input */}
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Amount</label>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <input
                      type="number"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-gray-800 text-white text-lg font-mono px-4 py-3 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500/50"
                      step="0.1"
                      min="0"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">SOL</span>
                  </div>
                  <button
                    onClick={() => setDepositAmount((phantomBalance * 0.95).toFixed(4))}
                    className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-3 rounded-lg text-sm font-medium transition-colors border border-gray-700"
                  >
                    MAX
                  </button>
                </div>
              </div>
              
              {/* Submit Button */}
              <button
                onClick={handleDeposit}
                disabled={loading || !depositAmount}
                className="w-full bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white py-3.5 rounded-lg font-semibold transition-all flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <ArrowPathIcon className="w-4 h-4 animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <ArrowDownTrayIcon className="w-4 h-4" />
                    <span>Deposit to Hot Wallet</span>
                  </>
                )}
              </button>
              
              <p className="text-xs text-gray-500 text-center">
                One signature. All operations auto-sign from hot wallet.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FundingWallet;
