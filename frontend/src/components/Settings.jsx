import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  LockClosedIcon,
  CubeIcon,
  UserGroupIcon,
  Cog6ToothIcon,
  CpuChipIcon,
  RocketLaunchIcon,
  ArrowPathIcon,
  ArrowPathRoundedSquareIcon,
  BellIcon,
  KeyIcon,
  CurrencyDollarIcon,
  ChartBarIcon,
  ServerIcon,
  SparklesIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import apiService from '../services/api';

export default function Settings() {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(false);
  const [savingStatus, setSavingStatus] = useState('');
  const [showPrivateKeys, setShowPrivateKeys] = useState({});
  const [privateKeyChanges, setPrivateKeyChanges] = useState({});
  const [activeSection, setActiveSection] = useState('required'); // Match App.jsx default
  const [notifications, setNotifications] = useState([]);
  const autoSaveTimeoutRef = useRef(null);

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
    
    // Track private key changes for warning
    if (key === 'PRIVATE_KEY' || key === 'BUYER_WALLET') {
      setPrivateKeyChanges(prev => ({ ...prev, [key]: true }));
    }
    
    // Auto-save with debounce (except for private keys which need confirmation on blur)
    if (key !== 'PRIVATE_KEY' && key !== 'BUYER_WALLET') {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
      
      setSavingStatus('Saving...');
      autoSaveTimeoutRef.current = setTimeout(async () => {
        try {
          await apiService.updateSettings({ [key]: value });
          setSavingStatus('[check] Saved');
          showNotification(key);
          // Notify App.jsx that settings were updated
          window.dispatchEvent(new CustomEvent('settings-updated'));
          setTimeout(() => setSavingStatus(''), 2000);
        } catch (error) {
          setSavingStatus('[x] Failed to save');
          setTimeout(() => setSavingStatus(''), 3000);
        }
      }, 500);
    }
  };
  
  // Save private keys on blur with confirmation
  const handlePrivateKeyBlur = async (key) => {
    if (!privateKeyChanges[key]) return;
    
    const value = settings[key];
    if (!value || value.trim() === '') {
      setPrivateKeyChanges(prev => ({ ...prev, [key]: false }));
      return;
    }
    
    // Validate length
    if (value.trim().length < 80 || value.trim().length > 100) {
      alert('[x] Invalid key length. Solana private keys should be ~88 characters (base58 encoded).');
      return;
    }
    
    const confirmed = window.confirm(
      `[!] Save ${key === 'PRIVATE_KEY' ? 'Main Funding Wallet' : 'Buyer/Creator Wallet'} private key?\n\nThis will affect all future operations.`
    );
    
    if (confirmed) {
      setSavingStatus('Saving...');
      try {
        await apiService.updateSettings({ [key]: value });
        setSavingStatus('[check] Saved');
        setPrivateKeyChanges(prev => ({ ...prev, [key]: false }));
        showNotification(key);
        // Notify App.jsx that settings were updated
        window.dispatchEvent(new CustomEvent('settings-updated'));
        setTimeout(() => setSavingStatus(''), 2000);
      } catch (error) {
        setSavingStatus('[x] Failed to save');
        setTimeout(() => setSavingStatus(''), 3000);
      }
    }
  };
  
  const toggleShowPrivateKey = (key) => {
    setShowPrivateKeys(prev => ({ ...prev, [key]: !prev[key] }));
  };
  
  const shortenPrivateKey = (key) => {
    if (!key || key.length <= 16) return key;
    return key.substring(0, 8) + '...' + key.substring(key.length - 8);
  };

  // Show notification
  const showNotification = (key) => {
    const id = Date.now();
    const newNotification = {
      id,
      key,
      message: `.env ${key} Saved`
    };
    setNotifications(prev => [...prev, newNotification]);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 3000);
  };

  // Check if required settings are satisfied
  const isRequiredSatisfied = () => {
    const privateKey = settings.PRIVATE_KEY?.trim();
    const rpcEndpoint = settings.RPC_ENDPOINT?.trim();
    return !!(privateKey && rpcEndpoint && privateKey.length > 0 && rpcEndpoint.length > 0);
  };

  const requiredSatisfied = isRequiredSatisfied();

  const sections = {
    required: {
      title: 'Required Settings',
      icon: ExclamationTriangleIcon,
      description: 'Essential settings required for the bundler to work. These must be configured before launching tokens.',
      settings: [
        { 
          key: 'PRIVATE_KEY', 
          label: 'PRIVATE_KEY (Main Funding Wallet)', 
          type: 'password',
          required: true,
          description: 'REQUIRED: Main wallet that funds all operations. Base58 encoded private key.'
        },
        { 
          key: 'RPC_ENDPOINT', 
          label: 'RPC Endpoint', 
          type: 'text',
          required: true,
          description: 'REQUIRED: Solana RPC endpoint. Any provider works (Helius, QuickNode, Alchemy, public RPC, etc.). Examples: https://mainnet.helius-rpc.com/?api-key=KEY, https://api.mainnet-beta.solana.com'
        },
        { 
          key: 'RPC_WEBSOCKET_ENDPOINT', 
          label: 'WebSocket Endpoint', 
          type: 'text',
          required: false,
          description: 'Optional: WebSocket endpoint for real-time updates. Only needed if using WebSocket tracking (WEBSOCKET_TRACKING_ENABLED). Should match your RPC provider.'
        },
      ],
    },
    rpc: {
      title: 'RPC Configuration',
      icon: ServerIcon,
      description: 'Configure Solana RPC endpoints. Any provider works (Helius, QuickNode, Alchemy, public RPC, etc.).',
      settings: [
        { 
          key: 'RPC_ENDPOINT', 
          label: 'RPC Endpoint', 
          type: 'text',
          required: true,
          description: 'Required: Solana RPC endpoint. Examples: https://mainnet.helius-rpc.com/?api-key=KEY, https://api.mainnet-beta.solana.com'
        },
        { 
          key: 'RPC_WEBSOCKET_ENDPOINT', 
          label: 'WebSocket Endpoint', 
          type: 'text',
          required: false,
          description: 'Optional: WebSocket endpoint for real-time updates. Should match your RPC provider.'
        },
      ],
    },
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
        { 
          key: 'USE_FUNDING_AS_BUYER', 
          label: 'Use Funding Wallet as Buyer', 
          type: 'checkbox',
          description: 'If enabled, uses PRIVATE_KEY wallet as the buyer/creator wallet'
        },
        { 
          key: 'BUYER_AMOUNT', 
          label: 'Buyer Amount (SOL)', 
          type: 'number',
          description: 'Amount of SOL for the buyer/creator wallet to buy tokens. Default: 1 SOL',
          inputProps: { step: '0.1', min: '0.1' }
        },
      ],
    },
    bundle: {
      title: 'Bundle Wallets',
      icon: CubeIcon,
      description: 'Configure bundle wallet settings for Jito bundling.',
      settings: [
        { key: 'BUNDLE_WALLET_COUNT', label: 'Bundle Wallet Count', type: 'number', description: 'Number of wallets to use in Jito bundle (5-6 recommended). Set to 0 for rapid launch mode.', inputProps: { min: '0', max: '10', step: '1' } },
        { key: 'BUNDLE_SWAP_AMOUNTS', label: 'Bundle Swap Amounts (comma-separated)', type: 'text', description: 'Custom amounts per wallet, e.g., "0.4,0.5,0.7,1.0". Leave empty to use SWAP_AMOUNT for all.' },
        { key: 'SWAP_AMOUNT', label: 'Default Swap Amount (SOL)', type: 'number', description: 'Default amount if BUNDLE_SWAP_AMOUNTS not specified', inputProps: { step: '0.1', min: '0.1' } },
        { key: 'USE_NORMAL_LAUNCH', label: 'Use Normal Launch (No Jito, No LUT)', type: 'checkbox', description: 'Skip Jito bundling and LUT for simpler launches. Faster but less efficient.', icon: RocketLaunchIcon },
        { key: 'BUNDLE_INTERMEDIARY_HOPS', label: 'Bundle Intermediary Hops', type: 'number', description: 'Number of intermediary wallets to route through for bundle wallets (0-5, default: 2). Higher = more privacy but slower.', inputProps: { min: '0', max: '5', step: '1' } },
      ],
    },
    holders: {
      title: 'Holder Wallets',
      icon: UserGroupIcon,
      description: 'Configure holder wallets that buy separately to increase holder count.',
      settings: [
        { key: 'HOLDER_WALLET_COUNT', label: 'Holder Wallet Count', type: 'number', description: 'Number of holder wallets to create', inputProps: { min: '0', max: '50', step: '1' } },
        { key: 'HOLDER_WALLET_AMOUNT', label: 'Holder Wallet Amount (SOL)', type: 'number', description: 'Default amount for each holder wallet', inputProps: { step: '0.01', min: '0.01' } },
        { key: 'HOLDER_SWAP_AMOUNTS', label: 'Holder Swap Amounts (comma-separated)', type: 'text', description: 'Custom amounts per holder wallet, e.g., "0.7,0.5,0.71". Leave empty to use HOLDER_WALLET_AMOUNT for all.' },
        { key: 'HOLDER_WALLET_PRIORITY_FEE', label: 'Holder Wallet Priority Fee (lamports)', type: 'number', description: 'Priority fee for holder wallet buys. Lower = cheaper but slower. Default: 100000 (0.0001 SOL)', inputProps: { step: '1000', min: '0' } },
        { key: 'HOLDER_AUTO_BUY_DELAYS', label: 'Holder Auto-Buy Delays', type: 'text', description: 'Delay configuration: "parallel:count,delay:seconds". Example: "parallel:3,delay:0.5,parallel:2,delay:1.0"' },
        { key: 'AUTO_HOLDER_WALLET_BUY', label: 'Auto Holder Wallet Buy', type: 'checkbox', description: 'Automatically execute holder wallet buys after launch is confirmed' },
        { key: 'HOLDER_FRONT_RUN_THRESHOLD', label: 'Front-Run Threshold (SOL)', type: 'number', description: 'Skip auto-buy if external buys exceed this threshold. Set to 0 to disable protection.', inputProps: { step: '0.1', min: '0' } },
        { key: 'HOLDER_INTERMEDIARY_HOPS', label: 'Holder Intermediary Hops', type: 'number', description: 'Number of intermediary wallets to route through for holder wallets (0-5, default: 2). Higher = more privacy but slower.', inputProps: { min: '0', max: '5', step: '1' } },
      ],
    },
    trading: {
      title: 'Priority Fees',
      icon: CurrencyDollarIcon,
      description: 'Configure priority fees for trading operations.',
      settings: [
        { key: 'PRIORITY_FEE_LAMPORTS_HIGH', label: 'High Priority Fee (lamports)', type: 'number', description: 'Used for auto-sell when threshold is met. Default: 500000', inputProps: { step: '100000', min: '0' } },
        { key: 'PRIORITY_FEE_LAMPORTS_MEDIUM', label: 'Medium Priority Fee (lamports)', type: 'number', description: 'Standard priority for normal operations. Default: 100000', inputProps: { step: '10000', min: '0' } },
        { key: 'PRIORITY_FEE_LAMPORTS_LOW', label: 'Low Priority Fee (lamports)', type: 'number', description: 'Used for manual sells. Default: 25000', inputProps: { step: '10000', min: '0' } },
      ],
    },
    jito: {
      title: 'Jito Bundle Settings',
      icon: SparklesIcon,
      description: 'Configure Jito bundling for faster transaction inclusion.',
      settings: [
        { key: 'JITO_FEE', label: 'Jito Fee (SOL)', type: 'number', description: 'Fee paid to Jito for bundle inclusion. Default: 0.001 SOL', inputProps: { step: '0.0001', min: '0.0001' } },
        { key: 'MINIMUM_JITO_TIP', label: 'Minimum Jito Tip (SOL)', type: 'number', description: 'Minimum tip for Jito bundles. Default: 0.0001 SOL', inputProps: { step: '0.0001', min: '0.0001' } },
        { key: 'USE_JITO_FOR_SELLS', label: 'Use Jito for Sells', type: 'checkbox', description: 'Use Jito bundling for sell transactions to beat bots and avoid rate limits' },
        { key: 'JITO_SELL_TIP', label: 'Jito Sell Tip (SOL)', type: 'number', description: 'Tip amount for Jito sell bundles. Default: 0.0035 SOL', inputProps: { step: '0.0001', min: '0.0001' } },
        { key: 'RAPID_SELL_PRIORITY_FEE', label: 'Rapid Sell Priority Fee (lamports)', type: 'number', description: 'Priority fee for rapid sell transactions. Default: 7000000 (0.007 SOL)', inputProps: { step: '100000', min: '0' } },
        { key: 'LIL_JIT_ENDPOINT', label: 'Lil Jit Endpoint', type: 'text', description: 'Optional: Custom Jito endpoint. Leave empty to use default.' },
        { key: 'LIL_JIT_WEBSOCKET_ENDPOINT', label: 'Lil Jit WebSocket Endpoint', type: 'text', description: 'Optional: Custom Jito WebSocket endpoint. Leave empty to use default.' },
        { key: 'LIL_JIT_MODE', label: 'Lil Jit Mode', type: 'checkbox', description: 'Use Lil Jito for bundle submission' },
      ],
    },
    autosell: {
      title: 'Auto-Sell Configuration',
      icon: ChartBarIcon,
      description: 'Configure automatic selling when thresholds are met.',
      settings: [
        { key: 'AUTO_SELL_ENABLED', label: 'Auto-Sell Enabled', type: 'checkbox', description: 'Master toggle for auto-sell system' },
        { key: 'AUTO_SELL_DEFAULT_THRESHOLD', label: 'Default Threshold (SOL)', type: 'number', description: 'Default threshold for all wallets. Default: 1 SOL', inputProps: { step: '0.1', min: '0.1' } },
        { key: 'AUTO_SELL_MEV_ENABLED', label: 'MEV Protection Enabled', type: 'checkbox', description: 'Enable MEV protection to avoid front-running' },
        { key: 'AUTO_SELL_MEV_CONFIRMATION_DELAY', label: 'MEV Confirmation Delay (seconds)', type: 'number', description: 'Wait time before confirming sell. Default: 3 seconds', inputProps: { step: '1', min: '1', max: '10' } },
        { key: 'AUTO_SELL_MEV_LAUNCH_COOLDOWN', label: 'MEV Launch Cooldown (seconds)', type: 'number', description: 'Cooldown period after launch. Default: 5 seconds', inputProps: { step: '1', min: '0' } },
        { key: 'AUTO_SELL_MEV_RAPID_WINDOW', label: 'MEV Rapid Window (seconds)', type: 'number', description: 'Time window for rapid sell detection. Default: 10 seconds', inputProps: { step: '1', min: '5' } },
        { key: 'AUTO_RAPID_SELL', label: 'Auto Rapid Sell', type: 'checkbox', description: 'Automatically sell tokens when threshold is met' },
        { key: 'AUTO_SELL_50_PERCENT', label: 'Auto Sell 50%', type: 'checkbox', description: 'Automatically sell 50% of holdings' },
        { key: 'AUTO_SELL_STAGED', label: 'Staged Sell', type: 'checkbox', description: 'Sell wallets in stages based on volume thresholds' },
        { key: 'STAGED_SELL_STAGE1_THRESHOLD', label: 'Stage 1 Threshold (SOL)', type: 'number', description: 'Volume threshold for stage 1. Default: 5 SOL', inputProps: { step: '0.5', min: '0.5' } },
        { key: 'STAGED_SELL_STAGE1_PERCENTAGE', label: 'Stage 1 Percentage (%)', type: 'number', description: 'Percentage of wallets to sell in stage 1. Default: 30%', inputProps: { step: '5', min: '0', max: '100' } },
        { key: 'STAGED_SELL_STAGE2_THRESHOLD', label: 'Stage 2 Threshold (SOL)', type: 'number', description: 'Volume threshold for stage 2. Default: 10 SOL', inputProps: { step: '0.5', min: '0.5' } },
        { key: 'STAGED_SELL_STAGE2_PERCENTAGE', label: 'Stage 2 Percentage (%)', type: 'number', description: 'Percentage of wallets to sell in stage 2. Default: 30%', inputProps: { step: '5', min: '0', max: '100' } },
        { key: 'STAGED_SELL_STAGE3_THRESHOLD', label: 'Stage 3 Threshold (SOL)', type: 'number', description: 'Volume threshold for stage 3. Default: 20 SOL', inputProps: { step: '0.5', min: '0.5' } },
        { key: 'STAGED_SELL_STAGE3_PERCENTAGE', label: 'Stage 3 Percentage (%)', type: 'number', description: 'Percentage of wallets to sell in stage 3 (remaining + DEV). Default: 40%', inputProps: { step: '5', min: '0', max: '100' } },
      ],
    },
    apikeys: {
      title: 'API Keys',
      icon: KeyIcon,
      description: 'Optional API keys for enhanced features. Leave empty if not using these features.',
      settings: [
        { key: 'OPENAI_API_KEY', label: 'OpenAI API Key', type: 'password', description: 'For AI auto-fill feature (optional). Get from: https://platform.openai.com/api-keys' },
        { key: 'GEMINI_API_KEY', label: 'Gemini API Key', type: 'password', description: 'For AI image generation (optional). Get from: https://aistudio.google.com/app/apikey' },
        { key: 'BIRDEYE_API_KEY', label: 'Birdeye API Key', type: 'password', description: 'For token data and market cap tracking. Get from: https://birdeye.so/' },
      ],
    },
    options: {
      title: 'Advanced Options',
      icon: Cog6ToothIcon,
      description: 'Advanced options and features.',
      settings: [
        { key: 'VANITY_MODE', label: 'Vanity Mode', type: 'checkbox', description: 'Use vanity addresses ending with "pump"' },
        { key: 'SIMULATE_ONLY', label: 'Simulation Mode', type: 'checkbox', description: 'Test without sending transactions (dry run)' },
        { 
          key: 'DIRECT_SEND_MODE', 
          label: 'Direct Send Mode (No Privacy Routing)', 
          type: 'checkbox',
          description: 'Send SOL directly to wallets without any mixing or intermediary routing. Faster but wallets will be connected on bubble maps. Enable this to skip ALL privacy features.',
          icon: RocketLaunchIcon
        },
        { 
          key: 'USE_MIXING_WALLETS', 
          label: 'Use Mixing Wallets (Break Connection Trail)', 
          type: 'checkbox',
          description: 'Routes SOL through intermediate wallets to prevent bubble maps from connecting your wallets. Ignored if Direct Send Mode is enabled.',
          icon: ArrowPathRoundedSquareIcon
        },
        { 
          key: 'CREATE_FRESH_MIXING_WALLETS', 
          label: 'Create Fresh Mixing Wallets Each Launch', 
          type: 'checkbox',
          description: 'Creates brand new mixing wallets for each launch (better privacy). If disabled, reuses existing mixing wallets. Ignored if Direct Send Mode is enabled.',
          icon: ArrowPathRoundedSquareIcon
        },
        { 
          key: 'USE_MULTI_INTERMEDIARY_SYSTEM', 
          label: 'Use Multi-Intermediary System (Advanced Privacy)', 
          type: 'checkbox',
          description: 'Routes SOL through multiple intermediary wallets. Each wallet gets unique intermediaries. More private but slower. Ignored if Direct Send Mode is enabled.',
          icon: ArrowPathRoundedSquareIcon
        },
        { 
          key: 'NUM_INTERMEDIARY_HOPS', 
          label: 'Default Intermediary Hops (Global Fallback)', 
          type: 'number', 
          description: 'Default number of intermediary wallets (0-5). Set to 0 for direct sends. Ignored if Direct Send Mode is enabled.',
          inputProps: { min: '0', max: '5', step: '1' }
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
        { 
          key: 'MARKET_CAP_TRACKING_ENABLED', 
          label: 'Market Cap Tracking (Auto-Sell at Market Cap)', 
          type: 'checkbox', 
          description: 'Monitor token market cap via Jupiter API (via Helius RPC) and auto-sell when threshold is reached. No API key needed! Falls back to Birdeye if BIRDEYE_API_KEY is set.',
          icon: BellIcon
        },
        { 
          key: 'MARKET_CAP_SELL_THRESHOLD', 
          label: 'Market Cap Sell Threshold (USD)', 
          type: 'number', 
          description: 'Market cap in USD that triggers auto-sell. Default: 100000 ($100K). Example: 500000 = $500K market cap',
          inputProps: { step: '1000', min: '1000' }
        },
        { 
          key: 'MARKET_CAP_CHECK_INTERVAL', 
          label: 'Market Cap Check Interval (seconds)', 
          type: 'number', 
          description: 'How often to check market cap. Default: 5 seconds. Lower = faster detection but more API calls.',
          inputProps: { step: '1', min: '3', max: '60' }
        },
        { key: 'AUTO_COLLECT_FEES', label: 'Auto Collect Fees', type: 'checkbox', description: 'Automatically collect pump.fun creator fees' },
      ],
    },
  };

  // Ensure activeSection exists in sections, fallback to 'required'
  const activeSectionData = sections[activeSection] || sections.required;
  const SectionIcon = activeSectionData?.icon || ExclamationTriangleIcon;

  return (
    <div>
      {/* Info Banner */}
      <div className="mb-4 p-3 bg-gray-800/50 border border-gray-700 rounded-lg">
        <div className="flex items-start gap-2">
          <svg className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-sm text-gray-300 space-y-1">
            <p>The <span className="text-white font-medium">Launch Token</span> page modifies most settings automatically. All you need is a <span className="text-white font-medium">Funding Wallet</span> and an <span className="text-white font-medium">RPC Endpoint</span>.</p>
            <p className="text-gray-400">Use at least a free-tier RPC from <a href="https://helius.dev" target="_blank" rel="noopener noreferrer" className="text-gray-300 underline hover:text-white">Helius</a> or <a href="https://quicknode.com" target="_blank" rel="noopener noreferrer" className="text-gray-300 underline hover:text-white">QuickNode</a>. Public RPCs cause rate limits and failed launches.</p>
          </div>
        </div>
      </div>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-3">
            {SectionIcon && <SectionIcon className={`w-6 h-6 ${
              activeSection === 'required' 
                ? requiredSatisfied 
                  ? 'text-green-400' 
                  : 'text-red-400' 
                : 'text-blue-400'
            }`} />}
            <h2 className="text-2xl font-bold text-white">{activeSectionData.title}</h2>
            {activeSection === 'required' && (
              requiredSatisfied ? (
                <span className="px-2 py-1 text-xs font-bold bg-green-900/50 text-green-400 border border-green-500/30 rounded flex items-center gap-1">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  READY
                </span>
              ) : (
                <span className="px-2 py-1 text-xs font-bold bg-red-900/50 text-red-400 border border-red-500/30 rounded">ESSENTIAL</span>
              )
            )}
          </div>
        </div>
        <p className={`text-sm ${
          activeSection === 'required' 
            ? requiredSatisfied 
              ? 'text-green-400' 
              : 'text-yellow-400' 
            : 'text-gray-500'
        }`}>
          {activeSection === 'required' && requiredSatisfied 
            ? '[ok] All required settings are configured. The bundler is ready to launch tokens!'
            : activeSectionData.description
          }
        </p>
      </div>

      {/* Coming Soon Banner */}
      {activeSectionData.comingSoon && (
        <div className="bg-gradient-to-r from-purple-900/30 to-blue-900/30 backdrop-blur-sm border border-purple-500/30 rounded-lg p-8 mb-6">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 bg-gradient-to-br from-purple-500/20 to-blue-500/20 rounded-full flex items-center justify-center mb-4 border border-purple-500/30">
              <KeyIcon className="w-8 h-8 text-purple-400" />
            </div>
            <h3 className="text-2xl font-bold text-white mb-2">Coming Soon</h3>
            <p className="text-gray-400 max-w-md">
              The Trenchie API Master Key system will provide unified access to all platform features with a single API key. 
              This will simplify configuration and enable advanced features across the entire platform.
            </p>
            <div className="mt-6 flex items-center gap-2 text-sm text-purple-300">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>Stay tuned for updates!</span>
            </div>
          </div>
        </div>
      )}

      {/* Custom Component (for Marketing Accounts) */}
      {activeSectionData.component && (() => {
        const Component = activeSectionData.component;
        if (!Component) return null;
        return (
          <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-lg p-6 mb-6">
            <Component />
          </div>
        );
      })()}

      {/* Settings Content */}
      {activeSectionData.settings && (
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
                    {setting.required && <span className="text-red-400 ml-1 font-bold">* REQUIRED</span>}
                    {privateKeyChanges[setting.key] && (
                      <span className="ml-2 text-xs text-yellow-400">[!] Changed</span>
                    )}
                  </label>
                  {setting.type === 'password' && (
                    <button
                      type="button"
                      onClick={() => toggleShowPrivateKey(setting.key)}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      {showPrivateKeys[setting.key] ? ' Hide' : ' Show'}
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
                      onBlur={() => handlePrivateKeyBlur(setting.key)}
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
                    {privateKeyChanges[setting.key] && (
                      <p className="text-xs text-yellow-400 mt-1">Click outside to save changes</p>
                    )}
                  </div>
                ) : (
                  <input
                    type={setting.type}
                    value={settings[setting.key] || ''}
                    onChange={(e) => handleChange(setting.key, e.target.value)}
                    {...(setting.inputProps || {})}
                    className="w-full px-4 py-2 bg-black/50 border border-gray-800 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* Status Bar - Only show for settings sections */}
      {activeSectionData.settings && (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Settings auto-save on change
        </div>
        <div className="flex items-center gap-3">
          {savingStatus && (
            <span className={`text-sm px-3 py-1 rounded ${
              savingStatus.includes('[check]') ? 'bg-green-900/50 text-green-400' :
              savingStatus.includes('[x]') ? 'bg-red-900/50 text-red-400' :
              'bg-blue-900/50 text-blue-400'
            }`}>
              {savingStatus}
            </span>
          )}
          <button
            onClick={loadSettings}
            className="px-3 py-1.5 bg-gray-900/50 hover:bg-gray-900 border border-gray-800 text-gray-400 hover:text-white rounded-lg transition-all text-xs font-medium flex items-center gap-1.5"
          >
            <ArrowPathIcon className="w-3.5 h-3.5" />
            Reload
          </button>
        </div>
      </div>
      )}

      {/* Notifications - Bottom Right (Portal to document body) */}
      {notifications.length > 0 && createPortal(
        <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
          {notifications.map((notification) => (
            <div
              key={notification.id}
              className="bg-green-900/90 backdrop-blur-sm border border-green-500/50 rounded-lg px-4 py-3 shadow-lg animate-slide-in-right flex items-center gap-2 min-w-[200px] pointer-events-auto"
            >
              <svg className="w-5 h-5 text-green-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-sm text-green-200 font-medium">{notification.message}</span>
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
