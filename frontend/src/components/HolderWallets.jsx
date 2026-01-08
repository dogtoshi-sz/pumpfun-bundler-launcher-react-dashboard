import { useState, useEffect, useRef } from 'react';
import apiService from '../services/api';
import {
  WalletIcon,
  CurrencyDollarIcon,
  ArrowPathIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  TrashIcon,
  CheckCircleIcon,
  XCircleIcon,
  InformationCircleIcon,
  SparklesIcon,
  BoltIcon,
  ChartBarIcon,
  ArrowPathRoundedSquareIcon,
  MagnifyingGlassIcon,
  BanknotesIcon,
  CubeIcon,
  UserGroupIcon,
  RocketLaunchIcon,
  CommandLineIcon,
} from '@heroicons/react/24/outline';
import {
  WalletIcon as WalletIconSolid,
  CurrencyDollarIcon as CurrencyDollarIconSolid,
  SparklesIcon as SparklesIconSolid,
} from '@heroicons/react/24/solid';

export default function HolderWallets() {
  const [wallets, setWallets] = useState([]);
  const [mintAddress, setMintAddress] = useState(null);
  const [loading, setLoading] = useState({});
  const [manualInputs, setManualInputs] = useState({}); // Track manual inputs per wallet
  const [menuRunning, setMenuRunning] = useState({});
  const [terminalMessages, setTerminalMessages] = useState([]); // Terminal log messages
  const terminalRef = useRef(null);
  const [liveTrades, setLiveTrades] = useState([]);
  const [hideMyWallets, setHideMyWallets] = useState(false);
  const [tradesEventSource, setTradesEventSource] = useState(null);
  const [tokenInfo, setTokenInfo] = useState(null);
  // Load priority fee from localStorage or default to 'low' (0.0001 SOL - good balance)
  const [priorityFee, setPriorityFee] = useState(() => {
    const saved = localStorage.getItem('holderWalletPriorityFee');
    return saved || 'low'; // Default to 'low' (0.0001 SOL) - good balance of speed and cost
  });
  
  // Refs for debouncing and request cancellation
  const loadWalletsTimeoutRef = useRef(null);
  const activeRequestsRef = useRef(new Map()); // Track active requests to prevent duplicates

  // Save priority fee to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('holderWalletPriorityFee', priorityFee);
  }, [priorityFee]);

  useEffect(() => {
    loadWallets();
    loadCurrentRunInfo();
    
    // Poll less frequently to reduce constant refreshing
    // Start with 5 seconds, then slow down after launch completes
    let checkCount = 0;
    let slowInterval = null;
    const interval = setInterval(() => {
      loadWallets();
      loadCurrentRunInfo();
      checkCount++;
      
      // After 2 minutes (24 checks at 5 seconds), switch to slower polling (30 seconds)
      if (checkCount > 24 && !slowInterval) {
        clearInterval(interval);
        slowInterval = setInterval(() => {
          loadWallets();
          loadCurrentRunInfo();
        }, 30000); // 30 seconds after launch completes
      }
    }, 5000); // Poll every 5 seconds (was 1 second - too aggressive)
    
    // Listen for manual refresh events (e.g., after token launch)
    const handleRefresh = () => {
      loadWallets();
      loadCurrentRunInfo();
      // DON'T reset priority fee - let user keep their selection
      // setPriorityFee('low'); // REMOVED - don't reset user's choice
    };
    window.addEventListener('refresh-wallets', handleRefresh);
    
    return () => {
      clearInterval(interval);
      if (slowInterval) clearInterval(slowInterval);
      window.removeEventListener('refresh-wallets', handleRefresh);
    };
  }, []);

  // Live trades SSE connection
  useEffect(() => {
    if (!mintAddress) {
      if (tradesEventSource) {
        tradesEventSource.close();
        setTradesEventSource(null);
      }
      setLiveTrades([]);
      return;
    }

    console.log(`[HolderWallets] Connecting to live trades for ${mintAddress.slice(0, 8)}...`);

    // Connect to live trades SSE
    const eventSource = new EventSource(`http://localhost:3001/api/live-trades?mint=${mintAddress}`);
    
    eventSource.onopen = () => {
      console.log(`[HolderWallets] ✅ Connected to live trades SSE`);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log(`[HolderWallets] Received SSE data:`, data.type, data.trades?.length || 0);
        
        if (data.type === 'initial') {
          // Sort trades by timestamp (newest first) before setting
          const sortedTrades = (data.trades || []).sort((a, b) => b.timestamp - a.timestamp);
          setLiveTrades(sortedTrades);
        } else if (data.type === 'error') {
          console.error('[HolderWallets] SSE error:', data.error);
          addTerminalMessage(`Live trades error: ${data.error}`, 'error');
        } else {
          // New trade - add to beginning and sort by timestamp (newest first)
          setLiveTrades(prev => {
            const updated = [data, ...prev];
            return updated.sort((a, b) => b.timestamp - a.timestamp).slice(0, 100); // Keep last 100, newest first
          });
        }
      } catch (error) {
        console.error('[HolderWallets] Error parsing SSE data:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('[HolderWallets] SSE connection error:', error);
      eventSource.close();
    };

    setTradesEventSource(eventSource);

    return () => {
      console.log(`[HolderWallets] Closing live trades SSE connection`);
      eventSource.close();
    };
  }, [mintAddress]);

  // Fetch token info when mintAddress changes
  useEffect(() => {
    if (!mintAddress) {
      setTokenInfo(null);
      return;
    }

    const fetchTokenInfo = async () => {
      try {
        const res = await apiService.getTokenInfo(mintAddress);
        setTokenInfo(res.data);
      } catch (error) {
        console.error('[HolderWallets] Error fetching token info:', error);
        // Set fallback info
        setTokenInfo({
          name: 'Unknown Token',
          symbol: 'UNKNOWN',
          address: mintAddress,
          marketCap: 0,
          price: 0,
          liquidity: 0,
          volume24h: 0
        });
      }
    };

    fetchTokenInfo();
    // Refresh every 30 seconds
    const interval = setInterval(fetchTokenInfo, 30000);
    return () => clearInterval(interval);
  }, [mintAddress]);

  const loadCurrentRunInfo = async () => {
    try {
      const res = await apiService.getCurrentRun();
      const currentRun = res.data.data;
      
      if (currentRun && currentRun.mintAddress) {
        const statusMsg = `Run: ${currentRun.mintAddress.substring(0, 8)}... | Status: ${currentRun.launchStatus || 'N/A'} | Wallets: ${currentRun.walletKeys?.length || currentRun.count || 0} | Bundle: ${currentRun.bundleWalletKeys?.length || 0} | Holder: ${currentRun.holderWalletKeys?.length || 0}`;
        
        // Only add if it's new info AND status changed (avoid spam)
        setTerminalMessages(prev => {
          const lastMsg = prev[prev.length - 1];
          // Check if message is identical OR if status hasn't changed (avoid duplicate status updates)
          if (lastMsg && (lastMsg.message === statusMsg || 
              (lastMsg.message.includes('Status:') && lastMsg.message.includes(currentRun.launchStatus || 'N/A')))) {
            return prev; // Don't add duplicate or same-status update
          }
          return [...prev.slice(-49), { message: statusMsg, type: 'info', timestamp: new Date().toLocaleTimeString() }];
        });
      }
    } catch (error) {
      // Silently fail - not critical
    }
  };

  const addTerminalMessage = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setTerminalMessages(prev => [...prev.slice(-49), { message, type, timestamp }]); // Keep last 50 messages
    // Auto-scroll to bottom
    setTimeout(() => {
      if (terminalRef.current) {
        terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
      }
    }, 10);
  };

  const loadWallets = async () => {
    try {
      const res = await apiService.getHolderWallets();
      const hadWallets = wallets.length > 0;
      const hasWalletsNow = res.data.wallets && res.data.wallets.length > 0;
      
      setWallets(res.data.wallets || []);
      setMintAddress(res.data.mintAddress);
      
      // Only show message when wallets are FIRST loaded (not on every refresh)
      // DON'T reset priority fee - let user keep their selection
      if (!hadWallets && hasWalletsNow) {
        addTerminalMessage('Wallets loaded!', 'success');
        // REMOVED: setPriorityFee('low') - don't reset user's choice
      }
    } catch (error) {
      console.error('Failed to load wallets:', error);
      addTerminalMessage(`Failed to load wallets: ${error.message}`, 'error');
    }
  };

  const getWalletTypeStyles = (type) => {
    const styles = {
      holder: { 
        label: 'Holder', 
        bgColor: 'bg-blue-900/40', 
        borderColor: 'border-blue-500',
        badgeColor: 'bg-blue-500',
        hoverBorder: 'hover:border-blue-400'
      },
      bundle: { 
        label: 'Bundle', 
        bgColor: 'bg-purple-900/40', 
        borderColor: 'border-purple-500',
        badgeColor: 'bg-purple-500',
        hoverBorder: 'hover:border-purple-400'
      },
      dev: { 
        label: 'Dev', 
        bgColor: 'bg-green-900/40', 
        borderColor: 'border-green-500',
        badgeColor: 'bg-green-500',
        hoverBorder: 'hover:border-green-400'
      }
    };
    return styles[type] || { 
      label: 'Unknown', 
      bgColor: 'bg-gray-900/40', 
      borderColor: 'border-gray-500',
      badgeColor: 'bg-gray-500',
      hoverBorder: 'hover:border-gray-400'
    };
  };

  const handleQuickBuy = async (wallet, amount) => {
    if (!mintAddress) {
      addTerminalMessage('No token mint address', 'error');
      return;
    }

    if (amount > wallet.solBalance) {
      addTerminalMessage(`Insufficient SOL. Available: ${wallet.solBalance.toFixed(4)} SOL`, 'error');
      return;
    }

    const key = `${wallet.address}-buy-${amount}`;
    
    // Prevent duplicate requests
    if (loading[key] || activeRequestsRef.current.has(key)) {
      addTerminalMessage('Request already in progress...', 'info');
      return;
    }
    
    // Use functional update to avoid stale state
    setLoading(prev => ({ ...prev, [key]: true }));
    activeRequestsRef.current.set(key, true);
    addTerminalMessage(`Buying ${amount} SOL worth of tokens from ${wallet.address.substring(0, 8)}...`, 'info');

    try {
      await apiService.buyTokens(wallet.privateKey, mintAddress, amount, undefined, priorityFee);
      const feeText = priorityFee === 'high' ? 'HIGH' : priorityFee === 'medium' ? 'MEDIUM' : priorityFee === 'ultra' ? 'ULTRA' : priorityFee === 'none' ? 'NONE' : 'LOW';
      addTerminalMessage(`Buy successful! ${amount} SOL from ${wallet.address.substring(0, 8)} (${feeText} priority)`, 'success');
      // Single optimized refresh after buy (debounced)
      loadWallets();
    } catch (error) {
      addTerminalMessage(`Buy failed: ${error.response?.data?.error || error.message}`, 'error');
    } finally {
      setLoading(prev => ({ ...prev, [key]: false }));
      activeRequestsRef.current.delete(key);
    }
  };

  const handlePercentageBuy = async (wallet, percentage) => {
    if (!mintAddress) {
      addTerminalMessage('No token mint address', 'error');
      return;
    }

    // Calculate amount based on percentage of wallet's SOL balance
    const amount = (wallet.solBalance * percentage) / 100;
    
    if (amount <= 0 || amount > wallet.solBalance) {
      addTerminalMessage(`Invalid amount. Available: ${wallet.solBalance.toFixed(4)} SOL`, 'error');
      return;
    }

    const key = `${wallet.address}-buy-percent-${percentage}`;
    
    // Prevent duplicate requests
    if (loading[key] || activeRequestsRef.current.has(key)) {
      addTerminalMessage('Request already in progress...', 'info');
      return;
    }
    
    setLoading(prev => ({ ...prev, [key]: true }));
    activeRequestsRef.current.set(key, true);
    addTerminalMessage(`Buying ${percentage}% (${amount.toFixed(4)} SOL) from ${wallet.address.substring(0, 8)}...`, 'info');

    try {
      await apiService.buyTokens(wallet.privateKey, mintAddress, amount, undefined, priorityFee);
      const feeText = priorityFee === 'high' ? 'HIGH' : priorityFee === 'medium' ? 'MEDIUM' : priorityFee === 'ultra' ? 'ULTRA' : priorityFee === 'none' ? 'NONE' : 'LOW';
      addTerminalMessage(`Buy successful! ${percentage}% (${amount.toFixed(4)} SOL) from ${wallet.address.substring(0, 8)} (${feeText} priority)`, 'success');
      loadWallets();
    } catch (error) {
      addTerminalMessage(`Buy failed: ${error.response?.data?.error || error.message}`, 'error');
    } finally {
      setLoading(prev => ({ ...prev, [key]: false }));
      activeRequestsRef.current.delete(key);
    }
  };

  const handleQuickSell = async (wallet, percentage) => {
    if (!mintAddress) {
      addTerminalMessage('No token mint address', 'error');
      return;
    }

    // Check if wallet has tokens (handle null/undefined/0)
    const hasTokens = wallet.tokenBalance && wallet.tokenBalance > 0;
    if (!hasTokens) {
      addTerminalMessage(`No tokens to sell from ${wallet.address.substring(0, 8)}. Balance: ${wallet.tokenBalance || 0}`, 'error');
      loadWallets();
      return;
    }

    const key = `${wallet.address}-sell-${percentage}`;
    
    // Prevent duplicate requests
    if (loading[key] || activeRequestsRef.current.has(key)) {
      addTerminalMessage('Request already in progress...', 'info');
      return;
    }
    
    setLoading(prev => ({ ...prev, [key]: true }));
    activeRequestsRef.current.set(key, true);
    addTerminalMessage(`Selling ${percentage}% of tokens from ${wallet.address.substring(0, 8)}...`, 'info');

    try {
      await apiService.sellTokens(wallet.privateKey, mintAddress, percentage, priorityFee);
      const feeText = priorityFee === 'high' ? 'HIGH' : priorityFee === 'medium' ? 'MEDIUM' : priorityFee === 'ultra' ? 'ULTRA' : priorityFee === 'none' ? 'NONE' : 'LOW';
      addTerminalMessage(`Sell successful! ${percentage}% from ${wallet.address.substring(0, 8)} (${feeText} priority)`, 'success');
      loadWallets();
    } catch (error) {
      addTerminalMessage(`Sell failed: ${error.response?.data?.error || error.message}`, 'error');
    } finally {
      setLoading(prev => ({ ...prev, [key]: false }));
      activeRequestsRef.current.delete(key);
    }
  };

  const handleManualBuy = async (wallet) => {
    const inputKey = `${wallet.address}-buy-manual`;
    const amount = parseFloat(manualInputs[inputKey]);
    
    if (!mintAddress) {
      addTerminalMessage('No token mint address', 'error');
      return;
    }

    if (!amount || isNaN(amount) || amount <= 0) {
      addTerminalMessage('Please enter a valid SOL amount', 'error');
      return;
    }

    if (amount > wallet.solBalance) {
      addTerminalMessage(`Insufficient SOL. Available: ${wallet.solBalance.toFixed(4)} SOL`, 'error');
      return;
    }

    const key = `${wallet.address}-buy-manual`;
    
    // Prevent duplicate requests
    if (loading[key] || activeRequestsRef.current.has(key)) {
      addTerminalMessage('Request already in progress...', 'info');
      return;
    }
    
    setLoading(prev => ({ ...prev, [key]: true }));
    activeRequestsRef.current.set(key, true);
    addTerminalMessage(`Buying ${amount} SOL worth of tokens from ${wallet.address.substring(0, 8)}...`, 'info');

    try {
      await apiService.buyTokens(wallet.privateKey, mintAddress, amount, undefined, priorityFee);
      const feeText = priorityFee === 'high' ? 'HIGH' : priorityFee === 'medium' ? 'MEDIUM' : priorityFee === 'ultra' ? 'ULTRA' : priorityFee === 'none' ? 'NONE' : 'LOW';
      addTerminalMessage(`Buy successful! ${amount} SOL from ${wallet.address.substring(0, 8)} (${feeText} priority)`, 'success');
      setManualInputs(prev => ({ ...prev, [inputKey]: '' }));
      loadWallets();
    } catch (error) {
      addTerminalMessage(`Buy failed: ${error.response?.data?.error || error.message}`, 'error');
    } finally {
      setLoading(prev => ({ ...prev, [key]: false }));
      activeRequestsRef.current.delete(key);
    }
  };

  const handleManualSell = async (wallet) => {
    const inputKey = `${wallet.address}-sell-manual`;
    const percentage = manualInputs[inputKey];
    
    if (!mintAddress) {
      addTerminalMessage('No token mint address', 'error');
      return;
    }

    // Check if wallet has tokens (handle null/undefined/0)
    const hasTokens = wallet.tokenBalance && wallet.tokenBalance > 0;
    if (!hasTokens) {
      addTerminalMessage(`No tokens to sell from ${wallet.address.substring(0, 8)}. Balance: ${wallet.tokenBalance || 0}`, 'error');
      loadWallets();
      return;
    }

    const sellPercent = percentage.toLowerCase() === 'all' ? 100 : parseFloat(percentage);
    if (!sellPercent || isNaN(sellPercent) || sellPercent <= 0 || sellPercent > 100) {
      addTerminalMessage('Please enter a valid percentage (1-100 or "all")', 'error');
      return;
    }

    const key = `${wallet.address}-sell-manual`;
    
    // Prevent duplicate requests
    if (loading[key] || activeRequestsRef.current.has(key)) {
      addTerminalMessage('Request already in progress...', 'info');
      return;
    }
    
    setLoading(prev => ({ ...prev, [key]: true }));
    activeRequestsRef.current.set(key, true);
    addTerminalMessage(`Selling ${sellPercent}% of tokens from ${wallet.address.substring(0, 8)}...`, 'info');

    try {
      await apiService.sellTokens(wallet.privateKey, mintAddress, sellPercent, priorityFee);
      const feeText = priorityFee === 'high' ? 'HIGH' : priorityFee === 'medium' ? 'MEDIUM' : priorityFee === 'ultra' ? 'ULTRA' : priorityFee === 'none' ? 'NONE' : 'LOW';
      addTerminalMessage(`✅ Sell successful! ${sellPercent}% from ${wallet.address.substring(0, 8)} (${feeText} priority)`, 'success');
      setManualInputs(prev => ({ ...prev, [inputKey]: '' }));
      loadWallets();
    } catch (error) {
      addTerminalMessage(`Sell failed: ${error.response?.data?.error || error.message}`, 'error');
    } finally {
      setLoading(prev => ({ ...prev, [key]: false }));
      activeRequestsRef.current.delete(key);
    }
  };

  const handleMenuCommand = async (commandId) => {
    const commandNames = {
      'rapid-sell': 'Rapid Sell All',
      'rapid-sell-50-percent': 'Sell 50%',
      'rapid-sell-remaining': 'Sell Remaining',
      'gather': 'Gather SOL',
      'gather-all': 'Gather All Wallets',
      'check-bundle': 'Check Status',
      'collect-fees': 'Collect Fees'
    };
    
    setMenuRunning({ ...menuRunning, [commandId]: true });
    addTerminalMessage(`Executing: ${commandNames[commandId] || commandId}...`, 'info');
    
    try {
      const res = await apiService.executeCommand(commandId);
      const output = res.data.output || res.data.message || 'Command executed';
      
      // Parse output and add each line to terminal
      const lines = output.split('\n').filter(line => line.trim());
      lines.forEach(line => {
        if (line.trim()) {
          const type = line.includes('SUCCESS') || line.toLowerCase().includes('success') ? 'success' :
                      line.includes('FAILED') || line.includes('Error') || line.toLowerCase().includes('failed') ? 'error' :
                      'info';
          // Remove emojis from messages
          const cleanLine = line.trim().replace(/[✅❌⚡💸📊🔄💰🔄🔍💵]/g, '').trim();
          addTerminalMessage(cleanLine, type);
        }
      });
      
      setTimeout(loadWallets, 500); // Refresh wallets after command (reduced delay)
    } catch (error) {
      addTerminalMessage(`${commandNames[commandId] || commandId} failed: ${error.response?.data?.error || error.message}`, 'error');
    } finally {
      setMenuRunning({ ...menuRunning, [commandId]: false });
    }
  };

  const handleRetryBundle = async () => {
    setMenuRunning({ ...menuRunning, 'retry-bundle': true });
    addTerminalMessage(`Retrying failed bundle...`, 'info');
    addTerminalMessage(`Using existing funded wallets from current-run.json`, 'info');
    
    try {
      const res = await apiService.retryBundle();
      if (res.data.success) {
        addTerminalMessage(`Bundle retry started! Check terminal for progress.`, 'success');
        addTerminalMessage(`PID: ${res.data.pid}`, 'info');
        addTerminalMessage(`This will rebuild and resend the bundle using existing wallets.`, 'info');
      } else {
        addTerminalMessage(`Bundle retry failed: ${res.data.error || 'Unknown error'}`, 'error');
      }
    } catch (error) {
      addTerminalMessage(`Bundle retry failed: ${error.response?.data?.error || error.message}`, 'error');
    } finally {
      setMenuRunning({ ...menuRunning, 'retry-bundle': false });
    }
  };

  if (!mintAddress) {
    return (
      <div className="bg-gradient-to-br from-gray-900/90 via-gray-900/80 to-gray-950/90 backdrop-blur-xl rounded-xl p-6 border border-gray-800/50 shadow-2xl">
        <div className="flex items-center gap-3 text-gray-400">
          <InformationCircleIcon className="w-5 h-5" />
          <p>No token launched yet. Launch a token first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex gap-3">
      {/* Wallets Section - Left */}
      <div className="flex-1 bg-gradient-to-br from-gray-900/90 via-gray-900/80 to-gray-950/90 backdrop-blur-xl rounded-xl p-3 border border-gray-800/50 shadow-2xl overflow-auto">
        {/* Header - Compact Terminal Style */}
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-1.5">
          <div className="p-1 bg-gradient-to-br from-blue-600/20 to-purple-600/20 rounded border border-blue-500/30">
            <WalletIconSolid className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <h2 className="text-base font-bold text-white">Trading Terminal</h2>
        </div>
        <button
          onClick={loadWallets}
          className="px-2 py-1 bg-gradient-to-r from-gray-800/80 to-gray-900/80 hover:from-gray-700/80 hover:to-gray-800/80 text-white rounded transition-all border border-gray-700/50 flex items-center gap-1 shadow-lg"
        >
          <ArrowPathIcon className="w-3 h-3" />
          <span className="text-xs">Refresh</span>
        </button>
      </div>

      {/* Info Cards - Compact */}
      <div className="mb-3 grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="p-1.5 bg-gradient-to-br from-gray-800/60 to-gray-900/60 backdrop-blur-sm rounded border border-gray-700/50 shadow-lg">
          <div className="flex items-center gap-1 mb-0.5">
            <CubeIcon className="w-3 h-3 text-blue-400" />
            <p className="text-[9px] text-gray-400">Token Mint</p>
          </div>
          <p className="text-[9px] font-mono text-white break-all">{mintAddress}</p>
        </div>
        <div className="p-1.5 bg-gradient-to-br from-gray-800/60 to-gray-900/60 backdrop-blur-sm rounded border border-gray-700/50 shadow-lg">
          <div className="flex items-center gap-1 mb-1">
            <BoltIcon className="w-3 h-3 text-yellow-400" />
            <p className="text-[9px] text-gray-400">Priority Fee</p>
          </div>
          <div className="grid grid-cols-5 gap-0.5">
            <button
              onClick={() => setPriorityFee('none')}
              className={`px-1 py-0.5 rounded text-[9px] font-bold transition-all ${
                priorityFee === 'none'
                  ? 'bg-gradient-to-br from-gray-600 to-gray-700 text-white shadow-lg shadow-gray-500/30'
                  : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 border border-gray-700/50'
              }`}
              title="0 SOL - Slowest but cheapest"
            >
              NONE
            </button>
            <button
              onClick={() => setPriorityFee('low')}
              className={`px-1 py-0.5 rounded text-[9px] font-bold transition-all ${
                priorityFee === 'low'
                  ? 'bg-gradient-to-br from-green-600 to-green-700 text-white shadow-lg shadow-green-500/30'
                  : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 border border-gray-700/50'
              }`}
              title="0.0001 SOL - Recommended default"
            >
              LOW
            </button>
            <button
              onClick={() => setPriorityFee('medium')}
              className={`px-1 py-0.5 rounded text-[9px] font-bold transition-all ${
                priorityFee === 'medium'
                  ? 'bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-500/30'
                  : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 border border-gray-700/50'
              }`}
              title="0.0005 SOL - Fast"
            >
              MED
            </button>
            <button
              onClick={() => setPriorityFee('high')}
              className={`px-1 py-0.5 rounded text-[9px] font-bold transition-all ${
                priorityFee === 'high'
                  ? 'bg-gradient-to-br from-yellow-600 to-yellow-700 text-white shadow-lg shadow-yellow-500/30'
                  : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 border border-gray-700/50'
              }`}
              title="0.005 SOL - Very fast"
            >
              HIGH
            </button>
            <button
              onClick={() => setPriorityFee('ultra')}
              className={`px-1 py-0.5 rounded text-[9px] font-bold transition-all ${
                priorityFee === 'ultra'
                  ? 'bg-gradient-to-br from-red-600 to-red-700 text-white shadow-lg shadow-red-500/30'
                  : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 border border-gray-700/50'
              }`}
              title="0.01 SOL - Maximum speed"
            >
              ULTRA
            </button>
          </div>
          <p className="text-[8px] text-gray-500 mt-0.5 text-center">
            {priorityFee === 'none' ? '0 SOL' :
             priorityFee === 'low' ? '0.0001 ⭐' :
             priorityFee === 'medium' ? '0.0005' :
             priorityFee === 'high' ? '0.005' :
             '0.01'}
          </p>
        </div>
        <div className="p-1.5 bg-gradient-to-br from-gray-800/60 to-gray-900/60 backdrop-blur-sm rounded border border-gray-700/50 shadow-lg">
          <div className="flex items-center gap-1 mb-0.5">
            <CurrencyDollarIcon className="w-3 h-3 text-green-400" />
            <p className="text-[9px] text-gray-400">Gas</p>
          </div>
          <p className="text-[9px] text-gray-300">
            {priorityFee === 'none' ? '~0.000005' :
             priorityFee === 'low' ? '~0.000105' : 
             priorityFee === 'medium' ? '~0.000505' : 
             priorityFee === 'high' ? '~0.005005' :
             '~0.010005'}
          </p>
        </div>
      </div>

      {/* Quick Actions - Ultra Compact */}
      <div className="mb-2 p-1.5 bg-gradient-to-br from-gray-800/40 to-gray-900/40 backdrop-blur-sm rounded border border-gray-700/30 shadow-lg">
        <div className="flex items-center gap-1 mb-1">
          <SparklesIcon className="w-3 h-3 text-purple-400" />
          <p className="text-[9px] font-semibold text-gray-300">Quick Actions</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-1">
          <button
            onClick={() => handleMenuCommand('rapid-sell')}
            disabled={menuRunning['rapid-sell']}
            className="px-1.5 py-1 bg-gradient-to-br from-red-600/90 to-red-700/90 hover:from-red-500/90 hover:to-red-600/90 text-white text-[9px] font-semibold rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-0.5 shadow-lg shadow-red-500/20 border border-red-500/30"
          >
            {menuRunning['rapid-sell'] ? (
              <ArrowPathIcon className="w-3 h-3 animate-spin" />
            ) : (
              <>
                <ArrowDownTrayIcon className="w-3 h-3" />
                <span>Sell All</span>
              </>
            )}
          </button>
          <button
            onClick={() => handleMenuCommand('rapid-sell-50-percent')}
            disabled={menuRunning['rapid-sell-50-percent']}
            className="px-1.5 py-1 bg-gradient-to-br from-orange-600/90 to-orange-700/90 hover:from-orange-500/90 hover:to-orange-600/90 text-white text-[9px] font-semibold rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-0.5 shadow-lg shadow-orange-500/20 border border-orange-500/30"
          >
            {menuRunning['rapid-sell-50-percent'] ? (
              <ArrowPathIcon className="w-3 h-3 animate-spin" />
            ) : (
              <>
                <ChartBarIcon className="w-3 h-3" />
                <span>Sell 50%</span>
              </>
            )}
          </button>
          <button
            onClick={() => handleMenuCommand('rapid-sell-remaining')}
            disabled={menuRunning['rapid-sell-remaining']}
            className="px-2 py-1.5 bg-gradient-to-br from-red-500/90 to-red-600/90 hover:from-red-400/90 hover:to-red-500/90 text-white text-xs font-semibold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1 shadow-lg shadow-red-500/20 border border-red-500/30"
          >
            {menuRunning['rapid-sell-remaining'] ? (
              <ArrowPathIcon className="w-3 h-3 animate-spin" />
            ) : (
              <>
                <ArrowPathRoundedSquareIcon className="w-3 h-3" />
                <span>Sell Remaining</span>
              </>
            )}
          </button>
          <button
            onClick={() => handleMenuCommand('gather')}
            disabled={menuRunning['gather']}
            className="px-1.5 py-1 bg-gradient-to-br from-green-600/90 to-green-700/90 hover:from-green-500/90 hover:to-green-600/90 text-white text-[9px] font-semibold rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-0.5 shadow-lg shadow-green-500/20 border border-green-500/30"
            title="Gather SOL from current run wallets"
          >
            {menuRunning['gather'] ? (
              <ArrowPathIcon className="w-3 h-3 animate-spin" />
            ) : (
              <>
                <ArrowUpTrayIcon className="w-3 h-3" />
                <span>Gather</span>
              </>
            )}
          </button>
          <button
            onClick={() => handleMenuCommand('gather-all')}
            disabled={menuRunning['gather-all']}
            className="px-2 py-1.5 bg-gradient-to-br from-green-500/90 to-green-600/90 hover:from-green-400/90 hover:to-green-500/90 text-white text-xs font-semibold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1 shadow-lg shadow-green-500/20 border border-green-500/30"
            title="Gather SOL from ALL wallets"
          >
            {menuRunning['gather-all'] ? (
              <ArrowPathIcon className="w-3 h-3 animate-spin" />
            ) : (
              <>
                <ArrowUpTrayIcon className="w-3 h-3" />
                <span>Gather All</span>
              </>
            )}
          </button>
          <button
            onClick={handleRetryBundle}
            disabled={menuRunning['retry-bundle'] || !mintAddress}
            className="px-1.5 py-1 bg-gradient-to-br from-orange-600/90 to-orange-700/90 hover:from-orange-500/90 hover:to-orange-600/90 text-white text-[9px] font-semibold rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-0.5 shadow-lg shadow-orange-500/20 border border-orange-500/30"
            title="Retry failed bundle"
          >
            {menuRunning['retry-bundle'] ? (
              <ArrowPathIcon className="w-3 h-3 animate-spin" />
            ) : (
              <>
                <RocketLaunchIcon className="w-3 h-3" />
                <span>Retry</span>
              </>
            )}
          </button>
          <button
            onClick={() => handleMenuCommand('check-bundle')}
            disabled={menuRunning['check-bundle']}
            className="px-1.5 py-1 bg-gradient-to-br from-blue-600/90 to-blue-700/90 hover:from-blue-500/90 hover:to-blue-600/90 text-white text-[9px] font-semibold rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-0.5 shadow-lg shadow-blue-500/20 border border-blue-500/30"
          >
            {menuRunning['check-bundle'] ? (
              <ArrowPathIcon className="w-3 h-3 animate-spin" />
            ) : (
              <>
                <MagnifyingGlassIcon className="w-3 h-3" />
                <span>Status</span>
              </>
            )}
          </button>
          <button
            onClick={() => handleMenuCommand('collect-fees')}
            disabled={menuRunning['collect-fees']}
            className="px-1.5 py-1 bg-gradient-to-br from-purple-600/90 to-purple-700/90 hover:from-purple-500/90 hover:to-purple-600/90 text-white text-[9px] font-semibold rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-0.5 shadow-lg shadow-purple-500/20 border border-purple-500/30"
          >
            {menuRunning['collect-fees'] ? (
              <ArrowPathIcon className="w-3 h-3 animate-spin" />
            ) : (
              <>
                <BanknotesIcon className="w-3 h-3" />
                <span>Fees</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Wallets Section - Organized: DEV first, then Bundle/Holder */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2">
        {wallets
          .sort((a, b) => {
            // DEV first (0), then Bundle (1), then Holder (2)
            const order = { dev: 0, bundle: 1, holder: 2 };
            return (order[a.type] ?? 99) - (order[b.type] ?? 99);
          })
          .map((wallet, index) => {
            const styles = getWalletTypeStyles(wallet.type);
            const isDev = wallet.type === 'dev';
            const isBundle = wallet.type === 'bundle';
            const isHolder = wallet.type === 'holder';
            const hasTokens = wallet.tokenBalance && wallet.tokenBalance > 0;
            
            return (
              <div
                key={index}
                className={`backdrop-blur-xl rounded-lg p-2 border-2 ${
                  isDev 
                    ? 'bg-gradient-to-br from-green-900/30 via-gray-900/70 to-gray-950/70 border-green-500/70 shadow-xl shadow-green-500/20 ring-2 ring-green-400/40' 
                    : isBundle 
                    ? 'bg-gradient-to-br from-purple-900/20 via-gray-900/70 to-gray-950/70 border-purple-500/50 shadow-lg' 
                    : 'bg-gradient-to-br from-blue-900/20 via-gray-900/70 to-gray-950/70 border-blue-500/50 shadow-lg ring-1 ring-blue-400/30'
                } hover:shadow-xl transition-all ${styles.hoverBorder}/70`}
              >
                {/* Wallet Header - Compact with % Supply */}
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1">
                    {wallet.type === 'holder' && <UserGroupIcon className="w-3 h-3 text-blue-400" />}
                    {wallet.type === 'bundle' && <CubeIcon className="w-3 h-3 text-purple-400" />}
                    {wallet.type === 'dev' && <RocketLaunchIcon className="w-3 h-3 text-green-400" />}
                    <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${isDev ? 'bg-gradient-to-r from-green-600 to-green-500 shadow-lg shadow-green-500/30' : styles.badgeColor} text-white`}>
                      {isDev ? '⭐ DEV' : styles.label}
                    </span>
                  </div>
                  {hasTokens && (() => {
                    const supplyPercent = (wallet.tokenBalance / 1000000000) * 100;
                    let colorClass = 'text-blue-400'; // Default: < 1%
                    if (supplyPercent >= 2) {
                      colorClass = 'text-yellow-400 font-extrabold'; // >= 2%: Yellow/Bright
                    } else if (supplyPercent >= 1) {
                      colorClass = 'text-green-400 font-bold'; // >= 1%: Green
                    }
                    return (
                      <span className={`text-xs ${colorClass}`}>
                        {supplyPercent.toFixed(2)}%
                      </span>
                    );
                  })()}
                </div>
                <p className="text-[10px] font-mono text-gray-300 mb-1.5 truncate">
                  {wallet.address.substring(0, 8)}...{wallet.address.substring(wallet.address.length - 8)}
                </p>

                {/* Balances - Compact */}
                <div className="mb-2 space-y-0.5">
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] text-gray-500">SOL:</span>
                    <span className="text-[10px] font-bold text-green-400">{wallet.solBalance.toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] text-gray-500">Tokens:</span>
                    <span className={`text-[10px] font-bold ${hasTokens ? 'text-yellow-400' : 'text-gray-500'}`}>
                      {wallet.tokenBalance.toFixed(1)}
                    </span>
                  </div>
                </div>

                {/* Buy Buttons - SOL Amounts */}
                <div className="mb-1.5">
                  <div className="flex items-center gap-1 mb-0.5">
                    <ArrowUpTrayIcon className="w-2.5 h-2.5 text-green-400" />
                    <p className="text-[9px] text-gray-400 font-semibold">Buy SOL</p>
                  </div>
                  <div className="grid grid-cols-3 gap-0.5 mb-1">
                    <button
                      onClick={() => handleQuickBuy(wallet, 0.1)}
                      disabled={loading[`${wallet.address}-buy-0.1`] || wallet.solBalance < 0.1}
                      className="px-1 py-0.5 text-[9px] bg-gradient-to-br from-green-600/90 to-green-700/90 hover:from-green-500/90 hover:to-green-600/90 text-white rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed border border-green-500/30"
                      title="0.1 SOL"
                    >
                      {loading[`${wallet.address}-buy-0.1`] ? <ArrowPathIcon className="w-2.5 h-2.5 animate-spin mx-auto" /> : '0.1'}
                    </button>
                    <button
                      onClick={() => handleQuickBuy(wallet, 0.5)}
                      disabled={loading[`${wallet.address}-buy-0.5`] || wallet.solBalance < 0.5}
                      className="px-1 py-0.5 text-[9px] bg-gradient-to-br from-green-600/90 to-green-700/90 hover:from-green-500/90 hover:to-green-600/90 text-white rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed border border-green-500/30"
                      title="0.5 SOL"
                    >
                      {loading[`${wallet.address}-buy-0.5`] ? <ArrowPathIcon className="w-2.5 h-2.5 animate-spin mx-auto" /> : '0.5'}
                    </button>
                    <button
                      onClick={() => handleQuickBuy(wallet, 1.0)}
                      disabled={loading[`${wallet.address}-buy-1.0`] || wallet.solBalance < 1.0}
                      className="px-1 py-0.5 text-[9px] bg-gradient-to-br from-green-600/90 to-green-700/90 hover:from-green-500/90 hover:to-green-600/90 text-white rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed border border-green-500/30"
                      title="1.0 SOL"
                    >
                      {loading[`${wallet.address}-buy-1.0`] ? <ArrowPathIcon className="w-2.5 h-2.5 animate-spin mx-auto" /> : '1.0'}
                    </button>
                  </div>
                  
                  {/* Buy Buttons - Percentage */}
                  <div className="flex items-center gap-1 mb-0.5">
                    <ArrowUpTrayIcon className="w-2.5 h-2.5 text-green-400" />
                    <p className="text-[9px] text-gray-400 font-semibold">Buy %</p>
                  </div>
                  <div className="grid grid-cols-3 gap-0.5 mb-1">
                    <button
                      onClick={() => handlePercentageBuy(wallet, 20)}
                      disabled={loading[`${wallet.address}-buy-percent-20`] || wallet.solBalance <= 0}
                      className="px-1 py-0.5 text-[9px] bg-gradient-to-br from-green-500/90 to-green-600/90 hover:from-green-400/90 hover:to-green-500/90 text-white rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed border border-green-500/30"
                      title="Buy 20% of SOL balance"
                    >
                      {loading[`${wallet.address}-buy-percent-20`] ? <ArrowPathIcon className="w-2.5 h-2.5 animate-spin mx-auto" /> : '20%'}
                    </button>
                    <button
                      onClick={() => handlePercentageBuy(wallet, 50)}
                      disabled={loading[`${wallet.address}-buy-percent-50`] || wallet.solBalance <= 0}
                      className="px-1 py-0.5 text-[9px] bg-gradient-to-br from-green-500/90 to-green-600/90 hover:from-green-400/90 hover:to-green-500/90 text-white rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed border border-green-500/30"
                      title="Buy 50% of SOL balance"
                    >
                      {loading[`${wallet.address}-buy-percent-50`] ? <ArrowPathIcon className="w-2.5 h-2.5 animate-spin mx-auto" /> : '50%'}
                    </button>
                    <button
                      onClick={() => handlePercentageBuy(wallet, 99)}
                      disabled={loading[`${wallet.address}-buy-percent-99`] || wallet.solBalance <= 0}
                      className="px-1 py-0.5 text-[9px] bg-gradient-to-br from-green-500/90 to-green-600/90 hover:from-green-400/90 hover:to-green-500/90 text-white rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed border border-green-500/30"
                      title="Buy 99% of SOL balance"
                    >
                      {loading[`${wallet.address}-buy-percent-99`] ? <ArrowPathIcon className="w-2.5 h-2.5 animate-spin mx-auto" /> : '99%'}
                    </button>
                  </div>
                  
                  {/* Manual Buy Input - Compact */}
                  <div className="flex gap-0.5">
                    <input
                      type="number"
                      step="0.001"
                      value={manualInputs[`${wallet.address}-buy-manual`] || ''}
                      onChange={(e) => setManualInputs({ ...manualInputs, [`${wallet.address}-buy-manual`]: e.target.value })}
                      placeholder="SOL"
                      className="flex-1 px-1 py-0.5 text-[9px] bg-gray-800/50 border border-gray-700/50 rounded text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-green-500/50 focus:border-green-500/50"
                    />
                    <button
                      onClick={() => handleManualBuy(wallet)}
                      disabled={loading[`${wallet.address}-buy-manual`] || !manualInputs[`${wallet.address}-buy-manual`]}
                      className="px-1.5 py-0.5 text-[9px] bg-gradient-to-br from-green-600/90 to-green-700/90 hover:from-green-500/90 hover:to-green-600/90 text-white rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed border border-green-500/30"
                    >
                      {loading[`${wallet.address}-buy-manual`] ? <ArrowPathIcon className="w-2.5 h-2.5 animate-spin" /> : 'Buy'}
                    </button>
                  </div>
                </div>

                {/* Sell Buttons */}
                <div>
                  <div className="flex items-center gap-1 mb-0.5">
                    <ArrowDownTrayIcon className="w-2.5 h-2.5 text-red-400" />
                    <p className="text-[9px] text-gray-400 font-semibold">Sell %</p>
                  </div>
                  <div className="grid grid-cols-3 gap-0.5 mb-1">
                    <button
                      onClick={() => handleQuickSell(wallet, 20)}
                      disabled={loading[`${wallet.address}-sell-20`] || !wallet.tokenBalance || wallet.tokenBalance === 0}
                      className="px-1 py-0.5 text-[9px] bg-gradient-to-br from-red-600/90 to-red-700/90 hover:from-red-500/90 hover:to-red-600/90 text-white rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed border border-red-500/30"
                      title="Sell 20%"
                    >
                      {loading[`${wallet.address}-sell-20`] ? <ArrowPathIcon className="w-2.5 h-2.5 animate-spin mx-auto" /> : '20%'}
                    </button>
                    <button
                      onClick={() => handleQuickSell(wallet, 50)}
                      disabled={loading[`${wallet.address}-sell-50`] || !wallet.tokenBalance || wallet.tokenBalance === 0}
                      className="px-1 py-0.5 text-[9px] bg-gradient-to-br from-red-600/90 to-red-700/90 hover:from-red-500/90 hover:to-red-600/90 text-white rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed border border-red-500/30"
                      title="Sell 50%"
                    >
                      {loading[`${wallet.address}-sell-50`] ? <ArrowPathIcon className="w-2.5 h-2.5 animate-spin mx-auto" /> : '50%'}
                    </button>
                    <button
                      onClick={() => handleQuickSell(wallet, 100)}
                      disabled={loading[`${wallet.address}-sell-100`] || !wallet.tokenBalance || wallet.tokenBalance === 0}
                      className="px-1 py-0.5 text-[9px] bg-gradient-to-br from-red-600/90 to-red-700/90 hover:from-red-500/90 hover:to-red-600/90 text-white rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed border border-red-500/30"
                      title="Sell 100%"
                    >
                      {loading[`${wallet.address}-sell-100`] ? <ArrowPathIcon className="w-2.5 h-2.5 animate-spin mx-auto" /> : '100%'}
                    </button>
                  </div>
                  
                  {/* Manual Sell Input - Compact */}
                  <div className="flex gap-0.5">
                    <input
                      type="text"
                      value={manualInputs[`${wallet.address}-sell-manual`] || ''}
                      onChange={(e) => setManualInputs({ ...manualInputs, [`${wallet.address}-sell-manual`]: e.target.value })}
                      placeholder="%"
                      className="flex-1 px-1 py-0.5 text-[9px] bg-gray-800/50 border border-gray-700/50 rounded text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-red-500/50 focus:border-red-500/50"
                    />
                    <button
                      onClick={() => handleManualSell(wallet)}
                      disabled={loading[`${wallet.address}-sell-manual`] || !manualInputs[`${wallet.address}-sell-manual`]}
                      className="px-1.5 py-0.5 text-[9px] bg-gradient-to-br from-red-600/90 to-red-700/90 hover:from-red-500/90 hover:to-red-600/90 text-white rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed border border-red-500/30"
                    >
                      {loading[`${wallet.address}-sell-manual`] ? <ArrowPathIcon className="w-2.5 h-2.5 animate-spin" /> : 'Sell'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
      </div>

      {wallets.length === 0 && (
        <div className="text-center py-6 text-gray-400">
          <WalletIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No wallets found. Launch a token first.</p>
        </div>
      )}

        {/* Terminal Console - Ultra Compact */}
        <div className="mt-2 bg-gradient-to-br from-black/80 via-gray-950/80 to-black/80 backdrop-blur-xl rounded border border-gray-800/50 shadow-2xl overflow-hidden">
        <div className="flex justify-between items-center p-1 bg-gradient-to-r from-gray-900/80 to-gray-800/80 border-b border-gray-700/50">
          <div className="flex items-center gap-1">
            <CommandLineIcon className="w-3 h-3 text-blue-400" />
            <h3 className="text-[9px] font-bold text-white">Terminal</h3>
          </div>
          <button
            onClick={() => setTerminalMessages([])}
            className="px-1.5 py-0.5 text-[8px] bg-gray-800/50 hover:bg-gray-700/50 text-white rounded transition-all flex items-center gap-0.5 border border-gray-700/50"
          >
            <TrashIcon className="w-2.5 h-2.5" />
            <span>Clear</span>
          </button>
        </div>
        <div ref={terminalRef} className="p-1.5 h-32 overflow-y-auto font-mono text-[9px] bg-black/30">
          {terminalMessages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-600">
              <InformationCircleIcon className="w-3 h-3 mr-1" />
              <p className="text-[9px]">No messages yet...</p>
            </div>
          ) : (
            terminalMessages.map((msg, idx) => (
              <div
                key={idx}
                className={`mb-0.5 flex items-start gap-1 ${
                  msg.type === 'success' ? 'text-green-400' :
                  msg.type === 'error' ? 'text-red-400' :
                  'text-gray-300'
                }`}
              >
                <span className="text-gray-600 shrink-0 text-[8px]">[{msg.timestamp}]</span>
                <span className="flex-1 text-[9px]">{msg.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
      </div>

      {/* Token Info & Chart Section - Right */}
      {mintAddress && (
        <div className="w-1/2 bg-gradient-to-br from-gray-900/90 via-gray-900/80 to-gray-950/90 backdrop-blur-xl rounded-xl border border-gray-800/50 shadow-2xl overflow-hidden flex flex-col">
          {/* Token Header */}
          <div className="p-3 bg-gradient-to-r from-gray-900/80 to-gray-800/80 border-b border-gray-700/50">
            {tokenInfo ? (
              <div className="flex items-center gap-3">
                {/* Token Icon */}
                <div className="relative">
                  {tokenInfo.logoURI ? (
                    <img src={tokenInfo.logoURI} alt={tokenInfo.symbol} className="w-10 h-10 rounded-lg" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center border-2 border-green-500">
                      <span className="text-white font-bold text-sm">{tokenInfo.symbol?.[0] || '?'}</span>
                    </div>
                  )}
                  <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-gray-900"></div>
                </div>
                
                {/* Token Name & Symbol */}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-white">{tokenInfo.symbol || 'UNKNOWN'}</h3>
                    <span className="text-xs text-gray-400">{tokenInfo.name || 'Unknown Token'}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[9px] text-gray-500 font-mono">{mintAddress.slice(0, 4)}...{mintAddress.slice(-4)}</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(mintAddress);
                        addTerminalMessage('Token address copied!', 'success');
                      }}
                      className="text-gray-500 hover:text-gray-300"
                      title="Copy address"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                  </div>
                </div>
                
                {/* Market Cap */}
                <div className="text-right">
                  <div className="text-lg font-bold text-white">
                    ${tokenInfo.marketCap >= 1000 
                      ? `${(tokenInfo.marketCap / 1000).toFixed(2)}K` 
                      : tokenInfo.marketCap.toFixed(0)}
                  </div>
                  <div className="text-[9px] text-gray-400">Market Cap</div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-lg bg-gray-800 animate-pulse"></div>
                <div className="flex-1">
                  <div className="h-4 w-32 bg-gray-800 rounded animate-pulse"></div>
                  <div className="h-3 w-24 bg-gray-800 rounded animate-pulse mt-1"></div>
                </div>
              </div>
            )}
          </div>
          
          {/* Token Metrics */}
          {tokenInfo && (
            <div className="p-3 grid grid-cols-2 gap-3 border-b border-gray-700/50">
              <div>
                <div className="text-[9px] text-gray-400 mb-0.5">Price</div>
                <div className="text-sm font-semibold text-white">
                  ${tokenInfo.price < 0.0001 
                    ? tokenInfo.price.toExponential(2) 
                    : tokenInfo.price.toFixed(6)}
                </div>
              </div>
              <div>
                <div className="text-[9px] text-gray-400 mb-0.5">Liquidity</div>
                <div className="text-sm font-semibold text-white">
                  ${tokenInfo.liquidity >= 1000 
                    ? `${(tokenInfo.liquidity / 1000).toFixed(2)}K` 
                    : tokenInfo.liquidity.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-[9px] text-gray-400 mb-0.5">24h Volume</div>
                <div className="text-sm font-semibold text-white">
                  ${tokenInfo.volume24h >= 1000 
                    ? `${(tokenInfo.volume24h / 1000).toFixed(2)}K` 
                    : tokenInfo.volume24h.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-[9px] text-gray-400 mb-0.5">24h Change</div>
                <div className={`text-sm font-semibold ${tokenInfo.priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {tokenInfo.priceChange24h >= 0 ? '+' : ''}{tokenInfo.priceChange24h?.toFixed(2) || '0.00'}%
                </div>
              </div>
            </div>
          )}
          
          {/* Birdeye Chart */}
          <div className="flex-1 min-h-[200px] border-b border-gray-700/50">
            <iframe
              src={`https://birdeye.so/tv-widget/${mintAddress}?chain=solana&viewMode=pair&chartInterval=1&chartType=CANDLE&chartTimezone=America%2FLos_Angeles&chartLeftToolbar=show&theme=dark`}
              className="w-full h-full border-0"
              frameBorder="0"
              allow="clipboard-write"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              title="Birdeye Chart (Live - 1s interval)"
              onLoad={() => {
                console.log("[HolderWallets] Birdeye chart loaded successfully");
              }}
              onError={(e) => {
                console.error("[HolderWallets] Birdeye chart failed to load:", e);
              }}
            />
          </div>
          
          {/* Live Trades Log */}
          <div className="flex-1 flex flex-col min-h-0 border-t border-gray-700/50">
            <div className="p-2 bg-gradient-to-r from-gray-900/80 to-gray-800/80 border-b border-gray-700/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ArrowPathIcon className="w-3 h-3 text-green-400" />
                  <h3 className="text-xs font-bold text-white">Live Trades</h3>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hideMyWallets}
                      onChange={(e) => setHideMyWallets(e.target.checked)}
                      className="w-3 h-3 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
                    />
                    <span className="text-[9px] text-gray-400">Hide My Wallets</span>
                  </label>
                  <span className="text-[9px] text-gray-400">
                    {hideMyWallets 
                      ? `${liveTrades.filter(t => !t.isOurWallet).length} trades`
                      : `${liveTrades.length} trades`
                    }
                  </span>
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-[9px]">
                <thead className="sticky top-0 bg-gray-900/90 z-10">
                  <tr className="border-b border-gray-700/50">
                    <th className="text-left p-1 text-gray-400 font-semibold">Age</th>
                    <th className="text-left p-1 text-gray-400 font-semibold">Type</th>
                    <th className="text-right p-1 text-gray-400 font-semibold">MC</th>
                    <th className="text-right p-1 text-gray-400 font-semibold">Tokens</th>
                    <th className="text-right p-1 text-gray-400 font-semibold">SOL</th>
                    <th className="text-right p-1 text-gray-400 font-semibold">USD</th>
                    <th className="text-left p-1 text-gray-400 font-semibold">Trader</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const filteredTrades = hideMyWallets 
                      ? liveTrades.filter(t => !t.isOurWallet)
                      : liveTrades;
                    
                    if (filteredTrades.length === 0) {
                      return (
                        <tr>
                          <td colSpan="7" className="text-center py-4 text-gray-500 text-[9px]">
                            {hideMyWallets ? 'No external trades yet...' : 'Waiting for trades...'}
                          </td>
                        </tr>
                      );
                    }
                    
                    return filteredTrades.map((trade, idx) => {
                      // Calculate USD value (SOL price ~$150)
                      const solPrice = 150; // Approximate SOL price
                      const usdValue = trade.solAmount * solPrice;
                      
                      // Format market cap: show as "3K" instead of "0.03K"
                      const marketCapK = trade.marketCap / 1000;
                      const marketCapDisplay = marketCapK >= 1 
                        ? `${marketCapK.toFixed(1)}K` 
                        : `${(trade.marketCap).toFixed(0)}`;
                      
                      return (
                        <tr key={idx} className={`border-b border-gray-800/30 hover:bg-gray-800/30 ${trade.type === 'buy' ? 'bg-green-900/10' : 'bg-red-900/10'} ${trade.isOurWallet ? 'ring-1 ring-blue-500/50' : ''}`}>
                          <td className="p-1 text-gray-400">{trade.age}m</td>
                          <td className={`p-1 font-bold ${trade.type === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                            {trade.type === 'buy' ? 'Buy' : 'Sell'}
                          </td>
                          <td className="p-1 text-right text-gray-300">${marketCapDisplay}</td>
                          <td className="p-1 text-right text-gray-300">{(trade.amount / 1000000).toFixed(1)}M</td>
                          <td className={`p-1 text-right font-bold ${trade.type === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                            {trade.solAmount.toFixed(4)} SOL
                          </td>
                          <td className={`p-1 text-right font-bold ${trade.type === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                            ${usdValue.toFixed(2)}
                          </td>
                          <td className={`p-1 font-mono ${trade.isOurWallet ? 'text-blue-400 font-bold' : 'text-gray-400'}`}>
                            {trade.isOurWallet && (
                              <span className={`inline-block px-1 py-0.5 rounded text-[8px] font-bold mr-1 ${
                                trade.walletType === 'DEV' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                                trade.walletType === 'Bundle' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' :
                                trade.walletType === 'Holder' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                                'bg-gray-500/20 text-gray-400 border border-gray-500/30'
                              }`}>
                                {trade.walletType || '⭐'}
                              </span>
                            )}
                            {trade.trader}
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

