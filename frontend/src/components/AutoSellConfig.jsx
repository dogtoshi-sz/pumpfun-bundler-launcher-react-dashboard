import { useState, useEffect, useRef, useCallback } from 'react';
import {
  BoltIcon,
  CurrencyDollarIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CheckIcon,
  XMarkIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  TrashIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import { BoltIcon as BoltIconSolid } from '@heroicons/react/24/solid';
import apiService from '../services/api';

// Debounce helper
const useDebounce = (callback, delay) => {
  const timeoutRef = useRef(null);
  return useCallback((...args) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => callback(...args), delay);
  }, [callback, delay]);
};

// Wallet type badge colors
const WALLET_TYPE_COLORS = {
  DEV: { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30' },
  Bundle: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30' },
  Holder: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30' },
  Funding: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' },
  Warmed: { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30' },
};

// Individual wallet auto-sell row (pre-launch configuration)
const WalletAutoSellRow = ({ wallet, index, config, onChange }) => {
  const [threshold, setThreshold] = useState(config?.threshold || '');
  const [enabled, setEnabled] = useState(config?.enabled !== false);
  
  // Check if this is a placeholder wallet (not yet created)
  const isPlaceholder = wallet.placeholder === true || wallet.address?.startsWith('bundle-') || wallet.address?.startsWith('holder-');
  
  useEffect(() => {
    setThreshold(config?.threshold || '');
    setEnabled(config?.enabled !== false);
  }, [config]);

  const handleThresholdChange = (value) => {
    setThreshold(value);
    // For placeholders, we still save the config by wallet index/type for later application
    onChange(wallet.address, parseFloat(value) || 0, enabled);
  };

  const handleToggle = () => {
    const newEnabled = !enabled;
    setEnabled(newEnabled);
    onChange(wallet.address, parseFloat(threshold) || 0, newEnabled);
  };

  // Determine wallet label and type
  const isWarmed = wallet.isWarmed || wallet.source === 'warmed';
  const walletType = wallet.type || 'Unknown';
  const colors = WALLET_TYPE_COLORS[isWarmed ? 'Warmed' : walletType] || WALLET_TYPE_COLORS.Holder;
  
  const walletLabel = walletType === 'DEV' ? '🎯 DEV' :
                      walletType === 'Bundle' ? `📦 B${wallet.index || index}` :
                      walletType === 'Holder' ? `👤 H${wallet.index || index}` :
                      walletType === 'Funding' ? '💰 FUND' :
                      `W${index}`;

  const isTriggered = config?.triggered;
  const hasThreshold = parseFloat(threshold) > 0;

  return (
    <div className={`flex items-center gap-2 p-2 rounded-lg transition-colors ${
      isTriggered ? 'bg-green-500/10 border border-green-500/30' :
      hasThreshold && enabled ? `${colors.bg} border ${colors.border}` :
      'bg-gray-800/50 border border-gray-700/50'
    }`}>
      {/* Wallet Label + Type Badge */}
      <div className="flex items-center gap-1 min-w-[80px]">
        <span className={`text-xs font-bold ${colors.text}`}>
          {walletLabel}
        </span>
        {isWarmed && (
          <span className="text-[10px]" title="Warmed wallet">🔥</span>
        )}
        {isPlaceholder && (
          <span className="text-[10px]" title="Will be created on launch">⏳</span>
        )}
      </div>
      
      {/* Wallet Address */}
      <div className="w-24 text-[10px] text-gray-500 font-mono truncate" title={isPlaceholder ? 'Created on launch' : wallet.address}>
        {isPlaceholder ? (
          <span className="italic text-gray-600">new wallet</span>
        ) : (
          <>{wallet.address?.slice(0, 4)}...{wallet.address?.slice(-4)}</>
        )}
      </div>
      
      {/* Threshold Input */}
      <div className="flex-1 flex items-center gap-1">
        <input
          type="number"
          value={threshold}
          onChange={(e) => handleThresholdChange(e.target.value)}
          placeholder="SOL"
          step="0.1"
          min="0"
          className="w-14 px-1.5 py-1 text-xs bg-gray-900 border border-gray-700 rounded 
                   text-white text-center focus:outline-none focus:border-blue-500"
          disabled={isTriggered}
        />
      </div>
      
      {/* Status/Actions */}
      {isTriggered ? (
        <span className="px-2 py-0.5 text-[10px] bg-green-500/20 text-green-400 rounded font-bold">
          ✓ SOLD
        </span>
      ) : (
        <div className="flex items-center gap-1">
          <button
            onClick={handleToggle}
            disabled={!hasThreshold}
            className={`p-1 rounded transition-colors ${
              hasThreshold && enabled
                ? 'bg-blue-600 hover:bg-blue-500 text-white'
                : 'bg-gray-700 text-gray-500'
            }`}
            title={enabled ? 'Auto-sell enabled' : 'Auto-sell disabled'}
          >
            {enabled ? (
              <CheckIcon className="w-3 h-3" />
            ) : (
              <XMarkIcon className="w-3 h-3" />
            )}
          </button>
          {/* SELL button only shows on Terminal page (after launch), not on pre-launch config */}
        </div>
      )}
    </div>
  );
};

export default function AutoSellConfig({ wallets: propWallets = [], onConfigChange }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [autoSellEnabled, setAutoSellEnabled] = useState(false);
  const [externalVolume, setExternalVolume] = useState(0);
  const [walletConfigs, setWalletConfigs] = useState({});
  const [loading, setLoading] = useState(false);
  const [presetThreshold, setPresetThreshold] = useState('1');
  const [wallets, setWallets] = useState(propWallets);
  const eventSourceRef = useRef(null);
  
  // MEV Protection settings
  const [mevProtection, setMevProtection] = useState({
    enabled: true,
    confirmationDelaySec: 3,
    launchCooldownSec: 5,
    rapidTraderWindowSec: 10,
  });
  const [showMevSettings, setShowMevSettings] = useState(false);
  const [inCooldown, setInCooldown] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [pendingSells, setPendingSells] = useState([]);

  // Filter out funding wallet - it shouldn't be in auto-sell list
  // DEV wallet IS included (user can configure auto-sell for it)
  const filterWallets = (walletList) => {
    return walletList.filter(w => 
      w.type !== 'Funding' && 
      w.type !== 'funding'
    );
  };

  // Load wallets from API if not provided via props
  const loadWallets = async () => {
    // If we have wallets from props (pre-launch config), use those
    if (propWallets.length > 0) {
      setWallets(filterWallets(propWallets));
      return;
    }
    
    // Otherwise try to load from API (post-launch, current-run.json exists)
    try {
      const response = await apiService.getHolderWallets();
      if (response.data.success && response.data.wallets) {
        // Filter out funding wallet from API response too
        const filtered = filterWallets(response.data.wallets.map(w => ({
          ...w,
          type: w.type?.charAt(0).toUpperCase() + w.type?.slice(1) || 'Unknown' // Normalize type casing
        })));
        setWallets(filtered);
      }
    } catch (err) {
      console.error('Failed to load wallets:', err);
    }
  };

  // Load initial config
  useEffect(() => {
    loadConfig();
    loadWallets();
    
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  // Update wallets when props change - this is key for pre-launch config
  useEffect(() => {
    // Always update from props when they change (even if 0 wallets - user might be configuring)
    setWallets(filterWallets(propWallets));
  }, [propWallets, propWallets.length]);

  // Connect to SSE for live updates
  useEffect(() => {
    if (autoSellEnabled && !eventSourceRef.current) {
      connectToEvents();
    }
    
    return () => {
      if (!autoSellEnabled && eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [autoSellEnabled]);

  const loadConfig = async () => {
    try {
      // First load from .env for persistent settings
      const envResponse = await apiService.getSettings();
      if (envResponse.data.success && envResponse.data.settings) {
        const env = envResponse.data.settings;
        
        // Load auto-sell enabled from .env
        if (env.AUTO_SELL_ENABLED !== undefined) {
          const envEnabled = env.AUTO_SELL_ENABLED === 'true' || env.AUTO_SELL_ENABLED === true;
          setAutoSellEnabled(envEnabled);
        }
        
        // Load default threshold from .env
        if (env.AUTO_SELL_DEFAULT_THRESHOLD) {
          setPresetThreshold(env.AUTO_SELL_DEFAULT_THRESHOLD);
        }
        
        // Load MEV protection settings from .env
        const envMev = {
          enabled: env.AUTO_SELL_MEV_ENABLED === 'true' || env.AUTO_SELL_MEV_ENABLED === true,
          confirmationDelaySec: parseFloat(env.AUTO_SELL_MEV_CONFIRMATION_DELAY) || 3,
          launchCooldownSec: parseFloat(env.AUTO_SELL_MEV_LAUNCH_COOLDOWN) || 5,
          rapidTraderWindowSec: parseFloat(env.AUTO_SELL_MEV_RAPID_WINDOW) || 10,
        };
        setMevProtection(envMev);
      }
      
      // Then load runtime state from backend
      const response = await apiService.getAutoSellConfig();
      if (response.data.success) {
        setAutoSellEnabled(response.data.enabled);
        setExternalVolume(response.data.externalNetVolume || 0);
        setWalletConfigs(response.data.wallets || {});
        
        // Merge MEV protection (backend might have more current state)
        if (response.data.mevProtection) {
          setMevProtection(prev => ({ ...prev, ...response.data.mevProtection }));
        }
        setInCooldown(response.data.inCooldown || false);
        setCooldownRemaining(response.data.cooldownRemaining || 0);
        setPendingSells(response.data.pendingSells || []);
      }
    } catch (err) {
      console.error('Failed to load auto-sell config:', err);
    }
  };

  const connectToEvents = () => {
    const eventSource = new EventSource('/api/auto-sell/events');
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'volumeUpdate') {
          setExternalVolume(data.externalNetVolume || 0);
          // Update cooldown status if present
          if (data.inCooldown !== undefined) {
            setInCooldown(data.inCooldown);
            setCooldownRemaining(data.cooldownRemaining || 0);
          }
        } else if (data.type === 'sellTriggered' || data.type === 'sellComplete' || data.type === 'sellFailed' || data.type === 'sellCancelled') {
          // Reload config to get updated triggered status
          loadConfig();
        } else if (data.type === 'config') {
          setAutoSellEnabled(data.enabled);
          setExternalVolume(data.externalNetVolume || 0);
          setWalletConfigs(data.wallets || {});
          if (data.mevProtection) setMevProtection(data.mevProtection);
          setPendingSells(data.pendingSells || []);
        }
      } catch (e) {
        console.error('Failed to parse auto-sell event:', e);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      eventSourceRef.current = null;
      // Reconnect after 5 seconds
      setTimeout(() => {
        if (autoSellEnabled) {
          connectToEvents();
        }
      }, 5000);
    };

    eventSourceRef.current = eventSource;
  };

  const handleWalletConfigChange = async (walletAddress, threshold, enabled) => {
    const addr = walletAddress.toLowerCase();
    const newConfigs = {
      ...walletConfigs,
      [addr]: { threshold, enabled, triggered: walletConfigs[addr]?.triggered || false },
    };
    setWalletConfigs(newConfigs);
    
    // Debounced save
    try {
      await apiService.configureAutoSell(walletAddress, threshold, enabled);
    } catch (err) {
      console.error('Failed to save auto-sell config:', err);
    }
  };

  const handleToggleGlobal = async () => {
    setLoading(true);
    try {
      const newEnabled = !autoSellEnabled;
      await apiService.toggleAutoSell(newEnabled);
      setAutoSellEnabled(newEnabled);
      
      // Persist to .env
      await apiService.updateSettings({
        AUTO_SELL_ENABLED: newEnabled.toString(),
      });
      
      if (newEnabled) {
        connectToEvents();
      }
    } catch (err) {
      console.error('Failed to toggle auto-sell:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    setLoading(true);
    try {
      await apiService.resetAutoSell();
      setExternalVolume(0);
      loadConfig();
    } catch (err) {
      console.error('Failed to reset auto-sell:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleMevSettingChange = async (key, value) => {
    const newSettings = { ...mevProtection, [key]: value };
    setMevProtection(newSettings);
    
    try {
      await apiService.setMevProtection(newSettings);
      
      // Persist to .env (debounced to avoid spam)
      const envUpdates = {};
      if (key === 'enabled') {
        envUpdates.AUTO_SELL_MEV_ENABLED = value.toString();
      } else if (key === 'confirmationDelaySec') {
        envUpdates.AUTO_SELL_MEV_CONFIRMATION_DELAY = value.toString();
      } else if (key === 'launchCooldownSec') {
        envUpdates.AUTO_SELL_MEV_LAUNCH_COOLDOWN = value.toString();
      } else if (key === 'rapidTraderWindowSec') {
        envUpdates.AUTO_SELL_MEV_RAPID_WINDOW = value.toString();
      }
      
      if (Object.keys(envUpdates).length > 0) {
        await apiService.updateSettings(envUpdates);
      }
    } catch (err) {
      console.error('Failed to save MEV protection settings:', err);
    }
  };

  const handleApplyPreset = async () => {
    const threshold = parseFloat(presetThreshold) || 0;
    if (threshold <= 0) return;

    // Apply same threshold to all holder/bundle wallets (not DEV or Funding)
    const newConfigs = {};
    for (const wallet of wallets) {
      if (wallet.type !== 'DEV' && wallet.type !== 'Funding') {
        newConfigs[wallet.address.toLowerCase()] = {
          threshold,
          enabled: true,
          triggered: false,
        };
      }
    }

    setLoading(true);
    try {
      await apiService.configureAllAutoSell(newConfigs, true);
      setWalletConfigs(newConfigs);
      setAutoSellEnabled(true);
      
      // Persist default threshold and enabled state to .env
      await apiService.updateSettings({
        AUTO_SELL_DEFAULT_THRESHOLD: threshold.toString(),
        AUTO_SELL_ENABLED: 'true',
      });
    } catch (err) {
      console.error('Failed to apply preset:', err);
    } finally {
      setLoading(false);
    }
  };

  // Note: Actual selling happens on Terminal page after launch, not here
  // This component is just for PRE-CONFIGURING thresholds before launch

  // Count configured wallets
  const configuredCount = Object.values(walletConfigs).filter(c => c.enabled && c.threshold > 0).length;
  const triggeredCount = Object.values(walletConfigs).filter(c => c.triggered).length;

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${autoSellEnabled ? 'bg-green-500/20' : 'bg-gray-700/50'}`}>
            {autoSellEnabled ? (
              <BoltIconSolid className="w-5 h-5 text-green-400" />
            ) : (
              <BoltIcon className="w-5 h-5 text-gray-400" />
            )}
          </div>
          <div className="text-left">
            <h3 className="text-sm font-medium text-white flex items-center gap-2">
              Auto-Sell Configuration
              {autoSellEnabled && (
                <span className="px-1.5 py-0.5 text-[10px] bg-green-500/20 text-green-400 rounded">
                  ACTIVE
                </span>
              )}
              {configuredCount > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] bg-blue-500/20 text-blue-400 rounded">
                  {configuredCount} wallets
                </span>
              )}
            </h3>
            <p className="text-xs text-gray-500">
              Pre-set sell triggers for after wallets buy
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* External Volume Display - Shows net SOL from trades by external wallets */}
          {autoSellEnabled && (
            <div className="text-right" title="Net SOL bought by external wallets (not yours). Positive = more buys, Negative = more sells. Used for auto-sell triggers.">
              <div className="text-xs text-gray-500 flex items-center gap-1 justify-end">
                <span>Others' Net</span>
                <span className="text-[10px]" title="Net = Buys minus Sells from wallets that aren't yours">ℹ️</span>
              </div>
              <div className={`text-sm font-mono ${externalVolume >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {externalVolume >= 0 ? '+' : ''}{externalVolume.toFixed(4)} SOL
              </div>
            </div>
          )}
          <ChevronDownIcon 
            className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} 
          />
        </div>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="border-t border-gray-800 p-4 space-y-4">
          {/* Quick Preset */}
          <div className="flex items-center gap-2 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <BoltIcon className="w-4 h-4 text-blue-400 flex-shrink-0" />
            <span className="text-sm text-blue-300">Quick Setup:</span>
            <span className="text-xs text-gray-400">All wallets sell at</span>
            <input
              type="number"
              value={presetThreshold}
              onChange={(e) => setPresetThreshold(e.target.value)}
              step="0.5"
              min="0"
              className="w-14 px-1.5 py-1 text-xs bg-gray-900 border border-gray-700 rounded 
                       text-white text-center focus:outline-none focus:border-blue-500"
            />
            <span className="text-xs text-gray-400">SOL</span>
            <button
              onClick={handleApplyPreset}
              disabled={loading}
              className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
            >
              Apply
            </button>
          </div>

          {/* Global Toggle + Status */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              {/* Toggle Switch */}
              <button
                onClick={handleToggleGlobal}
                disabled={loading}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  autoSellEnabled ? 'bg-green-600' : 'bg-gray-600'
                }`}
                title={autoSellEnabled ? 'Auto-sell enabled' : 'Auto-sell disabled'}
              >
                <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                  autoSellEnabled ? 'translate-x-6' : 'translate-x-0.5'
                }`}>
                  {loading && (
                    <ArrowPathIcon className="w-4 h-4 animate-spin text-gray-500 m-0.5" />
                  )}
                </div>
              </button>
              
              <span className={`text-sm font-medium ${autoSellEnabled ? 'text-green-400' : 'text-gray-500'}`}>
                {autoSellEnabled ? 'Auto-Sell ON' : 'Auto-Sell OFF'}
              </span>
              
              {/* Reset Button */}
              <button
                onClick={handleReset}
                disabled={loading}
                className="flex items-center gap-1 px-2 py-1 bg-gray-700 hover:bg-gray-600 
                         text-gray-400 hover:text-gray-300 rounded text-xs transition-colors"
                title="Reset triggered states (keeps thresholds)"
              >
                <TrashIcon className="w-3 h-3" />
                Reset
              </button>
            </div>
            
            {/* Status */}
            <div className="flex items-center gap-2">
              {triggeredCount > 0 && (
                <span className="text-xs text-green-400 font-bold">{triggeredCount} sold</span>
              )}
              {wallets.length > 0 && (
                <span className="text-xs text-gray-500">
                  {wallets.filter(w => (walletConfigs[w.address]?.threshold || 0) > 0).length} active
                </span>
              )}
            </div>
          </div>

          {/* Per-Wallet Configuration */}
          <div className="space-y-1">
            <div className="text-xs font-medium text-gray-400 mb-2">
              Per-Wallet Thresholds (trigger sell when net external buys reach threshold)
            </div>
            
            {wallets.length === 0 ? (
              <div className="text-center py-4 text-gray-500 text-sm">
                <p className="mb-2">No wallets configured yet.</p>
                <p className="text-xs text-gray-600">
                  Set Bundle/Holder wallet counts above, or select warmed wallets.
                  <br/>
                  After launch, real wallet addresses will appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                {/* Group wallets by type for better organization */}
                {['DEV', 'Bundle', 'Holder'].map(type => {
                  const typeWallets = wallets.filter(w => w.type === type);
                  if (typeWallets.length === 0) return null;
                  
                  return (
                    <div key={type} className="mb-1">
                      <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-0.5 pl-1">
                        {type === 'DEV' ? '🎯 Dev Wallet' : type === 'Bundle' ? '📦 Bundle Wallets' : '👤 Holder Wallets'}
                      </div>
                      {typeWallets.map((wallet, index) => (
                        <WalletAutoSellRow
                          key={wallet.address}
                          wallet={wallet}
                          index={index + 1}
                          config={walletConfigs[wallet.address?.toLowerCase()]}
                          onChange={handleWalletConfigChange}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* MEV Protection Settings */}
          <div className="mt-3 p-2 bg-gray-800/30 rounded-lg border border-gray-700/50">
            <button
              onClick={() => setShowMevSettings(!showMevSettings)}
              className="w-full flex items-center justify-between text-xs font-medium text-gray-400 hover:text-gray-300"
            >
              <div className="flex items-center gap-2">
                <ExclamationTriangleIcon className="w-4 h-4 text-yellow-500" />
                <span>MEV Protection</span>
                {mevProtection.enabled && (
                  <span className="px-1.5 py-0.5 text-[9px] bg-yellow-500/20 text-yellow-400 rounded">
                    ON
                  </span>
                )}
              </div>
              {showMevSettings ? (
                <ChevronUpIcon className="w-4 h-4" />
              ) : (
                <ChevronDownIcon className="w-4 h-4" />
              )}
            </button>
            
            {showMevSettings && (
              <div className="mt-3 space-y-3">
                {/* Global Enable */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Enable Protection</span>
                  <button
                    onClick={() => handleMevSettingChange('enabled', !mevProtection.enabled)}
                    className={`relative w-10 h-5 rounded-full transition-colors ${
                      mevProtection.enabled ? 'bg-yellow-500' : 'bg-gray-700'
                    }`}
                  >
                    <div className={`absolute w-4 h-4 rounded-full bg-white top-0.5 transition-transform ${
                      mevProtection.enabled ? 'translate-x-5' : 'translate-x-0.5'
                    }`} />
                  </button>
                </div>
                
                {mevProtection.enabled && (
                  <>
                    {/* Confirmation Delay */}
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs text-gray-400">Confirmation Delay</span>
                        <p className="text-[10px] text-gray-600">
                          Wait X sec after threshold, re-check before selling
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={mevProtection.confirmationDelaySec}
                          onChange={(e) => handleMevSettingChange('confirmationDelaySec', parseFloat(e.target.value) || 0)}
                          className="w-12 px-1.5 py-1 text-xs bg-gray-900 border border-gray-700 rounded 
                                   text-white text-center focus:outline-none focus:border-yellow-500"
                          min="0"
                          max="30"
                          step="1"
                        />
                        <span className="text-xs text-gray-500">sec</span>
                      </div>
                    </div>
                    
                    {/* Launch Cooldown */}
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs text-gray-400">Launch Cooldown</span>
                        <p className="text-[10px] text-gray-600">
                          Wait X sec after first external trade before auto-sell
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={mevProtection.launchCooldownSec}
                          onChange={(e) => handleMevSettingChange('launchCooldownSec', parseFloat(e.target.value) || 0)}
                          className="w-12 px-1.5 py-1 text-xs bg-gray-900 border border-gray-700 rounded 
                                   text-white text-center focus:outline-none focus:border-yellow-500"
                          min="0"
                          max="60"
                          step="1"
                        />
                        <span className="text-xs text-gray-500">sec</span>
                      </div>
                    </div>
                    
                    {/* Rapid Trader Window */}
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs text-gray-400">MEV Detect Window</span>
                        <p className="text-[10px] text-gray-600">
                          If wallet buys+sells within X sec, flag as MEV bot
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={mevProtection.rapidTraderWindowSec}
                          onChange={(e) => handleMevSettingChange('rapidTraderWindowSec', parseFloat(e.target.value) || 0)}
                          className="w-12 px-1.5 py-1 text-xs bg-gray-900 border border-gray-700 rounded 
                                   text-white text-center focus:outline-none focus:border-yellow-500"
                          min="0"
                          max="60"
                          step="1"
                        />
                        <span className="text-xs text-gray-500">sec</span>
                      </div>
                    </div>
                  </>
                )}
                
                {/* Status indicators */}
                {(inCooldown || pendingSells.length > 0) && (
                  <div className="pt-2 border-t border-gray-700">
                    {inCooldown && (
                      <div className="flex items-center gap-2 text-yellow-400 text-xs">
                        <ArrowPathIcon className="w-3 h-3 animate-spin" />
                        <span>Launch cooldown: {cooldownRemaining.toFixed(1)}s remaining</span>
                      </div>
                    )}
                    {pendingSells.length > 0 && (
                      <div className="flex items-center gap-2 text-orange-400 text-xs mt-1">
                        <ArrowPathIcon className="w-3 h-3 animate-spin" />
                        <span>{pendingSells.length} sell(s) pending confirmation...</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="text-xs text-gray-500 p-2 bg-gray-800/50 rounded mt-3">
            <strong>Pre-launch settings:</strong> Set thresholds now. After launch, when cumulative NET 
            external buys (buys - sells from others) reaches a wallet's threshold, it auto-sells 100% of 
            that wallet's tokens. <br/><br/>
            <strong>🛡️ MEV Protection:</strong> Protects against bots that buy large → sell immediately. 
            Waits to confirm volume is real before triggering auto-sell.
          </div>
        </div>
      )}
    </div>
  );
}
