import { useState, useEffect } from 'react';
import apiService from '../services/api';

export default function WalletWarming() {
  const [wallets, setWallets] = useState([]);
  const [progress, setProgress] = useState([]);
  const [trendingTokens, setTrendingTokens] = useState([]);
  const [loading, setLoading] = useState(false);
  const [trendingStatus, setTrendingStatus] = useState({ loading: false, lastFetch: null, error: null });
  const [config, setConfig] = useState({
    tradesPerWallet: 10,
    minBuyAmount: 0.001,
    maxBuyAmount: 0.005,
    minIntervalSeconds: 30,
    maxIntervalSeconds: 300,
    useTrendingTokens: true
  });
  const [selectedWallets, setSelectedWallets] = useState([]);
  const [selectedRoles, setSelectedRoles] = useState([]);

  useEffect(() => {
    loadWallets();
    loadTrendingTokens();
    const interval = setInterval(() => {
      loadProgress();
    }, 2000); // Poll every 2 seconds
    return () => clearInterval(interval);
  }, []);

  const loadWallets = async () => {
    try {
      const res = await apiService.getHolderWallets();
      setWallets(res.data.wallets || []);
    } catch (error) {
      console.error('Failed to load wallets:', error);
    }
  };

  const loadProgress = async () => {
    try {
      const res = await apiService.getWarmingProgress();
      if (res.data.success) {
        setProgress(res.data.progress || []);
      }
    } catch (error) {
      console.error('Failed to load progress:', error);
    }
  };

  const loadTrendingTokens = async (showLoading = false) => {
    if (showLoading) setTrendingStatus({ loading: true, lastFetch: null, error: null });
    try {
      // Request more tokens (100) for better variety
      const res = await apiService.getTrendingTokens(100);
      if (res.data.success) {
        const tokens = res.data.tokens || [];
        setTrendingTokens(tokens);
        setTrendingStatus({ 
          loading: false, 
          lastFetch: new Date(), 
          error: null,
          count: tokens.length 
        });
        if (tokens.length === 0) {
          setTrendingStatus(prev => ({ ...prev, error: 'No trending tokens found. Check API connection.' }));
        }
      } else {
        setTrendingStatus({ loading: false, lastFetch: null, error: res.data.error || 'Failed to fetch' });
      }
    } catch (error) {
      console.error('Failed to load trending tokens:', error);
      setTrendingStatus({ 
        loading: false, 
        lastFetch: null, 
        error: error.response?.data?.error || error.message || 'Failed to fetch trending tokens' 
      });
    }
  };

  const handleStartWarming = async () => {
    if (selectedWallets.length === 0) {
      alert('Please select at least one wallet');
      return;
    }

    setLoading(true);
    try {
      const walletPrivateKeys = selectedWallets.map(w => w.privateKey);
      const res = await apiService.startWarming(walletPrivateKeys, config);
      
      if (res.data.success) {
        alert(`Started warming ${selectedWallets.length} wallet(s)`);
        loadProgress();
      } else {
        alert(`Failed to start warming: ${res.data.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAddToLaunch = async () => {
    if (selectedWallets.length === 0) {
      alert('Please select at least one wallet');
      return;
    }
    if (selectedRoles.length === 0) {
      alert('Please select at least one role (Bundle, Holder, or Dev)');
      return;
    }

    try {
      const walletPrivateKeys = selectedWallets.map(w => w.privateKey);
      const res = await apiService.addWalletsToLaunch(walletPrivateKeys, selectedRoles);
      
      if (res.data.success) {
        alert(`Added ${selectedWallets.length} wallet(s) to ${selectedRoles.join(', ')} role(s)`);
        setSelectedWallets([]);
        setSelectedRoles([]);
      } else {
        alert(`Failed to add wallets: ${res.data.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.response?.data?.error || error.message}`);
    }
  };

  const getProgressForWallet = (address) => {
    return progress.find(p => p.walletAddress === address) || null;
  };

  const toggleWalletSelection = (wallet) => {
    setSelectedWallets(prev => {
      const exists = prev.find(w => w.address === wallet.address);
      if (exists) {
        return prev.filter(w => w.address !== wallet.address);
      } else {
        return [...prev, wallet];
      }
    });
  };

  const toggleRole = (role) => {
    setSelectedRoles(prev => {
      if (prev.includes(role)) {
        return prev.filter(r => r !== role);
      } else {
        return [...prev, role];
      }
    });
  };

  return (
    <div className="bg-gray-900/50 rounded-lg p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white mb-2">🔥 Wallet Warming</h2>
        <p className="text-sm text-gray-400">
          Warm wallets with trading history using trending pump.fun tokens. Uses cheapest fees and tiny amounts.
        </p>
      </div>

      {/* Configuration */}
      <div className="mb-6 bg-gray-900/50 rounded-lg p-4">
        <h3 className="text-lg font-bold text-white mb-4">Configuration</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Trades per Wallet</label>
            <input
              type="number"
              value={config.tradesPerWallet}
              onChange={(e) => setConfig({ ...config, tradesPerWallet: parseInt(e.target.value) || 10 })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
              min="1"
              max="50"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Min Buy (SOL)</label>
            <input
              type="number"
              step="0.001"
              value={config.minBuyAmount}
              onChange={(e) => setConfig({ ...config, minBuyAmount: parseFloat(e.target.value) || 0.001 })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
              min="0.001"
              max="0.01"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Max Buy (SOL)</label>
            <input
              type="number"
              step="0.001"
              value={config.maxBuyAmount}
              onChange={(e) => setConfig({ ...config, maxBuyAmount: parseFloat(e.target.value) || 0.005 })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
              min="0.001"
              max="0.01"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Min Interval (s)</label>
            <input
              type="number"
              value={config.minIntervalSeconds}
              onChange={(e) => setConfig({ ...config, minIntervalSeconds: parseInt(e.target.value) || 30 })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
              min="10"
              max="300"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Max Interval (s)</label>
            <input
              type="number"
              value={config.maxIntervalSeconds}
              onChange={(e) => setConfig({ ...config, maxIntervalSeconds: parseInt(e.target.value) || 300 })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
              min="30"
              max="600"
            />
          </div>
          <div className="flex items-center">
            <label className="text-xs text-gray-400 flex items-center gap-2">
              <input
                type="checkbox"
                checked={config.useTrendingTokens}
                onChange={(e) => setConfig({ ...config, useTrendingTokens: e.target.checked })}
                className="w-4 h-4"
              />
              Use Trending Tokens
            </label>
          </div>
        </div>
      </div>

      {/* Trending Tokens */}
      <div className="mb-6 bg-gray-900/50 rounded-lg p-4">
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-lg font-bold text-white">
            📈 Trending Tokens
            {trendingTokens.length > 0 && ` (${trendingTokens.length})`}
          </h3>
          <button
            onClick={() => loadTrendingTokens(true)}
            disabled={trendingStatus.loading}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors disabled:opacity-50"
          >
            {trendingStatus.loading ? '⏳ Loading...' : '🔄 Refresh'}
          </button>
        </div>
        
        {/* Status indicator */}
        <div className="mb-3 text-xs">
          {trendingStatus.loading && (
            <div className="text-yellow-400">⏳ Fetching trending tokens from API...</div>
          )}
          {trendingStatus.error && (
            <div className="text-red-400">❌ {trendingStatus.error}</div>
          )}
          {trendingStatus.lastFetch && !trendingStatus.error && trendingTokens.length > 0 && (
            <div className="text-green-400">
              ✅ Last updated: {new Date(trendingStatus.lastFetch).toLocaleTimeString()} ({trendingStatus.count} tokens)
            </div>
          )}
          {!trendingStatus.lastFetch && !trendingStatus.loading && !trendingStatus.error && (
            <div className="text-gray-400">Click "Refresh" to fetch trending tokens</div>
          )}
        </div>
        
        {trendingTokens.length > 0 && (
          <div className="max-h-64 overflow-y-auto">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 text-xs">
              {trendingTokens.map((token, idx) => (
                <div key={idx} className="bg-gray-800/50 rounded p-2">
                  <div className="font-bold text-white">{token.symbol}</div>
                  <div className="text-gray-400 text-[10px] truncate">{token.mint.substring(0, 8)}...</div>
                  <div className="text-green-400 text-[10px]">${token.priceUsd?.toFixed(6) || '0'}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {trendingTokens.length === 0 && !trendingStatus.loading && (
          <div className="text-center py-4 text-gray-500 text-sm">
            {trendingStatus.error 
              ? 'Failed to load trending tokens. Will use tokens from warmup-tokens.json file instead.'
              : 'No trending tokens loaded. Click "Refresh" to fetch from API.'}
          </div>
        )}
      </div>

      {/* Wallet Selection */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-white">
            Select Wallets ({selectedWallets.length} selected)
          </h3>
          <button
            onClick={loadWallets}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm transition-colors"
          >
            🔄 Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-96 overflow-y-auto">
          {wallets.map((wallet, idx) => {
            const walletProgress = getProgressForWallet(wallet.address);
            const isSelected = selectedWallets.find(w => w.address === wallet.address);
            
            return (
              <div
                key={idx}
                onClick={() => toggleWalletSelection(wallet)}
                className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                  isSelected
                    ? 'border-blue-500 bg-blue-900/20'
                    : 'border-gray-700 bg-gray-900/50 hover:border-gray-600'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!isSelected}
                      onChange={() => toggleWalletSelection(wallet)}
                      className="w-4 h-4"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className="text-xs font-mono text-gray-300">
                      {wallet.address.substring(0, 8)}...{wallet.address.substring(wallet.address.length - 8)}
                    </span>
                  </div>
                  <span className={`px-2 py-1 text-xs rounded ${
                    wallet.type === 'holder' ? 'bg-blue-500' :
                    wallet.type === 'bundle' ? 'bg-purple-500' :
                    'bg-green-500'
                  } text-white`}>
                    {wallet.type}
                  </span>
                </div>
                
                <div className="text-xs text-gray-400 space-y-1">
                  <div>SOL: <span className="text-green-400">{wallet.solBalance.toFixed(4)}</span></div>
                  <div>Tokens: <span className="text-yellow-400">{wallet.tokenBalance.toFixed(2)}</span></div>
                  
                  {walletProgress && (
                    <div className="mt-2 pt-2 border-t border-gray-700">
                      <div className="text-blue-400 font-bold">
                        {walletProgress.completedTrades}/{walletProgress.totalTrades} trades
                      </div>
                      <div className="text-xs">
                        ✅ {walletProgress.successfulTrades} | ❌ {walletProgress.failedTrades}
                      </div>
                      <div className="w-full bg-gray-700 rounded-full h-1.5 mt-1">
                        <div
                          className="bg-blue-500 h-1.5 rounded-full transition-all"
                          style={{ width: `${(walletProgress.completedTrades / walletProgress.totalTrades) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-4 mb-6">
        <button
          onClick={handleStartWarming}
          disabled={loading || selectedWallets.length === 0}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? '⏳ Starting...' : '🔥 Start Warming'}
        </button>
        
        <div className="flex-1 bg-gray-900/50 rounded-lg p-4">
          <h4 className="text-sm font-bold text-white mb-2">Add to Launch Roles</h4>
          <div className="flex gap-2 mb-2">
            {['bundle', 'holder', 'dev'].map(role => (
              <button
                key={role}
                onClick={() => toggleRole(role)}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  selectedRoles.includes(role)
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {role.charAt(0).toUpperCase() + role.slice(1)}
              </button>
            ))}
          </div>
          <button
            onClick={handleAddToLaunch}
            disabled={selectedWallets.length === 0 || selectedRoles.length === 0}
            className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            ➕ Add Selected to {selectedRoles.map(r => r.charAt(0).toUpperCase() + r.slice(1)).join('/')}
          </button>
        </div>
      </div>

      {/* Cost Estimate */}
      <div className="bg-yellow-900/20 border border-yellow-700 rounded-lg p-4">
        <h4 className="text-sm font-bold text-yellow-400 mb-2">💰 Cost Estimate</h4>
        <div className="text-xs text-gray-300 space-y-1">
          <div>Per wallet: ~{(config.maxBuyAmount * 2 * config.tradesPerWallet + 0.1).toFixed(4)} SOL</div>
          <div>Total ({selectedWallets.length} wallets): ~{((config.maxBuyAmount * 2 * config.tradesPerWallet + 0.1) * selectedWallets.length).toFixed(4)} SOL</div>
          <div className="text-yellow-400 mt-2">
            ⚠️ Uses cheapest fees (low priority) and tiny amounts to minimize costs
          </div>
        </div>
      </div>
    </div>
  );
}

