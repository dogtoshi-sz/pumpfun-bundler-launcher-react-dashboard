import { useState, useEffect, useRef } from 'react';
import React from 'react';
import {
  RocketLaunchIcon,
  WalletIcon,
  UserIcon,
  LockClosedIcon,
  CubeIcon,
  UserGroupIcon,
  ArrowPathRoundedSquareIcon,
  CurrencyDollarIcon,
  BeakerIcon,
  MegaphoneIcon,
  ArrowDownTrayIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
  LightBulbIcon,
  WrenchScrewdriverIcon,
  MagnifyingGlassIcon,
  BellIcon,
  QuestionMarkCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  GlobeAltIcon,
  LinkIcon,
  PhotoIcon,
  HashtagIcon,
  DocumentTextIcon,
  CheckCircleIcon as CheckCircleIconOutline,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import {
  RocketLaunchIcon as RocketLaunchIconSolid,
  WalletIcon as WalletIconSolid,
  UserIcon as UserIconSolid,
  LockClosedIcon as LockClosedIconSolid,
  CubeIcon as CubeIconSolid,
  UserGroupIcon as UserGroupIconSolid
} from '@heroicons/react/24/solid';
import apiService from '../services/api';
import AIContentGenerator from './AIContentGenerator';
import AutoSellConfig from './AutoSellConfig';

// Compact Info Tooltip Component with enhanced styling
const InfoTooltip = ({ content, type = 'default' }) => {
  const [show, setShow] = useState(false);
  
  // Color schemes based on type
  const colorSchemes = {
    default: 'text-blue-400 hover:text-blue-300',
    warning: 'text-yellow-400 hover:text-yellow-300',
    important: 'text-red-400 hover:text-red-300',
    info: 'text-cyan-400 hover:text-cyan-300'
  };
  
  const iconColor = colorSchemes[type] || colorSchemes.default;
  
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow(!show)}
        className={`inline-flex items-center justify-center w-3.5 h-3.5 ${iconColor} transition-colors`}
        title="Click for info"
      >
        <QuestionMarkCircleIcon className="w-3.5 h-3.5" />
      </button>
      {show && (
        <div className="absolute z-50 left-0 top-5 w-72 p-3 bg-gray-900 border border-gray-700 rounded-lg shadow-xl text-xs">
          <div className="space-y-1.5">
            {typeof content === 'string' ? (
              <p className="text-gray-200 leading-relaxed">
                <span className="font-semibold text-white">ℹ️ </span>
                {content}
              </p>
            ) : (
              <div className="space-y-1.5">
                {content.map((item, i) => (
                  <p key={i} className="text-gray-200 leading-relaxed">
                    {typeof item === 'object' && item.bold ? (
                      <>
                        <span className="font-bold text-white">{item.bold}</span>
                        {item.text && <span className="text-gray-300"> {item.text}</span>}
                      </>
                    ) : (
                      item
                    )}
                  </p>
                ))}
              </div>
            )}
          </div>
          <div className="absolute -top-1 left-3 w-2 h-2 bg-gray-900 border-l border-t border-gray-700 transform rotate-45"></div>
        </div>
      )}
    </div>
  );
};

// Collapsible Info Section
const CollapsibleInfo = ({ title, children, defaultOpen = false }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-gray-800 pt-2 mt-2">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-300 transition-colors"
      >
        {isOpen ? <ChevronUpIcon className="w-3 h-3" /> : <ChevronDownIcon className="w-3 h-3" />}
        <span>{title}</span>
      </button>
      {isOpen && (
        <div className="mt-2 p-2 bg-gray-900/50 border border-gray-800 rounded text-xs text-gray-400">
          {children}
        </div>
      )}
    </div>
  );
};

