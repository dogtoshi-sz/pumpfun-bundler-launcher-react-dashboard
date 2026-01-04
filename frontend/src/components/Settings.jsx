import { useState, useEffect } from 'react';
import { 
  LockClosedIcon,
  CubeIcon,
  UserGroupIcon,
  Cog6ToothIcon,
  CpuChipIcon,
  RocketLaunchIcon,
  ArrowPathIcon,
  ArrowPathRoundedSquareIcon
} from '@heroicons/react/24/outline';
import apiService from '../services/api';

export default function Settings() {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showPrivateKeys, setShowPrivateKeys] = useState({});
  const [privateKeyChanges, setPrivateKeyChanges] = useState({});
  const [activeSection, setActiveSection] = useState('wallets');

  useEffect(() => {
    loadSettings();
    
    // Listen for section changes from sidebar
    const handleSectionChange = (e) => {
      setActiveSection(e.detail);
    };
    window.addEventListener('settings-section-change', handleSectionChange);
    return () => window.removeEventListener('settings-section-change', handleSectionChange);
  }, []);

  const loadSettings = async () => {
    try {
      const res = await apiService.getSettings();
      const loadedSettings = res.data.settings || {};
      setSettings(loadedSettings);
      setPrivateKeyChanges({});
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const handleChange = (key, value) => {
    setSettings({ ...settings, [key]: value });
    setSaved(false);
    
    if (key === 'PRIVATE_KEY' || key === 'BUYER_WALLET') {
      setPrivateKeyChanges(prev => ({ ...prev, [key]: true }));
    }
  };
  
  const toggleShowPrivateKey = (key) => {
    setShowPrivateKeys(prev => ({ ...prev, [key]: !prev[key] }));
  };
  
  const shortenPrivateKey = (key) => {
    if (!key || key.length <= 16) return key;
    return key.substring(0, 8) + '...' + key.substring(key.length - 8);
  };

  const handleSave = async () => {
    if (privateKeyChanges.PRIVATE_KEY || privateKeyChanges.BUYER_WALLET) {
      const changedKeys = [];
      if (privateKeyChanges.PRIVATE_KEY) changedKeys.push('PRIVATE_KEY (Main Funding Wallet)');
      if (privateKeyChanges.BUYER_WALLET) changedKeys.push('BUYER_WALLET (Buyer/Creator Wallet)');
      
      const confirmed = window.confirm(
        `⚠️ WARNING: You are about to change sensitive private keys:\n\n${changedKeys.join('\n')}\n\n` +
        `This will affect all future launches and operations.\n\n` +
        `Are you absolutely sure you want to proceed?`
      );
      
      if (!confirmed) {
        return;
      }
      
      if (settings.PRIVATE_KEY && settings.PRIVATE_KEY.trim() !== '') {
        const key = settings.PRIVATE_KEY.trim();
        if (key.length < 80 || key.length > 100) {
          alert('❌ Invalid PRIVATE_KEY length. Solana private keys should be ~88 characters (base58 encoded).');
          return;
        }
      }
      
      if (settings.BUYER_WALLET && settings.BUYER_WALLET.trim() !== '') {
        const key = settings.BUYER_WALLET.trim();
        if (key.length < 80 || key.length > 100) {
          alert('❌ Invalid BUYER_WALLET length. Solana private keys should be ~88 characters (base58 encoded).');
          return;
        }
      }
    }
    
    setLoading(true);
    try {
      await apiService.updateSettings(settings);
      setSaved(true);
      setPrivateKeyChanges({});
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      alert('Failed to save settings: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const sections = {
    wallets: {
      title: 'Wallet Private Keys',
      icon: LockClosedIcon,
      description: 'Configure your main funding wallet and creator wallet settings.',
      settings: [
        { 
          key: 'PRIVATE_KEY', 
          label: 'PRIVATE_KEY (Main Funding Wallet)', 
          type: 'password',
          required: true,
          description: 'Required: Main wallet that funds all operations'
        },
        { 
          key: 'BUYER_WALLET', 
          label: 'BUYER_WALLET (Buyer/Creator Wallet)', 
          type: 'password',
          required: false,
          description: 'Optional: Leave empty to auto-create DEV wallet for each launch'
        },
      ],
    },
    bundle: {
      title: 'Bundle Wallets',
      icon: CubeIcon,
      description: 'Configure bundle wallet settings for Jito bundling.',
      settings: [
        { key: 'BUNDLE_WALLET_COUNT', label: 'Bundle Wallet Count', type: 'number', description: 'Number of wallets to use in Jito bundle (5-6 recommended)' },
        { key: 'BUNDLE_SWAP_AMOUNTS', label: 'Bundle Swap Amounts (comma-separated)', type: 'text', description: 'Custom amounts per wallet, e.g., "0.4,0.5,0.7,1.0"' },
        { key: 'SWAP_AMOUNT', label: 'Default Swap Amount (SOL)', type: 'number', description: 'Default amount if BUNDLE_SWAP_AMOUNTS not specified' },
        { key: 'USE_NORMAL_LAUNCH', label: 'Use Normal Launch (No Jito, No LUT)', type: 'checkbox', description: 'Skip Jito bundling and LUT for simpler launches', icon: RocketLaunchIcon },
      ],
    },
    holders: {
      title: 'Holder Wallets',
      icon: UserGroupIcon,
      description: 'Configure holder wallets that buy separately to increase holder count.',
      settings: [
        { key: 'HOLDER_WALLET_COUNT', label: 'Holder Wallet Count', type: 'number', description: 'Number of holder wallets to create' },
        { key: 'HOLDER_WALLET_AMOUNT', label: 'Holder Wallet Amount (SOL)', type: 'number', description: 'Default amount for each holder wallet' },
        { key: 'HOLDER_SWAP_AMOUNTS', label: 'Holder Swap Amounts (comma-separated)', type: 'text', description: 'Custom amounts per holder wallet' },
      ],
    },
    options: {
      title: 'Options',
      icon: Cog6ToothIcon,
      description: 'Advanced options and features.',
      settings: [
        { key: 'VANITY_MODE', label: 'Vanity Mode', type: 'checkbox', description: 'Use vanity addresses ending with "pump"' },
        { key: 'LIL_JIT_MODE', label: 'Lil Jit Mode', type: 'checkbox', description: 'Use Lil Jito for bundle submission' },
        { 
          key: 'USE_MIXING_WALLETS', 
          label: 'Use Mixing Wallets (Break Connection Trail)', 
          type: 'checkbox',
          description: 'Routes SOL through intermediate wallets to prevent bubble maps from connecting your wallets. Default: Enabled for privacy. Requires mixing-wallets.json file.',
          icon: ArrowPathRoundedSquareIcon
        },
        { 
          key: 'CREATE_FRESH_MIXING_WALLETS', 
          label: 'Create Fresh Mixing Wallets Each Launch', 
          type: 'checkbox',
          description: 'Creates brand new mixing wallets for each launch (better privacy). If disabled, reuses existing mixing wallets. Default: Enabled.',
          icon: ArrowPathRoundedSquareIcon
        },
      ],
    },
    auto: {
      title: 'Auto Actions',
      icon: CpuChipIcon,
      description: 'Configure automatic actions after launch.',
      settings: [
        { key: 'AUTO_RAPID_SELL', label: 'Auto Rapid Sell', type: 'checkbox', description: 'Automatically sell tokens when threshold is met' },
        { key: 'AUTO_SELL_50_PERCENT', label: 'Auto Sell 50%', type: 'checkbox', description: 'Automatically sell 50% of holdings' },
        { key: 'AUTO_GATHER', label: 'Auto Gather', type: 'checkbox', description: 'Automatically gather SOL from all wallets' },
        { 
          key: 'WEBSOCKET_TRACKING_ENABLED', 
          label: 'WebSocket Tracking (Auto-Sell on External Buys)', 
          type: 'checkbox', 
          description: 'Monitor external buys via Helius WebSocket and auto-sell when threshold is met. Requires RPC_WEBSOCKET_ENDPOINT in .env.',
          icon: BellIcon
        },
        { 
          key: 'WEBSOCKET_EXTERNAL_BUY_THRESHOLD', 
          label: 'External Buy Threshold (SOL)', 
          type: 'number', 
          description: 'Cumulative SOL volume from external buys that triggers auto-sell. Default: 1.0 SOL',
          inputProps: { step: '0.1', min: '0.1' }
        },
        { 
          key: 'WEBSOCKET_EXTERNAL_BUY_WINDOW', 
          label: 'Aggregation Window (seconds)', 
          type: 'number', 
          description: 'Time window to aggregate external buys. Default: 60 seconds',
          inputProps: { step: '1', min: '10', max: '300' }
        },
        { 
          key: 'WEBSOCKET_ULTRA_FAST_MODE', 
          label: 'Ultra-Fast Mode (Sub-500ms)', 
          type: 'checkbox', 
          description: 'Ultra-fast WebSocket mode for sub-500ms reaction time. Uses processed commitment and pre-built transactions.',
        },
        { key: 'AUTO_COLLECT_FEES', label: 'Auto Collect Fees', type: 'checkbox', description: 'Automatically collect pump.fun creator fees' },
      ],
    },
  };

  const activeSectionData = sections[activeSection] || sections.wallets;
  const SectionIcon = activeSectionData.icon;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <SectionIcon className="w-6 h-6 text-blue-400" />
          <h2 className="text-2xl font-bold text-white">{activeSectionData.title}</h2>
        </div>
        <p className="text-sm text-gray-500">{activeSectionData.description}</p>
      </div>

      {/* Settings Content */}
      <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-lg p-6 mb-6">
        <div className="space-y-4">
          {activeSectionData.settings.map((setting) => {
            const SettingIcon = setting.icon;
            return (
              <div key={setting.key} className="border-b border-gray-800 pb-4 last:border-0">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-white flex items-center gap-2">
                    {SettingIcon && <SettingIcon className="w-4 h-4" />}
                    {setting.label}
                    {setting.required && <span className="text-red-400 ml-1">*</span>}
                    {privateKeyChanges[setting.key] && (
                      <span className="ml-2 text-xs text-yellow-400">⚠️ Changed</span>
                    )}
                  </label>
                  {setting.type === 'password' && (
                    <button
                      type="button"
                      onClick={() => toggleShowPrivateKey(setting.key)}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      {showPrivateKeys[setting.key] ? '👁️ Hide' : '👁️ Show'}
                    </button>
                  )}
                </div>
                {setting.description && (
                  <p className="text-xs text-gray-500 mb-3">{setting.description}</p>
                )}
                {setting.type === 'checkbox' ? (
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings[setting.key] === 'true' || settings[setting.key] === true}
                      onChange={(e) => handleChange(setting.key, e.target.checked ? 'true' : 'false')}
                      className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500 bg-gray-800 border-gray-700"
                    />
                    <span className="ml-2 text-white">
                      {settings[setting.key] === 'true' || settings[setting.key] === true ? 'Enabled' : 'Disabled'}
                    </span>
                  </label>
                ) : setting.type === 'password' ? (
                  <div className="relative">
                    <input
                      type={showPrivateKeys[setting.key] ? 'text' : 'password'}
                      value={settings[setting.key] || ''}
                      onChange={(e) => handleChange(setting.key, e.target.value)}
                      placeholder={setting.required ? 'Required' : 'Optional - leave empty to auto-create'}
                      className={`w-full px-4 py-2 bg-black/50 border rounded-lg text-white focus:outline-none focus:ring-2 ${
                        privateKeyChanges[setting.key] 
                          ? 'border-yellow-500 focus:ring-yellow-500' 
                          : 'border-gray-800 focus:ring-blue-500 focus:border-blue-500'
                      }`}
                    />
                    {settings[setting.key] && !showPrivateKeys[setting.key] && (
                      <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-xs text-gray-600 font-mono">
                        {shortenPrivateKey(settings[setting.key])}
                      </div>
                    )}
                  </div>
                ) : (
                  <input
                    type={setting.type}
                    value={settings[setting.key] || ''}
                    onChange={(e) => handleChange(setting.key, e.target.value)}
                    className="w-full px-4 py-2 bg-black/50 border border-gray-800 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-end gap-3">
        <button
          onClick={loadSettings}
          className="px-4 py-2 bg-gray-900/50 hover:bg-gray-900 border border-gray-800 text-white rounded-lg transition-all text-sm font-medium flex items-center gap-2"
        >
          <ArrowPathIcon className="w-4 h-4" />
          Reload
        </button>
        <button
          onClick={handleSave}
          disabled={loading || saved}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-all disabled:opacity-50 text-sm glow-blue flex items-center gap-2"
        >
          {saved ? (
            <>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Saved!
            </>
          ) : loading ? (
            'Saving...'
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
              Save Settings
            </>
          )}
        </button>
      </div>
    </div>
  );
}
