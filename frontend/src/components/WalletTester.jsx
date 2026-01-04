import { useState } from 'react';
import apiService from '../services/api';

export default function WalletTester() {
  const [walletPrivateKey, setWalletPrivateKey] = useState('');
  const [mintAddress, setMintAddress] = useState('');
  const [walletInfo, setWalletInfo] = useState(null);
  const [tokenBalance, setTokenBalance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [buyAmount, setBuyAmount] = useState('');
  const [sellPercentage, setSellPercentage] = useState('');
  const [referrerPrivateKey, setReferrerPrivateKey] = useState('');
  const [useCustomReferrer, setUseCustomReferrer] = useState(false);

  const loadWalletInfo = async () => {
    if (!walletPrivateKey.trim()) {
      alert('Please enter a wallet private key');
      return;
    }

    if (!mintAddress.trim()) {
      alert('Please enter a mint address to check balance');
      return;
    }

    setLoading(true);
    try {
      // Check balance to validate wallet and get info
      const response = await fetch('/api/test-wallet/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: walletPrivateKey.trim(),
          mintAddress: mintAddress.trim()
        })
      });

      const data = await response.json();
      if (data.success) {
        setWalletInfo({
          address: data.address,
          privateKey: walletPrivateKey.trim()
        });
        setTokenBalance(data);
        alert('Wallet loaded successfully!');
      } else {
        alert('Failed to load wallet: ' + data.error);
      }
    } catch (error) {
      alert('Failed to load wallet: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const checkTokenBalance = async () => {
    if (!walletPrivateKey.trim() || !mintAddress.trim()) {
      alert('Please enter both wallet private key and mint address');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/test-wallet/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKey: walletPrivateKey.trim(),
          mintAddress: mintAddress.trim()
        })
      });

      const data = await response.json();
      if (data.success) {
        setTokenBalance(data);
        setWalletInfo({
          address: data.address,
          privateKey: walletPrivateKey.trim()
        });
      } else {
        alert('Failed to get balance: ' + data.error);
      }
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBuy = async () => {
    if (!walletPrivateKey.trim() || !mintAddress.trim() || !buyAmount) {
      alert('Please fill in all fields');
      return;
    }

    const amount = parseFloat(buyAmount);
    if (isNaN(amount) || amount <= 0) {
      alert('Please enter a valid SOL amount');
      return;
    }

    setLoading(true);
    try {
      // Use custom referrer if provided, otherwise undefined (will use wallet's own key)
      const referrer = useCustomReferrer && referrerPrivateKey.trim() 
        ? referrerPrivateKey.trim() 
        : undefined;
      
      await apiService.buyTokens(walletPrivateKey.trim(), mintAddress.trim(), amount, referrer);
      alert('Buy transaction sent! Check Solscan for confirmation.');
      setBuyAmount('');
      setTimeout(checkTokenBalance, 3000);
    } catch (error) {
      alert('Buy failed: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleSell = async () => {
    if (!walletPrivateKey.trim() || !mintAddress.trim() || sellPercentage === '') {
      alert('Please fill in all fields');
      return;
    }

    const percentage = sellPercentage.toLowerCase() === 'all' ? 100 : parseFloat(sellPercentage);
    if (isNaN(percentage) || percentage <= 0 || percentage > 100) {
      alert('Please enter a valid percentage (1-100 or "all")');
      return;
    }

    setLoading(true);
    try {
      await apiService.sellTokens(walletPrivateKey.trim(), mintAddress.trim(), percentage);
      alert('Sell transaction sent! Check Solscan for confirmation.');
      setSellPercentage('');
      setTimeout(checkTokenBalance, 3000);
    } catch (error) {
      alert('Sell failed: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-900/50 rounded-lg p-6">
      <h2 className="text-2xl font-bold mb-6 text-white">🧪 Wallet Trading Test</h2>
      <p className="text-gray-500 mb-6">
        Test buy/sell functionality with any wallet and any pump.fun token
      </p>

      {/* Wallet Input */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Wallet Private Key (base58)
        </label>
        <div className="flex gap-2">
          <input
            type="password"
            value={walletPrivateKey}
            onChange={(e) => setWalletPrivateKey(e.target.value)}
            placeholder="Enter wallet private key..."
            className="flex-1 px-4 py-2 bg-gray-900/50 border border-gray-800 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={loadWalletInfo}
            disabled={loading || !walletPrivateKey.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            Load
          </button>
        </div>
        {walletInfo && (
          <div className="mt-2 p-3 bg-gray-900/50 rounded-lg">
            <p className="text-sm text-gray-300">Wallet Address:</p>
            <p className="text-sm font-mono text-white break-all">{walletInfo.address}</p>
          </div>
        )}
      </div>

      {/* Mint Address Input */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Token Mint Address
        </label>
        <input
          type="text"
          value={mintAddress}
          onChange={(e) => setMintAddress(e.target.value)}
          placeholder="Enter pump.fun token mint address..."
          className="w-full px-4 py-2 bg-gray-900/50 border border-gray-800 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-1 text-xs text-gray-500">
          Use any existing pump.fun token address
        </p>
      </div>

      {/* Balance Check */}
      <div className="mb-6">
        <button
          onClick={checkTokenBalance}
          disabled={loading || !walletPrivateKey.trim() || !mintAddress.trim()}
          className="w-full px-4 py-2 bg-gray-900/50 hover:bg-gray-800 text-white rounded-lg transition-colors disabled:opacity-50"
        >
          📊 Check Token Balance
        </button>
        {tokenBalance && (
          <div className="mt-3 p-3 bg-gray-900/50 rounded-lg">
            <p className="text-sm text-gray-300">Token Balance:</p>
            <p className="text-lg font-bold text-yellow-400">
              {tokenBalance.balance?.toFixed(4) || '0'} tokens
            </p>
            {tokenBalance.solBalance && (
              <p className="text-sm text-gray-300 mt-1">
                SOL Balance: <span className="text-green-400">{tokenBalance.solBalance.toFixed(4)} SOL</span>
              </p>
            )}
          </div>
        )}
      </div>

      {/* Buy Section */}
      <div className="mb-6 p-4 bg-gray-900/50 rounded-lg">
        <h3 className="text-lg font-bold text-white mb-3">💰 Test Buy</h3>
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="number"
              step="0.001"
              value={buyAmount}
              onChange={(e) => setBuyAmount(e.target.value)}
              placeholder="SOL amount"
              className="flex-1 px-4 py-2 bg-gray-900/50 border border-gray-800 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleBuy}
              disabled={loading || !walletPrivateKey.trim() || !mintAddress.trim() || !buyAmount}
              className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg transition-colors disabled:opacity-50"
            >
              Buy
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={useCustomReferrer}
              onChange={(e) => setUseCustomReferrer(e.target.checked)}
              className="w-4 h-4"
            />
            <label className="text-sm text-gray-300">Use custom referrer (optional)</label>
          </div>
          {useCustomReferrer && (
            <input
              type="password"
              value={referrerPrivateKey}
              onChange={(e) => setReferrerPrivateKey(e.target.value)}
              placeholder="Referrer private key (for referral fees)"
              className="w-full px-4 py-2 bg-gray-900/50 border border-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
          <p className="text-xs text-gray-500">
            {useCustomReferrer 
              ? 'Using custom referrer - that wallet will get referral fees'
              : 'Using wallet\'s own key as referrer (default - works with any token)'}
          </p>
        </div>
      </div>

      {/* Sell Section */}
      <div className="mb-6 p-4 bg-gray-900/50 rounded-lg">
        <h3 className="text-lg font-bold text-white mb-3">💸 Test Sell</h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={sellPercentage}
            onChange={(e) => setSellPercentage(e.target.value)}
            placeholder="Percentage (1-100 or 'all')"
            className="flex-1 px-4 py-2 bg-gray-900/50 border border-gray-800 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleSell}
            disabled={loading || !walletPrivateKey.trim() || !mintAddress.trim() || sellPercentage === ''}
            className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition-colors disabled:opacity-50"
          >
            Sell
          </button>
        </div>
        {tokenBalance && tokenBalance.balance > 0 && (
          <p className="mt-2 text-xs text-gray-500">
            Available: {tokenBalance.balance.toFixed(4)} tokens
          </p>
        )}
      </div>

      {/* Info */}
      <div className="p-4 bg-blue-900/20 border border-blue-500/30 rounded-lg">
        <p className="text-sm text-blue-300">
          <strong>💡 Tip:</strong> Use this to test buy/sell with any wallet and any pump.fun token.
          The same functions used here are used in the holder wallet trading interface.
        </p>
      </div>
    </div>
  );
}


