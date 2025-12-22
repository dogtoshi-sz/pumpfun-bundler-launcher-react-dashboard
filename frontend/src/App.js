import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './App.css';
import TradingTerminal from './TradingTerminal';
import ProfitDashboard from './ProfitDashboard';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

function App() {
  const [activeTab, setActiveTab] = useState('launch');
  const [status, setStatus] = useState({ walletCount: 0, mintAddress: null, hasWallets: false });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  
  // Token form state
  const [tokenForm, setTokenForm] = useState({
    tokenName: '',
    tokenSymbol: '',
    description: '',
    showName: '',
    twitter: '',
    telegram: '',
    website: '',
    distributionWalletNum: 10, // Keep as number, not string
    swapAmount: 0.3,
    swapAmounts: '',
    vanityMode: false,
    lilJitMode: false
  });
  
  // Individual wallet buy amounts (first is DEV buy, rest are bundler wallets)
  const [walletBuyAmounts, setWalletBuyAmounts] = useState([0.1, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3]);
  
  // Local state for wallet count input (allows empty string while typing)
  const [walletCountInput, setWalletCountInput] = useState('10');
  
  const [imagePreview, setImagePreview] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [launchInProgress, setLaunchInProgress] = useState(false);
  const [previousMintAddress, setPreviousMintAddress] = useState(null);
  const [configLoaded, setConfigLoaded] = useState(false); // Track if config has been loaded once
  const [autoRapidSell, setAutoRapidSell] = useState(true); // Auto rapid sell enabled by default
  const [autoSell50Percent, setAutoSell50Percent] = useState(false); // Auto sell 50% disabled by default
  const [autoGather, setAutoGather] = useState(false); // Auto gather disabled by default
  const [autoCollectFees, setAutoCollectFees] = useState(false); // Auto collect fees disabled by default
  const [userEditingAmounts, setUserEditingAmounts] = useState(false); // Track if user is actively editing amounts
  const [lastWalletCount, setLastWalletCount] = useState(10); // Track last wallet count to detect actual changes
  const [userEditingWalletCount, setUserEditingWalletCount] = useState(false); // Track if user is actively editing wallet count
  const [userEditingSwapAmount, setUserEditingSwapAmount] = useState(false); // Track if user is actively editing swap amount
  const [hasLocalChanges, setHasLocalChanges] = useState(false); // Track if user has made unsaved changes
  const initialLoadDone = useRef(false); // Track if initial config load is complete (never reset)

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 5000);
    return () => clearInterval(interval);
  }, []);
  
  // Update wallet amounts array when distributionWalletNum changes
  // ONLY when the wallet count actually changes (not on every render)
  useEffect(() => {
    // Skip if user is actively editing amounts or wallet count
    if (userEditingAmounts || userEditingWalletCount) {
      return;
    }
    
    // Skip if user has made local changes that haven't been saved
    if (hasLocalChanges) {
      return; // Don't reset wallet amounts if user has unsaved changes
    }
    
    // Skip if distributionWalletNum is empty string (user is typing)
    if (tokenForm.distributionWalletNum === '' || tokenForm.distributionWalletNum === null || tokenForm.distributionWalletNum === undefined) {
      return; // Don't update wallet amounts while user is typing
    }
    
    const walletCount = typeof tokenForm.distributionWalletNum === 'number' 
      ? tokenForm.distributionWalletNum 
      : parseInt(tokenForm.distributionWalletNum, 10);
    
    if (isNaN(walletCount) || walletCount < 1 || walletCount > 50) {
      return; // Invalid value, don't update
    }
    
    // Only update if wallet count actually changed
    if (walletCount === lastWalletCount) {
      return; // No change, don't reset amounts
    }
    
    setLastWalletCount(walletCount); // Update tracked count
    
    const currentLength = walletBuyAmounts.length;
    const targetLength = walletCount + 1; // +1 for DEV buy
    
    if (targetLength !== currentLength) {
      const newAmounts = [...walletBuyAmounts];
      
      if (targetLength > currentLength) {
        // Add new wallets with default amount (use existing swapAmount from form, or 0.3)
        const defaultAmount = tokenForm.swapAmount || 0.3;
        for (let i = currentLength; i < targetLength; i++) {
          if (i === 0) {
            // DEV buy - keep existing or default to 0.1
            if (newAmounts.length === 0) {
              newAmounts.push(0.1);
            }
          } else {
            // Bundler wallet - use default amount
            newAmounts.push(defaultAmount);
          }
        }
      } else if (targetLength < currentLength && targetLength > 0) {
        // Remove extra wallets (keep DEV buy at index 0)
        newAmounts.splice(targetLength);
      }
      
      setWalletBuyAmounts(newAmounts);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenForm.distributionWalletNum, lastWalletCount, hasLocalChanges, userEditingWalletCount, userEditingAmounts]); // Watch all relevant state

  // Enforce mutual exclusivity between autoRapidSell and autoSell50Percent
  // Auto Sell 50% takes precedence - if it's enabled, disable rapid sell
  useEffect(() => {
    if (autoSell50Percent && autoRapidSell) {
      setAutoRapidSell(false);
    }
  }, [autoSell50Percent, autoRapidSell]);

  // Check for new mint address after launch - AUTO SWITCH TO PROFIT DASHBOARD
  useEffect(() => {
    if (launchInProgress && status.mintAddress && status.mintAddress !== previousMintAddress) {
      setLaunchInProgress(false);
      setPreviousMintAddress(status.mintAddress);
      showMessage('success', `💰 Token launched! Switching to Profit Dashboard...`);
      // AUTO SWITCH TO PROFIT DASHBOARD - THIS IS A PROFIT MACHINE!
      setActiveTab('profit');
    }
  }, [status.mintAddress, launchInProgress, previousMintAddress]);

  const loadStatus = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/status`);
      setStatus(res.data);
      
      // Load config values ONLY on first load (not on every status check)
      // This prevents overwriting user input while they're typing
      // Also skip if user has made local changes that haven't been saved
      // NEVER update wallet count after initial load - user must save explicitly
      if (res.data.config && !initialLoadDone.current && !hasLocalChanges && !userEditingWalletCount && !userEditingSwapAmount) {
        const config = res.data.config;
        
        // Only update if user is not actively editing
        const loadedWalletCount = config.distributionWalletNum || 10;
        // Update form with loaded config (only once on initial load)
        // Load ALL fields including token info
        setTokenForm(prev => ({
          ...prev,
          // Token info
          tokenName: config.tokenName !== undefined ? config.tokenName : prev.tokenName,
          tokenSymbol: config.tokenSymbol !== undefined ? config.tokenSymbol : prev.tokenSymbol,
          description: config.description !== undefined ? config.description : prev.description,
          showName: config.showName !== undefined ? config.showName : prev.showName,
          twitter: config.twitter !== undefined ? config.twitter : prev.twitter,
          telegram: config.telegram !== undefined ? config.telegram : prev.telegram,
          website: config.website !== undefined ? config.website : prev.website,
          // Wallet config - ONLY set on initial load, NEVER update after
          distributionWalletNum: loadedWalletCount,
          swapAmount: config.swapAmount !== undefined ? config.swapAmount : prev.swapAmount,
          swapAmounts: config.swapAmounts !== undefined ? config.swapAmounts : prev.swapAmounts,
          // Options
          vanityMode: config.vanityMode !== undefined ? config.vanityMode : prev.vanityMode,
          lilJitMode: config.lilJitMode !== undefined ? config.lilJitMode : prev.lilJitMode
        }));
        setWalletCountInput(String(loadedWalletCount)); // Update input display
        setLastWalletCount(loadedWalletCount); // Set initial tracked count
        
        // Initialize wallet amounts array (only once on initial load)
        if (config.buyerAmount !== undefined || config.swapAmounts) {
          const devBuy = config.buyerAmount || 0.1;
          const bundlerAmounts = config.swapAmounts 
            ? config.swapAmounts.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n))
            : Array(loadedWalletCount || 10).fill(config.swapAmount || 0.3);
          
          setWalletBuyAmounts([devBuy, ...bundlerAmounts]);
          setLastWalletCount(loadedWalletCount); // Set initial wallet count
        }
        
        // Load auto action settings
        // IMPORTANT: Auto Sell 50% and Auto Rapid Sell are mutually exclusive
        // If both are enabled, Auto Sell 50% takes precedence
        if (config.autoSell50Percent !== undefined) {
          const sell50Enabled = config.autoSell50Percent === true || config.autoSell50Percent === 'true';
          setAutoSell50Percent(sell50Enabled);
          // If 50% sell is enabled, disable rapid sell (mutually exclusive)
          if (sell50Enabled) {
            setAutoRapidSell(false);
          } else if (config.autoRapidSell !== undefined) {
            setAutoRapidSell(config.autoRapidSell === true || config.autoRapidSell === 'true');
          }
        } else if (config.autoRapidSell !== undefined) {
          setAutoRapidSell(config.autoRapidSell === true || config.autoRapidSell === 'true');
        }
        if (config.autoGather !== undefined) setAutoGather(config.autoGather === true || config.autoGather === 'true');
        if (config.autoCollectFees !== undefined) setAutoCollectFees(config.autoCollectFees === true || config.autoCollectFees === 'true');
        
        setConfigLoaded(true); // Mark config as loaded so we don't overwrite user input
        initialLoadDone.current = true; // Mark initial load as done (never reset - prevents any future overwrites)
      }
    } catch (error) {
      console.error('Error loading status:', error);
    }
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
      
      const res = await axios.post(`${API_BASE}/api/upload-image`, formData);
      showMessage('success', 'Image uploaded successfully!');
    } catch (error) {
      showMessage('error', error.response?.data?.error || 'Failed to upload image');
    } finally {
      setLoading(false);
    }
  };

  // Reload config from server (discards any unsaved changes)
  const reloadConfig = async () => {
    if (!window.confirm('⚠️ Reload config from server? This will discard any unsaved changes you\'ve made.')) {
      return;
    }
    
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/api/status`);
      if (res.data.config) {
        const config = res.data.config;
        const loadedWalletCount = config.distributionWalletNum || 10;
        
        // Reload ALL fields from server
        setTokenForm({
          tokenName: config.tokenName || '',
          tokenSymbol: config.tokenSymbol || '',
          description: config.description || '',
          showName: config.showName || '',
          twitter: config.twitter || '',
          telegram: config.telegram || '',
          website: config.website || '',
          distributionWalletNum: loadedWalletCount,
          swapAmount: config.swapAmount || 0.3,
          swapAmounts: config.swapAmounts || '',
          vanityMode: config.vanityMode === true || config.vanityMode === 'true',
          lilJitMode: config.lilJitMode === true || config.lilJitMode === 'true'
        });
        setWalletCountInput(String(loadedWalletCount));
        setLastWalletCount(loadedWalletCount);
        
        // Reload wallet amounts
        if (config.buyerAmount !== undefined || config.swapAmounts) {
          const devBuy = config.buyerAmount || 0.1;
          const bundlerAmounts = config.swapAmounts 
            ? config.swapAmounts.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n))
            : Array(loadedWalletCount || 10).fill(config.swapAmount || 0.3);
          setWalletBuyAmounts([devBuy, ...bundlerAmounts]);
        }
        
        // Reload auto actions (enforce mutual exclusivity)
        if (config.autoSell50Percent === true || config.autoSell50Percent === 'true') {
          setAutoSell50Percent(true);
          setAutoRapidSell(false);
        } else {
          setAutoSell50Percent(false);
          setAutoRapidSell(config.autoRapidSell === true || config.autoRapidSell === 'true');
        }
        setAutoGather(config.autoGather === true || config.autoGather === 'true');
        setAutoCollectFees(config.autoCollectFees === true || config.autoCollectFees === 'true');
        
        setHasLocalChanges(false); // Reset local changes flag
        showMessage('success', 'Configuration reloaded from server!');
      }
    } catch (error) {
      console.error('Error reloading config:', error);
      showMessage('error', error.response?.data?.error || 'Failed to reload config');
    } finally {
      setLoading(false);
    }
  };

  const updateConfig = async () => {
    setLoading(true);
    try {
      // Prepare config with individual wallet amounts
      // First amount is DEV buy, rest are bundler wallets
      const devBuyAmount = walletBuyAmounts[0] || 0.1;
      const bundlerAmounts = walletBuyAmounts.slice(1).map(a => a || tokenForm.swapAmount || 0.3);
      
      // Include ALL fields - token info, wallet config, and auto actions
      const configData = {
        ...tokenForm,
        buyerAmount: devBuyAmount,
        swapAmounts: bundlerAmounts.join(','), // Convert array to comma-separated string for backend
        // Auto action settings
        autoRapidSell: autoRapidSell,
        autoSell50Percent: autoSell50Percent,
        autoGather: autoGather,
        autoCollectFees: autoCollectFees
      };
      
      console.log('Saving full configuration:', configData);
      await axios.post(`${API_BASE}/api/update-config`, configData);
      
      // After successful save, mark that changes are saved
      setHasLocalChanges(false);
      
      // After successful save, reload config from server to sync
      // But only update fields that match what we just saved (to avoid overwriting if user is typing)
      try {
        const statusRes = await axios.get(`${API_BASE}/api/status`);
        if (statusRes.data.config) {
          const savedConfig = statusRes.data.config;
          // Only update if values match what we just saved (confirms server saved correctly)
          if (savedConfig.distributionWalletNum === configData.distributionWalletNum) {
            setLastWalletCount(configData.distributionWalletNum);
            setWalletCountInput(String(configData.distributionWalletNum));
          }
        }
      } catch (e) {
        console.log('Could not reload config after save:', e);
      }
      
      showMessage('success', 'Configuration saved! All settings have been saved.');
    } catch (error) {
      console.error('Error saving config:', error);
      showMessage('error', error.response?.data?.error || 'Failed to update config');
    } finally {
      setLoading(false);
    }
  };

  const launchToken = async () => {
    if (!imageFile) {
      showMessage('error', 'Please upload an image first');
      return;
    }

    setLoading(true);
    try {
      console.log('Starting token launch...');
      
      // Upload image first
      if (imageFile) {
        console.log('Uploading image...');
        const formData = new FormData();
        formData.append('image', imageFile);
        const uploadRes = await axios.post(`${API_BASE}/api/upload-image`, formData);
        console.log('Image uploaded:', uploadRes.data);
      }
      
      // Validate wallet count before launching
      const walletCount = typeof tokenForm.distributionWalletNum === 'number' 
        ? tokenForm.distributionWalletNum 
        : (parseInt(tokenForm.distributionWalletNum) || 10);
      
      if (walletCount < 1 || walletCount > 50) {
        showMessage('error', 'Number of wallets must be between 1 and 50');
        setLoading(false);
        return;
      }
      
      // Prepare config with individual wallet amounts
      // First amount is DEV buy, rest are bundler wallets
      const devBuyAmount = walletBuyAmounts[0] || 0.1;
      const bundlerAmounts = walletBuyAmounts.slice(1).map(a => a || tokenForm.swapAmount || 0.3);
      
      const configData = {
        ...tokenForm,
        distributionWalletNum: walletCount, // Ensure it's a number
        buyerAmount: devBuyAmount,
        swapAmounts: bundlerAmounts.join(',') // Convert array to comma-separated string for backend
      };
      
      // Update config (include auto action settings)
      const configDataWithAuto = {
        ...configData,
        autoSell50Percent: autoSell50Percent,
        autoGather: autoGather,
        autoCollectFees: autoCollectFees
      };
      console.log('Updating config...', configDataWithAuto);
      console.log(`DEV Buy: ${devBuyAmount} SOL, Bundler wallets: ${bundlerAmounts.join(', ')}`);
      console.log(`SWAP_AMOUNTS string: "${bundlerAmounts.join(',')}"`);
      console.log(`Auto Rapid Sell: ${autoRapidSell}, Auto Sell 50%: ${autoSell50Percent}, Auto Gather: ${autoGather}, Auto Collect Fees: ${autoCollectFees}`);
      const configRes = await axios.post(`${API_BASE}/api/update-config`, configDataWithAuto);
      console.log('Config updated:', configRes.data);
      
      // Small delay to ensure .env file write completes
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Launch token with auto action settings
      console.log('Launching token...');
      console.log(`Auto rapid sell: ${autoRapidSell ? 'ENABLED' : 'DISABLED'}`);
      console.log(`Auto sell 50%: ${autoSell50Percent ? 'ENABLED' : 'DISABLED'}`);
      console.log(`Auto gather: ${autoGather ? 'ENABLED' : 'DISABLED'}`);
      console.log(`Auto collect fees: ${autoCollectFees ? 'ENABLED' : 'DISABLED'}`);
      const launchRes = await axios.post(`${API_BASE}/api/launch-token`, {
        autoRapidSell: autoRapidSell,
        autoSell50Percent: autoSell50Percent,
        autoGather: autoGather,
        autoCollectFees: autoCollectFees
      });
      console.log('Launch response:', launchRes.data);
      
      setLaunchInProgress(true);
      setPreviousMintAddress(status.mintAddress);
      showMessage('success', '🚀 Token launch started! The process is running in the background. The mint address will appear here when ready (checking every 5 seconds)...');
      
      // Poll more frequently after launch
      const pollInterval = setInterval(() => {
        loadStatus();
      }, 2000);
      
      // Stop polling after 5 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        if (launchInProgress) {
          setLaunchInProgress(false);
          showMessage('info', 'Launch process may still be running. Check the API server console for detailed progress.');
        }
      }, 300000);
      
    } catch (error) {
      console.error('Launch error:', error);
      const errorMsg = error.response?.data?.error || error.message || 'Failed to launch token';
      showMessage('error', `Error: ${errorMsg}`);
      setLaunchInProgress(false);
    } finally {
      setLoading(false);
    }
  };

  const gatherTokens = async () => {
    if (!window.confirm('This will sell all tokens and gather SOL from all wallets. Continue?')) {
      return;
    }

    setLoading(true);
    try {
      console.log('Starting gather process...');
      const res = await axios.post(`${API_BASE}/api/gather`);
      console.log('Gather response:', res.data);
      showMessage('success', '🔄 Gather process started! Selling tokens and collecting SOL from all wallets. Check the API server console for progress...');
    } catch (error) {
      console.error('Gather error:', error);
      showMessage('error', error.response?.data?.error || 'Failed to start gather');
      setLoading(false);
    }
    // Don't set loading to false immediately - process runs in background
  };

  const generateWithAI = async () => {
    if (!aiPrompt.trim()) {
      showMessage('error', 'Please enter a prompt');
      return;
    }

    setAiLoading(true);
    try {
      console.log('Generating with AI:', aiPrompt);
      const res = await axios.post(`${API_BASE}/api/ai-generate`, { prompt: aiPrompt });
      
      if (res.data.success && res.data.data) {
        const aiData = res.data.data;
        
        // Auto-fill all form fields
        setTokenForm({
          ...tokenForm,
          tokenName: aiData.tokenName || '',
          tokenSymbol: aiData.tokenSymbol || '',
          description: aiData.description || '',
          showName: aiData.showName || '',
          twitter: aiData.twitter || '',
          telegram: aiData.telegram || '',
          website: aiData.website || ''
        });
        
        // Keep wallet amounts unchanged when AI fills form
        
        showMessage('success', 'Token information generated! Review and adjust as needed.');
        setAiPrompt(''); // Clear prompt
      }
    } catch (error) {
      console.error('AI generate error:', error);
      const errorMsg = error.response?.data?.error || error.message || 'Failed to generate with AI';
      showMessage('error', errorMsg);
    } finally {
      setAiLoading(false);
    }
  };

  const gatherSol = async () => {
    if (!window.confirm('This will gather SOL from all wallets (no token selling). Continue?')) {
      return;
    }

    setLoading(true);
    try {
      console.log('Starting SOL gather process...');
      const res = await axios.post(`${API_BASE}/api/gather-sol`);
      console.log('Gather SOL response:', res.data);
      showMessage('success', '💰 SOL gather started! Collecting SOL from all wallets. Check the API server console for progress...');
    } catch (error) {
      console.error('Gather SOL error:', error);
      showMessage('error', error.response?.data?.error || 'Failed to start SOL gather');
      setLoading(false);
    }
    // Don't set loading to false immediately - process runs in background
  };

  const rapidSell = async () => {
    if (!window.confirm('⚡ RAPID SELL: This will sell tokens from ALL wallets in parallel (milliseconds speed). Continue?')) {
      return;
    }

    setLoading(true);
    try {
      console.log('Starting rapid sell process...');
      const mintAddress = status.mintAddress || null;
      const res = await axios.post(`${API_BASE}/api/rapid-sell`, { mintAddress });
      console.log('Rapid sell response:', res.data);
      showMessage('success', '🚀 RAPID SELL started! Selling from all wallets in parallel (ultra-fast). Check the API server console for progress...');
    } catch (error) {
      console.error('Rapid sell error:', error);
      showMessage('error', error.response?.data?.error || 'Failed to start rapid sell');
      setLoading(false);
    }
    // Don't set loading to false immediately - process runs in background
  };

  return (
    <div className="App">
      <div className="container">
        <header className="header">
          <h1>🚀 Pumpfun Token Bundler</h1>
          <div className="status-bar">
            <div className="status-item">
              <span className="label">Wallets:</span>
              <span className="value">{status.walletCount}</span>
            </div>
            {status.mintAddress && (
              <div className="status-item">
                <span className="label">Last Mint:</span>
                <span className="value">
                  <a 
                    href={`https://pump.fun/${status.mintAddress}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    style={{ color: '#4CAF50', textDecoration: 'underline' }}
                  >
                    {status.mintAddress.slice(0, 8)}...
                  </a>
                </span>
              </div>
            )}
            {launchInProgress && (
              <div className="status-item">
                <span className="label" style={{ color: '#FF9800' }}>Launching...</span>
                <span className="value" style={{ color: '#FF9800' }}>⏳</span>
              </div>
            )}
          </div>
        </header>

        {message.text && (
          <div className={`message message-${message.type}`}>
            {message.text}
          </div>
        )}

        <div className="tabs">
          <button 
            className={activeTab === 'launch' ? 'active' : ''}
            onClick={() => setActiveTab('launch')}
          >
            Launch Token
          </button>
          <button
            className={activeTab === 'gather' ? 'active' : ''}
            onClick={() => setActiveTab('gather')}
          >
            Gather/Sell
          </button>
          <button
            className={activeTab === 'trading' ? 'active' : ''}
            onClick={() => setActiveTab('trading')}
          >
            Trading Terminal
          </button>
          {status.mintAddress && (
            <button
              className={activeTab === 'profit' ? 'active' : ''}
              onClick={() => setActiveTab('profit')}
              style={{ backgroundColor: activeTab === 'profit' ? '#28a745' : '', color: activeTab === 'profit' ? 'white' : '' }}
            >
              💰 Profit Dashboard
            </button>
          )}
        </div>

        <div className="content">
          {activeTab === 'launch' && (
            <div className="form-section">
              <h2>Token Information</h2>
              
              {/* AI Auto-Fill Section */}
              <div className="ai-section">
                <h3>🤖 AI Auto-Fill</h3>
                <p className="ai-description">Describe your token idea and AI will fill in all the details automatically!</p>
                <div className="ai-input-group">
                  <textarea
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="Example: Create a meme token about a queen of spades playing card, with Twitter and Telegram links..."
                    rows={3}
                    className="ai-prompt-input"
                  />
                  <button 
                    onClick={generateWithAI} 
                    disabled={aiLoading || !aiPrompt.trim()}
                    className="btn btn-ai"
                  >
                    {aiLoading ? '✨ Generating...' : '✨ Generate with AI'}
                  </button>
                </div>
                <small className="ai-hint">💡 Tip: Mention social links, theme, utility, or any specific details you want included</small>
              </div>

              <div className="form-group">
                <label>Token Image *</label>
                <div className="image-upload">
                  <input 
                    type="file" 
                    accept="image/*" 
                    onChange={handleImageUpload}
                    className="file-input"
                  />
                  {imagePreview && (
                    <img src={imagePreview} alt="Preview" className="image-preview" />
                  )}
                  <button onClick={uploadImage} disabled={!imageFile || loading} className="btn btn-secondary">
                    Upload Image
                  </button>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Token Name *</label>
                  <input
                    type="text"
                    value={tokenForm.tokenName}
                    onChange={(e) => setTokenForm({...tokenForm, tokenName: e.target.value})}
                    placeholder="My Awesome Token"
                  />
                </div>
                <div className="form-group">
                  <label>Token Symbol *</label>
                  <input
                    type="text"
                    value={tokenForm.tokenSymbol}
                    onChange={(e) => setTokenForm({...tokenForm, tokenSymbol: e.target.value.toUpperCase()})}
                    placeholder="MAT"
                    maxLength={10}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Description *</label>
                <textarea
                  value={tokenForm.description}
                  onChange={(e) => setTokenForm({...tokenForm, description: e.target.value})}
                  placeholder="Describe your token..."
                  rows={3}
                />
              </div>

              <div className="form-group">
                <label>Show Name</label>
                <input
                  type="text"
                  value={tokenForm.showName}
                  onChange={(e) => setTokenForm({...tokenForm, showName: e.target.value})}
                  placeholder="Display name"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Twitter</label>
                  <input
                    type="url"
                    value={tokenForm.twitter}
                    onChange={(e) => setTokenForm({...tokenForm, twitter: e.target.value})}
                    placeholder="https://x.com/yourhandle"
                  />
                </div>
                <div className="form-group">
                  <label>Telegram</label>
                  <input
                    type="url"
                    value={tokenForm.telegram}
                    onChange={(e) => setTokenForm({...tokenForm, telegram: e.target.value})}
                    placeholder="https://t.me/yourgroup"
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Website</label>
                <input
                  type="url"
                  value={tokenForm.website}
                  onChange={(e) => setTokenForm({...tokenForm, website: e.target.value})}
                  placeholder="https://yoursite.com"
                />
              </div>

              <h3>Bundle Configuration</h3>
              
              <div className="form-row">
                <div className="form-group">
                  <label>Number of Bundler Wallets *</label>
                  <input
                    type="number"
                    value={walletCountInput}
                    onFocus={() => {
                      setUserEditingWalletCount(true);
                      setHasLocalChanges(true); // Mark changes immediately when user focuses
                    }}
                    onChange={(e) => {
                      const value = e.target.value;
                      setWalletCountInput(value); // Update display immediately (allows empty string)
                      setHasLocalChanges(true); // Mark changes immediately when user types
                      
                      // Parse and update form state if valid
                      if (value === '') {
                        // Allow empty while typing - don't update form state yet
                        return;
                      }
                      
                      const num = parseInt(value, 10);
                      if (!isNaN(num) && num >= 1 && num <= 50) {
                        setTokenForm(prev => ({...prev, distributionWalletNum: num}));
                      }
                    }}
                    onBlur={(e) => {
                      // Validate and fix on blur
                      const value = e.target.value;
                      const num = parseInt(value, 10);
                      
                      if (value === '' || isNaN(num) || num < 1 || num > 50) {
                        // Reset to current value if invalid (don't reset to 10)
                        const currentValue = tokenForm.distributionWalletNum || 10;
                        setWalletCountInput(String(currentValue));
                        setTokenForm(prev => ({...prev, distributionWalletNum: currentValue}));
                      } else {
                        // Ensure form state matches input
                        setWalletCountInput(String(num)); // Normalize display
                        setTokenForm(prev => ({...prev, distributionWalletNum: num}));
                        // Update lastWalletCount to prevent useEffect from resetting
                        setLastWalletCount(num);
                      }
                      // Don't reset userEditingWalletCount immediately - keep it true if hasLocalChanges
                      // This prevents any resets while user has unsaved changes
                      if (!hasLocalChanges) {
                        setTimeout(() => setUserEditingWalletCount(false), 200);
                      }
                      // hasLocalChanges stays true until user saves
                    }}
                    min="1"
                    max="50"
                  />
                  <small>Total wallets = 1 DEV buy + {tokenForm.distributionWalletNum} bundler wallets</small>
                </div>
                <div className="form-group">
                  <label>Default Amount (SOL)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={tokenForm.swapAmount}
                    onFocus={() => {
                      setUserEditingSwapAmount(true);
                      setUserEditingAmounts(true); // Prevent auto-reset while editing
                    }}
                    onChange={(e) => {
                      const value = e.target.value;
                      // Allow empty string while typing
                      if (value === '') {
                        setTokenForm({...tokenForm, swapAmount: ''});
                        return;
                      }
                      const amount = parseFloat(value);
                      if (!isNaN(amount)) {
                        setTokenForm({...tokenForm, swapAmount: amount});
                        // Update all bundler wallets (keep DEV buy at index 0) - only if valid number
                        const newAmounts = walletBuyAmounts.map((val, i) => i === 0 ? val : amount);
                        setWalletBuyAmounts(newAmounts);
                      }
                    }}
                    onBlur={(e) => {
                      // Small delay before allowing auto-updates again
                      setTimeout(() => {
                        setUserEditingSwapAmount(false);
                        setUserEditingAmounts(false);
                      }, 100);
                      // Ensure valid value on blur
                      const value = e.target.value;
                      const amount = parseFloat(value);
                      if (value === '' || isNaN(amount) || amount < 0.1) {
                        setTokenForm({...tokenForm, swapAmount: 0.3});
                      }
                    }}
                    min="0.1"
                  />
                  <small>Click to set all bundler wallets to this amount</small>
                </div>
              </div>

              <div className="form-group">
                <label>Individual Wallet Buy Amounts (SOL)</label>
                <div className="wallet-amounts-grid">
                  <div className="wallet-amount-item dev-buy">
                    <label>DEV Buy (Deployer Wallet) *</label>
                    <input
                      type="number"
                      step="0.01"
                      value={walletBuyAmounts[0] ?? ''}
                      onFocus={() => setUserEditingAmounts(true)}
                      onChange={(e) => {
                        const value = e.target.value;
                        const newAmounts = [...walletBuyAmounts];
                        // Allow empty string while typing
                        if (value === '') {
                          newAmounts[0] = '';
                        } else {
                          const amount = parseFloat(value);
                          if (!isNaN(amount)) {
                            newAmounts[0] = amount;
                          }
                        }
                        setWalletBuyAmounts(newAmounts);
                      }}
                      onBlur={(e) => {
                        // Ensure valid value on blur
                        const value = e.target.value;
                        const amount = parseFloat(value);
                        if (value === '' || isNaN(amount) || amount < 0.1) {
                          const newAmounts = [...walletBuyAmounts];
                          newAmounts[0] = 0.1;
                          setWalletBuyAmounts(newAmounts);
                        }
                        // Small delay before allowing auto-updates again
                        setTimeout(() => setUserEditingAmounts(false), 100);
                      }}
                      min="0.01"
                    />
                  </div>
                  {Array.from({ length: typeof tokenForm.distributionWalletNum === 'number' ? tokenForm.distributionWalletNum : 10 }, (_, i) => (
                    <div key={i} className="wallet-amount-item">
                      <label>Bundler Wallet {i + 1} *</label>
                      <input
                        type="number"
                        step="0.01"
                        value={walletBuyAmounts[i + 1] ?? ''}
                        onFocus={() => setUserEditingAmounts(true)}
                        onChange={(e) => {
                          const value = e.target.value;
                          const newAmounts = [...walletBuyAmounts];
                          // Allow empty string while typing
                          if (value === '') {
                            newAmounts[i + 1] = '';
                          } else {
                            const amount = parseFloat(value);
                            if (!isNaN(amount)) {
                              newAmounts[i + 1] = amount;
                            }
                          }
                          setWalletBuyAmounts(newAmounts);
                        }}
                        onBlur={(e) => {
                          // Ensure valid value on blur
                          const value = e.target.value;
                          const amount = parseFloat(value);
                          if (value === '' || isNaN(amount) || amount < 0.1) {
                            const newAmounts = [...walletBuyAmounts];
                            newAmounts[i + 1] = tokenForm.swapAmount || 0.3;
                            setWalletBuyAmounts(newAmounts);
                          }
                          // Small delay before allowing auto-updates again
                          setTimeout(() => setUserEditingAmounts(false), 100);
                        }}
                        min="0.01"
                      />
                    </div>
                  ))}
                </div>
                <small>Set individual buy amounts for each wallet. First wallet is the DEV buy from your deployer wallet.</small>
              </div>

              <div className="form-row">
                <div className="form-group checkbox-group">
                  <label>
                    <input
                      type="checkbox"
                      checked={tokenForm.vanityMode}
                      onChange={(e) => setTokenForm({...tokenForm, vanityMode: e.target.checked})}
                    />
                    Vanity Mode (token address ends with "pump")
                  </label>
                </div>
                <div className="form-group checkbox-group">
                  <label>
                    <input
                      type="checkbox"
                      checked={tokenForm.lilJitMode}
                      onChange={(e) => setTokenForm({...tokenForm, lilJitMode: e.target.checked})}
                    />
                    Lil Jito Mode
                  </label>
                </div>
              </div>

              <div className="auto-actions-section" style={{ marginBottom: '15px', padding: '15px', backgroundColor: '#f5f5f5', borderRadius: '5px' }}>
                <h4 style={{ marginTop: '0', marginBottom: '10px' }}>🤖 Auto Actions</h4>
                
                <div className="auto-action-toggle" style={{ marginBottom: '10px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '10px' }}>
                    <input
                      type="checkbox"
                      checked={autoRapidSell}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setAutoRapidSell(checked);
                        if (checked) setAutoSell50Percent(false); // Mutually exclusive
                      }}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '14px', fontWeight: '500' }}>
                      ⚡ Auto Rapid Sell All (starts immediately after launch to beat bots)
                    </span>
                  </label>
                  <p style={{ margin: '5px 0 0 28px', fontSize: '12px', color: '#666' }}>
                    {autoRapidSell 
                      ? '✅ Enabled - Rapid sell will start automatically after token launch completes (sells from ALL wallets including dev)' 
                      : '❌ Disabled - You will need to manually trigger rapid sell'}
                  </p>
                </div>

                <div className="auto-action-toggle" style={{ marginBottom: '10px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '10px' }}>
                    <input
                      type="checkbox"
                      checked={autoSell50Percent}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setAutoSell50Percent(checked);
                        if (checked) setAutoRapidSell(false); // Mutually exclusive
                      }}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '14px', fontWeight: '500' }}>
                      ⚡ Auto Sell 50% (sells 100% from half bundler wallets, excludes dev wallet)
                    </span>
                  </label>
                  <p style={{ margin: '5px 0 0 28px', fontSize: '12px', color: '#666' }}>
                    {autoSell50Percent 
                      ? '✅ Enabled - Will automatically sell 100% from half the bundler wallets (dev wallet excluded)' 
                      : '❌ Disabled - You will need to manually trigger sell 50%'}
                  </p>
                </div>

                <div className="auto-action-toggle" style={{ marginBottom: '10px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '10px' }}>
                    <input
                      type="checkbox"
                      checked={autoGather}
                      onChange={(e) => setAutoGather(e.target.checked)}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '14px', fontWeight: '500' }}>
                      💰 Auto Gather (recover SOL after rapid sell)
                    </span>
                  </label>
                  <p style={{ margin: '5px 0 0 28px', fontSize: '12px', color: '#666' }}>
                    {autoGather 
                      ? '✅ Enabled - SOL will be gathered automatically after rapid sell' 
                      : '❌ Disabled - You will need to manually gather SOL'}
                  </p>
                </div>

                <div className="auto-action-toggle">
                  <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '10px' }}>
                    <input
                      type="checkbox"
                      checked={autoCollectFees}
                      onChange={(e) => setAutoCollectFees(e.target.checked)}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '14px', fontWeight: '500' }}>
                      💵 Auto Collect Fees (collect creator fees after rapid sell)
                    </span>
                  </label>
                  <p style={{ margin: '5px 0 0 28px', fontSize: '12px', color: '#666' }}>
                    {autoCollectFees 
                      ? '✅ Enabled - Creator fees will be collected automatically after rapid sell' 
                      : '❌ Disabled - You will need to manually collect fees'}
                  </p>
                </div>
              </div>
              
              <div className="button-group">
                <button 
                  onClick={reloadConfig} 
                  disabled={loading}
                  className="btn btn-secondary"
                  style={{ marginRight: '10px' }}
                  title="Reload saved configuration from server (discards unsaved changes)"
                >
                  🔄 Reload Config
                </button>
                <button 
                  onClick={updateConfig} 
                  disabled={loading}
                  className="btn btn-secondary"
                  style={{ marginRight: '10px' }}
                >
                  💾 Save Configuration
                </button>
                <button 
                  onClick={launchToken} 
                  disabled={loading || !tokenForm.tokenName || !tokenForm.tokenSymbol || !tokenForm.description}
                  className="btn btn-primary"
                >
                  {loading ? 'Launching...' : '🚀 Launch Token'}
                </button>
              </div>
              <div style={{ marginTop: '10px', padding: '10px', backgroundColor: '#e8f4f8', borderRadius: '5px', fontSize: '12px', color: '#555' }}>
                <strong>💡 How Config Works:</strong>
                <ul style={{ margin: '5px 0', paddingLeft: '20px' }}>
                  <li><strong>Auto-loads</strong> when you open the page (from your saved .env file)</li>
                  <li><strong>Save Configuration</strong> - Saves all your current settings to the server</li>
                  <li><strong>Reload Config</strong> - Discards unsaved changes and reloads from server</li>
                  <li>Config is saved in your <code>.env</code> file and persists between sessions</li>
                </ul>
              </div>
            </div>
          )}

          {activeTab === 'gather' && (
            <div className="form-section">
              <h2>Gather & Sell</h2>
              <p className="info-text">
                After launching a token, use these options to recover SOL and tokens from all wallets.
              </p>

              <div className="action-cards">
                <div className="action-card">
                  <h3>⚡ Rapid Sell All (Ultra-Fast)</h3>
                  <p>Sells tokens from ALL wallets in parallel (milliseconds speed). Uses Jupiter API. Fastest method!</p>
                  <button 
                    onClick={rapidSell} 
                    disabled={loading || !status.hasWallets}
                    className="btn btn-primary"
                    style={{ backgroundColor: '#ff6b6b', borderColor: '#ff6b6b' }}
                  >
                    {loading ? 'Processing...' : '⚡ RAPID SELL ALL'}
                  </button>
                </div>

                <div className="action-card">
                  <h3>⚡ Rapid Sell 50%</h3>
                  <p>Sells 100% of tokens from half the wallets, keeps the other half untouched. Staged sell strategy.</p>
                  <button 
                    onClick={async () => {
                      if (!window.confirm('⚡ RAPID SELL 50%: This will sell 100% from half the wallets, keeping the other half. Continue?')) {
                        return;
                      }
                      setLoading(true);
                      try {
                        const mintAddress = status.mintAddress || null;
                        const res = await axios.post(`${API_BASE}/api/rapid-sell-50-percent`, { mintAddress });
                        showMessage('success', '🚀 Rapid Sell 50% started! Selling from half the wallets. Check the API server console for progress...');
                      } catch (error) {
                        showMessage('error', error.response?.data?.error || 'Failed to start rapid sell 50%');
                        setLoading(false);
                      }
                    }}
                    disabled={loading || !status.hasWallets}
                    className="btn btn-primary"
                    style={{ backgroundColor: '#ff9500', borderColor: '#ff9500' }}
                  >
                    {loading ? 'Processing...' : '⚡ SELL 50%'}
                  </button>
                </div>

                <div className="action-card">
                  <h3>⚡ Rapid Sell Remaining</h3>
                  <p>Sells from the wallets that were kept in the 50% sell, plus the dev wallet. Run after 50% sell.</p>
                  <button 
                    onClick={async () => {
                      if (!window.confirm('⚡ RAPID SELL REMAINING: This will sell from kept wallets + dev wallet. Continue?')) {
                        return;
                      }
                      setLoading(true);
                      try {
                        const mintAddress = status.mintAddress || null;
                        const res = await axios.post(`${API_BASE}/api/rapid-sell-remaining`, { mintAddress });
                        showMessage('success', '🚀 Rapid Sell Remaining started! Selling from kept wallets + dev. Check the API server console for progress...');
                      } catch (error) {
                        showMessage('error', error.response?.data?.error || 'Failed to start rapid sell remaining');
                        setLoading(false);
                      }
                    }}
                    disabled={loading || !status.hasWallets}
                    className="btn btn-primary"
                    style={{ backgroundColor: '#ff9500', borderColor: '#ff9500' }}
                  >
                    {loading ? 'Processing...' : '⚡ SELL REMAINING'}
                  </button>
                </div>

                <div className="action-card">
                  <h3>💰 Gather All (Sell + SOL)</h3>
                  <p>Sells all tokens from all wallets and gathers remaining SOL back to main wallet.</p>
                  <button 
                    onClick={gatherTokens} 
                    disabled={loading || !status.hasWallets}
                    className="btn btn-primary"
                  >
                    {loading ? 'Processing...' : '💰 Gather All'}
                  </button>
                </div>

                <div className="action-card">
                  <h3>💰 Gather All Wallets</h3>
                  <p>Gathers SOL from ALL historical wallets (not just current run). Use to recover from all previous launches.</p>
                  <button 
                    onClick={async () => {
                      if (!window.confirm('💰 GATHER ALL WALLETS: This will gather SOL from ALL historical wallets. Continue?')) {
                        return;
                      }
                      setLoading(true);
                      try {
                        const res = await axios.post(`${API_BASE}/api/gather-all`);
                        showMessage('success', '💰 Gather All Wallets started! Recovering SOL from all historical wallets. Check the API server console for progress...');
                      } catch (error) {
                        showMessage('error', error.response?.data?.error || 'Failed to start gather all');
                        setLoading(false);
                      }
                    }}
                    disabled={loading}
                    className="btn btn-secondary"
                  >
                    {loading ? 'Processing...' : '💰 Gather All Wallets'}
                  </button>
                </div>

                <div className="action-card">
                  <h3>💰 Gather Last N Wallets</h3>
                  <p>Gathers SOL from the last N wallets. Enter number of wallets to gather from.</p>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <input
                      type="number"
                      id="gatherLastCount"
                      min="1"
                      max="100"
                      defaultValue="10"
                      style={{ width: '80px', padding: '5px' }}
                    />
                    <button 
                      onClick={async () => {
                        const countInput = document.getElementById('gatherLastCount');
                        const count = parseInt(countInput.value) || 10;
                        if (!window.confirm(`💰 GATHER LAST ${count} WALLETS: This will gather SOL from the last ${count} wallets. Continue?`)) {
                          return;
                        }
                        setLoading(true);
                        try {
                          const res = await axios.post(`${API_BASE}/api/gather-last`, { count });
                          showMessage('success', `💰 Gather Last ${count} Wallets started! Recovering SOL from last ${count} wallets. Check the API server console for progress...`);
                        } catch (error) {
                          showMessage('error', error.response?.data?.error || 'Failed to start gather last');
                          setLoading(false);
                        }
                      }}
                      disabled={loading}
                      className="btn btn-secondary"
                    >
                      {loading ? 'Processing...' : '💰 Gather Last N'}
                    </button>
                  </div>
                </div>

                <div className="action-card">
                  <h3>💵 Gather SOL Only</h3>
                  <p>Gathers remaining SOL from all wallets without selling tokens.</p>
                  <button 
                    onClick={gatherSol} 
                    disabled={loading || !status.hasWallets}
                    className="btn btn-secondary"
                  >
                    {loading ? 'Processing...' : '💵 Gather SOL'}
                  </button>
                </div>

                <div className="action-card">
                  <h3>💵 Collect Creator Fees</h3>
                  <p>Collects creator fees from all tokens created by your wallet using PumpPortal API.</p>
                  <button 
                    onClick={async () => {
                      if (!window.confirm('💵 COLLECT FEES: This will collect creator fees from all your tokens. Continue?')) {
                        return;
                      }
                      setLoading(true);
                      try {
                        const res = await axios.post(`${API_BASE}/api/collect-fees`);
                        showMessage('success', '💵 Collect Fees started! Collecting creator fees. Check the API server console for progress...');
                      } catch (error) {
                        showMessage('error', error.response?.data?.error || 'Failed to start collect fees');
                        setLoading(false);
                      }
                    }}
                    disabled={loading}
                    className="btn btn-secondary"
                  >
                    {loading ? 'Processing...' : '💵 Collect Fees'}
                  </button>
                </div>
              </div>

              {status.hasWallets && (
                <div className="info-box">
                  <p><strong>Current Status:</strong></p>
                  <p>• {status.walletCount} wallets found</p>
                  {status.mintAddress && (
                    <p>• Last mint: <a href={`https://pump.fun/${status.mintAddress}`} target="_blank" rel="noopener noreferrer">{status.mintAddress}</a> (View on Pump.fun)</p>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'trading' && (
            <TradingTerminal defaultMint={status.mintAddress} />
          )}

          {activeTab === 'profit' && status.mintAddress && (
            <ProfitDashboard 
              mintAddress={status.mintAddress}
              onQuickBuy={async (amount) => {
                // Quick buy handler - PROFIT FOCUS: Uses main wallet from .env
                setLoading(true);
                try {
                  const res = await axios.post(`${API_BASE}/api/trading/buy`, {
                    mintAddress: status.mintAddress,
                    solAmount: amount || 0.1
                    // No walletAddress = uses main wallet from .env (PROFIT FOCUS)
                  });
                  showMessage('success', `💰 Quick buy executed! ${res.data.message || ''}`);
                  // Refresh wallet status after buy
                  setTimeout(() => {
                    const event = new Event('refreshWalletStatus');
                    window.dispatchEvent(event);
                  }, 1000);
                } catch (error) {
                  showMessage('error', error.response?.data?.error || 'Quick buy failed');
                } finally {
                  setLoading(false);
                }
              }}
              onQuickSell={async (walletAddress) => {
                // Quick sell handler - PROFIT FOCUS: Uses main wallet from .env
                setLoading(true);
                try {
                  const res = await axios.post(`${API_BASE}/api/trading/sell`, {
                    walletAddress: walletAddress || undefined, // If provided, use it; otherwise use main wallet
                    mintAddress: status.mintAddress,
                    sellPercentage: 100 // Sell 100%
                  });
                  showMessage('success', `💰 Quick sell executed! ${res.data.message || ''}`);
                  // Refresh wallet status after sell
                  setTimeout(() => {
                    const event = new Event('refreshWalletStatus');
                    window.dispatchEvent(event);
                  }, 1000);
                } catch (error) {
                  showMessage('error', error.response?.data?.error || 'Quick sell failed');
                } finally {
                  setLoading(false);
                }
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default App;

