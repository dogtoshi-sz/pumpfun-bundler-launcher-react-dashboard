import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './App.css';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

function SinglePageProfit() {
  // Status and loading
  const [status, setStatus] = useState({ walletCount: 0, mintAddress: null, hasWallets: false });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [nextPumpAddress, setNextPumpAddress] = useState(null);
  const [devWalletAddress, setDevWalletAddress] = useState(null);
  const [additionalWallets, setAdditionalWallets] = useState([]);
  
  // Token form state
  const [tokenForm, setTokenForm] = useState({
    tokenName: '',
    tokenSymbol: '',
    description: '',
    showName: '',
    twitter: '',
    telegram: '',
    website: '',
    distributionWalletNum: 10,
    swapAmount: 0.3,
    swapAmounts: '',
    vanityMode: false,
    lilJitMode: false
  });
  
  const [walletBuyAmounts, setWalletBuyAmounts] = useState([0.1, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3]);
  const [walletCountInput, setWalletCountInput] = useState('10');
  const [imagePreview, setImagePreview] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [launchInProgress, setLaunchInProgress] = useState(false);
  const [autoRapidSell, setAutoRapidSell] = useState(true);
  const [autoSell50Percent, setAutoSell50Percent] = useState(false);
  const [autoGather, setAutoGather] = useState(false);
  const [autoCollectFees, setAutoCollectFees] = useState(false);
  const [userEditingWalletCount, setUserEditingWalletCount] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const userHasChangedWalletCount = useRef(false); // Track if user has manually changed wallet count
  
  // Wallet status for profit dashboard
  const [walletStatus, setWalletStatus] = useState([]);
  const [profitMetrics, setProfitMetrics] = useState({
    totalInvested: 0,
    currentValue: 0,
    profit: 0,
    profitPercent: 0,
    walletsSold: 0,
    walletsHolding: 0
  });
  
  // Trade tracking (buys/sells from Birdeye)
  const [trades, setTrades] = useState([]);
  const [ourWalletAddresses, setOurWalletAddresses] = useState(new Set());
  const [autoSellOnExternalBuy, setAutoSellOnExternalBuy] = useState(false);
  const [externalBuyThreshold, setExternalBuyThreshold] = useState(0.1); // SOL threshold
  const [websocketTracking, setWebsocketTracking] = useState(false); // Real-time WebSocket tracking
  const [realtimeTransactions, setRealtimeTransactions] = useState([]); // Real-time transaction stream
  const [sseConnected, setSseConnected] = useState(false); // SSE connection status
  
  // Test mode: Manual mint address input
  const [testMintAddress, setTestMintAddress] = useState('');
  const [useTestMint, setUseTestMint] = useState(false);

  // Load next pump address early
  useEffect(() => {
    // Small delay to ensure API server is ready
    const timer = setTimeout(() => {
      loadNextPumpAddress();
      loadDevWalletAddress();
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  const loadNextPumpAddress = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/next-pump-address`);
      console.log('Next pump address response:', res.data);
      if (res.data.success) {
        setNextPumpAddress(res.data.publicKey);
      } else {
        console.warn('No pump address available:', res.data.message);
      }
    } catch (error) {
      console.error('Error loading next pump address:', error);
      console.error('Error details:', error.response?.data);
    }
  };

  const loadDevWalletAddress = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/dev-wallet-address`);
      if (res.data.success) {
        setDevWalletAddress(res.data.address);
      } else {
        console.warn('Dev wallet not configured:', res.data.error);
      }
    } catch (error) {
      console.error('Error loading dev wallet address:', error);
    }
  };

  // Load config ONCE on mount - then use local state only (no more .env syncing!)
  useEffect(() => {
    loadInitialConfig();
  }, []);

  // Load initial config from .env ONCE, then use local state forever
  const loadInitialConfig = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/status`);
      
      // Update status (mint address, wallet count from data.json)
      setStatus({
        walletCount: res.data.walletCount || 0,
        mintAddress: res.data.mintAddress || null,
        hasWallets: res.data.hasWallets || false
      });
      
      // Load config from .env ONCE only
      if (res.data.config && !configLoaded) {
        const config = res.data.config;
        setTokenForm(prev => ({
          ...prev,
          tokenName: config.tokenName || prev.tokenName,
          tokenSymbol: config.tokenSymbol || prev.tokenSymbol,
          description: config.description || prev.description,
          showName: config.showName || prev.showName,
          twitter: config.twitter || prev.twitter,
          telegram: config.telegram || prev.telegram,
          website: config.website || prev.website,
          distributionWalletNum: config.distributionWalletNum || prev.distributionWalletNum,
          swapAmount: config.swapAmount || prev.swapAmount,
          vanityMode: config.vanityMode === true || config.vanityMode === 'true',
          lilJitMode: config.lilJitMode === true || config.lilJitMode === 'true'
        }));
        setWalletCountInput(String(config.distributionWalletNum || 10));
        
        // Initialize wallet amounts from config if available
        if (config.swapAmounts) {
          const amounts = config.swapAmounts.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
          if (amounts.length > 0) {
            const devBuy = config.buyerAmount || 0.1;
            setWalletBuyAmounts([devBuy, ...amounts]);
          }
        }
        
        setAutoRapidSell(config.autoRapidSell === true || config.autoRapidSell === 'true');
        setAutoSell50Percent(config.autoSell50Percent === true || config.autoSell50Percent === 'true');
        setAutoGather(config.autoGather === true || config.autoGather === 'true');
        setAutoCollectFees(config.autoCollectFees === true || config.autoCollectFees === 'true');
        
        setConfigLoaded(true);
        console.log('✅ Initial config loaded from .env - now using LOCAL STATE ONLY (no more syncing!)');
      }
    } catch (error) {
      console.error('Error loading initial config:', error);
    }
  };

  // Get current mint address (from status or test mode)
  const getCurrentMintAddress = () => {
    if (useTestMint && testMintAddress) {
      return testMintAddress;
    }
    return status.mintAddress;
  };
  
  // Load status - ONLY for mint address and wallet count from data.json
  // NO LONGER updates config from .env - we use local state only
  const loadStatus = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/status`);
      // Only update status (mint address, wallet count from data.json)
      // DO NOT update config - we use local state only
      setStatus({
        walletCount: res.data.walletCount || 0,
        mintAddress: res.data.mintAddress || null,
        hasWallets: res.data.hasWallets || false
      });
    } catch (error) {
      console.error('Error loading status:', error);
    }
  };

  // Poll for status updates (mint address changes) but NOT config
  useEffect(() => {
    const interval = setInterval(loadStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // Fetch wallet status when mint address exists
  useEffect(() => {
    if (status.mintAddress) {
      fetchWalletStatus();
      const interval = setInterval(fetchWalletStatus, 2000);
      return () => clearInterval(interval);
    }
  }, [status.mintAddress]);
  
  // Update our wallet addresses when wallet status changes
  useEffect(() => {
    const addresses = new Set();
    walletStatus.forEach(wallet => {
      if (wallet.address) {
        addresses.add(wallet.address.toLowerCase());
      }
    });
    if (devWalletAddress) {
      addresses.add(devWalletAddress.toLowerCase());
    }
    setOurWalletAddresses(addresses);
    
    // Update WebSocket tracker with new wallet addresses if tracking is active
    const mintAddress = getCurrentMintAddress();
    if (mintAddress && websocketTracking && addresses.size > 0) {
      const walletArray = Array.from(addresses);
      axios.post(`${API_BASE}/api/websocket/start-tracking`, {
        mintAddress: mintAddress,
        ourWallets: walletArray,
        autoSell: autoSellOnExternalBuy,
        threshold: externalBuyThreshold
      }).catch(err => console.error('Error updating WebSocket tracking:', err));
    }
  }, [walletStatus, devWalletAddress]);
  
  // Start/stop WebSocket tracking when mint address or settings change
  useEffect(() => {
    const mintAddress = getCurrentMintAddress();
    if (!mintAddress) {
      // Stop tracking if no mint address
      if (websocketTracking) {
        axios.post(`${API_BASE}/api/websocket/stop-tracking`).catch(() => {});
        setWebsocketTracking(false);
      }
      return;
    }
    
    // Start WebSocket tracking if enabled and we have wallet addresses
    if (websocketTracking && ourWalletAddresses.size > 0) {
      const walletArray = Array.from(ourWalletAddresses);
      axios.post(`${API_BASE}/api/websocket/start-tracking`, {
        mintAddress: mintAddress,
        ourWallets: walletArray,
        autoSell: autoSellOnExternalBuy,
        threshold: externalBuyThreshold
      }).then(() => {
        console.log('✅ WebSocket tracking started for real-time buy/sell detection (0 latency)');
      }).catch(err => {
        console.error('Error starting WebSocket tracking:', err);
      });
    } else if (!websocketTracking) {
      // Stop tracking if disabled
      axios.post(`${API_BASE}/api/websocket/stop-tracking`).catch(() => {});
    }
    
    // Cleanup on unmount or mint change
    return () => {
      if (websocketTracking) {
        axios.post(`${API_BASE}/api/websocket/stop-tracking`).catch(() => {});
      }
    };
  }, [getCurrentMintAddress(), websocketTracking, ourWalletAddresses.size, autoSellOnExternalBuy, externalBuyThreshold]);
  
  // Poll for trades when mint address exists (from status or test mode)
  useEffect(() => {
    const mintAddress = getCurrentMintAddress();
    if (!mintAddress) return;
    
    const fetchTradesInterval = async () => {
      try {
        const res = await axios.get(`${API_BASE}/api/birdeye-transactions`, {
          params: {
            tokenAddress: mintAddress,
            limit: 50,
            offset: 0
          }
        });
        
        if (res.data.success && res.data.trades) {
          // Mark which trades are from our wallets
          const addresses = new Set();
          walletStatus.forEach(wallet => {
            if (wallet.address) addresses.add(wallet.address.toLowerCase());
          });
          if (devWalletAddress) addresses.add(devWalletAddress.toLowerCase());
          
          const tradesWithOwnership = res.data.trades.map(trade => ({
            ...trade,
            isOurWallet: trade.from ? addresses.has(trade.from.toLowerCase()) : false
          }));
          
          setTrades(tradesWithOwnership);
          
          // Check for external buys and trigger auto-sell if enabled
          if (autoSellOnExternalBuy) {
            const recentExternalBuys = tradesWithOwnership.filter(trade => 
              trade.type === 'buy' && 
              !trade.isOurWallet && 
              parseFloat(trade.amountUsd || '0') >= externalBuyThreshold &&
              Date.now() - trade.timestamp < 30000 // Within last 30 seconds
            );
            
            if (recentExternalBuys.length > 0) {
              console.log('🚨 External buy detected!', recentExternalBuys[0]);
              showMessage('success', `External buy detected: ${parseFloat(recentExternalBuys[0].amountUsd).toFixed(2)} SOL - Auto selling...`);
              // Trigger auto-sell - call the function directly
              const quickSellRes = await axios.post(`${API_BASE}/api/rapid-sell-all`);
              if (quickSellRes.data.success) {
                showMessage('success', 'Auto-sold on external buy!');
              }
            }
          }
        }
      } catch (error) {
        console.error('Error fetching trades:', error);
      }
    };
    
    fetchTradesInterval();
    const interval = setInterval(fetchTradesInterval, 2000); // Poll every 2 seconds
    return () => clearInterval(interval);
  }, [status.mintAddress, walletStatus, devWalletAddress, autoSellOnExternalBuy, externalBuyThreshold]);

  const fetchWalletStatus = async () => {
    const mintAddress = getCurrentMintAddress();
    if (!mintAddress) return;
    try {
      const res = await axios.get(`${API_BASE}/api/wallet-status`, {
        params: { mintAddress: mintAddress }
      });
      if (res.data.success) {
        setWalletStatus(res.data.wallets);
        calculateProfitMetrics(res.data.wallets);
      }
    } catch (error) {
      console.error('Error fetching wallet status:', error);
    }
  };

  const calculateProfitMetrics = (wallets) => {
    let totalInvested = 0;
    let currentValue = 0;
    let walletsSold = 0;
    let walletsHolding = 0;

    wallets.forEach(wallet => {
      totalInvested += wallet.invested || 0;
      currentValue += wallet.currentValue || 0;
      if (wallet.sold) {
        walletsSold++;
      } else {
        walletsHolding++;
      }
    });

    const profit = currentValue - totalInvested;
    const profitPercent = totalInvested > 0 ? (profit / totalInvested) * 100 : 0;

    setProfitMetrics({
      totalInvested,
      currentValue,
      profit,
      profitPercent,
      walletsSold,
      walletsHolding
    });
  };

  const showMessage = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage({ type: '', text: '' }), 5000);
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const uploadImage = async () => {
    if (!imageFile) {
      showMessage('error', 'Please select an image first');
      return;
    }
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('image', imageFile);
      await axios.post(`${API_BASE}/api/upload-image`, formData);
      showMessage('success', 'Image uploaded successfully!');
    } catch (error) {
      showMessage('error', error.response?.data?.error || 'Failed to upload image');
    } finally {
      setLoading(false);
    }
  };

  const generateWithAI = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/api/ai-generate`, { prompt: aiPrompt });
      const responseData = res.data;
      // API returns { success: true, data: tokenInfo }
      const tokenInfo = responseData.data || responseData;
      setTokenForm(prev => ({
        ...prev,
        tokenName: tokenInfo.tokenName || prev.tokenName,
        tokenSymbol: tokenInfo.tokenSymbol || prev.tokenSymbol,
        description: tokenInfo.description || prev.description,
        showName: tokenInfo.showName || prev.showName,
        twitter: tokenInfo.twitter || prev.twitter,
        telegram: tokenInfo.telegram || prev.telegram,
        website: tokenInfo.website || prev.website
      }));
      showMessage('success', 'AI generated token info!');
    } catch (error) {
      console.error('AI generation error:', error);
      showMessage('error', error.response?.data?.error || error.message || 'AI generation failed');
    } finally {
      setAiLoading(false);
    }
  };

  const clearOldData = async () => {
    try {
      // Clear on server side
      await axios.post(`${API_BASE}/api/clear-token-data`);
      
      // Clear local state
      setStatus(prev => ({ ...prev, mintAddress: null, hasWallets: false }));
      setWalletStatus([]);
      setProfitMetrics({
        totalInvested: 0,
        currentValue: 0,
        profit: 0,
        profitPercent: 0,
        walletsSold: 0,
        walletsHolding: 0
      });
      
      // Reload status to get fresh state
      setTimeout(() => {
        loadStatus();
      }, 500);
      
      showMessage('success', 'Old token data cleared');
    } catch (error) {
      console.error('Error clearing token data:', error);
      showMessage('error', 'Failed to clear token data');
    }
  };

  const launchToken = async () => {
    if (!imageFile) {
      showMessage('error', 'Please upload an image first');
      return;
    }

    setLoading(true);
    // Clear old data when starting a new launch
    clearOldData();
    
    try {
      if (imageFile) {
        const formData = new FormData();
        formData.append('image', imageFile);
        await axios.post(`${API_BASE}/api/upload-image`, formData);
      }
      
      const walletCount = parseInt(tokenForm.distributionWalletNum) || 10;
      const devBuyAmount = walletBuyAmounts[0] || 0.1;
      const bundlerAmounts = walletBuyAmounts.slice(1).map(a => a || tokenForm.swapAmount || 0.3);
      
      const configData = {
        ...tokenForm,
        distributionWalletNum: walletCount,
        buyerAmount: devBuyAmount,
        swapAmounts: bundlerAmounts.join(','),
        autoRapidSell: autoRapidSell,
        autoSell50Percent: autoSell50Percent,
        autoGather: autoGather,
        autoCollectFees: autoCollectFees
      };
      
      await axios.post(`${API_BASE}/api/update-config`, configData);
      await new Promise(resolve => setTimeout(resolve, 200));
      
      await axios.post(`${API_BASE}/api/launch-token`, {
        autoRapidSell: autoRapidSell,
        autoSell50Percent: autoSell50Percent,
        autoGather: autoGather,
        autoCollectFees: autoCollectFees
      });
      
      setLaunchInProgress(true);
      showMessage('success', '🚀 Token launch started!');
      
      const pollInterval = setInterval(() => {
        loadStatus();
      }, 2000);
      
      setTimeout(() => {
        clearInterval(pollInterval);
        if (launchInProgress) {
          setLaunchInProgress(false);
        }
      }, 300000);
      
    } catch (error) {
      showMessage('error', error.response?.data?.error || 'Failed to launch token');
      setLaunchInProgress(false);
    } finally {
      setLoading(false);
    }
  };

  const addAdditionalWallet = async () => {
    const privateKey = prompt('Enter wallet private key (base58):');
    if (!privateKey) return;
    
    try {
      const res = await axios.post(`${API_BASE}/api/trading/wallets/add`, {
        privateKey: privateKey
      });
      
      if (res.data.success) {
        setAdditionalWallets(prev => [...prev, {
          privateKey,
          address: res.data.address,
          label: `Wallet ${prev.length + 1}`
        }]);
        showMessage('success', 'Additional wallet added!');
      } else {
        showMessage('error', res.data.error || 'Failed to add wallet');
      }
    } catch (error) {
      showMessage('error', error.response?.data?.error || 'Invalid private key');
    }
  };

  const quickBuy = async (amount) => {
    const mintAddress = getCurrentMintAddress();
    if (!mintAddress) {
      showMessage('error', 'Please enter a mint address (use Test Mode or launch a token)');
      return;
    }
    setLoading(true);
    try {
      await axios.post(`${API_BASE}/api/trading/buy`, {
        mintAddress: mintAddress,
        solAmount: amount || 0.1,
        walletAddress: devWalletAddress || undefined // Use dev wallet if available
      });
      showMessage('success', `💰 Quick buy executed: ${amount || 0.1} SOL!`);
      setTimeout(fetchWalletStatus, 1000);
    } catch (error) {
      showMessage('error', error.response?.data?.error || 'Quick buy failed');
    } finally {
      setLoading(false);
    }
  };

  const quickSell = async (walletAddress) => {
    const mintAddress = getCurrentMintAddress();
    if (!mintAddress) {
      showMessage('error', 'Please enter a mint address (use Test Mode or launch a token)');
      return;
    }
    setLoading(true);
    try {
      await axios.post(`${API_BASE}/api/trading/sell`, {
        walletAddress: walletAddress || undefined,
        mintAddress: mintAddress,
        sellPercentage: 100
      });
      showMessage('success', `💰 Quick sell executed!`);
      setTimeout(fetchWalletStatus, 1000);
    } catch (error) {
      showMessage('error', error.response?.data?.error || 'Quick sell failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app" style={{ width: '100vw', minHeight: '100vh', margin: 0, padding: 0, overflowX: 'hidden' }}>
      <div style={{ width: '100%', maxWidth: '100%', margin: 0, padding: '20px', boxSizing: 'border-box', background: 'white', minHeight: '100vh' }}>
        <h1 style={{ textAlign: 'center', marginBottom: '20px', fontSize: '28px' }}>💰 PROFIT MACHINE</h1>
        
        {message.text && (
          <div className={`message message-${message.type}`}>
            {message.text}
          </div>
        )}

        {/* TEST MODE: Manual Mint Address Input */}
        <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '8px', border: '2px solid #007bff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontWeight: 'bold' }}>
              <input
                type="checkbox"
                checked={useTestMint}
                onChange={(e) => {
                  setUseTestMint(e.target.checked);
                  if (!e.target.checked) {
                    setTestMintAddress('');
                  }
                }}
                style={{ cursor: 'pointer' }}
              />
              <span>🧪 Test Mode (Use Custom Mint Address)</span>
            </label>
          </div>
          {useTestMint && (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input
                type="text"
                value={testMintAddress}
                onChange={(e) => setTestMintAddress(e.target.value)}
                placeholder="Enter pump.fun mint address (e.g., H8XH2XESM8BRo7e4X2WnWdw7UVieav8DMQ3pNzn5pump)"
                style={{ flex: 1, padding: '8px', fontSize: '14px', borderRadius: '4px', border: '1px solid #ddd', fontFamily: 'monospace' }}
              />
              <button
                onClick={() => {
                  if (testMintAddress) {
                    showMessage('success', `Testing with mint: ${testMintAddress.slice(0, 8)}...`);
                    fetchWalletStatus();
                  }
                }}
                className="btn"
                style={{ backgroundColor: '#007bff', color: 'white', padding: '8px 16px' }}
              >
                Load
              </button>
            </div>
          )}
          {useTestMint && testMintAddress && (
            <div style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>
              <strong>Current Test Mint:</strong> {testMintAddress}<br/>
              <small>You can now test buy/sell and trade tracking with this token!</small>
            </div>
          )}
        </div>

        {/* TWO COLUMN LAYOUT - FULL WIDTH */}
        <div style={{ display: 'grid', gridTemplateColumns: getCurrentMintAddress() ? 'minmax(450px, 1fr) minmax(600px, 1.3fr)' : '1fr', gap: '30px', alignItems: 'start', width: '100%' }}>
          
          {/* LEFT COLUMN: LAUNCH FORM */}
          <div className="form-section" style={{ padding: '20px', backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
            <h2 style={{ marginTop: '0', marginBottom: '15px', fontSize: '22px', fontWeight: 'bold', color: '#333' }}>🚀 Launch Token</h2>
            
            {/* Wallet Info Preview */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
              {/* Dev Wallet Address */}
              {devWalletAddress ? (
                <div style={{ padding: '8px 12px', backgroundColor: '#e3f2fd', borderRadius: '6px', fontSize: '12px', border: '1px solid #90caf9' }}>
                  <strong>💰 Dev Wallet:</strong><br/>
                  <code style={{ fontFamily: 'monospace', fontSize: '11px', wordBreak: 'break-all' }}>{devWalletAddress}</code>
                  <a href={`https://solscan.io/account/${devWalletAddress}`} target="_blank" rel="noopener noreferrer" style={{ marginLeft: '5px', color: '#007bff', fontSize: '11px' }}>
                    View ↗
                  </a>
                  <div style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>
                    (From PRIVATE_KEY in .env)
                  </div>
                </div>
              ) : (
                <div style={{ padding: '8px 12px', backgroundColor: '#fff3cd', borderRadius: '6px', fontSize: '11px', border: '1px solid #ffc107' }}>
                  ⚠️ Dev wallet not configured<br/>
                  <small>Set PRIVATE_KEY in .env</small>
                </div>
              )}
              
              {/* Next Pump Address */}
              {nextPumpAddress ? (
                <div style={{ padding: '8px 12px', backgroundColor: '#e8f5e9', borderRadius: '6px', fontSize: '12px', border: '1px solid #c8e6c9' }}>
                  <strong>📋 Next Pump Address:</strong><br/>
                  <code style={{ fontFamily: 'monospace', fontSize: '11px', wordBreak: 'break-all' }}>{nextPumpAddress}</code>
                  <a href={`https://pump.fun/${nextPumpAddress}`} target="_blank" rel="noopener noreferrer" style={{ marginLeft: '5px', color: '#007bff', fontSize: '11px' }}>
                    View ↗
                  </a>
                </div>
              ) : (
                <div style={{ padding: '8px 12px', backgroundColor: '#fff3cd', borderRadius: '6px', fontSize: '11px', border: '1px solid #ffc107' }}>
                  ⚠️ No pump addresses available<br/>
                  <small>Generate in pump-addresses.json or enable vanity mode</small>
                </div>
              )}
            </div>

            {/* AI Auto-Fill */}
            <div style={{ marginBottom: '18px', padding: '12px', backgroundColor: '#f8f9fa', borderRadius: '8px', border: '1px solid #e9ecef' }}>
              <h3 style={{ marginTop: '0', marginBottom: '10px', fontSize: '16px', fontWeight: '600', color: '#495057' }}>🤖 AI Auto-Fill</h3>
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="Describe your token idea..."
                rows={2}
                style={{ width: '100%', padding: '8px', marginBottom: '8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px', resize: 'vertical' }}
              />
              <button onClick={generateWithAI} disabled={aiLoading || !aiPrompt.trim()} className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '14px' }}>
                {aiLoading ? 'Generating...' : '✨ Generate with AI'}
              </button>
            </div>

            {/* Token Info Section */}
            <div style={{ marginBottom: '18px', padding: '12px', backgroundColor: '#f8f9fa', borderRadius: '8px', border: '1px solid #e9ecef' }}>
              <h3 style={{ marginTop: '0', marginBottom: '12px', fontSize: '16px', fontWeight: '600', color: '#495057' }}>Token Information</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '5px', fontSize: '13px', fontWeight: '500', color: '#495057' }}>Token Name *</label>
                  <input
                    type="text"
                    value={tokenForm.tokenName}
                    onChange={(e) => setTokenForm({...tokenForm, tokenName: e.target.value})}
                    placeholder="Token Name"
                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '5px', fontSize: '13px', fontWeight: '500', color: '#495057' }}>Token Symbol *</label>
                  <input
                    type="text"
                    value={tokenForm.tokenSymbol}
                    onChange={(e) => setTokenForm({...tokenForm, tokenSymbol: e.target.value.toUpperCase()})}
                    placeholder="SYMBOL"
                    maxLength={10}
                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px' }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', marginBottom: '5px', fontSize: '13px', fontWeight: '500', color: '#495057' }}>Description *</label>
                <textarea
                  value={tokenForm.description}
                  onChange={(e) => setTokenForm({...tokenForm, description: e.target.value})}
                  placeholder="Token description..."
                  rows={2}
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px', resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '5px', fontSize: '13px', fontWeight: '500', color: '#495057' }}>Twitter</label>
                  <input
                    type="url"
                    value={tokenForm.twitter}
                    onChange={(e) => setTokenForm({...tokenForm, twitter: e.target.value})}
                    placeholder="https://x.com/..."
                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '5px', fontSize: '13px', fontWeight: '500', color: '#495057' }}>Telegram</label>
                  <input
                    type="url"
                    value={tokenForm.telegram}
                    onChange={(e) => setTokenForm({...tokenForm, telegram: e.target.value})}
                    placeholder="https://t.me/..."
                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '5px', fontSize: '13px', fontWeight: '500', color: '#495057' }}>Website</label>
                  <input
                    type="url"
                    value={tokenForm.website}
                    onChange={(e) => setTokenForm({...tokenForm, website: e.target.value})}
                    placeholder="https://..."
                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px' }}
                  />
                </div>
              </div>
            </div>

            {/* Image Upload */}
            <div style={{ marginBottom: '18px', padding: '12px', backgroundColor: '#f8f9fa', borderRadius: '8px', border: '1px solid #e9ecef' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: '500', color: '#495057' }}>Token Image *</label>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <input type="file" accept="image/*" onChange={handleImageUpload} style={{ fontSize: '13px' }} />
                {imagePreview && <img src={imagePreview} alt="Preview" style={{ width: '50px', height: '50px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #ddd' }} />}
                <button onClick={uploadImage} disabled={!imageFile || loading} className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '14px' }}>Upload</button>
              </div>
            </div>

            {/* Wallet Configuration Section */}
            <div style={{ marginBottom: '18px', padding: '12px', backgroundColor: '#f8f9fa', borderRadius: '8px', border: '1px solid #e9ecef' }}>
              <h3 style={{ marginTop: '0', marginBottom: '12px', fontSize: '16px', fontWeight: '600', color: '#495057' }}>Wallet Configuration</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '5px', fontSize: '13px', fontWeight: '500', color: '#495057' }}>Number of Bundler Wallets *</label>
                  <input
                    type="number"
                    value={walletCountInput}
                    onFocus={() => {
                      setUserEditingWalletCount(true);
                    }}
                    onChange={(e) => {
                      const value = e.target.value;
                      setWalletCountInput(value);
                      const num = parseInt(value);
                      // CRITICAL: Mark IMMEDIATELY that user has changed wallet count
                      // This must happen BEFORE any other state updates
                      userHasChangedWalletCount.current = true;
                      console.log('User changed wallet count to:', num, 'Ref set to:', userHasChangedWalletCount.current);
                      
                      if (!isNaN(num) && num >= 1 && num <= 50) {
                        // Update tokenForm using functional update to prevent race conditions
                        setTokenForm(prev => {
                          const updated = {...prev, distributionWalletNum: num};
                          console.log('Updated tokenForm.distributionWalletNum to:', num);
                          return updated;
                        });
                        
                        // Adjust wallet amounts array - ensure we have exactly (1 dev + num bundlers)
                        // Use functional update to get current state
                        setWalletBuyAmounts(prevAmounts => {
                          const currentBundlerCount = prevAmounts.length - 1; // Exclude dev wallet
                          if (num > currentBundlerCount) {
                            // Need to add more bundler wallets
                            const defaultAmount = tokenForm.swapAmount || 0.3;
                            const newAmounts = [...prevAmounts];
                            for (let i = currentBundlerCount; i < num; i++) {
                              newAmounts.push(defaultAmount);
                            }
                            console.log('Added wallets, new array:', newAmounts);
                            return newAmounts;
                          } else if (num < currentBundlerCount) {
                            // Need to remove bundler wallets - keep dev + first num bundlers
                            const newAmounts = [prevAmounts[0], ...prevAmounts.slice(1, num + 1)];
                            console.log('Reduced wallets, new array:', newAmounts, 'Expected length:', num + 1);
                            return newAmounts;
                          }
                          // If num === currentBundlerCount, no change needed
                          return prevAmounts;
                        });
                      }
                    }}
                    onBlur={(e) => {
                      // Validate on blur
                      const value = e.target.value;
                      const num = parseInt(value);
                      if (value === '' || isNaN(num) || num < 1 || num > 50) {
                        const currentValue = tokenForm.distributionWalletNum || 10;
                        setWalletCountInput(String(currentValue));
                      } else {
                        setWalletCountInput(String(num));
                        setTokenForm({...tokenForm, distributionWalletNum: num});
                      }
                      // Allow updates again after a short delay
                      setTimeout(() => setUserEditingWalletCount(false), 500);
                    }}
                    min="1"
                    max="50"
                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px' }}
                  />
                  <small style={{ fontSize: '11px', color: '#6c757d', marginTop: '3px', display: 'block' }}>Total = 1 DEV + {tokenForm.distributionWalletNum} bundler</small>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '5px', fontSize: '13px', fontWeight: '500', color: '#495057' }}>Default Amount (SOL)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={tokenForm.swapAmount}
                    onChange={(e) => {
                      const amount = parseFloat(e.target.value) || 0.3;
                      setTokenForm({...tokenForm, swapAmount: amount});
                      const newAmounts = walletBuyAmounts.map((val, i) => i === 0 ? val : amount);
                      setWalletBuyAmounts(newAmounts);
                    }}
                    min="0.1"
                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px' }}
                  />
                  <small style={{ fontSize: '11px', color: '#6c757d', marginTop: '3px', display: 'block' }}>Sets all bundler wallets</small>
                </div>
              </div>

              {/* Individual Wallet Buy Amounts */}
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: '500', color: '#495057' }}>Individual Wallet Buy Amounts (SOL) *</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '8px', maxHeight: '220px', overflowY: 'auto', padding: '10px', backgroundColor: '#fff', borderRadius: '6px', border: '1px solid #dee2e6' }}>
                  <div style={{ padding: '8px', backgroundColor: '#e3f2fd', borderRadius: '6px', border: '2px solid #2196f3' }}>
                    <label style={{ fontSize: '11px', fontWeight: 'bold', display: 'block', marginBottom: '5px', color: '#1976d2' }}>DEV Buy</label>
                    <input
                      type="number"
                      step="0.01"
                      value={walletBuyAmounts[0] || ''}
                      onChange={(e) => {
                        const value = e.target.value;
                        const newAmounts = [...walletBuyAmounts];
                        newAmounts[0] = value === '' ? '' : parseFloat(value) || 0.1;
                        setWalletBuyAmounts(newAmounts);
                      }}
                      onBlur={(e) => {
                        const value = e.target.value;
                        const amount = parseFloat(value);
                        if (value === '' || isNaN(amount) || amount < 0.1) {
                          const newAmounts = [...walletBuyAmounts];
                          newAmounts[0] = 0.1;
                          setWalletBuyAmounts(newAmounts);
                        }
                      }}
                      min="0.01"
                      style={{ width: '100%', padding: '6px', fontSize: '12px', borderRadius: '4px', border: '1px solid #90caf9' }}
                    />
                  </div>
                  {Array.from({ length: tokenForm.distributionWalletNum || 10 }, (_, i) => (
                    <div key={i} style={{ padding: '8px', backgroundColor: '#fff', borderRadius: '6px', border: '1px solid #dee2e6' }}>
                      <label style={{ fontSize: '11px', display: 'block', marginBottom: '5px', color: '#495057' }}>Bundler {i + 1}</label>
                      <input
                        type="number"
                        step="0.01"
                        value={walletBuyAmounts[i + 1] ?? ''}
                        onChange={(e) => {
                          const value = e.target.value;
                          const newAmounts = [...walletBuyAmounts];
                          newAmounts[i + 1] = value === '' ? '' : parseFloat(value) || tokenForm.swapAmount || 0.3;
                          setWalletBuyAmounts(newAmounts);
                        }}
                        onBlur={(e) => {
                          const value = e.target.value;
                          const amount = parseFloat(value);
                          if (value === '' || isNaN(amount) || amount < 0.1) {
                            const newAmounts = [...walletBuyAmounts];
                            newAmounts[i + 1] = tokenForm.swapAmount || 0.3;
                            setWalletBuyAmounts(newAmounts);
                          }
                        }}
                        min="0.01"
                        style={{ width: '100%', padding: '6px', fontSize: '12px', borderRadius: '4px', border: '1px solid #ddd' }}
                      />
                    </div>
                  ))}
                </div>
                <small style={{ fontSize: '11px', color: '#6c757d', marginTop: '6px', display: 'block' }}>Set individual amounts. First is DEV wallet, rest are bundler wallets.</small>
              </div>
            </div>

            {/* Auto Actions */}
            <div style={{ marginBottom: '18px', padding: '12px', backgroundColor: '#f8f9fa', borderRadius: '8px', border: '1px solid #e9ecef' }}>
              <h3 style={{ marginTop: '0', marginBottom: '10px', fontSize: '16px', fontWeight: '600', color: '#495057' }}>Auto Actions</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={autoRapidSell} onChange={(e) => { setAutoRapidSell(e.target.checked); if (e.target.checked) setAutoSell50Percent(false); }} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                  <span>⚡ Auto Rapid Sell All</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={autoSell50Percent} onChange={(e) => { setAutoSell50Percent(e.target.checked); if (e.target.checked) setAutoRapidSell(false); }} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                  <span>⚡ Auto Sell 50%</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={tokenForm.vanityMode} onChange={(e) => setTokenForm({...tokenForm, vanityMode: e.target.checked})} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                  <span>Vanity Mode</span>
                </label>
              </div>
            </div>

            <button 
              onClick={launchToken} 
              disabled={loading || !tokenForm.tokenName || !tokenForm.tokenSymbol || !tokenForm.description || !imageFile} 
              className="btn btn-primary" 
              style={{ 
                width: '100%', 
                padding: '14px', 
                fontSize: '16px', 
                fontWeight: 'bold',
                borderRadius: '8px',
                border: 'none',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                cursor: loading || !tokenForm.tokenName || !tokenForm.tokenSymbol || !tokenForm.description || !imageFile ? 'not-allowed' : 'pointer',
                opacity: loading || !tokenForm.tokenName || !tokenForm.tokenSymbol || !tokenForm.description || !imageFile ? 0.6 : 1,
                transition: 'all 0.3s',
                boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
              }}
              onMouseEnter={(e) => {
                if (!loading && tokenForm.tokenName && tokenForm.tokenSymbol && tokenForm.description && imageFile) {
                  e.target.style.transform = 'translateY(-2px)';
                  e.target.style.boxShadow = '0 6px 12px rgba(0,0,0,0.15)';
                }
              }}
              onMouseLeave={(e) => {
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
              }}
            >
              {loading ? 'Launching...' : '🚀 LAUNCH TOKEN'}
            </button>
            
            {/* Clear old data button */}
            {status.mintAddress && (
              <button
                onClick={clearOldData}
                style={{
                  marginTop: '10px',
                  padding: '10px 20px',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  borderRadius: '8px',
                  border: '2px solid #dc3545',
                  background: 'white',
                  color: '#dc3545',
                  cursor: 'pointer',
                  transition: 'all 0.3s',
                  width: '100%'
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = '#dc3545';
                  e.target.style.color = 'white';
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'white';
                  e.target.style.color = '#dc3545';
                }}
              >
                🗑️ Clear Old Token Data
              </button>
            )}
          </div>

          {/* RIGHT COLUMN: PROFIT DASHBOARD (shows when launched or in test mode) */}
          {getCurrentMintAddress() && (
            <div style={{ position: 'sticky', top: '20px', maxHeight: 'calc(100vh - 40px)', overflowY: 'auto' }}>
              {/* Profit Metrics */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                <div style={{ padding: '15px', backgroundColor: profitMetrics.profit >= 0 ? '#d4edda' : '#f8d7da', borderRadius: '8px', border: `2px solid ${profitMetrics.profit >= 0 ? '#28a745' : '#dc3545'}` }}>
                  <div style={{ fontSize: '11px', color: '#666', marginBottom: '5px' }}>Total Profit</div>
                  <div style={{ fontSize: '20px', fontWeight: 'bold', color: profitMetrics.profit >= 0 ? '#28a745' : '#dc3545' }}>
                    {profitMetrics.profit >= 0 ? '+' : ''}{profitMetrics.profit.toFixed(4)} SOL
                  </div>
                  <div style={{ fontSize: '12px', color: '#666' }}>{profitMetrics.profitPercent >= 0 ? '+' : ''}{profitMetrics.profitPercent.toFixed(2)}%</div>
                </div>
                <div style={{ padding: '15px', backgroundColor: '#e7f3ff', borderRadius: '8px' }}>
                  <div style={{ fontSize: '11px', color: '#666', marginBottom: '5px' }}>Invested</div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{profitMetrics.totalInvested.toFixed(4)} SOL</div>
                </div>
                <div style={{ padding: '15px', backgroundColor: '#fff3cd', borderRadius: '8px' }}>
                  <div style={{ fontSize: '11px', color: '#666', marginBottom: '5px' }}>Current Value</div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{profitMetrics.currentValue.toFixed(4)} SOL</div>
                </div>
                <div style={{ padding: '15px', backgroundColor: '#f0f0f0', borderRadius: '8px' }}>
                  <div style={{ fontSize: '11px', color: '#666', marginBottom: '5px' }}>Wallets</div>
                  <div style={{ fontSize: '14px', fontWeight: 'bold' }}>
                    <span style={{ color: '#dc3545' }}>Sold: {profitMetrics.walletsSold}</span><br/>
                    <span style={{ color: '#28a745' }}>Holding: {profitMetrics.walletsHolding}</span>
                  </div>
                </div>
              </div>

              {/* Birdeye Chart */}
              <div style={{ marginBottom: '20px', backgroundColor: '#fff', borderRadius: '8px', padding: '15px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                <h3 style={{ marginTop: '0', marginBottom: '15px', fontSize: '18px', fontWeight: 'bold' }}>📈 Price Chart</h3>
                <iframe
                  src={`https://birdeye.so/tv-widget/${getCurrentMintAddress()}?chain=solana&viewMode=pair&chartInterval=15&chartType=CANDLE&chartTimezone=America%2FLos_Angeles&chartLeftToolbar=show&theme=dark`}
                  style={{ width: '100%', height: '600px', border: 'none', borderRadius: '5px' }}
                  title="Birdeye Chart"
                />
              </div>
              
              {/* Real-time Transaction Stream */}
              {websocketTracking && (
                <div style={{ marginBottom: '20px', backgroundColor: '#fff', borderRadius: '8px', padding: '15px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h3 style={{ margin: '0', fontSize: '16px', fontWeight: 'bold' }}>
                      ⚡ Real-time Transaction Stream
                      <span style={{ 
                        fontSize: '12px', 
                        fontWeight: 'normal', 
                        color: sseConnected ? '#28a745' : '#dc3545',
                        marginLeft: '10px'
                      }}>
                        {sseConnected ? '● Connected' : '○ Disconnected'}
                      </span>
                    </h3>
                    <button
                      onClick={() => setRealtimeTransactions([])}
                      style={{
                        padding: '4px 12px',
                        fontSize: '11px',
                        backgroundColor: '#f8f9fa',
                        border: '1px solid #ddd',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      Clear
                    </button>
                  </div>
                  <div style={{ maxHeight: '400px', overflowY: 'auto', fontSize: '12px' }}>
                    {realtimeTransactions.length === 0 ? (
                      <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
                        Waiting for transactions... {sseConnected ? '' : '(Connecting...)'}
                      </div>
                    ) : (
                      realtimeTransactions.map((tx, idx) => {
                        const timeAgo = Math.floor((Date.now() - tx.timestamp) / 1000);
                        const timeStr = timeAgo < 60 ? `${timeAgo}s ago` : timeAgo < 3600 ? `${Math.floor(timeAgo / 60)}m ago` : `${Math.floor(timeAgo / 3600)}h ago`;
                        const isBuy = tx.type === 'buy';
                        const isOurWallet = tx.isOurWallet;
                        
                        return (
                          <div
                            key={`${tx.walletAddress}-${tx.timestamp}-${idx}`}
                            style={{
                              padding: '10px',
                              marginBottom: '8px',
                              borderRadius: '6px',
                              border: `2px solid ${isOurWallet ? '#007bff' : isBuy ? '#28a745' : '#dc3545'}`,
                              backgroundColor: isOurWallet ? '#e7f3ff' : isBuy ? '#d4edda' : '#f8d7da',
                              animation: idx === 0 ? 'fadeIn 0.3s' : 'none'
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                              <div style={{ flex: 1, minWidth: '200px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                  <span style={{ 
                                    fontWeight: 'bold', 
                                    color: isBuy ? '#28a745' : '#dc3545',
                                    fontSize: '13px'
                                  }}>
                                    {isBuy ? '🟢 BUY' : '🔴 SELL'}
                                  </span>
                                  <span style={{ 
                                    fontSize: '11px', 
                                    padding: '2px 6px', 
                                    borderRadius: '4px',
                                    backgroundColor: isOurWallet ? '#007bff' : '#6c757d',
                                    color: '#fff'
                                  }}>
                                    {isOurWallet ? 'OUR WALLET' : 'EXTERNAL'}
                                  </span>
                                </div>
                                <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>
                                  Wallet: <code style={{ fontSize: '10px' }}>{tx.walletAddress.slice(0, 8)}...{tx.walletAddress.slice(-6)}</code>
                                </div>
                                <div style={{ fontSize: '12px', fontWeight: 'bold' }}>
                                  {tx.solAmount.toFixed(4)} SOL
                                  {tx.tokenAmount > 0 && ` • ${tx.tokenAmount.toFixed(2)} tokens`}
                                </div>
                              </div>
                              <div style={{ fontSize: '11px', color: '#666', textAlign: 'right' }}>
                                {timeStr}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* Recent Trades - Track buys/sells (Birdeye) */}
              {trades.length > 0 && (
                <div style={{ marginBottom: '20px', backgroundColor: '#fff', borderRadius: '8px', padding: '15px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h3 style={{ margin: '0', fontSize: '16px', fontWeight: 'bold' }}>📊 Recent Trades (Birdeye)</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={websocketTracking}
                          onChange={(e) => {
                            setWebsocketTracking(e.target.checked);
                            if (!e.target.checked) {
                              // Stop tracking when unchecked
                              axios.post(`${API_BASE}/api/websocket/stop-tracking`).catch(() => {});
                            }
                          }}
                          style={{ cursor: 'pointer' }}
                        />
                        <span>⚡ Real-time WebSocket (0 latency)</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={autoSellOnExternalBuy}
                          onChange={(e) => setAutoSellOnExternalBuy(e.target.checked)}
                          style={{ cursor: 'pointer' }}
                          disabled={!websocketTracking}
                        />
                        <span style={{ opacity: websocketTracking ? 1 : 0.5 }}>Auto-sell on external buy</span>
                      </label>
                      {autoSellOnExternalBuy && websocketTracking && (
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          value={externalBuyThreshold}
                          onChange={(e) => setExternalBuyThreshold(parseFloat(e.target.value) || 0.1)}
                          placeholder="SOL threshold"
                          style={{ width: '80px', padding: '4px', fontSize: '11px', borderRadius: '4px', border: '1px solid #ddd' }}
                        />
                      )}
                    </div>
                  </div>
                  <div style={{ maxHeight: '300px', overflowY: 'auto', fontSize: '12px' }}>
                    {trades.slice(0, 20).map((trade, idx) => {
                      const isOurWallet = trade.isOurWallet;
                      const timeAgo = Math.floor((Date.now() - trade.timestamp) / 1000);
                      const timeStr = timeAgo < 60 ? `${timeAgo}s ago` : timeAgo < 3600 ? `${Math.floor(timeAgo / 60)}m ago` : `${Math.floor(timeAgo / 3600)}h ago`;
                      
                      return (
                        <div
                          key={`${trade.txHash}-${idx}`}
                          style={{
                            padding: '8px',
                            marginBottom: '6px',
                            borderRadius: '6px',
                            border: `2px solid ${isOurWallet ? '#007bff' : trade.type === 'buy' ? '#28a745' : '#dc3545'}`,
                            backgroundColor: isOurWallet ? '#e7f3ff' : trade.type === 'buy' ? '#d4edda' : '#f8d7da'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                <span style={{ 
                                  fontWeight: 'bold', 
                                  color: isOurWallet ? '#007bff' : trade.type === 'buy' ? '#28a745' : '#dc3545',
                                  fontSize: '13px'
                                }}>
                                  {trade.type.toUpperCase()}
                                </span>
                                {isOurWallet && (
                                  <span style={{ 
                                    backgroundColor: '#007bff', 
                                    color: 'white', 
                                    padding: '2px 6px', 
                                    borderRadius: '3px', 
                                    fontSize: '10px',
                                    fontWeight: 'bold'
                                  }}>
                                    MY WALLET
                                  </span>
                                )}
                                {!isOurWallet && trade.type === 'buy' && (
                                  <span style={{ 
                                    backgroundColor: '#ffc107', 
                                    color: '#000', 
                                    padding: '2px 6px', 
                                    borderRadius: '3px', 
                                    fontSize: '10px',
                                    fontWeight: 'bold'
                                  }}>
                                    EXTERNAL BUY
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '11px', color: '#666', fontFamily: 'monospace' }}>
                                {trade.from ? `${trade.from.slice(0, 6)}...${trade.from.slice(-4)}` : 'Unknown'}
                              </div>
                            </div>
                            <div style={{ textAlign: 'right', marginLeft: '10px' }}>
                              <div style={{ fontWeight: 'bold', fontSize: '13px' }}>
                                ${parseFloat(trade.priceUsd || '0').toFixed(6)}
                              </div>
                              <div style={{ fontSize: '11px', color: '#666' }}>
                                ${parseFloat(trade.amountUsd || '0').toFixed(2)}
                              </div>
                              <div style={{ fontSize: '10px', color: '#999', marginTop: '2px' }}>
                                {timeStr}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Quick Actions */}
              <div style={{ marginBottom: '15px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button onClick={() => { const amount = prompt('SOL amount:', '0.1'); if (amount) quickBuy(parseFloat(amount)); }} className="btn" style={{ backgroundColor: '#28a745', color: 'white', flex: '1', minWidth: '100px' }}>
                  🟢 Buy
                </button>
                <button onClick={() => { if (window.confirm('Sell 100%?')) quickSell(); }} className="btn" style={{ backgroundColor: '#dc3545', color: 'white', flex: '1', minWidth: '100px' }}>
                  🔴 Sell
                </button>
                <button onClick={addAdditionalWallet} className="btn btn-secondary" style={{ flex: '1', minWidth: '100px' }}>
                  ➕ Wallet
                </button>
              </div>

              {/* Wallet Status Table - Compact */}
              <div style={{ marginBottom: '15px', backgroundColor: '#fff', borderRadius: '8px', padding: '10px', maxHeight: '300px', overflowY: 'auto' }}>
                <h3 style={{ marginTop: '0', marginBottom: '10px', fontSize: '16px' }}>💰 Wallets</h3>
                <div style={{ fontSize: '12px' }}>
                  {walletStatus.length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>Loading...</div>
                  ) : (
                    walletStatus.map((wallet, i) => (
                      <div key={i} style={{ padding: '8px', borderBottom: '1px solid #eee', display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '10px', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontFamily: 'monospace', fontSize: '11px' }}>{wallet.address?.slice(0, 6)}...{wallet.address?.slice(-4)}</div>
                          <div style={{ fontSize: '10px', color: '#666' }}>{wallet.type || 'Bundler'}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{wallet.invested?.toFixed(3) || '0.000'} SOL</div>
                          <div style={{ fontSize: '10px', color: (wallet.profit || 0) >= 0 ? '#28a745' : '#dc3545' }}>
                            {(wallet.profit || 0) >= 0 ? '+' : ''}{wallet.profit?.toFixed(3) || '0.000'}
                          </div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          {wallet.sold ? (
                            <span style={{ color: '#dc3545', fontSize: '12px' }}>🔴</span>
                          ) : (
                            <button onClick={() => quickSell(wallet.address)} style={{ padding: '4px 8px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '11px' }}>
                              Sell
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Quick Actions Buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <button onClick={async () => { if (window.confirm('Rapid sell all?')) { setLoading(true); try { await axios.post(`${API_BASE}/api/rapid-sell`); showMessage('success', 'Rapid sell started!'); } catch (e) { showMessage('error', e.message); } finally { setLoading(false); } } }} className="btn" style={{ backgroundColor: '#ff6b6b', color: 'white', fontSize: '12px', padding: '8px' }}>
                  ⚡ Sell All
                </button>
                <button onClick={async () => { if (window.confirm('Sell 50%?')) { setLoading(true); try { await axios.post(`${API_BASE}/api/rapid-sell-50-percent`); showMessage('success', 'Sell 50% started!'); } catch (e) { showMessage('error', e.message); } finally { setLoading(false); } } }} className="btn" style={{ backgroundColor: '#ff9500', color: 'white', fontSize: '12px', padding: '8px' }}>
                  ⚡ Sell 50%
                </button>
                <button onClick={async () => { if (window.confirm('Sell remaining?')) { setLoading(true); try { await axios.post(`${API_BASE}/api/rapid-sell-remaining`); showMessage('success', 'Sell remaining started!'); } catch (e) { showMessage('error', e.message); } finally { setLoading(false); } } }} className="btn" style={{ backgroundColor: '#ff9500', color: 'white', fontSize: '12px', padding: '8px' }}>
                  ⚡ Remaining
                </button>
                <button onClick={async () => { setLoading(true); try { await axios.post(`${API_BASE}/api/gather-all`); showMessage('success', 'Gather all started!'); } catch (e) { showMessage('error', e.message); } finally { setLoading(false); } }} className="btn btn-secondary" style={{ fontSize: '12px', padding: '8px' }}>
                  💰 Gather
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SinglePageProfit;