export default function TokenLaunch({ onLaunch }) {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(false);
  const [nextAddress, setNextAddress] = useState(null);
  const [deployerWallet, setDeployerWallet] = useState(null);
  const [walletInfo, setWalletInfo] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [websiteLogoFile, setWebsiteLogoFile] = useState(null);
  const [websiteLogoPreview, setWebsiteLogoPreview] = useState(null);
  
  // AI Image Generation (Nano Banana / Gemini)
  const [aiImageGenerating, setAiImageGenerating] = useState(false);
  const [aiImagePrompt, setAiImagePrompt] = useState('');
  const [aiImageStyle, setAiImageStyle] = useState('meme');
  const [showAiGenerator, setShowAiGenerator] = useState(false);
  const [aiGeneratorError, setAiGeneratorError] = useState(null);
  const [savingStatus, setSavingStatus] = useState('');
  const autoSaveTimeoutRef = useRef(null);
  const [launchStage, setLaunchStage] = useState(null);
  const [launchProgress, setLaunchProgress] = useState(0);
  const [launchProgressMessages, setLaunchProgressMessages] = useState([]);
  const launchProgressEventSourceRef = useRef(null);
  const [testingMarketing, setTestingMarketing] = useState({
    website: false,
    telegram: false,
    twitter: false,
  });
  const [marketingTestResults, setMarketingTestResults] = useState({
    website: null,
    telegram: null,
    twitter: null,
  });
  const [twitterAccountInfo, setTwitterAccountInfo] = useState(null);
  const [loadingTwitterAccount, setLoadingTwitterAccount] = useState(false);
  const [tweetList, setTweetList] = useState([]); // Array of { text: string, image: File | null, imagePreview: string | null }
  const [savedTwitterAccounts, setSavedTwitterAccounts] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('savedTwitterAccounts') || '[]');
    } catch { return []; }
  });
  const [updatingTwitterProfile, setUpdatingTwitterProfile] = useState(false);
  const [telegramVerification, setTelegramVerification] = useState({
    codeSent: false,
    phoneCodeHash: null,
    requires2FA: false,
    verifying: false,
    verified: false,
    error: null,
  });
  const [telegramCode, setTelegramCode] = useState('');
  const [telegram2FAPassword, setTelegram2FAPassword] = useState('');
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [showBuyerWallet, setShowBuyerWallet] = useState(false);
  // REMOVED: Global useWarmedWallets - now using per-type toggles
  // const [useWarmedWallets, setUseWarmedWallets] = useState(false);
  
  // Per-type warmed wallet toggles (independent control for each wallet type)
  const [useWarmedDevWallet, setUseWarmedDevWallet] = useState(false);
  const [useWarmedBundleWallets, setUseWarmedBundleWallets] = useState(false);
  const [useWarmedHolderWallets, setUseWarmedHolderWallets] = useState(false);
  
  // Backward compatibility helper - true if ANY type uses warmed wallets
  const useWarmedWallets = useWarmedDevWallet || useWarmedBundleWallets || useWarmedHolderWallets;
  
  const [warmedWallets, setWarmedWallets] = useState([]);
  const [selectedBundleWallets, setSelectedBundleWallets] = useState([]);
  const [selectedHolderWallets, setSelectedHolderWallets] = useState([]);
  const [selectedHolderAutoBuyWallets, setSelectedHolderAutoBuyWallets] = useState([]);
  const [selectedHolderAutoBuyIndices, setSelectedHolderAutoBuyIndices] = useState([]); // For fresh wallets: store indices instead of addresses
  const [holderAutoBuyGroups, setHolderAutoBuyGroups] = useState([{ count: 1, delay: 0.1 }]);
  const [frontRunThreshold, setFrontRunThreshold] = useState(0); // SOL threshold for front-run protection (0 = disabled)
  const [selectedCreatorWallet, setSelectedCreatorWallet] = useState(null);
  
  // Mixed Mode: Track holder wallet types (warmed or fresh) per position
  const [useMixedHolderMode, setUseMixedHolderMode] = useState(false);
  const [holderWalletTypes, setHolderWalletTypes] = useState([]); // Array of {type: 'warmed'|'fresh', address?: string}
  const [loadingWarmedWallets, setLoadingWarmedWallets] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  // Filter and sort state for wallet modal
  const [searchQuery, setSearchQuery] = useState('');
  // Token configuration save/load state
  const [savedConfigs, setSavedConfigs] = useState([]);
  const [loadingConfigs, setLoadingConfigs] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [configSaveName, setConfigSaveName] = useState('');
  const [tagFilter, setTagFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('solBalance'); // Default to SOL balance (highest first)
  const [sortOrder, setSortOrder] = useState('desc');
  const [walletConfigExpanded, setWalletConfigExpanded] = useState(true);
  const [showHolderSniperModal, setShowHolderSniperModal] = useState(false);
  const [showTotalSolModal, setShowTotalSolModal] = useState(false);
  const [walletKeysExpanded, setWalletKeysExpanded] = useState(false);
  const [activeMarketingTab, setActiveMarketingTab] = useState('website');
  const [privacyRoutingExpanded, setPrivacyRoutingExpanded] = useState(false);
  const [walletSourceExpanded, setWalletSourceExpanded] = useState(true);
  const [bundleWalletsExpanded, setBundleWalletsExpanded] = useState(false);
  const [holderWalletsExpanded, setHolderWalletsExpanded] = useState(false);
  const [devBuyExpanded, setDevBuyExpanded] = useState(false);
  
  // Launch Mode: 'quick' = simple dev buy, no Jito, no bundles | 'advanced' = full system (bundle launcher)
  const [launchMode, setLaunchMode] = useState('advanced');

  useEffect(() => {
    loadSettings();
    loadNextAddress();
    loadDeployerWallet();
    loadWalletInfo();
    loadWarmedWallets();
    
    // Cleanup: Close launch progress event source on unmount
    return () => {
      if (launchProgressEventSourceRef.current) {
        launchProgressEventSourceRef.current.close();
        launchProgressEventSourceRef.current = null;
      }
    };
  }, []);

  const loadWarmedWallets = async (refreshBalances = false) => {
    try {
      setLoadingWarmedWallets(true);
      const res = await apiService.getWarmingWallets();
      if (res.data.success) {
        const wallets = res.data.wallets || [];
        setWarmedWallets(wallets);
        
        // Auto-refresh balances for wallets that don't have recent balance data
        if (refreshBalances && wallets.length > 0) {
          const walletsNeedingRefresh = wallets.filter(w => {
            // Refresh if no balance or balance is older than 5 minutes
            if (!w.lastBalanceUpdate) return true;
            const lastUpdate = new Date(w.lastBalanceUpdate).getTime();
            return Date.now() - lastUpdate > 5 * 60 * 1000;
          }).slice(0, 20); // Limit to 20 wallets to avoid rate limits
          
          if (walletsNeedingRefresh.length > 0) {
            console.log(`[TokenLaunch] Auto-refreshing balances for ${walletsNeedingRefresh.length} wallets...`);
            try {
              const refreshRes = await apiService.updateWalletBalances(walletsNeedingRefresh.map(w => w.address));
              if (refreshRes.data.success) {
                // Reload to get updated balances
                const refreshedRes = await apiService.getWarmingWallets();
                if (refreshedRes.data.success) {
                  setWarmedWallets(refreshedRes.data.wallets || []);
                }
              }
            } catch (e) {
              console.warn('[TokenLaunch] Balance refresh failed:', e.message);
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to load warmed wallets:', error);
    } finally {
      setLoadingWarmedWallets(false);
    }
  };

  // Filter and sort wallets for modal
  const filteredAndSortedWallets = React.useMemo(() => {
    let filtered = warmedWallets.filter(wallet => {
      // Search filter
      if (searchQuery && !wallet.address.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      // Tag filter
      if (tagFilter !== 'all') {
        if (tagFilter === 'OLD' && (!wallet.tags || !wallet.tags.includes('OLD'))) return false;
        if (tagFilter === 'recent' && (!wallet.tags || !wallet.tags.includes('recent'))) return false;
        if (tagFilter !== 'OLD' && tagFilter !== 'recent' && (!wallet.tags || !wallet.tags.includes(tagFilter))) return false;
      }
      // Status filter
      if (statusFilter !== 'all') {
        if (wallet.status !== statusFilter) return false;
      }
      return true;
    });

    // Sort
    filtered.sort((a, b) => {
      let aVal, bVal;
      switch (sortBy) {
        case 'createdAt':
          aVal = new Date(a.createdAt || 0).getTime();
          bVal = new Date(b.createdAt || 0).getTime();
          break;
        case 'transactionCount':
          aVal = a.transactionCount || 0;
          bVal = b.transactionCount || 0;
          break;
        case 'totalTrades':
          aVal = a.totalTrades || 0;
          bVal = b.totalTrades || 0;
          break;
        case 'firstTransactionDate':
          aVal = a.firstTransactionDate ? new Date(a.firstTransactionDate).getTime() : 0;
          bVal = b.firstTransactionDate ? new Date(b.firstTransactionDate).getTime() : 0;
          break;
        case 'lastTransactionDate':
          aVal = a.lastTransactionDate ? new Date(a.lastTransactionDate).getTime() : 0;
          bVal = b.lastTransactionDate ? new Date(b.lastTransactionDate).getTime() : 0;
          break;
        case 'solBalance':
          aVal = a.solBalance || 0;
          bVal = b.solBalance || 0;
          break;
        default:
          return 0;
      }
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });

    return filtered;
  }, [warmedWallets, searchQuery, tagFilter, statusFilter, sortBy, sortOrder]);

  const allTags = React.useMemo(() => {
    const tags = new Set();
    warmedWallets.forEach(w => {
      if (w.tags && Array.isArray(w.tags)) {
        w.tags.forEach(tag => tags.add(tag));
      }
    });
    return Array.from(tags);
  }, [warmedWallets]);
  
  // Reload wallet info when settings change (wallet counts/amounts)
  useEffect(() => {
    if (Object.keys(settings).length > 0) {
      // Small delay to ensure settings are saved first
      const timer = setTimeout(() => {
        loadWalletInfo();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [settings.BUNDLE_WALLET_COUNT, settings.HOLDER_WALLET_COUNT, settings.BUNDLE_SWAP_AMOUNTS, settings.HOLDER_SWAP_AMOUNTS, settings.BUYER_WALLET, settings.BUYER_AMOUNT, settings.SWAP_AMOUNT, settings.HOLDER_WALLET_AMOUNT, settings.USE_NORMAL_LAUNCH]);

  // Reload wallet info when warmed wallet selection changes
  useEffect(() => {
    if (useWarmedWallets && (selectedBundleWallets.length > 0 || selectedHolderWallets.length > 0 || selectedCreatorWallet)) {
      const timer = setTimeout(() => {
        loadWalletInfo();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [useWarmedWallets, selectedBundleWallets.length, selectedHolderWallets.length, selectedCreatorWallet]);

  // Sync amounts with warmed wallet selections - ONLY for the specific type that's set to warmed
  useEffect(() => {
    // Only sync BUNDLE counts/amounts when Bundle is set to WARMED
    if (useWarmedBundleWallets) {
      const bundleCount = selectedBundleWallets.length;
      
      if (bundleCount === 0) {
        if (settings.BUNDLE_SWAP_AMOUNTS) {
          handleChange('BUNDLE_SWAP_AMOUNTS', '');
        }
        if (settings.BUNDLE_WALLET_COUNT !== '0') {
          handleChange('BUNDLE_WALLET_COUNT', '0');
        }
      } else {
        const currentAmounts = settings.BUNDLE_SWAP_AMOUNTS || '';
        const amountsArray = currentAmounts ? currentAmounts.split(',').map(a => a.trim()) : [];
        const defaultAmount = settings.SWAP_AMOUNT || '0.01';
        
        if (bundleCount !== amountsArray.length) {
          let newAmounts;
          if (bundleCount > amountsArray.length) {
            newAmounts = [...amountsArray];
            while (newAmounts.length < bundleCount) {
              newAmounts.push(defaultAmount);
            }
          } else {
            newAmounts = amountsArray.slice(0, bundleCount);
          }
          handleChange('BUNDLE_SWAP_AMOUNTS', newAmounts.join(','));
        }
        if (settings.BUNDLE_WALLET_COUNT !== bundleCount.toString()) {
          handleChange('BUNDLE_WALLET_COUNT', bundleCount.toString());
        }
      }
    }
    // NOTE: When Bundle is set to FRESH, .env BUNDLE_WALLET_COUNT is used as-is
  }, [useWarmedBundleWallets, selectedBundleWallets.length, settings.BUNDLE_SWAP_AMOUNTS, settings.SWAP_AMOUNT]);

  // Sync HOLDER amounts - ONLY when Holder is set to WARMED
  useEffect(() => {
    if (useWarmedHolderWallets) {
      const holderCount = selectedHolderWallets.length;
      
      if (holderCount === 0) {
        if (settings.HOLDER_SWAP_AMOUNTS) {
          handleChange('HOLDER_SWAP_AMOUNTS', '');
        }
        if (settings.HOLDER_WALLET_COUNT !== '0') {
          handleChange('HOLDER_WALLET_COUNT', '0');
        }
      } else {
        const currentAmounts = settings.HOLDER_SWAP_AMOUNTS || '';
        const amountsArray = currentAmounts ? currentAmounts.split(',').map(a => a.trim()) : [];
        const defaultAmount = settings.HOLDER_WALLET_AMOUNT || '0.01';
        
        if (holderCount !== amountsArray.length) {
          let newAmounts;
          if (holderCount > amountsArray.length) {
            // Pad with default amount
            newAmounts = [...amountsArray];
            while (newAmounts.length < holderCount) {
              newAmounts.push(defaultAmount);
            }
          } else {
            // Trim to match count
            newAmounts = amountsArray.slice(0, holderCount);
          }
          handleChange('HOLDER_SWAP_AMOUNTS', newAmounts.join(','));
        }
        if (settings.HOLDER_WALLET_COUNT !== holderCount.toString()) {
          handleChange('HOLDER_WALLET_COUNT', holderCount.toString());
        }
      }
    }
    // NOTE: When Holder is set to FRESH, .env HOLDER_WALLET_COUNT is used as-is
  }, [useWarmedHolderWallets, selectedHolderWallets.length, settings.HOLDER_SWAP_AMOUNTS, settings.HOLDER_WALLET_AMOUNT]);

  // Load tweet list from settings
  useEffect(() => {
    if (settings.TWITTER_TWEETS) {
      try {
        // Try to parse as JSON (new format with images)
        const parsed = JSON.parse(settings.TWITTER_TWEETS);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setTweetList(parsed.map(t => ({
            text: t.text || t,
            image: null,
            imagePreview: t.imagePreview || null,
            imagePath: t.imagePath || null,
          })));
          return;
        }
      } catch (e) {
        // Not JSON, use old pipe-separated format
      }
      
      // Old format: pipe-separated tweets
      const tweets = settings.TWITTER_TWEETS.split('|').filter(t => t.trim());
      if (tweets.length > 0) {
        setTweetList(tweets.map(text => ({
          text: text.trim(),
          image: null,
          imagePreview: null,
          imagePath: null,
        })));
        return;
      }
    }
    
    // Default: one empty tweet (only if no tweets exist)
    if (tweetList.length === 0) {
      setTweetList([{ text: '[token_name] is live! CA: [CA]', image: null, imagePreview: null, imagePath: null }]);
    }
  }, [settings.TWITTER_TWEETS]);

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

      // Restore website logo preview from saved WEBSITE_LOGO path
      if (loadedSettings.WEBSITE_LOGO && !websiteLogoFile) {
        const logoPath = loadedSettings.WEBSITE_LOGO;
        if (logoPath.startsWith('./image/') || logoPath.startsWith('image/')) {
          const filename = logoPath.replace(/^\.\/image\//, '').replace(/^image\//, '');
          setWebsiteLogoPreview(`http://localhost:3001/image/${filename}`);
        } else if (logoPath.startsWith('http')) {
          setWebsiteLogoPreview(logoPath);
        }
      }
      
      // Restore front-run threshold from .env
      if (loadedSettings.HOLDER_FRONT_RUN_THRESHOLD !== undefined) {
        setFrontRunThreshold(parseFloat(loadedSettings.HOLDER_FRONT_RUN_THRESHOLD) || 0);
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  // Load saved token configurations
  const loadSavedConfigs = async () => {
    try {
      setLoadingConfigs(true);
      const res = await apiService.getTokenConfigs();
      setSavedConfigs(res.data.configs || []);
    } catch (error) {
      console.error('Failed to load saved configs:', error);
      alert('Failed to load saved configurations: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoadingConfigs(false);
    }
  };

  // Save current token configuration
  const saveTokenConfig = async () => {
    if (!configSaveName.trim()) {
      alert('Please enter a name for this configuration');
      return;
    }

    try {
      // Collect ALL settings including wallet configuration
      const configToSave = {
        // Token Info
        TOKEN_NAME: settings.TOKEN_NAME || '',
        TOKEN_SYMBOL: settings.TOKEN_SYMBOL || '',
        DESCRIPTION: settings.DESCRIPTION || '',
        FILE: settings.FILE || '',
        WEBSITE_LOGO: settings.WEBSITE_LOGO || '',
        WEBSITE: settings.WEBSITE || '',
        WEBSITE_URL: settings.WEBSITE_URL || '',
        TELEGRAM: settings.TELEGRAM || '',
        TWITTER: settings.TWITTER || '',
        TWITTER_TWEETS: settings.TWITTER_TWEETS || '',
        
        // Marketing settings
        WEBSITE_THEME: settings.WEBSITE_THEME || '',
        WEBSITE_CUSTOM_COLOR: settings.WEBSITE_CUSTOM_COLOR || '',
        WEBSITE_CHAIN: settings.WEBSITE_CHAIN || '',
        
        // === WALLET CONFIGURATION ===
        // DEV/Creator buy
        BUYER_AMOUNT: settings.BUYER_AMOUNT || '0',
        
        // Bundle wallets
        BUNDLE_WALLET_COUNT: settings.BUNDLE_WALLET_COUNT || '0',
        BUNDLE_SWAP_AMOUNTS: settings.BUNDLE_SWAP_AMOUNTS || '',
        SWAP_AMOUNT: settings.SWAP_AMOUNT || '0.01',
        USE_NORMAL_LAUNCH: settings.USE_NORMAL_LAUNCH || 'false',
        
        // Holder wallets
        HOLDER_WALLET_COUNT: settings.HOLDER_WALLET_COUNT || '0',
        HOLDER_WALLET_AMOUNT: settings.HOLDER_WALLET_AMOUNT || '0.10',
        HOLDER_SWAP_AMOUNTS: settings.HOLDER_SWAP_AMOUNTS || '',
        AUTO_HOLDER_WALLET_BUY: settings.AUTO_HOLDER_WALLET_BUY || 'false',
        HOLDER_INTERMEDIARY_HOPS: settings.HOLDER_INTERMEDIARY_HOPS || '2',
        
        // Privacy routing
        USE_MIXING_WALLETS: settings.USE_MIXING_WALLETS || 'true',
        USE_MULTI_INTERMEDIARY_SYSTEM: settings.USE_MULTI_INTERMEDIARY_SYSTEM || 'false',
        NUM_INTERMEDIARY_HOPS: settings.NUM_INTERMEDIARY_HOPS || '2',
        BUNDLE_INTERMEDIARY_HOPS: settings.BUNDLE_INTERMEDIARY_HOPS || '2',
        
        // === WALLET SOURCE SELECTIONS ===
        _walletConfig: {
          useWarmedDevWallet,
          useWarmedBundleWallets,
          useWarmedHolderWallets,
          selectedCreatorWallet,
          selectedBundleWallets,
          selectedHolderWallets,
        },
        
        // === SNIPER SETTINGS ===
        _sniperConfig: {
          selectedHolderAutoBuyWallets,
          selectedHolderAutoBuyIndices,
          holderAutoBuyGroups,
          frontRunThreshold,
        },
        
        // Note: We don't save PRIVATE_KEY or BUYER_WALLET for security
      };

      await apiService.saveTokenConfig(configSaveName.trim(), configToSave);
      setConfigSaveName('');
      setShowConfigModal(false);
      await loadSavedConfigs();
      alert('✅ Full configuration saved! (Token info + Wallet settings + Snipers)');
    } catch (error) {
      console.error('Failed to save config:', error);
      alert('Failed to save configuration: ' + (error.response?.data?.error || error.message));
    }
  };

  // Load a saved token configuration
  const loadTokenConfig = async (configId) => {
    try {
      const res = await apiService.getTokenConfig(configId);
      const config = res.data.config;
      
      // Update settings with saved config (excluding special wallet/sniper configs)
      const updatedSettings = { ...settings };
      Object.keys(config).forEach(key => {
        if (key !== 'id' && key !== 'name' && key !== 'createdAt' && key !== 'updatedAt' && 
            key !== '_walletConfig' && key !== '_sniperConfig') {
          updatedSettings[key] = config[key];
        }
      });
      
      setSettings(updatedSettings);
      
      // === RESTORE WALLET CONFIGURATION ===
      if (config._walletConfig) {
        const wc = config._walletConfig;
        
        // Restore wallet source toggles
        if (typeof wc.useWarmedDevWallet === 'boolean') {
          setUseWarmedDevWallet(wc.useWarmedDevWallet);
        }
        if (typeof wc.useWarmedBundleWallets === 'boolean') {
          setUseWarmedBundleWallets(wc.useWarmedBundleWallets);
        }
        if (typeof wc.useWarmedHolderWallets === 'boolean') {
          setUseWarmedHolderWallets(wc.useWarmedHolderWallets);
        }
        
        // Restore selected wallets
        if (wc.selectedCreatorWallet) {
          setSelectedCreatorWallet(wc.selectedCreatorWallet);
        }
        if (Array.isArray(wc.selectedBundleWallets)) {
          setSelectedBundleWallets(wc.selectedBundleWallets);
        }
        if (Array.isArray(wc.selectedHolderWallets)) {
          setSelectedHolderWallets(wc.selectedHolderWallets);
        }
        
        // Load warmed wallets if any warmed type is selected
        if (wc.useWarmedDevWallet || wc.useWarmedBundleWallets || wc.useWarmedHolderWallets) {
          loadWarmedWallets();
        }
      }
      
      // === RESTORE SNIPER CONFIGURATION ===
      if (config._sniperConfig) {
        const sc = config._sniperConfig;
        
        if (Array.isArray(sc.selectedHolderAutoBuyWallets)) {
          setSelectedHolderAutoBuyWallets(sc.selectedHolderAutoBuyWallets);
        }
        if (Array.isArray(sc.selectedHolderAutoBuyIndices)) {
          setSelectedHolderAutoBuyIndices(sc.selectedHolderAutoBuyIndices);
        }
        if (Array.isArray(sc.holderAutoBuyGroups) && sc.holderAutoBuyGroups.length > 0) {
          setHolderAutoBuyGroups(sc.holderAutoBuyGroups);
        }
        if (typeof sc.frontRunThreshold === 'number') {
          setFrontRunThreshold(sc.frontRunThreshold);
        }
      }
      
      // NOTE: Don't save to .env here - just load into UI state
      // Settings will be saved to .env when launch button is pressed
      // This makes loading instant without terminal spam
      
      setShowConfigModal(false);
      console.log('[Config] ✅ Loaded config:', configId);
    } catch (error) {
      console.error('Failed to load config:', error);
      alert('Failed to load configuration: ' + (error.response?.data?.error || error.message));
    }
  };

  // Delete a saved token configuration
  const deleteTokenConfig = async (configId, e) => {
    e.stopPropagation(); // Prevent loading the config when clicking delete
    if (!confirm('Are you sure you want to delete this configuration?')) {
      return;
    }

    try {
      await apiService.deleteTokenConfig(configId);
      await loadSavedConfigs();
      alert('✅ Configuration deleted successfully!');
    } catch (error) {
      console.error('Failed to delete config:', error);
      alert('Failed to delete configuration: ' + (error.response?.data?.error || error.message));
    }
  };

  // Export current configuration as JSON file
  const exportConfigAsJSON = () => {
    const configToExport = {
      name: settings.TOKEN_NAME || 'Token Configuration',
      symbol: settings.TOKEN_SYMBOL || '',
      description: settings.DESCRIPTION || '',
      tokenImage: settings.FILE || '',
      websiteLogo: settings.WEBSITE_LOGO || '',
      website: settings.WEBSITE || '',
      websiteUrl: settings.WEBSITE_URL || '',
      telegram: settings.TELEGRAM || '',
      twitter: settings.TWITTER || '',
      twitterTweets: settings.TWITTER_TWEETS || '',
      websiteTheme: settings.WEBSITE_THEME || '',
      websiteCustomColor: settings.WEBSITE_CUSTOM_COLOR || '',
      websiteChain: settings.WEBSITE_CHAIN || '',
      exportedAt: new Date().toISOString(),
      version: '1.0'
    };

    const jsonStr = JSON.stringify(configToExport, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${configToExport.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-config.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    alert('✅ Configuration exported as JSON file!');
  };

  // Import configuration from JSON file
  const importConfigFromJSON = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedConfig = JSON.parse(e.target.result);
        
        // Map imported config to settings
        const updatedSettings = { ...settings };
        
        if (importedConfig.name) updatedSettings.TOKEN_NAME = importedConfig.name;
        if (importedConfig.symbol) updatedSettings.TOKEN_SYMBOL = importedConfig.symbol;
        if (importedConfig.description) updatedSettings.DESCRIPTION = importedConfig.description;
        if (importedConfig.tokenImage) updatedSettings.FILE = importedConfig.tokenImage;
        if (importedConfig.websiteLogo) updatedSettings.WEBSITE_LOGO = importedConfig.websiteLogo;
        if (importedConfig.website) updatedSettings.WEBSITE = importedConfig.website;
        if (importedConfig.websiteUrl) updatedSettings.WEBSITE_URL = importedConfig.websiteUrl;
        if (importedConfig.telegram) updatedSettings.TELEGRAM = importedConfig.telegram;
        if (importedConfig.twitter) updatedSettings.TWITTER = importedConfig.twitter;
        if (importedConfig.twitterTweets) updatedSettings.TWITTER_TWEETS = importedConfig.twitterTweets;
        if (importedConfig.websiteTheme) updatedSettings.WEBSITE_THEME = importedConfig.websiteTheme;
        if (importedConfig.websiteCustomColor) updatedSettings.WEBSITE_CUSTOM_COLOR = importedConfig.websiteCustomColor;
        if (importedConfig.websiteChain) updatedSettings.WEBSITE_CHAIN = importedConfig.websiteChain;
        
        setSettings(updatedSettings);
        
        // Save to .env file
        apiService.updateSettings(updatedSettings).then(() => {
          // Reload settings to get image previews
          loadSettings();
          alert('✅ Configuration imported successfully!');
        }).catch(err => {
          console.error('Failed to save imported config:', err);
          alert('⚠️ Configuration loaded but failed to save to .env: ' + (err.response?.data?.error || err.message));
        });
        
        // Reset file input
        event.target.value = '';
      } catch (error) {
        console.error('Failed to parse JSON:', error);
        alert('❌ Invalid JSON file: ' + error.message);
        event.target.value = '';
      }
    };
    reader.onerror = () => {
      alert('❌ Failed to read file');
      event.target.value = '';
    };
    reader.readAsText(file);
  };

  // Load saved configs on component mount
  useEffect(() => {
    loadSavedConfigs();
  }, []);

  const loadNextAddress = async () => {
    try {
      const res = await apiService.getNextPumpAddress();
      console.log('[Next Address] API Response:', res.data);
      // API returns { success: true, address: ..., source: ... }
      const addressData = res.data?.address !== undefined ? res.data : null;
      setNextAddress(addressData);
      console.log('[Next Address] Set to:', addressData);
    } catch (error) {
      console.error('Failed to load next address:', error);
      setNextAddress(null);
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
      // Pass warmed wallet addresses AND flags to indicate which are pre-funded
      const params = {};
      
      // Pass per-type warmed wallet flags - crucial for correct SOL calculation
      params.useWarmedBundleWallets = useWarmedBundleWallets;
      params.useWarmedHolderWallets = useWarmedHolderWallets;
      params.useWarmedDevWallet = useWarmedDevWallet;
      
      if (useWarmedBundleWallets && selectedBundleWallets.length > 0) {
        params.bundleAddresses = selectedBundleWallets.join(',');
      }
      if (useWarmedHolderWallets && selectedHolderWallets.length > 0) {
        params.holderAddresses = selectedHolderWallets.join(',');
      }
      if (useWarmedDevWallet && selectedCreatorWallet) {
        params.creatorAddress = selectedCreatorWallet;
      }
      
      const res = await apiService.getLaunchWalletInfo(params);
      setWalletInfo(res.data.data);
    } catch (error) {
      console.error('Failed to load wallet info:', error);
    }
  };

  const handleImageChange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result);
      };
      reader.readAsDataURL(file);
      
      // Auto-upload and save immediately
      try {
        setSavingStatus('Uploading image...');
        const filePath = await uploadImage(file);
        if (filePath) {
          // Update settings immediately
          const newSettings = { ...settings, FILE: filePath };
          setSettings(newSettings);
          
          // Update image preview to use the saved path
          const filename = filePath.replace(/^\.\/image\//, '').replace(/^image\//, '');
          setImagePreview(`http://localhost:3001/image/${filename}`);
          
          // Save to backend
          await apiService.updateSettings({ FILE: filePath });
          setImageFile(null); // Clear file so it doesn't re-upload
          setSavingStatus('✅ Image saved!');
          setTimeout(() => setSavingStatus(''), 2000);
        }
      } catch (error) {
        console.error('Failed to auto-save image:', error);
        setSavingStatus('❌ Failed to save image');
        setTimeout(() => setSavingStatus(''), 3000);
      }
    } else {
      // Clear preview if file input is cleared
      setImageFile(null);
      // Keep the saved image preview if settings.FILE exists
      if (!settings.FILE) {
        setImagePreview(null);
      }
    }
  };

  // AI Image Generation (Nano Banana / Gemini)
  const handleAiGenerateImage = async () => {
    // Use token name/description as prompt if no custom prompt
    const prompt = aiImagePrompt.trim() || 
      `${settings.NAME || 'Token'} ${settings.TICKER ? `(${settings.TICKER})` : ''} ${settings.DESCRIPTION ? `: ${settings.DESCRIPTION.slice(0, 100)}` : ''}`;
    
    if (!prompt) {
      setAiGeneratorError('Please enter a prompt or fill in token name/description first');
      return;
    }
    
    setAiImageGenerating(true);
    setAiGeneratorError(null);
    
    try {
      const response = await apiService.generateAIImage(prompt, aiImageStyle);
      
      if (response.data?.success && response.data?.base64) {
        // Set the preview with the base64 data initially
        setImagePreview(`data:image/png;base64,${response.data.base64}`);
        
        // Use the imageUrl from response (Vercel Blob URL if uploaded, otherwise local)
        if (response.data.imageUrl) {
          // If uploaded to Vercel Blob, use the full URL directly
          // Otherwise, prepend localhost for local files
          const imageUrl = response.data.uploadedToBlob 
            ? response.data.imageUrl 
            : `http://localhost:3001${response.data.imageUrl}`;
          
          // Use the imagePath for settings (Vercel URL or local path)
          const filePath = response.data.imagePath;
          const newSettings = { ...settings, FILE: filePath };
          setSettings(newSettings);
          
          // Update preview to use the proper URL
          setImagePreview(imageUrl);
          
          // Save to backend
          await apiService.updateSettings({ FILE: filePath });
          
          const statusMsg = response.data.uploadedToBlob 
            ? '✅ AI Image generated & uploaded to cloud!' 
            : '✅ AI Image generated & saved locally!';
          setSavingStatus(statusMsg);
          setTimeout(() => setSavingStatus(''), 3000);
        }
        
        // Close the AI generator panel after success
        setShowAiGenerator(false);
        setAiImagePrompt('');
        
      } else {
        throw new Error(response.data?.error || 'Failed to generate image');
      }
    } catch (error) {
      console.error('AI Image generation failed:', error);
      
      // Check for quota error
      if (error.response?.data?.quotaError || error.response?.status === 429) {
        setAiGeneratorError('⚠️ Gemini AI requires PAID billing. Free tier has 0 quota for image generation. Enable billing or use static logo upload instead.');
      } else {
        setAiGeneratorError(error.response?.data?.error || error.message || 'Failed to generate image');
      }
    } finally {
      setAiImageGenerating(false);
    }
  };

  const handleWebsiteLogoChange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      setWebsiteLogoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setWebsiteLogoPreview(reader.result);
      };
      reader.readAsDataURL(file);
      
      // Auto-upload and save immediately
      try {
        setSavingStatus('Uploading logo...');
        const logoPath = await uploadImage(file);
        if (logoPath) {
          // Update settings immediately
          const newSettings = { ...settings, WEBSITE_LOGO: logoPath };
          setSettings(newSettings);
          
          // Update logo preview to use the saved path
          const filename = logoPath.replace(/^\.\/image\//, '').replace(/^image\//, '');
          setWebsiteLogoPreview(`http://localhost:3001/image/${filename}`);
          
          // Save to backend
          await apiService.updateSettings({ WEBSITE_LOGO: logoPath });
          setWebsiteLogoFile(null); // Clear file so it doesn't re-upload
          setSavingStatus('✅ Logo saved!');
          setTimeout(() => setSavingStatus(''), 2000);
        }
      } catch (error) {
        console.error('Failed to auto-save logo:', error);
        setSavingStatus('❌ Failed to save logo');
        setTimeout(() => setSavingStatus(''), 3000);
      }
    } else {
      setWebsiteLogoFile(null);
      if (!settings.WEBSITE_LOGO) {
        setWebsiteLogoPreview(null);
      }
    }
  };

  const uploadImage = async (file = null) => {
    const fileToUpload = file || imageFile;
    if (!fileToUpload) return null;
    try {
      const res = await apiService.uploadImage(fileToUpload);
      return res.data.filePath;
    } catch (error) {
      console.error('Failed to upload image:', error);
      alert('Failed to upload image: ' + error.message);
      return null;
    }
  };

  // Extract domain from URL (for auto-filling WEBSITE_URL from WEBSITE)
  const extractDomain = (url) => {
    if (!url || !url.trim()) return '';
    try {
      // Remove protocol
      let domain = url.replace(/^https?:\/\//, '');
      // Remove trailing slash
      domain = domain.replace(/\/$/, '');
      // Remove path (everything after /)
      domain = domain.split('/')[0];
      // Remove port
      domain = domain.split(':')[0];
      // Remove www. prefix
      domain = domain.replace(/^www\./, '');
      return domain;
    } catch (e) {
      return '';
    }
  };

  // Load token image as base64 for testing
  const loadImageAsBase64 = async (imagePath) => {
    if (!imagePath) return null;
    try {
      // If it's already a data URL, return it
      if (imagePath.startsWith('data:')) return imagePath;
      
      // If it's a relative path, convert to full URL
      let imageUrl = imagePath;
      if (imagePath.startsWith('./image/') || imagePath.startsWith('image/')) {
        const filename = imagePath.replace(/^\.\/image\//, '').replace(/^image\//, '');
        imageUrl = `http://localhost:3001/image/${filename}`;
      }
      
      // Fetch and convert to base64
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error('Failed to load image:', error);
      return null;
    }
  };

  // Test Website Update
  const testWebsiteUpdate = async () => {
    if (!settings.WEBSITE_URL) {
      alert('Please set WEBSITE_URL first');
      return;
    }
    
    setTestingMarketing({ ...testingMarketing, website: true });
    setMarketingTestResults({ ...marketingTestResults, website: null });
    
    try {
      // Handle theme - normalize to lowercase for razebot CSS files (blue.css, green.css, etc.)
      const websiteTheme = settings.WEBSITE_THEME || 'DEFAULT';
      let colorScheme = undefined; // Don't set default - let database keep existing value
      let darkMode = false;
      
      if (websiteTheme === 'CUSTOM' && settings.WEBSITE_CUSTOM_COLOR) {
        // For custom colors, use as-is but normalize to lowercase
        colorScheme = String(settings.WEBSITE_CUSTOM_COLOR).toLowerCase().trim();
        darkMode = false;
      } else if (websiteTheme && websiteTheme !== 'DEFAULT' && websiteTheme !== 'CUSTOM') {
        // Handle Theme1, Theme2, Theme3 as structured themes (keep uppercase)
        if (websiteTheme === 'THEME1' || websiteTheme === 'THEME2' || websiteTheme === 'THEME3') {
          colorScheme = websiteTheme.toUpperCase();
        } else {
          // Other themes (BLUE, GREEN, etc.) are color-based - normalize to lowercase for CSS file names
          colorScheme = websiteTheme.toLowerCase().trim();
        }
        darkMode = false;
      }
      // If DEFAULT, leave colorScheme as undefined so it doesn't update the database field (uses original theme)
      
      // Upload token image to Vercel Blob if needed, then use URL
      let tokenImageUrl = null;
      
      if (settings.FILE) {
        // If FILE is already a URL (Vercel Blob or http), use it directly
        if (settings.FILE.startsWith('http')) {
          tokenImageUrl = settings.FILE;
        } 
        // If FILE is a local path, try to upload it
        else if (settings.FILE.startsWith('./image/') || settings.FILE.startsWith('image/')) {
          try {
            // Try to upload the local file to Vercel Blob
            const filename = settings.FILE.replace(/^\.\/image\//, '').replace(/^image\//, '');
            const localUrl = `http://localhost:3001/image/${filename}`;
            
            // Fetch the image and upload to Vercel Blob
            const imageResponse = await fetch(localUrl);
            if (imageResponse.ok) {
              const blob = await imageResponse.blob();
              const formData = new FormData();
              formData.append('image', blob, filename);
              
              const uploadResponse = await fetch('http://localhost:3001/api/upload-image', {
                method: 'POST',
                body: formData,
              });
              
              if (uploadResponse.ok) {
                const uploadResult = await uploadResponse.json();
                tokenImageUrl = uploadResult.filePath; // Vercel Blob URL
              } else {
                // Fallback to local URL if upload fails
                tokenImageUrl = localUrl;
              }
            } else {
              tokenImageUrl = localUrl;
            }
          } catch (error) {
            console.warn('Failed to upload image, using local URL:', error);
            const filename = settings.FILE.replace(/^\.\/image\//, '').replace(/^image\//, '');
            tokenImageUrl = `http://localhost:3001/image/${filename}`;
          }
        }
      }
      
      // Get website logo URL (separate from token image)
      let websiteLogoUrl = null;
      if (settings.WEBSITE_LOGO) {
        // If WEBSITE_LOGO is already a URL, use it directly
        if (settings.WEBSITE_LOGO.startsWith('http')) {
          websiteLogoUrl = settings.WEBSITE_LOGO;
        } else if (settings.WEBSITE_LOGO.startsWith('./image/') || settings.WEBSITE_LOGO.startsWith('image/')) {
          // Convert local path to URL
          const filename = settings.WEBSITE_LOGO.replace(/^\.\/image\//, '').replace(/^image\//, '');
          websiteLogoUrl = `http://localhost:3001/image/${filename}`;
        } else {
          websiteLogoUrl = settings.WEBSITE_LOGO;
        }
      }
      
      const response = await fetch('http://localhost:3001/api/marketing/website/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vercelSiteUrl: settings.WEBSITE_URL,
          secret: settings.WEBSITE_SECRET || '',
          tokenConfig: {
            tokenName: settings.TOKEN_NAME || '',
            tokenSymbol: settings.TOKEN_SYMBOL || '',
            tokenAddress: settings.CUSTOM_TOKEN_ADDRESS || nextAddress?.address || settings.TOKEN_ADDRESS || 'Not set',
            website: settings.WEBSITE || '',
            telegram: settings.TELEGRAM || '',
            twitter: settings.TWITTER || '',
            description: settings.DESCRIPTION || '',
            chain: settings.WEBSITE_CHAIN || 'solana',
            logoUrl: websiteLogoUrl || null, // Use website logo for logoUrl (saves to website_logo_image)
            tokenImageUrl: tokenImageUrl || null, // Use token image for tokenImageUrl
            ...(colorScheme !== undefined && { colorScheme: colorScheme }), // Only include if defined (DEFAULT theme won't update)
            darkMode: darkMode,
          }
        })
      });
      
      // Check if response is JSON
      const contentType = response.headers.get('content-type');
      let result;
      if (contentType && contentType.includes('application/json')) {
        result = await response.json();
      } else {
        // Response is HTML (error page) or other format
        const text = await response.text();
        throw new Error(`Server returned non-JSON response (${response.status}): ${text.substring(0, 200)}...\n\nMake sure the API server is running on port 3001.`);
      }
      
      // Check for HTTP errors
      if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}: ${result.message || 'Unknown error'}`);
      }
      setMarketingTestResults({ ...marketingTestResults, website: result });
      
      if (result.success) {
        alert(`✅ Website update test successful!\n\nSite: ${result.site_url || settings.WEBSITE_URL}`);
      } else {
        alert(`❌ Website update test failed:\n\n${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      setMarketingTestResults({ ...marketingTestResults, website: { success: false, error: error.message } });
      alert(`❌ Website update test error:\n\n${error.message}`);
    } finally {
      setTestingMarketing({ ...testingMarketing, website: false });
    }
  };

  // Vercel Projects & Domain Management
  const [vercelProjects, setVercelProjects] = useState([]);
  const [vercelDomains, setVercelDomains] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedDomain, setSelectedDomain] = useState('');
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingDomains, setLoadingDomains] = useState(false);
  const [disconnectingDomain, setDisconnectingDomain] = useState(false);
  const [connectingDomain, setConnectingDomain] = useState(false);
  
  // Domain Search & Purchase
  const [domainSearchQuery, setDomainSearchQuery] = useState('');
  const [domainSearchResults, setDomainSearchResults] = useState([]);
  const [searchingDomains, setSearchingDomains] = useState(false);
  const [purchasingDomain, setPurchasingDomain] = useState(null);

  // Fetch Vercel projects and domains on component mount
  useEffect(() => {
    const fetchVercelProjects = async () => {
      setLoadingProjects(true);
      try {
        const response = await fetch('http://localhost:3001/api/vercel/projects');
        const result = await response.json();
        if (result.success) {
          setVercelProjects(result.projects || []);
          // Set default project if available
          if (result.defaultProjectId) {
            setSelectedProjectId(result.defaultProjectId);
          } else if (result.projects?.length > 0) {
            setSelectedProjectId(result.projects[0].id);
          }
        }
      } catch (error) {
        console.error('Failed to fetch Vercel projects:', error);
      } finally {
        setLoadingProjects(false);
      }
    };
    
    const fetchVercelDomains = async () => {
      setLoadingDomains(true);
      try {
        const response = await fetch('http://localhost:3001/api/vercel/domains');
        const result = await response.json();
        if (result.success) {
          setVercelDomains(result.domains || []);
          // Set default from WEBSITE_URL if available
          if (settings.WEBSITE_URL) {
            const domain = settings.WEBSITE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
            setSelectedDomain(domain);
          } else if (result.domains?.length > 0) {
            setSelectedDomain(result.domains[0].name);
          }
        }
      } catch (error) {
        console.error('Failed to fetch Vercel domains:', error);
      } finally {
        setLoadingDomains(false);
      }
    };
    
    fetchVercelProjects();
    fetchVercelDomains();
  }, []);

  // Connect domain to selected project
  const connectDomain = async () => {
    if (!selectedDomain) {
      alert('Please select a domain first');
      return;
    }
    if (!selectedProjectId) {
      alert('Please select a Vercel project first');
      return;
    }
    
    const project = vercelProjects.find(p => p.id === selectedProjectId);
    
    setConnectingDomain(true);
    
    try {
      const response = await fetch('http://localhost:3001/api/domains/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: selectedDomain, projectId: selectedProjectId }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        if (result.alreadyConnected) {
          alert(`ℹ️ Domain "${selectedDomain}" is already connected to "${project?.name || selectedProjectId}".`);
        } else {
          alert(`✅ Domain "${selectedDomain}" connected to "${project?.name || selectedProjectId}"!`);
        }
      } else {
        alert(`❌ Failed to connect domain: ${result.error}`);
      }
    } catch (error) {
      alert(`❌ Error: ${error.message}`);
    } finally {
      setConnectingDomain(false);
    }
  };

  // Disconnect domain from selected project
  const disconnectDomain = async () => {
    if (!selectedDomain) {
      alert('Please select a domain first');
      return;
    }
    if (!selectedProjectId) {
      alert('Please select a Vercel project first');
      return;
    }
    
    const project = vercelProjects.find(p => p.id === selectedProjectId);
    
    if (!confirm(`Are you sure you want to disconnect "${selectedDomain}" from "${project?.name || selectedProjectId}"?\n\nYou will still OWN the domain, it just won't be connected to this project.`)) {
      return;
    }
    
    setDisconnectingDomain(true);
    
    try {
      const response = await fetch('http://localhost:3001/api/domains/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: selectedDomain, projectId: selectedProjectId }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        if (result.alreadyDisconnected) {
          alert(`ℹ️ Domain "${selectedDomain}" was not connected to "${project?.name || selectedProjectId}".`);
        } else {
          alert(`✅ Domain "${selectedDomain}" disconnected from "${project?.name || selectedProjectId}"!\n\nYou still own the domain and can reconnect it later.`);
        }
      } else {
        alert(`❌ Failed to disconnect domain: ${result.error}`);
      }
    } catch (error) {
      alert(`❌ Error: ${error.message}`);
    } finally {
      setDisconnectingDomain(false);
    }
  };

  // Search for available domains
  const searchDomains = async () => {
    if (!domainSearchQuery.trim()) {
      alert('Please enter a domain name to search');
      return;
    }
    
    setSearchingDomains(true);
    setDomainSearchResults([]);
    
    try {
      const response = await fetch(`http://localhost:3001/api/vercel/domains/search?query=${encodeURIComponent(domainSearchQuery)}&maxPrice=20`);
      const result = await response.json();
      
      if (result.success && result.domains) {
        setDomainSearchResults(result.domains);
        if (result.domains.length === 0) {
          alert('No available domains found under $20. Try a different name.');
        }
      } else {
        alert(`Search failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Domain search error:', error);
      alert(`Error searching domains: ${error.message}`);
    } finally {
      setSearchingDomains(false);
    }
  };

  // Purchase a domain
  const purchaseDomain = async (domain) => {
    if (!confirm(`🛒 Purchase "${domain.domain}" for ${domain.priceFormatted}?\n\nThis will charge your Vercel account.`)) {
      return;
    }
    
    setPurchasingDomain(domain.domain);
    
    try {
      const response = await fetch('http://localhost:3001/api/vercel/domains/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: domain.domain }),
      });
      const result = await response.json();
      
      if (result.success) {
        alert(`✅ Domain "${domain.domain}" purchased successfully!\n\nIt should appear in your domains list shortly.`);
        // Refresh domain list
        setDomainSearchResults([]);
        setDomainSearchQuery('');
        // Reload owned domains
        try {
          const domainsRes = await fetch('http://localhost:3001/api/vercel/domains');
          const domainsResult = await domainsRes.json();
          if (domainsResult.success) {
            setVercelDomains(domainsResult.domains || []);
          }
        } catch (e) { /* ignore */ }
      } else {
        alert(`❌ Failed to purchase domain: ${result.error}`);
      }
    } catch (error) {
      console.error('Domain purchase error:', error);
      alert(`❌ Error purchasing domain: ${error.message}`);
    } finally {
      setPurchasingDomain(null);
    }
  };

  // Telegram Verification
  const handleSendTelegramCode = async () => {
    if (!settings.TELEGRAM_API_ID || !settings.TELEGRAM_API_HASH || !settings.TELEGRAM_PHONE) {
      alert('Please fill in Telegram API credentials first (API ID, API Hash, Phone)');
      return;
    }

    setTelegramVerification({ ...telegramVerification, verifying: true, error: null });
    
    try {
      const res = await apiService.sendTelegramCode(
        settings.TELEGRAM_API_ID,
        settings.TELEGRAM_API_HASH,
        settings.TELEGRAM_PHONE
      );
      
      if (res.data.success) {
        if (res.data.authorized) {
          setTelegramVerification({
            codeSent: false,
            phoneCodeHash: null,
            requires2FA: false,
            verifying: false,
            verified: true,
            error: null,
          });
          alert('✅ Account is already verified!');
        } else {
          setTelegramVerification({
            codeSent: true,
            phoneCodeHash: res.data.phone_code_hash || null,
            requires2FA: false,
            verifying: false,
            verified: false,
            error: null,
          });
        }
      } else {
        setTelegramVerification({
          ...telegramVerification,
          verifying: false,
          error: res.data.error || 'Failed to send code',
        });
      }
    } catch (error) {
      setTelegramVerification({
        ...telegramVerification,
        verifying: false,
        error: error.response?.data?.error || error.message || 'Failed to send verification code',
      });
    }
  };

  const handleVerifyTelegramCode = async () => {
    if (!telegramCode.trim()) {
      alert('Please enter the verification code');
      return;
    }

    if (!settings.TELEGRAM_API_ID || !settings.TELEGRAM_API_HASH || !settings.TELEGRAM_PHONE) {
      alert('Please fill in Telegram API credentials first');
      return;
    }

    setTelegramVerification({ ...telegramVerification, verifying: true, error: null });
    
    try {
      const res = await apiService.verifyTelegramCode(
        settings.TELEGRAM_API_ID,
        settings.TELEGRAM_API_HASH,
        settings.TELEGRAM_PHONE,
        telegramCode.trim(),
        telegramVerification.phoneCodeHash,
        telegram2FAPassword || undefined
      );
      
      if (res.data.success) {
        setTelegramVerification({
          codeSent: false,
          phoneCodeHash: null,
          requires2FA: false,
          verifying: false,
          verified: true,
          error: null,
        });
        setTelegramCode('');
        setTelegram2FAPassword('');
        alert('✅ Account verified successfully!');
      } else {
        if (res.data.requires_2fa) {
          setTelegramVerification({
            ...telegramVerification,
            requires2FA: true,
            verifying: false,
            error: null,
          });
        } else {
          setTelegramVerification({
            ...telegramVerification,
            verifying: false,
            error: res.data.error || 'Verification failed',
          });
        }
      }
    } catch (error) {
      setTelegramVerification({
        ...telegramVerification,
        verifying: false,
        error: error.response?.data?.error || error.message || 'Failed to verify code',
      });
    }
  };

  const handleCheckTelegramStatus = async () => {
    if (!settings.TELEGRAM_API_ID || !settings.TELEGRAM_API_HASH || !settings.TELEGRAM_PHONE) {
      alert('Please fill in Telegram API credentials first');
      return;
    }

    setTelegramVerification({ ...telegramVerification, verifying: true, error: null });
    
    try {
      const res = await apiService.checkTelegramStatus(
        settings.TELEGRAM_API_ID,
        settings.TELEGRAM_API_HASH,
        settings.TELEGRAM_PHONE
      );
      
      if (res.data.success) {
        setTelegramVerification({
          codeSent: false,
          phoneCodeHash: null,
          requires2FA: false,
          verifying: false,
          verified: res.data.authorized || false,
          error: null,
        });
        if (res.data.authorized) {
          alert('✅ Account is verified!');
        } else {
          alert('⚠️ Account needs verification. Click "Verify Account" to start.');
        }
      } else {
        setTelegramVerification({
          ...telegramVerification,
          verifying: false,
          error: res.data.error || 'Failed to check status',
        });
      }
    } catch (error) {
      setTelegramVerification({
        ...telegramVerification,
        verifying: false,
        error: error.response?.data?.error || error.message || 'Failed to check status',
      });
    }
  };

  // Test Telegram Creation
  const testTelegramCreation = async () => {
    if (!settings.TELEGRAM_API_ID || !settings.TELEGRAM_API_HASH || !settings.TELEGRAM_PHONE) {
      alert('Please fill in Telegram API credentials first (API ID, API Hash, Phone)');
      return;
    }
    
    setTestingMarketing({ ...testingMarketing, telegram: true });
    setMarketingTestResults({ ...marketingTestResults, telegram: null });
    
    try {
      // For testing, use image URL instead of base64 to avoid payload size issues
      let tokenImageBase64 = null;
      let tokenImageUrl = null;
      
      if (settings.FILE) {
        try {
          tokenImageBase64 = await loadImageAsBase64(settings.FILE);
          // If base64 is too large (>5MB), use URL instead
          if (tokenImageBase64 && tokenImageBase64.length > 5 * 1024 * 1024) {
            console.log('Image too large for base64, using URL instead');
            tokenImageBase64 = null;
            if (settings.FILE.startsWith('./image/') || settings.FILE.startsWith('image/')) {
              const filename = settings.FILE.replace(/^\.\/image\//, '').replace(/^image\//, '');
              tokenImageUrl = `http://localhost:3001/image/${filename}`;
            } else if (settings.FILE.startsWith('http')) {
              tokenImageUrl = settings.FILE;
            }
          }
        } catch (error) {
          console.warn('Failed to load image as base64, using URL instead:', error);
          if (settings.FILE.startsWith('./image/') || settings.FILE.startsWith('image/')) {
            const filename = settings.FILE.replace(/^\.\/image\//, '').replace(/^image\//, '');
            tokenImageUrl = `http://localhost:3001/image/${filename}`;
          } else if (settings.FILE.startsWith('http')) {
            tokenImageUrl = settings.FILE;
          }
        }
      }
      const websiteUrl = settings.WEBSITE_URL || (settings.WEBSITE ? extractDomain(settings.WEBSITE) : '');
      
      const filterScript = (settings.TELEGRAM_FILTER_SCRIPT || '/filter CA {contract_address}\n/filter website {website}\n/filter X {twitter}')
        .replace('{contract_address}', settings.CUSTOM_TOKEN_ADDRESS || nextAddress?.address || settings.TOKEN_ADDRESS || '{contract_address}')
        .replace('{website}', settings.WEBSITE || '')
        .replace('{twitter}', settings.TWITTER || '');
      
      const response = await fetch('http://localhost:3001/api/marketing/telegram/create-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: {
            telegram_api_id: settings.TELEGRAM_API_ID,
            telegram_api_hash: settings.TELEGRAM_API_HASH,
            telegram_phone: settings.TELEGRAM_PHONE,
            token_name: settings.TOKEN_NAME || '',
            token_symbol: settings.TOKEN_SYMBOL || '',
            token_address: settings.CUSTOM_TOKEN_ADDRESS || nextAddress?.address || settings.TOKEN_ADDRESS || 'Not set',
            chain: settings.WEBSITE_CHAIN || 'solana',
            website: settings.WEBSITE || '',
            telegram: settings.TELEGRAM || '',
            twitter: settings.TWITTER || '',
            description: settings.DESCRIPTION || '',
            create_group: settings.TELEGRAM_CREATE_GROUP !== 'false',
            create_channel: settings.TELEGRAM_CREATE_CHANNEL === 'true',
            channel_username: settings.TELEGRAM_CHANNEL_USERNAME || '',
            group_title_template: settings.TELEGRAM_GROUP_TITLE_TEMPLATE || '{token_name} Official',
            group_description: settings.TELEGRAM_GROUP_DESCRIPTION || '{description}\nWebsite: {website}\nTwitter: {twitter}',
            token_image_url: tokenImageUrl || tokenImageBase64 || null,
            use_safeguard_bot: settings.TELEGRAM_USE_SAFEGUARD_BOT !== 'false',
            safeguard_bot_username: settings.TELEGRAM_SAFEGUARD_BOT_USERNAME || '@safeguard',
            create_portal: settings.TELEGRAM_CREATE_PORTAL === 'true',
            filter_script: filterScript,
            users: {},
            invite_users: [],
          },
          scripted_conversations: [],
        })
      });
      
      // Check if response is JSON
      const contentType = response.headers.get('content-type');
      let result;
      if (contentType && contentType.includes('application/json')) {
        result = await response.json();
      } else {
        // Response is HTML (error page) or other format
        const text = await response.text();
        throw new Error(`Server returned non-JSON response (${response.status}): ${text.substring(0, 200)}...\n\nMake sure the API server is running on port 3001.`);
      }
      
      // Check for HTTP errors
      if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}: ${result.message || 'Unknown error'}`);
      }
      setMarketingTestResults({ ...marketingTestResults, telegram: result });
      
      if (result.success) {
        alert(`✅ Telegram creation test successful!\n\n${result.message || 'Group/channel created'}\n${result.telegram_link ? `Link: ${result.telegram_link}` : ''}`);
      } else {
        alert(`❌ Telegram creation test failed:\n\n${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      setMarketingTestResults({ ...marketingTestResults, telegram: { success: false, error: error.message } });
      alert(`❌ Telegram creation test error:\n\n${error.message}`);
    } finally {
      setTestingMarketing({ ...testingMarketing, telegram: false });
    }
  };

  // Get Twitter Account Info
  const getTwitterAccountInfo = async () => {
    if (!settings.TWITTER_API_KEY || !settings.TWITTER_API_SECRET || !settings.TWITTER_ACCESS_TOKEN || !settings.TWITTER_ACCESS_TOKEN_SECRET) {
      alert('Please fill in Twitter API credentials first (API Key, API Secret, Access Token, Access Token Secret)');
      return;
    }
    
    setLoadingTwitterAccount(true);
    try {
      const response = await apiService.getTwitterAccountInfo(
        settings.TWITTER_API_KEY,
        settings.TWITTER_API_SECRET,
        settings.TWITTER_ACCESS_TOKEN,
        settings.TWITTER_ACCESS_TOKEN_SECRET
      );
      
      if (response.data.success) {
        const account = response.data.account;
        setTwitterAccountInfo(account);
        
        // Save to localStorage
        const savedAccounts = JSON.parse(localStorage.getItem('savedTwitterAccounts') || '[]');
        const existingIndex = savedAccounts.findIndex(a => a.id === account.id);
        const accountData = {
          ...account,
          credentials: {
            apiKey: settings.TWITTER_API_KEY,
            apiSecret: settings.TWITTER_API_SECRET,
            accessToken: settings.TWITTER_ACCESS_TOKEN,
            accessTokenSecret: settings.TWITTER_ACCESS_TOKEN_SECRET,
          },
          lastVerified: new Date().toISOString(),
        };
        
        if (existingIndex >= 0) {
          savedAccounts[existingIndex] = accountData;
        } else {
          savedAccounts.unshift(accountData);
        }
        
        localStorage.setItem('savedTwitterAccounts', JSON.stringify(savedAccounts));
        setSavedTwitterAccounts(savedAccounts);
        
        alert(`✅ Account verified & saved!\n\nUsername: @${account.username}\nName: ${account.name}${account.verified ? '\n✓ Verified Account' : ''}`);
      } else {
        alert(`❌ Failed to verify account: ${response.data.error || 'Unknown error'}`);
        setTwitterAccountInfo(null);
      }
    } catch (error) {
      console.error('Failed to get Twitter account info:', error);
      alert(`❌ Failed to verify account: ${error.response?.data?.error || error.message || 'Unknown error'}`);
      setTwitterAccountInfo(null);
    } finally {
      setLoadingTwitterAccount(false);
    }
  };

  // Load saved Twitter account credentials
  const loadSavedTwitterAccount = (account) => {
    if (account?.credentials) {
      handleChange('TWITTER_API_KEY', account.credentials.apiKey);
      handleChange('TWITTER_API_SECRET', account.credentials.apiSecret);
      handleChange('TWITTER_ACCESS_TOKEN', account.credentials.accessToken);
      handleChange('TWITTER_ACCESS_TOKEN_SECRET', account.credentials.accessTokenSecret);
      setTwitterAccountInfo(account);
    }
  };

  // Delete saved Twitter account
  const deleteSavedTwitterAccount = (accountId, e) => {
    e.stopPropagation();
    if (!confirm('Delete this saved Twitter account?')) return;
    
    const savedAccounts = savedTwitterAccounts.filter(a => a.id !== accountId);
    localStorage.setItem('savedTwitterAccounts', JSON.stringify(savedAccounts));
    setSavedTwitterAccounts(savedAccounts);
  };

  // Manual Twitter Profile Update - Uses token info from form
  const updateTwitterProfile = async (includeImages = false) => {
    if (!settings.TWITTER_API_KEY || !settings.TWITTER_API_SECRET || !settings.TWITTER_ACCESS_TOKEN || !settings.TWITTER_ACCESS_TOKEN_SECRET) {
      alert('Please verify a Twitter account first');
      return;
    }
    
    const tokenName = settings.TOKEN_NAME || settings.TOKEN_SHOW_NAME;
    const tokenDesc = settings.DESCRIPTION;
    const tokenWebsite = settings.WEBSITE;
    const tokenImage = settings.FILE; // Token logo URL
    
    if (!tokenName && !tokenDesc) {
      alert('Please fill in Token Name and Description first');
      return;
    }
    
    // Confirm with user
    const confirmMsg = `Update Twitter profile with token info?\n\n` +
      `Name: ${tokenName || '(not set)'}\n` +
      `Bio: ${tokenDesc ? tokenDesc.substring(0, 100) + (tokenDesc.length > 100 ? '...' : '') : '(not set)'}\n` +
      `Website: ${tokenWebsite || '(not set)'}\n` +
      (includeImages ? `\n🖼️ Profile Image: ${tokenImage ? 'Yes (token logo)' : 'No image'}\n🎨 Banner: Will generate with AI` : '');
    
    if (!confirm(confirmMsg)) return;
    
    setUpdatingTwitterProfile(true);
    try {
      const response = await fetch('http://localhost:3001/api/twitter/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: settings.TWITTER_API_KEY,
          apiSecret: settings.TWITTER_API_SECRET,
          accessToken: settings.TWITTER_ACCESS_TOKEN,
          accessTokenSecret: settings.TWITTER_ACCESS_TOKEN_SECRET,
          name: tokenName || undefined,
          description: tokenDesc || undefined,
          url: tokenWebsite || undefined,
          // Image updates
          profileImageUrl: includeImages ? tokenImage : undefined,
          generateBanner: includeImages,
          tokenSymbol: includeImages ? settings.TOKEN_SYMBOL : undefined,
        }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        let msg = `✅ Twitter profile updated!\n\nName: ${tokenName}`;
        if (result.profileImageUpdated) msg += '\n🖼️ Profile image updated';
        if (result.bannerUpdated) msg += '\n🎨 Banner generated & uploaded';
        alert(msg);
        // Refresh account info
        getTwitterAccountInfo();
      } else {
        alert(`❌ Failed to update profile: ${result.error}`);
      }
    } catch (error) {
      alert(`❌ Error: ${error.message}`);
    } finally {
      setUpdatingTwitterProfile(false);
    }
  };

  // Test Twitter Posting
  const testTwitterPosting = async () => {
    if (!settings.TWITTER_API_KEY || !settings.TWITTER_API_SECRET || !settings.TWITTER_ACCESS_TOKEN || !settings.TWITTER_ACCESS_TOKEN_SECRET) {
      alert('Please fill in Twitter API credentials first (API Key, API Secret, Access Token, Access Token Secret)');
      return;
    }
    
    setTestingMarketing({ ...testingMarketing, twitter: true });
    setMarketingTestResults({ ...marketingTestResults, twitter: null });
    
    try {
      // For testing, use image URL instead of base64 to avoid payload size issues
      // The actual launch will use base64, but for testing we can use the URL
      let tokenImageBase64 = null;
      let tokenImageUrl = null;
      
      if (settings.FILE) {
        // Try to load as base64, but if it fails or is too large, use URL instead
        try {
          tokenImageBase64 = await loadImageAsBase64(settings.FILE);
          // If base64 is too large (>5MB), use URL instead
          if (tokenImageBase64 && tokenImageBase64.length > 5 * 1024 * 1024) {
            console.log('Image too large for base64, using URL instead');
            tokenImageBase64 = null;
            if (settings.FILE.startsWith('./image/') || settings.FILE.startsWith('image/')) {
              const filename = settings.FILE.replace(/^\.\/image\//, '').replace(/^image\//, '');
              tokenImageUrl = `http://localhost:3001/image/${filename}`;
            } else if (settings.FILE.startsWith('http')) {
              tokenImageUrl = settings.FILE;
            }
          }
        } catch (error) {
          console.warn('Failed to load image as base64, using URL instead:', error);
          if (settings.FILE.startsWith('./image/') || settings.FILE.startsWith('image/')) {
            const filename = settings.FILE.replace(/^\.\/image\//, '').replace(/^image\//, '');
            tokenImageUrl = `http://localhost:3001/image/${filename}`;
          } else if (settings.FILE.startsWith('http')) {
            tokenImageUrl = settings.FILE;
          }
        }
      }
      // Get tweets from tweetList (new format) or fallback to old format
      let tweets = [];
      let tweetImages = [];
      
      if (tweetList.length > 0) {
        // New format: use tweetList
        tweets = tweetList.map(t => {
          // Replace placeholders in tweet text
          return t.text
            .replace(/\[token_name\]/gi, settings.TOKEN_NAME || 'Token')
            .replace(/\[token_symbol\]/gi, settings.TOKEN_SYMBOL || '$TOKEN')
            .replace(/\[CA\]/gi, settings.CUSTOM_TOKEN_ADDRESS || nextAddress?.address || settings.TOKEN_ADDRESS || '[CA]')
            .replace(/\[website\]/gi, settings.WEBSITE || '')
            .replace(/\[telegram\]/gi, settings.TELEGRAM || '')
            .replace(/\[twitter\]/gi, settings.TWITTER || '');
        });
        
        // Load images as base64
        tweetImages = await Promise.all(tweetList.map(async (t) => {
          if (t.imagePath) {
            try {
              return await loadImageAsBase64(t.imagePath);
            } catch (error) {
              console.warn('Failed to load tweet image:', error);
              return null;
            }
          }
          return null;
        }));
      } else {
        // Fallback to old format
        const oldTweets = (settings.TWITTER_TWEETS || '[token_name] is live! CA: [CA]').split('|');
        tweets = oldTweets.map(tweet => 
          tweet
            .replace(/\[token_name\]/gi, settings.TOKEN_NAME || 'Token')
            .replace(/\[token_symbol\]/gi, settings.TOKEN_SYMBOL || '$TOKEN')
            .replace(/\[CA\]/gi, settings.CUSTOM_TOKEN_ADDRESS || nextAddress?.address || settings.TOKEN_ADDRESS || '[CA]')
            .replace(/\[website\]/gi, settings.WEBSITE || '')
            .replace(/\[telegram\]/gi, settings.TELEGRAM || '')
            .replace(/\[twitter\]/gi, settings.TWITTER || '')
        );
        tweetImages = new Array(tweets.length).fill(null);
      }
      
      const tweetDelays = (settings.TWITTER_TWEET_DELAYS || '').split(',').map(d => parseInt(d) || 0).filter(d => d > 0);
      
      const response = await fetch('http://localhost:3001/api/marketing/twitter/auto-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: settings.TWITTER_API_KEY,
          apiSecret: settings.TWITTER_API_SECRET,
          accessToken: settings.TWITTER_ACCESS_TOKEN,
          accessTokenSecret: settings.TWITTER_ACCESS_TOKEN_SECRET,
          tweets: tweets,
          tweetDelays: tweetDelays,
          tweetImages: tweetImages,
          updateProfile: settings.TWITTER_UPDATE_PROFILE !== 'false',
          updateUsername: false,
          deleteOldTweets: settings.TWITTER_DELETE_OLD_TWEETS === 'true',
          communityId: settings.TWITTER_COMMUNITY_ID || undefined,
          profileConfig: {
            name: `${settings.TOKEN_NAME || 'Token'} ($${settings.TOKEN_SYMBOL || 'TOKEN'})`,
            description: settings.DESCRIPTION || '',
            url: settings.WEBSITE || '',
            profilePicture: tokenImageBase64 || null,
          },
          tokenConfig: {
            tokenName: settings.TOKEN_NAME || '',
            tokenSymbol: settings.TOKEN_SYMBOL || '',
            tokenAddress: settings.CUSTOM_TOKEN_ADDRESS || nextAddress?.address || settings.TOKEN_ADDRESS || 'Not set',
            chain: settings.WEBSITE_CHAIN || 'solana',
            website: settings.WEBSITE || '',
            telegram: settings.TELEGRAM || '',
            twitter: settings.TWITTER || '',
            description: settings.DESCRIPTION || '',
            tokenImageBase64: tokenImageBase64,
          },
        })
      });
      
      // Check if response is JSON
      const contentType = response.headers.get('content-type');
      let result;
      if (contentType && contentType.includes('application/json')) {
        result = await response.json();
      } else {
        // Response is HTML (error page) or other format
        const text = await response.text();
        throw new Error(`Server returned non-JSON response (${response.status}): ${text.substring(0, 200)}...\n\nMake sure the API server is running on port 3001.`);
      }
      
      // Check for HTTP errors
      if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}: ${result.message || 'Unknown error'}`);
      }
      setMarketingTestResults({ ...marketingTestResults, twitter: result });
      
      if (result.success) {
        const tweetCount = result.tweets?.tweetIds?.length || 0;
        const profileUpdated = result.profileUpdated ? 'Yes' : 'No';
        alert(`✅ Twitter posting test successful!\n\nTweets posted: ${tweetCount}\nProfile updated: ${profileUpdated}\n${result.message || ''}`);
      } else {
        alert(`❌ Twitter posting test failed:\n\n${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      setMarketingTestResults({ ...marketingTestResults, twitter: { success: false, error: error.message } });
      alert(`❌ Twitter posting test error:\n\n${error.message}`);
    } finally {
      setTestingMarketing({ ...testingMarketing, twitter: false });
    }
  };

  // Save tweet list to settings
  const saveTweetList = (newTweetList) => {
    setTweetList(newTweetList);
    // Save as JSON array for new format (supports images)
    const tweetData = newTweetList.map(t => ({
      text: t.text,
      imagePreview: t.imagePreview || null,
      imagePath: t.imagePath || null,
    }));
    handleChange('TWITTER_TWEETS', JSON.stringify(tweetData));
  };

  // Add new tweet
  const addTweet = () => {
    const newTweetList = [...tweetList, { text: '', image: null, imagePreview: null, imagePath: null }];
    saveTweetList(newTweetList);
  };

  // Remove tweet
  const removeTweet = (index) => {
    const newTweetList = tweetList.filter((_, i) => i !== index);
    saveTweetList(newTweetList);
  };

  // Update tweet text
  const updateTweetText = (index, text) => {
    const newTweetList = [...tweetList];
    newTweetList[index].text = text;
    saveTweetList(newTweetList);
  };

  // Handle tweet image upload
  const handleTweetImageChange = async (index, file) => {
    if (!file) return;
    
    try {
      // Create preview first
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          // Upload image
          const formData = new FormData();
          formData.append('image', file);
          
          const response = await fetch('http://localhost:3001/api/upload-image', {
            method: 'POST',
            body: formData,
          });
          
          if (!response.ok) {
            throw new Error('Failed to upload image');
          }
          
          const result = await response.json();
          const filePath = result.filePath;
          
          // Update tweet list
          const newTweetList = [...tweetList];
          newTweetList[index].image = file;
          newTweetList[index].imagePreview = reader.result;
          newTweetList[index].imagePath = filePath;
          saveTweetList(newTweetList);
        } catch (error) {
          console.error('Failed to upload tweet image:', error);
          alert('Failed to upload image: ' + error.message);
        }
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Failed to read image file:', error);
      alert('Failed to read image file: ' + error.message);
    }
  };

  // Remove tweet image
  const removeTweetImage = (index) => {
    const newTweetList = [...tweetList];
    newTweetList[index].image = null;
    newTweetList[index].imagePreview = null;
    newTweetList[index].imagePath = null;
    saveTweetList(newTweetList);
  };

  const handleChange = (key, value) => {
    const newSettings = { ...settings, [key]: value };
    
    // Auto-fill WEBSITE_URL from WEBSITE if WEBSITE_URL is empty
    if (key === 'WEBSITE' && value && !settings.WEBSITE_URL) {
      const extractedDomain = extractDomain(value);
      if (extractedDomain) {
        newSettings.WEBSITE_URL = extractedDomain;
        console.log(`✅ Auto-filled WEBSITE_URL from WEBSITE: ${extractedDomain}`);
      }
    }
    
    // Dynamic syncing between Count and Amounts
    if (key === 'BUNDLE_WALLET_COUNT') {
      const count = parseInt(value) || 0;
      const currentAmounts = settings.BUNDLE_SWAP_AMOUNTS || '';
      // Preserve empty strings to maintain positions
      const amountsArray = currentAmounts ? currentAmounts.split(',').map(a => a.trim()) : [];
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
      } else if (count === 0) {
        // If count is 0, clear amounts
        newSettings.BUNDLE_SWAP_AMOUNTS = '';
      }
    } else if (key === 'BUNDLE_SWAP_AMOUNTS') {
      // Preserve empty strings to maintain wallet positions
      // Don't auto-update count - count is now the source of truth from the UI
      // The value may contain empty strings like "0.5,,1.0" to preserve positions
    } else if (key === 'HOLDER_WALLET_COUNT') {
      const count = parseInt(value) || 0;
      const currentAmounts = settings.HOLDER_SWAP_AMOUNTS || '';
      // Preserve empty strings to maintain positions
      const amountsArray = currentAmounts ? currentAmounts.split(',').map(a => a.trim()) : [];
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
      } else if (count === 0) {
        // If count is 0, clear amounts
        newSettings.HOLDER_SWAP_AMOUNTS = '';
      }
    } else if (key === 'HOLDER_SWAP_AMOUNTS') {
      // Preserve empty strings to maintain wallet positions
      // Don't auto-update count - count is now the source of truth from the UI
      // The value may contain empty strings like "0.5,,1.0" to preserve positions
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
          if (['BUNDLE_WALLET_COUNT', 'BUNDLE_SWAP_AMOUNTS', 'HOLDER_WALLET_COUNT', 'HOLDER_SWAP_AMOUNTS', 'HOLDER_WALLET_AMOUNT', 'BUYER_AMOUNT', 'SWAP_AMOUNT', 'USE_NORMAL_LAUNCH'].includes(key)) {
            setTimeout(() => loadWalletInfo(), 300);
          }
        })
        .catch(err => {
          console.error('❌ Failed to auto-save setting:', key, '=', value, err);
          console.error('Error details:', err.response?.data || err.message);
          setSavingStatus(`❌ Failed to save ${key}`);
          setTimeout(() => setSavingStatus(''), 5000); // Show error for 5 seconds
          
          // Suppress alerts during auto-save - the .env file is being updated even if verification fails
          // Only show critical errors that prevent saving entirely
          const isNetworkError = err.message === 'Network Error' || err.code === 'ERR_NETWORK' || !err.response;
          const isVerificationError = err.response?.data?.error?.includes('Failed to update keys');
          
          if (isVerificationError) {
            // Verification errors are usually false positives (quote handling differences)
            // The .env file was actually written, so just log it
            console.warn(`⚠️ Verification warning for ${key} (file was still updated):`, err.response?.data?.error);
          } else if (isNetworkError) {
            // For network errors, just log - don't interrupt user's typing
            console.warn(`⚠️ Network error while auto-saving ${key}. Settings will be saved when you click "Save Settings".`);
          } else if (!isNetworkError && !isVerificationError && ['TOKEN_NAME', 'TOKEN_SYMBOL'].includes(key)) {
            // Only alert for actual save failures (not verification or network issues)
            console.error(`❌ Actual save failure for ${key}:`, err.response?.data?.error || err.message);
            // Don't show alert - just log it. User can manually save if needed.
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

      // Upload website logo if selected
      if (websiteLogoFile) {
        const logoPath = await uploadImage(websiteLogoFile);
        if (logoPath) {
          settingsToSave.WEBSITE_LOGO = logoPath;
          setSettings(settingsToSave);
          const filename = logoPath.replace(/^\.\/image\//, '').replace(/^image\//, '');
          setWebsiteLogoPreview(`http://localhost:3001/image/${filename}`);
          setWebsiteLogoFile(null);
        }
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

      // Upload website logo if selected
      if (websiteLogoFile) {
        const logoPath = await uploadImage(websiteLogoFile);
        if (logoPath) {
          settingsToSave.WEBSITE_LOGO = logoPath;
          setSettings(settingsToSave);
        }
      }

      // Save settings (use settingsToSave which includes the FILE path if image was uploaded)
      await apiService.updateSettings(settingsToSave);

      // Launch token - this will clear current-run.json and start fresh
      // Build launch data with per-type warmed wallet settings (allows mixing fresh + warmed)
      const launchData = {
        // Per-type warmed wallet flags
        useWarmedWallets: useWarmedWallets, // true if ANY type uses warmed (backward compat)
        useWarmedDevWallet: useWarmedDevWallet,
        useWarmedBundleWallets: useWarmedBundleWallets,
        useWarmedHolderWallets: useWarmedHolderWallets,
        
        // DEV wallet (warmed only if useWarmedDevWallet)
        creatorWalletAddress: useWarmedDevWallet ? (selectedCreatorWallet || null) : null,
        
        // Bundle wallets (warmed only if useWarmedBundleWallets)
        bundleWalletAddresses: useWarmedBundleWallets ? selectedBundleWallets : [],
        
        // Holder wallets (warmed only if useWarmedHolderWallets)
        holderWalletAddresses: useWarmedHolderWallets ? selectedHolderWallets : [],
        
        // Auto-buy config - depends on which mode holder wallets are in
        holderWalletAutoBuyAddresses: (settings.AUTO_HOLDER_WALLET_BUY === 'true' || settings.AUTO_HOLDER_WALLET_BUY === true) && useWarmedHolderWallets
          ? selectedHolderAutoBuyWallets 
          : [],
        holderWalletAutoBuyIndices: (settings.AUTO_HOLDER_WALLET_BUY === 'true' || settings.AUTO_HOLDER_WALLET_BUY === true) && !useWarmedHolderWallets
          ? selectedHolderAutoBuyIndices 
          : [],
        holderWalletAutoBuyDelays: (settings.AUTO_HOLDER_WALLET_BUY === 'true' || settings.AUTO_HOLDER_WALLET_BUY === true) && holderAutoBuyGroups.length > 0
          ? holderAutoBuyGroups.map(g => `parallel:${g.count},delay:${g.delay}`).join(',')
          : null,
        frontRunThreshold: frontRunThreshold // Front-run protection threshold (SOL)
      };
      // Auto-navigate to terminal page IMMEDIATELY (before API call)
      // This ensures user sees launch progress from the very start
      if (onLaunch) {
        onLaunch(); // Switch to terminal/holders tab
        // Small delay to ensure navigation completes
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Connect to real-time launch progress SSE
      const progressEventSource = new EventSource('http://localhost:3001/api/launch-progress');
      const launchProgressMessages = [];
      
      progressEventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'stdout' || data.type === 'stderr') {
            // Add to progress messages
            launchProgressMessages.push({
              type: data.type,
              message: data.data,
              timestamp: data.timestamp
            });
            
            // Keep only last 100 messages
            if (launchProgressMessages.length > 100) {
              launchProgressMessages.shift();
            }
            
            // Browser notifications disabled - using in-app toast only
          } else if (data.type === 'close') {
            progressEventSource.close();
          } else if (data.type === 'error') {
            console.error('[Launch Progress] Error:', data.data);
          }
        } catch (error) {
          console.error('[Launch Progress] Error parsing message:', error);
        }
      };
      
      progressEventSource.onerror = (error) => {
        console.error('[Launch Progress] SSE error:', error);
        progressEventSource.close();
      };
      
      // Store event source reference for cleanup
      launchProgressEventSourceRef.current = progressEventSource;
      
      // Call the appropriate launch endpoint based on mode
      const res = launchMode === 'quick' 
        ? await apiService.quickLaunchToken({})
        : await apiService.launchToken(launchData);
      
      // Clear wallet info immediately (since current-run.json was cleared)
      setWalletInfo(null);
      
      // Wait for launch to complete - poll for status with progress tracking
      // Token launches can take 2-5 minutes (wallet creation, bundle submission, confirmation)
      let attempts = 0;
      const maxAttempts = 600; // Wait up to 10 minutes
      const checkInterval = 1000; // Check every 1 second for faster updates
      
      // Launch stage definitions with progress percentages
      const stageProgress = {
        'INITIALIZING': 5,
        'CREATING_WALLETS': 15,
        'FUNDING_WALLETS': 30,
        'CREATING_LUT': 45,
        'BUILDING_BUNDLE': 60,
        'SUBMITTING_BUNDLE': 75,
        'CONFIRMING': 90,
        'SUCCESS': 100,
        'FAILED': 0
      };
      
      const checkLaunchComplete = async () => {
        try {
          const runRes = await apiService.getCurrentRun();
          const currentRun = runRes.data.data;
          
          // Check launch status
          if (currentRun) {
            const stage = currentRun.launchStage || 'INITIALIZING';
            setLaunchStage(stage);
            setLaunchProgress(stageProgress[stage] || 0);
            
            // Load wallets as soon as they're created (during FUNDING_WALLETS stage)
            // This makes wallets available immediately, not waiting for launch to complete
            if (stage === 'FUNDING_WALLETS' && 
                (currentRun.bundleWalletKeys || currentRun.holderWalletKeys || currentRun.walletKeys) &&
                !walletInfo) {
              console.log('✅ Wallets created! Pre-loading wallet info for immediate trading...');
              // Load wallets in background - don't wait, let launch continue
              loadWalletInfo().catch(err => console.warn('Failed to pre-load wallets:', err));
              
              // Auto-navigate to holders tab so user can see wallets
              if (onLaunch) {
                onLaunch(); // This switches to holders tab
              }
            }
            
            if (currentRun.launchStatus === 'SUCCESS') {
              // Launch completed successfully!
              console.log('✅ Launch completed successfully!');
              setLaunchStage('SUCCESS');
              setLaunchProgress(100);
              
              // Ensure wallets are loaded (in case pre-load didn't complete)
              if (!walletInfo) {
                await loadWalletInfo();
              }
              
              // Auto-start auto-sell if thresholds were configured
              try {
                const autoSellConfigRes = await apiService.getAutoSellConfig();
                const walletConfigs = autoSellConfigRes?.data?.wallets || {};
                const hasThresholds = Object.values(walletConfigs).some(c => c.threshold > 0);
                if (hasThresholds) {
                  console.log('⚡ Auto-sell thresholds detected, starting auto-sell...');
                  await apiService.toggleAutoSell(true);
                  console.log('✅ Auto-sell ENABLED automatically');
                }
              } catch (err) {
                console.warn('Failed to auto-start auto-sell:', err.message);
              }
              
              if (onLaunch) onLaunch();
              setLoading(false);
              
              // No alert popup - wallets are already loaded and ready!
              // Just show a brief status message
              setSavingStatus('✅ Token launched! Wallets ready for trading.');
              setTimeout(() => setSavingStatus(''), 3000);
              return;
            } else if (currentRun.launchStatus === 'FAILED') {
              // Launch failed
              console.error('❌ Launch failed:', currentRun.failureReason);
              setLaunchStage('FAILED');
              setLaunchProgress(0);
              setLoading(false);
              alert(`❌ Launch failed: ${currentRun.failureReason || 'Unknown error'}\n\nCheck terminal for details.`);
              return;
            } else if (currentRun.launchStatus === 'PENDING' || stage !== 'SUCCESS') {
              // Launch in progress - continue polling
              console.log(`⏳ Launch stage: ${stage} (${stageProgress[stage] || 0}%)`);
              
              // Continuously refresh wallet info during FUNDING_WALLETS and later stages
              // This ensures wallets are always up-to-date and ready for trading
              if ((stage === 'FUNDING_WALLETS' || stage === 'CREATING_LUT' || stage === 'BUILDING_BUNDLE' || stage === 'SUBMITTING_BUNDLE' || stage === 'CONFIRMING') &&
                  (currentRun.bundleWalletKeys || currentRun.holderWalletKeys || currentRun.walletKeys)) {
                // Refresh wallet info in background (don't await - non-blocking)
                loadWalletInfo().catch(err => {
                  // Silently fail - wallets might not be fully ready yet
                  if (err.response?.status !== 404) {
                    console.warn('Wallet info refresh failed (expected during launch):', err.message);
                  }
                });
              }
            } else if (currentRun.mintAddress && 
                       ((currentRun.bundleWalletKeys && currentRun.bundleWalletKeys.length > 0) ||
                        (currentRun.holderWalletKeys && currentRun.holderWalletKeys.length > 0) ||
                        (currentRun.walletKeys && currentRun.walletKeys.length > 0))) {
              // Legacy check: has mintAddress and wallets but no launchStatus (old format)
              // Assume success
              console.log('✅ Launch completed (legacy format)!');
              setLaunchStage('SUCCESS');
              setLaunchProgress(100);
              
              // Ensure wallets are loaded
              if (!walletInfo) {
                await loadWalletInfo();
              }
              
              // Auto-start auto-sell if thresholds were configured
              try {
                const autoSellConfigRes = await apiService.getAutoSellConfig();
                const walletConfigs = autoSellConfigRes?.data?.wallets || {};
                const hasThresholds = Object.values(walletConfigs).some(c => c.threshold > 0);
                if (hasThresholds) {
                  console.log('⚡ Auto-sell thresholds detected, starting auto-sell...');
                  await apiService.toggleAutoSell(true);
                  console.log('✅ Auto-sell ENABLED automatically');
                }
              } catch (err) {
                console.warn('Failed to auto-start auto-sell:', err.message);
              }
              
              if (onLaunch) onLaunch();
              setLoading(false);
              
              // No alert popup - just status message
              setSavingStatus('✅ Token launched! Wallets ready for trading.');
              setTimeout(() => setSavingStatus(''), 3000);
              return;
            }
          } else {
            // No current-run.json yet - still initializing
            setLaunchStage('INITIALIZING');
            setLaunchProgress(5);
          }
          
          attempts++;
          if (attempts < maxAttempts) {
            setTimeout(checkLaunchComplete, checkInterval);
          } else {
            // Timeout after 10 minutes
            const elapsedMinutes = Math.floor(attempts * checkInterval / 60);
            console.warn(`⚠️ Launch timeout after ${elapsedMinutes} minutes`);
            setLoading(false);
            setLaunchStage('IDLE');
            setLaunchProgress(0);
            alert(`⏳ Launch is taking longer than expected (${elapsedMinutes} minutes).\n\nIt may still be in progress. Check the API server terminal for updates.\n\nYou can retry the launch or refresh the page.`);
          }
        } catch (error) {
          // Check if error is because process exited (404 or no current-run.json)
          if (error.response?.status === 404 || error.message?.includes('404')) {
            // Process exited - no current-run.json means launch process stopped
            console.warn('⚠️ Launch process appears to have exited (no current-run.json)');
            setLoading(false);
            setLaunchStage('IDLE');
            setLaunchProgress(0);
            setSavingStatus('⚠️ Launch process exited. You can retry the launch.');
            setTimeout(() => setSavingStatus(''), 5000);
            return;
          }
          
          // current-run.json might not exist yet (launch just started)
          setLaunchStage('INITIALIZING');
          setLaunchProgress(5);
          attempts++;
          
          if (attempts < maxAttempts) {
            setTimeout(checkLaunchComplete, checkInterval);
          } else {
            setLoading(false);
            setLaunchStage('IDLE');
            setLaunchProgress(0);
            alert('⏳ Launch is taking longer than expected. Check the API server terminal for progress.\n\nYou can retry the launch or refresh the page.');
          }
        }
      };
      
      // Start checking immediately (faster response)
      setTimeout(checkLaunchComplete, 1000);
      
    } catch (error) {
      alert('Failed to launch token: ' + (error.response?.data?.error || error.message));
      setLoading(false);
      
      // Close progress event source on error
      if (launchProgressEventSourceRef.current) {
        launchProgressEventSourceRef.current.close();
        launchProgressEventSourceRef.current = null;
      }
    }
  };


  return (
    <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-lg p-4">
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-3">
          <RocketLaunchIconSolid className="w-6 h-6 text-blue-400" />
          <h2 className="text-xl font-bold text-white">Launch Token</h2>
        </div>
        <div className="flex items-center gap-2">
          {/* Config buttons */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={exportConfigAsJSON}
              className="p-2 bg-gray-800/50 hover:bg-gray-800 text-gray-400 hover:text-white rounded transition-colors"
              title="Export configuration as JSON"
            >
              <ArrowDownTrayIcon className="w-4 h-4" />
            </button>
            <label className="p-2 bg-gray-800/50 hover:bg-gray-800 text-gray-400 hover:text-white rounded transition-colors cursor-pointer" title="Import configuration from JSON">
              <ArrowPathIcon className="w-4 h-4" />
              <input
                type="file"
                accept=".json"
                onChange={importConfigFromJSON}
                className="hidden"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setShowConfigModal(true);
                loadSavedConfigs();
              }}
              className="p-2 bg-gray-800/50 hover:bg-gray-800 text-gray-400 hover:text-white rounded transition-colors"
              title="Load saved configuration"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
            </button>
          </div>
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
      </div>

      {/* Launch Mode Toggle */}
      <div className="mb-4 p-3 bg-gray-800/30 border border-gray-700/50 rounded-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-300">Launch Mode:</span>
            <div className="flex items-center bg-gray-900/50 rounded-lg p-0.5 border border-gray-700/50">
              <button
                type="button"
                onClick={() => {
                  setLaunchMode('quick');
                  // Auto-clear bundle/holder settings when switching to Quick mode
                  // But preserve funding wallet, token info, and socials
                  handleChange('BUNDLE_WALLET_COUNT', '');
                  handleChange('BUNDLE_SWAP_AMOUNTS', '');
                  handleChange('HOLDER_WALLET_COUNT', '');
                  handleChange('HOLDER_SWAP_AMOUNTS', '');
                  // Clear warmed wallet selections for bundle/holder
                  setSelectedBundleWallets([]);
                  setSelectedHolderWallets([]);
                  setSelectedHolderAutoBuyWallets([]);
                  setSelectedHolderAutoBuyIndices([]);
                  setUseWarmedBundleWallets(false);
                  setUseWarmedHolderWallets(false);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  launchMode === 'quick'
                    ? 'bg-gradient-to-r from-yellow-600 to-orange-600 text-white shadow-lg'
                    : 'text-gray-400 hover:text-gray-300'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Quick
              </button>
              <button
                type="button"
                onClick={() => setLaunchMode('advanced')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  launchMode === 'advanced'
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg'
                    : 'text-gray-400 hover:text-gray-300'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
                </svg>
                Advanced
              </button>
            </div>
          </div>
          <div className="text-xs text-gray-500">
            {launchMode === 'quick' ? (
              <span className="flex items-center gap-1">
                <span className="text-yellow-400">⚡</span> Dev buy only, no Jito, no bundles
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <span className="text-purple-400">🔥</span> Full system: bundles, Jito, holder wallets
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Token Card Preview */}
      {(settings.TOKEN_NAME || settings.FILE) && (
        <div className="mb-4 relative overflow-hidden">
          <div className="relative p-4 border border-gray-700/50 rounded-lg bg-gray-900/30">
            <div className="relative flex items-start gap-4">
              {/* Token Image */}
              {settings.FILE && (
                <div className="flex-shrink-0">
                  <img 
                    src={settings.FILE} 
                    alt={settings.TOKEN_NAME || 'Token'} 
                    className="w-20 h-20 rounded-lg object-cover border border-gray-700/50"
                  />
                </div>
              )}
              
              {/* Token Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-4 mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xl font-bold text-white mb-1 truncate">
                      {settings.TOKEN_NAME || 'Token Name'}
                    </h3>
                    {settings.TOKEN_SYMBOL && (
                      <div className="flex items-center gap-2">
                        <span className="text-base font-semibold text-gray-300 flex items-center gap-1">
                          <span className="text-gray-400">$</span>{settings.TOKEN_SYMBOL}
                        </span>
                        <span className="px-2 py-0.5 bg-gray-800/50 border border-gray-700/50 rounded text-xs text-gray-400">
                          Pump.fun
                        </span>
                      </div>
                    )}
                  </div>
                  
                  {/* Launch Status Badge */}
                  <div className="flex-shrink-0">
                    {loading ? (
                      <div className="px-2 py-1 bg-blue-900/20 border border-blue-800/30 rounded">
                        <div className="flex items-center gap-1.5">
                          <ArrowPathIcon className="w-3 h-3 text-blue-400 animate-spin" />
                          <span className="text-xs text-blue-300">Launching...</span>
                        </div>
                      </div>
                    ) : (!settings.TOKEN_NAME || !settings.TOKEN_SYMBOL || !settings.DESCRIPTION) ? (
                      <div className="px-2 py-1 bg-yellow-900/20 border border-yellow-800/30 rounded">
                        <div className="flex items-center gap-1.5">
                          <ExclamationTriangleIcon className="w-3 h-3 text-yellow-400" />
                          <span className="text-xs text-yellow-300">Incomplete</span>
                        </div>
                      </div>
                    ) : (
                      <div className="px-2 py-1 bg-green-900/20 border border-green-800/30 rounded">
                        <div className="flex items-center gap-1.5">
                          <CheckCircleIcon className="w-3 h-3 text-green-400" />
                          <span className="text-xs text-green-300">Ready</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Description */}
                {settings.DESCRIPTION && (
                  <p className="text-xs text-gray-400 mb-2 line-clamp-2">
                    {settings.DESCRIPTION}
                  </p>
                )}
                
                {/* Launch Stats */}
                {(settings.BUNDLE_WALLET_COUNT || settings.HOLDER_WALLET_COUNT || walletInfo?.totalSolRequired) && (
                  <div className="flex flex-wrap items-center gap-2 mb-2 pb-2 border-b border-gray-800/50">
                    {settings.BUNDLE_WALLET_COUNT && parseInt(settings.BUNDLE_WALLET_COUNT) > 0 && (
                      <div className="flex items-center gap-1 text-xs">
                        <WalletIcon className="w-3 h-3 text-gray-500" />
                        <span className="text-gray-500">Bundle:</span>
                        <span className="text-gray-400">{settings.BUNDLE_WALLET_COUNT}</span>
                      </div>
                    )}
                    {settings.HOLDER_WALLET_COUNT && parseInt(settings.HOLDER_WALLET_COUNT) > 0 && (
                      <div className="flex items-center gap-1 text-xs">
                        <UserGroupIcon className="w-3 h-3 text-gray-500" />
                        <span className="text-gray-500">Holders:</span>
                        <span className="text-gray-400">{settings.HOLDER_WALLET_COUNT}</span>
                      </div>
                    )}
                    {walletInfo?.totalSolRequired && (
                      <div className="flex items-center gap-1 text-xs">
                        <CurrencyDollarIcon className="w-3 h-3 text-gray-500" />
                        <span className="text-gray-500">Total:</span>
                        <span className="text-gray-400">{walletInfo.totalSolRequired.toFixed(4)} SOL</span>
                      </div>
                    )}
                  </div>
                )}
                
                {/* Links and Info */}
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  {settings.WEBSITE && (
                    <a 
                      href={settings.WEBSITE.startsWith('http') ? settings.WEBSITE : `https://${settings.WEBSITE}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-1 bg-gray-800/30 hover:bg-gray-800/50 border border-gray-700/30 rounded text-xs text-gray-400 hover:text-gray-300 transition-all"
                      title={settings.WEBSITE}
                    >
                      <GlobeAltIcon className="w-3 h-3" />
                      <span className="truncate max-w-[120px]">{settings.WEBSITE.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
                    </a>
                  )}
                  {settings.TWITTER && (
                    <a 
                      href={settings.TWITTER.startsWith('http') ? settings.TWITTER : `https://twitter.com/${settings.TWITTER.replace('@', '')}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-1 bg-gray-800/30 hover:bg-gray-800/50 border border-gray-700/30 rounded text-xs text-gray-400 hover:text-gray-300 transition-all"
                      title={`@${settings.TWITTER.replace('@', '')}`}
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                      </svg>
                      <span className="truncate max-w-[120px]">@{settings.TWITTER.replace('@', '')}</span>
                    </a>
                  )}
                  {settings.TELEGRAM && (
                    <a 
                      href={settings.TELEGRAM.startsWith('http') ? settings.TELEGRAM : `https://t.me/${settings.TELEGRAM.replace('@', '')}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-1 bg-gray-800/30 hover:bg-gray-800/50 border border-gray-700/30 rounded text-xs text-gray-400 hover:text-gray-300 transition-all"
                      title={settings.TELEGRAM}
                    >
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                      </svg>
                      <span className="truncate max-w-[100px]">{settings.TELEGRAM.replace('@', '').replace(/^https?:\/\/t\.me\//, '')}</span>
                    </a>
                  )}
                </div>
                
                {/* Pump Address */}
                {nextAddress?.address ? (
                  <div className="p-3 bg-gray-900/50 border border-gray-700/50 rounded">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-500 mb-1 flex items-center gap-1.5">
                          <span>Contract Address</span>
                          {nextAddress.source && (
                            <span className="text-xs text-gray-400 bg-gray-800/50 px-1.5 py-0.5 rounded">
                              {nextAddress.source}
                            </span>
                          )}
                        </p>
                        <code className="text-xs font-mono text-gray-300 bg-black/30 px-2 py-1 rounded border border-gray-700/30 break-all">
                          {nextAddress.address}
                        </code>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(nextAddress.address);
                          }}
                          className="p-1.5 bg-gray-800/50 hover:bg-gray-800 border border-gray-700/50 rounded transition-all"
                          title="Copy address"
                        >
                          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            </button>
                        <a
                          href={`https://pump.fun/${nextAddress.address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 bg-gray-800/50 hover:bg-gray-800 border border-gray-700/50 rounded transition-all"
                          title="View on Pump.fun"
                        >
                          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-2 bg-gray-900/30 border border-gray-700/30 rounded">
                    <p className="text-xs text-gray-500">Contract address will be assigned upon launch</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Content Generator */}
      <div className="mb-4">
        <AIContentGenerator 
          onApply={(generatedSettings) => {
            // Merge generated settings with current settings
            const updatedSettings = { ...settings, ...generatedSettings };
            setSettings(updatedSettings);
            // Trigger auto-save
            if (autoSaveTimeoutRef.current) {
              clearTimeout(autoSaveTimeoutRef.current);
            }
            autoSaveTimeoutRef.current = setTimeout(async () => {
              setSavingStatus('Saving...');
              try {
                await apiService.updateSettings(updatedSettings);
                setSavingStatus('✅ Saved');
                setTimeout(() => setSavingStatus(''), 2000);
              } catch (error) {
                setSavingStatus('❌ Save failed');
                setTimeout(() => setSavingStatus(''), 3000);
              }
            }, 500);
          }}
          currentSettings={settings}
        />
      </div>

      {/* Step 1: Token Details */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white font-bold text-sm">1</span>
            Token Details
          </h3>
          <button
            type="button"
            onClick={() => {
              setConfigSaveName(settings.TOKEN_NAME || 'My Token');
              setShowConfigModal(true);
              loadSavedConfigs();
            }}
            className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg transition-colors flex items-center gap-1"
          >
            <ArrowDownTrayIcon className="w-3 h-3" />
            Save Config
          </button>
        </div>
        <div className="p-3 bg-gray-900/50 rounded-lg border border-gray-800 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-0.5">
                Token Name *
              </label>
              <input
                type="text"
                value={settings.TOKEN_NAME || ''}
                onChange={(e) => handleChange('TOKEN_NAME', e.target.value)}
                className="w-full px-2 py-1.5 text-sm bg-black/50 border border-gray-800 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="My Awesome Token"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-0.5">
                Token Symbol *
              </label>
              <input
                type="text"
                value={settings.TOKEN_SYMBOL || ''}
                onChange={(e) => handleChange('TOKEN_SYMBOL', e.target.value.toUpperCase())}
                className="w-full px-2 py-1.5 text-sm bg-black/50 border border-gray-800 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="MAT"
                maxLength={10}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-0.5">
              Description *
            </label>
            <textarea
              value={settings.DESCRIPTION || ''}
              onChange={(e) => handleChange('DESCRIPTION', e.target.value)}
              rows={2}
              className="w-full px-2 py-1.5 text-sm bg-black/50 border border-gray-800 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Describe your token..."
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-0.5">
                Twitter
              </label>
              <input
                type="text"
                value={settings.TWITTER || ''}
                onChange={(e) => handleChange('TWITTER', e.target.value)}
                className="w-full px-2 py-1.5 text-sm bg-black/50 border border-gray-800 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="@username"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-0.5">
                Telegram
              </label>
              <input
                type="text"
                value={settings.TELEGRAM || ''}
                onChange={(e) => handleChange('TELEGRAM', e.target.value)}
                className="w-full px-2 py-1.5 text-sm bg-black/50 border border-gray-800 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="t.me/..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-0.5">
                Website
              </label>
              <input
                type="text"
                value={settings.WEBSITE || ''}
                onChange={(e) => handleChange('WEBSITE', e.target.value)}
                className="w-full px-2 py-1.5 text-sm bg-black/50 border border-gray-800 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="https://..."
              />
            </div>
          </div>
          
          {/* Image Uploads - Moved to Token Details */}
          <div className="mt-3 pt-3 border-t border-gray-800">
            <h4 className="text-sm font-semibold text-gray-300 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Images & Logos
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1 flex items-center justify-between">
                  <span>Token Image</span>
                  <button
                    type="button"
                    onClick={() => setShowAiGenerator(!showAiGenerator)}
                    className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded transition-colors ${
                      showAiGenerator 
                        ? 'bg-purple-600 text-white' 
                        : 'bg-purple-900/50 text-purple-300 hover:bg-purple-800/50'
                    }`}
                  >
                    <LightBulbIcon className="w-3 h-3" />
                    AI Generate
                  </button>
                </label>
                
                {/* AI Image Generator Panel */}
                {showAiGenerator && (
                  <div className="mb-2 p-3 bg-gradient-to-br from-purple-900/30 to-blue-900/30 border border-purple-500/30 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <LightBulbIcon className="w-4 h-4 text-purple-400" />
                      <span className="text-sm font-medium text-purple-300">Nano Banana AI</span>
                      <span className="text-[10px] px-1.5 py-0.5 bg-purple-600/50 text-purple-200 rounded">Gemini</span>
                    </div>
                    
                    {/* Style Selector */}
                    <div className="mb-2">
                      <label className="text-xs text-gray-400 mb-1 block">Style</label>
                      <div className="flex flex-wrap gap-1">
                        {[
                          { id: 'meme', label: 'Meme/Fun', icon: '🎭' },
                          { id: 'professional', label: 'Professional', icon: '💼' },
                          { id: 'cartoon', label: 'Cartoon', icon: '🎨' },
                          { id: 'abstract', label: 'Abstract', icon: '🔷' },
                          { id: 'custom', label: 'Custom', icon: '✏️' },
                        ].map(style => (
                          <button
                            key={style.id}
                            type="button"
                            onClick={() => setAiImageStyle(style.id)}
                            className={`text-xs px-2 py-1 rounded-md transition-all ${
                              aiImageStyle === style.id
                                ? 'bg-purple-600 text-white ring-1 ring-purple-400'
                                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                            }`}
                          >
                            {style.icon} {style.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    
                    {/* Custom Prompt Input */}
                    <div className="mb-2">
                      <label className="text-xs text-gray-400 mb-1 block">
                        {aiImageStyle === 'custom' ? 'Custom Prompt (required)' : 'Custom Prompt (optional - uses token name/description if empty)'}
                      </label>
                      <input
                        type="text"
                        value={aiImagePrompt}
                        onChange={(e) => setAiImagePrompt(e.target.value)}
                        placeholder={`e.g., "A cute frog mascot with sunglasses" or leave empty to use "${settings.NAME || 'token name'}"`}
                        className="w-full px-2 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
                      />
                    </div>
                    
                    {/* Error Display */}
                    {aiGeneratorError && (
                      <div className="mb-2 p-2 bg-red-900/30 border border-red-500/50 rounded text-xs text-red-300">
                        ❌ {aiGeneratorError}
                      </div>
                    )}
                    
                    {/* Generate Button */}
                    <button
                      type="button"
                      onClick={handleAiGenerateImage}
                      disabled={aiImageGenerating || (aiImageStyle === 'custom' && !aiImagePrompt.trim())}
                      className={`w-full py-2 px-3 rounded-lg font-medium text-sm transition-all flex items-center justify-center gap-2 ${
                        aiImageGenerating
                          ? 'bg-purple-700 text-purple-200 cursor-wait'
                          : 'bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-500 hover:to-blue-500'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {aiImageGenerating ? (
                        <>
                          <ArrowPathIcon className="w-4 h-4 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <LightBulbIcon className="w-4 h-4" />
                          Generate with AI
                        </>
                      )}
                    </button>
                    
                    <p className="mt-1.5 text-[10px] text-gray-500 text-center">
                      Powered by Google Gemini • Images are auto-saved
                    </p>
                  </div>
                )}
                
                {/* Traditional File Upload */}
                <div className="flex items-center gap-3">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageChange}
                    className="block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-500 file:text-white hover:file:bg-blue-600"
                  />
                  {imagePreview && (
                    <img src={imagePreview} alt="Preview" className="w-16 h-16 object-cover rounded-lg border border-gray-800" />
                  )}
                </div>
                {settings.FILE && !imageFile && (
                  <p className="mt-1 text-xs text-gray-500 truncate">Current: {settings.FILE.length > 50 ? settings.FILE.substring(0, 50) + '...' : settings.FILE}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Website Logo</label>
                <div className="flex items-center gap-3">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleWebsiteLogoChange}
                    className="block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-500 file:text-white hover:file:bg-blue-600"
                  />
                  {websiteLogoPreview && (
                    <img src={websiteLogoPreview} alt="Website Logo Preview" className="w-16 h-16 object-cover rounded-lg border border-gray-800" />
                  )}
                </div>
                {settings.WEBSITE_LOGO && !websiteLogoFile && (
                  <p className="mt-1 text-xs text-gray-500 truncate">Current: {settings.WEBSITE_LOGO.length > 50 ? settings.WEBSITE_LOGO.substring(0, 50) + '...' : settings.WEBSITE_LOGO}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Step 2: Wallet Configuration */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-green-600 text-white font-bold text-sm">2</span>
            Wallet Configuration
          </h3>
          {settings.USE_MIXING_WALLETS === 'true' && (
            <div className="flex items-center gap-2 px-2 py-0.5 bg-purple-900/30 border border-purple-500/50 rounded-lg">
              <ArrowPathRoundedSquareIcon className="w-3 h-3 text-purple-400" />
              <span className="text-xs text-purple-300">Mixing Wallets Enabled</span>
            </div>
          )}
        </div>
        
        {/* Wallet Configuration - 3 Column Layout */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          {/* Wallet Launch Settings */}
          <div className="p-3 bg-gray-900/50 rounded-lg border-l-4 border-blue-500">
            <label className="block text-base font-semibold text-blue-400 mb-2 flex items-center gap-1">
              <RocketLaunchIcon className="w-4 h-4" />
              Wallet Launch Settings
            </label>
            <div className="space-y-2">
              {/* Master Wallet Private Key */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <label className="block text-sm text-gray-300 flex items-center gap-1">
                    <LockClosedIcon className="w-3.5 h-3.5 text-blue-400" />
                    <span className="font-semibold">Master Wallet</span> *
                    <InfoTooltip content="Main funding wallet private key (base58). This wallet funds all token creation and transactions. Required for launch." />
                  </label>
                  {walletInfo?.fundingWallet?.balance !== undefined && (
                    <span className={`text-sm font-semibold ${walletInfo.fundingWallet.balance >= (walletInfo.breakdown?.total || 0) ? 'text-green-400' : 'text-yellow-400'}`}>
                      {walletInfo.fundingWallet.balance.toFixed(4)} SOL
                    </span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showPrivateKey ? 'text' : 'password'}
                    value={settings.PRIVATE_KEY || ''}
                    onChange={(e) => {
                      handleChange('PRIVATE_KEY', e.target.value);
                      setTimeout(() => loadWalletInfo(), 1000);
                    }}
                    className="w-full px-2 py-1 pr-16 bg-black/50 border border-gray-800 rounded text-white font-mono text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="Master wallet key"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPrivateKey(!showPrivateKey)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 text-white text-xs rounded transition-colors"
                  >
                    {showPrivateKey ? '👁️' : '👁️'}
                  </button>
                </div>
                {settings.PRIVATE_KEY && !showPrivateKey && (
                  <p className="text-xs text-gray-500 mt-0.5 font-mono">
                    {settings.PRIVATE_KEY.length > 20 
                      ? `${settings.PRIVATE_KEY.substring(0, 8)}...${settings.PRIVATE_KEY.substring(settings.PRIVATE_KEY.length - 8)}`
                      : '•'.repeat(Math.min(settings.PRIVATE_KEY.length, 16))}
                  </p>
                )}
              </div>

              {/* Buyer/Creator Wallet - Simplified with "Use Funding Wallet" checkbox */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm text-gray-300 flex items-center gap-1">
                    <UserIcon className="w-3.5 h-3.5 text-blue-400" />
                    <span className="font-semibold">Buyer/Creator</span>
                    <InfoTooltip content="The wallet that creates the token and makes the dev buy. Use your Funding Wallet or select a Warmed Wallet below." />
                  </label>
                  {/* Show funding wallet balance if using funding wallet, otherwise show creator dev wallet balance */}
                  {(settings.USE_FUNDING_AS_BUYER === 'true' || settings.BUYER_WALLET === settings.PRIVATE_KEY) ? (
                    walletInfo?.fundingWallet?.balance !== undefined && (
                      <span className="text-sm font-semibold text-green-400">
                        {walletInfo.fundingWallet.balance.toFixed(4)} SOL
                      </span>
                    )
                  ) : (
                    walletInfo?.creatorDevWallet?.balance !== undefined && !walletInfo?.creatorDevWallet?.isAutoCreated && (
                      <span className="text-sm font-semibold text-green-400">
                        {walletInfo.creatorDevWallet.balance.toFixed(4)} SOL
                      </span>
                    )
                  )}
                </div>
                
                {/* Use Funding Wallet checkbox */}
                <div className="flex items-center gap-2 p-2 bg-gray-800/50 rounded border border-gray-700/50">
                  <input
                    type="checkbox"
                    id="use-funding-wallet"
                    checked={settings.BUYER_WALLET === settings.PRIVATE_KEY || settings.USE_FUNDING_AS_BUYER === 'true'}
                    onChange={(e) => {
                      if (e.target.checked) {
                        // Copy PRIVATE_KEY to BUYER_WALLET
                        handleChange('BUYER_WALLET', settings.PRIVATE_KEY || '');
                        handleChange('USE_FUNDING_AS_BUYER', 'true');
                      } else {
                        // Clear BUYER_WALLET to use warmed or auto-generated
                        handleChange('BUYER_WALLET', '');
                        handleChange('USE_FUNDING_AS_BUYER', 'false');
                      }
                      setTimeout(() => loadWalletInfo(), 500);
                    }}
                    className="w-4 h-4 text-blue-500 bg-gray-900 border-gray-600 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  />
                  <label htmlFor="use-funding-wallet" className="text-sm text-gray-300 cursor-pointer flex items-center gap-1.5">
                    <span className="font-medium">Use Funding Wallet</span>
                    <span className="text-xs text-gray-500">(same as above)</span>
                  </label>
                  {(settings.BUYER_WALLET === settings.PRIVATE_KEY || settings.USE_FUNDING_AS_BUYER === 'true') && settings.PRIVATE_KEY && (
                    <span className="ml-auto text-xs text-green-400">✓ Using funding wallet</span>
                  )}
                </div>
                
                {/* Show hint when not using funding wallet */}
                {settings.USE_FUNDING_AS_BUYER !== 'true' && settings.BUYER_WALLET !== settings.PRIVATE_KEY && (
                  <p className="text-xs text-gray-500 mt-1">
                    {useWarmedDevWallet 
                      ? '↳ Using warmed DEV wallet selected below'
                      : '↳ Will auto-generate a fresh wallet'
                    }
                  </p>
                )}
              </div>

              {/* Wallet Source - Per-Type Controls */}
              <div className="pt-1 border-t border-gray-800">
                <label className="block text-sm text-gray-300 mb-1 flex items-center gap-1">
                  <WalletIcon className="w-3.5 h-3.5 text-blue-400" />
                  <span className="font-semibold">Wallet Source</span>
                  <InfoTooltip content="Choose Fresh (auto-generated) or Warmed (pre-warmed with tx history) for EACH wallet type independently." />
                </label>
                
                {/* Per-type toggles */}
                <div className="space-y-1.5">
                  {/* DEV Wallet Toggle */}
                  <div className="flex items-center justify-between p-1.5 bg-gray-800/50 rounded">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-yellow-400 font-semibold w-12">DEV</span>
                      <div className="flex gap-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            setUseWarmedDevWallet(false);
                            setSelectedCreatorWallet(null);
                          }}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                            !useWarmedDevWallet
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                          }`}
                        >
                          Fresh
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setUseWarmedDevWallet(true);
                            loadWarmedWallets(true);
                          }}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                            useWarmedDevWallet
                              ? 'bg-green-600 text-white'
                              : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                          }`}
                        >
                          Warmed
                        </button>
                      </div>
                    </div>
                    {useWarmedDevWallet && (
                      <span className={`text-[10px] ${selectedCreatorWallet ? 'text-green-400' : 'text-gray-500'}`}>
                        {selectedCreatorWallet ? `✓ ${selectedCreatorWallet.slice(0, 6)}...` : 'Select →'}
                      </span>
                    )}
                  </div>
                  
                  {/* Bundle Wallets Toggle - Only show in Advanced mode */}
                  {launchMode === 'advanced' && (
                  <div className="flex items-center justify-between p-1.5 bg-gray-800/50 rounded">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-green-400 font-semibold w-12">Bundle</span>
                      <div className="flex gap-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            setUseWarmedBundleWallets(false);
                            setSelectedBundleWallets([]);
                          }}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                            !useWarmedBundleWallets
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                          }`}
                        >
                          Fresh
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setUseWarmedBundleWallets(true);
                            loadWarmedWallets(true);
                          }}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                            useWarmedBundleWallets
                              ? 'bg-green-600 text-white'
                              : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                          }`}
                        >
                          Warmed
                        </button>
                      </div>
                    </div>
                    <span className={`text-[10px] ${
                      useWarmedBundleWallets 
                        ? (selectedBundleWallets.length > 0 ? 'text-green-400' : 'text-gray-500')
                        : 'text-blue-400'
                    }`}>
                      {useWarmedBundleWallets 
                        ? (selectedBundleWallets.length > 0 ? `✓ ${selectedBundleWallets.length} selected` : 'Select →')
                        : `${settings.BUNDLE_WALLET_COUNT || 0} fresh`
                      }
                    </span>
                  </div>
                  )}
                  
                  {/* Holder Wallets Toggle - Only show in Advanced mode */}
                  {launchMode === 'advanced' && (
                  <div className="flex items-center justify-between p-1.5 bg-gray-800/50 rounded">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-purple-400 font-semibold w-12">Holder</span>
                      <div className="flex gap-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            setUseWarmedHolderWallets(false);
                            setSelectedHolderWallets([]);
                            setSelectedHolderAutoBuyWallets([]);
                          }}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                            !useWarmedHolderWallets
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                          }`}
                        >
                          Fresh
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setUseWarmedHolderWallets(true);
                            loadWarmedWallets(true);
                          }}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                            useWarmedHolderWallets
                              ? 'bg-green-600 text-white'
                              : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                          }`}
                        >
                          Warmed
                        </button>
                      </div>
                    </div>
                    <span className={`text-[10px] ${
                      useWarmedHolderWallets 
                        ? (selectedHolderWallets.length > 0 ? 'text-green-400' : 'text-gray-500')
                        : 'text-blue-400'
                    }`}>
                      {useWarmedHolderWallets 
                        ? (selectedHolderWallets.length > 0 ? `✓ ${selectedHolderWallets.length} selected` : 'Select →')
                        : `${settings.HOLDER_WALLET_COUNT || 0} fresh`
                      }
                    </span>
                  </div>
                  )}
                </div>
                
                {/* Select Warmed Wallets Button - Shows if any type uses warmed AND in advanced mode */}
                {launchMode === 'advanced' && useWarmedWallets && (
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-xs text-gray-500">
                      {warmedWallets.length} available
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        loadWarmedWallets();
                        setShowWalletModal(true);
                      }}
                      className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors flex items-center gap-1"
                    >
                      <WalletIcon className="w-3 h-3" />
                      Select Wallets
                    </button>
                  </div>
                )}
              </div>

              {/* Privacy Routing */}
              <div className="pt-1 border-t border-gray-800">
                <label className="block text-sm text-gray-300 mb-1 flex items-center gap-1">
                  <ArrowPathRoundedSquareIcon className="w-3.5 h-3.5 text-purple-400" />
                  <span className="font-semibold">Privacy Routing</span>
                  <InfoTooltip content="Mixing Wallets: Fast routing through mixing wallets. Multi-Intermediary: Maximum privacy with multiple intermediary hops (slower but more private)." />
                </label>
                <div className="space-y-1">
                  <label 
                    className={`flex items-center gap-1.5 p-1 rounded border cursor-pointer transition-all ${
                      settings.USE_MULTI_INTERMEDIARY_SYSTEM !== 'true' 
                        ? 'border-purple-500 bg-purple-900/30' 
                        : 'border-gray-700 bg-gray-800/30 hover:border-gray-600'
                    }`}
                    onClick={(e) => {
                      const target = e.target;
                      if (target.type !== 'radio' && target.type !== 'checkbox' && target.tagName !== 'INPUT' && target.tagName !== 'BUTTON') {
                        e.preventDefault();
                        const newSettings = { ...settings };
                        newSettings.USE_MULTI_INTERMEDIARY_SYSTEM = 'false';
                        newSettings.USE_MIXING_WALLETS = 'true';
                        setSettings(newSettings);
                        if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
                        autoSaveTimeoutRef.current = setTimeout(() => {
                          apiService.updateSettings({
                            USE_MULTI_INTERMEDIARY_SYSTEM: 'false',
                            USE_MIXING_WALLETS: 'true'
                          }).catch(err => console.error('Failed to save:', err));
                        }, 100);
                      }
                    }}
                  >
                    <input
                      type="radio"
                      name="privacy-routing"
                      checked={settings.USE_MULTI_INTERMEDIARY_SYSTEM !== 'true'}
                      onChange={(e) => {
                        e.stopPropagation();
                        const newSettings = { ...settings };
                        newSettings.USE_MULTI_INTERMEDIARY_SYSTEM = 'false';
                        newSettings.USE_MIXING_WALLETS = 'true';
                        setSettings(newSettings);
                        if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
                        autoSaveTimeoutRef.current = setTimeout(() => {
                          apiService.updateSettings({
                            USE_MULTI_INTERMEDIARY_SYSTEM: 'false',
                            USE_MIXING_WALLETS: 'true'
                          }).catch(err => console.error('Failed to save:', err));
                        }, 100);
                      }}
                      className="w-3 h-3 text-purple-500 bg-gray-800 border-gray-700 focus:ring-1 focus:ring-purple-500 cursor-pointer"
                    />
                    <span className="text-sm text-white flex-1">Mixing</span>
                    <span className="text-xs px-1 py-0.5 bg-green-600/30 text-green-400 rounded">FAST</span>
                    {settings.USE_MULTI_INTERMEDIARY_SYSTEM !== 'true' && (
                      <input
                        type="checkbox"
                        id="create-fresh-mixing-wallets"
                        checked={settings.CREATE_FRESH_MIXING_WALLETS !== 'false'}
                        onChange={(e) => handleChange('CREATE_FRESH_MIXING_WALLETS', e.target.checked ? 'true' : 'false')}
                        onClick={(e) => e.stopPropagation()}
                        className="w-2.5 h-2.5 text-purple-500 bg-gray-800 border-gray-700 rounded focus:ring-1 focus:ring-purple-500"
                        title="Fresh mixing wallets"
                      />
                    )}
                  </label>

                  <label 
                    className={`flex items-center gap-1.5 p-1 rounded border cursor-pointer transition-all ${
                      settings.USE_MULTI_INTERMEDIARY_SYSTEM === 'true' 
                        ? 'border-blue-500 bg-blue-900/30' 
                        : 'border-gray-700 bg-gray-800/30 hover:border-gray-600'
                    }`}
                    onClick={(e) => {
                      const target = e.target;
                      if (target.type !== 'radio' && target.type !== 'number' && target.tagName !== 'INPUT' && target.tagName !== 'BUTTON') {
                        e.preventDefault();
                        const newSettings = { ...settings };
                        newSettings.USE_MULTI_INTERMEDIARY_SYSTEM = 'true';
                        newSettings.USE_MIXING_WALLETS = 'false';
                        setSettings(newSettings);
                        if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
                        autoSaveTimeoutRef.current = setTimeout(() => {
                          apiService.updateSettings({
                            USE_MULTI_INTERMEDIARY_SYSTEM: 'true',
                            USE_MIXING_WALLETS: 'false'
                          }).catch(err => console.error('Failed to save:', err));
                        }, 100);
                      }
                    }}
                  >
                    <input
                      type="radio"
                      name="privacy-routing"
                      checked={settings.USE_MULTI_INTERMEDIARY_SYSTEM === 'true'}
                      onChange={(e) => {
                        e.stopPropagation();
                        const newSettings = { ...settings };
                        newSettings.USE_MULTI_INTERMEDIARY_SYSTEM = 'true';
                        newSettings.USE_MIXING_WALLETS = 'false';
                        setSettings(newSettings);
                        if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
                        autoSaveTimeoutRef.current = setTimeout(() => {
                          apiService.updateSettings({
                            USE_MULTI_INTERMEDIARY_SYSTEM: 'true',
                            USE_MIXING_WALLETS: 'false'
                          }).catch(err => console.error('Failed to save:', err));
                        }, 100);
                      }}
                      className="w-3 h-3 text-blue-500 bg-gray-800 border-gray-700 focus:ring-1 focus:ring-blue-500 cursor-pointer"
                    />
                    <span className="text-sm text-white flex-1">Multi-Inter</span>
                    <span className="text-xs px-1 py-0.5 bg-blue-600/30 text-blue-400 rounded">MAX</span>
                    {settings.USE_MULTI_INTERMEDIARY_SYSTEM === 'true' && (
                      <input
                        type="number"
                        min="0"
                        max="5"
                        step="1"
                        value={settings.NUM_INTERMEDIARY_HOPS || '2'}
                        onChange={(e) => handleChange('NUM_INTERMEDIARY_HOPS', e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-8 px-0.5 py-0.5 bg-black/50 border border-gray-700 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    )}
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Bundle Wallets */}
          <div className="p-3 bg-gray-900/50 rounded-lg border-l-4 border-green-500">
            <label className="block text-base font-semibold text-green-400 mb-2 flex items-center gap-1">
              <CubeIcon className="w-4 h-4" />
              Bundle Wallets
            </label>
            <div className="space-y-2">
              {/* DEV Buy Amount */}
              <div>
                <label className="block text-sm text-gray-400 mb-0.5 flex items-center gap-1">
                  <span className="font-semibold text-purple-300">Creator/DEV Buy (SOL)</span>
                  <InfoTooltip content="Amount of SOL the Creator/DEV wallet will use to buy tokens at launch. This happens first, before bundle and holder wallets. This is the funding amount for the Creator/DEV wallet." />
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={settings.BUYER_AMOUNT || '1'}
                  onChange={(e) => handleChange('BUYER_AMOUNT', e.target.value)}
                  className="w-full px-2 py-1 bg-black/50 border border-purple-600 rounded text-white text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
              </div>
              {/* Bundle Wallet Count - Only in Advanced mode */}
              {launchMode === 'advanced' && (
              <div>
                <label className="block text-sm text-gray-400 mb-0.5 flex items-center gap-1">
                  <span className="font-semibold">
                    Bundle Wallets Count {useWarmedBundleWallets && selectedBundleWallets.length > 0 && (
                      <span className="text-green-400">({selectedBundleWallets.length})</span>
                    )}
                  </span>
                  <InfoTooltip content="Number of bundle wallets to create/use. Bundle wallets buy tokens in quick succession to create volume and momentum. Disabled when using warmed wallets." />
                </label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={useWarmedBundleWallets ? selectedBundleWallets.length : (settings.BUNDLE_WALLET_COUNT || '0')}
                  onChange={(e) => {
                    if (!useWarmedBundleWallets) {
                      handleChange('BUNDLE_WALLET_COUNT', e.target.value);
                    }
                  }}
                  disabled={useWarmedBundleWallets}
                  className={`w-full px-2 py-1 bg-black/50 border border-gray-800 rounded text-white text-xs focus:outline-none focus:ring-1 focus:ring-green-500 ${
                    useWarmedBundleWallets ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                />
              </div>
              )}
              {/* Individual Wallet Amount Inputs */}
              {(() => {
                const bundleCount = useWarmedBundleWallets ? selectedBundleWallets.length : parseInt(settings.BUNDLE_WALLET_COUNT || '0');
                const amountsArray = settings.BUNDLE_SWAP_AMOUNTS 
                  ? settings.BUNDLE_SWAP_AMOUNTS.split(',').map(a => a.trim())
                  : [];
                const defaultAmount = settings.SWAP_AMOUNT || '0.01';
                
                if (bundleCount > 0) {
                  return (
                    <div>
                      <label className="block text-sm text-gray-400 mb-1 flex items-center gap-1">
                        <span className="font-semibold">Funding (SOL)</span>
                        <InfoTooltip content="Individual SOL amounts to fund each bundle wallet. Leave empty to use default SWAP_AMOUNT. Each wallet will buy tokens with its allocated amount." />
                      </label>
                      <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
                        {Array.from({ length: bundleCount }, (_, i) => {
                          const currentValue = amountsArray[i] || '';
                          // Get balance for warmed wallets
                          const walletAddr = useWarmedBundleWallets ? selectedBundleWallets[i] : null;
                          const walletData = walletAddr ? warmedWallets.find(w => w.address === walletAddr) : null;
                          const balance = walletData?.solBalance || walletData?.balance || 0;
                          const hasEnough = balance >= parseFloat(currentValue || defaultAmount);
                          
                          return (
                            <div key={i} className="flex items-center gap-0.5">
                              <span className="text-xs text-gray-500 w-5">#{i + 1}</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={currentValue}
                                onChange={(e) => {
                                  const newAmounts = Array(bundleCount).fill('').map((_, idx) => {
                                    if (idx === i) {
                                      return e.target.value || '';
                                    }
                                    return amountsArray[idx] || '';
                                  });
                                  handleChange('BUNDLE_SWAP_AMOUNTS', newAmounts.join(','));
                                }}
                                placeholder={defaultAmount}
                                className="w-16 px-1 py-0.5 bg-black/50 border border-gray-800 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
                              />
                              {/* Show balance for warmed wallets */}
                              {useWarmedBundleWallets && walletAddr && (
                                <span className={`text-[10px] ml-1 ${hasEnough ? 'text-green-400' : 'text-yellow-400'}`} title={walletAddr}>
                                  {hasEnough ? '✓' : '⚠️'}{balance.toFixed(3)}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {/* Summary for warmed wallets */}
                      {useWarmedBundleWallets && selectedBundleWallets.length > 0 && (
                        <div className="mt-1 text-[10px] text-gray-500">
                          💰 Total balance: {selectedBundleWallets.reduce((sum, addr) => {
                            const w = warmedWallets.find(w => w.address === addr);
                            return sum + (w?.solBalance || w?.balance || 0);
                          }, 0).toFixed(4)} SOL | 
                          ✓ = has enough, ⚠️ = needs funding
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              })()}
              <div className="flex items-center gap-2 pt-2 border-t border-gray-800">
                <input
                  type="checkbox"
                  id="use-normal-launch"
                  checked={settings.USE_NORMAL_LAUNCH === 'true'}
                  onChange={(e) => handleChange('USE_NORMAL_LAUNCH', e.target.checked ? 'true' : 'false')}
                  className="w-4 h-4 text-blue-500 bg-gray-900 border-gray-600 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
                />
                <label htmlFor="use-normal-launch" className="text-sm text-gray-300 cursor-pointer flex items-center gap-1">
                  Normal Launch
                  <InfoTooltip content="Use normal launch mode instead of bundle mode. Normal launch executes transactions sequentially, while bundle mode executes them in parallel for faster execution." />
                </label>
              </div>
              {settings.USE_MULTI_INTERMEDIARY_SYSTEM === 'true' && (
                <div>
                  <label className="block text-sm text-gray-400 mb-0.5">Intermediary Hops</label>
                  <input
                    type="number"
                    min="0"
                    max="5"
                    step="1"
                    value={settings.BUNDLE_INTERMEDIARY_HOPS || settings.NUM_INTERMEDIARY_HOPS || '2'}
                    onChange={(e) => handleChange('BUNDLE_INTERMEDIARY_HOPS', e.target.value)}
                    className="w-full px-2 py-1.5 bg-black/50 border border-gray-800 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Holder Wallets - Only in Advanced mode */}
          {launchMode === 'advanced' && (
          <div className="p-3 bg-gray-900/50 rounded-lg border-l-4 border-yellow-500">
            <label className="block text-base font-semibold text-yellow-400 mb-2 flex items-center gap-1">
              <UserGroupIcon className="w-4 h-4" />
              Holder Wallets
            </label>
            <div className="space-y-2">
              <div>
                <label className="block text-sm text-gray-400 mb-0.5 flex items-center gap-1">
                  <span className="font-semibold">
                    Count {useWarmedHolderWallets && selectedHolderWallets.length > 0 && (
                      <span className="text-yellow-400">({selectedHolderWallets.length})</span>
                    )}
                  </span>
                  <InfoTooltip content="Number of holder wallets to create/use. Holder wallets buy tokens after bundle wallets to simulate organic holders. Disabled when using warmed wallets." />
                </label>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={useWarmedHolderWallets ? selectedHolderWallets.length : (settings.HOLDER_WALLET_COUNT || '0')}
                  onChange={(e) => {
                    if (!useWarmedHolderWallets) {
                      handleChange('HOLDER_WALLET_COUNT', e.target.value);
                    }
                  }}
                  disabled={useWarmedHolderWallets}
                  className={`w-full px-2 py-1 bg-black/50 border border-gray-800 rounded text-white text-xs focus:outline-none focus:ring-1 focus:ring-yellow-500 ${
                    useWarmedHolderWallets ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                />
              </div>
              {/* Warmed Wallets: Just show balances (no funding inputs - they're pre-funded) */}
              {useWarmedHolderWallets && selectedHolderWallets.length > 0 && (
                <div className="p-2 bg-green-900/20 border border-green-500/30 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-green-400">💰 Pre-funded Wallets</span>
                    <span className="text-[10px] text-gray-500">(No funding needed - wallets already have SOL)</span>
                  </div>
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                    {selectedHolderWallets.map((addr, i) => {
                      const walletData = warmedWallets.find(w => w.address === addr);
                      const balance = walletData?.solBalance || walletData?.balance || 0;
                      return (
                        <div key={i} className="flex items-center gap-0.5 px-1.5 py-0.5 bg-gray-800/50 rounded text-xs">
                          <span className="text-gray-500">#{i + 1}</span>
                          <span className="text-green-400 font-mono">{balance.toFixed(3)} SOL</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-1 text-[10px] text-gray-500">
                    💰 Total: {selectedHolderWallets.reduce((sum, addr) => {
                      const w = warmedWallets.find(w => w.address === addr);
                      return sum + (w?.solBalance || w?.balance || 0);
                    }, 0).toFixed(4)} SOL | 
                    <span className="text-yellow-400 ml-1">⚡ Configure buy amounts in Auto-Buy below</span>
                  </div>
                </div>
              )}
              
              {/* Fresh Wallets: Show funding inputs (need to be funded during launch) */}
              {!useWarmedHolderWallets && (() => {
                const holderCount = parseInt(settings.HOLDER_WALLET_COUNT || '0');
                const amountsArray = settings.HOLDER_SWAP_AMOUNTS 
                  ? settings.HOLDER_SWAP_AMOUNTS.split(',').map(a => a.trim())
                  : [];
                const defaultAmount = settings.HOLDER_WALLET_AMOUNT || '0.10';
                
                if (holderCount > 0) {
                  return (
                    <div>
                      <label className="block text-sm text-gray-400 mb-1 flex items-center gap-1">
                        <span className="font-semibold">Buy Amounts (SOL)</span>
                        <InfoTooltip content="SOL amount each fresh wallet will spend to buy tokens. Wallets are funded and buy in the same transaction." />
                      </label>
                      <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
                        {Array.from({ length: holderCount }, (_, i) => {
                          const currentValue = amountsArray[i] || '';
                          return (
                            <div key={i} className="flex items-center gap-0.5">
                              <span className="text-xs text-gray-500 w-5">#{i + 1}</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={currentValue}
                                onChange={(e) => {
                                  const newAmounts = Array(holderCount).fill('').map((_, idx) => {
                                    if (idx === i) {
                                      return e.target.value || '';
                                    }
                                    return amountsArray[idx] || '';
                                  });
                                  handleChange('HOLDER_SWAP_AMOUNTS', newAmounts.join(','));
                                }}
                                placeholder={defaultAmount}
                                className="w-16 px-1 py-0.5 bg-black/50 border border-gray-800 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-yellow-500"
                              />
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-1">
                        <label className="block text-xs text-gray-500 mb-0.5">Default Amount (SOL)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          value={settings.HOLDER_WALLET_AMOUNT || '0.10'}
                          onChange={(e) => handleChange('HOLDER_WALLET_AMOUNT', e.target.value)}
                          className="w-24 px-2 py-0.5 bg-black/50 border border-gray-800 rounded text-white text-xs focus:outline-none focus:ring-1 focus:ring-yellow-500"
                        />
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-800">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="autoHolderWalletBuy"
                    checked={settings.AUTO_HOLDER_WALLET_BUY === 'true' || settings.AUTO_HOLDER_WALLET_BUY === true}
                    onChange={(e) => handleChange('AUTO_HOLDER_WALLET_BUY', e.target.checked ? 'true' : 'false')}
                    className="w-4 h-4 text-blue-500 bg-gray-900 border-gray-600 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  />
                  <label htmlFor="autoHolderWalletBuy" className="text-sm text-gray-300 cursor-pointer flex items-center gap-1">
                    Auto-buy (Snipers)
                    <InfoTooltip content="Enable automatic token purchases by holder wallets. When enabled, configure snipers to set timing and conditions for when each wallet buys." />
                  </label>
                </div>
                {(settings.AUTO_HOLDER_WALLET_BUY === 'true' || settings.AUTO_HOLDER_WALLET_BUY === true) && 
                 (selectedHolderWallets.length > 0 || (parseInt(settings.HOLDER_WALLET_COUNT || '0') > 0 && !useWarmedHolderWallets)) && (
                  <button
                    type="button"
                    onClick={() => setShowHolderSniperModal(true)}
                    className="px-1.5 py-0.5 text-sm bg-yellow-600 hover:bg-yellow-700 text-white rounded transition-colors"
                  >
                    Snipers
                    {(useWarmedHolderWallets ? selectedHolderAutoBuyWallets.length : selectedHolderAutoBuyIndices.length) > 0 && (
                      <span className="ml-0.5 text-yellow-300">
                        ({(useWarmedHolderWallets ? selectedHolderAutoBuyWallets.length : selectedHolderAutoBuyIndices.length)})
                      </span>
                    )}
                  </button>
                )}
              </div>
              {settings.USE_MULTI_INTERMEDIARY_SYSTEM === 'true' && (
                <div>
                  <label className="block text-sm text-gray-400 mb-0.5 flex items-center gap-1">
                    <span className="font-semibold">Intermediary Hops</span>
                    <InfoTooltip content="Number of intermediary wallets to route through for holder wallets. Higher hops = more privacy but slower execution. Overrides global NUM_INTERMEDIARY_HOPS for holder wallets." />
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="5"
                    step="1"
                    value={settings.HOLDER_INTERMEDIARY_HOPS || settings.NUM_INTERMEDIARY_HOPS || '2'}
                    onChange={(e) => handleChange('HOLDER_INTERMEDIARY_HOPS', e.target.value)}
                    className="w-full px-2 py-1 bg-black/50 border border-gray-800 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-yellow-500"
                  />
                </div>
              )}
            </div>
          </div>
          )}
        </div>

        {/* Compact Wallet Summary - Total SOL Button - Only in Advanced mode */}
        {launchMode === 'advanced' && walletInfo && walletInfo.breakdown && (
          <div className="mt-3">
            <button
              onClick={() => setShowTotalSolModal(true)}
              className="w-full p-2 bg-gradient-to-r from-yellow-600/20 to-yellow-500/20 hover:from-yellow-600/30 hover:to-yellow-500/30 rounded-lg border-2 border-yellow-500/50 hover:border-yellow-400 transition-all flex items-center justify-between group"
            >
              <div className="flex items-center gap-2">
                <CurrencyDollarIcon className="w-4 h-4 text-yellow-400 group-hover:text-yellow-300" />
                <span className="text-sm font-bold text-yellow-400 group-hover:text-yellow-300">Total SOL Required</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-green-400 group-hover:text-green-300">
                  {walletInfo.breakdown.total?.toFixed(4) || '0.0000'} SOL
                </span>
                <svg className="w-4 h-4 text-yellow-400 group-hover:text-yellow-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </button>
          </div>
        )}
      </div>

      {/* Front-Run (Anti-MEV) Protection - Only in Advanced mode */}
      {launchMode === 'advanced' && (settings.AUTO_HOLDER_WALLET_BUY === 'true' || settings.AUTO_HOLDER_WALLET_BUY === true) && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span className="text-sm font-bold text-red-300">🛡️ Front-Run Protection</span>
              <span className="text-xs text-gray-500">(saved to .env)</span>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={frontRunThreshold > 0}
                onChange={async (e) => {
                  const newValue = e.target.checked ? 0.2 : 0;
                  setFrontRunThreshold(newValue);
                  try {
                    await apiService.updateSettings({ HOLDER_FRONT_RUN_THRESHOLD: newValue.toString() });
                  } catch (err) {
                    console.error('Failed to save front-run threshold:', err);
                  }
                }}
                className="w-4 h-4 text-red-500 bg-gray-900 border-gray-600 rounded focus:ring-2 focus:ring-red-500"
              />
              <span className="text-sm text-white">Enabled</span>
            </label>
          </div>
          
          {frontRunThreshold > 0 && (
            <div className="flex items-center gap-3 mt-2">
              <span className="text-xs text-gray-400">Skip buy if external buys exceed:</span>
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="10"
                value={frontRunThreshold}
                onChange={async (e) => {
                  const newValue = parseFloat(e.target.value) || 0;
                  setFrontRunThreshold(newValue);
                  try {
                    await apiService.updateSettings({ HOLDER_FRONT_RUN_THRESHOLD: newValue.toString() });
                  } catch (err) {
                    console.error('Failed to save front-run threshold:', err);
                  }
                }}
                className="w-16 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-white text-sm text-center focus:outline-none focus:ring-1 focus:ring-red-500"
              />
              <span className="text-xs text-gray-400">SOL</span>
            </div>
          )}
          
          <p className="text-xs text-red-200/70 mt-2">
            Protects holder auto-buys from front-running. If net external buys exceed threshold, auto-buy is skipped.
          </p>
        </div>
      )}

      {/* Auto-Sell Configuration - Dynamic Per-Wallet */}
      <div className="mb-4">
        <AutoSellConfig 
          wallets={(() => {
            // Build wallet list using PER-TYPE warmed wallet flags
            const wallets = [];
            
            // Add DEV wallet - use useWarmedDevWallet (not global useWarmedWallets)
            const buyerAmount = parseFloat(settings.BUYER_AMOUNT || '0');
            if (useWarmedDevWallet) {
              // DEV is set to WARMED: only add if a creator wallet is selected
              if (selectedCreatorWallet) {
                wallets.push({ address: selectedCreatorWallet, type: 'DEV', isWarmed: true, index: 1 });
              }
            } else {
              // DEV is set to FRESH: add if BUYER_AMOUNT > 0
              if (buyerAmount > 0) {
                if (settings.BUYER_WALLET && settings.BUYER_WALLET.trim() !== '') {
                  wallets.push({ address: 'dev-wallet', type: 'DEV', isWarmed: false, index: 1, placeholder: true, hasExisting: true });
                } else {
                  wallets.push({ address: 'dev-wallet', type: 'DEV', isWarmed: false, index: 1, placeholder: true });
                }
              }
            }
            
            // Add bundle wallets - use useWarmedBundleWallets (not global useWarmedWallets)
            if (useWarmedBundleWallets) {
              // Bundle is set to WARMED: only show selected warmed bundle wallets
              selectedBundleWallets.forEach((addr, i) => {
                wallets.push({ address: addr, type: 'Bundle', isWarmed: true, index: i + 1 });
              });
            } else {
              // Bundle is set to FRESH: show placeholders based on BUNDLE_WALLET_COUNT
              const bundleCount = parseInt(settings.BUNDLE_WALLET_COUNT || '0');
              for (let i = 0; i < bundleCount; i++) {
                wallets.push({ address: `bundle-${i + 1}`, type: 'Bundle', isWarmed: false, index: i + 1, placeholder: true });
              }
            }
            
            // Add holder wallets - use useWarmedHolderWallets (not global useWarmedWallets)
            if (useWarmedHolderWallets) {
              // Holder is set to WARMED: only show selected warmed holder wallets
              selectedHolderWallets.forEach((addr, i) => {
                wallets.push({ address: addr, type: 'Holder', isWarmed: true, index: i + 1 });
              });
            } else {
              // Holder is set to FRESH: show placeholders based on HOLDER_WALLET_COUNT
              const holderCount = parseInt(settings.HOLDER_WALLET_COUNT || '0');
              for (let i = 0; i < holderCount; i++) {
                wallets.push({ address: `holder-${i + 1}`, type: 'Holder', isWarmed: false, index: i + 1, placeholder: true });
              }
            }
            
            return wallets;
          })()}
        />
      </div>

      {/* Wallet Selection Modal */}
      {showWalletModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
              <div className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-7xl max-h-[90vh] flex flex-col my-auto">
                {/* Modal Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-800">
                  <div>
                    <h3 className="text-xl font-bold text-white">Select Warmed Wallets</h3>
                    <p className="text-sm text-gray-400 mt-1">
                      {filteredAndSortedWallets.length} of {warmedWallets.length} wallets shown | 
                      Creator: {selectedCreatorWallet ? '1' : '0'} | 
                      Bundle: {selectedBundleWallets.length} | 
                      Holder: {selectedHolderWallets.length}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        setLoadingWarmedWallets(true);
                        try {
                          // Force refresh ALL wallet balances
                          const addresses = warmedWallets.map(w => w.address);
                          if (addresses.length > 0) {
                            await apiService.updateWalletBalances(addresses);
                          }
                          await loadWarmedWallets(true);
                        } catch (e) {
                          console.error('Refresh failed:', e);
                        } finally {
                          setLoadingWarmedWallets(false);
                        }
                      }}
                      disabled={loadingWarmedWallets}
                      className={`px-3 py-2 text-sm rounded-lg transition-colors flex items-center gap-1.5 ${
                        loadingWarmedWallets 
                          ? 'bg-gray-700 text-gray-400 cursor-wait' 
                          : 'bg-green-600 hover:bg-green-700 text-white'
                      }`}
                    >
                      {loadingWarmedWallets ? (
                        <>
                          <ArrowPathIcon className="w-4 h-4 animate-spin" />
                          Refreshing...
                        </>
                      ) : (
                        <>
                          <ArrowPathIcon className="w-4 h-4" />
                          Refresh Balances
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => setShowWalletModal(false)}
                      className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors"
                    >
                      ✕ Close
                    </button>
                  </div>
                </div>
                
                {/* Filters and Sort */}
                <div className="p-4 border-b border-gray-800 bg-gray-900/50">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                    {/* Search */}
                    <div className="lg:col-span-2">
                      <label className="text-xs text-gray-400 mb-1 block">🔍 Search Address</label>
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search by wallet address..."
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                      />
                    </div>
                    
                    {/* Tag Filter */}
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">🏷️ Filter by Tag</label>
                      <select
                        value={tagFilter}
                        onChange={(e) => setTagFilter(e.target.value)}
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                      >
                        <option value="all">All Tags</option>
                        {allTags.map(tag => (
                          <option key={tag} value={tag}>{tag}</option>
                        ))}
                      </select>
                    </div>
                    
                    {/* Status Filter */}
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">📊 Filter by Status</label>
                      <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                      >
                        <option value="all">All Status</option>
                        <option value="idle">⏸️ Idle</option>
                        <option value="warming">🔥 Warming</option>
                        <option value="ready">✅ Ready</option>
                      </select>
                    </div>
                    
                    {/* Sort By */}
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">🔀 Sort By</label>
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                      >
                        <option value="createdAt">Created Date</option>
                        <option value="transactionCount">Transaction Count</option>
                        <option value="totalTrades">Total Trades</option>
                        <option value="firstTransactionDate">First Transaction</option>
                        <option value="lastTransactionDate">Last Transaction</option>
                        <option value="solBalance">SOL Balance</option>
                      </select>
                    </div>
                  </div>
                  
                  {/* Sort Order Toggle */}
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                      className={`px-3 py-1 rounded text-sm font-medium ${
                        sortOrder === 'asc' 
                          ? 'bg-blue-600 text-white' 
                          : 'bg-gray-700 text-gray-300'
                      }`}
                    >
                      {sortOrder === 'asc' ? '↑ Ascending' : '↓ Descending'}
                    </button>
                    <button
                      onClick={() => {
                        setSearchQuery('');
                        setTagFilter('all');
                        setStatusFilter('all');
                        setSortBy('createdAt');
                        setSortOrder('desc');
                      }}
                      className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs"
                    >
                      🗑️ Clear Filters
                    </button>
                  </div>
                </div>
                
                {/* Wallet List */}
                <div className="flex-1 overflow-y-auto p-4">
                  {loadingWarmedWallets ? (
                    <div className="text-center text-gray-400 py-8">Loading wallets...</div>
                  ) : filteredAndSortedWallets.length === 0 ? (
                    <div className="text-center text-yellow-400 py-8">
                      No wallets match your filters. Try adjusting your search or filters.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {filteredAndSortedWallets.map((wallet) => {
                        const isBundle = selectedBundleWallets.includes(wallet.address);
                        const isHolder = selectedHolderWallets.includes(wallet.address);
                        const isCreator = selectedCreatorWallet === wallet.address;
                        return (
                          <div
                            key={wallet.address}
                            className={`p-3 rounded-lg border ${
                              isCreator
                                ? 'bg-purple-900/30 border-purple-600/50'
                                : isBundle || isHolder
                                ? 'bg-green-900/30 border-green-600/50'
                                : 'bg-gray-800/50 border-gray-700'
                            }`}
                          >
                            <div className="mb-2">
                              <p className="text-xs font-mono text-white break-all">
                                {wallet.address}
                              </p>
                            </div>
                            
                            <div className="space-y-1 text-xs mb-3">
                              <div className="flex justify-between">
                                <span className="text-gray-400">Trades:</span>
                                <span className="text-white">{wallet.totalTrades || wallet.transactionCount || 0}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">SOL Balance:</span>
                                <span className={`font-semibold ${
                                  (wallet.solBalance || 0) > 0.1 ? 'text-green-400' : 
                                  (wallet.solBalance || 0) > 0.01 ? 'text-yellow-400' : 
                                  'text-red-400'
                                }`}>
                                  {(wallet.solBalance || 0).toFixed(4)} SOL
                                </span>
                              </div>
                              {wallet.firstTransactionDate && (
                                <div className="flex justify-between">
                                  <span className="text-gray-400">First TX:</span>
                                  <span className="text-white text-sm">
                                    {new Date(wallet.firstTransactionDate).toLocaleDateString()}
                                  </span>
                                </div>
                              )}
                              {wallet.lastTransactionDate && (
                                <div className="flex justify-between">
                                  <span className="text-gray-400">Last TX:</span>
                                  <span className="text-white text-sm">
                                    {new Date(wallet.lastTransactionDate).toLocaleDateString()}
                                  </span>
                                </div>
                              )}
                              {wallet.tags && wallet.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {wallet.tags.map(tag => (
                                    <span key={tag} className="px-1.5 py-0.5 bg-blue-900/50 text-blue-300 rounded text-sm">
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              )}
                              <div className="flex justify-between">
                                <span className="text-gray-400">Status:</span>
                                <span className={`${
                                  wallet.status === 'ready' ? 'text-green-400' :
                                  wallet.status === 'warming' ? 'text-yellow-400' :
                                  'text-gray-400'
                                }`}>
                                  {wallet.status || 'idle'}
                                </span>
                              </div>
                            </div>
                            
                            <div className="flex gap-2 mt-3">
                              <button
                                type="button"
                                onClick={() => {
                                  if (isCreator) {
                                    setSelectedCreatorWallet(null);
                                  } else {
                                    setSelectedCreatorWallet(wallet.address);
                                    // Remove from bundle and holder if it was there
                                    setSelectedBundleWallets(prev => prev.filter(a => a !== wallet.address));
                                    setSelectedHolderWallets(prev => prev.filter(a => a !== wallet.address));
                                  }
                                }}
                                className={`flex-1 px-2 py-1.5 text-xs rounded font-medium transition-colors ${
                                  isCreator
                                    ? 'bg-purple-600 text-white'
                                    : 'bg-gray-700 text-gray-300 hover:bg-purple-600 hover:text-white'
                                }`}
                              >
                                {isCreator ? '✓ Creator' : 'Creator'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (isBundle) {
                                    setSelectedBundleWallets(prev => prev.filter(a => a !== wallet.address));
                                  } else {
                                    setSelectedBundleWallets(prev => [...prev, wallet.address]);
                                    // Remove from holder and creator if it was there
                                    setSelectedHolderWallets(prev => prev.filter(a => a !== wallet.address));
                                    if (selectedCreatorWallet === wallet.address) {
                                      setSelectedCreatorWallet(null);
                                    }
                                  }
                                }}
                                className={`flex-1 px-2 py-1.5 text-xs rounded font-medium transition-colors ${
                                  isBundle
                                    ? 'bg-green-600 text-white'
                                    : 'bg-gray-700 text-gray-300 hover:bg-green-600 hover:text-white'
                                }`}
                              >
                                {isBundle ? '✓ Bundle' : 'Bundle'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (isHolder) {
                                    setSelectedHolderWallets(prev => prev.filter(a => a !== wallet.address));
                                  } else {
                                    setSelectedHolderWallets(prev => [...prev, wallet.address]);
                                    // Remove from bundle and creator if it was there
                                    setSelectedBundleWallets(prev => prev.filter(a => a !== wallet.address));
                                    if (selectedCreatorWallet === wallet.address) {
                                      setSelectedCreatorWallet(null);
                                    }
                                  }
                                }}
                                className={`flex-1 px-2 py-1.5 text-xs rounded font-medium transition-colors ${
                                  isHolder
                                    ? 'bg-yellow-600 text-white'
                                    : 'bg-gray-700 text-gray-300 hover:bg-yellow-600 hover:text-white'
                                }`}
                              >
                                {isHolder ? '✓ Holder' : 'Holder'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                
                {/* Modal Footer */}
                <div className="flex items-center justify-between p-4 border-t border-gray-800 bg-gray-900/50">
                  <div className="text-sm text-gray-400">
                    Selected: {selectedBundleWallets.length} Bundle, {selectedHolderWallets.length} Holder
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setSelectedBundleWallets([]);
                        setSelectedHolderWallets([]);
                      }}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm"
                    >
                      Clear All
                    </button>
                    <button
                      onClick={() => setShowWalletModal(false)}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm"
                    >
                      Done
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

        
        {/* Launch Progress Bar */}
        {loading && launchStage && (
          <div className="mt-3 p-3 bg-gray-900/50 rounded-lg border border-gray-800">
            <div className="flex justify-between items-center mb-1">
              <span className="text-sm font-semibold text-white">
                {launchStage === 'INITIALIZING' && (
                  <>
                    <ArrowPathIcon className="w-4 h-4 mr-2 inline animate-spin" />
                    Initializing...
                  </>
                )}
                {launchStage === 'CREATING_WALLETS' && (
                  <>
                    <WalletIcon className="w-4 h-4 mr-2 inline" />
                    Creating Wallets...
                  </>
                )}
                {launchStage === 'FUNDING_WALLETS' && (
                  <>
                    <CurrencyDollarIcon className="w-4 h-4 mr-2 inline" />
                    Funding Wallets...
                  </>
                )}
                {launchStage === 'CREATING_LUT' && (
                  <>
                    <MagnifyingGlassIcon className="w-4 h-4 mr-2 inline" />
                    Creating Lookup Table...
                  </>
                )}
                {launchStage === 'BUILDING_BUNDLE' && (
                  <>
                    <CubeIcon className="w-4 h-4 mr-2 inline" />
                    Building Bundle...
                  </>
                )}
                {launchStage === 'SUBMITTING_BUNDLE' && (
                  <>
                    <ArrowDownTrayIcon className="w-4 h-4 mr-2 inline" />
                    Submitting Bundle...
                  </>
                )}
                {launchStage === 'CONFIRMING' && (
                  <>
                    <ArrowPathIcon className="w-4 h-4 mr-2 inline animate-spin" />
                    Confirming on-chain...
                  </>
                )}
                {launchStage === 'SUCCESS' && (
                  <>
                    <CheckCircleIcon className="w-4 h-4 mr-2 inline" />
                    Launch Complete!
                  </>
                )}
                {launchStage === 'FAILED' && (
                  <>
                    <XCircleIcon className="w-4 h-4 mr-2 inline" />
                    Launch Failed
                  </>
                )}
              </span>
              <span className="text-sm text-gray-500">{launchProgress}%</span>
            </div>
            <div className="w-full bg-gray-900/50 rounded-full h-3 overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  launchStage === 'FAILED' ? 'bg-red-500' :
                  launchStage === 'SUCCESS' ? 'bg-green-500' :
                  'bg-gradient-to-r from-blue-500 to-purple-600'
                }`}
                style={{ width: `${launchProgress}%` }}
              />
            </div>
            {launchStage === 'FUNDING_WALLETS' && (
              <p className="text-xs text-gray-500 mt-2">
                <span className="flex items-center gap-2">
                  <LightBulbIcon className="w-4 h-4" />
                  Wallets are ready! Auto-switching to Holders page...
                </span>
              </p>
            )}
          </div>
        )}
        
      {/* Save Settings Button */}
      <div className="mb-3">
        <button
          onClick={handleSaveSettings}
          disabled={loading}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed glow-blue flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <ArrowPathIcon className="w-5 h-5 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <ArrowDownTrayIcon className="w-5 h-5" />
              Save Settings
            </>
          )}
        </button>
      </div>

      {/* Marketing Options - PROMINENT */}
      <div className="mb-3 p-3 bg-gradient-to-r from-purple-900/30 to-pink-900/30 rounded-lg border-2 border-purple-500/50">
        <div className="flex items-center gap-2 mb-2">
          <MegaphoneIcon className="w-5 h-5 text-purple-400" />
          <h3 className="text-base font-bold text-white">Marketing Options</h3>
          <span className="text-xs text-gray-400 bg-gray-800/50 px-1.5 py-0.5 rounded">Optional</span>
        </div>
        <div className="space-y-2">
              {/* Enable Marketing Toggle */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="ENABLE_MARKETING"
                  checked={settings.ENABLE_MARKETING === 'true'}
                  onChange={(e) => handleChange('ENABLE_MARKETING', e.target.checked ? 'true' : 'false')}
                  className="w-4 h-4 text-blue-500 bg-gray-900 border-gray-600 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
                />
                <label htmlFor="ENABLE_MARKETING" className="text-sm font-medium text-gray-300 cursor-pointer">
                  Enable Marketing (runs after successful launch)
                </label>
              </div>

              {settings.ENABLE_MARKETING === 'true' && (
                <div className="space-y-2 pl-3 border-l-2 border-blue-500">
                  {/* Website Update */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="ENABLE_WEBSITE_UPDATE"
                        checked={settings.ENABLE_WEBSITE_UPDATE === 'true'}
                        onChange={(e) => handleChange('ENABLE_WEBSITE_UPDATE', e.target.checked ? 'true' : 'false')}
                        className="w-4 h-4 rounded"
                      />
                      <label htmlFor="ENABLE_WEBSITE_UPDATE" className="text-sm font-medium text-gray-300 cursor-pointer">
                        Update Website Configuration
                      </label>
                    </div>
                    {settings.ENABLE_WEBSITE_UPDATE === 'true' && (
                      <div className="pl-6 space-y-2">
                        <input
                          type="text"
                          value={settings.WEBSITE_URL || (settings.WEBSITE ? extractDomain(settings.WEBSITE) : '')}
                          onChange={(e) => handleChange('WEBSITE_URL', e.target.value)}
                          className="w-full px-3 py-2 bg-gray-900/50 border border-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Website domain (e.g., mytoken.com) - Auto-filled from Website field if empty"
                        />
                        <input
                          type="text"
                          value={settings.WEBSITE_SECRET || ''}
                          onChange={(e) => handleChange('WEBSITE_SECRET', e.target.value)}
                          className="w-full px-3 py-2 bg-gray-900/50 border border-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="API Secret (optional)"
                        />
                        <div>
                          <label className="block text-xs font-medium text-gray-300 mb-1">
                            Chain
                          </label>
                          <select
                            value={settings.WEBSITE_CHAIN || 'solana'}
                            onChange={(e) => handleChange('WEBSITE_CHAIN', e.target.value)}
                            className="w-full px-3 py-2 bg-gray-900/50 border border-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="solana">Solana</option>
                            <option value="ethereum">Ethereum</option>
                            <option value="base">Base</option>
                            <option value="bsc">BSC (Binance Smart Chain)</option>
                            <option value="polygon">Polygon</option>
                            <option value="avalanche">Avalanche</option>
                            <option value="arbitrum">Arbitrum</option>
                            <option value="optimism">Optimism</option>
                          </select>
                          <p className="text-xs text-gray-500 mt-1">Select the blockchain for website display (does not affect launch)</p>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-300 mb-1">
                            Custom Contract Address (Optional)
                          </label>
                          <input
                            type="text"
                            value={settings.CUSTOM_TOKEN_ADDRESS || ''}
                            onChange={(e) => handleChange('CUSTOM_TOKEN_ADDRESS', e.target.value)}
                            className="w-full px-3 py-2 bg-gray-900/50 border border-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                            placeholder={nextAddress?.address || 'Enter contract address or leave empty to use next pump address'}
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            {nextAddress?.address ? (
                              <>Next pump address: <span className="font-mono text-gray-400">{nextAddress.address.slice(0, 8)}...{nextAddress.address.slice(-8)}</span></>
                            ) : (
                              'Leave empty to use next pump address when available'
                            )}
                          </p>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-300 mb-1">
                            Website Theme
                          </label>
                          <select
                            value={settings.WEBSITE_THEME || 'DEFAULT'}
                            onChange={(e) => handleChange('WEBSITE_THEME', e.target.value)}
                            className="w-full px-3 py-2 bg-gray-900/50 border border-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="DEFAULT">Default</option>
                            <option value="THEME1">Theme1</option>
                            <option value="THEME2">Theme2</option>
                            <option value="THEME3">Theme3</option>
                            <option value="BLUE">Blue</option>
                            <option value="GREEN">Green</option>
                            <option value="PURPLE">Purple</option>
                            <option value="DARK">Dark</option>
                            <option value="NEON">Neon</option>
                            <option value="RED">Red</option>
                            <option value="BLACK">Black</option>
                            <option value="WHITE">White</option>
                            <option value="ORANGE">Orange</option>
                            <option value="YELLOW">Yellow</option>
                            <option value="PINK">Pink</option>
                            <option value="CYAN">Cyan</option>
                            <option value="CUSTOM">Custom Colors</option>
                          </select>
                          {settings.WEBSITE_THEME === 'CUSTOM' && (
                            <div className="mt-2 space-y-2">
                              <input
                                type="text"
                                value={settings.WEBSITE_CUSTOM_COLOR || ''}
                                onChange={(e) => handleChange('WEBSITE_CUSTOM_COLOR', e.target.value)}
                                className="w-full px-3 py-2 bg-gray-900/50 border border-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Custom primary color (e.g., #FF5733 or blue)"
                              />
                            </div>
                          )}
                        </div>
                        <button
                          onClick={testWebsiteUpdate}
                          disabled={testingMarketing.website}
                          className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-800 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                        >
                          {testingMarketing.website ? (
                            <>
                              <ArrowPathIcon className="w-4 h-4 animate-spin inline mr-1" /> Testing...
                            </>
                          ) : (
                            <>
                              <BeakerIcon className="w-4 h-4 mr-2" />
                              Test Website Update
                            </>
                          )}
                        </button>
                        {marketingTestResults.website && (
                          <div className={`text-xs p-2 rounded ${marketingTestResults.website.success ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>
                            {marketingTestResults.website.success ? (
                              <>
                                <CheckCircleIcon className="w-4 h-4 inline mr-1" />
                                Test passed
                              </>
                            ) : (
                              <>
                                <XCircleIcon className="w-4 h-4 inline mr-1" />
                                Test failed: {marketingTestResults.website.error || 'Unknown error'}
                              </>
                            )}
                          </div>
                        )}
                        
                        {/* Vercel Project Selection & Domain Actions */}
                        <div className="mt-3 p-3 bg-gray-900/50 rounded-lg border border-gray-700 space-y-3">
                          <div className="text-xs font-medium text-gray-400 uppercase tracking-wider">Vercel Domain Management</div>
                          
                          {/* Domain Search & Purchase */}
                          <div className="p-2 bg-gray-800/50 rounded-lg border border-gray-600 space-y-2">
                            <label className="block text-xs text-gray-400 mb-1">🔍 Search & Buy Domain</label>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={domainSearchQuery}
                                onChange={(e) => setDomainSearchQuery(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && searchDomains()}
                                placeholder="Enter token name (e.g., mytoken)"
                                className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                              />
                              <button
                                onClick={searchDomains}
                                disabled={searchingDomains || !domainSearchQuery.trim()}
                                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1"
                              >
                                {searchingDomains ? (
                                  <><ArrowPathIcon className="w-4 h-4 animate-spin" /></>
                                ) : (
                                  <>Search</>
                                )}
                              </button>
                            </div>
                            
                            {/* Search Results */}
                            {domainSearchResults.length > 0 && (
                              <div className="space-y-1 max-h-32 overflow-y-auto">
                                {domainSearchResults.map(d => (
                                  <div key={d.domain} className="flex items-center justify-between p-2 bg-gray-900/50 rounded border border-gray-700">
                                    <span className="text-sm text-white">{d.domain}</span>
                                    <button
                                      onClick={() => purchaseDomain(d)}
                                      disabled={purchasingDomain === d.domain}
                                      className="px-3 py-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white text-xs font-medium rounded transition-colors"
                                    >
                                      {purchasingDomain === d.domain ? 'Buying...' : `Buy ${d.priceFormatted || 'Check'}`}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          
                          {/* Domain Dropdown */}
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">Select Domain (You Own)</label>
                            <select
                              value={selectedDomain}
                              onChange={(e) => setSelectedDomain(e.target.value)}
                              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              disabled={loadingDomains}
                            >
                              {loadingDomains ? (
                                <option>Loading domains...</option>
                              ) : vercelDomains.length === 0 ? (
                                <option value="">No domains found</option>
                              ) : (
                                vercelDomains.map(domain => (
                                  <option key={domain.name} value={domain.name}>
                                    {domain.name} {domain.projectId ? '(connected)' : '(available)'}
                                  </option>
                                ))
                              )}
                            </select>
                            <p className="text-xs text-gray-500 mt-1">{vercelDomains.length} domains owned</p>
                          </div>
                          
                          {/* Project Dropdown */}
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">Select Vercel Project</label>
                            <select
                              value={selectedProjectId}
                              onChange={(e) => setSelectedProjectId(e.target.value)}
                              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              disabled={loadingProjects}
                            >
                              {loadingProjects ? (
                                <option>Loading projects...</option>
                              ) : vercelProjects.length === 0 ? (
                                <option value="">No projects found</option>
                              ) : (
                                vercelProjects.map(project => (
                                  <option key={project.id} value={project.id}>
                                    {project.name} {project.productionDomain ? `(${project.productionDomain})` : ''}
                                  </option>
                                ))
                              )}
                            </select>
                            <p className="text-xs text-gray-500 mt-1">{vercelProjects.length} projects available</p>
                          </div>
                          
                          {/* Connect/Disconnect Buttons */}
                          <div className="flex gap-2">
                            <button
                              onClick={connectDomain}
                              disabled={connectingDomain || !selectedDomain || !selectedProjectId}
                              className="flex-1 px-3 py-2 bg-green-600/80 hover:bg-green-700 disabled:bg-gray-800 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-1"
                              title="Connect selected domain to selected project"
                            >
                              {connectingDomain ? (
                                <><ArrowPathIcon className="w-4 h-4 animate-spin" /> Connecting...</>
                              ) : (
                                <><CheckCircleIcon className="w-4 h-4" /> Connect</>
                              )}
                            </button>
                            <button
                              onClick={disconnectDomain}
                              disabled={disconnectingDomain || !selectedDomain || !selectedProjectId}
                              className="flex-1 px-3 py-2 bg-red-600/80 hover:bg-red-700 disabled:bg-gray-800 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-1"
                              title="Disconnect selected domain from selected project"
                            >
                              {disconnectingDomain ? (
                                <><ArrowPathIcon className="w-4 h-4 animate-spin" /> Disconnecting...</>
                              ) : (
                                <><XCircleIcon className="w-4 h-4" /> Disconnect</>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Telegram Creation */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="ENABLE_TELEGRAM_CREATION"
                        checked={settings.ENABLE_TELEGRAM_CREATION === 'true'}
                        onChange={(e) => handleChange('ENABLE_TELEGRAM_CREATION', e.target.checked ? 'true' : 'false')}
                        className="w-4 h-4 rounded"
                      />
                      <label htmlFor="ENABLE_TELEGRAM_CREATION" className="text-sm font-medium text-gray-300 cursor-pointer">
                        Create Telegram Group/Channel
                      </label>
                    </div>
                    {settings.ENABLE_TELEGRAM_CREATION === 'true' && (
                      <div className="pl-6 space-y-2">
                        <input
                          type="text"
                          value={settings.TELEGRAM_API_ID || ''}
                          onChange={(e) => handleChange('TELEGRAM_API_ID', e.target.value)}
                          className="w-full px-3 py-2 bg-gray-900/50 border border-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Telegram API ID"
                        />
                        <input
                          type="password"
                          value={settings.TELEGRAM_API_HASH || ''}
                          onChange={(e) => handleChange('TELEGRAM_API_HASH', e.target.value)}
                          className="w-full px-3 py-2 bg-gray-900/50 border border-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Telegram API Hash"
                        />
                        <input
                          type="text"
                          value={settings.TELEGRAM_PHONE || ''}
                          onChange={(e) => handleChange('TELEGRAM_PHONE', e.target.value)}
                          className="w-full px-3 py-2 bg-gray-900/50 border border-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Phone Number (e.g., +1234567890)"
                        />
                        
                        {/* Verification Section */}
                        <div className="space-y-2 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-gray-300">Account Verification</span>
                            {telegramVerification.verified && (
                              <span className="text-xs text-green-400 flex items-center gap-1">
                                <CheckCircleIcon className="w-4 h-4" />
                                Verified
                              </span>
                            )}
                          </div>
                          
                          {!telegramVerification.verified && (
                            <>
                              <button
                                type="button"
                                onClick={handleCheckTelegramStatus}
                                disabled={telegramVerification.verifying}
                                className="w-full px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-white text-xs font-medium rounded transition-colors"
                              >
                                {telegramVerification.verifying ? (
                                  <>
                                    <ArrowPathIcon className="w-4 h-4 animate-spin inline mr-1" />
                                    Checking...
                                  </>
                                ) : (
                                  <>
                                    <MagnifyingGlassIcon className="w-4 h-4 inline mr-1" />
                                    Check Status
                                  </>
                                )}
                              </button>
                              
                              {!telegramVerification.codeSent ? (
                                <button
                                  type="button"
                                  onClick={handleSendTelegramCode}
                                  disabled={telegramVerification.verifying}
                                  className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-800 disabled:cursor-not-allowed text-white text-xs font-medium rounded transition-colors"
                                >
                                  {telegramVerification.verifying ? (
                                    <>
                                      <ArrowPathIcon className="w-4 h-4 animate-spin inline mr-1" />
                                      Sending...
                                    </>
                                  ) : (
                                    <>
                                      <svg className="w-4 h-4 inline mr-1" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                                      </svg>
                                      Verify Account
                                    </>
                                  )}
                                </button>
                              ) : (
                                <div className="space-y-2">
                                  <p className="text-xs text-gray-400">
                                    ✓ Code sent! Check your Telegram app for the verification code.
                                  </p>
                                  <input
                                    type="text"
                                    value={telegramCode}
                                    onChange={(e) => setTelegramCode(e.target.value)}
                                    className="w-full px-2 py-1.5 bg-gray-900/50 border border-gray-700 rounded text-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="Enter verification code"
                                    maxLength={10}
                                  />
                                  {telegramVerification.requires2FA && (
                                    <input
                                      type="password"
                                      value={telegram2FAPassword}
                                      onChange={(e) => setTelegram2FAPassword(e.target.value)}
                                      className="w-full px-2 py-1.5 bg-gray-900/50 border border-gray-700 rounded text-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      placeholder="2FA Password (if required)"
                                    />
                                  )}
                                  <button
                                    type="button"
                                    onClick={handleVerifyTelegramCode}
                                    disabled={telegramVerification.verifying || !telegramCode.trim()}
                                    className="w-full px-3 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-800 disabled:cursor-not-allowed text-white text-xs font-medium rounded transition-colors"
                                  >
                                    {telegramVerification.verifying ? (
                                      <>
                                        <ArrowPathIcon className="w-4 h-4 animate-spin inline mr-1" />
                                        Verifying...
                                      </>
                                    ) : (
                                      <>
                                        <CheckCircleIcon className="w-4 h-4 inline mr-1" />
                                        Submit Code
                                      </>
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setTelegramVerification({
                                        codeSent: false,
                                        phoneCodeHash: null,
                                        requires2FA: false,
                                        verifying: false,
                                        verified: false,
                                        error: null,
                                      });
                                      setTelegramCode('');
                                      setTelegram2FAPassword('');
                                    }}
                                    className="w-full px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium rounded transition-colors"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              )}
                              
                              {telegramVerification.error && (
                                <div className="text-xs p-2 rounded bg-red-900/50 text-red-300">
                                  Γ¥î {telegramVerification.error}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="TELEGRAM_CREATE_GROUP"
                            checked={settings.TELEGRAM_CREATE_GROUP !== 'false'}
                            onChange={(e) => handleChange('TELEGRAM_CREATE_GROUP', e.target.checked ? 'true' : 'false')}
                            className="w-4 h-4 rounded"
                          />
                          <label htmlFor="TELEGRAM_CREATE_GROUP" className="text-xs text-gray-500 cursor-pointer">Create Group</label>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="TELEGRAM_CREATE_CHANNEL"
                            checked={settings.TELEGRAM_CREATE_CHANNEL === 'true'}
                            onChange={(e) => handleChange('TELEGRAM_CREATE_CHANNEL', e.target.checked ? 'true' : 'false')}
                            className="w-4 h-4 rounded"
                          />
                          <label htmlFor="TELEGRAM_CREATE_CHANNEL" className="text-xs text-gray-500 cursor-pointer">Create Channel</label>
                        </div>
                        <input
                          type="text"
                          value={settings.TELEGRAM_CHANNEL_USERNAME || ''}
                          onChange={(e) => handleChange('TELEGRAM_CHANNEL_USERNAME', e.target.value)}
                          className="w-full px-3 py-2 bg-gray-900/50 border border-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Channel Username (optional, e.g., @mychannel)"
                        />
                        <button
                          onClick={testTelegramCreation}
                          disabled={testingMarketing.telegram}
                          className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-800 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                        >
                          {testingMarketing.telegram ? (
                            <>
                              <ArrowPathIcon className="w-4 h-4 animate-spin inline mr-1" /> Testing...
                            </>
                          ) : (
                            <>
                              <BeakerIcon className="w-4 h-4 mr-2" />
                              Test Telegram Creation
                            </>
                          )}
                        </button>
                        {marketingTestResults.telegram && (
                          <div className={`text-xs p-2 rounded ${marketingTestResults.telegram.success ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>
                            {marketingTestResults.telegram.success ? (
                              <>
                                <CheckCircleIcon className="w-4 h-4 inline mr-1" />
                                Test passed: {marketingTestResults.telegram.message || 'Group/channel created'}
                              </>
                            ) : (
                              <>
                                <XCircleIcon className="w-4 h-4 inline mr-1" />
                                Test failed: {marketingTestResults.telegram.error || 'Unknown error'}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Twitter Posting */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="ENABLE_TWITTER_POSTING"
                        checked={settings.ENABLE_TWITTER_POSTING === 'true'}
                        onChange={(e) => handleChange('ENABLE_TWITTER_POSTING', e.target.checked ? 'true' : 'false')}
                        className="w-4 h-4 rounded"
                      />
                      <label htmlFor="ENABLE_TWITTER_POSTING" className="text-sm font-medium text-gray-300 cursor-pointer">
                        Post to Twitter/X
                      </label>
                    </div>
                    {settings.ENABLE_TWITTER_POSTING === 'true' && (
                      <div className="pl-6 space-y-2">
                        {/* Saved Twitter Accounts Dropdown */}
                        {savedTwitterAccounts.length > 0 && (
                          <div className="p-3 bg-gray-800/50 border border-gray-700 rounded-lg space-y-2">
                            <label className="block text-xs text-gray-400 font-medium">📋 Saved Accounts</label>
                            <div className="space-y-1 max-h-40 overflow-y-auto">
                              {savedTwitterAccounts.map((account) => (
                                <div 
                                  key={account.id}
                                  onClick={() => loadSavedTwitterAccount(account)}
                                  className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                                    twitterAccountInfo?.id === account.id 
                                      ? 'bg-blue-900/50 border border-blue-500/50' 
                                      : 'bg-gray-900/50 hover:bg-gray-700/50 border border-gray-700'
                                  }`}
                                >
                                  {account.profileImageUrl && (
                                    <img src={account.profileImageUrl} alt="" className="w-8 h-8 rounded-full" />
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-white truncate">{account.name}</div>
                                    <div className="text-xs text-gray-400">@{account.username}</div>
                                  </div>
                                  <button
                                    onClick={(e) => deleteSavedTwitterAccount(account.id, e)}
                                    className="p-1 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded"
                                  >
                                    <XCircleIcon className="w-4 h-4" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        {/* Account Info Display */}
                        {twitterAccountInfo && (
                          <div className="p-3 bg-green-900/30 border border-green-500/50 rounded-lg">
                            <div className="flex items-center gap-3">
                              {twitterAccountInfo.profileImageUrl && (
                                <img 
                                  src={twitterAccountInfo.profileImageUrl} 
                                  alt="Profile" 
                                  className="w-10 h-10 rounded-full"
                                />
                              )}
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-white">{twitterAccountInfo.name}</span>
                                  {twitterAccountInfo.verified && (
                                    <CheckCircleIcon className="w-4 h-4 text-blue-400" title="Verified Account" />
                                  )}
                                </div>
                                <div className="text-sm text-gray-300">@{twitterAccountInfo.username}</div>
                                {twitterAccountInfo.followersCount !== undefined && (
                                  <div className="text-xs text-gray-400 mt-1">
                                    {twitterAccountInfo.followersCount.toLocaleString()} followers
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => updateTwitterProfile(false)}
                                  disabled={updatingTwitterProfile || !settings.TOKEN_NAME}
                                  className="px-2 py-1 text-xs bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 text-white rounded"
                                  title="Update name, bio & website only"
                                >
                                  {updatingTwitterProfile ? '...' : '🔄 Sync Text'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => updateTwitterProfile(true)}
                                  disabled={updatingTwitterProfile || !settings.TOKEN_NAME}
                                  className="px-2 py-1 text-xs bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:bg-gray-700 text-white rounded"
                                  title="Update name, bio, website + profile image + AI banner"
                                >
                                  {updatingTwitterProfile ? '...' : '🖼️ Full Sync'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setTwitterAccountInfo(null)}
                                  className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded"
                                >
                                  Clear
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        <input
                          type="password"
                          value={settings.TWITTER_API_KEY || ''}
                          onChange={(e) => {
                            handleChange('TWITTER_API_KEY', e.target.value);
                            setTwitterAccountInfo(null); // Clear account info when keys change
                          }}
                          className="w-full px-3 py-2 bg-gray-900/50 border border-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Twitter API Key"
                        />
                        <input
                          type="password"
                          value={settings.TWITTER_API_SECRET || ''}
                          onChange={(e) => {
                            handleChange('TWITTER_API_SECRET', e.target.value);
                            setTwitterAccountInfo(null); // Clear account info when keys change
                          }}
                          className="w-full px-3 py-2 bg-gray-900/50 border border-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Twitter API Secret"
                        />
                        <input
                          type="password"
                          value={settings.TWITTER_ACCESS_TOKEN || ''}
                          onChange={(e) => {
                            handleChange('TWITTER_ACCESS_TOKEN', e.target.value);
                            setTwitterAccountInfo(null); // Clear account info when keys change
                          }}
                          className="w-full px-3 py-2 bg-gray-900/50 border border-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Twitter Access Token"
                        />
                        <input
                          type="password"
                          value={settings.TWITTER_ACCESS_TOKEN_SECRET || ''}
                          onChange={(e) => {
                            handleChange('TWITTER_ACCESS_TOKEN_SECRET', e.target.value);
                            setTwitterAccountInfo(null); // Clear account info when keys change
                          }}
                          className="w-full px-3 py-2 bg-gray-900/50 border border-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Twitter Access Token Secret"
                        />
                        <button
                          type="button"
                          onClick={getTwitterAccountInfo}
                          disabled={loadingTwitterAccount || !settings.TWITTER_API_KEY || !settings.TWITTER_API_SECRET || !settings.TWITTER_ACCESS_TOKEN || !settings.TWITTER_ACCESS_TOKEN_SECRET}
                          className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-800 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                        >
                          {loadingTwitterAccount ? (
                            <>
                              <ArrowPathIcon className="w-4 h-4 animate-spin inline mr-1" /> Verifying...
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              Verify Account
                            </>
                          )}
                        </button>
                        
                        {/* Community ID */}
                        <div className="flex items-center gap-2 p-2 bg-gray-800/30 rounded-lg border border-gray-700">
                          <span className="text-xs text-gray-400 whitespace-nowrap">🏘️ Community:</span>
                          <input
                            type="text"
                            value={settings.TWITTER_COMMUNITY_ID || ''}
                            onChange={(e) => handleChange('TWITTER_COMMUNITY_ID', e.target.value)}
                            className="flex-1 px-2 py-1 bg-gray-900/50 border border-gray-700 rounded text-white text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
                            placeholder="Community ID (from URL: x.com/i/communities/XXXX)"
                          />
                          {settings.TWITTER_COMMUNITY_ID && (
                            <span className="text-xs text-green-400">✓ Will post to community</span>
                          )}
                        </div>
                        
                        {/* Tweet List */}
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-gray-300">Tweets</label>
                            <button
                              type="button"
                              onClick={addTweet}
                              className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg transition-colors"
                            >
                              + Add Tweet
                            </button>
                          </div>
                          
                          {tweetList.map((tweet, index) => (
                            <div key={index} className="bg-gray-900/50 rounded-lg p-3 border border-gray-800">
                              <div className="flex items-start gap-2 mb-2">
                                <div className="flex-1">
                                  <textarea
                                    value={tweet.text}
                                    onChange={(e) => updateTweetText(index, e.target.value)}
                                    rows={2}
                                    className="w-full px-3 py-2 bg-gray-900/50 border border-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="Tweet text (use [token_name], [CA], [website], etc.)"
                                  />
                                </div>
                                {tweetList.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => removeTweet(index)}
                                    className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors"
                                    title="Remove tweet"
                                  >
                                    <CheckCircleIcon className="w-4 h-4 inline" />
                                  </button>
                                )}
                              </div>
                              
                              {/* Image Upload */}
                              <div className="flex items-center gap-2">
                                <label className="px-3 py-1.5 bg-gray-900/50 hover:bg-gray-800 text-white text-xs font-medium rounded-lg cursor-pointer transition-colors">
                                  <PhotoIcon className="w-4 h-4 inline mr-1" />
                                  {tweet.imagePreview ? 'Change Image' : 'Add Image'}
                                  <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) => {
                                      const file = e.target.files[0];
                                      if (file) handleTweetImageChange(index, file);
                                    }}
                                    className="hidden"
                                  />
                                </label>
                                
                                {tweet.imagePreview && (
                                  <>
                                    <img 
                                      src={tweet.imagePreview} 
                                      alt="Tweet preview" 
                                      className="w-12 h-12 object-cover rounded"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => removeTweetImage(index)}
                                      className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors"
                                    >
                                      Remove
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                          
                          {tweetList.length === 0 && (
                            <button
                              type="button"
                              onClick={addTweet}
                              className="w-full px-4 py-2 bg-gray-900/50 hover:bg-gray-800 text-white text-sm font-medium rounded-lg transition-colors border-2 border-dashed border-gray-800"
                            >
                              + Add Your First Tweet
                            </button>
                          )}
                        </div>
                        
                        <p className="text-xs text-gray-500 mt-2">
                          <span className="flex items-center gap-2">
                            <LightBulbIcon className="w-3 h-3" />
                            Use placeholders: [token_name], [token_symbol], [CA], [website], [telegram], [twitter]
                          </span>
                        </p>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="TWITTER_UPDATE_PROFILE"
                            checked={settings.TWITTER_UPDATE_PROFILE !== 'false'}
                            onChange={(e) => handleChange('TWITTER_UPDATE_PROFILE', e.target.checked ? 'true' : 'false')}
                            className="w-4 h-4 rounded"
                          />
                          <label htmlFor="TWITTER_UPDATE_PROFILE" className="text-xs text-gray-500 cursor-pointer">Update Profile</label>
                        </div>
                        <button
                          onClick={testTwitterPosting}
                          disabled={testingMarketing.twitter}
                          className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-800 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                        >
                          {testingMarketing.twitter ? (
                            <>
                              <ArrowPathIcon className="w-4 h-4 animate-spin inline mr-1" /> Testing...
                            </>
                          ) : (
                            <>
                              <BeakerIcon className="w-4 h-4 mr-2" />
                              Test Twitter Posting
                            </>
                          )}
                        </button>
                        {marketingTestResults.twitter && (
                          <div className={`text-xs p-2 rounded ${marketingTestResults.twitter.success ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>
                            {marketingTestResults.twitter.success ? (
                              <>
                                <CheckCircleIcon className="w-4 h-4 inline mr-1" />
                                Test passed: {marketingTestResults.twitter.message || 'Tweets posted'}
                              </>
                            ) : (
                              <>
                                <XCircleIcon className="w-4 h-4 inline mr-1" />
                                Test failed: {marketingTestResults.twitter.error || 'Unknown error'}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
        </div>
      </div>

      {/* LAUNCH TOKEN BUTTON */}
      <div className="mt-6 mb-6">
        <button
          onClick={handleLaunch}
          disabled={loading || !settings.TOKEN_NAME || !settings.TOKEN_SYMBOL || !settings.DESCRIPTION}
          className={`w-full py-4 text-white font-black text-xl rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-2xl flex items-center justify-center gap-3 relative overflow-hidden group ${
            launchMode === 'quick'
              ? 'bg-gradient-to-r from-yellow-500 via-orange-500 to-red-500 hover:from-yellow-600 hover:via-orange-600 hover:to-red-600 hover:shadow-orange-500/50'
              : 'bg-gradient-to-r from-purple-600 via-pink-600 to-red-600 hover:from-purple-700 hover:via-pink-700 hover:to-red-700 hover:shadow-purple-500/50'
          }`}
        >
          {/* Animated background effect */}
          <div className={`absolute inset-0 opacity-0 group-hover:opacity-20 transition-opacity duration-300 ${
            launchMode === 'quick'
              ? 'bg-gradient-to-r from-yellow-400 via-orange-400 to-red-400'
              : 'bg-gradient-to-r from-purple-400 via-pink-400 to-red-400'
          }`} />
          
          {loading ? (
            <>
              <ArrowPathIcon className="w-8 h-8 animate-spin" />
              <span>LAUNCHING...</span>
            </>
          ) : (
            <>
              {launchMode === 'quick' ? (
                <svg className="w-6 h-6 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              ) : (
                <RocketLaunchIconSolid className="w-6 h-6 group-hover:scale-110 transition-transform" />
              )}
              <span className="tracking-wider font-bold">
                {launchMode === 'quick' ? '⚡ QUICK LAUNCH' : '🔥 ADVANCED LAUNCH'}
              </span>
            </>
          )}
        </button>
        {(!settings.TOKEN_NAME || !settings.TOKEN_SYMBOL || !settings.DESCRIPTION) && (
          <p className="text-xs text-yellow-400 mt-2 text-center flex items-center justify-center gap-1">
            <ExclamationTriangleIcon className="w-4 h-4" />
            Please fill in Token Name, Symbol, and Description to enable launch
          </p>
        )}
      </div>

      {/* Wallet Info & Fee Breakdown */}
      {walletInfo && (
        <div className="mt-6 space-y-4" data-section="wallet-config">
            {/* Funding Wallet */}
            <div className="p-4 bg-gray-900/50 rounded-lg border-l-4 border-blue-500 transition-all duration-300">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm font-semibold text-blue-400 mb-1 flex items-center gap-2">
                    <CurrencyDollarIcon className="w-4 h-4" />
                    {walletInfo.fundingWallet.label}
                  </p>
                  <p className="text-xs font-mono text-gray-300">{walletInfo.fundingWallet.address.substring(0, 8)}...{walletInfo.fundingWallet.address.substring(walletInfo.fundingWallet.address.length - 8)}</p>
                  {walletInfo.fundingWallet.privateKey && (
                    <p className="text-xs font-mono text-gray-500 mt-1" title="Private Key (shortened for security)">
                      🔑 {walletInfo.fundingWallet.privateKey}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500">Current Balance</p>
                  <p className={`text-lg font-bold ${walletInfo.fundingWallet.balance >= walletInfo.breakdown.total ? 'text-green-400' : 'text-red-400'}`}>
                    {walletInfo.fundingWallet.balance.toFixed(4)} SOL
                  </p>
                </div>
              </div>
            </div>

            {/* Creator/DEV Wallet */}
            <div className="p-4 bg-gray-900/50 rounded-lg border-l-4 border-purple-500">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm font-semibold text-purple-400 mb-1">🎨 Creator/DEV Wallet</p>
                  <p className="text-xs font-mono text-gray-300">
                    {walletInfo.creatorDevWallet.isAutoCreated ? 'Will be auto-created' : walletInfo.creatorDevWallet.address.substring(0, 8) + '...' + walletInfo.creatorDevWallet.address.substring(walletInfo.creatorDevWallet.address.length - 8)}
                  </p>
                  {walletInfo.creatorDevWallet.privateKey && (
                    <p className="text-xs font-mono text-gray-500 mt-1" title="Private Key (shortened for security)">
                      🔑 {walletInfo.creatorDevWallet.privateKey}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-1">{walletInfo.creatorDevWallet.source}</p>
                </div>
                <div className="text-right">
                  {walletInfo.useFundingAsBuyer || walletInfo.creatorDevWallet?.isFundingWallet ? (
                    <>
                      <p className="text-xs text-green-400">DEV Buy (from wallet)</p>
                      <p className="text-sm font-bold text-green-400">{walletInfo.buyerAmount.toFixed(4)} SOL</p>
                      <p className="text-xs text-gray-500 mt-1">✓ No separate funding</p>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-gray-500">Will Fund</p>
                      <p className="text-sm font-bold text-purple-400">{walletInfo.buyerAmount.toFixed(4)} SOL</p>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Bundle Wallets Summary */}
            {walletInfo.bundleWallets.count > 0 && (
              <div className="p-4 bg-gray-900/50 rounded-lg border-l-4 border-green-500">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="text-sm font-semibold text-green-400 mb-1 flex items-center gap-2">
                      <CubeIcon className="w-4 h-4" />
                      {walletInfo.bundleWallets.label}
                    </p>
                    <p className="text-xs text-gray-500">{walletInfo.bundleWallets.count} wallet(s)</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Total</p>
                    <p className="text-sm font-bold text-green-400">{walletInfo.bundleWallets.totalSol.toFixed(4)} SOL</p>
                  </div>
                </div>
                <div className="mt-2 space-y-1">
                  {walletInfo.bundleWallets.amounts.map((amount, idx) => (
                    <div key={idx} className="flex justify-between text-xs">
                      <span className="text-gray-500">Bundle Wallet {idx + 1}:</span>
                      <span className="text-gray-300">{amount.toFixed(4)} SOL</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Holder Wallets Summary */}
            {(walletInfo.holderWallets.count > 0 || (useWarmedHolderWallets && selectedHolderWallets.length > 0)) && (
              <div className={`p-4 bg-gray-900/50 rounded-lg border-l-4 ${useWarmedHolderWallets && selectedHolderWallets.length > 0 ? 'border-green-500' : 'border-yellow-500'}`}>
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className={`text-sm font-semibold mb-1 flex items-center gap-2 ${useWarmedHolderWallets && selectedHolderWallets.length > 0 ? 'text-green-400' : 'text-yellow-400'}`}>
                      <UserGroupIcon className="w-4 h-4" />
                      {walletInfo.holderWallets.label}
                      {useWarmedHolderWallets && selectedHolderWallets.length > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-green-600/30 text-green-400 rounded">PRE-FUNDED</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500">
                      {useWarmedHolderWallets ? selectedHolderWallets.length : walletInfo.holderWallets.count} wallet(s)
                      {useWarmedHolderWallets && ' (warmed)'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">
                      {useWarmedHolderWallets && selectedHolderWallets.length > 0 ? 'Balance' : 'Funding Needed'}
                    </p>
                    <p className={`text-sm font-bold ${useWarmedHolderWallets && selectedHolderWallets.length > 0 ? 'text-green-400' : 'text-yellow-400'}`}>
                      {useWarmedHolderWallets && selectedHolderWallets.length > 0 
                        ? `${walletInfo.breakdown.holderExistingBalance?.toFixed(4) || '0.0000'} SOL`
                        : `${walletInfo.holderWallets.totalSol.toFixed(4)} SOL`
                      }
                    </p>
                  </div>
                </div>
                <div className="mt-2 space-y-1">
                  {useWarmedHolderWallets && selectedHolderWallets.length > 0 ? (
                    // Show warmed wallet balances
                    selectedHolderWallets.map((addr, idx) => {
                      const wallet = warmedWallets.find(w => w.address === addr);
                      const balance = wallet?.solBalance || wallet?.balance || 0;
                      return (
                        <div key={idx} className="flex justify-between text-xs">
                          <span className="text-gray-500">Holder Wallet {idx + 1}:</span>
                          <span className="text-green-400">✓ {balance.toFixed(4)} SOL</span>
                        </div>
                      );
                    })
                  ) : (
                    // Show fresh wallet amounts
                    walletInfo.holderWallets.amounts.map((amount, idx) => (
                      <div key={idx} className="flex justify-between text-xs">
                        <span className="text-gray-500">Holder Wallet {idx + 1}:</span>
                        <span className="text-gray-300">{amount.toFixed(4)} SOL</span>
                      </div>
                    ))
                  )}
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
              <div className="space-y-1 text-xs border-t border-gray-700 pt-2">
                <div className="flex justify-between">
                  <span className="text-gray-500">Bundle Wallets:</span>
                  <span className={useWarmedBundleWallets && selectedBundleWallets.length > 0 ? 'text-green-400' : 'text-gray-300'}>
                    {useWarmedBundleWallets && selectedBundleWallets.length > 0 
                      ? `✓ Self-funded`
                      : `${walletInfo.breakdown.bundleWallets.toFixed(4)} SOL`
                    }
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Holder Wallets:</span>
                  <span className={useWarmedHolderWallets && selectedHolderWallets.length > 0 ? 'text-green-400' : 'text-gray-300'}>
                    {useWarmedHolderWallets && selectedHolderWallets.length > 0 
                      ? `✓ Self-funded`
                      : `${walletInfo.breakdown.holderWallets.toFixed(4)} SOL`
                    }
                  </span>
                </div>
                {/* DEV Buy Amount - show based on useFundingAsBuyer flag */}
                <div className="flex justify-between">
                  <span className="text-gray-500">DEV Buy Amount:</span>
                  <span className={walletInfo.useFundingAsBuyer || walletInfo.creatorDevWallet?.isFundingWallet ? 'text-green-400' : 'text-gray-300'}>
                    {walletInfo.useFundingAsBuyer || walletInfo.creatorDevWallet?.isFundingWallet
                      ? `${walletInfo.buyerAmount.toFixed(4)} SOL (from wallet)`
                      : `${walletInfo.buyerAmount.toFixed(4)} SOL`
                    }
                  </span>
                </div>
                {/* Only show separate DEV funding if not using funding wallet as DEV */}
                {!walletInfo.useFundingAsBuyer && !walletInfo.creatorDevWallet?.isFundingWallet && walletInfo.breakdown.creatorDevWallet > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Creator/DEV Wallet Funding:</span>
                    <span className="text-gray-300">{walletInfo.breakdown.creatorDevWallet.toFixed(4)} SOL</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500">Jito Fee:</span>
                  <span className="text-gray-300">{walletInfo.breakdown.jitoFee.toFixed(4)} SOL</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">LUT Creation:</span>
                  <span className="text-gray-300">{walletInfo.breakdown.lutFee.toFixed(4)} SOL</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Buffer:</span>
                  <span className="text-gray-300">{walletInfo.breakdown.buffer.toFixed(4)} SOL</span>
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

      {/* Holder Wallet Sniper Configuration Modal */}
      {showHolderSniperModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-gray-900 border border-gray-800 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col my-auto">
            <div className="p-4 border-b border-gray-800">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-yellow-400 flex items-center gap-2">
                  <RocketLaunchIcon className="w-5 h-5" />
                  Configure Holder Wallet Snipers
                </h3>
                <button
                  onClick={() => setShowHolderSniperModal(false)}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <XCircleIcon className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-4 overflow-y-auto flex-1 space-y-4">
              {/* Step 1: Select & Order Wallets */}
              <div>
                <label className="block text-sm font-semibold text-yellow-400 mb-2">
                  Step 1: Select & Order Wallets for Auto-Buy
                  {useWarmedWallets ? (
                    <span className="text-yellow-300"> ({selectedHolderAutoBuyWallets.length} of {selectedHolderWallets.length} selected)</span>
                  ) : (
                    <span className="text-yellow-300"> ({selectedHolderAutoBuyIndices.length} of {parseInt(settings.HOLDER_WALLET_COUNT || '0')} selected)</span>
                  )}
                </label>
                <p className="text-xs text-gray-400 mb-3">
                  {useWarmedWallets 
                    ? "Click wallets to select. Selected wallets will buy in the order shown below. Use ↑↓ buttons to reorder."
                    : "Select which holder wallets (by position) should auto-buy. Wallets will be created in order and selected ones will snipe immediately after launch."
                  }
                </p>
                
                {useWarmedWallets ? (
                  <>
                    {/* Unselected wallets - Warmed wallets */}
                    <div className="mb-3">
                      <p className="text-xs text-gray-500 mb-2">Available wallets (click to add):</p>
                      <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 bg-gray-800/30 rounded">
                        {selectedHolderWallets
                          .filter(addr => !selectedHolderAutoBuyWallets.includes(addr))
                          .map(addr => {
                            const wallet = warmedWallets.find(w => w.address === addr);
                            return (
                              <button
                                key={addr}
                                type="button"
                                onClick={() => {
                                  setSelectedHolderAutoBuyWallets(prev => [...prev, addr]);
                                }}
                                className="px-3 py-1.5 rounded text-sm font-medium transition-colors bg-gray-700 text-gray-300 hover:bg-gray-600"
                              >
                                {addr.slice(0, 8)}...{addr.slice(-6)}
                                {wallet && ` (${wallet.totalTrades || 0} trades)`}
                              </button>
                            );
                          })}
                      </div>
                    </div>
                    
                    {/* Selected wallets in order - Warmed wallets */}
                    {selectedHolderAutoBuyWallets.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 mb-2">Buy order (top to bottom):</p>
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                          {selectedHolderAutoBuyWallets.map((addr, idx) => {
                            const wallet = warmedWallets.find(w => w.address === addr);
                            return (
                              <div
                                key={addr}
                                className="flex items-center gap-2 p-2 bg-yellow-900/30 border border-yellow-600/50 rounded"
                              >
                                <span className="text-sm font-bold text-yellow-400 w-8">#{idx + 1}</span>
                                <span className="flex-1 text-xs font-mono text-white">
                                  {addr.slice(0, 10)}...{addr.slice(-8)}
                                  {wallet && ` (${wallet.totalTrades || 0} trades)`}
                                </span>
                                <div className="flex gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (idx > 0) {
                                        const newOrder = [...selectedHolderAutoBuyWallets];
                                        [newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]];
                                        setSelectedHolderAutoBuyWallets(newOrder);
                                      }
                                    }}
                                    disabled={idx === 0}
                                    className="px-2 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs rounded"
                                    title="Move up"
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (idx < selectedHolderAutoBuyWallets.length - 1) {
                                        const newOrder = [...selectedHolderAutoBuyWallets];
                                        [newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]];
                                        setSelectedHolderAutoBuyWallets(newOrder);
                                      }
                                    }}
                                    disabled={idx === selectedHolderAutoBuyWallets.length - 1}
                                    className="px-2 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs rounded"
                                    title="Move down"
                                  >
                                    ↓
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedHolderAutoBuyWallets(prev => prev.filter(a => a !== addr));
                                    }}
                                    className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded"
                                    title="Remove"
                                  >
                                    ×
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {/* Fresh wallets - Select by index */}
                    <div className="mb-3">
                      <p className="text-xs text-gray-500 mb-2">Select wallet positions (will be created in order):</p>
                      <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 bg-gray-800/30 rounded">
                        {Array.from({ length: parseInt(settings.HOLDER_WALLET_COUNT || '0') }, (_, i) => i + 1)
                          .filter(idx => !selectedHolderAutoBuyIndices.includes(idx))
                          .map(idx => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                setSelectedHolderAutoBuyIndices(prev => [...prev, idx].sort((a, b) => a - b));
                              }}
                              className="px-3 py-1.5 rounded text-sm font-medium transition-colors bg-gray-700 text-gray-300 hover:bg-gray-600"
                            >
                              Wallet #{idx}
                            </button>
                          ))}
                      </div>
                    </div>
                    
                    {/* Selected wallet indices in order - Fresh wallets */}
                    {selectedHolderAutoBuyIndices.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 mb-2">Buy order (top to bottom):</p>
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                          {selectedHolderAutoBuyIndices.map((idx, orderIdx) => (
                            <div
                              key={idx}
                              className="flex items-center gap-2 p-2 bg-yellow-900/30 border border-yellow-600/50 rounded"
                            >
                              <span className="text-sm font-bold text-yellow-400 w-8">#{orderIdx + 1}</span>
                              <span className="flex-1 text-xs font-mono text-white">
                                Wallet #{idx} (will be created at launch)
                              </span>
                              <div className="flex gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (orderIdx > 0) {
                                      const newOrder = [...selectedHolderAutoBuyIndices];
                                      [newOrder[orderIdx - 1], newOrder[orderIdx]] = [newOrder[orderIdx], newOrder[orderIdx - 1]];
                                      setSelectedHolderAutoBuyIndices(newOrder);
                                    }
                                  }}
                                  disabled={orderIdx === 0}
                                  className="px-2 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs rounded"
                                  title="Move up"
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (orderIdx < selectedHolderAutoBuyIndices.length - 1) {
                                      const newOrder = [...selectedHolderAutoBuyIndices];
                                      [newOrder[orderIdx], newOrder[orderIdx + 1]] = [newOrder[orderIdx + 1], newOrder[orderIdx]];
                                      setSelectedHolderAutoBuyIndices(newOrder);
                                    }
                                  }}
                                  disabled={orderIdx === selectedHolderAutoBuyIndices.length - 1}
                                  className="px-2 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs rounded"
                                  title="Move down"
                                >
                                  ↓
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedHolderAutoBuyIndices(prev => prev.filter(i => i !== idx));
                                  }}
                                  className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded"
                                  title="Remove"
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Step 2: Buy Amounts (Warmed wallets only) */}
              {useWarmedHolderWallets && selectedHolderAutoBuyWallets.length > 0 && (
                <div className="pt-4 border-t border-gray-700">
                  <label className="block text-sm font-semibold text-yellow-400 mb-2">
                    Step 2: Set Buy Amounts (SOL)
                  </label>
                  <p className="text-xs text-gray-400 mb-3">
                    How much SOL each wallet will spend to buy tokens. Leave empty to use wallet's full balance.
                  </p>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {selectedHolderAutoBuyWallets.map((addr, idx) => {
                      const wallet = warmedWallets.find(w => w.address === addr);
                      const balance = wallet?.solBalance || wallet?.balance || 0;
                      const amountsArray = settings.HOLDER_SWAP_AMOUNTS 
                        ? settings.HOLDER_SWAP_AMOUNTS.split(',').map(a => a.trim())
                        : [];
                      // Find the index in the original selectedHolderWallets to get the correct amount
                      const originalIdx = selectedHolderWallets.indexOf(addr);
                      const currentValue = amountsArray[originalIdx] || '';
                      
                      return (
                        <div key={addr} className="flex items-center gap-2 p-2 bg-gray-800/50 rounded">
                          <span className="text-sm font-bold text-yellow-400 w-8">#{idx + 1}</span>
                          <span className="text-xs font-mono text-gray-400 flex-1">
                            {addr.slice(0, 8)}...{addr.slice(-4)}
                          </span>
                          <span className="text-xs text-green-400 w-20">💰 {balance.toFixed(3)}</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max={balance}
                            value={currentValue}
                            onChange={(e) => {
                              const newAmounts = [...amountsArray];
                              // Ensure array is long enough
                              while (newAmounts.length <= originalIdx) {
                                newAmounts.push('');
                              }
                              newAmounts[originalIdx] = e.target.value || '';
                              handleChange('HOLDER_SWAP_AMOUNTS', newAmounts.join(','));
                            }}
                            placeholder={balance.toFixed(2)}
                            className="w-24 px-2 py-1 bg-black/50 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-yellow-500"
                          />
                          <span className="text-xs text-gray-500">SOL</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        // Fill all with a specific amount
                        const amount = prompt('Set buy amount for ALL selected wallets (SOL):');
                        if (amount && !isNaN(parseFloat(amount))) {
                          const newAmounts = selectedHolderWallets.map((addr, idx) => {
                            if (selectedHolderAutoBuyWallets.includes(addr)) {
                              return amount;
                            }
                            const existing = settings.HOLDER_SWAP_AMOUNTS?.split(',')[idx] || '';
                            return existing;
                          });
                          handleChange('HOLDER_SWAP_AMOUNTS', newAmounts.join(','));
                        }
                      }}
                      className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                    >
                      Set All
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        // Use max balance for all
                        const newAmounts = selectedHolderWallets.map((addr, idx) => {
                          if (selectedHolderAutoBuyWallets.includes(addr)) {
                            const wallet = warmedWallets.find(w => w.address === addr);
                            const balance = wallet?.solBalance || wallet?.balance || 0;
                            return (balance * 0.95).toFixed(2); // 95% of balance, leave some for fees
                          }
                          const existing = settings.HOLDER_SWAP_AMOUNTS?.split(',')[idx] || '';
                          return existing;
                        });
                        handleChange('HOLDER_SWAP_AMOUNTS', newAmounts.join(','));
                      }}
                      className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded transition-colors"
                    >
                      Use Max (95%)
                    </button>
                  </div>
                </div>
              )}

              {/* Step 3: Configure Timing */}
              {((useWarmedHolderWallets && selectedHolderAutoBuyWallets.length > 0) || (!useWarmedHolderWallets && selectedHolderAutoBuyIndices.length > 0)) && (
                <div className="pt-4 border-t border-gray-700">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-semibold text-yellow-400">
                      {useWarmedHolderWallets ? 'Step 3' : 'Step 2'}: Configure When They Buy
                    </label>
                    <button
                      type="button"
                      onClick={() => setHolderAutoBuyGroups([...holderAutoBuyGroups, { count: 1, delay: 0.1 }])}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
                    >
                      + Add Timing Group
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mb-3">
                    Each group buys at the same time, then waits before the next group. Groups execute in order. Set delay to 0 for instant sniping!
                  </p>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {holderAutoBuyGroups.map((group, idx) => {
                      const maxWallets = useWarmedHolderWallets ? selectedHolderAutoBuyWallets.length : selectedHolderAutoBuyIndices.length;
                      return (
                        <div key={idx} className="p-3 bg-gray-800/50 rounded border border-gray-700">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm font-semibold text-yellow-400">Group {idx + 1}:</span>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <label className="text-xs text-gray-400 whitespace-nowrap">Buy</label>
                            <input
                              type="number"
                              min="1"
                              max={maxWallets}
                              value={group.count}
                              onChange={(e) => {
                                const newGroups = [...holderAutoBuyGroups];
                                newGroups[idx].count = Math.min(parseInt(e.target.value) || 1, maxWallets);
                                setHolderAutoBuyGroups(newGroups);
                              }}
                              className="w-20 px-2 py-1 bg-black/50 border border-gray-600 rounded text-white text-xs focus:outline-none focus:ring-1 focus:ring-yellow-500"
                            />
                            <label className="text-xs text-gray-400 whitespace-nowrap">wallet(s) at the same time</label>
                            {idx === 0 && (
                              <>
                                <label className="text-xs text-gray-400 whitespace-nowrap ml-2">after</label>
                                <input
                                  type="number"
                                  step="0.1"
                                  min="0"
                                  max="10"
                                  value={group.delay}
                                  onChange={(e) => {
                                    const newGroups = [...holderAutoBuyGroups];
                                    newGroups[idx].delay = parseFloat(e.target.value) || 0;
                                    setHolderAutoBuyGroups(newGroups);
                                  }}
                                  className="w-20 px-2 py-1 bg-black/50 border border-gray-600 rounded text-white text-xs focus:outline-none focus:ring-1 focus:ring-yellow-500"
                                />
                                <label className="text-xs text-gray-400 whitespace-nowrap">seconds from launch</label>
                              </>
                            )}
                            {idx > 0 && (
                              <>
                                <label className="text-xs text-gray-400 whitespace-nowrap ml-2">then wait</label>
                                <input
                                  type="number"
                                  step="0.1"
                                  min="0"
                                  max="10"
                                  value={group.delay}
                                  onChange={(e) => {
                                    const newGroups = [...holderAutoBuyGroups];
                                    newGroups[idx].delay = parseFloat(e.target.value) || 0;
                                    setHolderAutoBuyGroups(newGroups);
                                  }}
                                  className="w-20 px-2 py-1 bg-black/50 border border-gray-600 rounded text-white text-xs focus:outline-none focus:ring-1 focus:ring-yellow-500"
                                />
                                <label className="text-xs text-gray-400 whitespace-nowrap">seconds before next group</label>
                              </>
                            )}
                          </div>
                          {holderAutoBuyGroups.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                const newGroups = holderAutoBuyGroups.filter((_, i) => i !== idx);
                                setHolderAutoBuyGroups(newGroups);
                              }}
                              className="mt-2 px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors"
                            >
                              Remove Group
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 p-3 bg-blue-900/20 border border-blue-700/50 rounded">
                    <p className="text-xs text-blue-300 font-semibold mb-1">📝 Example: 2 wallets at 0.1s, then 1 wallet at 1.0s</p>
                    <p className="text-xs text-blue-200 mb-2">
                      To have 2 wallets buy 0.1 seconds after launch, then 1 wallet 1 second after launch:
                    </p>
                    <div className="space-y-1 text-xs text-blue-200">
                      <p>• <strong>Group 1:</strong> Buy <strong>2</strong> wallet(s) after <strong>0.1</strong> seconds from launch</p>
                      <p>• <strong>Group 2:</strong> Buy <strong>1</strong> wallet(s), then wait <strong>0.9</strong> seconds</p>
                    </div>
                    <p className="text-xs text-gray-400 mt-2 italic">
                      Result: Group 1 buys at 0.1s, Group 2 buys at ~1.0s total (0.1s + 0.9s delay)
                    </p>
                  </div>
                </div>
              )}

              {/* Step 4/3: Front-Run Protection */}
              {((useWarmedHolderWallets && selectedHolderAutoBuyWallets.length > 0) || (!useWarmedHolderWallets && selectedHolderAutoBuyIndices.length > 0)) && (
                <div className="pt-4 border-t border-gray-700">
                  <label className="block text-sm font-semibold text-yellow-400 mb-2">
                    {useWarmedHolderWallets ? 'Step 4' : 'Step 3'}: Front-Run Protection (MEV Protection)
                  </label>
                  <p className="text-xs text-gray-400 mb-3">
                    Skip auto-buy if external snipers buy more than this threshold before your wallets can execute.
                    Set to 0 to disable (always buy regardless of external volume).
                  </p>
                  
                  <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
                    <div className="flex items-center gap-4 mb-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="frontRunProtectionEnabled"
                          checked={frontRunThreshold > 0}
                          onChange={async (e) => {
                            const newValue = e.target.checked ? 0.2 : 0;
                            setFrontRunThreshold(newValue);
                            // Persist to .env
                            try {
                              await apiService.updateSettings({ HOLDER_FRONT_RUN_THRESHOLD: newValue.toString() });
                            } catch (err) {
                              console.error('Failed to save front-run threshold:', err);
                            }
                          }}
                          className="w-4 h-4 text-blue-500 bg-gray-900 border-gray-600 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
                        />
                        <label htmlFor="frontRunProtectionEnabled" className="text-sm text-white cursor-pointer font-medium">
                          Enable Front-Run Protection
                        </label>
                      </div>
                    </div>
                    
                    {frontRunThreshold > 0 && (
                      <div className="flex items-center gap-3">
                        <label className="text-sm text-gray-400 whitespace-nowrap">Max external buys:</label>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="10"
                          value={frontRunThreshold}
                          onChange={async (e) => {
                            const newValue = parseFloat(e.target.value) || 0;
                            setFrontRunThreshold(newValue);
                            // Persist to .env (debounced by component re-render)
                            try {
                              await apiService.updateSettings({ HOLDER_FRONT_RUN_THRESHOLD: newValue.toString() });
                            } catch (err) {
                              console.error('Failed to save front-run threshold:', err);
                            }
                          }}
                          className="w-20 px-2 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        <label className="text-sm text-gray-400">SOL</label>
                      </div>
                    )}
                    
                    <div className="mt-3 p-3 bg-red-900/20 border border-red-700/50 rounded">
                      <p className="text-xs text-red-300 font-semibold mb-1">🛡️ How it works:</p>
                      <div className="space-y-1 text-xs text-red-200">
                        <p>• Before each auto-buy, checks how much external wallets have bought</p>
                        <p>• If external buys &gt; threshold, <strong>skips the buy</strong> to avoid front-running</p>
                        <p>• Protects you from buying at inflated prices after snipers</p>
                      </div>
                      {frontRunThreshold > 0 && (
                        <p className="text-xs text-yellow-400 mt-2 font-semibold">
                          ⚡ Current: Skip buy if external buys &gt; {frontRunThreshold} SOL
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-800 flex justify-end gap-2">
              <button
                onClick={() => setShowHolderSniperModal(false)}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Token Configuration Save/Load Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-start justify-center p-4 pt-20 overflow-y-auto">
          <div className="bg-gray-900 border border-gray-800 rounded-lg max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-800">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <ArrowDownTrayIcon className="w-5 h-5 text-blue-400" />
                  Saved Token Configurations
                </h3>
                <button
                  onClick={() => {
                    setShowConfigModal(false);
                    setConfigSaveName('');
                  }}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <XCircleIcon className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-4 overflow-y-auto flex-1">
              {/* Save New Configuration */}
              <div className="mb-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-white">Save Current Configuration</h4>
                  <button
                    onClick={exportConfigAsJSON}
                    className="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white text-xs rounded transition-colors flex items-center gap-1"
                    title="Export as JSON file"
                  >
                    <ArrowDownTrayIcon className="w-3 h-3" />
                    Export JSON
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={configSaveName}
                    onChange={(e) => setConfigSaveName(e.target.value)}
                    placeholder="Enter configuration name..."
                    className="flex-1 px-3 py-2 bg-black/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        saveTokenConfig();
                      }
                    }}
                  />
                  <button
                    onClick={saveTokenConfig}
                    disabled={!configSaveName.trim()}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                  >
                    Save
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  Saves: Token name, symbol, description, images, links, and marketing settings
                </p>
              </div>

              {/* Import JSON Configuration */}
              <div className="mb-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                <h4 className="text-sm font-semibold text-white mb-2">Import JSON Configuration</h4>
                <label className="block w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer">
                  <ArrowPathIcon className="w-4 h-4" />
                  Choose JSON File
                  <input
                    type="file"
                    accept=".json"
                    onChange={importConfigFromJSON}
                    className="hidden"
                  />
                </label>
                <p className="text-xs text-gray-400 mt-2">
                  Import a previously exported JSON configuration file
                </p>
              </div>

              {/* Load Saved Configurations */}
              <div>
                <h4 className="text-sm font-semibold text-white mb-3">Load Saved Configuration</h4>
                {loadingConfigs ? (
                  <div className="text-center py-8 text-gray-400">
                    <ArrowPathIcon className="w-8 h-8 animate-spin mx-auto mb-2" />
                    Loading configurations...
                  </div>
                ) : savedConfigs.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">
                    <p>No saved configurations yet.</p>
                    <p className="text-xs mt-2">Save a configuration above to get started!</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {savedConfigs.map((config) => (
                      <div
                        key={config.id}
                        className="p-4 bg-gray-800/50 hover:bg-gray-800 border border-gray-700 rounded-lg transition-colors"
                      >
                        <div className="flex gap-4">
                          {/* Image Preview */}
                          {config.data?.FILE && (
                            <div className="flex-shrink-0">
                              <img 
                                src={config.data.FILE} 
                                alt={config.name}
                                className="w-16 h-16 rounded-lg object-cover border border-gray-600"
                                onError={(e) => e.target.style.display = 'none'}
                              />
                            </div>
                          )}
                          
                          <div className="flex-1 min-w-0">
                            {/* Name and Symbol */}
                            <div className="flex items-center gap-2 mb-1">
                              <h5 className="font-semibold text-white truncate">{config.name}</h5>
                              {config.symbol && (
                                <span className="text-xs px-2 py-0.5 bg-blue-900/50 text-blue-300 rounded flex-shrink-0">
                                  {config.symbol}
                                </span>
                              )}
                            </div>
                            
                            {/* Links */}
                            <div className="flex flex-wrap gap-2 mb-2">
                              {config.data?.WEBSITE && (
                                <a 
                                  href={config.data.WEBSITE} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-xs px-2 py-0.5 bg-purple-900/50 text-purple-300 rounded hover:bg-purple-800/50 transition-colors"
                                >
                                  🌐 {config.data.WEBSITE.replace(/^https?:\/\//, '')}
                                </a>
                              )}
                              {config.data?.TWITTER && (
                                <a 
                                  href={config.data.TWITTER.startsWith('http') ? config.data.TWITTER : `https://twitter.com/${config.data.TWITTER}`} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-xs px-2 py-0.5 bg-sky-900/50 text-sky-300 rounded hover:bg-sky-800/50 transition-colors"
                                >
                                  🐦 Twitter
                                </a>
                              )}
                              {config.data?.TELEGRAM && (
                                <a 
                                  href={config.data.TELEGRAM.startsWith('http') ? config.data.TELEGRAM : `https://t.me/${config.data.TELEGRAM}`} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-xs px-2 py-0.5 bg-blue-900/50 text-blue-300 rounded hover:bg-blue-800/50 transition-colors"
                                >
                                  📱 Telegram
                                </a>
                              )}
                            </div>
                            
                            {/* Timestamp */}
                            <p className="text-xs text-gray-500">
                              Updated: {new Date(config.updatedAt).toLocaleString()}
                            </p>
                          </div>
                          
                          {/* Actions */}
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                              onClick={(e) => deleteTokenConfig(config.id, e)}
                              className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors"
                              title="Delete configuration"
                            >
                              <XCircleIcon className="w-5 h-5" />
                            </button>
                            <button
                              onClick={() => loadTokenConfig(config.id)}
                              className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition-colors"
                            >
                              Load
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Total SOL Required Modal */}
      {showTotalSolModal && walletInfo && walletInfo.breakdown && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-xl border-2 border-yellow-500/50 shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto my-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <CurrencyDollarIcon className="w-6 h-6 text-yellow-400" />
                  <h3 className="text-xl font-bold text-yellow-400">Total SOL Required</h3>
                </div>
                <button
                  onClick={() => setShowTotalSolModal(false)}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <XCircleIcon className="w-6 h-6" />
                </button>
              </div>
              
              <div className="mb-4 p-4 bg-gradient-to-r from-yellow-600/20 to-yellow-500/20 rounded-lg border border-yellow-500/30">
                <div className="text-center">
                  <p className="text-sm text-gray-400 mb-1">Total Amount Needed</p>
                  <p className="text-3xl font-bold text-green-400">
                    {walletInfo.breakdown.total?.toFixed(4) || '0.0000'} SOL
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-300">Bundle Wallets</span>
                    {useWarmedBundleWallets && selectedBundleWallets.length > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-green-600/30 text-green-400 rounded">PRE-FUNDED</span>
                    )}
                  </div>
                  <span className={`text-sm font-semibold ${useWarmedBundleWallets && selectedBundleWallets.length > 0 ? 'text-green-400' : 'text-gray-200'}`}>
                    {useWarmedBundleWallets && selectedBundleWallets.length > 0 
                      ? `✓ Self-funded (${walletInfo.breakdown.bundleExistingBalance?.toFixed(3) || '0'} SOL)`
                      : `${walletInfo.breakdown.bundleWallets?.toFixed(4) || '0.0000'} SOL`
                    }
                  </span>
                </div>
                <div className="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-300">Holder Wallets</span>
                    {useWarmedHolderWallets && selectedHolderWallets.length > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-green-600/30 text-green-400 rounded">PRE-FUNDED</span>
                    )}
                  </div>
                  <span className={`text-sm font-semibold ${useWarmedHolderWallets && selectedHolderWallets.length > 0 ? 'text-green-400' : 'text-gray-200'}`}>
                    {useWarmedHolderWallets && selectedHolderWallets.length > 0 
                      ? `✓ Self-funded (${walletInfo.breakdown.holderExistingBalance?.toFixed(3) || '0'} SOL)`
                      : `${walletInfo.breakdown.holderWallets?.toFixed(4) || '0.0000'} SOL`
                    }
                  </span>
                </div>
                <div className="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                  <span className="text-sm text-gray-300">Creator/DEV Funding</span>
                  <span className="text-sm font-semibold text-gray-200">{(walletInfo.breakdown?.creatorDevWalletFunding || parseFloat(settings.BUYER_AMOUNT || '1') || 0).toFixed(4)} SOL</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                  <span className="text-sm text-gray-300">Jito Fee</span>
                  <span className="text-sm font-semibold text-gray-200">{walletInfo.breakdown.jitoFee?.toFixed(4) || '0.0000'} SOL</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                  <span className="text-sm text-gray-300">LUT Creation</span>
                  <span className="text-sm font-semibold text-gray-200">{walletInfo.breakdown.lutCreation?.toFixed(4) || '0.0000'} SOL</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                  <span className="text-sm text-gray-300">Buffer</span>
                  <span className="text-sm font-semibold text-gray-200">{walletInfo.breakdown.buffer?.toFixed(4) || '0.0000'} SOL</span>
                </div>
              </div>

              <button
                onClick={() => setShowTotalSolModal(false)}
                className="w-full mt-6 px-4 py-2.5 bg-gradient-to-r from-yellow-600 to-yellow-500 hover:from-yellow-700 hover:to-yellow-600 text-white font-semibold rounded-lg transition-all shadow-lg hover:shadow-yellow-500/50"
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


