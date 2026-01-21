import { useState, useEffect, useRef, useMemo } from 'react';
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
  PlusIcon,
  QuestionMarkCircleIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import {
  WalletIcon as WalletIconSolid,
  CurrencyDollarIcon as CurrencyDollarIconSolid,
  SparklesIcon as SparklesIconSolid,
} from '@heroicons/react/24/solid';
import PnLTracker from './PnLTracker';
import LaunchProgress from './LaunchProgress';

export default function HolderWallets() {
  const [wallets, setWallets] = useState([]);
  const [mintAddress, setMintAddress] = useState(null);
  const [loading, setLoading] = useState({});
  const [manualInputs, setManualInputs] = useState({}); // Track manual inputs per wallet
  const [menuRunning, setMenuRunning] = useState({});
  const [terminalMessages, setTerminalMessages] = useState([]); // Terminal log messages
  const terminalRef = useRef(null);
  const [liveTrades, setLiveTrades] = useState([]);
  const [liveTradesError, setLiveTradesError] = useState('');
  const [hideMyWallets, setHideMyWallets] = useState(false);
  const [tradesEventSource, setTradesEventSource] = useState(null);
  const [tokenInfo, setTokenInfo] = useState(null);
  const [launchProgressEventSource, setLaunchProgressEventSource] = useState(null);
  const [launchProgressMessages, setLaunchProgressMessages] = useState([]);
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchStatus, setLaunchStatus] = useState(''); // Current launch step
  const [testWalletInput, setTestWalletInput] = useState('');
  const [testWallets, setTestWallets] = useState([]);
  const [loadingTestWallets, setLoadingTestWallets] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferFrom, setTransferFrom] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferring, setTransferring] = useState(false);
  // Custom confirmation modal state
  const [confirmationModal, setConfirmationModal] = useState(null);
  // Load priority fee from localStorage or default to 'normal' (random variance for natural trades)
  const [priorityFee, setPriorityFee] = useState(() => {
    const saved = localStorage.getItem('holderWalletPriorityFee');
    // Migrate old values to new 'normal'
    if (saved === 'low' || saved === 'medium') return 'normal';
    return saved || 'normal'; // Default to 'normal' - random variance looks natural
  });
  
  // Custom confirmation function that returns a Promise
  const showConfirmation = (title, message, type = 'warning') => {
    return new Promise((resolve) => {
      setConfirmationModal({
        title,
        message,
        type,
        onConfirm: () => {
          setConfirmationModal(null);
          resolve(true);
        },
        onCancel: () => {
          setConfirmationModal(null);
          resolve(false);
        }
      });
    });
  };
  
  // PnL Tracker state
  const [pnlExpanded, setPnlExpanded] = useState(false);
  
  // Auto-sell state
  const [autoSellEnabled, setAutoSellEnabled] = useState(false);
  const [autoSellConfig, setAutoSellConfig] = useState({});
  const autoSellEventSourceRef = useRef(null);
  
  // Batch sell state (instant parallel sells)
  const [batchSellRunning, setBatchSellRunning] = useState({
    all: false,
    bundles: false,
    holders: false
  });
  
  // Chart type: always use Birdeye (removed local chart to avoid rate limits)
  
  // Refs for debouncing and request cancellation
  const loadWalletsTimeoutRef = useRef(null);
  const activeRequestsRef = useRef(new Map()); // Track active requests to prevent duplicates

  // Calculate external volume (net SOL from non-our-wallet trades)
  // Positive = more buys than sells, Negative = more sells than buys
  const externalVolume = useMemo(() => {
    const externalTrades = liveTrades.filter(t => !t.isOurWallet);
    let totalBuys = 0;
    let totalSells = 0;
    
    externalTrades.forEach(trade => {
      if (trade.type === 'buy') {
        totalBuys += trade.solAmount || 0;
      } else if (trade.type === 'sell') {
        totalSells += trade.solAmount || 0;
      }
    });
    
    return {
      buys: totalBuys,
      sells: totalSells,
      net: totalBuys - totalSells,
      count: externalTrades.length
    };
  }, [liveTrades]);

  // Calculate OUR PROFITS (net SOL from our wallet trades)
  // buys = SOL we spent, sells = SOL we received, profit = sells - buys
  // Includes 1% fees on buys and sells, plus 0.015 SOL token creation cost
  const ourProfits = useMemo(() => {
    const ourTrades = liveTrades.filter(t => t.isOurWallet);
    let totalBuys = 0;
    let totalSells = 0;
    
    // Constants for fees
    const TRADING_FEE_PERCENT = 0.01; // 1% fee on buys and sells
    const TOKEN_CREATION_COST = 0.015; // 0.015 SOL for token creation
    
    ourTrades.forEach(trade => {
      if (trade.type === 'buy') {
        // For buys: add 1% fee (if we buy $100, we actually spent $101 including fees)
        const buyAmount = trade.solAmount || 0;
        totalBuys += buyAmount * (1 + TRADING_FEE_PERCENT);
      } else if (trade.type === 'sell') {
        // For sells: subtract 1% fee (if we sell $100, we actually received $99 after fees)
        const sellAmount = trade.solAmount || 0;
        totalSells += sellAmount * (1 - TRADING_FEE_PERCENT);
      }
    });
    
    // Subtract token creation cost (one-time cost, only if we have a mint address)
    const tokenCreationCost = mintAddress ? TOKEN_CREATION_COST : 0;
    
    return {
      buys: totalBuys,      // Total SOL spent (buying tokens + 1% fees)
      sells: totalSells,    // Total SOL received (selling tokens - 1% fees)
      profit: totalSells - totalBuys - tokenCreationCost,  // Net profit (positive = made money)
      count: ourTrades.length,
      tokenCreationCost: tokenCreationCost
    };
  }, [liveTrades, mintAddress]);

  // Save priority fee to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('holderWalletPriorityFee', priorityFee);
  }, [priorityFee]);

  // Auto-sell status monitoring
  useEffect(() => {
    const loadAutoSellConfig = async () => {
      try {
        const response = await apiService.getAutoSellConfig();
        if (response.data.success) {
          setAutoSellEnabled(response.data.enabled);
          setAutoSellConfig(response.data.wallets || {});
        }
      } catch (err) {
        console.error('Failed to load auto-sell config:', err);
      }
    };

    loadAutoSellConfig();

    // Connect to SSE for real-time updates
    const eventSource = new EventSource('/api/auto-sell/events');
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'config') {
          setAutoSellEnabled(data.enabled);
          setAutoSellConfig(data.wallets || {});
        } else if (data.type === 'sellTriggered') {
          // Just log it - no browser notification needed (in-app toast handles it)
          console.log(` Auto-Sell Triggered: ${data.walletAddress?.slice(0, 8)}... at ${data.externalNetVolume?.toFixed(2)} SOL`);
          loadAutoSellConfig();
        } else if (data.type === 'sellComplete' || data.type === 'sellFailed') {
          loadAutoSellConfig();
        }
      } catch (e) {
        console.error('Failed to parse auto-sell event:', e);
      }
    };

    eventSource.onerror = () => {
      // Reconnect after 5 seconds
      setTimeout(() => {
        loadAutoSellConfig();
      }, 5000);
    };

    autoSellEventSourceRef.current = eventSource;

    return () => {
      eventSource.close();
    };
  }, []);

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

  // Launch progress SSE connection (always connected to see launch progress)
  useEffect(() => {
    // Browser notifications disabled - using in-app toast only
    
    // Connect to launch progress stream
    const progressEventSource = new EventSource('http://localhost:3001/api/launch-progress');
    
    progressEventSource.onopen = () => {
      console.log('[HolderWallets] [ok] Connected to launch progress SSE');
    };
    
    progressEventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'stdout' || data.type === 'stderr') {
          const message = data.data.trim();
          if (message) {
            // Add to terminal messages
            addTerminalMessage(message, data.type === 'stderr' ? 'error' : 'info');
            
            // Add to launch progress messages
            setLaunchProgressMessages(prev => {
              const updated = [...prev, { type: data.type, message, timestamp: data.timestamp }];
              return updated.slice(-50); // Keep last 50 messages
            });
            
            // Update launch status for the loading overlay
            const msgLower = message.toLowerCase();
            
            // Start showing overlay on ANY launch-related message
            if (!isLaunching && (
              msgLower.includes('start') || 
              msgLower.includes('launch') || 
              msgLower.includes('initializ') ||
              msgLower.includes('loading') ||
              msgLower.includes('wallet') ||
              msgLower.includes('lut') ||
              msgLower.includes('creating')
            )) {
              setIsLaunching(true);
            }
            
            // Update status based on message content - show ALL steps
            if (msgLower.includes('loading wallet') || msgLower.includes('wallet loaded')) {
              setLaunchStatus('Loading wallets...');
            } else if (msgLower.includes('lut') || msgLower.includes('lookup table')) {
              setLaunchStatus('Setting up LUTs...');
            } else if (msgLower.includes('sending') || msgLower.includes('transfer')) {
              setLaunchStatus('Sending funds...');
            } else if (msgLower.includes('creating token') || msgLower.includes('mint')) {
              setLaunchStatus('Creating token...');
            } else if (msgLower.includes('metadata')) {
              setLaunchStatus('Setting metadata...');
            } else if (msgLower.includes('dev buy') || msgLower.includes('dev wallet')) {
              setLaunchStatus('Executing dev buy...');
            } else if (msgLower.includes('bundle') || msgLower.includes('bundling')) {
              setLaunchStatus('Processing bundle wallets...');
            } else if (msgLower.includes('holder')) {
              setLaunchStatus('Processing holder wallets...');
            } else if (msgLower.includes('confirming') || msgLower.includes('waiting') || msgLower.includes('pending')) {
              setLaunchStatus('Confirming transactions...');
            } else if (msgLower.includes('signature') || msgLower.includes('confirmed')) {
              setLaunchStatus('Transaction confirmed!');
            } else if (msgLower.includes('bundle confirmed') || msgLower.includes('launch complete') || msgLower.includes('launched successfully')) {
              setLaunchStatus('Launch complete! ');
              // Keep toast visible longer on success - user should see this
              setTimeout(() => {
                setIsLaunching(false);
                setLaunchStatus('');
              }, 8000);
            } else if (msgLower.includes('fatal error') || msgLower.includes('launch failed')) {
              // Only hide on FATAL errors, not warnings
              setLaunchStatus('Error occurred [x]');
              setTimeout(() => {
                setIsLaunching(false);
                setLaunchStatus('');
              }, 10000);
            } else if (message.length > 0) {
              // For any other message, just show it as the status
              // This keeps the toast visible and updated during the entire process
              setLaunchStatus(message.substring(0, 60) + (message.length > 60 ? '...' : ''));
            }
            
            // Show notifications for important events
            // Browser notifications disabled - using in-app toast only
          }
        } else if (data.type === 'close') {
          console.log('[HolderWallets] Launch progress stream closed');
          // Don't immediately hide the toast - keep it visible until user sees result
          // Only hide if we haven't received a success/error message
          if (!launchStatus.includes('') && !launchStatus.includes('[x]')) {
            setLaunchStatus('Waiting for blockchain confirmation...');
            // Auto-hide after 30 seconds if stream closes without result
            setTimeout(() => {
              setIsLaunching(false);
              setLaunchStatus('');
            }, 30000);
          }
        }
      } catch (error) {
        console.error('[HolderWallets] Error parsing launch progress:', error);
      }
    };
    
    progressEventSource.onerror = (error) => {
      console.error('[HolderWallets] Launch progress SSE error:', error);
    };
    
    setLaunchProgressEventSource(progressEventSource);
    
    return () => {
      console.log('[HolderWallets] Closing launch progress SSE connection');
      progressEventSource.close();
    };
  }, []); // Always connected, not dependent on mintAddress

  // Live trades SSE connection
  useEffect(() => {
    if (!mintAddress) {
      if (tradesEventSource) {
        tradesEventSource.close();
        setTradesEventSource(null);
      }
      setLiveTrades([]);
      setLiveTradesError('');
      return;
    }

    console.log(`[HolderWallets] Connecting to live trades for ${mintAddress.slice(0, 8)}...`);

    // Connect to live trades SSE
    const eventSource = new EventSource(`http://localhost:3001/api/live-trades?mint=${mintAddress}`);
    
    eventSource.onopen = () => {
      console.log(`[HolderWallets] [ok] Connected to live trades SSE`);
      setLiveTradesError('');
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log(`[HolderWallets] Received SSE data:`, data.type, data.trades?.length || 0);
        
        if (data.type === 'initial') {
          // Sort trades by timestamp (newest first) before setting
          const sortedTrades = (data.trades || []).sort((a, b) => b.timestamp - a.timestamp);
          console.log(`[HolderWallets] Received ${sortedTrades.length} initial trades`);
          setLiveTrades(sortedTrades);
          if (sortedTrades.length > 0) {
            addTerminalMessage(`Loaded ${sortedTrades.length} past transactions`, 'success');
          }
        } else if (data.type === 'error') {
          console.error('[HolderWallets] SSE error:', data.error);
          addTerminalMessage(`Live trades error: ${data.error}`, 'error');
          setLiveTradesError(String(data.error || 'Live trades error'));
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
      setLiveTradesError('Live trades connection failed. Start the API server and ensure your .env (RPC + PRIVATE_KEY) is configured.');
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

  // Load test wallets on mount
  useEffect(() => {
    const loadTestWallets = async () => {
      try {
        const res = await apiService.getTestWallets();
        if (res.data.success) {
          setTestWallets(res.data.wallets || []);
        }
      } catch (error) {
        // Silently fail - not critical
      }
    };
    loadTestWallets();
  }, []);

  const loadCurrentRunInfo = async () => {
    try {
      const res = await apiService.getCurrentRun();
      const currentRun = res.data.data || res.data;
      
      // Detect if launch is in progress (PENDING status or no mint yet but has wallets)
      if (currentRun) {
        if (currentRun.launchStatus === 'PENDING' && !currentRun.mintAddress) {
          // Launch in progress - show LaunchProgress UI
          setIsLaunching(true);
        } else if (currentRun.launchStatus === 'SUCCESS' && currentRun.mintAddress) {
          // Launch complete
          setIsLaunching(false);
        }
      }
      
      if (currentRun && currentRun.mintAddress) {
        const mintAddr = currentRun.mintAddress || '';
        const statusMsg = `Run: ${mintAddr.substring ? mintAddr.substring(0, 8) : mintAddr.slice(0, 8)}... | Status: ${currentRun.launchStatus || 'N/A'} | Wallets: ${currentRun.walletKeys?.length || currentRun.count || 0} | Bundle: ${currentRun.bundleWalletKeys?.length || 0} | Holder: ${currentRun.holderWalletKeys?.length || 0}`;
        
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
      funding: {
        label: 'FUNDING',
        bgColor: 'bg-gradient-to-br from-purple-900/50 via-purple-900/40 to-pink-900/40',
        borderColor: 'border-purple-400',
        textColor: 'text-purple-200',
        iconColor: 'text-purple-300',
        shadowColor: 'shadow-purple-500/30',
        ringColor: 'ring-purple-400/50'
      },
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
      await apiService.buyTokens(wallet.address, mintAddress, amount, undefined, priorityFee);
      const feeText = priorityFee === 'high' ? 'HIGH' : priorityFee === 'ultra' ? 'ULTRA' : priorityFee === 'none' ? 'NONE' : 'NORMAL';
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
      await apiService.buyTokens(wallet.address, mintAddress, amount, undefined, priorityFee);
      const feeText = priorityFee === 'high' ? 'HIGH' : priorityFee === 'ultra' ? 'ULTRA' : priorityFee === 'none' ? 'NONE' : 'NORMAL';
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
      await apiService.sellTokens(wallet.address, mintAddress, percentage, priorityFee);
      const feeText = priorityFee === 'high' ? 'HIGH' : priorityFee === 'ultra' ? 'ULTRA' : priorityFee === 'none' ? 'NONE' : 'NORMAL';
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
      await apiService.buyTokens(wallet.address, mintAddress, amount, undefined, priorityFee);
      const feeText = priorityFee === 'high' ? 'HIGH' : priorityFee === 'ultra' ? 'ULTRA' : priorityFee === 'none' ? 'NONE' : 'NORMAL';
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
      await apiService.sellTokens(wallet.address, mintAddress, sellPercent, priorityFee);
      const feeText = priorityFee === 'high' ? 'HIGH' : priorityFee === 'ultra' ? 'ULTRA' : priorityFee === 'none' ? 'NONE' : 'NORMAL';
      addTerminalMessage(`[ok] Sell successful! ${sellPercent}% from ${wallet.address.substring(0, 8)} (${feeText} priority)`, 'success');
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
      'gather-new-only': 'Gather New Only (skip warmed)',
      'gather': 'Gather SOL',
      'gather-all': 'Gather All Wallets',
      'check-bundle': 'Check Status',
      'collect-fees': 'Collect Fees'
    };
    
    // Confirmation messages with clear descriptions
    const confirmMessages = {
      'rapid-sell': '[!] SELL ALL TOKENS (100%)\n\nThis will sell ALL tokens from ALL bundle/holder wallets immediately.\n\nAre you sure?',
      'rapid-sell-50-percent': '[!] SELL 50% OF TOKENS\n\nThis will sell 50% of tokens from ALL bundle/holder wallets.\n\nAre you sure?',
      'rapid-sell-remaining': '[!] SELL REMAINING TOKENS\n\nThis will sell any remaining tokens from ALL bundle/holder wallets.\n\nAre you sure?',
      'gather-new-only': '[ok] GATHER NEW WALLETS ONLY\n\nThis will:\n- Transfer ALL tokens & gather ALL SOL from AUTO-CREATED wallets\n- SKIP warming wallets (preserves Mayan anonymity)\n\n⚠️ WARNING: This transfers tokens and SOL, breaking anonymity links!\n\nSafe for warming wallet protection. Continue?',
      'gather': '[!] GATHER ALL SOL & TOKENS (INCLUDING WARMING WALLETS!)\n\nThis will transfer ALL tokens & gather ALL SOL from ALL wallets including warming wallets!\n\n[!] WARNING: This will BREAK Mayan swap anonymity!\n\n⚠️ This transfers tokens and SOL, creating on-chain links between wallets!\n\nUse "Gather New Only" instead to protect warming wallets.\n\nAre you SURE you want to gather from ALL wallets?',
      'gather-all': '[!] GATHER FROM ALL WALLETS\n\nThis will transfer ALL tokens & gather ALL SOL from ALL wallets in the system.\n\n[!] WARNING: This may affect warming wallets!\n\n⚠️ This transfers tokens and SOL, creating on-chain links!\n\nAre you sure?',
      'collect-fees': ' COLLECT CREATOR FEES\n\nThis will collect any accumulated creator fees from your tokens.\n\nContinue?'
    };
    
    // Commands that require confirmation
    const requiresConfirmation = ['rapid-sell', 'rapid-sell-50-percent', 'rapid-sell-remaining', 'gather-new-only', 'gather', 'gather-all', 'collect-fees'];
    
    if (requiresConfirmation.includes(commandId)) {
      const message = confirmMessages[commandId] || `Are you sure you want to execute: ${commandNames[commandId]}?`;
      
      // Parse message to extract title and body
      const lines = message.split('\n');
      const title = lines[0].replace(/[\[\]!]/g, '').trim();
      const body = lines.slice(1).join('\n').trim();
      
      // Determine modal type based on command
      let modalType = 'warning';
      if (commandId.includes('gather')) {
        modalType = 'danger';
      } else if (commandId.includes('rapid-sell')) {
        modalType = 'warning';
      } else {
        modalType = 'info';
      }
      
      // Show custom confirmation modal
      const confirmed = await showConfirmation(title, body, modalType);
      if (!confirmed) {
        addTerminalMessage(`⚠️ ${commandNames[commandId]} cancelled`, 'info');
        return; // User cancelled
      }
    }
    
    setMenuRunning({ ...menuRunning, [commandId]: true });
    addTerminalMessage(`Executing: ${commandNames[commandId] || commandId}...`, 'info');
    console.log(`[HolderWallets] Starting command: ${commandId}`);
    
    // Helper to parse and display output
    const displayOutput = (output) => {
      const lines = output.split('\n').filter(line => line.trim());
      lines.forEach(line => {
        if (line.trim()) {
          const type = line.includes('SUCCESS') || line.toLowerCase().includes('success') ? 'success' :
                      line.includes('FAILED') || line.includes('Error') || line.toLowerCase().includes('failed') ? 'error' :
                      'info';
          const cleanLine = line.trim().replace(/[[ok][x]]/g, '').trim();
          addTerminalMessage(cleanLine, type);
        }
      });
    };
    
    try {
      console.log(`[HolderWallets] Calling API: executeCommand(${commandId})`);
      const res = await apiService.executeCommand(commandId);
      console.log(`[HolderWallets] API response received:`, res.data);
      const output = res.data.output || res.data.message || 'Command executed';
      displayOutput(output);
      
      // Auto-collect fees after any gather command (collects from dev wallet)
      const gatherCommands = ['gather-new-only', 'gather', 'gather-all'];
      if (gatherCommands.includes(commandId)) {
        addTerminalMessage('Auto-collecting creator fees...', 'info');
        try {
          const feesRes = await apiService.executeCommand('collect-fees');
          const feesOutput = feesRes.data.output || feesRes.data.message || 'Fees collected';
          displayOutput(feesOutput);
        } catch (feeError) {
          addTerminalMessage(`Fee collection skipped: ${feeError.message || 'No fees to collect'}`, 'info');
        }
      }
      
      setTimeout(loadWallets, 500);
    } catch (error) {
      console.error(`[HolderWallets] Command ${commandId} failed:`, error);
      const errorMessage = error.response?.data?.error || error.response?.data?.message || error.message || 'Unknown error';
      addTerminalMessage(`${commandNames[commandId] || commandId} failed: ${errorMessage}`, 'error');
      
      // Provide helpful error messages
      if (error.response?.status === 400) {
        addTerminalMessage(`💡 Tip: Check that the command "${commandId}" is valid and your .env file is configured correctly.`, 'info');
      } else if (error.response?.status === 500) {
        addTerminalMessage(`💡 Tip: Check the server console for detailed error messages.`, 'info');
      } else if (!error.response) {
        addTerminalMessage(`💡 Tip: Check your network connection and ensure the API server is running.`, 'info');
      }
    } finally {
      setMenuRunning({ ...menuRunning, [commandId]: false });
      console.log(`[HolderWallets] Command ${commandId} finished`);
    }
  };

  // ============================================================================
  // BATCH SELL HANDLERS - Instant parallel sells (no process spawn!)
  // ============================================================================
  
  const handleBatchSell = async (type) => {
    const typeNames = {
      all: 'ALL WALLETS',
      bundles: 'BUNDLE WALLETS',
      holders: 'HOLDER WALLETS'
    };
    
    const confirmMessages = {
      all: ' INSTANT SELL ALL WALLETS\n\nThis will sell 100% from DEV + Bundle + Holder wallets IN PARALLEL.\n\nAre you sure?',
      bundles: ' INSTANT SELL BUNDLES\n\nThis will sell 100% from DEV + Bundle wallets IN PARALLEL.\n\nAre you sure?',
      holders: ' INSTANT SELL HOLDERS\n\nThis will sell 100% from Holder wallets IN PARALLEL.\n\nAre you sure?'
    };
    
    if (!window.confirm(confirmMessages[type])) return;
    
    setBatchSellRunning(prev => ({ ...prev, [type]: true }));
    addTerminalMessage(` ${typeNames[type]} - Firing parallel sells...`, 'info');
    
    try {
      let res;
      if (type === 'all') {
        res = await apiService.batchSellAll(100, priorityFee);
      } else if (type === 'bundles') {
        res = await apiService.batchSellBundles(100, priorityFee);
      } else {
        res = await apiService.batchSellHolders(100, priorityFee);
      }
      
      if (res.data.success) {
        addTerminalMessage(`[ok] ${typeNames[type]} COMPLETE!`, 'success');
        addTerminalMessage(`   Successful: ${res.data.successful} | Failed: ${res.data.failed}`, 'info');
        addTerminalMessage(`   Time: ${res.data.elapsed}ms (${(res.data.elapsed / 1000).toFixed(2)}s)`, 'info');
        
        // Show individual results
        if (res.data.results) {
          res.data.results.forEach(r => {
            if (r.success) {
              addTerminalMessage(`   [ok] ${r.wallet.substring(0, 8)}... sold`, 'success');
            } else if (r.error !== 'No tokens to sell') {
              addTerminalMessage(`   [x] ${r.wallet.substring(0, 8)}... ${r.error}`, 'error');
            }
          });
        }
      } else {
        addTerminalMessage(`[x] ${typeNames[type]} failed: ${res.data.error}`, 'error');
      }
      
      setTimeout(loadWallets, 500);
    } catch (error) {
      addTerminalMessage(`[x] ${typeNames[type]} failed: ${error.response?.data?.error || error.message}`, 'error');
    } finally {
      setBatchSellRunning(prev => ({ ...prev, [type]: false }));
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

  const handleAddTestWallets = async () => {
    if (!testWalletInput.trim()) {
      addTerminalMessage('Please enter wallet address(es)', 'error');
      return;
    }

    setLoadingTestWallets(true);
    try {
      // Split by comma or newline
      const wallets = testWalletInput
        .split(/[,\n]/)
        .map(w => w.trim())
        .filter(w => w.length > 0);

      if (wallets.length === 0) {
        addTerminalMessage('No valid wallet addresses found', 'error');
        return;
      }

      const res = await apiService.addTestWallets(wallets);
      if (res.data.success) {
        addTerminalMessage(`[ok] Added ${res.data.added} test wallet(s) for stream testing`, 'success');
        setTestWalletInput('');
        // Reload test wallets list
        const testRes = await apiService.getTestWallets();
        if (testRes.data.success) {
          setTestWallets(testRes.data.wallets || []);
        }
      } else {
        addTerminalMessage(`Failed to add test wallets: ${res.data.error}`, 'error');
      }
    } catch (error) {
      addTerminalMessage(`Error adding test wallets: ${error.response?.data?.error || error.message}`, 'error');
    } finally {
      setLoadingTestWallets(false);
    }
  };

  const handleClearTestWallets = async () => {
    setLoadingTestWallets(true);
    try {
      const res = await apiService.clearTestWallets();
      if (res.data.success) {
        addTerminalMessage(` Cleared ${res.data.cleared} test wallet(s)`, 'success');
        setTestWallets([]);
      } else {
        addTerminalMessage(`Failed to clear test wallets: ${res.data.error}`, 'error');
      }
    } catch (error) {
      addTerminalMessage(`Error clearing test wallets: ${error.response?.data?.error || error.message}`, 'error');
    } finally {
      setLoadingTestWallets(false);
    }
  };

  const handleTransferSol = async () => {
    if (!transferFrom || !transferTo || !transferAmount) {
      addTerminalMessage('Please fill in all fields', 'error');
      return;
    }

    const amount = parseFloat(transferAmount);
    if (isNaN(amount) || amount <= 0) {
      addTerminalMessage('Please enter a valid amount', 'error');
      return;
    }

    // Find from wallet
    const fromWallet = wallets.find(w => w.address.toLowerCase() === transferFrom.toLowerCase());
    if (!fromWallet || !fromWallet.privateKey) {
      addTerminalMessage('From wallet not found or missing private key', 'error');
      return;
    }

    setTransferring(true);
    try {
      const res = await apiService.transferSol(fromWallet.privateKey, transferTo, amount);
      if (res.data.success) {
        addTerminalMessage(`[ok] Transferred ${amount.toFixed(6)} SOL from ${fromWallet.address ? fromWallet.address.slice(0, 8) : 'unknown'}... to ${transferTo ? transferTo.slice(0, 8) : 'unknown'}...`, 'success');
        addTerminalMessage(`Signature: ${res.data.signature}`, 'info');
        setShowTransferModal(false);
        setTransferFrom('');
        setTransferTo('');
        setTransferAmount('');
        loadWallets(); // Refresh balances
      } else {
        addTerminalMessage(`Transfer failed: ${res.data.error}`, 'error');
      }
    } catch (error) {
      addTerminalMessage(`Transfer error: ${error.response?.data?.error || error.message}`, 'error');
    } finally {
      setTransferring(false);
    }
  };

  // Detect important events from launch messages
  const walletsSaved = launchProgressMessages.some(m => 
    m.message.toLowerCase().includes('saved') && 
    (m.message.toLowerCase().includes('wallet') || m.message.toLowerCase().includes('keys'))
  );
  const fundingComplete = launchProgressMessages.some(m => 
    m.message.toLowerCase().includes('funding complete') || 
    m.message.toLowerCase().includes('distributed') ||
    m.message.toLowerCase().includes('hop') && m.message.toLowerCase().includes('complete')
  );
  const bundleSent = launchProgressMessages.some(m => 
    m.message.toLowerCase().includes('bundle') && 
    (m.message.toLowerCase().includes('sent') || m.message.toLowerCase().includes('submit'))
  );
  const bundleSuccess = launchProgressMessages.some(m => 
    m.message.toLowerCase().includes('bundle') && m.message.toLowerCase().includes('success')
  );

  // Check if we're launching (show clean progress UI)
  if (!mintAddress) {
    return (
      <div className="w-full h-full bg-gray-950 flex flex-col">
        
        {/* Header */}
        <div className="bg-gray-900 border-b border-gray-800 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${isLaunching ? 'bg-yellow-500 animate-pulse' : 'bg-gray-600'}`} />
              <h1 className="text-xl font-bold text-white">
                {isLaunching ? 'Launching Token...' : 'Trading Terminal'}
              </h1>
            </div>
            {isLaunching && (
              <span className="text-xs text-yellow-400 bg-yellow-400/10 px-3 py-1 rounded-full">LIVE</span>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-auto p-6">
          {isLaunching ? (
            <div className="max-w-2xl mx-auto space-y-4">
              
              {/* STEP 1: Creating Wallets */}
              <div className={`p-4 rounded-xl border ${
                walletsSaved 
                  ? 'bg-green-500/10 border-green-500/30' 
                  : 'bg-gray-900 border-gray-800'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    walletsSaved ? 'bg-green-500' : 'bg-gray-700'
                  }`}>
                    {walletsSaved ? (
                      <CheckCircleIcon className="w-6 h-6 text-white" />
                    ) : (
                      <ArrowPathIcon className="w-5 h-5 text-gray-400 animate-spin" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className={`font-semibold ${walletsSaved ? 'text-green-400' : 'text-white'}`}>
                      Creating & Saving Wallets
                    </div>
                    <div className={`text-sm ${walletsSaved ? 'text-green-400/70' : 'text-gray-500'}`}>
                      {walletsSaved ? '✓ All wallet keys saved to current-run.json' : 'Generating bundle and holder wallets...'}
                    </div>
                  </div>
                  {walletsSaved && (
                    <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs font-bold rounded">SAVED</span>
                  )}
                </div>
              </div>

              {/* WALLET SAVED CONFIRMATION - Big and obvious */}
              {walletsSaved && (
                <div className="bg-green-500/10 border-2 border-green-500/50 rounded-xl p-4 flex items-center gap-4">
                  <ShieldCheckIcon className="w-10 h-10 text-green-400 flex-shrink-0" />
                  <div>
                    <div className="text-green-400 font-bold text-lg">Wallets Saved Securely</div>
                    <div className="text-green-400/70 text-sm">
                      Your funds are safe. Even if launch fails, SOL can be recovered with `npm run gather`
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 2: Funding Wallets */}
              <div className={`p-4 rounded-xl border ${
                fundingComplete 
                  ? 'bg-green-500/10 border-green-500/30' 
                  : walletsSaved 
                    ? 'bg-gray-900 border-gray-800' 
                    : 'bg-gray-900/50 border-gray-800/50 opacity-50'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    fundingComplete ? 'bg-green-500' : walletsSaved ? 'bg-indigo-500' : 'bg-gray-700'
                  }`}>
                    {fundingComplete ? (
                      <CheckCircleIcon className="w-6 h-6 text-white" />
                    ) : walletsSaved ? (
                      <ArrowPathIcon className="w-5 h-5 text-white animate-spin" />
                    ) : (
                      <CurrencyDollarIcon className="w-5 h-5 text-gray-500" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className={`font-semibold ${fundingComplete ? 'text-green-400' : walletsSaved ? 'text-white' : 'text-gray-500'}`}>
                      Funding Wallets
                    </div>
                    <div className={`text-sm ${fundingComplete ? 'text-green-400/70' : 'text-gray-500'}`}>
                      {fundingComplete ? '✓ SOL distributed to all wallets' : 'Sending SOL to bundle and holder wallets...'}
                    </div>
                  </div>
                  {fundingComplete && (
                    <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs font-bold rounded">DONE</span>
                  )}
                </div>
              </div>

              {/* STEP 3: Sending Bundle */}
              <div className={`p-4 rounded-xl border ${
                bundleSuccess 
                  ? 'bg-green-500/10 border-green-500/30' 
                  : bundleSent
                    ? 'bg-yellow-500/10 border-yellow-500/30'
                    : fundingComplete 
                      ? 'bg-gray-900 border-gray-800' 
                      : 'bg-gray-900/50 border-gray-800/50 opacity-50'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    bundleSuccess ? 'bg-green-500' : bundleSent ? 'bg-yellow-500' : fundingComplete ? 'bg-indigo-500' : 'bg-gray-700'
                  }`}>
                    {bundleSuccess ? (
                      <CheckCircleIcon className="w-6 h-6 text-white" />
                    ) : fundingComplete ? (
                      <ArrowPathIcon className="w-5 h-5 text-white animate-spin" />
                    ) : (
                      <RocketLaunchIcon className="w-5 h-5 text-gray-500" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className={`font-semibold ${bundleSuccess ? 'text-green-400' : bundleSent ? 'text-yellow-400' : fundingComplete ? 'text-white' : 'text-gray-500'}`}>
                      Sending Bundle via Jito
                    </div>
                    <div className={`text-sm ${bundleSuccess ? 'text-green-400/70' : bundleSent ? 'text-yellow-400/70' : 'text-gray-500'}`}>
                      {bundleSuccess ? '✓ Bundle confirmed on-chain!' : bundleSent ? 'Waiting for confirmation...' : 'Submitting token creation + buys...'}
                    </div>
                  </div>
                  {bundleSuccess && (
                    <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs font-bold rounded">SUCCESS</span>
                  )}
                  {bundleSent && !bundleSuccess && (
                    <span className="px-2 py-1 bg-yellow-500/20 text-yellow-400 text-xs font-bold rounded animate-pulse">PENDING</span>
                  )}
                </div>
              </div>

              {/* Activity Log - Clean, minimal */}
              <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden mt-6">
                <div className="px-4 py-3 bg-gray-800/50 border-b border-gray-800 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-400">Activity Log</span>
                  <span className="text-xs text-gray-600">{launchProgressMessages.length} events</span>
                </div>
                <div className="p-4 max-h-48 overflow-y-auto space-y-1">
                  {launchProgressMessages.length === 0 ? (
                    <div className="text-gray-600 text-sm">Waiting for events...</div>
                  ) : (
                    launchProgressMessages.slice(-15).map((msg, idx) => {
                      // Filter to show only important messages
                      const isImportant = 
                        msg.message.includes('✅') || 
                        msg.message.includes('saved') ||
                        msg.message.includes('complete') ||
                        msg.message.includes('success') ||
                        msg.message.includes('Bundle') ||
                        msg.message.includes('Hop') ||
                        msg.message.includes('Transaction');
                      
                      if (!isImportant && launchProgressMessages.length > 10) return null;
                      
                      return (
                        <div key={idx} className="flex items-start gap-2 text-sm">
                          <span className="text-gray-600 text-xs font-mono w-8 flex-shrink-0">{String(idx + 1).padStart(2, '0')}</span>
                          <span className={`${
                            msg.message.includes('✅') || msg.message.includes('success') ? 'text-green-400' :
                            msg.message.includes('⚠') || msg.message.includes('Warning') ? 'text-yellow-400' :
                            msg.message.includes('❌') || msg.type === 'stderr' ? 'text-red-400' :
                            'text-gray-400'
                          }`}>
                            {msg.message.length > 80 ? msg.message.substring(0, 80) + '...' : msg.message}
                          </span>
                        </div>
                      );
                    }).filter(Boolean)
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Idle state - Waiting for launch */
            <div className="flex-1 flex flex-col items-center justify-center text-center py-20">
              <div className="w-20 h-20 rounded-2xl bg-gray-800 flex items-center justify-center mb-6 border border-gray-700">
                <RocketLaunchIcon className="w-10 h-10 text-gray-500" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Ready to Launch</h2>
              <p className="text-gray-400 mb-6 max-w-md">
                Go to the <span className="text-indigo-400 font-semibold">Launch</span> tab to create a token.
              </p>
              <div className="flex items-center gap-2 text-gray-500 text-sm bg-gray-900 px-4 py-2 rounded-full border border-gray-800">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                <span>Connected and waiting...</span>
              </div>
            </div>
          )}
        </div>
        )}
      </div>
    );
  }

  // Show beautiful launch progress UI when launching (no mint yet)
  if (isLaunching && !mintAddress) {
    return (
      <LaunchProgress 
        onComplete={() => {
          setIsLaunching(false);
          // Refresh data after launch completes
          fetchCurrentRun();
        }}
        tokenInfo={tokenInfo ? {
          name: tokenInfo.name || 'New Token',
          symbol: tokenInfo.symbol || 'TOKEN',
          image: tokenInfo.image
        } : null}
      />
    );
  }

  return (
    <div className="w-full h-full flex gap-3 relative">
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
        <div className="flex items-center gap-1">
          <button
            onClick={async () => {
              try {
                const res = await apiService.createWarmingWallet(['holder']);
                if (res.data.success && res.data.wallet) {
                  const walletAddress = res.data.wallet.address;
                  if (walletAddress) {
                    addTerminalMessage(`[ok] New wallet created and saved: ${walletAddress.slice(0, 8)}...`, 'success');
                    loadWallets();
                  } else {
                    addTerminalMessage(`[x] Wallet created but address missing`, 'error');
                  }
                } else {
                  addTerminalMessage(`[x] Failed to create wallet: ${res.data.error || 'Unknown error'}`, 'error');
                }
              } catch (error) {
                addTerminalMessage(`[x] Error: ${error.response?.data?.error || error.message}`, 'error');
              }
            }}
            className="px-2 py-1 bg-gradient-to-r from-green-600/80 to-green-700/80 hover:from-green-500/80 hover:to-green-600/80 text-white rounded transition-all border border-green-500/30 flex items-center gap-1 shadow-lg"
            title="Create a new holder wallet"
          >
            <PlusIcon className="w-3 h-3" />
            <span className="text-xs">Add Wallet</span>
          </button>
          <button
            onClick={loadWallets}
            className="px-2 py-1 bg-gradient-to-r from-gray-800/80 to-gray-900/80 hover:from-gray-700/80 hover:to-gray-800/80 text-white rounded transition-all border border-gray-700/50 flex items-center gap-1 shadow-lg"
          >
            <ArrowPathIcon className="w-3 h-3" />
            <span className="text-xs">Refresh</span>
          </button>
        </div>
      </div>


      {/* Compact Header Bar - Token + Priority Fee */}
      <div className="mb-2 flex flex-wrap items-center gap-2 p-2 bg-gray-800/30 rounded-lg border border-gray-700/30">
        {/* Token Mint - With Load Input */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <CubeIcon className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
          <span className="text-[10px] text-gray-400">Token:</span>
          {mintAddress ? (
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <span className="text-[10px] font-mono text-white truncate">{mintAddress}</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(mintAddress);
                  addTerminalMessage(' Token address copied!', 'success');
                }}
                className="p-0.5 hover:bg-gray-700/50 rounded transition-all"
                title="Copy address"
              >
                <svg className="w-3 h-3 text-gray-400 hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
              <a
                href={`https://pump.fun/${mintAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-0.5 hover:bg-gray-700/50 rounded transition-all"
                title="View on Pump.fun"
              >
                <svg className="w-3 h-3 text-gray-400 hover:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          ) : (
            <span className="text-[10px] text-gray-500 italic">No token loaded</span>
          )}
          {/* Load Token Button - Always visible */}
          <div className="relative group">
            <button
              className="px-1.5 py-0.5 text-[9px] font-bold bg-blue-600/30 hover:bg-blue-600/50 text-blue-400 rounded border border-blue-500/30 transition-all"
              title="Load any token to trade"
            >
              {mintAddress ? '↻ LOAD' : '+ LOAD'}
            </button>
            {/* Dropdown input */}
            <div className="absolute top-full left-0 mt-1 w-64 bg-gray-900 border border-gray-700 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 p-2">
              <p className="text-[9px] text-gray-400 mb-1">Paste token address:</p>
              <input
                type="text"
                placeholder="Token mint address..."
                className="w-full px-2 py-1 text-[10px] font-mono bg-gray-800 border border-gray-600 rounded focus:border-blue-500 focus:outline-none text-white placeholder-gray-500"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && e.target.value.trim()) {
                    e.stopPropagation();
                    const addr = e.target.value.trim();
                    if (addr.length > 30 && addr.length < 50) {
                      addTerminalMessage(` Loading token: ${addr.slice(0, 8)}...`, 'info');
                      setMintAddress(addr);
                      setLiveTrades([]); // Clear old trades
                      try {
                        await apiService.startTracking(addr);
                        addTerminalMessage(`[ok] Now tracking ${addr.slice(0, 8)}...`, 'success');
                      } catch (err) {
                        addTerminalMessage(`[!] Tracking started locally`, 'warning');
                      }
                      e.target.value = '';
                    } else {
                      addTerminalMessage('[x] Invalid token address', 'error');
                    }
                  }
                }}
                onPaste={async (e) => {
                  e.stopPropagation();
                  setTimeout(async () => {
                    const addr = e.target.value.trim();
                    if (addr.length > 30 && addr.length < 50) {
                      addTerminalMessage(` Loading token: ${addr.slice(0, 8)}...`, 'info');
                      setMintAddress(addr);
                      setLiveTrades([]);
                      try {
                        await apiService.startTracking(addr);
                        addTerminalMessage(`[ok] Now tracking ${addr.slice(0, 8)}...`, 'success');
                      } catch (err) {
                        addTerminalMessage(`[!] Tracking started locally`, 'warning');
                      }
                      e.target.value = '';
                    }
                  }, 100);
                }}
              />
              <p className="text-[8px] text-gray-500 mt-1">Press Enter or paste to load</p>
            </div>
          </div>
          {mintAddress && (
            <button
              onClick={() => {
                setMintAddress(null);
                setLiveTrades([]);
                addTerminalMessage(' Token cleared', 'info');
              }}
              className="p-0.5 hover:bg-red-500/20 rounded transition-all"
              title="Clear token"
            >
              <XCircleIcon className="w-3.5 h-3.5 text-gray-400 hover:text-red-400" />
            </button>
          )}
        </div>
        
        {/* Priority Fee - Inline */}
        <div className="flex items-center gap-1.5">
          <BoltIcon className="w-3.5 h-3.5 text-yellow-400" />
          <div className="flex gap-0.5">
            <button
              onClick={() => setPriorityFee('none')}
              className={`px-1.5 py-0.5 rounded text-[8px] font-bold transition-all ${
                priorityFee === 'none' ? 'bg-gray-600 text-white' : 'bg-gray-700/50 text-gray-400 hover:bg-gray-600/50'
              }`}
              title="~0.0002 SOL (Jito tip only)"
            >NONE</button>
            <button
              onClick={() => setPriorityFee('normal')}
              className={`px-1.5 py-0.5 rounded text-[8px] font-bold transition-all ${
                priorityFee === 'normal' ? 'bg-green-600 text-white' : 'bg-gray-700/50 text-gray-400 hover:bg-gray-600/50'
              }`}
              title="~0.00023-0.0003 SOL - Random variance (recommended)"
            >NORMAL</button>
            <button
              onClick={() => setPriorityFee('high')}
              className={`px-1.5 py-0.5 rounded text-[8px] font-bold transition-all ${
                priorityFee === 'high' ? 'bg-yellow-600 text-white' : 'bg-gray-700/50 text-gray-400 hover:bg-gray-600/50'
              }`}
              title="~0.0007 SOL - Very fast"
            >HIGH</button>
            <button
              onClick={() => setPriorityFee('ultra')}
              className={`px-1.5 py-0.5 rounded text-[8px] font-bold transition-all ${
                priorityFee === 'ultra' ? 'bg-red-600 text-white' : 'bg-gray-700/50 text-gray-400 hover:bg-gray-600/50'
              }`}
              title="~0.01 SOL - Maximum speed"
            >ULTRA</button>
          </div>
          <span className="text-[9px] text-gray-500">
            ~{priorityFee === 'none' ? '0.0002' :
              priorityFee === 'normal' ? '0.00025' :
              priorityFee === 'high' ? '0.0007' :
              '0.01'}
          </span>
        </div>
      </div>


      {/* Quick Actions - Organized with Labels & Tooltips */}
      <div className="mb-2 p-3 bg-gray-800/40 rounded-lg border border-gray-700/30">
        <div className="flex flex-wrap gap-3">
          
          {/* BATCH SELL Section - INSTANT PARALLEL SELLS */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1 mb-1">
              <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider"> Instant Sell</span>
              <div className="group relative">
                <QuestionMarkCircleIcon className="w-3.5 h-3.5 text-gray-500 cursor-help" />
                <div className="absolute bottom-full left-0 mb-1 hidden group-hover:block w-56 p-2 bg-gray-900 rounded-lg border border-gray-700 text-[10px] text-gray-300 z-50 shadow-xl">
                  <p className="font-bold text-red-400 mb-1"> INSTANT parallel sells (no delay!)</p>
                  <p><strong>SELL ALL:</strong> DEV + Bundle + Holder wallets</p>
                  <p><strong>Bundles:</strong> DEV + Bundle wallets only</p>
                  <p><strong>Holders:</strong> Holder wallets only</p>
                  <p className="mt-1 text-yellow-400">All wallets sell simultaneously!</p>
                </div>
              </div>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => handleBatchSell('all')}
                disabled={batchSellRunning.all}
                className="px-3 py-1.5 bg-gradient-to-br from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white text-xs font-bold rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 shadow-lg shadow-red-500/20"
              >
                {batchSellRunning.all ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <><BoltIcon className="w-4 h-4" /><span>SELL ALL</span></>}
              </button>
              <button
                onClick={() => handleBatchSell('bundles')}
                disabled={batchSellRunning.bundles}
                className="px-2 py-1.5 bg-gradient-to-br from-orange-600/80 to-orange-700/80 hover:from-orange-500/80 hover:to-orange-600/80 text-white text-[10px] font-semibold rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              >
                {batchSellRunning.bundles ? <ArrowPathIcon className="w-3 h-3 animate-spin" /> : <><CubeIcon className="w-3 h-3" /><span>Bundles</span></>}
              </button>
              <button
                onClick={() => handleBatchSell('holders')}
                disabled={batchSellRunning.holders}
                className="px-2 py-1.5 bg-gradient-to-br from-purple-600/80 to-purple-700/80 hover:from-purple-500/80 hover:to-purple-600/80 text-white text-[10px] font-semibold rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              >
                {batchSellRunning.holders ? <ArrowPathIcon className="w-3 h-3 animate-spin" /> : <><UserGroupIcon className="w-3 h-3" /><span>Holders</span></>}
              </button>
            </div>
          </div>

          <div className="w-px bg-gray-700/50 self-stretch"></div>

          {/* COLLECT SOL Section */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1 mb-1">
              <span className="text-[10px] font-bold text-green-400 uppercase tracking-wider">Collect SOL & Tokens</span>
              <div className="group relative">
                <QuestionMarkCircleIcon className="w-3.5 h-3.5 text-gray-500 cursor-help" />
                <div className="absolute bottom-full left-0 mb-1 hidden group-hover:block w-52 p-2 bg-gray-900 rounded-lg border border-gray-700 text-[10px] text-gray-300 z-50 shadow-xl">
                  <p className="font-bold text-green-400 mb-1">Gather SOL & Tokens back to funding wallet</p>
                  <p className="mb-1"><strong>⚠️ WARNING:</strong> This will TRANSFER all tokens and SOL from wallets to your funding wallet, breaking anonymity links!</p>
                  <p><strong>New:</strong> Only wallets created this run (safe for warmed)</p>
                  <p><strong>Run:</strong> All wallets from current run (incl. warmed)</p>
                  <p><strong>All:</strong> Every wallet ever created ([!] breaks anonymity)</p>
                </div>
              </div>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => handleMenuCommand('gather-new-only')}
                disabled={menuRunning['gather-new-only']}
                className="px-2 py-1.5 bg-gradient-to-br from-emerald-600/80 to-emerald-700/80 hover:from-emerald-500/80 hover:to-emerald-600/80 text-white text-[10px] font-semibold rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              >
                {menuRunning['gather-new-only'] ? <ArrowPathIcon className="w-3 h-3 animate-spin" /> : <><ArrowUpTrayIcon className="w-3 h-3" /><span>New</span></>}
              </button>
              <button
                onClick={() => handleMenuCommand('gather')}
                disabled={menuRunning['gather']}
                className="px-2 py-1.5 bg-gradient-to-br from-green-600/80 to-green-700/80 hover:from-green-500/80 hover:to-green-600/80 text-white text-[10px] font-semibold rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              >
                {menuRunning['gather'] ? <ArrowPathIcon className="w-3 h-3 animate-spin" /> : <><ArrowUpTrayIcon className="w-3 h-3" /><span>Run</span></>}
              </button>
              <button
                onClick={() => handleMenuCommand('gather-all')}
                disabled={menuRunning['gather-all']}
                className="px-2 py-1.5 bg-gradient-to-br from-green-500/80 to-green-600/80 hover:from-green-400/80 hover:to-green-500/80 text-white text-[10px] font-semibold rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              >
                {menuRunning['gather-all'] ? <ArrowPathIcon className="w-3 h-3 animate-spin" /> : <><ArrowUpTrayIcon className="w-3 h-3" /><span>All</span></>}
              </button>
            </div>
          </div>

          <div className="w-px bg-gray-700/50 self-stretch"></div>

          {/* UTILITIES Section */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1 mb-1">
              <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider">Utilities</span>
              <div className="group relative">
                <QuestionMarkCircleIcon className="w-3.5 h-3.5 text-gray-500 cursor-help" />
                <div className="absolute bottom-full left-0 mb-1 hidden group-hover:block w-48 p-2 bg-gray-900 rounded-lg border border-gray-700 text-[10px] text-gray-300 z-50 shadow-xl">
                  <p><strong>Fees:</strong> Collect pump.fun creator fees</p>
                  <p><strong>Send:</strong> Transfer SOL between wallets</p>
                  <p><strong>Status:</strong> Check bundle/tx status</p>
                </div>
              </div>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => handleMenuCommand('collect-fees')}
                disabled={menuRunning['collect-fees']}
                className="px-2 py-1.5 bg-gradient-to-br from-purple-600/80 to-purple-700/80 hover:from-purple-500/80 hover:to-purple-600/80 text-white text-[10px] font-semibold rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              >
                {menuRunning['collect-fees'] ? <ArrowPathIcon className="w-3 h-3 animate-spin" /> : <><BanknotesIcon className="w-3 h-3" /><span>Fees</span></>}
              </button>
              <button
                onClick={() => setShowTransferModal(true)}
                disabled={wallets.length === 0}
                className="px-2 py-1.5 bg-gradient-to-br from-cyan-600/80 to-cyan-700/80 hover:from-cyan-500/80 hover:to-cyan-600/80 text-white text-[10px] font-semibold rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              >
                <CurrencyDollarIcon className="w-3 h-3" /><span>Send</span>
              </button>
              <button
                onClick={() => handleMenuCommand('check-bundle')}
                disabled={menuRunning['check-bundle']}
                className="px-2 py-1.5 bg-gradient-to-br from-blue-600/80 to-blue-700/80 hover:from-blue-500/80 hover:to-blue-600/80 text-white text-[10px] font-semibold rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              >
                {menuRunning['check-bundle'] ? <ArrowPathIcon className="w-3 h-3 animate-spin" /> : <><MagnifyingGlassIcon className="w-3 h-3" /><span>Status</span></>}
              </button>
            </div>
          </div>

          <div className="w-px bg-gray-700/50 self-stretch"></div>

          {/* RECOVERY Section */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1 mb-1">
              <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">Recovery</span>
              <div className="group relative">
                <QuestionMarkCircleIcon className="w-3.5 h-3.5 text-gray-500 cursor-help" />
                <div className="absolute bottom-full right-0 mb-1 hidden group-hover:block w-56 p-2 bg-gray-900 rounded-lg border border-gray-700 text-[10px] text-gray-300 z-50 shadow-xl">
                  <p className="font-bold text-amber-400 mb-1">Fix failed launches</p>
                  <p><strong>Retry:</strong> Resubmit SAME bundle (same token). Use when Jito bundle didn't land.</p>
                  <p className="mt-1"><strong>Relaunch:</strong> Same wallets but NEW token address. Use when token is broken/rugged.</p>
                </div>
              </div>
            </div>
            <div className="flex gap-1">
              <button
                onClick={handleRetryBundle}
                disabled={menuRunning['retry-bundle'] || !mintAddress}
                className="px-2 py-1.5 bg-gradient-to-br from-orange-600/80 to-orange-700/80 hover:from-orange-500/80 hover:to-orange-600/80 text-white text-[10px] font-semibold rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              >
                {menuRunning['retry-bundle'] ? <ArrowPathIcon className="w-3 h-3 animate-spin" /> : <><ArrowPathIcon className="w-3 h-3" /><span>Retry</span></>}
              </button>
              <button
                onClick={async () => {
                  if (!confirm(' RELAUNCH with NEW token address?\n\nThis will:\n- Keep ALL your current wallets (already funded)\n- Generate a NEW pump.fun address\n- Resubmit the bundle with fresh token\n\nUse when token creation failed completely.')) {
                    return;
                  }
                  addTerminalMessage('Relaunching with same wallets, new token...', 'info');
                  try {
                    const res = await apiService.relaunchToken();
                    if (res.data.success) {
                      addTerminalMessage(`Relaunch started!`, 'success');
                      addTerminalMessage(`New mint: ${res.data.newMintAddress}`, 'success');
                      addTerminalMessage(`Wallets: ${res.data.walletCount.dev} DEV + ${res.data.walletCount.bundle} Bundle + ${res.data.walletCount.holder} Holder`, 'info');
                      setTimeout(() => loadWallets(), 3000);
                    } else {
                      addTerminalMessage(`Relaunch failed: ${res.data.error}`, 'error');
                    }
                  } catch (error) {
                    addTerminalMessage(`Error: ${error.response?.data?.error || error.message}`, 'error');
                  }
                }}
                className="px-2 py-1.5 bg-gradient-to-br from-amber-600/80 to-yellow-700/80 hover:from-amber-500/80 hover:to-yellow-600/80 text-white text-[10px] font-semibold rounded transition-all flex items-center gap-1"
              >
                <RocketLaunchIcon className="w-3 h-3" /><span>Relaunch</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Custom Confirmation Modal */}
      {confirmationModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gradient-to-br from-gray-900/95 via-gray-900/90 to-gray-950/95 backdrop-blur-xl rounded-xl p-6 border border-gray-700/50 shadow-2xl max-w-md w-full animate-in fade-in zoom-in duration-200">
            <div className="flex items-start gap-4 mb-4">
              {confirmationModal.type === 'danger' && (
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center border border-red-500/50">
                  <ShieldCheckIcon className="w-6 h-6 text-red-400" />
                </div>
              )}
              {confirmationModal.type === 'warning' && (
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-yellow-500/20 flex items-center justify-center border border-yellow-500/50">
                  <ExclamationTriangleIcon className="w-6 h-6 text-yellow-400" />
                </div>
              )}
              {confirmationModal.type === 'info' && (
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-cyan-500/20 flex items-center justify-center border border-cyan-500/50">
                  <InformationCircleIcon className="w-6 h-6 text-cyan-400" />
                </div>
              )}
              <div className="flex-1">
                <h3 className="text-lg font-bold text-white mb-2">
                  {confirmationModal.title}
                </h3>
                <div className="text-sm text-gray-300 whitespace-pre-line leading-relaxed">
                  {confirmationModal.message}
                </div>
              </div>
            </div>
            
            <div className="flex gap-3 mt-6">
              <button
                onClick={confirmationModal.onCancel}
                className="flex-1 px-4 py-2.5 bg-gray-800/60 hover:bg-gray-700/60 border border-gray-700/50 text-gray-300 hover:text-white font-semibold rounded-lg transition-all"
              >
                Cancel
              </button>
              <button
                onClick={confirmationModal.onConfirm}
                className={`flex-1 px-4 py-2.5 font-semibold rounded-lg transition-all ${
                  confirmationModal.type === 'danger'
                    ? 'bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white'
                    : confirmationModal.type === 'warning'
                    ? 'bg-gradient-to-r from-yellow-600 to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-white'
                    : 'bg-gradient-to-r from-cyan-600 to-cyan-700 hover:from-cyan-500 hover:to-cyan-600 text-white'
                }`}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transfer SOL Modal */}
      {showTransferModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gradient-to-br from-gray-900/95 via-gray-900/90 to-gray-950/95 backdrop-blur-xl rounded-xl p-6 border border-gray-700/50 shadow-2xl max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <CurrencyDollarIcon className="w-5 h-5 text-cyan-400" />
                Transfer SOL
              </h3>
              <button
                onClick={() => {
                  setShowTransferModal(false);
                  setTransferFrom('');
                  setTransferTo('');
                  setTransferAmount('');
                }}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <XCircleIcon className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">From Wallet</label>
                <select
                  value={transferFrom}
                  onChange={(e) => setTransferFrom(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800/60 border border-gray-700/50 rounded text-white text-sm focus:outline-none focus:border-cyan-500/50"
                >
                  <option value="">Select wallet...</option>
                  {wallets.map((wallet, idx) => (
                    <option key={idx} value={wallet.address}>
                      {wallet.type.toUpperCase()}: {wallet.address.slice(0, 8)}... ({wallet.solBalance?.toFixed(4) || '0'} SOL)
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="text-xs text-gray-400 mb-1 block">To Wallet</label>
                <select
                  value={transferTo}
                  onChange={(e) => setTransferTo(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800/60 border border-gray-700/50 rounded text-white text-sm focus:outline-none focus:border-cyan-500/50"
                >
                  <option value="">Select wallet...</option>
                  {wallets.map((wallet, idx) => (
                    <option key={idx} value={wallet.address}>
                      {wallet.type.toUpperCase()}: {wallet.address.slice(0, 8)}... ({wallet.solBalance?.toFixed(4) || '0'} SOL)
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Amount (SOL)</label>
                <input
                  type="number"
                  step="0.000001"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  placeholder="0.0"
                  className="w-full px-3 py-2 bg-gray-800/60 border border-gray-700/50 rounded text-white text-sm focus:outline-none focus:border-cyan-500/50"
                />
              </div>
              
              <button
                onClick={handleTransferSol}
                disabled={transferring || !transferFrom || !transferTo || !transferAmount}
                className="w-full px-4 py-2 bg-gradient-to-r from-cyan-600 to-cyan-700 hover:from-cyan-500 hover:to-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded transition-all"
              >
                {transferring ? 'Transferring...' : 'Transfer SOL'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Wallets Section - Organized: FUNDING first, then DEV, Bundle, Holder */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2">
        {wallets
          .sort((a, b) => {
            // FUNDING first (0), then DEV (1), then Bundle (2), then Holder (3)
            const order = { funding: 0, dev: 1, bundle: 2, holder: 3 };
            return (order[a.type] ?? 99) - (order[b.type] ?? 99);
          })
          .map((wallet, index) => {
            const styles = getWalletTypeStyles(wallet.type);
            const isFunding = wallet.type === 'funding';
            const isDev = wallet.type === 'dev';
            const isBundle = wallet.type === 'bundle';
            const isHolder = wallet.type === 'holder';
            const hasTokens = wallet.tokenBalance && wallet.tokenBalance > 0;
            
            // Check auto-buy status (from wallet object)
            const hasAutoBuy = wallet.hasAutoBuy || false;
            
            // Check auto-sell status (from autoSellConfig state)
            const walletAutoSellConfig = autoSellConfig[wallet.address?.toLowerCase()] || null;
            const hasAutoSell = walletAutoSellConfig && walletAutoSellConfig.enabled && walletAutoSellConfig.threshold > 0;
            const autoSellThreshold = walletAutoSellConfig?.threshold || null;
            
            return (
              <div
                key={index}
                className={`backdrop-blur-xl rounded-lg p-2 border-2 ${
                  isFunding
                    ? 'bg-gradient-to-br from-purple-900/40 via-pink-900/30 to-purple-900/40 border-purple-400/80 shadow-xl shadow-purple-500/30 ring-2 ring-purple-400/50' 
                    : isDev 
                    ? 'bg-gradient-to-br from-green-900/30 via-gray-900/70 to-gray-950/70 border-green-500/70 shadow-xl shadow-green-500/20 ring-2 ring-green-400/40' 
                    : isBundle 
                    ? 'bg-gradient-to-br from-purple-900/20 via-gray-900/70 to-gray-950/70 border-purple-500/50 shadow-lg' 
                    : 'bg-gradient-to-br from-blue-900/20 via-gray-900/70 to-gray-950/70 border-blue-500/50 shadow-lg ring-1 ring-blue-400/30'
                } hover:shadow-xl transition-all ${styles.hoverBorder}/70`}
              >
                {/* Wallet Header - Compact with % Supply */}
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1">
                    {wallet.type === 'funding' && <CurrencyDollarIcon className="w-3 h-3 text-purple-300" />}
                    {wallet.type === 'holder' && <UserGroupIcon className="w-3 h-3 text-blue-400" />}
                    {wallet.type === 'bundle' && <CubeIcon className="w-3 h-3 text-purple-400" />}
                    {wallet.type === 'dev' && <RocketLaunchIcon className="w-3 h-3 text-green-400" />}
                    <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${
                      isFunding 
                        ? 'bg-gradient-to-r from-purple-600 to-pink-600 shadow-lg shadow-purple-500/40' 
                        : isDev 
                        ? 'bg-gradient-to-r from-green-600 to-green-500 shadow-lg shadow-green-500/30' 
                        : styles.badgeColor
                    } text-white`}>
                      {isFunding ? ' FUNDING' : isDev ? '⭐ DEV' : styles.label}
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
                <p className="text-[10px] font-mono text-gray-300 mb-1 truncate">
                  {wallet.address.substring(0, 8)}...{wallet.address.substring(wallet.address.length - 8)}
                </p>
                
                {/* Auto-Buy / Auto-Sell Badges */}
                {(hasAutoBuy || hasAutoSell) && (
                  <div className="flex items-center gap-1 mb-1 flex-wrap">
                    {hasAutoBuy && (
                      <span 
                        className="px-1 py-0.5 text-[8px] font-bold rounded bg-gradient-to-r from-blue-500/80 to-blue-600/80 text-white border border-blue-400/50"
                        title="Auto-Buy Enabled"
                      >
                        🔵 AUTO-BUY
                      </span>
                    )}
                    {hasAutoSell && (
                      <span 
                        className="px-1 py-0.5 text-[8px] font-bold rounded bg-gradient-to-r from-orange-500/80 to-red-600/80 text-white border border-orange-400/50"
                        title={`Auto-Sell: ${autoSellThreshold} SOL threshold`}
                      >
                        🔴 AUTO-SELL {autoSellThreshold ? `(${autoSellThreshold.toFixed(2)} SOL)` : ''}
                      </span>
                    )}
                  </div>
                )}

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

                {/* Buy Buttons - SOL Amounts (6 buttons in 2 rows) */}
                <div className="mb-1.5">
                  <div className="flex items-center gap-1 mb-0.5">
                    <ArrowUpTrayIcon className="w-2.5 h-2.5 text-green-400" />
                    <p className="text-[9px] text-gray-400 font-semibold">Buy SOL</p>
                  </div>
                  <div className="grid grid-cols-3 gap-0.5 mb-0.5">
                    {[0.1, 0.2, 0.4].map((amount) => (
                      <button
                        key={amount}
                        onClick={() => handleQuickBuy(wallet, amount)}
                        disabled={loading[`${wallet.address}-buy-${amount}`] || wallet.solBalance < amount}
                        className="px-1 py-0.5 text-[9px] bg-gradient-to-br from-green-600/90 to-green-700/90 hover:from-green-500/90 hover:to-green-600/90 text-white rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed border border-green-500/30"
                        title={`${amount} SOL`}
                      >
                        {loading[`${wallet.address}-buy-${amount}`] ? <ArrowPathIcon className="w-2.5 h-2.5 animate-spin mx-auto" /> : amount}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-0.5 mb-1">
                    {[0.5, 0.7, 1.0].map((amount) => (
                      <button
                        key={amount}
                        onClick={() => handleQuickBuy(wallet, amount)}
                        disabled={loading[`${wallet.address}-buy-${amount}`] || wallet.solBalance < amount}
                        className="px-1 py-0.5 text-[9px] bg-gradient-to-br from-green-600/90 to-green-700/90 hover:from-green-500/90 hover:to-green-600/90 text-white rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed border border-green-500/30"
                        title={`${amount} SOL`}
                      >
                        {loading[`${wallet.address}-buy-${amount}`] ? <ArrowPathIcon className="w-2.5 h-2.5 animate-spin mx-auto" /> : amount}
                      </button>
                    ))}
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
                      onClick={() => handlePercentageBuy(wallet, 90)}
                      disabled={loading[`${wallet.address}-buy-percent-90`] || wallet.solBalance <= 0}
                      className="px-1 py-0.5 text-[9px] bg-gradient-to-br from-green-500/90 to-green-600/90 hover:from-green-400/90 hover:to-green-500/90 text-white rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed border border-green-500/30"
                      title="Buy 90% of SOL balance"
                    >
                      {loading[`${wallet.address}-buy-percent-90`] ? <ArrowPathIcon className="w-2.5 h-2.5 animate-spin mx-auto" /> : '90%'}
                    </button>
                  </div>
                  
                  {/* Manual Buy Input - Compact - Responsive */}
                  <div className="flex flex-wrap gap-0.5 sm:flex-nowrap">
                    <input
                      type="number"
                      step="0.001"
                      value={manualInputs[`${wallet.address}-buy-manual`] || ''}
                      onChange={(e) => setManualInputs({ ...manualInputs, [`${wallet.address}-buy-manual`]: e.target.value })}
                      placeholder="SOL"
                      className="flex-1 min-w-0 px-1 py-0.5 text-[9px] bg-gray-800/50 border border-gray-700/50 rounded text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-green-500/50 focus:border-green-500/50"
                    />
                    <button
                      onClick={() => handleManualBuy(wallet)}
                      disabled={loading[`${wallet.address}-buy-manual`] || !manualInputs[`${wallet.address}-buy-manual`]}
                      className="px-2 py-0.5 min-w-[50px] text-[9px] bg-gradient-to-br from-green-600/90 to-green-700/90 hover:from-green-500/90 hover:to-green-600/90 text-white rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed border border-green-500/30 flex-shrink-0"
                    >
                      {loading[`${wallet.address}-buy-manual`] ? <ArrowPathIcon className="w-2.5 h-2.5 animate-spin mx-auto" /> : 'Buy'}
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
                  
                  {/* Manual Sell Input - Compact - Responsive */}
                  <div className="flex flex-wrap gap-0.5 sm:flex-nowrap">
                    <input
                      type="text"
                      value={manualInputs[`${wallet.address}-sell-manual`] || ''}
                      onChange={(e) => setManualInputs({ ...manualInputs, [`${wallet.address}-sell-manual`]: e.target.value })}
                      placeholder="%"
                      className="flex-1 min-w-0 px-1 py-0.5 text-[9px] bg-gray-800/50 border border-gray-700/50 rounded text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-red-500/50 focus:border-red-500/50"
                    />
                    <button
                      onClick={() => handleManualSell(wallet)}
                      disabled={loading[`${wallet.address}-sell-manual`] || !manualInputs[`${wallet.address}-sell-manual`]}
                      className="px-2 py-0.5 min-w-[50px] text-[9px] bg-gradient-to-br from-red-600/90 to-red-700/90 hover:from-red-500/90 hover:to-red-600/90 text-white rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed border border-red-500/30 flex-shrink-0"
                    >
                      {loading[`${wallet.address}-sell-manual`] ? <ArrowPathIcon className="w-2.5 h-2.5 animate-spin mx-auto" /> : 'Sell'}
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
            {launchProgressMessages.length > 0 && (
              <span className="text-[8px] text-green-400 ml-1">● Live Launch</span>
            )}
          </div>
          <button
            onClick={() => {
              setTerminalMessages([]);
              setLaunchProgressMessages([]);
            }}
            className="px-1.5 py-0.5 text-[8px] bg-gray-800/50 hover:bg-gray-700/50 text-white rounded transition-all flex items-center gap-0.5 border border-gray-700/50"
          >
            <TrashIcon className="w-2.5 h-2.5" />
            <span>Clear</span>
          </button>
        </div>
        <div ref={terminalRef} className="p-1.5 h-32 overflow-y-auto font-mono text-[9px] bg-black/30">
          {terminalMessages.length === 0 && launchProgressMessages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-600">
              <InformationCircleIcon className="w-3 h-3 mr-1" />
              <p className="text-[9px]">No messages yet...</p>
            </div>
          ) : (
            <>
              {/* Launch progress messages (if any) */}
              {launchProgressMessages.map((msg, idx) => (
                <div
                  key={`launch-${idx}`}
                  className={`mb-0.5 flex items-start gap-1 ${
                    msg.type === 'stderr' ? 'text-red-400' :
                    msg.message.toLowerCase().includes('error') || msg.message.toLowerCase().includes('failed') ? 'text-red-400' :
                    msg.message.toLowerCase().includes('success') || msg.message.toLowerCase().includes('complete') ? 'text-green-400' :
                    'text-cyan-400'
                  }`}
                >
                  <span className="text-gray-600 shrink-0 text-[8px]">[{new Date(msg.timestamp).toLocaleTimeString()}]</span>
                  <span className="flex-1 text-[9px]">{msg.message}</span>
                </div>
              ))}
              {/* Regular terminal messages */}
              {terminalMessages.map((msg, idx) => (
                <div
                  key={`term-${idx}`}
                  className={`mb-0.5 flex items-start gap-1 ${
                    msg.type === 'success' ? 'text-green-400' :
                    msg.type === 'error' ? 'text-red-400' :
                    'text-gray-300'
                  }`}
                >
                  <span className="text-gray-600 shrink-0 text-[8px]">[{msg.timestamp}]</span>
                  <span className="flex-1 text-[9px]">{msg.message}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
      </div>

      {/* Token Info & Chart Section - Right */}
      {mintAddress && (
        <div className="w-1/2 bg-gradient-to-br from-gray-900/90 via-gray-900/80 to-gray-950/90 backdrop-blur-xl rounded-xl border border-gray-800/50 shadow-2xl overflow-hidden flex flex-col">
          {/* Token Header - Compact */}
          <div className="px-2 py-1.5 bg-gradient-to-r from-gray-900/80 to-gray-800/80 border-b border-gray-700/50">
            {tokenInfo ? (
              <div className="flex items-center justify-between gap-2">
                {/* Left: Token Info */}
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {/* Token Icon - Smaller */}
                  <div className="relative shrink-0">
                    {tokenInfo.logoURI ? (
                      <img src={tokenInfo.logoURI} alt={tokenInfo.symbol} className="w-6 h-6 rounded" />
                    ) : (
                      <div className="w-6 h-6 rounded bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center border border-green-500/50">
                        <span className="text-white font-bold text-[10px]">{tokenInfo.symbol?.[0] || '?'}</span>
                      </div>
                    )}
                    <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full border border-gray-900"></div>
                  </div>
                  
                  {/* Token Name & Address - Compact */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-xs font-bold text-white truncate">{tokenInfo.symbol || 'UNKNOWN'}</h3>
                      <span className="text-[9px] text-gray-400 truncate hidden sm:inline">{tokenInfo.name || 'Unknown'}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-[8px] text-gray-500 font-mono">{mintAddress.slice(0, 4)}...{mintAddress.slice(-4)}</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(mintAddress);
                          addTerminalMessage('Token address copied!', 'success');
                        }}
                        className="text-gray-500 hover:text-gray-300 shrink-0"
                        title="Copy address"
                      >
                        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
                
                {/* Right: Metrics - Compact Grid */}
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <div className="text-[10px] font-bold text-white">
                      ${tokenInfo.price < 0.0001 
                        ? tokenInfo.price.toExponential(1) 
                        : tokenInfo.price.toFixed(6)}
                    </div>
                    <div className="text-[7px] text-gray-400">Price</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-bold text-white">
                      ${tokenInfo.marketCap >= 1000 
                        ? `${(tokenInfo.marketCap / 1000).toFixed(1)}K` 
                        : tokenInfo.marketCap.toFixed(0)}
                    </div>
                    <div className="text-[7px] text-gray-400">MC</div>
                  </div>
                  <div className="text-right">
                    <div className={`text-[10px] font-bold ${tokenInfo.priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {tokenInfo.priceChange24h >= 0 ? '+' : ''}{tokenInfo.priceChange24h?.toFixed(1) || '0.0'}%
                    </div>
                    <div className="text-[7px] text-gray-400">24h</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-bold text-white">
                      ${tokenInfo.liquidity >= 1000 
                        ? `${(tokenInfo.liquidity / 1000).toFixed(1)}K` 
                        : tokenInfo.liquidity.toFixed(0)}
                    </div>
                    <div className="text-[7px] text-gray-400">Liq</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-gray-800 animate-pulse"></div>
                <div className="flex-1">
                  <div className="h-3 w-24 bg-gray-800 rounded animate-pulse"></div>
                  <div className="h-2 w-16 bg-gray-800 rounded animate-pulse mt-1"></div>
                </div>
              </div>
            )}
          </div>
          
          {/* Chart Section - Birdeye Only */}
          <div className="flex-1 min-h-[200px] border-b border-gray-700/50 flex flex-col">
            <div className="flex items-center justify-between px-2 py-1 bg-gray-900/50 border-b border-gray-700/30">
              <span className="text-[10px] text-gray-400">Price Chart (Birdeye)</span>
            </div>
            
            {/* Chart Content */}
            <div className="flex-1 min-h-[180px]">
              <iframe
                src={`https://birdeye.so/tv-widget/${mintAddress}?chain=solana&viewMode=pair&chartInterval=1&chartType=CANDLE&chartTimezone=America%2FLos_Angeles&chartLeftToolbar=show&theme=dark`}
                className="w-full h-full border-0"
                frameBorder="0"
                allow="clipboard-write"
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                title="Birdeye Chart (Live - 1s interval)"
                onLoad={() => console.log("[HolderWallets] Birdeye chart loaded")}
                onError={(e) => console.error("[HolderWallets] Birdeye chart failed:", e)}
              />
            </div>
          </div>
          
          {/* Combined Stats Bar - External Volume, Our P&L, Live Trades */}
          <div className="flex-1 flex flex-col min-h-0 border-t border-gray-700/50">
            <div className="p-2 bg-gradient-to-r from-gray-900/90 to-gray-800/90 border-b border-gray-700/50">
              <div className="flex items-center justify-between flex-wrap gap-2">
                {/* Left: Live Trades title + controls */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <ArrowPathIcon className="w-3 h-3 text-green-400" />
                    <span className="text-xs font-bold text-white">Live Trades</span>
                  </div>
                  {liveTradesError && (
                    <span className="px-2 py-0.5 text-[9px] bg-red-900/40 text-red-300 rounded border border-red-500/30">
                      {liveTradesError.includes('API server')
                        ? 'API server / .env missing'
                        : 'Live error'}
                    </span>
                  )}
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hideMyWallets}
                      onChange={(e) => setHideMyWallets(e.target.checked)}
                      className="w-3 h-3 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
                    />
                    <span className="text-[9px] text-gray-400">Hide Ours</span>
                  </label>
                  <span className="text-[9px] text-gray-500">{liveTrades.length} trades</span>
                  {autoSellEnabled && (
                    <span className="px-1.5 py-0.5 text-[9px] bg-green-500/20 text-green-400 rounded border border-green-500/30 flex items-center gap-1">
                      <BoltIcon className="w-2.5 h-2.5" />
                      Auto-Sell
                    </span>
                  )}
                </div>

                {liveTradesError && (
                  <div className="w-full mt-2 text-[10px] text-red-300">
                    {liveTradesError}
                    {liveTradesError.toLowerCase().includes('.env') || liveTradesError.toLowerCase().includes('private_key') || liveTradesError.toLowerCase().includes('rpc')
                      ? ' (Create `.env` from `.env.example`, set `RPC_ENDPOINT` + `PRIVATE_KEY`, then restart the API server.)'
                      : ''}
                  </div>
                )}
                
                {/* Right: Stats */}
                <div className="flex items-center gap-4">
                  {/* External Volume */}
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-yellow-400 font-medium">External:</span>
                    <span className="text-[10px] text-green-400">+{externalVolume.buys.toFixed(2)}</span>
                    <span className="text-[10px] text-red-400">-{externalVolume.sells.toFixed(2)}</span>
                    <span className={`text-[10px] font-bold ${externalVolume.net >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      = {externalVolume.net >= 0 ? '+' : ''}{externalVolume.net.toFixed(2)}
                    </span>
                  </div>
                  
                  {/* Separator */}
                  <div className="w-px h-4 bg-gray-600"></div>
                  
                  {/* Our P&L */}
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-purple-400 font-medium"> Ours:</span>
                    <span className="text-[10px] text-red-400">-{ourProfits.buys.toFixed(2)}</span>
                    <span className="text-[10px] text-green-400">+{ourProfits.sells.toFixed(2)}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      ourProfits.profit > 0 
                        ? 'bg-green-500/20 text-green-400' 
                        : ourProfits.profit < 0 
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-gray-500/20 text-gray-400'
                    }`}>
                      P&L: {ourProfits.profit >= 0 ? '+' : ''}{ourProfits.profit.toFixed(3)} SOL
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-gray-900/90 z-10">
                  <tr className="border-b border-gray-700/50">
                    <th className="text-left p-1.5 text-gray-400 font-semibold">Type</th>
                    <th className="text-right p-1.5 text-gray-400 font-semibold">SOL</th>
                    <th className="text-right p-1.5 text-gray-400 font-semibold">USD</th>
                    <th className="text-right p-1.5 text-gray-400 font-semibold">MC</th>
                    <th className="text-right p-1.5 text-gray-400 font-semibold">Tokens</th>
                    <th className="text-left p-1.5 text-gray-400 font-semibold">Trader</th>
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
                          <td colSpan="7" className="text-center py-4 text-gray-500 text-[11px]">
                            {hideMyWallets ? 'No external trades yet...' : 'Waiting for trades...'}
                          </td>
                        </tr>
                      );
                    }
                    
                    return filteredTrades.map((trade, idx) => {
                      // Calculate USD value (SOL price ~$150)
                      const solPrice = 150; // Approximate SOL price
                      const usdValue = trade.solAmount * solPrice;
                      
                      // Format market cap: show as "5.6K" with proper formatting
                      const marketCapUsd = trade.marketCap || 0;
                      const marketCapDisplay = marketCapUsd >= 1000 
                        ? `$${(marketCapUsd / 1000).toFixed(1)}K` 
                        : marketCapUsd > 0 
                          ? `$${marketCapUsd.toFixed(0)}`
                          : '-';
                      
                      // Format token amount (handle missing data)
                      const tokenAmount = trade.amount || trade.tokenAmount || 0;
                      const tokenDisplay = tokenAmount > 0 
                        ? `${(tokenAmount / 1000000).toFixed(1)}M`
                        : '-';
                      
                      return (
                        <tr key={idx} className={`border-b border-gray-800/30 hover:bg-gray-800/30 ${trade.type === 'buy' ? 'bg-green-900/10' : 'bg-red-900/10'} ${
                          trade.walletType === 'FUNDING' ? 'ring-1 ring-yellow-500/50 bg-yellow-900/10' :
                          trade.walletType === 'DEV' ? 'ring-1 ring-orange-500/50 bg-orange-900/10' :
                          trade.walletType === 'Bundle' ? 'ring-1 ring-purple-500/50 bg-purple-900/10' :
                          trade.walletType === 'Holder' ? 'ring-1 ring-cyan-500/50 bg-cyan-900/10' :
                          trade.isOurWallet ? 'ring-1 ring-blue-500/50' : ''
                        }`}>
                          {/* Type - Most important, first */}
                          <td className={`p-1.5 font-bold text-[12px] ${trade.type === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                            {trade.type === 'buy' ? ' Buy' : ' Sell'}
                          </td>
                          {/* SOL amount - Right after type */}
                          <td className={`p-1.5 text-right font-bold ${trade.type === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                            {trade.solAmount?.toFixed(4) || '0.0000'}
                          </td>
                          {/* USD value */}
                          <td className={`p-1.5 text-right ${trade.type === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                            ${usdValue.toFixed(2)}
                          </td>
                          {/* Market Cap */}
                          <td className="p-1.5 text-right text-gray-300">{marketCapDisplay}</td>
                          {/* Tokens */}
                          <td className="p-1.5 text-right text-gray-400">{tokenDisplay}</td>
                          {/* Trader with wallet icon and P&L - Last (far right) */}
                          <td className={`p-1.5 font-mono ${trade.isOurWallet ? 'font-bold' : 'text-gray-400'}`}>
                            {trade.isOurWallet ? (
                              <span className="inline-flex items-center gap-1">
                                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  trade.walletType === 'FUNDING' ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40' :
                                  trade.walletType === 'DEV' ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40' :
                                  trade.walletType === 'Bundle' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40' :
                                  trade.walletType === 'Holder' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' :
                                  'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                                }`}>
                                  <span className="text-[12px]">
                                    {trade.walletType === 'FUNDING' && ''}
                                    {trade.walletType === 'DEV' && '‍'}
                                    {trade.walletType === 'Bundle' && ''}
                                    {trade.walletType === 'Holder' && ''}
                                    {!['FUNDING', 'DEV', 'Bundle', 'Holder'].includes(trade.walletType) && '⭐'}
                                  </span>
                                  <span>{trade.walletLabel || trade.walletType || 'OURS'}</span>
                                </span>
                                {/* Show P&L for our wallets */}
                                {trade.walletProfit !== null && trade.walletProfit !== undefined && (
                                  <span className={`text-[9px] px-1 py-0.5 rounded ${
                                    trade.walletProfit >= 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                                  }`}>
                                    {trade.walletProfit >= 0 ? '+' : ''}{trade.walletProfit.toFixed(3)}
                                  </span>
                                )}
                                <a 
                                  href={`https://solscan.io/account/${trade.fullTrader}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-gray-400 ml-1 hover:text-blue-400 hover:underline cursor-pointer text-[10px]"
                                  onClick={(e) => e.stopPropagation()}
                                  title={`View ${trade.fullTrader} on Solscan`}
                                >
                                  {trade.trader}
                                </a>
                              </span>
                            ) : (
                              <a 
                                href={`https://solscan.io/account/${trade.fullTrader}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-gray-400 hover:text-blue-400 hover:underline cursor-pointer"
                                onClick={(e) => e.stopPropagation()}
                                title={`View ${trade.fullTrader} on Solscan`}
                              >
                                {trade.trader}
                              </a>
                            )}
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

