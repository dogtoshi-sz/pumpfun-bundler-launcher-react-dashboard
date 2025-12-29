import { useState, useEffect, useRef } from 'react';
import apiService from '../services/api';

export default function TokenLaunch({ onLaunch }) {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(false);
  const [nextAddress, setNextAddress] = useState(null);
  const [deployerWallet, setDeployerWallet] = useState(null);
  const [walletInfo, setWalletInfo] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [savingStatus, setSavingStatus] = useState('');
  const autoSaveTimeoutRef = useRef(null);

  useEffect(() => {
    loadSettings();
    loadNextAddress();
    loadDeployerWallet();
    loadWalletInfo();
  }, []);
  
  // Reload wallet info when settings change (wallet counts/amounts)
  useEffect(() => {
    if (Object.keys(settings).length > 0) {
      // Small delay to ensure settings are saved first
      const timer = setTimeout(() => {
        loadWalletInfo();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [settings.BUNDLE_WALLET_COUNT, settings.HOLDER_WALLET_COUNT, settings.BUNDLE_SWAP_AMOUNTS, settings.HOLDER_SWAP_AMOUNTS, settings.BUYER_WALLET, settings.BUYER_AMOUNT, settings.SWAP_AMOUNT, settings.HOLDER_WALLET_AMOUNT]);

  const loadSettings = async () => {
    try {
      const res = await apiService.getSettings();
      const loadedSettings = res.data.settings || {};
      setSettings(loadedSettings);
      
      // Restore image preview from saved FILE path
      if (loadedSettings.FILE && !imageFile) {
        // Convert relative path (./image/filename.jpg) to absolute URL
        const filePath = loadedSettings.FILE;
        if (filePath.startsWith('./image/') || filePath.startsWith('image/')) {
          const filename = filePath.replace(/^\.\/image\//, '').replace(/^image\//, '');
          // Use API server to serve the image
          setImagePreview(`http://localhost:3001/image/${filename}`);
        } else if (filePath.startsWith('http')) {
          // Already a full URL
          setImagePreview(filePath);
        }
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const loadNextAddress = async () => {
    try {
      const res = await apiService.getNextPumpAddress();
      setNextAddress(res.data);
    } catch (error) {
      console.error('Failed to load next address:', error);
    }
  };

  const loadDeployerWallet = async () => {
    try {
      const res = await apiService.getDeployerWallet();
      setDeployerWallet(res.data);
    } catch (error) {
      console.error('Failed to load deployer wallet:', error);
    }
  };

  const loadWalletInfo = async () => {
    try {
      const res = await apiService.getLaunchWalletInfo();
      setWalletInfo(res.data.data);
    } catch (error) {
      console.error('Failed to load wallet info:', error);
    }
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result);
      };
      reader.readAsDataURL(file);
    } else {
      // Clear preview if file input is cleared
      setImageFile(null);
      // Keep the saved image preview if settings.FILE exists
      if (!settings.FILE) {
        setImagePreview(null);
      }
    }
  };

  const uploadImage = async () => {
    if (!imageFile) return null;
    try {
      const res = await apiService.uploadImage(imageFile);
      return res.data.filePath;
    } catch (error) {
      console.error('Failed to upload image:', error);
      alert('Failed to upload image: ' + error.message);
      return null;
    }
  };

  const handleChange = (key, value) => {
    const newSettings = { ...settings, [key]: value };
    
    // Dynamic syncing between Count and Amounts
    if (key === 'BUNDLE_WALLET_COUNT') {
      const count = parseInt(value) || 0;
      const currentAmounts = settings.BUNDLE_SWAP_AMOUNTS || '';
      const amountsArray = currentAmounts ? currentAmounts.split(',').map(a => a.trim()).filter(a => a) : [];
      const defaultAmount = settings.SWAP_AMOUNT || '0.01';
      
      // If count increased, add default amounts for new wallets
      if (count > amountsArray.length) {
        while (amountsArray.length < count) {
          amountsArray.push(defaultAmount);
        }
        newSettings.BUNDLE_SWAP_AMOUNTS = amountsArray.join(',');
      } else if (count < amountsArray.length) {
        // If count decreased, remove excess amounts
        newSettings.BUNDLE_SWAP_AMOUNTS = amountsArray.slice(0, count).join(',');
      }
    } else if (key === 'BUNDLE_SWAP_AMOUNTS') {
      // When amounts change, update count to match number of amounts
      const amountsArray = value ? value.split(',').map(a => a.trim()).filter(a => a) : [];
      if (amountsArray.length > 0) {
        newSettings.BUNDLE_WALLET_COUNT = amountsArray.length.toString();
      }
    } else if (key === 'HOLDER_WALLET_COUNT') {
      const count = parseInt(value) || 0;
      const currentAmounts = settings.HOLDER_SWAP_AMOUNTS || '';
      const amountsArray = currentAmounts ? currentAmounts.split(',').map(a => a.trim()).filter(a => a) : [];
      const defaultAmount = settings.HOLDER_WALLET_AMOUNT || '0.01';
      
      // If count increased, add default amounts for new wallets
      if (count > amountsArray.length) {
        while (amountsArray.length < count) {
          amountsArray.push(defaultAmount);
        }
        newSettings.HOLDER_SWAP_AMOUNTS = amountsArray.join(',');
      } else if (count < amountsArray.length) {
        // If count decreased, remove excess amounts
        newSettings.HOLDER_SWAP_AMOUNTS = amountsArray.slice(0, count).join(',');
      }
    } else if (key === 'HOLDER_SWAP_AMOUNTS') {
      // When amounts change, update count to match number of amounts
      const amountsArray = value ? value.split(',').map(a => a.trim()).filter(a => a) : [];
      if (amountsArray.length > 0) {
        newSettings.HOLDER_WALLET_COUNT = amountsArray.length.toString();
      } else {
        // If amounts cleared, reset count to 0
        newSettings.HOLDER_WALLET_COUNT = '0';
      }
    }
    
    setSettings(newSettings);
    
    // Auto-save ALL settings immediately (with debounce to avoid too many API calls)
    // Use a small delay to batch multiple rapid changes
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    
    // Prepare all settings to save (including synced values)
    const settingsToSave = { [key]: value };
    
    // Include synced values for wallet config
    if (newSettings.BUNDLE_WALLET_COUNT !== settings.BUNDLE_WALLET_COUNT && key !== 'BUNDLE_WALLET_COUNT') {
      settingsToSave.BUNDLE_WALLET_COUNT = newSettings.BUNDLE_WALLET_COUNT;
    }
    if (newSettings.BUNDLE_SWAP_AMOUNTS !== settings.BUNDLE_SWAP_AMOUNTS && key !== 'BUNDLE_SWAP_AMOUNTS') {
      settingsToSave.BUNDLE_SWAP_AMOUNTS = newSettings.BUNDLE_SWAP_AMOUNTS;
    }
    if (newSettings.HOLDER_WALLET_COUNT !== settings.HOLDER_WALLET_COUNT && key !== 'HOLDER_WALLET_COUNT') {
      settingsToSave.HOLDER_WALLET_COUNT = newSettings.HOLDER_WALLET_COUNT;
    }
    if (newSettings.HOLDER_SWAP_AMOUNTS !== settings.HOLDER_SWAP_AMOUNTS && key !== 'HOLDER_SWAP_AMOUNTS') {
      settingsToSave.HOLDER_SWAP_AMOUNTS = newSettings.HOLDER_SWAP_AMOUNTS;
    }
    
    // Debounce: Save after 500ms of no changes (reduces API calls)
    setSavingStatus(`Saving ${key}...`);
    autoSaveTimeoutRef.current = setTimeout(() => {
      console.log(`[Frontend] Attempting to save:`, settingsToSave);
      apiService.updateSettings(settingsToSave)
        .then((response) => {
          const savedKeys = Object.keys(settingsToSave).join(', ');
          console.log(`✅ Auto-saved: ${savedKeys}`, settingsToSave);
          console.log(`[Frontend] API Response:`, response.data);
          setSavingStatus(`✅ Saved ${savedKeys}`);
          setTimeout(() => setSavingStatus(''), 2000); // Clear status after 2 seconds
          // Reload wallet info if wallet-related settings changed
          if (['BUNDLE_WALLET_COUNT', 'BUNDLE_SWAP_AMOUNTS', 'HOLDER_WALLET_COUNT', 'HOLDER_SWAP_AMOUNTS', 'HOLDER_WALLET_AMOUNT', 'BUYER_AMOUNT', 'SWAP_AMOUNT'].includes(key)) {
            setTimeout(() => loadWalletInfo(), 300);
          }
        })
        .catch(err => {
          console.error('❌ Failed to auto-save setting:', key, '=', value, err);
          console.error('Error details:', err.response?.data || err.message);
          setSavingStatus(`❌ Failed to save ${key}`);
          setTimeout(() => setSavingStatus(''), 5000); // Show error for 5 seconds
          // Show alert for critical fields (token info) so user knows save failed
          if (['TOKEN_NAME', 'TOKEN_SYMBOL', 'DESCRIPTION'].includes(key)) {
            alert(`⚠️ Failed to save ${key}. Please click "💾 Save Settings" button.\n\nError: ${err.response?.data?.error || err.message}`);
          }
        });
    }, 500);
  };

  const handleSaveSettings = async () => {
    setLoading(true);
    try {
      // Upload image if selected
      let filePath = settings.FILE;
      let settingsToSave = { ...settings }; // Start with current settings
      
      if (imageFile) {
        filePath = await uploadImage();
        if (!filePath) {
          setLoading(false);
          return;
        }
        // Add FILE to settings that will be saved
        settingsToSave.FILE = filePath;
        
        // Update state
        setSettings(settingsToSave);
        
        // Update image preview to use the saved path
        const filename = filePath.replace(/^\.\/image\//, '').replace(/^image\//, '');
        setImagePreview(`http://localhost:3001/image/${filename}`);
        // Clear imageFile so it doesn't re-upload on next save
        setImageFile(null);
      }

      // Save settings (use settingsToSave which includes the FILE path if image was uploaded)
      await apiService.updateSettings(settingsToSave);
      alert('Settings saved successfully!');
    } catch (error) {
      alert('Failed to save settings: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleLaunch = async () => {
    if (!settings.TOKEN_NAME || !settings.TOKEN_SYMBOL || !settings.DESCRIPTION) {
      alert('Please fill in Token Name, Symbol, and Description');
      return;
    }

    setLoading(true);
    try {
      // Upload image if selected
      let filePath = settings.FILE;
      let settingsToSave = { ...settings }; // Start with current settings
      
      if (imageFile) {
        filePath = await uploadImage();
        if (!filePath) {
          setLoading(false);
          return;
        }
        // Add FILE to settings that will be saved
        settingsToSave.FILE = filePath;
        // Update state
        setSettings(settingsToSave);
      }

      // Save settings (use settingsToSave which includes the FILE path if image was uploaded)
      await apiService.updateSettings(settingsToSave);

      // Launch token - this will clear current-run.json and start fresh
      const res = await apiService.launchToken();
      
      // Clear wallet info immediately (since current-run.json was cleared)
      setWalletInfo(null);
      
      // Wait for launch to complete - poll for status
      // Token launches can take 2-5 minutes (wallet creation, bundle submission, confirmation)
      let attempts = 0;
      const maxAttempts = 600; // Wait up to 10 minutes (1 second intervals = 600 seconds)
      const checkInterval = 2000; // Check every 2 seconds (reduce API calls)
      
      const checkLaunchComplete = async () => {
        try {
          const runRes = await apiService.getCurrentRun();
          const currentRun = runRes.data.data;
          
          // Check launch status
          if (currentRun) {
            if (currentRun.launchStatus === 'SUCCESS') {
              // Launch completed successfully!
              console.log('✅ Launch completed successfully!');
              await loadWalletInfo();
              if (onLaunch) onLaunch();
              setLoading(false);
              alert('✅ Token launched successfully!');
              return;
            } else if (currentRun.launchStatus === 'FAILED') {
              // Launch failed
              console.error('❌ Launch failed:', currentRun.failureReason);
              setLoading(false);
              alert(`❌ Launch failed: ${currentRun.failureReason || 'Unknown error'}\n\nCheck terminal for details.`);
              return;
            } else if (currentRun.launchStatus === 'PENDING') {
              // Launch in progress - check if we have wallets (means wallets are created, waiting for bundle)
              const hasWallets = (currentRun.bundleWalletKeys && currentRun.bundleWalletKeys.length > 0) ||
                                 (currentRun.holderWalletKeys && currentRun.holderWalletKeys.length > 0) ||
                                 (currentRun.walletKeys && currentRun.walletKeys.length > 0);
              
              if (hasWallets && currentRun.mintAddress) {
                // Wallets created and mint exists - launch is in final stages (bundle submission/confirmation)
                console.log(`⏳ Launch in progress... (${attempts * checkInterval / 1000}s elapsed)`);
              } else {
                // Still creating wallets
                console.log(`⏳ Launch starting... (${attempts * checkInterval / 1000}s elapsed)`);
              }
            } else if (currentRun.mintAddress && 
                       ((currentRun.bundleWalletKeys && currentRun.bundleWalletKeys.length > 0) ||
                        (currentRun.holderWalletKeys && currentRun.holderWalletKeys.length > 0) ||
                        (currentRun.walletKeys && currentRun.walletKeys.length > 0))) {
              // Legacy check: has mintAddress and wallets but no launchStatus (old format)
              // Assume success
              console.log('✅ Launch completed (legacy format)!');
              await loadWalletInfo();
              if (onLaunch) onLaunch();
              setLoading(false);
              alert('✅ Token launched successfully!');
              return;
            }
          }
          
          attempts++;
          const elapsedSeconds = Math.floor(attempts * checkInterval / 1000);
          
          // Show progress every 30 seconds
          if (elapsedSeconds > 0 && elapsedSeconds % 30 === 0) {
            console.log(`⏳ Launch in progress... (${elapsedSeconds}s / ${maxAttempts * checkInterval / 1000}s)`);
          }
          
          if (attempts < maxAttempts) {
            setTimeout(checkLaunchComplete, checkInterval);
          } else {
            // Timeout after 10 minutes
            const elapsedMinutes = Math.floor(elapsedSeconds / 60);
            console.warn(`⚠️ Launch timeout after ${elapsedMinutes} minutes`);
            setLoading(false);
            alert(`⏳ Launch is taking longer than expected (${elapsedMinutes} minutes).\n\nIt may still be in progress. Check the API server terminal for updates.\n\nYou can refresh the page to check status manually.`);
          }
        } catch (error) {
          // current-run.json might not exist yet (launch just started)
          attempts++;
          const elapsedSeconds = Math.floor(attempts * checkInterval / 1000);
          
          if (attempts < maxAttempts) {
            // Show progress every 30 seconds even when file doesn't exist
            if (elapsedSeconds > 0 && elapsedSeconds % 30 === 0) {
              console.log(`⏳ Waiting for launch to start... (${elapsedSeconds}s)`);
            }
            setTimeout(checkLaunchComplete, checkInterval);
          } else {
            setLoading(false);
            alert('⏳ Launch is taking longer than expected. Check the API server terminal for progress.\n\nYou can refresh the page to check status manually.');
          }
        }
      };
      
      // Start checking after 3 seconds (give launch time to start and create current-run.json)
      setTimeout(checkLaunchComplete, 3000);
      
    } catch (error) {
      alert('Failed to launch token: ' + (error.response?.data?.error || error.message));
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-800 rounded-lg p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white">🚀 Launch Token</h2>
        {savingStatus && (
          <div className={`text-sm px-3 py-1 rounded ${
            savingStatus.startsWith('✅') ? 'bg-green-900/50 text-green-400' : 
            savingStatus.startsWith('❌') ? 'bg-red-900/50 text-red-400' : 
            'bg-blue-900/50 text-blue-400'
          }`}>
            {savingStatus}
          </div>
        )}
      </div>

      {/* Next Pump Address */}
      {nextAddress && (
        <div className="mb-6 p-4 bg-slate-700 rounded-lg">
          <p className="text-sm text-slate-300 mb-1">Next Pump Address</p>
          {nextAddress.address ? (
            <p className="text-sm font-mono text-white">{nextAddress.address}</p>
          ) : (
            <p className="text-sm text-yellow-400">{nextAddress.source}</p>
          )}
        </div>
      )}

      <div className="space-y-4">
        {/* Token Name */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Token Name *
          </label>
          <input
            type="text"
            value={settings.TOKEN_NAME || ''}
            onChange={(e) => handleChange('TOKEN_NAME', e.target.value)}
            className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="My Awesome Token"
          />
        </div>

        {/* Token Symbol */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Token Symbol *
          </label>
          <input
            type="text"
            value={settings.TOKEN_SYMBOL || ''}
            onChange={(e) => handleChange('TOKEN_SYMBOL', e.target.value.toUpperCase())}
            className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="MAT"
            maxLength={10}
          />
        </div>

        {/* Show Name */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Show Name
          </label>
          <input
            type="text"
            value={settings.TOKEN_SHOW_NAME || ''}
            onChange={(e) => handleChange('TOKEN_SHOW_NAME', e.target.value)}
            className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Display name (optional)"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Description *
          </label>
          <textarea
            value={settings.DESCRIPTION || ''}
            onChange={(e) => handleChange('DESCRIPTION', e.target.value)}
            rows={4}
            className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Describe your token..."
          />
        </div>

        {/* Social Links */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Twitter
            </label>
            <input
              type="text"
              value={settings.TWITTER || ''}
              onChange={(e) => handleChange('TWITTER', e.target.value)}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="@username"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Telegram
            </label>
            <input
              type="text"
              value={settings.TELEGRAM || ''}
              onChange={(e) => handleChange('TELEGRAM', e.target.value)}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="t.me/..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Website
            </label>
            <input
              type="text"
              value={settings.WEBSITE || ''}
              onChange={(e) => handleChange('WEBSITE', e.target.value)}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="https://..."
            />
          </div>
        </div>

        {/* Image Upload */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Token Image
          </label>
          <div className="flex items-center gap-4">
            <input
              type="file"
              accept="image/*"
              onChange={handleImageChange}
              className="block w-full text-sm text-slate-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-500 file:text-white hover:file:bg-blue-600"
            />
            {imagePreview && (
              <img src={imagePreview} alt="Preview" className="w-20 h-20 object-cover rounded-lg" />
            )}
          </div>
          {settings.FILE && !imageFile && (
            <p className="mt-2 text-xs text-slate-400">Current: {settings.FILE}</p>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4">
          <button
            onClick={handleSaveSettings}
            disabled={loading}
            className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Saving...' : '💾 Save Settings'}
          </button>
          <button
            onClick={handleLaunch}
            disabled={loading}
            className="flex-1 py-3 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-bold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Launching...' : '🚀 Launch Token'}
          </button>
        </div>
      </div>

      {/* Wallet Configuration & Fee Breakdown */}
      <div className="mt-8 space-y-4">
        <h3 className="text-xl font-bold text-white mb-4">💰 Wallet Configuration</h3>
        
        {/* Wallet Configuration Fields */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* Bundle Wallets */}
          <div className="p-4 bg-slate-700 rounded-lg border-l-4 border-green-500">
            <label className="block text-sm font-semibold text-green-400 mb-3">📦 Bundle Wallets</label>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Count</label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={settings.BUNDLE_WALLET_COUNT || '0'}
                  onChange={(e) => handleChange('BUNDLE_WALLET_COUNT', e.target.value)}
                  className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Amounts (comma-separated SOL)</label>
                <input
                  type="text"
                  value={settings.BUNDLE_SWAP_AMOUNTS || ''}
                  onChange={(e) => handleChange('BUNDLE_SWAP_AMOUNTS', e.target.value)}
                  placeholder="0.1,0.1,0.2"
                  className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <p className="text-xs text-slate-500 mt-1">Leave empty to use SWAP_AMOUNT for all</p>
              </div>
            </div>
          </div>

          {/* Holder Wallets */}
          <div className="p-4 bg-slate-700 rounded-lg border-l-4 border-yellow-500">
            <label className="block text-sm font-semibold text-yellow-400 mb-3">👥 Holder Wallets</label>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Count</label>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={settings.HOLDER_WALLET_COUNT || '0'}
                  onChange={(e) => handleChange('HOLDER_WALLET_COUNT', e.target.value)}
                  className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Amounts (comma-separated SOL)</label>
                <input
                  type="text"
                  value={settings.HOLDER_SWAP_AMOUNTS || ''}
                  onChange={(e) => handleChange('HOLDER_SWAP_AMOUNTS', e.target.value)}
                  placeholder="0.01,0.01,0.02"
                  className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
                />
                <p className="text-xs text-slate-500 mt-1">Leave empty to use Amount per Wallet for all</p>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Amount per Wallet (SOL)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={settings.HOLDER_WALLET_AMOUNT || '0.01'}
                  onChange={(e) => handleChange('HOLDER_WALLET_AMOUNT', e.target.value)}
                  className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
                />
                <p className="text-xs text-slate-500 mt-1">Used when Amounts field is empty</p>
              </div>
            </div>
          </div>

          {/* DEV Buy */}
          <div className="p-4 bg-slate-700 rounded-lg border-l-4 border-purple-500">
            <label className="block text-sm font-semibold text-purple-400 mb-3">🎨 DEV Buy Amount</label>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Amount (SOL)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={settings.BUYER_AMOUNT || '0.1'}
                onChange={(e) => handleChange('BUYER_AMOUNT', e.target.value)}
                className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
          </div>
        </div>

        {/* Wallet Info & Fee Breakdown */}
        {walletInfo && (
          <div className="space-y-4">
            {/* Funding Wallet */}
            <div className="p-4 bg-slate-700 rounded-lg border-l-4 border-blue-500">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm font-semibold text-blue-400 mb-1">💰 {walletInfo.fundingWallet.label}</p>
                  <p className="text-xs font-mono text-slate-300">{walletInfo.fundingWallet.address.substring(0, 8)}...{walletInfo.fundingWallet.address.substring(walletInfo.fundingWallet.address.length - 8)}</p>
                  {walletInfo.fundingWallet.privateKey && (
                    <p className="text-xs font-mono text-slate-400 mt-1" title="Private Key (shortened for security)">
                      🔑 {walletInfo.fundingWallet.privateKey}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-400">Current Balance</p>
                  <p className={`text-lg font-bold ${walletInfo.fundingWallet.balance >= walletInfo.breakdown.total ? 'text-green-400' : 'text-red-400'}`}>
                    {walletInfo.fundingWallet.balance.toFixed(4)} SOL
                  </p>
                </div>
              </div>
            </div>

            {/* Creator/DEV Wallet */}
            <div className="p-4 bg-slate-700 rounded-lg border-l-4 border-purple-500">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm font-semibold text-purple-400 mb-1">🎨 Creator/DEV Wallet</p>
                  <p className="text-xs font-mono text-slate-300">
                    {walletInfo.creatorDevWallet.isAutoCreated ? 'Will be auto-created' : walletInfo.creatorDevWallet.address.substring(0, 8) + '...' + walletInfo.creatorDevWallet.address.substring(walletInfo.creatorDevWallet.address.length - 8)}
                  </p>
                  {walletInfo.creatorDevWallet.privateKey && (
                    <p className="text-xs font-mono text-slate-400 mt-1" title="Private Key (shortened for security)">
                      🔑 {walletInfo.creatorDevWallet.privateKey}
                    </p>
                  )}
                  <p className="text-xs text-slate-400 mt-1">{walletInfo.creatorDevWallet.source}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-400">Will Fund</p>
                  <p className="text-sm font-bold text-purple-400">{walletInfo.buyerAmount.toFixed(4)} SOL</p>
                </div>
              </div>
            </div>

            {/* Bundle Wallets Summary */}
            {walletInfo.bundleWallets.count > 0 && (
              <div className="p-4 bg-slate-700 rounded-lg border-l-4 border-green-500">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="text-sm font-semibold text-green-400 mb-1">📦 {walletInfo.bundleWallets.label}</p>
                    <p className="text-xs text-slate-400">{walletInfo.bundleWallets.count} wallet(s)</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-400">Total</p>
                    <p className="text-sm font-bold text-green-400">{walletInfo.bundleWallets.totalSol.toFixed(4)} SOL</p>
                  </div>
                </div>
                <div className="mt-2 space-y-1">
                  {walletInfo.bundleWallets.amounts.map((amount, idx) => (
                    <div key={idx} className="flex justify-between text-xs">
                      <span className="text-slate-400">Bundle Wallet {idx + 1}:</span>
                      <span className="text-slate-300">{amount.toFixed(4)} SOL</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Holder Wallets Summary */}
            {walletInfo.holderWallets.count > 0 && (
              <div className="p-4 bg-slate-700 rounded-lg border-l-4 border-yellow-500">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="text-sm font-semibold text-yellow-400 mb-1">👥 {walletInfo.holderWallets.label}</p>
                    <p className="text-xs text-slate-400">{walletInfo.holderWallets.count} wallet(s)</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-400">Total</p>
                    <p className="text-sm font-bold text-yellow-400">{walletInfo.holderWallets.totalSol.toFixed(4)} SOL</p>
                  </div>
                </div>
                <div className="mt-2 space-y-1">
                  {walletInfo.holderWallets.amounts.map((amount, idx) => (
                    <div key={idx} className="flex justify-between text-xs">
                      <span className="text-slate-400">Holder Wallet {idx + 1}:</span>
                      <span className="text-slate-300">{amount.toFixed(4)} SOL</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Total SOL Required */}
            <div className="p-4 bg-gradient-to-r from-slate-700 to-slate-600 rounded-lg border-2 border-yellow-500">
              <div className="flex justify-between items-center mb-3">
                <p className="text-lg font-bold text-yellow-400">💎 Total SOL Required</p>
                <p className={`text-2xl font-bold ${walletInfo.fundingWallet.balance >= walletInfo.breakdown.total ? 'text-green-400' : 'text-red-400'}`}>
                  {walletInfo.breakdown.total.toFixed(4)} SOL
                </p>
              </div>
              <div className="space-y-1 text-xs border-t border-slate-500 pt-2">
                <div className="flex justify-between">
                  <span className="text-slate-400">Bundle Wallets:</span>
                  <span className="text-slate-300">{walletInfo.breakdown.bundleWallets.toFixed(4)} SOL</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Holder Wallets:</span>
                  <span className="text-slate-300">{walletInfo.breakdown.holderWallets.toFixed(4)} SOL</span>
                </div>
                {(walletInfo.breakdown.creatorDevWallet > 0 || walletInfo.breakdown.devBuyAmount > 0) && (
                  <>
                    {walletInfo.breakdown.creatorDevWallet > 0 && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">Creator/DEV Wallet Funding:</span>
                        <span className="text-slate-300">{walletInfo.breakdown.creatorDevWallet.toFixed(4)} SOL</span>
                      </div>
                    )}
                    {walletInfo.breakdown.devBuyAmount > 0 && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">DEV Buy Amount:</span>
                        <span className="text-slate-300">{walletInfo.breakdown.devBuyAmount.toFixed(4)} SOL</span>
                      </div>
                    )}
                  </>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-400">Jito Fee:</span>
                  <span className="text-slate-300">{walletInfo.breakdown.jitoFee.toFixed(4)} SOL</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">LUT Creation:</span>
                  <span className="text-slate-300">{walletInfo.breakdown.lutFee.toFixed(4)} SOL</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Buffer:</span>
                  <span className="text-slate-300">{walletInfo.breakdown.buffer.toFixed(4)} SOL</span>
                </div>
              </div>
              {walletInfo.fundingWallet.balance < walletInfo.breakdown.total && (
                <div className="mt-3 p-2 bg-red-900/30 border border-red-500 rounded text-xs text-red-400">
                  ⚠️ Insufficient balance! Need {((walletInfo.breakdown.total - walletInfo.fundingWallet.balance).toFixed(4))} more SOL
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

