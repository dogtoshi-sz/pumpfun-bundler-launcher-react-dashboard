import { useState, useEffect, useMemo } from 'react';
import apiService from '../services/api';

export default function WalletWarming() {
  const [wallets, setWallets] = useState([]);
  const [trendingTokens, setTrendingTokens] = useState([]);
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState({
    tradesPerWallet: 2,
    minBuyAmount: 0.0002,
    maxBuyAmount: 0.0003,
    minIntervalSeconds: 10,
    maxIntervalSeconds: 60,
    useTrendingTokens: true,
    fundingAmount: 0.015,
    skipFunding: true,
    closeTokenAccounts: true, // Default: close accounts to recover rent. Set false for cheap mode (build many tx cheaply)
    tradingPattern: 'sequential', // 'sequential', 'randomized', 'accumulate' - pattern for executing trades
    walletsPerBatch: 2 // How many wallets to process in parallel (already runs in parallel!)
  });
  const [selectedWallets, setSelectedWallets] = useState([]);
  const [trendingStatus, setTrendingStatus] = useState({ loading: false, lastFetch: null, error: null });
  const [newWalletPrivateKey, setNewWalletPrivateKey] = useState('');
  const [newWalletTags, setNewWalletTags] = useState('');
  const [sellingTokens, setSellingTokens] = useState({});
  const [closingAccounts, setClosingAccounts] = useState({});
  const [withdrawingSol, setWithdrawingSol] = useState({});
  const [refreshingWallet, setRefreshingWallet] = useState({});
  const [refreshingBalances, setRefreshingBalances] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState(null);
  const [editingTags, setEditingTags] = useState({});
  const [editTagInputs, setEditTagInputs] = useState({});
  const [showAddWalletModal, setShowAddWalletModal] = useState(false);
  const [walletPreview, setWalletPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  
  // Filter and sort state
  const [searchQuery, setSearchQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('solBalance');
  const [sortOrder, setSortOrder] = useState('desc');
  
  // UI State
  const [showSettings, setShowSettings] = useState(false);
  const [showTrendingTokens, setShowTrendingTokens] = useState(false);
  const [showFundingModal, setShowFundingModal] = useState(false);
  const [fundingAmount, setFundingAmount] = useState('0.02');
  const [fundingLoading, setFundingLoading] = useState(false);
  
  // Private Funding (SOL -> ETH -> SOL) State
  const [showPrivateFunding, setShowPrivateFunding] = useState(false);
  const [privateFundingStep, setPrivateFundingStep] = useState(1); // 1=Fund, 2=Withdraw, 3=Resume
  const [bridgeAmount, setBridgeAmount] = useState('0.5');
  const [bridgeChain, setBridgeChain] = useState('base');
  const [bridgeLoading, setBridgeLoading] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState(null);
  const [stuckIntermediaries, setStuckIntermediaries] = useState([]);
  const [loadingIntermediaries, setLoadingIntermediaries] = useState(false);
  const [privateFundingMethod, setPrivateFundingMethod] = useState('mayan'); // 'mayan' or 'sol-intermediaries'
  const [intermediaryCount, setIntermediaryCount] = useState(10);
  const [reuseSavedIntermediaries, setReuseSavedIntermediaries] = useState(false);
  
  // Funding Wallet State
  const [fundingWallet, setFundingWallet] = useState(null);
  
  // Create Wallet Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createCount, setCreateCount] = useState(1);
  const [createTags, setCreateTags] = useState([]);
  const [createTagInput, setCreateTagInput] = useState('');
  const [createTagColor, setCreateTagColor] = useState('blue');
  const [creating, setCreating] = useState(false);
  
  // Track recently created wallets (show at top with NEW badge)
  const [recentlyCreated, setRecentlyCreated] = useState([]);

  // Available tag colors
  const tagColors = [
    { id: 'blue', bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/50' },
    { id: 'green', bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/50' },
    { id: 'purple', bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/50' },
    { id: 'orange', bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/50' },
    { id: 'pink', bg: 'bg-pink-500/20', text: 'text-pink-400', border: 'border-pink-500/50' },
    { id: 'cyan', bg: 'bg-cyan-500/20', text: 'text-cyan-400', border: 'border-cyan-500/50' },
    { id: 'yellow', bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/50' },
    { id: 'red', bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/50' },
  ];

  useEffect(() => {
    // Initial load - refresh balances from blockchain
    loadWallets(true);
    loadTrendingTokens();
    loadFundingWallet();
    
    // Periodic refresh (every 10s) - just reload cached data, not blockchain refresh
    const interval = setInterval(() => {
      loadWallets(false);
      loadFundingWallet();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const loadFundingWallet = async () => {
    try {
      const res = await apiService.getDeployerWallet();
      if (res.data.success) {
        setFundingWallet({
          address: res.data.address,
          balance: res.data.balance || 0
        });
      }
    } catch (error) {
      console.error('Failed to load funding wallet:', error);
    }
  };

  // Load intermediary wallets with stuck funds
  const loadStuckIntermediaries = async () => {
    setLoadingIntermediaries(true);
    try {
      const res = await apiService.listIntermediaryWallets();
      if (res.data.success && res.data.wallets) {
        // Filter to recent wallets that might have stuck funds (not recovered, not distributed)
        // Also filter by selected chain if in Resume mode
        const filtered = res.data.wallets.filter(w => {
          const statusOk = w.status !== 'recovered' && w.status !== 'distributed';
          // If in Resume mode (step 3), also filter by selected chain
          if (privateFundingStep === 3) {
            return statusOk && (w.chain === bridgeChain || (!w.chain && bridgeChain === 'base'));
          }
          return statusOk;
        }).slice(-10); // Last 10
        setStuckIntermediaries(filtered);
      }
    } catch (error) {
      console.error('Failed to load intermediary wallets:', error);
    } finally {
      setLoadingIntermediaries(false);
    }
  };

  // Recover stuck ETH from intermediary wallet
  const handleRecoverIntermediary = async (intermediaryAddress, chain) => {
    if (selectedWallets.length === 0) {
      setBridgeStatus({ error: true, message: '⚠️ Select destination wallet(s) first' });
      return;
    }
    
    setBridgeLoading(true);
    setBridgeStatus({ message: `🔄 Recovering ETH from ${intermediaryAddress.substring(0, 10)}... → SOL` });
    
    try {
      // For multiple wallets, we'll just recover to the first one for now
      const destAddress = selectedWallets[0];
      const res = await apiService.recoverIntermediaryEth(intermediaryAddress, destAddress, chain);
      
      if (res.data.success) {
        setBridgeStatus({ 
          success: true, 
          message: `✅ Recovery initiated! ~${res.data.expectedSol} SOL arriving in 2-5 min` 
        });
        // Reload intermediaries
        loadStuckIntermediaries();
        // Refresh wallet balances after a delay
        setTimeout(() => loadWallets(true), 180000); // 3 minutes
      } else {
        setBridgeStatus({ error: true, message: `❌ ${res.data.error}` });
      }
    } catch (error) {
      setBridgeStatus({ error: true, message: `❌ ${error.response?.data?.error || error.message}` });
    } finally {
      setBridgeLoading(false);
    }
  };

  const loadWallets = async (refreshBalances = false, refreshStats = false) => {
    try {
      const res = await apiService.getWarmingWallets();
      if (res.data.success) {
        const walletList = res.data.wallets || [];
        setWallets(walletList);
        
        // Refresh balances and/or stats from blockchain if requested
        if ((refreshBalances || refreshStats) && walletList.length > 0) {
          try {
            const addresses = walletList.map(w => w.address);
            
            // Update balances if requested
            if (refreshBalances) {
              await apiService.updateWalletBalances(addresses);
            }
            
            // Update transaction stats if requested
            if (refreshStats) {
              console.log(`[WalletWarming] Fetching transaction stats for ${addresses.length} wallet(s) from blockchain...`);
              await apiService.updateWalletStats(addresses);
            }
            
            // Reload wallets with fresh data
            const refreshRes = await apiService.getWarmingWallets();
            if (refreshRes.data.success) {
              setWallets(refreshRes.data.wallets || []);
            }
          } catch (err) {
            console.error('Failed to refresh wallet data:', err);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load wallets:', error);
    }
  };

  const loadTrendingTokens = async (showLoading = false) => {
    if (showLoading) setTrendingStatus({ loading: true, lastFetch: null, error: null });
    try {
      const res = await apiService.getTrendingTokens(100);
      if (res.data.success) {
        const tokens = res.data.tokens || [];
        setTrendingTokens(tokens);
        setTrendingStatus({ loading: false, lastFetch: new Date(), error: null, count: tokens.length });
      } else {
        setTrendingStatus({ loading: false, lastFetch: null, error: res.data.error || 'Failed to fetch' });
      }
    } catch (error) {
      setTrendingStatus({ loading: false, lastFetch: null, error: error.message || 'Failed to fetch' });
    }
  };

  const handleCreateWallet = async () => {
    setShowCreateModal(true);
  };

  const handleCreateWallets = async () => {
    if (createCount < 1 || createCount > 50) {
      alert('Please enter a number between 1 and 50');
      return;
    }
    
    setCreating(true);
    const createdAddresses = [];
    const tagStrings = createTags.map(t => t.name);
    
    try {
      for (let i = 0; i < createCount; i++) {
        const res = await apiService.createWarmingWallet(tagStrings);
        if (res.data.success && res.data.wallet?.address) {
          createdAddresses.push(res.data.wallet.address);
        }
      }
      
      // Add to recently created (will show at top with NEW badge)
      setRecentlyCreated(prev => [...createdAddresses, ...prev]);
      
      // Reset modal state
      setShowCreateModal(false);
      setCreateCount(1);
      setCreateTags([]);
      setCreateTagInput('');
      
      // Reload wallets
      await loadWallets();
      
      if (createdAddresses.length > 0) {
        // Auto-select newly created wallets
        setSelectedWallets(prev => [...new Set([...prev, ...createdAddresses])]);
      }
    } catch (error) {
      alert(`Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setCreating(false);
    }
  };

  const addCreateTag = () => {
    const tagName = createTagInput.trim();
    if (!tagName) return;
    if (createTags.some(t => t.name === tagName)) return;
    
    setCreateTags(prev => [...prev, { name: tagName, color: createTagColor }]);
    setCreateTagInput('');
  };

  const removeCreateTag = (tagName) => {
    setCreateTags(prev => prev.filter(t => t.name !== tagName));
  };

  const handlePreviewWallet = async (privateKey) => {
    if (!privateKey || privateKey.trim().length < 80) {
      setWalletPreview(null);
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await apiService.previewWallet(privateKey.trim());
      if (res.data.success && res.data.address) {
        setWalletPreview({
          address: res.data.address,
          solBalance: res.data.solBalance || 0,
          solBalanceFormatted: res.data.solBalanceFormatted || '0.000000'
        });
      } else {
        setWalletPreview({ error: res.data.error || 'Invalid key' });
      }
    } catch (error) {
      setWalletPreview({ error: error.response?.data?.error || 'Invalid private key' });
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleAddExistingWallet = async () => {
    if (!newWalletPrivateKey.trim()) {
      alert('Please enter a private key');
      return;
    }
    setLoading(true);
    try {
      const tags = newWalletTags.trim() ? newWalletTags.split(',').map(t => t.trim()).filter(t => t.length > 0) : [];
      const res = await apiService.addWarmingWallet(newWalletPrivateKey.trim(), tags);
      if (res.data.success) {
        setNewWalletPrivateKey('');
        setNewWalletTags('');
        setWalletPreview(null);
        setShowAddWalletModal(false);
        await loadWallets();
        alert('Wallet added successfully!');
      } else {
        alert(`Failed: ${res.data.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStartWarming = async () => {
    if (selectedWallets.length === 0) {
      alert('Please select at least one wallet');
      return;
    }
    setLoading(true);
    try {
      const res = await apiService.startWarming(selectedWallets, { ...config, useJupiter: true, priorityFee: 'none', closeTokenAccounts: config.closeTokenAccounts });
      if (res.data.success) {
        await loadWallets();
        alert('Wallet warming started!');
      } else {
        alert(`Failed: ${res.data.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Fund selected wallets from main funding wallet
  const handleFundWallets = async () => {
    if (selectedWallets.length === 0) {
      alert('Please select wallets to fund');
      return;
    }
    const amount = parseFloat(fundingAmount);
    if (isNaN(amount) || amount <= 0) {
      alert('Please enter a valid amount');
      return;
    }
    const totalNeeded = amount * selectedWallets.length;
    if (!confirm(`Fund ${selectedWallets.length} wallet(s) with ${amount} SOL each?\n\nTotal: ${totalNeeded.toFixed(4)} SOL`)) {
      return;
    }
    setFundingLoading(true);
    try {
      const res = await apiService.fundWarmingWallets(selectedWallets, amount);
      if (res.data.success) {
        alert(`✅ Funded ${res.data.funded} wallet(s) with ${res.data.totalSent?.toFixed(4) || amount * selectedWallets.length} SOL`);
        setShowFundingModal(false);
        await loadWallets();
      } else {
        alert(`Failed: ${res.data.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setFundingLoading(false);
    }
  };

  // Withdraw SOL from all selected wallets back to funding wallet
  const handleBulkWithdraw = async () => {
    if (selectedWallets.length === 0) {
      alert('Please select wallets to withdraw from');
      return;
    }
    const walletsWithBalance = wallets.filter(w => selectedWallets.includes(w.address) && (w.solBalance || 0) > 0.001);
    if (walletsWithBalance.length === 0) {
      alert('No selected wallets have withdrawable balance');
      return;
    }
    const totalSol = walletsWithBalance.reduce((sum, w) => sum + (w.solBalance || 0), 0);
    if (!confirm(`Withdraw from ${walletsWithBalance.length} wallet(s)?\n\nApprox total: ${totalSol.toFixed(4)} SOL`)) {
      return;
    }
    setFundingLoading(true);
    try {
      let withdrawn = 0;
      let failed = 0;
      for (const wallet of walletsWithBalance) {
        try {
          const res = await apiService.withdrawSolFromWallet(wallet.address);
          if (res.data.success) {
            withdrawn += res.data.amountTransferred || 0;
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      }
      alert(`✅ Withdrawn: ${withdrawn.toFixed(4)} SOL${failed > 0 ? `\n⚠️ ${failed} failed` : ''}`);
      await loadWallets();
    } catch (error) {
      alert(`Error: ${error.message}`);
    } finally {
      setFundingLoading(false);
    }
  };

  const handleDeleteWallet = async (address) => {
    if (!confirm(`Delete wallet ${address.slice(0, 8)}...?`)) return;
    try {
      const res = await apiService.deleteWarmingWallet(address);
      if (res.data.success) {
        await loadWallets();
      } else {
        alert(`Failed: ${res.data.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.response?.data?.error || error.message}`);
    }
  };

  // Bulk delete selected wallets
  const handleBulkDelete = async () => {
    if (selectedWallets.length === 0) {
      alert('Please select wallets to delete');
      return;
    }
    if (!confirm(`Delete ${selectedWallets.length} wallet(s)?\n\nThis action cannot be undone.`)) return;
    
    setLoading(true);
    let deleted = 0;
    let failed = 0;
    
    try {
      for (const address of selectedWallets) {
        try {
          const res = await apiService.deleteWarmingWallet(address);
          if (res.data.success) {
            deleted++;
          } else {
            failed++;
          }
        } catch (error) {
          failed++;
        }
      }
      
      // Clear selection
      setSelectedWallets([]);
      
      // Reload wallets
      await loadWallets();
      
      if (failed === 0) {
        alert(`✅ Successfully deleted ${deleted} wallet(s)`);
      } else {
        alert(`⚠️ Deleted ${deleted} wallet(s), ${failed} failed`);
      }
    } catch (error) {
      alert(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSellAllTokens = async (address) => {
    if (!confirm(`Sell ALL tokens from ${address.slice(0, 8)}...?`)) return;
    setSellingTokens(prev => ({ ...prev, [address]: true }));
    try {
      const res = await apiService.sellAllTokensFromWallet(address);
      if (res.data.success) {
        alert(`Sold tokens! Recovered: ${res.data.solRecovered?.toFixed(4) || 0} SOL`);
        await loadWallets();
      } else {
        alert(`Failed: ${res.data.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setSellingTokens(prev => ({ ...prev, [address]: false }));
    }
  };

  const handleCloseEmptyAccounts = async (address) => {
    if (!confirm(`Close all empty token accounts from ${address.slice(0, 8)}...?\n\nThis will recover ~0.002 SOL rent per closed account.`)) return;
    setClosingAccounts(prev => ({ ...prev, [address]: true }));
    try {
      const res = await apiService.closeEmptyTokenAccounts(address);
      if (res.data.success) {
        alert(`✅ Closed ${res.data.closed} empty token account(s)\n💰 Recovered ${res.data.rentRecovered?.toFixed(6) || 0} SOL rent`);
        await loadWallets();
      } else {
        alert(`Failed: ${res.data.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setClosingAccounts(prev => ({ ...prev, [address]: false }));
    }
  };

  // Bulk close empty accounts for selected wallets
  const handleBulkCloseAccounts = async () => {
    if (selectedWallets.length === 0) {
      alert('Please select wallets to close empty token accounts');
      return;
    }
    if (!confirm(`Close all empty token accounts from ${selectedWallets.length} wallet(s)?\n\nThis will recover ~0.002 SOL rent per closed account.`)) return;
    
    setLoading(true);
    let totalClosed = 0;
    let totalRentRecovered = 0;
    let failed = 0;
    
    try {
      for (const address of selectedWallets) {
        try {
          const res = await apiService.closeEmptyTokenAccounts(address);
          if (res.data.success) {
            totalClosed += res.data.closed || 0;
            totalRentRecovered += res.data.rentRecovered || 0;
          } else {
            failed++;
          }
        } catch (error) {
          failed++;
        }
        // Small delay between wallets
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      await loadWallets();
      
      if (failed === 0) {
        alert(`✅ Closed ${totalClosed} empty token account(s) across ${selectedWallets.length} wallet(s)\n💰 Recovered ${totalRentRecovered.toFixed(6)} SOL rent`);
      } else {
        alert(`⚠️ Closed ${totalClosed} account(s), recovered ${totalRentRecovered.toFixed(6)} SOL\n${failed} wallet(s) failed`);
      }
    } catch (error) {
      alert(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshWallet = async (address) => {
    setRefreshingWallet(prev => ({ ...prev, [address]: true }));
    try {
      await apiService.updateWalletBalances([address]);
      // Reload wallets to get updated balance
      const res = await apiService.getWarmingWallets();
      if (res.data.success) {
        setWallets(res.data.wallets || []);
      }
    } catch (error) {
      console.error('Failed to refresh wallet:', error);
    } finally {
      setRefreshingWallet(prev => ({ ...prev, [address]: false }));
    }
  };

  const handleWithdrawSol = async (address) => {
    const wallet = wallets.find(w => w.address === address);
    if (!wallet || wallet.solBalance < 0.001) {
      alert('Insufficient balance');
      return;
    }
    if (!confirm(`Withdraw ~${(wallet.solBalance - 0.0001).toFixed(4)} SOL to funding wallet?`)) return;
    setWithdrawingSol(prev => ({ ...prev, [address]: true }));
    try {
      const res = await apiService.withdrawSolFromWallet(address);
      if (res.data.success) {
        alert(`Withdrawn: ${res.data.amountTransferred?.toFixed(4) || 0} SOL`);
        await loadWallets();
      } else {
        alert(`Failed: ${res.data.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setWithdrawingSol(prev => ({ ...prev, [address]: false }));
    }
  };

  const handleSaveTags = async (address) => {
    const newTags = editTagInputs[address]?.split(',').map(t => t.trim()).filter(t => t.length > 0) || [];
    try {
      const res = await apiService.updateWalletTags(address, newTags);
      if (res.data.success) {
        setEditingTags(prev => ({ ...prev, [address]: false }));
        await loadWallets();
      } else {
        alert(`Failed: ${res.data.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.response?.data?.error || error.message}`);
    }
  };

  const toggleWalletSelection = (address) => {
    setSelectedWallets(prev => 
      prev.includes(address) ? prev.filter(a => a !== address) : [...prev, address]
    );
  };

  // Compute filtered and sorted wallets
  const allTags = useMemo(() => {
    const tags = new Set();
    wallets.forEach(w => w.tags?.forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  }, [wallets]);

  const filteredAndSortedWallets = useMemo(() => {
    let result = [...wallets];

    // Apply filters
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(w => w.address.toLowerCase().includes(q));
    }
    if (tagFilter !== 'all') {
      result = result.filter(w => w.tags?.includes(tagFilter));
    }
    if (statusFilter !== 'all') {
      result = result.filter(w => w.status === statusFilter);
    }

    // Apply sorting
    result.sort((a, b) => {
      // FIRST: Recently created wallets always at top
      const aIsNew = recentlyCreated.includes(a.address);
      const bIsNew = recentlyCreated.includes(b.address);
      
      if (aIsNew && !bIsNew) return -1;
      if (!aIsNew && bIsNew) return 1;
      
      // If both are new, sort by order in recentlyCreated array
      if (aIsNew && bIsNew) {
        return recentlyCreated.indexOf(a.address) - recentlyCreated.indexOf(b.address);
      }
      
      // Normal sorting for non-new wallets
      let aVal, bVal;
      switch (sortBy) {
        case 'solBalance':
          aVal = a.solBalance || 0;
          bVal = b.solBalance || 0;
          break;
        case 'transactionCount':
          aVal = a.transactionCount || 0;
          bVal = b.transactionCount || 0;
          break;
        case 'totalTrades':
          aVal = a.totalTrades || 0;
          bVal = b.totalTrades || 0;
          break;
        case 'lastWarmedAt':
          aVal = a.lastWarmedAt ? new Date(a.lastWarmedAt).getTime() : 0;
          bVal = b.lastWarmedAt ? new Date(b.lastWarmedAt).getTime() : 0;
          break;
        default:
          aVal = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          bVal = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      }
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });

    return result;
  }, [wallets, searchQuery, tagFilter, statusFilter, sortBy, sortOrder, recentlyCreated]);

  const toggleSelectAll = () => {
    if (filteredAndSortedWallets.every(w => selectedWallets.includes(w.address))) {
      setSelectedWallets(prev => prev.filter(a => !filteredAndSortedWallets.map(w => w.address).includes(a)));
    } else {
      setSelectedWallets(prev => [...new Set([...prev, ...filteredAndSortedWallets.map(w => w.address)])]);
    }
  };

  // Calculate totals
  const totalSol = wallets.reduce((sum, w) => sum + (w.solBalance || 0), 0);
  const selectedSol = wallets.filter(w => selectedWallets.includes(w.address)).reduce((sum, w) => sum + (w.solBalance || 0), 0);

  return (
    <div className="p-4 max-w-7xl mx-auto">
      {/* ==================== FUNDING WALLET INFO BAR ==================== */}
      {fundingWallet && (
        <div className="mb-4 bg-gradient-to-r from-emerald-900/30 to-gray-900/30 border border-emerald-800/50 rounded-xl p-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-emerald-600 rounded-full flex items-center justify-center text-xl">
                🏦
              </div>
              <div>
                <div className="text-xs text-emerald-400 font-medium uppercase tracking-wide">Master Funding Wallet</div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-white text-sm">
                    {fundingWallet.address?.slice(0, 8)}...{fundingWallet.address?.slice(-8)}
                  </span>
                  <button
                    onClick={() => navigator.clipboard.writeText(fundingWallet.address)}
                    className="text-gray-400 hover:text-white text-xs"
                    title="Copy address"
                  >
                    📋
                  </button>
                  <a
                    href={`https://solscan.io/account/${fundingWallet.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-400 hover:text-white text-xs"
                    title="View on Solscan"
                  >
                    🔗
                  </a>
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-400">Available Balance</div>
              <div className={`text-2xl font-bold ${fundingWallet.balance > 1 ? 'text-emerald-400' : fundingWallet.balance > 0.1 ? 'text-yellow-400' : 'text-red-400'}`}>
                {fundingWallet.balance?.toFixed(4)} <span className="text-sm text-gray-400">SOL</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== TOP ACTION BAR ==================== */}
      <div className="sticky top-0 z-40 bg-gray-950/95 backdrop-blur-sm border-b border-gray-800 -mx-4 px-4 py-3 mb-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {/* Left: Title & Stats */}
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              🔥 Wallet Warming
            </h1>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-gray-400">
                <span className="text-white font-medium">{wallets.length}</span> wallets
              </span>
              <span className="text-gray-400">
                <span className="text-green-400 font-medium">{totalSol.toFixed(3)}</span> SOL
              </span>
              {selectedWallets.length > 0 && (
                <span className="text-blue-400">
                  {selectedWallets.length} selected ({selectedSol.toFixed(3)} SOL)
                </span>
              )}
            </div>
          </div>
          
          {/* Right: Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Funding Buttons */}
            <button
              onClick={() => setShowFundingModal(true)}
              disabled={loading || selectedWallets.length === 0}
              className={`px-3 py-2 font-medium rounded-lg transition-colors text-sm ${
                selectedWallets.length === 0
                  ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              }`}
              title="Fund selected wallets: Send SOL directly from your main funding wallet to selected wallets. Fast and simple, but creates an on-chain link."
            >
              💰 Fund ({selectedWallets.length})
            </button>
            <button
              onClick={handleBulkWithdraw}
              disabled={fundingLoading || selectedWallets.length === 0}
              className={`px-3 py-2 font-medium rounded-lg transition-colors text-sm ${
                selectedWallets.length === 0
                  ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                  : 'bg-cyan-600 hover:bg-cyan-700 text-white'
              }`}
              title="Withdraw: Collect SOL from selected wallets back to your main funding wallet. Useful for gathering funds after trading."
            >
              📤 Withdraw
            </button>
            <button
              onClick={() => setShowPrivateFunding(true)}
              className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg transition-colors text-sm"
              title="Private Funding: Break the on-chain link by bridging SOL → ETH (on selected EVM chain) → SOL via Mayan Finance. Each wallet can use a different chain (Base, BSC, Polygon, etc.) for maximum anonymity. Takes 2-5 minutes but makes wallets appear to be funded from different sources."
            >
              🔒 Private
            </button>
            <button
              onClick={handleBulkCloseAccounts}
              disabled={loading || selectedWallets.length === 0}
              className={`px-3 py-2 font-medium rounded-lg transition-colors text-sm ${
                selectedWallets.length === 0
                  ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                  : 'bg-orange-600 hover:bg-orange-700 text-white'
              }`}
              title="Close all empty token accounts in selected wallets (recover ~0.002 SOL rent per account)"
            >
              🗑️ Close Accounts ({selectedWallets.length})
            </button>
            
            <button
              onClick={handleBulkDelete}
              disabled={loading || selectedWallets.length === 0}
              className={`px-3 py-2 font-medium rounded-lg transition-colors text-sm ${
                selectedWallets.length === 0
                  ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                  : 'bg-red-600 hover:bg-red-700 text-white'
              }`}
              title="Delete: Permanently remove selected wallets from the system. This action cannot be undone. Make sure wallets are empty or you've withdrawn funds first."
            >
              🗑️ Delete ({selectedWallets.length})
            </button>
            
            <div className="w-px h-6 bg-gray-700 mx-1" />
            
            {/* Create/Add Buttons */}
            <button
              onClick={handleCreateWallet}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2 text-sm"
              title="Create Wallets: Generate one or more new Solana wallets with random private keys. Wallets are stored securely and can be tagged for organization."
            >
              ➕ Create Wallets
            </button>
            <button
              onClick={() => setShowAddWalletModal(true)}
              disabled={loading}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2 text-sm"
              title="Add Existing: Import an existing wallet by entering its private key (base58 format). Useful for managing wallets created elsewhere."
            >
              📥 Add Existing
            </button>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`px-3 py-2 rounded-lg transition-colors text-sm ${showSettings ? 'bg-purple-600 text-white' : 'bg-gray-800 hover:bg-gray-700 text-gray-300'}`}
              title="Settings: Configure wallet warming parameters (trades per wallet, buy amounts, intervals, etc.)"
            >
              ⚙️ Settings
            </button>
            <button
              onClick={async () => {
                setRecentlyCreated([]); // Clear NEW badges on refresh
                setRefreshingBalances(true);
                setRefreshMessage('🔄 Fetching balances from blockchain...');
                try {
                  await loadWallets(true, true); // Refresh balances AND transaction stats from blockchain
                  setRefreshMessage('✅ Balances updated!');
                  setTimeout(() => setRefreshMessage(null), 3000);
                } catch (error) {
                  setRefreshMessage('❌ Failed to refresh balances');
                  setTimeout(() => setRefreshMessage(null), 3000);
                } finally {
                  setRefreshingBalances(false);
                }
              }}
              disabled={refreshingBalances}
              className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                refreshingBalances 
                  ? 'bg-gray-700 text-gray-400 cursor-wait' 
                  : 'bg-gray-800 hover:bg-gray-700 text-white'
              }`}
              title="Refresh: Update wallet balances and transaction stats from blockchain. Note: If you just completed a Mayan bridge, wait 2-5 minutes for funds to arrive before refreshing."
            >
              {refreshingBalances ? <span className="animate-spin inline-block">🔄</span> : '🔄'}
            </button>
            {refreshMessage && (
              <span className="text-xs text-gray-400 px-2">{refreshMessage}</span>
            )}
            <button
              onClick={async () => {
                if (selectedWallets.length === 0) {
                  alert('Please select wallets to refresh transaction stats');
                  return;
                }
                setLoading(true);
                try {
                  console.log(`[WalletWarming] Refreshing transaction stats for ${selectedWallets.length} wallet(s)...`);
                  await apiService.updateWalletStats(selectedWallets);
                  await loadWallets(false, false); // Reload wallets to show updated stats
                  alert(`✅ Transaction stats updated for ${selectedWallets.length} wallet(s)`);
                } catch (error) {
                  alert(`Error: ${error.response?.data?.error || error.message}`);
                } finally {
                  setLoading(false);
                }
              }}
              disabled={loading || selectedWallets.length === 0}
              className={`px-3 py-2 font-medium rounded-lg text-sm transition-colors ${
                selectedWallets.length === 0
                  ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
              title="Refresh Stats: Fetch real transaction counts, trades, and dates from blockchain for selected wallets. This queries Solana to get actual on-chain data."
            >
              📊 Stats ({selectedWallets.length})
            </button>
          </div>
        </div>
      </div>

      {/* ==================== SETTINGS PANEL (Collapsible) ==================== */}
      {showSettings && (
        <div className="mb-4 bg-gray-900/80 border border-gray-800 rounded-xl p-4 animate-in slide-in-from-top duration-200">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Trades/Wallet</label>
              <input
                type="number"
                value={config.tradesPerWallet}
                onChange={(e) => setConfig({ ...config, tradesPerWallet: parseInt(e.target.value) || 2 })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                min="1"
                max="10"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Min Buy (SOL)</label>
              <input
                type="number"
                step="0.0001"
                value={config.minBuyAmount}
                onChange={(e) => setConfig({ ...config, minBuyAmount: parseFloat(e.target.value) || 0.0002 })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Max Buy (SOL)</label>
              <input
                type="number"
                step="0.0001"
                value={config.maxBuyAmount}
                onChange={(e) => setConfig({ ...config, maxBuyAmount: parseFloat(e.target.value) || 0.0003 })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Trading Pattern</label>
              <select
                value={config.tradingPattern || 'sequential'}
                onChange={(e) => setConfig({ ...config, tradingPattern: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                title="Sequential: Buy→Sell repeatedly. Randomized: Buy multiple, sell selectively. Accumulate: Buy all, sell all at end."
              >
                <option value="sequential">Sequential (Buy→Sell, Buy→Sell...)</option>
                <option value="randomized">Randomized (Buy 2→Sell 1→Buy 1→Sell 2...)</option>
                <option value="accumulate">Accumulate (Buy multiple, sell all at end)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Parallel Wallets</label>
              <input
                type="number"
                value={config.walletsPerBatch || 2}
                onChange={(e) => setConfig({ ...config, walletsPerBatch: parseInt(e.target.value) || 2 })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                min="1"
                max="10"
                disabled={selectedWallets.length <= 1}
                title={selectedWallets.length <= 1 
                  ? "Parallel processing only applies when multiple wallets are selected. With 1 wallet, it processes normally."
                  : "How many wallets to process simultaneously. If you select 10 wallets and set this to 3, it will process 3 at a time in batches."}
              />
              {selectedWallets.length <= 1 && (
                <p className="text-xs text-gray-500 mt-1">Only applies with multiple wallets</p>
              )}
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Funding (SOL)</label>
              <input
                type="number"
                step="0.005"
                value={config.fundingAmount}
                onChange={(e) => setConfig({ ...config, fundingAmount: parseFloat(e.target.value) || 0.015 })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                disabled={config.skipFunding}
              />
            </div>
            <div className="flex items-center">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.skipFunding}
                  onChange={(e) => setConfig({ ...config, skipFunding: e.target.checked })}
                  className="w-4 h-4 accent-green-500"
                />
                <span className="text-sm text-gray-300">Skip Funding</span>
              </label>
            </div>
            <div className="flex items-center">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.useTrendingTokens}
                  onChange={(e) => setConfig({ ...config, useTrendingTokens: e.target.checked })}
                  className="w-4 h-4 accent-blue-500"
                />
                <span className="text-sm text-gray-300">Trending Tokens</span>
              </label>
            </div>
            <div className="flex items-center">
              <label className="flex items-center gap-2 cursor-pointer" title={config.closeTokenAccounts ? "Clean Mode: Sell 100% and close accounts (recover rent ~0.002 SOL per trade)" : "Cheap Mode: Sell 99.9% and keep dust (no close tx, cheaper for many trades)"}>
                <input
                  type="checkbox"
                  checked={config.closeTokenAccounts}
                  onChange={(e) => setConfig({ ...config, closeTokenAccounts: e.target.checked })}
                  className="w-4 h-4 accent-purple-500"
                />
                <span className="text-sm text-gray-300">Close Accounts</span>
              </label>
            </div>
          </div>
          
          {/* Mode explanation */}
          <div className="mt-3 pt-3 border-t border-gray-800">
            <div className="text-xs text-gray-400">
              <strong>Mode:</strong> {config.closeTokenAccounts ? (
                <span className="text-green-400">Clean Mode - Sells 100% and closes token accounts (recover ~0.002 SOL rent per trade, cleaner wallets)</span>
              ) : (
                <span className="text-orange-400">Cheap Mode - Sells 99.9% and keeps dust (no close tx, build many transactions cheaply)</span>
              )}
            </div>
          </div>
          
          {/* Trending Tokens Preview */}
          <div className="mt-4 pt-4 border-t border-gray-800">
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => setShowTrendingTokens(!showTrendingTokens)}
                className="text-sm text-gray-400 hover:text-white flex items-center gap-2"
              >
                {showTrendingTokens ? '▼' : '▶'} Trending Tokens ({trendingTokens.length})
              </button>
              <button
                onClick={() => loadTrendingTokens(true)}
                disabled={trendingStatus.loading}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                {trendingStatus.loading ? 'Loading...' : 'Refresh'}
              </button>
            </div>
            {showTrendingTokens && trendingTokens.length > 0 && (
              <div className="grid grid-cols-4 md:grid-cols-8 gap-2 max-h-32 overflow-y-auto">
                {trendingTokens.slice(0, 24).map((token, idx) => (
                  <div key={idx} className="bg-gray-800/50 rounded p-2 text-xs">
                    <div className="font-medium text-white truncate">{token.symbol}</div>
                    <div className="text-gray-500 text-[10px]">{token.type}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== FILTERS & BULK ACTIONS ==================== */}
      <div className="mb-4 bg-gray-900/50 border border-gray-800 rounded-xl p-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="🔍 Search address..."
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm w-48"
          />
          
          {/* Filters */}
          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
          >
            <option value="all">All Tags</option>
            {allTags.map(tag => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>
          
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
          >
            <option value="all">All Status</option>
            <option value="idle">Idle</option>
            <option value="warming">Warming</option>
            <option value="ready">Ready</option>
          </select>
          
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
          >
            <option value="solBalance">Sort: Balance</option>
            <option value="transactionCount">Sort: Txns</option>
            <option value="totalTrades">Sort: Trades</option>
            <option value="lastWarmedAt">Sort: Last Warmed</option>
          </select>
          
          <button
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm"
          >
            {sortOrder === 'asc' ? '⬆️' : '⬇️'}
          </button>
          
          <div className="flex-1" />
          
          {/* Bulk Actions */}
          <button
            onClick={toggleSelectAll}
            className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm"
          >
            {filteredAndSortedWallets.every(w => selectedWallets.includes(w.address)) ? '❌ Deselect' : '✅ Select'} All
          </button>
          
          <button
            onClick={handleStartWarming}
            disabled={loading || selectedWallets.length === 0}
            className={`px-4 py-2 font-medium rounded-lg text-sm transition-colors ${
              selectedWallets.length === 0
                ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                : 'bg-orange-600 hover:bg-orange-700 text-white'
            }`}
            title={`Start Warming: Execute small trades on ${selectedWallets.length} wallet(s) IN PARALLEL to build transaction history. Makes wallets appear more organic and less suspicious. Configure trade amounts, patterns, and intervals in Settings.`}
          >
            🔥 Start Warming ({selectedWallets.length}) {selectedWallets.length > 1 ? '(Parallel)' : ''}
          </button>
        </div>
      </div>

      {/* ==================== WALLET TABLE ==================== */}
      <div className="bg-gray-900/30 border border-gray-800 rounded-xl overflow-hidden">
        <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
          <table className="w-full">
            <thead className="bg-gray-900/80 sticky top-0">
              <tr className="text-left text-xs text-gray-400 uppercase">
                <th className="px-3 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={filteredAndSortedWallets.length > 0 && filteredAndSortedWallets.every(w => selectedWallets.includes(w.address))}
                    onChange={toggleSelectAll}
                    className="w-4 h-4"
                  />
                </th>
                <th className="px-3 py-3">Address</th>
                <th className="px-3 py-3 text-right">Balance</th>
                <th className="px-3 py-3 text-center">Txns</th>
                <th className="px-3 py-3 text-center">Trades</th>
                <th className="px-3 py-3 text-center">First Tx</th>
                <th className="px-3 py-3 text-center">Last Tx</th>
                <th className="px-3 py-3">Tags</th>
                <th className="px-3 py-3 text-center">Status</th>
                <th className="px-3 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {filteredAndSortedWallets.map((wallet) => {
                const isNew = recentlyCreated.includes(wallet.address);
                return (
                <tr 
                  key={wallet.address}
                  className={`hover:bg-gray-800/30 transition-colors ${selectedWallets.includes(wallet.address) ? 'bg-blue-900/20' : ''} ${isNew ? 'bg-emerald-900/20 animate-pulse' : ''}`}
                >
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selectedWallets.includes(wallet.address)}
                      onChange={() => toggleWalletSelection(wallet.address)}
                      className="w-4 h-4"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <div className="font-mono text-sm text-white">
                        {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
                      </div>
                      {isNew && (
                        <span className="px-1.5 py-0.5 bg-emerald-500 text-white text-xs font-bold rounded animate-pulse">
                          NEW
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => navigator.clipboard.writeText(wallet.address)}
                      className="text-xs text-gray-500 hover:text-gray-300"
                    >
                      Copy
                    </button>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <span className={`font-medium ${wallet.solBalance > 0.01 ? 'text-green-400' : wallet.solBalance > 0 ? 'text-yellow-400' : 'text-gray-500'}`}>
                      {(wallet.solBalance || 0).toFixed(4)}
                    </span>
                    <span className="text-gray-500 text-xs ml-1">SOL</span>
                  </td>
                  <td className="px-3 py-3 text-center text-sm text-gray-300">
                    {wallet.transactionCount || 0}
                  </td>
                  <td className="px-3 py-3 text-center text-sm text-gray-300">
                    {wallet.totalTrades || 0}
                  </td>
                  <td className="px-3 py-3 text-center text-xs text-gray-400">
                    {wallet.firstTransactionDate ? (
                      <div className="flex flex-col">
                        <span>{new Date(wallet.firstTransactionDate).toLocaleDateString()}</span>
                        <span className="text-gray-500">{new Date(wallet.firstTransactionDate).toLocaleTimeString()}</span>
                      </div>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-center text-xs text-gray-400">
                    {wallet.lastTransactionDate ? (
                      <div className="flex flex-col">
                        <span>{new Date(wallet.lastTransactionDate).toLocaleDateString()}</span>
                        <span className="text-gray-500">{new Date(wallet.lastTransactionDate).toLocaleTimeString()}</span>
                      </div>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {editingTags[wallet.address] ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={editTagInputs[wallet.address] || ''}
                          onChange={(e) => setEditTagInputs({ ...editTagInputs, [wallet.address]: e.target.value })}
                          className="px-2 py-1 bg-gray-800 border border-gray-600 rounded text-xs text-white w-24"
                          placeholder="tag1, tag2"
                        />
                        <button onClick={() => handleSaveTags(wallet.address)} className="text-green-400 text-xs">✓</button>
                        <button onClick={() => setEditingTags({ ...editingTags, [wallet.address]: false })} className="text-red-400 text-xs">✕</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 flex-wrap">
                        {wallet.tags?.slice(0, 2).map((tag, idx) => (
                          <span key={idx} className="px-1.5 py-0.5 bg-gray-700 text-gray-300 rounded text-[10px]">
                            {tag}
                          </span>
                        ))}
                        {wallet.tags?.length > 2 && (
                          <span className="text-gray-500 text-[10px]">+{wallet.tags.length - 2}</span>
                        )}
                        <button
                          onClick={() => {
                            setEditingTags({ ...editingTags, [wallet.address]: true });
                            setEditTagInputs({ ...editTagInputs, [wallet.address]: wallet.tags?.join(', ') || '' });
                          }}
                          className="text-gray-500 hover:text-gray-300 text-xs"
                        >
                          ✏️
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      wallet.status === 'warming' ? 'bg-orange-900/50 text-orange-400' :
                      wallet.status === 'ready' ? 'bg-green-900/50 text-green-400' :
                      'bg-gray-800 text-gray-400'
                    }`}>
                      {wallet.status === 'warming' ? '🔥' : wallet.status === 'ready' ? '✅' : '⏸️'} {wallet.status || 'idle'}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleRefreshWallet(wallet.address)}
                        disabled={refreshingWallet[wallet.address]}
                        className="px-2 py-1 bg-gray-600/80 hover:bg-gray-600 text-white rounded text-xs disabled:opacity-50"
                        title="Refresh balance"
                      >
                        {refreshingWallet[wallet.address] ? <span className="animate-spin inline-block">🔄</span> : '🔄'}
                      </button>
                      <button
                        onClick={() => handleSellAllTokens(wallet.address)}
                        disabled={sellingTokens[wallet.address]}
                        className="px-2 py-1 bg-purple-600/80 hover:bg-purple-600 text-white rounded text-xs disabled:opacity-50"
                        title="Sell all tokens"
                      >
                        {sellingTokens[wallet.address] ? '...' : '💸'}
                      </button>
                      <button
                        onClick={() => handleCloseEmptyAccounts(wallet.address)}
                        disabled={closingAccounts[wallet.address]}
                        className="px-2 py-1 bg-orange-600/80 hover:bg-orange-600 text-white rounded text-xs disabled:opacity-50"
                        title="Close empty token accounts (recover ~0.002 SOL rent per account)"
                      >
                        {closingAccounts[wallet.address] ? '...' : '🗑️'}
                      </button>
                      <button
                        onClick={() => handleWithdrawSol(wallet.address)}
                        disabled={withdrawingSol[wallet.address] || (wallet.solBalance || 0) < 0.001}
                        className="px-2 py-1 bg-cyan-600/80 hover:bg-cyan-600 text-white rounded text-xs disabled:opacity-50"
                        title="Withdraw SOL"
                      >
                        {withdrawingSol[wallet.address] ? '...' : '💰'}
                      </button>
                      <button
                        onClick={() => handleDeleteWallet(wallet.address)}
                        className="px-2 py-1 bg-red-600/80 hover:bg-red-600 text-white rounded text-xs"
                        title="Delete wallet"
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              );
              })}
              {filteredAndSortedWallets.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-gray-500">
                    {wallets.length === 0 ? (
                      <div>
                        <p className="text-lg mb-2">No wallets yet</p>
                        <p className="text-sm">Click "Create Wallet" to get started</p>
                      </div>
                    ) : (
                      <p>No wallets match your filters</p>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ==================== CREATE WALLETS MODAL ==================== */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">➕ Create New Wallets</h3>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setCreateCount(1);
                  setCreateTags([]);
                  setCreateTagInput('');
                }}
                className="text-gray-400 hover:text-white text-xl"
              >
                ×
              </button>
            </div>
            
            <div className="space-y-4">
              {/* Number of wallets */}
              <div>
                <label className="text-sm text-gray-400 mb-1 block">Number of Wallets</label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCreateCount(Math.max(1, createCount - 1))}
                    className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white font-bold"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={createCount}
                    onChange={(e) => setCreateCount(Math.min(50, Math.max(1, parseInt(e.target.value) || 1)))}
                    className="w-20 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-center text-lg font-bold"
                  />
                  <button
                    onClick={() => setCreateCount(Math.min(50, createCount + 1))}
                    className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white font-bold"
                  >
                    +
                  </button>
                  <div className="flex gap-1 ml-2">
                    {[5, 10, 20].map(n => (
                      <button
                        key={n}
                        onClick={() => setCreateCount(n)}
                        className={`px-2 py-1 rounded text-xs ${createCount === n ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              
              {/* Tags */}
              <div>
                <label className="text-sm text-gray-400 mb-1 block">Tags (optional)</label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={createTagInput}
                    onChange={(e) => setCreateTagInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addCreateTag()}
                    placeholder="Enter tag name"
                    className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm"
                  />
                  <select
                    value={createTagColor}
                    onChange={(e) => setCreateTagColor(e.target.value)}
                    className="px-2 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm"
                  >
                    {tagColors.map(c => (
                      <option key={c.id} value={c.id}>{c.id}</option>
                    ))}
                  </select>
                  <button
                    onClick={addCreateTag}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm"
                  >
                    Add
                  </button>
                </div>
                
                {/* Tag colors preview */}
                <div className="flex flex-wrap gap-1 mb-2">
                  {tagColors.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setCreateTagColor(c.id)}
                      className={`w-6 h-6 rounded-full border-2 ${c.bg} ${createTagColor === c.id ? 'ring-2 ring-white ring-offset-1 ring-offset-gray-900' : ''}`}
                      title={c.id}
                    />
                  ))}
                </div>
                
                {/* Added tags */}
                {createTags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {createTags.map((tag, i) => {
                      const colorDef = tagColors.find(c => c.id === tag.color) || tagColors[0];
                      return (
                        <span
                          key={i}
                          className={`inline-flex items-center gap-1 px-2 py-1 ${colorDef.bg} ${colorDef.text} border ${colorDef.border} rounded text-xs`}
                        >
                          {tag.name}
                          <button
                            onClick={() => removeCreateTag(tag.name)}
                            className="hover:text-white"
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
              
              {/* Summary */}
              <div className="p-3 bg-gray-800/50 rounded-lg">
                <div className="text-sm text-gray-300">
                  Creating <span className="text-white font-bold">{createCount}</span> wallet{createCount > 1 ? 's' : ''}
                  {createTags.length > 0 && (
                    <span> with {createTags.length} tag{createTags.length > 1 ? 's' : ''}</span>
                  )}
                </div>
              </div>
              
              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateWallets}
                  disabled={creating}
                  className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {creating ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      Creating...
                    </>
                  ) : (
                    <>
                      ➕ Create {createCount} Wallet{createCount > 1 ? 's' : ''}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== ADD WALLET MODAL ==================== */}
      {showAddWalletModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">Add Existing Wallet</h3>
              <button
                onClick={() => {
                  setShowAddWalletModal(false);
                  setNewWalletPrivateKey('');
                  setNewWalletTags('');
                  setWalletPreview(null);
                }}
                className="text-gray-400 hover:text-white text-xl"
              >
                ×
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="text-sm text-gray-400 mb-1 block">Private Key (base58)</label>
                <input
                  type="password"
                  value={newWalletPrivateKey}
                  onChange={(e) => {
                    setNewWalletPrivateKey(e.target.value);
                    handlePreviewWallet(e.target.value);
                  }}
                  placeholder="Enter private key"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              
              {previewLoading && (
                <div className="p-3 bg-gray-800 rounded-lg text-sm text-gray-400">Loading...</div>
              )}
              
              {walletPreview && !previewLoading && (
                <div className={`p-3 rounded-lg border ${walletPreview.error ? 'bg-red-900/20 border-red-700' : 'bg-green-900/20 border-green-700'}`}>
                  {walletPreview.error ? (
                    <p className="text-sm text-red-400">❌ {walletPreview.error}</p>
                  ) : (
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Address:</span>
                        <span className="font-mono text-green-400">{walletPreview.address?.slice(0, 8)}...{walletPreview.address?.slice(-4)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Balance:</span>
                        <span className="font-bold text-green-400">{walletPreview.solBalanceFormatted} SOL</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              <div>
                <label className="text-sm text-gray-400 mb-1 block">Tags (optional, comma-separated)</label>
                <input
                  type="text"
                  value={newWalletTags}
                  onChange={(e) => setNewWalletTags(e.target.value)}
                  placeholder="e.g., main, trading"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
                />
              </div>
              
              <button
                onClick={handleAddExistingWallet}
                disabled={loading || !newWalletPrivateKey.trim() || walletPreview?.error}
                className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {loading ? 'Adding...' : 'Add Wallet'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== FUND WALLETS MODAL ==================== */}
      {showFundingModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">💰 Fund Wallets</h3>
              <button
                onClick={() => setShowFundingModal(false)}
                className="text-gray-400 hover:text-white text-xl"
              >
                ×
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="p-3 bg-gray-800/50 rounded-lg">
                <div className="text-sm text-gray-400 mb-1">Selected Wallets</div>
                <div className="text-xl font-bold text-white">{selectedWallets.length}</div>
              </div>
              
              <div>
                <label className="text-sm text-gray-400 mb-1 block">Amount per Wallet (SOL)</label>
                <input
                  type="number"
                  step="0.01"
                  value={fundingAmount}
                  onChange={(e) => setFundingAmount(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
                  min="0.001"
                />
              </div>
              
              <div className="p-3 bg-emerald-900/20 border border-emerald-700/50 rounded-lg">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Total Required:</span>
                  <span className="font-bold text-emerald-400">
                    {(parseFloat(fundingAmount) * selectedWallets.length || 0).toFixed(4)} SOL
                  </span>
                </div>
              </div>
              
              <div className="text-xs text-gray-500">
                Funds will be sent from your main funding wallet (PRIVATE_KEY in .env)
              </div>
              
              <button
                onClick={handleFundWallets}
                disabled={fundingLoading || selectedWallets.length === 0}
                className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {fundingLoading ? 'Funding...' : `Fund ${selectedWallets.length} Wallet(s)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== PRIVATE FUNDING MODAL ==================== */}
      {showPrivateFunding && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">Private Funding</h3>
              <button
                onClick={() => {
                  setShowPrivateFunding(false);
                  setBridgeStatus(null);
                }}
                className="text-gray-400 hover:text-white text-xl"
              >
                ×
              </button>
            </div>
            
            <div className="space-y-4">
              {/* Method Selection - Simplified */}
              <div className="flex gap-2">
                <button
                  onClick={() => setPrivateFundingMethod('mayan')}
                  className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    privateFundingMethod === 'mayan' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  Mayan Bridge
                </button>
                <button
                  onClick={() => setPrivateFundingMethod('sol-intermediaries')}
                  className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    privateFundingMethod === 'sol-intermediaries' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  SOL Chain
                </button>
              </div>

              {/* Flow Visualization - Unified styling */}
              <div className="p-3 bg-gray-800/50 border border-gray-700 rounded-lg">
                {privateFundingMethod === 'mayan' ? (
                  <>
                    <div className="text-xs text-gray-400 mb-2">Route:</div>
                    <div className="text-xs font-mono text-gray-300 flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-1 bg-gray-700 rounded">SOL</span>
                      <span>→</span>
                      <span className="px-2 py-1 bg-gray-700 rounded">ETH ({bridgeChain})</span>
                      <span>→</span>
                      <span className="px-2 py-1 bg-gray-700 rounded">SOL</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-2">
                      Cross-chain bridge via Mayan Finance • Takes 2-5 minutes
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-xs text-gray-400 mb-2">Route:</div>
                    <div className="text-xs font-mono text-gray-300 flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-1 bg-gray-700 rounded">SOL</span>
                      <span>→</span>
                      <span className="px-2 py-1 bg-gray-700 rounded">{intermediaryCount} Wallets</span>
                      <span>→</span>
                      <span className="px-2 py-1 bg-gray-700 rounded">SOL</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-2">
                      Sequential SOL wallet chain • Faster, no cross-chain wait
                    </div>
                  </>
                )}
              </div>
              
              {/* Fund Mode */}
              {privateFundingStep === 1 && (
                <div className="space-y-3">
                  <div className="p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                    <div className="text-xs text-gray-400 mb-1">Wallets to fund:</div>
                    <div className="text-white font-medium">
                      {selectedWallets.length > 0 ? (
                        <span>{selectedWallets.length} wallet{selectedWallets.length > 1 ? 's' : ''} selected</span>
                      ) : (
                        <span className="text-gray-500 text-sm">Select wallets from the list above</span>
                      )}
                    </div>
                  </div>
                  
                  <div>
                    <label className="text-sm text-gray-400 mb-1 block">Total SOL Amount</label>
                    <input
                      type="number"
                      step="0.1"
                      value={bridgeAmount}
                      onChange={(e) => setBridgeAmount(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white"
                      min="0.1"
                    />
                    {selectedWallets.length > 0 && (
                      <div className="text-xs text-gray-500 mt-1">
                        ≈ {(parseFloat(bridgeAmount || 0) / selectedWallets.length).toFixed(4)} SOL per wallet
                      </div>
                    )}
                  </div>
                  
                  {privateFundingMethod === 'mayan' ? (
                    <>
                      <div>
                        <label className="text-xs text-gray-400 mb-1 block">Chain</label>
                        <select
                          value={bridgeChain}
                          onChange={(e) => setBridgeChain(e.target.value)}
                          className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm"
                        >
                          <option value="base">Base</option>
                          <option value="bsc">BSC</option>
                          <option value="ethereum">Ethereum</option>
                          <option value="polygon">Polygon</option>
                          <option value="avalanche">Avalanche</option>
                          <option value="arbitrum">Arbitrum</option>
                          <option value="optimism">Optimism</option>
                        </select>
                      </div>
                      
                      {bridgeStatus && (
                        <div className={`p-3 rounded-lg border text-sm ${
                          bridgeStatus.error 
                            ? 'bg-red-900/20 border-red-700/50 text-red-300' 
                            : bridgeStatus.success 
                              ? 'bg-green-900/20 border-green-700/50 text-green-300'
                              : 'bg-gray-800/50 border-gray-700 text-gray-300'
                        }`}>
                          {bridgeStatus.message}
                        </div>
                      )}
                      
                      <button
                        onClick={async () => {
                          if (selectedWallets.length === 0) {
                            setBridgeStatus({ error: true, message: 'Please select wallets first' });
                            return;
                          }
                          setBridgeLoading(true);
                          setBridgeStatus({ message: 'Starting bridge... This takes 2-5 minutes' });
                          try {
                            const res = await apiService.autoFundWallets('main', selectedWallets, parseFloat(bridgeAmount), bridgeChain);
                          if (res.data.success) {
                            setBridgeStatus({ 
                              success: true, 
                              message: `Private funding initiated! Funds will arrive in 2-5 minutes.` 
                            });
                            setTimeout(() => {
                              setBridgeStatus({ 
                                message: `Bridge in progress... Funds should arrive soon.` 
                              });
                            }, 60000);
                          } else {
                            setBridgeStatus({ error: true, message: res.data.error });
                          }
                          } catch (error) {
                            setBridgeStatus({ error: true, message: error.response?.data?.error || error.message });
                          } finally {
                            setBridgeLoading(false);
                          }
                        }}
                        disabled={bridgeLoading || selectedWallets.length === 0}
                        className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {bridgeLoading ? 'Processing...' : 'Start Private Funding'}
                      </button>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="text-xs text-gray-400 mb-1 block">Intermediary Wallets</label>
                        <input
                          type="number"
                          min="1"
                          max="50"
                          value={intermediaryCount}
                          onChange={(e) => setIntermediaryCount(Math.min(50, Math.max(1, parseInt(e.target.value) || 10)))}
                          className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm"
                          placeholder="10"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          More wallets = better privacy • Recommended: 10-20
                        </p>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="reuseIntermediaries"
                          checked={reuseSavedIntermediaries}
                          onChange={(e) => setReuseSavedIntermediaries(e.target.checked)}
                          className="w-4 h-4 text-blue-600 bg-gray-800 border-gray-600 rounded focus:ring-blue-500"
                        />
                        <label htmlFor="reuseIntermediaries" className="text-xs text-gray-400">
                          Reuse saved wallets if available
                        </label>
                      </div>
                      
                      {bridgeStatus && (
                        <div className={`p-3 rounded-lg border text-sm ${
                          bridgeStatus.error 
                            ? 'bg-red-900/20 border-red-700/50 text-red-300' 
                            : bridgeStatus.success 
                              ? 'bg-green-900/20 border-green-700/50 text-green-300'
                              : 'bg-gray-800/50 border-gray-700 text-gray-300'
                        }`}>
                          {bridgeStatus.message}
                        </div>
                      )}
                      
                      <button
                        onClick={async () => {
                          if (selectedWallets.length === 0) {
                            setBridgeStatus({ error: true, message: 'Please select wallets first' });
                            return;
                          }
                          setBridgeLoading(true);
                          setBridgeStatus({ message: 'Generating intermediary wallets and routing funds...' });
                          try {
                            const res = await apiService.fundWalletsViaSolIntermediaries(
                              'main',
                              selectedWallets,
                              parseFloat(bridgeAmount),
                              intermediaryCount,
                              reuseSavedIntermediaries
                            );
                            
                            if (res.data.success) {
                              setBridgeStatus({ 
                                success: true, 
                                message: `Private funding complete! ${res.data.chainResults?.filter(r => r.success).length || 0}/${selectedWallets.length} wallets funded via ${intermediaryCount} intermediaries.` 
                              });
                              setTimeout(() => {
                                loadWallets(true);
                              }, 2000);
                            } else {
                              setBridgeStatus({ error: true, message: res.data.error });
                            }
                          } catch (error) {
                            setBridgeStatus({ error: true, message: error.response?.data?.error || error.message });
                          } finally {
                            setBridgeLoading(false);
                          }
                        }}
                        disabled={bridgeLoading || selectedWallets.length === 0}
                        className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {bridgeLoading ? 'Processing...' : 'Start Private Funding'}
                      </button>
                    </>
                  )}
                  
                  {/* Recover SOL from Intermediaries - available in Fund tab too */}
                  <div className="pt-3 border-t border-gray-700">
                    <div className="text-xs text-gray-400 mb-2">Recover from failed intermediary chain:</div>
                    <button
                      onClick={async () => {
                        setBridgeLoading(true);
                        setBridgeStatus({ message: 'Checking intermediary wallets...' });
                        try {
                          const res = await apiService.recoverSolIntermediaries('main');
                          if (res.data.success) {
                            setBridgeStatus({ 
                              success: true, 
                              message: `Recovered ${res.data.totalRecovered?.toFixed(6) || 0} SOL from ${res.data.successCount || 0} wallets` 
                            });
                            setTimeout(() => {
                              loadWallets(true);
                              loadFundingWallet();
                            }, 2000);
                          } else {
                            setBridgeStatus({ error: true, message: res.data.error });
                          }
                        } catch (error) {
                          setBridgeStatus({ error: true, message: error.response?.data?.error || error.message });
                        } finally {
                          setBridgeLoading(false);
                        }
                      }}
                      disabled={bridgeLoading}
                      className="w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-lg transition-colors disabled:opacity-50 text-sm"
                    >
                      {bridgeLoading ? 'Processing...' : 'Recover SOL from Intermediaries'}
                    </button>
                  </div>
                </div>
              )}
              
              {/* Withdraw & Recover - Simplified */}
              {privateFundingStep === 2 && (
                <div className="space-y-3">
                  <div className="p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                    <div className="text-xs text-gray-400 mb-1">Wallets to withdraw from:</div>
                    <div className="text-white font-medium">
                      {selectedWallets.length > 0 ? (
                        <span>{selectedWallets.length} wallet{selectedWallets.length > 1 ? 's' : ''} • {selectedSol.toFixed(4)} SOL</span>
                      ) : (
                        <span className="text-gray-500 text-sm">Select wallets from the list above</span>
                      )}
                    </div>
                  </div>
                  
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Chain</label>
                    <select
                      value={bridgeChain}
                      onChange={(e) => setBridgeChain(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm"
                    >
                      <option value="base">Base</option>
                      <option value="bsc">BSC</option>
                      <option value="ethereum">Ethereum</option>
                      <option value="polygon">Polygon</option>
                      <option value="avalanche">Avalanche</option>
                      <option value="arbitrum">Arbitrum</option>
                      <option value="optimism">Optimism</option>
                    </select>
                  </div>
                  
                  {bridgeStatus && (
                    <div className={`p-3 rounded-lg border text-sm ${
                      bridgeStatus.error 
                        ? 'bg-red-900/20 border-red-700/50 text-red-300' 
                        : bridgeStatus.success 
                          ? 'bg-green-900/20 border-green-700/50 text-green-300'
                          : 'bg-gray-800/50 border-gray-700 text-gray-300'
                    }`}>
                      {bridgeStatus.message}
                    </div>
                  )}
                  
                  <button
                    onClick={async () => {
                      if (selectedWallets.length === 0) {
                        setBridgeStatus({ error: true, message: 'Please select wallets first' });
                        return;
                      }
                      setBridgeLoading(true);
                      setBridgeStatus({ message: 'Starting withdrawal... This takes 2-5 minutes' });
                      try {
                        const res = await apiService.autoWithdrawWallets(selectedWallets, 'main', bridgeChain);
                      if (res.data.success) {
                        setBridgeStatus({ 
                          success: true, 
                          message: `Withdrawal initiated! Funds will arrive in 2-5 minutes.` 
                        });
                        setTimeout(() => {
                          setBridgeStatus({ 
                            message: `Withdrawal in progress...` 
                          });
                        }, 60000);
                      } else {
                        setBridgeStatus({ error: true, message: res.data.error });
                      }
                      } catch (error) {
                        setBridgeStatus({ error: true, message: error.response?.data?.error || error.message });
                      } finally {
                        setBridgeLoading(false);
                      }
                    }}
                    disabled={bridgeLoading || selectedWallets.length === 0}
                    className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {bridgeLoading ? 'Processing...' : 'Withdraw Privately'}
                  </button>
                  
                  <div className="pt-3 border-t border-gray-700">
                    <div className="text-xs text-gray-400 mb-2">Recover from intermediaries:</div>
                    <button
                      onClick={async () => {
                        setBridgeLoading(true);
                        setBridgeStatus({ message: 'Checking intermediary wallets...' });
                        try {
                          const res = await apiService.recoverSolIntermediaries('main');
                          if (res.data.success) {
                            setBridgeStatus({ 
                              success: true, 
                              message: `Recovered ${res.data.totalRecovered?.toFixed(6) || 0} SOL from ${res.data.successCount || 0} wallets` 
                            });
                            setTimeout(() => {
                              loadWallets(true);
                              loadFundingWallet();
                            }, 2000);
                          } else {
                            setBridgeStatus({ error: true, message: res.data.error });
                          }
                        } catch (error) {
                          setBridgeStatus({ error: true, message: error.response?.data?.error || error.message });
                        } finally {
                          setBridgeLoading(false);
                        }
                      }}
                      disabled={bridgeLoading}
                      className="w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-lg transition-colors disabled:opacity-50 text-sm"
                    >
                      {bridgeLoading ? 'Processing...' : 'Recover SOL from Intermediaries'}
                    </button>
                  </div>
                </div>
              )}
              
              {/* Resume Mode - Simplified */}
              {privateFundingStep === 3 && (
                <div className="space-y-3">
                  
                  {/* Chain Selector */}
                  <div className="p-3 bg-gray-800/50 rounded-lg border border-orange-700/30">
                    <label className="text-sm font-semibold text-orange-300 mb-2 block">
                      🔗 Select Chain to Recover From:
                    </label>
                    <select
                      value={bridgeChain}
                      onChange={(e) => {
                        setBridgeChain(e.target.value);
                        // Reload intermediaries for the new chain
                        setTimeout(() => loadStuckIntermediaries(), 100);
                      }}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 font-medium"
                    >
                      <option value="base">Base (Low fees, ~2-5 min)</option>
                      <option value="bsc">BSC (Low fees, ~2-5 min)</option>
                      <option value="ethereum">Ethereum (Higher fees)</option>
                      <option value="polygon">Polygon (Low fees, ~2-5 min)</option>
                      <option value="avalanche">Avalanche (Moderate fees, ~2-5 min)</option>
                      <option value="arbitrum">Arbitrum (Moderate fees, ~2-5 min)</option>
                      <option value="optimism">Optimism (Moderate fees, ~2-5 min)</option>
                    </select>
                    <p className="text-xs text-gray-400 mt-2">
                      💡 Only wallets on <strong className="text-orange-400">{bridgeChain.toUpperCase()}</strong> will be shown below. Each wallet displays its chain badge.
                    </p>
                  </div>
                  
                  <div className="p-3 bg-gray-800/50 rounded-lg">
                    <div className="text-sm text-gray-400 mb-1">Destination Wallet (select one from wallet list):</div>
                    <div className="text-white font-medium">
                      {selectedWallets.length > 0 ? (
                        <span className="text-emerald-400">{selectedWallets[0].substring(0, 12)}...</span>
                      ) : (
                        <span className="text-yellow-400">⚠️ Select a destination wallet first</span>
                      )}
                    </div>
                  </div>
                  
                  {bridgeStatus && (
                    <div className={`p-3 rounded-lg border text-sm ${
                      bridgeStatus.error 
                        ? 'bg-red-900/20 border-red-700 text-red-300' 
                        : bridgeStatus.success 
                          ? 'bg-green-900/20 border-green-700 text-green-300'
                          : 'bg-blue-900/20 border-blue-700 text-blue-300'
                    }`}>
                      {bridgeStatus.message}
                    </div>
                  )}
                  
                  {loadingIntermediaries ? (
                    <div className="text-center py-4 text-gray-500 text-sm">
                      Loading intermediary wallets...
                    </div>
                  ) : stuckIntermediaries.length === 0 ? (
                    <div className="text-center py-4 text-gray-500 text-sm">
                      No stuck intermediary wallets found
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {stuckIntermediaries.map((wallet) => (
                        <div
                          key={wallet.id}
                          className="p-3 bg-gray-800/50 rounded-lg border border-gray-700"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-300 font-mono">
                                {wallet.address.substring(0, 10)}...{wallet.address.substring(38)}
                              </span>
                              <span className="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-300">
                                {wallet.chain?.toUpperCase() || 'BASE'}
                              </span>
                            </div>
                            <span className="text-xs text-gray-500">
                              {wallet.inboundAmount ? `${wallet.inboundAmount} SOL` : 'No balance'}
                            </span>
                          </div>
                          <button
                            onClick={() => handleRecoverIntermediary(wallet.address, wallet.chain || bridgeChain)}
                            disabled={bridgeLoading || selectedWallets.length === 0}
                            className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                          >
                            {bridgeLoading ? 'Processing...' : 'Continue Bridge'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  <button
                    onClick={loadStuckIntermediaries}
                    disabled={loadingIntermediaries}
                    className="w-full px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors disabled:opacity-50"
                  >
                    Refresh List
                  </button>
                </div>
              )}
              
              <button
                onClick={() => {
                  setShowPrivateFunding(false);
                  setBridgeStatus(null);
                }}
                className="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
