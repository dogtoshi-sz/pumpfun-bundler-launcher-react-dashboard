import { useState, useEffect } from 'react';
import apiService from '../services/api';

export default function WalletWarming() {
  const [wallets, setWallets] = useState([]);
  const [trendingTokens, setTrendingTokens] = useState([]);
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState({
    tradesPerWallet: 10,
    minBuyAmount: 0.01, // Increased from 0.001 to reduce slippage
    maxBuyAmount: 0.02, // Increased from 0.005 to reduce slippage
    minIntervalSeconds: 30,
    maxIntervalSeconds: 300,
    useTrendingTokens: true
  });
  const [selectedWallets, setSelectedWallets] = useState([]);
  const [trendingStatus, setTrendingStatus] = useState({ loading: false, lastFetch: null, error: null });
  const [newWalletPrivateKey, setNewWalletPrivateKey] = useState('');
  const [newWalletTags, setNewWalletTags] = useState(''); // Tags for new wallet (comma-separated)
  const [sellingTokens, setSellingTokens] = useState({}); // Track which wallets are selling tokens
  const [withdrawingSol, setWithdrawingSol] = useState({}); // Track which wallets are withdrawing SOL
  const [editingTags, setEditingTags] = useState({}); // Track which wallets are editing tags
  const [editTagInputs, setEditTagInputs] = useState({}); // Store tag input values for editing
  
  // Filter and sort state
  const [searchQuery, setSearchQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('all'); // 'all', 'OLD', 'recent', or any tag
  const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'idle', 'warming', 'ready'
  const [sortBy, setSortBy] = useState('createdAt'); // 'createdAt', 'transactionCount', 'totalTrades', 'firstTransactionDate', 'lastTransactionDate', 'solBalance'
  const [sortOrder, setSortOrder] = useState('desc'); // 'asc' or 'desc'

  useEffect(() => {
    loadWallets();
    loadTrendingTokens();
    const interval = setInterval(() => {
      loadWallets(); // Refresh wallet stats
    }, 3000); // Poll every 3 seconds
    return () => clearInterval(interval);
  }, []);

  const loadWallets = async () => {
    try {
      console.log('Loading wallets...');
      const res = await apiService.getWarmingWallets();
      console.log('Wallets response:', res.data);
      if (res.data.success) {
        setWallets(res.data.wallets || []);
        console.log(`Loaded ${res.data.wallets?.length || 0} wallets`);
      } else {
        console.error('Failed to load wallets:', res.data.error);
      }
    } catch (error) {
      console.error('Failed to load wallets:', error);
      alert(`Error loading wallets: ${error.message || error.response?.data?.error || 'Unknown error'}`);
    }
  };

  const loadTrendingTokens = async (showLoading = false) => {
    if (showLoading) setTrendingStatus({ loading: true, lastFetch: null, error: null });
    try {
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

  const handleCreateWallet = async () => {
    setLoading(true);
    try {
      // Parse tags from comma-separated string
      const tags = newWalletTags.trim()
        ? newWalletTags.split(',').map(t => t.trim()).filter(t => t.length > 0)
        : [];
      
      const res = await apiService.createWarmingWallet(tags);
      if (res.data.success) {
        setNewWalletTags(''); // Clear tags input
        await loadWallets();
        alert('Wallet created successfully!');
      } else {
        alert(`Failed to create wallet: ${res.data.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAddWallet = async () => {
    if (!newWalletPrivateKey.trim()) {
      alert('Please enter a private key');
      return;
    }

    setLoading(true);
    try {
      // Parse tags from comma-separated string
      const tags = newWalletTags.trim()
        ? newWalletTags.split(',').map(t => t.trim()).filter(t => t.length > 0)
        : [];
      
      const res = await apiService.addWarmingWallet(newWalletPrivateKey, tags);
      if (res.data.success) {
        setNewWalletPrivateKey('');
        setNewWalletTags(''); // Clear tags input
        await loadWallets();
        alert('Wallet added successfully!');
      } else {
        alert(`Failed to add wallet: ${res.data.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateWalletTags = async (wallet) => {
    const tagsInput = editTagInputs[wallet.address] || '';
    const tags = tagsInput.trim()
      ? tagsInput.split(',').map(t => t.trim()).filter(t => t.length > 0)
      : [];
    
    try {
      const res = await apiService.updateWalletTags(wallet.address, tags);
      if (res.data.success) {
        setEditingTags(prev => ({ ...prev, [wallet.address]: false }));
        setEditTagInputs(prev => ({ ...prev, [wallet.address]: '' }));
        await loadWallets();
        alert('Tags updated successfully!');
      } else {
        alert(`Failed to update tags: ${res.data.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.response?.data?.error || error.message}`);
    }
  };

  const handleStartWarming = async () => {
    if (selectedWallets.length === 0) {
      alert('Please select at least one wallet');
      return;
    }

    setLoading(true);
    try {
      const res = await apiService.startWarming(selectedWallets, config);
      
      if (res.data.success) {
        alert(`Started warming ${selectedWallets.length} wallet(s)`);
        loadWallets();
      } else {
        alert(`Failed to start warming: ${res.data.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteWallet = async (address) => {
    if (!confirm(`Delete wallet ${address.substring(0, 8)}...?`)) return;

    try {
      const res = await apiService.deleteWarmingWallet(address);
      if (res.data.success) {
        await loadWallets();
        setSelectedWallets(prev => prev.filter(addr => addr !== address));
      } else {
        alert(`Failed to delete wallet: ${res.data.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.response?.data?.error || error.message}`);
    }
  };

  const handleSellAllTokens = async (wallet) => {
    if (!confirm(`Sell all tokens (99.9%) from wallet ${wallet.address.substring(0, 8)}...?`)) return;

    setSellingTokens(prev => ({ ...prev, [wallet.address]: true }));
    
    try {
      const res = await apiService.sellAllTokensFromWallet(wallet.address);
      if (res.data.success) {
        const { successful, failed, total } = res.data.summary;
        const message = `✅ Sold ${successful} token(s) successfully${failed > 0 ? `, ${failed} failed` : ''}${total > 0 ? ` out of ${total} total` : ''}`;
        alert(message);
        // Auto-refresh wallet list to show updated balances
        setTimeout(async () => {
          await loadWallets();
        }, 1000); // Wait 1 second for blockchain to update
      } else {
        alert(`Failed to sell tokens: ${res.data.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setSellingTokens(prev => ({ ...prev, [wallet.address]: false }));
    }
  };

  const handleWithdrawSol = async (wallet) => {
    if (!confirm(`Withdraw all SOL from wallet ${wallet.address.substring(0, 8)}... to funding wallet?`)) return;

    setWithdrawingSol(prev => ({ ...prev, [wallet.address]: true }));
    
    try {
      const res = await apiService.withdrawSolFromWallet(wallet.address);
      if (res.data.success) {
        alert(`✅ Withdrew ${res.data.amountTransferred.toFixed(6)} SOL to funding wallet!\n${res.data.txUrl ? `Transaction: ${res.data.txUrl}` : ''}`);
        // Auto-refresh wallet list to show updated balances
        setTimeout(async () => {
          await loadWallets();
        }, 1000); // Wait 1 second for blockchain to update
      } else {
        alert(`Failed to withdraw SOL: ${res.data.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setWithdrawingSol(prev => ({ ...prev, [wallet.address]: false }));
    }
  };

  const handleAddToLaunch = async () => {
    if (selectedWallets.length === 0) {
      alert('Please select at least one wallet');
      return;
    }

    try {
      const res = await apiService.addWalletsToLaunch(selectedWallets, []);
      
      if (res.data.success) {
        alert(`Added ${selectedWallets.length} wallet(s) to data.json - ready for launch!`);
        setSelectedWallets([]);
      } else {
        alert(`Failed to add wallets: ${res.data.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.response?.data?.error || error.message}`);
    }
  };

  const toggleWalletSelection = (address) => {
    setSelectedWallets(prev => {
      if (prev.includes(address)) {
        return prev.filter(addr => addr !== address);
      } else {
        return [...prev, address];
      }
    });
  };

  const toggleSelectAllFiltered = () => {
    const filteredAddresses = filteredAndSortedWallets.map(w => w.address);
    const allSelected = filteredAddresses.every(addr => selectedWallets.includes(addr));
    
    if (allSelected) {
      // Deselect all filtered wallets
      setSelectedWallets(prev => prev.filter(addr => !filteredAddresses.includes(addr)));
    } else {
      // Select all filtered wallets (add to existing selection)
      setSelectedWallets(prev => {
        const newSelection = [...prev];
        filteredAddresses.forEach(addr => {
          if (!newSelection.includes(addr)) {
            newSelection.push(addr);
          }
        });
        return newSelection;
      });
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleString();
  };

  // Get unique tags from all wallets
  const allTags = [...new Set(wallets.flatMap(w => w.tags || []))];

  // Filter and sort wallets
  const filteredAndSortedWallets = wallets
    .filter(wallet => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (!wallet.address.toLowerCase().includes(query)) {
          return false;
        }
      }
      
      // Tag filter
      if (tagFilter !== 'all') {
        if (!wallet.tags || !wallet.tags.includes(tagFilter)) {
          return false;
        }
      }
      
      // Status filter
      if (statusFilter !== 'all') {
        if (wallet.status !== statusFilter) {
          return false;
        }
      }
      
      return true;
    })
    .sort((a, b) => {
      let aValue, bValue;
      
      switch (sortBy) {
        case 'transactionCount':
          aValue = a.transactionCount || 0;
          bValue = b.transactionCount || 0;
          break;
        case 'totalTrades':
          aValue = a.totalTrades || 0;
          bValue = b.totalTrades || 0;
          break;
        case 'tradesLast7Days':
          aValue = a.tradesLast7Days !== undefined ? a.tradesLast7Days : 0;
          bValue = b.tradesLast7Days !== undefined ? b.tradesLast7Days : 0;
          break;
        case 'solBalance':
          aValue = a.solBalance || 0;
          bValue = b.solBalance || 0;
          break;
        case 'firstTransactionDate':
          aValue = a.firstTransactionDate ? new Date(a.firstTransactionDate).getTime() : 0;
          bValue = b.firstTransactionDate ? new Date(b.firstTransactionDate).getTime() : 0;
          break;
        case 'lastTransactionDate':
          aValue = a.lastTransactionDate ? new Date(a.lastTransactionDate).getTime() : 0;
          bValue = b.lastTransactionDate ? new Date(b.lastTransactionDate).getTime() : 0;
          break;
        case 'lastWarmedAt':
          aValue = a.lastWarmedAt ? new Date(a.lastWarmedAt).getTime() : 0;
          bValue = b.lastWarmedAt ? new Date(b.lastWarmedAt).getTime() : 0;
          break;
        case 'createdAt':
        default:
          aValue = new Date(a.createdAt).getTime();
          bValue = new Date(b.createdAt).getTime();
          break;
      }
      
      if (sortOrder === 'asc') {
        return aValue - bValue;
      } else {
        return bValue - aValue;
      }
    });

  return (
    <div className="bg-gray-900/50 rounded-lg p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white mb-2">🔥 Wallet Warming</h2>
        <p className="text-sm text-gray-400">
          Create and warm wallets with trading history. Wallets auto-fund as needed.
        </p>
      </div>

      {/* Create/Add Wallet */}
      <div className="mb-6 bg-gray-900/50 rounded-lg p-4">
        <h3 className="text-lg font-bold text-white mb-4">Create or Add Wallet</h3>
        <div className="space-y-3">
          <div className="flex gap-4">
            <button
              onClick={handleCreateWallet}
              disabled={loading}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors disabled:opacity-50"
            >
              ➕ Create New Wallet
            </button>
            <div className="flex-1 flex gap-2">
              <input
                type="password"
                value={newWalletPrivateKey}
                onChange={(e) => setNewWalletPrivateKey(e.target.value)}
                placeholder="Enter private key (base58) to add existing wallet"
                className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
              />
              <button
                onClick={handleAddWallet}
                disabled={loading || !newWalletPrivateKey.trim()}
                className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg transition-colors disabled:opacity-50"
              >
                ➕ Add Wallet
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">🏷️ Tags (comma-separated, optional)</label>
            <input
              type="text"
              value={newWalletTags}
              onChange={(e) => setNewWalletTags(e.target.value)}
              placeholder="e.g., recent, OLD, custom-tag"
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">Tags will be applied to the newly created/added wallet</p>
          </div>
        </div>
      </div>

      {/* Configuration */}
      <div className="mb-6 bg-gray-900/50 rounded-lg p-4">
        <h3 className="text-lg font-bold text-white mb-4">Warming Configuration</h3>
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
        
        <div className="mb-3 text-xs">
          {trendingStatus.loading && (
            <div className="text-yellow-400">⏳ Fetching trending tokens from Moralis API...</div>
          )}
          {trendingStatus.error && (
            <div className="text-red-400">❌ {trendingStatus.error}</div>
          )}
          {trendingStatus.lastFetch && !trendingStatus.error && trendingTokens.length > 0 && (
            <div className="text-green-400">
              ✅ Last updated: {new Date(trendingStatus.lastFetch).toLocaleTimeString()} ({trendingStatus.count} tokens)
            </div>
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
                  {token.type && (
                    <div className="text-blue-400 text-[10px] mt-1">
                      {token.type === 'new' ? '🆕' : token.type === 'bonding' ? '🔗' : '✅'} {token.type}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Wallet List */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-white">
            Wallets ({filteredAndSortedWallets.length} of {wallets.length} shown, {selectedWallets.length} selected)
          </h3>
          <div className="flex gap-2">
            <button
              onClick={toggleSelectAllFiltered}
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                filteredAndSortedWallets.length === 0
                  ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                  : filteredAndSortedWallets.every(w => selectedWallets.includes(w.address))
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-green-600 hover:bg-green-700 text-white'
              }`}
              disabled={filteredAndSortedWallets.length === 0}
              title={
                filteredAndSortedWallets.length === 0
                  ? "No wallets to select"
                  : filteredAndSortedWallets.every(w => selectedWallets.includes(w.address))
                  ? "Deselect all filtered wallets"
                  : "Select all filtered wallets"
              }
            >
              {filteredAndSortedWallets.every(w => selectedWallets.includes(w.address))
                ? '❌ Deselect All'
                : '✅ Select All'}
            </button>
            <button
              onClick={async () => {
                if (selectedWallets.length === 0) {
                  alert('Please select wallets to update stats from blockchain');
                  return;
                }
                if (!confirm(`Update stats from blockchain for ${selectedWallets.length} wallet(s)? This will make RPC calls.`)) {
                  return;
                }
                setLoading(true);
                try {
                  const res = await apiService.updateWalletStats(selectedWallets);
                  if (res.data.success) {
                    alert(`✅ Updated ${res.data.updated} wallet(s) from blockchain${res.data.failed > 0 ? `\n⚠️ ${res.data.failed} failed` : ''}`);
                    await loadWallets();
                  } else {
                    alert(`Failed: ${res.data.error}`);
                  }
                } catch (error) {
                  alert(`Error: ${error.response?.data?.error || error.message}`);
                } finally {
                  setLoading(false);
                }
              }}
              disabled={loading}
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                selectedWallets.length === 0
                  ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                  : 'bg-purple-600 hover:bg-purple-700 text-white'
              } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
              title={selectedWallets.length === 0 
                ? "Select wallets first to update stats from blockchain" 
                : "Fetch transaction history from blockchain for selected wallets (RPC call)"}
            >
              📡 Update Stats from Blockchain {selectedWallets.length > 0 && `(${selectedWallets.length})`}
            </button>
            <button
              onClick={async () => {
                if (selectedWallets.length === 0) {
                  alert('Please select wallets to update balances');
                  return;
                }
                setLoading(true);
                try {
                  const res = await apiService.updateWalletBalances(selectedWallets);
                  if (res.data.success) {
                    alert(`✅ Updated balances for ${res.data.updated} wallet(s)\nTotal SOL: ${res.data.totalSol.toFixed(4)} SOL${res.data.failed > 0 ? `\n⚠️ ${res.data.failed} failed` : ''}`);
                    await loadWallets();
                  } else {
                    alert(`Failed: ${res.data.error}`);
                  }
                } catch (error) {
                  alert(`Error: ${error.response?.data?.error || error.message}`);
                } finally {
                  setLoading(false);
                }
              }}
              disabled={loading || selectedWallets.length === 0}
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                selectedWallets.length === 0
                  ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                  : 'bg-cyan-600 hover:bg-cyan-700 text-white'
              } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
              title="Update SOL balances for selected wallets (RPC call)"
            >
              💰 Update Balances {selectedWallets.length > 0 && `(${selectedWallets.length})`}
            </button>
            <button
              onClick={loadWallets}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm transition-colors"
            >
              🔄 Refresh
            </button>
          </div>
        </div>

        {/* Filters and Sort Controls */}
        <div className="mb-4 bg-gray-900/50 rounded-lg p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Search */}
            <div className="lg:col-span-2">
              <label className="text-xs text-gray-400 mb-1 block">🔍 Search Address</label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by wallet address..."
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
              />
            </div>
            
            {/* Tag Filter */}
            <div>
              <label className="text-xs text-gray-400 mb-1 block">🏷️ Filter by Tag</label>
              <select
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
              >
                <option value="all">All Tags</option>
                {allTags.map(tag => (
                  <option key={tag} value={tag}>
                    {tag === 'recently-warmed' ? '🔥 Recently Warmed' : tag}
                  </option>
                ))}
              </select>
            </div>
            
            {/* Status Filter */}
            <div>
              <label className="text-xs text-gray-400 mb-1 block">📊 Filter by Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
              >
                <option value="all">All Status</option>
                <option value="idle">⏸️ Idle</option>
                <option value="warming">🔥 Warming</option>
                <option value="ready">✅ Ready</option>
              </select>
            </div>
            
            {/* Sort By */}
            <div>
              <label className="text-xs text-gray-400 mb-1 block">🔀 Sort By</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm mb-2"
              >
                <option value="createdAt">Created Date</option>
                <option value="lastWarmedAt">Last Warmed (Newest)</option>
                <option value="solBalance">SOL Balance</option>
                <option value="transactionCount">Transactions</option>
                <option value="totalTrades">Total Trades</option>
                <option value="tradesLast7Days">Trades (Last 7 Days)</option>
                <option value="firstTransactionDate">First Trade</option>
                <option value="lastTransactionDate">Last Trade</option>
              </select>
              <button
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                className="w-full px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs transition-colors"
              >
                {sortOrder === 'asc' ? '⬆️ Ascending' : '⬇️ Descending'}
              </button>
            </div>
          </div>
          
          {/* Quick Filter Buttons */}
          <div className="mt-3 flex gap-2 flex-wrap">
            <button
              onClick={() => {
                setTagFilter('all');
                setStatusFilter('all');
                setSearchQuery('');
              }}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs transition-colors"
            >
              Clear Filters
            </button>
            <button
              onClick={() => {
                setTagFilter('OLD');
                setStatusFilter('all');
              }}
              className="px-3 py-1 bg-yellow-900/50 hover:bg-yellow-800/50 text-yellow-400 rounded text-xs transition-colors"
            >
              OLD Wallets
            </button>
            <button
              onClick={() => {
                setTagFilter('recent');
                setStatusFilter('all');
              }}
              className="px-3 py-1 bg-blue-900/50 hover:bg-blue-800/50 text-blue-400 rounded text-xs transition-colors"
            >
              Recent Wallets
            </button>
            <button
              onClick={() => {
                setStatusFilter('ready');
                setTagFilter('all');
              }}
              className="px-3 py-1 bg-green-900/50 hover:bg-green-800/50 text-green-400 rounded text-xs transition-colors"
            >
              Ready Only
            </button>
            <button
              onClick={() => {
                setStatusFilter('warming');
                setTagFilter('all');
              }}
              className="px-3 py-1 bg-orange-900/50 hover:bg-orange-800/50 text-orange-400 rounded text-xs transition-colors"
            >
              Warming Only
            </button>
            <button
              onClick={() => {
                setTagFilter('recently-warmed');
                setStatusFilter('all');
              }}
              className="px-3 py-1 bg-green-900/70 hover:bg-green-800/70 text-green-300 rounded text-xs transition-colors border border-green-600"
            >
              🔥 Recently Warmed
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-96 overflow-y-auto">
          {filteredAndSortedWallets.map((wallet, idx) => {
            const isSelected = selectedWallets.includes(wallet.address);
            
            return (
              <div
                key={idx}
                className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                  isSelected
                    ? 'border-blue-500 bg-blue-900/20'
                    : wallet.tags?.includes('recently-warmed')
                    ? 'border-green-600 bg-green-900/20 hover:border-green-500'
                    : 'border-gray-700 bg-gray-900/50 hover:border-gray-600'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleWalletSelection(wallet.address)}
                      className="w-4 h-4 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="flex items-center gap-1 min-w-0 flex-1">
                      <a
                        href={`https://solscan.io/account/${wallet.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs font-mono text-gray-300 hover:text-blue-400 transition-colors truncate"
                        title="View on Solscan"
                      >
                        {wallet.address.substring(0, 8)}...{wallet.address.substring(wallet.address.length - 8)}
                      </a>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(wallet.address);
                          alert('Address copied to clipboard!');
                        }}
                        className="text-gray-400 hover:text-blue-400 text-xs px-1"
                        title="Copy address"
                      >
                        📋
                      </button>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (confirm('Copy private key to clipboard? This is sensitive information!')) {
                            try {
                              const res = await apiService.getWalletPrivateKey(wallet.address);
                              if (res.data.success && res.data.privateKey) {
                                await navigator.clipboard.writeText(res.data.privateKey);
                                alert('Private key copied to clipboard!');
                              } else {
                                alert('Failed to get private key: ' + (res.data.error || 'Unknown error'));
                              }
                            } catch (error) {
                              alert('Error: ' + (error.response?.data?.error || error.message));
                            }
                          }
                        }}
                        className="text-gray-400 hover:text-red-400 text-xs px-1"
                        title="Copy private key"
                      >
                        🔑
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteWallet(wallet.address);
                    }}
                    className="text-red-400 hover:text-red-300 text-xs shrink-0"
                  >
                    🗑️
                  </button>
                </div>
                
                <div className="text-xs text-gray-400 space-y-1">
                  <div className="flex justify-between">
                    <span>Status:</span>
                    <span className={`font-bold ${
                      wallet.status === 'ready' ? 'text-green-400' :
                      wallet.status === 'warming' ? 'text-yellow-400' :
                      'text-gray-500'
                    }`}>
                      {wallet.status === 'ready' ? '✅ Ready' :
                       wallet.status === 'warming' ? '🔥 Warming' :
                       '⏸️ Idle'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Transactions:</span>
                    <span className="text-white font-bold">{wallet.transactionCount || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total Trades:</span>
                    <span className="text-blue-400 font-bold">{wallet.totalTrades || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Trades (Last 7 Days):</span>
                    <span className="text-green-400 font-bold">{wallet.tradesLast7Days !== undefined ? wallet.tradesLast7Days : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>First Trade:</span>
                    <span className="text-gray-300">{formatDate(wallet.firstTransactionDate)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Last Trade:</span>
                    <span className="text-gray-300">{formatDate(wallet.lastTransactionDate)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>SOL Balance:</span>
                    <span className={`font-bold ${
                      wallet.solBalance !== undefined && wallet.solBalance !== null
                        ? wallet.solBalance > 0.1 ? 'text-green-400' : wallet.solBalance > 0.01 ? 'text-yellow-400' : 'text-gray-400'
                        : 'text-gray-500'
                    }`}>
                      {wallet.solBalance !== undefined && wallet.solBalance !== null
                        ? `${wallet.solBalance.toFixed(4)} SOL`
                        : 'Not loaded'}
                    </span>
                  </div>
                  {/* Tags Section */}
                  <div className="mt-2">
                    {editingTags[wallet.address] ? (
                      <div className="space-y-1">
                        <input
                          type="text"
                          value={editTagInputs[wallet.address] || wallet.tags?.join(', ') || ''}
                          onChange={(e) => setEditTagInputs(prev => ({ ...prev, [wallet.address]: e.target.value }))}
                          placeholder="Tags (comma-separated)"
                          className="w-full px-2 py-1 bg-gray-800 border border-gray-600 rounded text-white text-xs"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div className="flex gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUpdateWalletTags(wallet);
                            }}
                            className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white text-xs rounded"
                          >
                            ✅ Save
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingTags(prev => ({ ...prev, [wallet.address]: false }));
                              setEditTagInputs(prev => ({ ...prev, [wallet.address]: '' }));
                            }}
                            className="px-2 py-1 bg-gray-600 hover:bg-gray-700 text-white text-xs rounded"
                          >
                            ❌ Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        {wallet.tags && wallet.tags.length > 0 ? (
                          <div className="flex gap-1 flex-wrap items-center">
                            {wallet.tags.map((tag, tagIdx) => (
                              <span
                                key={tagIdx}
                                className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                                  tag === 'recently-warmed' ? 'bg-green-900/70 text-green-300 border border-green-600' :
                                  tag === 'OLD' ? 'bg-yellow-900/50 text-yellow-400' :
                                  tag === 'recent' ? 'bg-blue-900/50 text-blue-400' :
                                  'bg-gray-800 text-gray-400'
                                }`}
                              >
                                {tag === 'recently-warmed' ? '🔥 Recently Warmed' : tag}
                              </span>
                            ))}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingTags(prev => ({ ...prev, [wallet.address]: true }));
                                setEditTagInputs(prev => ({ ...prev, [wallet.address]: wallet.tags?.join(', ') || '' }));
                              }}
                              className="text-gray-400 hover:text-gray-300 text-xs px-1"
                              title="Edit tags"
                            >
                              ✏️
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingTags(prev => ({ ...prev, [wallet.address]: true }));
                              setEditTagInputs(prev => ({ ...prev, [wallet.address]: '' }));
                            }}
                            className="text-gray-500 hover:text-gray-400 text-xs"
                          >
                            + Add tags
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {wallet.lastWarmedAt && (
                    <div className="text-[10px] text-gray-500 mt-1">
                      Last warmed: {formatDate(wallet.lastWarmedAt)}
                    </div>
                  )}
                </div>
                
                {/* Action Buttons */}
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSellAllTokens(wallet);
                    }}
                    disabled={sellingTokens[wallet.address]}
                    className={`flex-1 px-3 py-2 rounded text-xs font-bold transition-colors ${
                      sellingTokens[wallet.address]
                        ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                        : 'bg-red-600 hover:bg-red-700 text-white'
                    }`}
                  >
                    {sellingTokens[wallet.address] ? '⏳ Selling...' : '💸 Sell Tokens'}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleWithdrawSol(wallet);
                    }}
                    disabled={withdrawingSol[wallet.address]}
                    className={`flex-1 px-3 py-2 rounded text-xs font-bold transition-colors ${
                      withdrawingSol[wallet.address]
                        ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                        : 'bg-green-600 hover:bg-green-700 text-white'
                    }`}
                  >
                    {withdrawingSol[wallet.address] ? '⏳ Withdrawing...' : '💰 Withdraw SOL'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {wallets.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <p>No wallets yet. Create or add a wallet to get started.</p>
          </div>
        )}
        
        {wallets.length > 0 && filteredAndSortedWallets.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <p>No wallets match your filters. Try adjusting your search or filter criteria.</p>
          </div>
        )}
      </div>

      {/* Warming Explanation */}
      <div className="mb-4 bg-blue-900/20 border border-blue-700 rounded-lg p-4">
        <h4 className="text-sm font-bold text-blue-400 mb-2">🔥 What Happens When You Start Warming:</h4>
        <div className="text-xs text-gray-300 space-y-1">
          <div>1. Selected wallets are auto-funded from your main wallet (if needed)</div>
          <div>2. Each wallet performs {config.tradesPerWallet} random buy/sell trades on trending tokens</div>
          <div>3. Wallets keep 1-5% of tokens after each sell to look active</div>
          <div>4. Transaction counts and dates are tracked and saved automatically</div>
          <div>5. Wallets are marked as "ready" when warming completes</div>
          <div className="text-blue-400 mt-2">💡 Use "📡 Update Stats from Blockchain" to fetch existing transaction history before warming</div>
        </div>
      </div>
      
      {/* Actions */}
      <div className="flex gap-4">
        <button
          onClick={handleStartWarming}
          disabled={loading || selectedWallets.length === 0}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? '⏳ Starting...' : '🔥 Start Warming Selected'}
        </button>
        
        <button
          onClick={handleAddToLaunch}
          disabled={selectedWallets.length === 0}
          className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          ➕ Add Selected to Launch ({selectedWallets.length})
        </button>
        
        <button
          onClick={async () => {
            if (selectedWallets.length === 0) {
              alert('Please select wallets to gather SOL from');
              return;
            }
            if (!confirm(`Gather SOL from ${selectedWallets.length} wallet(s)? This will transfer all SOL (minus 0.001 for rent) back to your main funding wallet.`)) {
              return;
            }
            setLoading(true);
            try {
              const res = await apiService.gatherSolFromWallets(selectedWallets);
              if (res.data.success) {
                alert(`✅ Gathered ${res.data.totalSolGathered.toFixed(6)} SOL from ${res.data.gathered} wallet(s)${res.data.failed > 0 ? `\n⚠️ ${res.data.failed} failed` : ''}`);
                await loadWallets();
              } else {
                alert(`Failed: ${res.data.error}`);
              }
            } catch (error) {
              alert(`Error: ${error.response?.data?.error || error.message}`);
            } finally {
              setLoading(false);
            }
          }}
          disabled={loading || selectedWallets.length === 0}
          className="px-6 py-3 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          💰 Gather SOL from Selected ({selectedWallets.length})
        </button>
      </div>

      {/* Cost Estimate */}
      <div className="mt-6 bg-yellow-900/20 border border-yellow-700 rounded-lg p-4">
        <h4 className="text-sm font-bold text-yellow-400 mb-2">💰 Cost Estimate</h4>
        <div className="text-xs text-gray-300 space-y-1">
          <div>Per wallet: ~{(config.maxBuyAmount * 2 * config.tradesPerWallet + 0.1).toFixed(4)} SOL</div>
          <div>Total ({selectedWallets.length} wallets): ~{((config.maxBuyAmount * 2 * config.tradesPerWallet + 0.1) * selectedWallets.length).toFixed(4)} SOL</div>
          {selectedWallets.length > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-700">
              <div className="text-xs text-gray-400">
                <div className="flex justify-between">
                  <span>Total Trades (Last 7 Days):</span>
                  <span className="text-green-400 font-bold">
                    {selectedWallets.reduce((sum, addr) => {
                      const wallet = wallets.find(w => w.address === addr);
                      return sum + (wallet?.tradesLast7Days !== undefined ? wallet.tradesLast7Days : 0);
                    }, 0)}
                  </span>
                </div>
                <div className="flex justify-between mt-1">
                  <span>Avg Trades/Wallet (Last 7 Days):</span>
                  <span className="text-green-400 font-bold">
                    {selectedWallets.length > 0
                      ? (selectedWallets.reduce((sum, addr) => {
                          const wallet = wallets.find(w => w.address === addr);
                          return sum + (wallet?.tradesLast7Days !== undefined ? wallet.tradesLast7Days : 0);
                        }, 0) / selectedWallets.length).toFixed(1)
                      : '0'}
                  </span>
                </div>
              </div>
            </div>
          )}
          <div className="text-yellow-400 mt-2">
            ⚠️ Wallets auto-fund as needed. Uses cheapest fees and tiny amounts.
          </div>
        </div>
      </div>
    </div>
  );
}
