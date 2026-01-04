import { useState, useEffect, useRef } from 'react';
import apiService from '../services/api';

export default function HolderWallets() {
  const [wallets, setWallets] = useState([]);
  const [mintAddress, setMintAddress] = useState(null);
  const [loading, setLoading] = useState({});
  const [manualInputs, setManualInputs] = useState({}); // Track manual inputs per wallet
  const [menuRunning, setMenuRunning] = useState({});
  const [terminalMessages, setTerminalMessages] = useState([]); // Terminal log messages
  const terminalRef = useRef(null);
  const [priorityFee, setPriorityFee] = useState('low'); // 'low', 'medium', or 'high'

  useEffect(() => {
    loadWallets();
    loadCurrentRunInfo();
    
    // Poll more frequently during launch (1 second), then slower after launch (10 seconds)
    let checkCount = 0;
    let slowInterval = null;
    const interval = setInterval(() => {
      loadWallets();
      loadCurrentRunInfo();
      checkCount++;
      
      // After 2 minutes of fast polling, switch to slower polling
      // (launch should be complete by then)
      if (checkCount > 120 && !slowInterval) {
        // Switch to slower polling after launch completes
        clearInterval(interval);
        slowInterval = setInterval(() => {
          loadWallets();
          loadCurrentRunInfo();
        }, 10000);
      }
    }, 1000); // Fast polling during launch (1 second)
    
    // Listen for manual refresh events (e.g., after token launch)
    const handleRefresh = () => {
      loadWallets();
      loadCurrentRunInfo();
      // Reset priority fee to LOW after launch
      setPriorityFee('low');
    };
    window.addEventListener('refresh-wallets', handleRefresh);
    
    return () => {
      clearInterval(interval);
      if (slowInterval) clearInterval(slowInterval);
      window.removeEventListener('refresh-wallets', handleRefresh);
    };
  }, []);

  const loadCurrentRunInfo = async () => {
    try {
      const res = await apiService.getCurrentRun();
      const currentRun = res.data.data;
      
      if (currentRun && currentRun.mintAddress) {
        const statusMsg = `📝 Run: ${currentRun.mintAddress.substring(0, 8)}... | Status: ${currentRun.launchStatus || 'N/A'} | Wallets: ${currentRun.walletKeys?.length || currentRun.count || 0} | Bundle: ${currentRun.bundleWalletKeys?.length || 0} | Holder: ${currentRun.holderWalletKeys?.length || 0}`;
        
        // Only add if it's new info (avoid spam)
        setTerminalMessages(prev => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.message === statusMsg) {
            return prev; // Don't add duplicate
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
      
      // Reset priority fee to LOW when wallets are first loaded (after launch)
      if (!hadWallets && hasWalletsNow) {
        setPriorityFee('low');
        addTerminalMessage('✅ Wallets loaded! Priority fee set to LOW (0.0001 SOL)', 'success');
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
    setLoading({ ...loading, [key]: true });
    addTerminalMessage(`Buying ${amount} SOL worth of tokens from ${wallet.address.substring(0, 8)}...`, 'info');

    try {
      await apiService.buyTokens(wallet.privateKey, mintAddress, amount, undefined, priorityFee);
      const feeText = priorityFee === 'high' ? 'HIGH' : priorityFee === 'medium' ? 'MEDIUM' : 'LOW';
      addTerminalMessage(`✅ Buy successful! ${amount} SOL from ${wallet.address.substring(0, 8)} (${feeText} priority)`, 'success');
      setTimeout(loadWallets, 2000);
    } catch (error) {
      addTerminalMessage(`❌ Buy failed: ${error.response?.data?.error || error.message}`, 'error');
    } finally {
      setLoading({ ...loading, [key]: false });
    }
  };

  const handleQuickSell = async (wallet, percentage) => {
    if (!mintAddress) {
      addTerminalMessage('No token mint address', 'error');
      return;
    }

    if (wallet.tokenBalance === 0) {
      addTerminalMessage(`No tokens to sell from ${wallet.address.substring(0, 8)}`, 'error');
      return;
    }

    const key = `${wallet.address}-sell-${percentage}`;
    setLoading({ ...loading, [key]: true });
    addTerminalMessage(`Selling ${percentage}% of tokens from ${wallet.address.substring(0, 8)}...`, 'info');

    try {
      await apiService.sellTokens(wallet.privateKey, mintAddress, percentage, priorityFee);
      const feeText = priorityFee === 'high' ? 'HIGH' : priorityFee === 'medium' ? 'MEDIUM' : 'LOW';
      addTerminalMessage(`✅ Sell successful! ${percentage}% from ${wallet.address.substring(0, 8)} (${feeText} priority)`, 'success');
      setTimeout(loadWallets, 2000);
    } catch (error) {
      addTerminalMessage(`❌ Sell failed: ${error.response?.data?.error || error.message}`, 'error');
    } finally {
      setLoading({ ...loading, [key]: false });
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
    setLoading({ ...loading, [key]: true });
    addTerminalMessage(`Buying ${amount} SOL worth of tokens from ${wallet.address.substring(0, 8)}...`, 'info');

    try {
      await apiService.buyTokens(wallet.privateKey, mintAddress, amount, undefined, priorityFee);
      const feeText = priorityFee === 'high' ? 'HIGH' : priorityFee === 'medium' ? 'MEDIUM' : 'LOW';
      addTerminalMessage(`✅ Buy successful! ${amount} SOL from ${wallet.address.substring(0, 8)} (${feeText} priority)`, 'success');
      setManualInputs({ ...manualInputs, [inputKey]: '' });
      setTimeout(loadWallets, 2000);
    } catch (error) {
      addTerminalMessage(`❌ Buy failed: ${error.response?.data?.error || error.message}`, 'error');
    } finally {
      setLoading({ ...loading, [key]: false });
    }
  };

  const handleManualSell = async (wallet) => {
    const inputKey = `${wallet.address}-sell-manual`;
    const percentage = manualInputs[inputKey];
    
    if (!mintAddress) {
      addTerminalMessage('No token mint address', 'error');
      return;
    }

    if (wallet.tokenBalance === 0) {
      addTerminalMessage(`No tokens to sell from ${wallet.address.substring(0, 8)}`, 'error');
      return;
    }

    const sellPercent = percentage.toLowerCase() === 'all' ? 100 : parseFloat(percentage);
    if (!sellPercent || isNaN(sellPercent) || sellPercent <= 0 || sellPercent > 100) {
      addTerminalMessage('Please enter a valid percentage (1-100 or "all")', 'error');
      return;
    }

    const key = `${wallet.address}-sell-manual`;
    setLoading({ ...loading, [key]: true });
    addTerminalMessage(`Selling ${sellPercent}% of tokens from ${wallet.address.substring(0, 8)}...`, 'info');

    try {
      await apiService.sellTokens(wallet.privateKey, mintAddress, sellPercent, priorityFee);
      const feeText = priorityFee === 'high' ? 'HIGH' : priorityFee === 'medium' ? 'MEDIUM' : 'LOW';
      addTerminalMessage(`✅ Sell successful! ${sellPercent}% from ${wallet.address.substring(0, 8)} (${feeText} priority)`, 'success');
      setManualInputs({ ...manualInputs, [inputKey]: '' });
      setTimeout(loadWallets, 2000);
    } catch (error) {
      addTerminalMessage(`❌ Sell failed: ${error.response?.data?.error || error.message}`, 'error');
    } finally {
      setLoading({ ...loading, [key]: false });
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
    addTerminalMessage(`⚡ Executing: ${commandNames[commandId] || commandId}...`, 'info');
    
    try {
      const res = await apiService.executeCommand(commandId);
      const output = res.data.output || res.data.message || 'Command executed';
      
      // Parse output and add each line to terminal
      const lines = output.split('\n').filter(line => line.trim());
      lines.forEach(line => {
        if (line.trim()) {
          const type = line.includes('✅') || line.includes('SUCCESS') ? 'success' :
                      line.includes('❌') || line.includes('FAILED') || line.includes('Error') ? 'error' :
                      'info';
          addTerminalMessage(line.trim(), type);
        }
      });
      
      setTimeout(loadWallets, 2000); // Refresh wallets after command
    } catch (error) {
      addTerminalMessage(`❌ ${commandNames[commandId] || commandId} failed: ${error.response?.data?.error || error.message}`, 'error');
    } finally {
      setMenuRunning({ ...menuRunning, [commandId]: false });
    }
  };

  const handleRetryBundle = async () => {
    setMenuRunning({ ...menuRunning, 'retry-bundle': true });
    addTerminalMessage(`🔄 Retrying failed bundle...`, 'info');
    addTerminalMessage(`   Using existing funded wallets from current-run.json`, 'info');
    
    try {
      const res = await apiService.retryBundle();
      if (res.data.success) {
        addTerminalMessage(`✅ Bundle retry started! Check terminal for progress.`, 'success');
        addTerminalMessage(`   PID: ${res.data.pid}`, 'info');
        addTerminalMessage(`   This will rebuild and resend the bundle using existing wallets.`, 'info');
      } else {
        addTerminalMessage(`❌ Bundle retry failed: ${res.data.error || 'Unknown error'}`, 'error');
      }
    } catch (error) {
      addTerminalMessage(`❌ Bundle retry failed: ${error.response?.data?.error || error.message}`, 'error');
    } finally {
      setMenuRunning({ ...menuRunning, 'retry-bundle': false });
    }
  };

  if (!mintAddress) {
    return (
      <div className="bg-gray-900/50 rounded-lg p-6">
        <p className="text-gray-500">No token launched yet. Launch a token first.</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900/50 rounded-lg p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white">💼 All Wallets</h2>
        <button
          onClick={loadWallets}
          className="px-4 py-2 bg-gray-900/50 hover:bg-gray-800 text-white rounded-lg transition-colors"
        >
          🔄 Refresh
        </button>
      </div>

      <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-3 bg-gray-900/50 rounded-lg">
          <p className="text-sm text-gray-300 mb-1">Token Mint</p>
          <p className="text-sm font-mono text-white break-all">{mintAddress}</p>
        </div>
        <div className="p-3 bg-gray-900/50 rounded-lg">
          <p className="text-sm text-gray-300 mb-2">⚡ Priority Fee Selector</p>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => setPriorityFee('low')}
              className={`px-2 py-2 rounded font-bold transition-colors text-xs ${
                priorityFee === 'low'
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-slate-500'
              }`}
            >
              LOW<br/>0.0001 SOL
            </button>
            <button
              onClick={() => setPriorityFee('medium')}
              className={`px-2 py-2 rounded font-bold transition-colors text-xs ${
                priorityFee === 'medium'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-slate-500'
              }`}
            >
              MEDIUM<br/>0.0005 SOL
            </button>
            <button
              onClick={() => setPriorityFee('high')}
              className={`px-2 py-2 rounded font-bold transition-colors text-xs ${
                priorityFee === 'high'
                  ? 'bg-yellow-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-slate-500'
              }`}
            >
              HIGH<br/>0.005 SOL
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            {priorityFee === 'low' ? 'Cheapest but slower' : 
             priorityFee === 'medium' ? 'Fast and reasonable' : 
             'Fastest but expensive'}
          </p>
        </div>
        <div className="p-3 bg-gray-900/50 rounded-lg">
          <p className="text-sm text-gray-300 mb-1">💰 Gas Fees Per Transaction</p>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">Base Fee:</span>
              <span className="text-white">~0.000005 SOL</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Priority (Low):</span>
              <span className="text-green-400">0.0001 SOL</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Priority (Medium):</span>
              <span className="text-blue-400">0.0005 SOL</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Priority (High):</span>
              <span className="text-yellow-400">0.005 SOL</span>
            </div>
            <div className="flex justify-between border-t border-gray-800 pt-1 mt-1">
              <span className="text-gray-300 font-bold">Total (Low):</span>
              <span className="text-green-400 font-bold">~0.000105 SOL</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-300 font-bold">Total (Medium):</span>
              <span className="text-blue-400 font-bold">~0.000505 SOL</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-300 font-bold">Total (High):</span>
              <span className="text-yellow-400 font-bold">~0.005005 SOL</span>
            </div>
            <div className="flex justify-between border-t border-gray-800 pt-1 mt-1">
              <span className="text-gray-500 text-[10px]">Rapid Sell All:</span>
              <span className="text-blue-400 text-[10px]">~0.000505 SOL</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 text-[10px]">Sell 50%:</span>
              <span className="text-blue-400 text-[10px]">~0.000505 SOL</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 text-[10px]">Sell Remaining:</span>
              <span className="text-blue-400 text-[10px]">~0.000505 SOL</span>
            </div>
            <div className="flex justify-between border-t border-gray-800 pt-1 mt-1">
              <span className="text-gray-500 text-[10px]">Gather SOL:</span>
              <span className="text-green-400 text-[10px]">~0.000005 SOL</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 text-[10px]">Collect Fees:</span>
              <span className="text-green-400 text-[10px]">~0.000005 SOL</span>
            </div>
            <p className="text-[10px] text-gray-600 mt-2">
              Rapid sells use MEDIUM (0.0005 SOL) | Gather & Collect use no priority fees
            </p>
          </div>
        </div>
      </div>

      {/* Quick Menu Actions */}
      <div className="mb-4 bg-gray-900/50 rounded-lg overflow-hidden">
        <div className="p-3 bg-gray-800 border-b border-gray-800">
          <p className="text-sm font-bold text-white">⚡ Quick Actions</p>
        </div>
        <div className="p-3">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            <button
              onClick={() => handleMenuCommand('rapid-sell')}
              disabled={menuRunning['rapid-sell']}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              {menuRunning['rapid-sell'] ? (
                <>
                  <span className="animate-spin">⏳</span>
                  <span>Running...</span>
                </>
              ) : (
                <>
                  <span>💸</span>
                  <span>Rapid Sell All</span>
                </>
              )}
            </button>
            <button
              onClick={() => handleMenuCommand('rapid-sell-50-percent')}
              disabled={menuRunning['rapid-sell-50-percent']}
              className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              {menuRunning['rapid-sell-50-percent'] ? (
                <>
                  <span className="animate-spin">⏳</span>
                  <span>Running...</span>
                </>
              ) : (
                <>
                  <span>📊</span>
                  <span>Sell 50%</span>
                </>
              )}
            </button>
            <button
              onClick={() => handleMenuCommand('rapid-sell-remaining')}
              disabled={menuRunning['rapid-sell-remaining']}
              className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white font-bold rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              {menuRunning['rapid-sell-remaining'] ? (
                <>
                  <span className="animate-spin">⏳</span>
                  <span>Running...</span>
                </>
              ) : (
                <>
                  <span>🔄</span>
                  <span>Sell Remaining</span>
                </>
              )}
            </button>
            <button
              onClick={() => handleMenuCommand('gather')}
              disabled={menuRunning['gather']}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
              title="Gather SOL from current run wallets only"
            >
              {menuRunning['gather'] ? (
                <>
                  <span className="animate-spin">⏳</span>
                  <span>Running...</span>
                </>
              ) : (
                <>
                  <span>💰</span>
                  <span>Gather SOL</span>
                </>
              )}
            </button>
            <button
              onClick={() => handleMenuCommand('gather-all')}
              disabled={menuRunning['gather-all']}
              className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white font-bold rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
              title="Gather SOL from ALL wallets (current run + all historical wallets)"
            >
              {menuRunning['gather-all'] ? (
                <>
                  <span className="animate-spin">⏳</span>
                  <span>Running...</span>
                </>
              ) : (
                <>
                  <span>💰💰</span>
                  <span>Gather All</span>
                </>
              )}
            </button>
            <button
              onClick={handleRetryBundle}
              disabled={menuRunning['retry-bundle'] || !mintAddress}
              className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
              title={!mintAddress ? 'No current run found' : 'Retry failed bundle using existing funded wallets'}
            >
              {menuRunning['retry-bundle'] ? (
                <>
                  <span className="animate-spin">⏳</span>
                  <span>Running...</span>
                </>
              ) : (
                <>
                  <span>🔄</span>
                  <span>Retry Bundle</span>
                </>
              )}
            </button>
            <button
              onClick={() => handleMenuCommand('check-bundle')}
              disabled={menuRunning['check-bundle']}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              {menuRunning['check-bundle'] ? (
                <>
                  <span className="animate-spin">⏳</span>
                  <span>Running...</span>
                </>
              ) : (
                <>
                  <span>🔍</span>
                  <span>Check Status</span>
                </>
              )}
            </button>
            <button
              onClick={() => handleMenuCommand('collect-fees')}
              disabled={menuRunning['collect-fees']}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              {menuRunning['collect-fees'] ? (
                <>
                  <span className="animate-spin">⏳</span>
                  <span>Running...</span>
                </>
              ) : (
                <>
                  <span>💵</span>
                  <span>Collect Fees</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Wallet Grid - All wallets side by side */}
      {/* Sort wallets: Holder first (most important), then Bundle, then Dev */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {wallets
          .sort((a, b) => {
            const order = { holder: 0, bundle: 1, dev: 2 };
            return (order[a.type] ?? 99) - (order[b.type] ?? 99);
          })
          .map((wallet, index) => {
            const styles = getWalletTypeStyles(wallet.type);
            const isHolder = wallet.type === 'holder';
            
            return (
              <div
                key={index}
                className={`${styles.bgColor} rounded p-3 border-2 ${styles.borderColor} ${styles.hoverBorder} transition-colors ${isHolder ? 'ring-2 ring-blue-400/50' : ''}`}
              >
                {/* Wallet Header */}
                <div className="flex items-center justify-between mb-2">
                  <span className={`px-2 py-1 text-xs font-bold rounded ${styles.badgeColor} text-white`}>
                    {styles.label}
                  </span>
                  {isHolder && (
                    <span className="text-xs text-blue-300 font-bold">⭐</span>
                  )}
                </div>
                <p className="text-xs font-mono text-gray-300 mb-2 truncate">
                  {wallet.address.substring(0, 8)}...{wallet.address.substring(wallet.address.length - 8)}
                </p>

                {/* Balances */}
                <div className="mb-3 space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-500">SOL:</span>
                    <span className="text-sm font-bold text-green-400">{wallet.solBalance.toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-500">Tokens:</span>
                    <span className="text-sm font-bold text-yellow-400">{wallet.tokenBalance.toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-500">% of Supply:</span>
                    <span className="text-sm font-bold text-blue-400">
                      {((wallet.tokenBalance / 1000000000) * 100).toFixed(4)}%
                    </span>
                  </div>
                </div>

                {/* Quick Buy Buttons */}
                <div className="mb-3">
                  <p className="text-xs text-gray-500 mb-1.5">Buy:</p>
                  <div className="grid grid-cols-3 gap-1 mb-1.5">
                    <button
                      onClick={() => handleQuickBuy(wallet, 0.01)}
                      disabled={loading[`${wallet.address}-buy-0.01`] || wallet.solBalance < 0.01}
                      className="px-1.5 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading[`${wallet.address}-buy-0.01`] ? '...' : '0.01'}
                    </button>
                    <button
                      onClick={() => handleQuickBuy(wallet, 0.05)}
                      disabled={loading[`${wallet.address}-buy-0.05`] || wallet.solBalance < 0.05}
                      className="px-1.5 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading[`${wallet.address}-buy-0.05`] ? '...' : '0.05'}
                    </button>
                    <button
                      onClick={() => handleQuickBuy(wallet, 0.1)}
                      disabled={loading[`${wallet.address}-buy-0.1`] || wallet.solBalance < 0.1}
                      className="px-1.5 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading[`${wallet.address}-buy-0.1`] ? '...' : '0.1'}
                    </button>
                    <button
                      onClick={() => handleQuickBuy(wallet, 0.25)}
                      disabled={loading[`${wallet.address}-buy-0.25`] || wallet.solBalance < 0.25}
                      className="px-1.5 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading[`${wallet.address}-buy-0.25`] ? '...' : '0.25'}
                    </button>
                    <button
                      onClick={() => handleQuickBuy(wallet, 0.5)}
                      disabled={loading[`${wallet.address}-buy-0.5`] || wallet.solBalance < 0.5}
                      className="px-1.5 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading[`${wallet.address}-buy-0.5`] ? '...' : '0.5'}
                    </button>
                    <button
                      onClick={() => handleQuickBuy(wallet, 1.0)}
                      disabled={loading[`${wallet.address}-buy-1.0`] || wallet.solBalance < 1.0}
                      className="px-1.5 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading[`${wallet.address}-buy-1.0`] ? '...' : '1.0'}
                    </button>
                  </div>
                  {/* Manual Buy Input */}
                  <div className="flex gap-1">
                    <input
                      type="number"
                      step="0.001"
                      value={manualInputs[`${wallet.address}-buy-manual`] || ''}
                      onChange={(e) => setManualInputs({ ...manualInputs, [`${wallet.address}-buy-manual`]: e.target.value })}
                      placeholder="SOL"
                      className="flex-1 px-2 py-1 text-xs bg-white border border-gray-800 rounded text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                    <button
                      onClick={() => handleManualBuy(wallet)}
                      disabled={loading[`${wallet.address}-buy-manual`] || !manualInputs[`${wallet.address}-buy-manual`]}
                      className="px-2 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading[`${wallet.address}-buy-manual`] ? '...' : 'Buy'}
                    </button>
                  </div>
                </div>

                {/* Quick Sell Buttons */}
                <div>
                  <p className="text-xs text-gray-500 mb-1.5">Sell:</p>
                  <div className="grid grid-cols-4 gap-1 mb-1.5">
                    <button
                      onClick={() => handleQuickSell(wallet, 25)}
                      disabled={loading[`${wallet.address}-sell-25`] || wallet.tokenBalance === 0}
                      className="px-1.5 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading[`${wallet.address}-sell-25`] ? '...' : '25%'}
                    </button>
                    <button
                      onClick={() => handleQuickSell(wallet, 50)}
                      disabled={loading[`${wallet.address}-sell-50`] || wallet.tokenBalance === 0}
                      className="px-1.5 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading[`${wallet.address}-sell-50`] ? '...' : '50%'}
                    </button>
                    <button
                      onClick={() => handleQuickSell(wallet, 75)}
                      disabled={loading[`${wallet.address}-sell-75`] || wallet.tokenBalance === 0}
                      className="px-1.5 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading[`${wallet.address}-sell-75`] ? '...' : '75%'}
                    </button>
                    <button
                      onClick={() => handleQuickSell(wallet, 100)}
                      disabled={loading[`${wallet.address}-sell-100`] || wallet.tokenBalance === 0}
                      className="px-1.5 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading[`${wallet.address}-sell-100`] ? '...' : '100%'}
                    </button>
                  </div>
                  {/* Manual Sell Input */}
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={manualInputs[`${wallet.address}-sell-manual`] || ''}
                      onChange={(e) => setManualInputs({ ...manualInputs, [`${wallet.address}-sell-manual`]: e.target.value })}
                      placeholder="%"
                      className="flex-1 px-2 py-1 text-xs bg-white border border-gray-800 rounded text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                    <button
                      onClick={() => handleManualSell(wallet)}
                      disabled={loading[`${wallet.address}-sell-manual`] || !manualInputs[`${wallet.address}-sell-manual`]}
                      className="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading[`${wallet.address}-sell-manual`] ? '...' : 'Sell'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
      </div>

      {wallets.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          <p>No wallets found. Launch a token first.</p>
        </div>
      )}

      {/* Terminal Console */}
      <div className="mt-6 bg-black/50 rounded-lg border border-gray-800">
        <div className="flex justify-between items-center p-2 border-b border-gray-800">
          <h3 className="text-sm font-bold text-white">📺 Terminal</h3>
          <button
            onClick={() => setTerminalMessages([])}
            className="px-2 py-1 text-xs bg-gray-900/50 hover:bg-gray-800 text-white rounded transition-colors"
          >
            Clear
          </button>
        </div>
        <div ref={terminalRef} className="p-3 h-48 overflow-y-auto font-mono text-xs">
          {terminalMessages.length === 0 ? (
            <p className="text-gray-600">No messages yet...</p>
          ) : (
            terminalMessages.map((msg, idx) => (
              <div
                key={idx}
                className={`mb-1 ${
                  msg.type === 'success' ? 'text-green-400' :
                  msg.type === 'error' ? 'text-red-400' :
                  'text-gray-300'
                }`}
              >
                <span className="text-gray-600">[{msg.timestamp}]</span> {msg.message}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

