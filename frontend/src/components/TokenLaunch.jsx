import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  ExclamationTriangleIcon,
  TrashIcon,
  InformationCircleIcon,
  Cog6ToothIcon
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
import LaunchProgress from './LaunchProgress';
// AIContentGenerator removed in simplified version
import AutoSellConfig from './AutoSellConfig';

// Compact Info Tooltip Component with enhanced styling and portal for overflow escape
const InfoTooltip = ({ content, type = 'default' }) => {
  const [show, setShow] = useState(false);
  const tooltipRef = useRef(null);
  const buttonRef = useRef(null);
  
  // Color schemes based on type
  const colorSchemes = {
    default: 'text-blue-400 hover:text-blue-300',
    warning: 'text-yellow-400 hover:text-yellow-300',
    important: 'text-red-400 hover:text-red-300',
    info: 'text-cyan-400 hover:text-cyan-300'
  };
  
  const iconColor = colorSchemes[type] || colorSchemes.default;
  
  // Position tooltip dynamically to avoid overflow clipping
  useEffect(() => {
    if (show && buttonRef.current && tooltipRef.current) {
      const buttonRect = buttonRef.current.getBoundingClientRect();
      const tooltipWidth = 288; // w-72 = 18rem = 288px
      const tooltipHeight = tooltipRef.current.offsetHeight || 100; // Approximate
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      let left = buttonRect.left;
      let top = buttonRect.bottom + 4;
      
      // Check if tooltip would overflow right edge
      if (left + tooltipWidth > viewportWidth - 10) {
        // Position to the left of button instead
        left = buttonRect.right - tooltipWidth;
        if (left < 10) left = 10; // Ensure minimum margin from left edge
      }
      
      // Check if tooltip would overflow bottom edge
      if (top + tooltipHeight > viewportHeight - 10) {
        // Position above button instead
        top = buttonRect.top - tooltipHeight - 4;
        if (top < 10) top = 10; // Ensure minimum margin from top edge
      }
      
      tooltipRef.current.style.left = `${left}px`;
      tooltipRef.current.style.top = `${top}px`;
    }
  }, [show]);
  
  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow(!show)}
        className={`inline-flex items-center justify-center w-3.5 h-3.5 ${iconColor} transition-colors`}
        title="Click for info"
      >
        <QuestionMarkCircleIcon className="w-3.5 h-3.5" />
      </button>
      {show && createPortal(
        <div 
          ref={tooltipRef}
          className="fixed z-[9999] w-72 p-3 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl text-xs"
          style={{
            left: buttonRef.current ? `${buttonRef.current.getBoundingClientRect().left}px` : '0',
            top: buttonRef.current ? `${buttonRef.current.getBoundingClientRect().bottom + 4}px` : '0',
          }}
          onMouseEnter={() => setShow(true)}
          onMouseLeave={() => setShow(false)}
        >
          <div className="space-y-1.5">
            {typeof content === 'string' ? (
              <p className="text-gray-200 leading-relaxed flex items-start gap-2">
                <InformationCircleIcon className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                <span>{content}</span>
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
        </div>,
        document.body
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
  const [additionalHolderCount, setAdditionalHolderCount] = useState(0); // Additional auto-created holders when using existing
  const [additionalBundleCount, setAdditionalBundleCount] = useState(0); // Additional auto-created bundle wallets when using existing
  
  // Backward compatibility helper - true if ANY type uses warmed wallets
  const useWarmedWallets = useWarmedDevWallet || useWarmedBundleWallets || useWarmedHolderWallets;
  
  const [warmedWallets, setWarmedWallets] = useState([]);
  const [selectedBundleWallets, setSelectedBundleWallets] = useState([]);
  const [selectedHolderWallets, setSelectedHolderWallets] = useState([]);
  const [selectedHolderAutoBuyWallets, setSelectedHolderAutoBuyWallets] = useState([]);
  const [selectedHolderAutoBuyIndices, setSelectedHolderAutoBuyIndices] = useState([]); // For fresh wallets: store indices instead of addresses
  const [holderAutoBuyGroups, setHolderAutoBuyGroups] = useState([{ count: 1, delay: 0.1 }]); // Legacy - kept for compatibility
  // Per-wallet auto-buy configuration: { walletId: { delay: number, safetyThreshold: number } }
  const [holderAutoBuyConfigs, setHolderAutoBuyConfigs] = useState({}); // walletId -> { delay, safetyThreshold }
  // Per-wallet auto-sell configuration: { walletId: { threshold: number, enabled: boolean } }
  const [holderAutoSellConfigs, setHolderAutoSellConfigs] = useState({}); // walletId -> { threshold, enabled }
  const [bundleAutoSellConfigs, setBundleAutoSellConfigs] = useState({}); // bundle walletId -> { threshold, enabled }
  const [devAutoSellConfig, setDevAutoSellConfig] = useState({ threshold: '', enabled: false }); // DEV wallet auto-sell
  const [mevProtectionEnabled, setMevProtectionEnabled] = useState(true); // Global MEV protection toggle
  const [mevConfirmationDelay, setMevConfirmationDelay] = useState(3); // Seconds to wait before confirming sell
  const [frontRunThreshold, setFrontRunThreshold] = useState(0); // Global fallback threshold (0 = disabled)
  const [selectedCreatorWallet, setSelectedCreatorWallet] = useState(null);
  const [showAdvancedWalletSettings, setShowAdvancedWalletSettings] = useState(false);
  
  // Mixed Mode: Track holder wallet types (warmed or fresh) per position
  const [useMixedHolderMode, setUseMixedHolderMode] = useState(false);
  const [holderWalletTypes, setHolderWalletTypes] = useState([]); // Array of {type: 'warmed'|'fresh', address?: string}
  const [loadingWarmedWallets, setLoadingWarmedWallets] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [walletModalMode, setWalletModalMode] = useState('all'); // 'dev', 'bundle', 'holder', or 'all'
  // Filter and sort state for wallet modal
  const [searchQuery, setSearchQuery] = useState('');
  // Token configuration save/load state
  const [savedConfigs, setSavedConfigs] = useState([]);
  const [loadingConfigs, setLoadingConfigs] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [configSaveName, setConfigSaveName] = useState('');
  
  // Wallet profile save/load state
  const [walletProfiles, setWalletProfiles] = useState([]);
  const [loadingWalletProfiles, setLoadingWalletProfiles] = useState(false);
  const [walletProfileSaveName, setWalletProfileSaveName] = useState('');
  const [walletProfileDescription, setWalletProfileDescription] = useState('');
  const [selectedWalletProfileId, setSelectedWalletProfileId] = useState(null);
  const [configModalTab, setConfigModalTab] = useState('token'); // 'token' or 'wallet'
  const [tagFilter, setTagFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('solBalance'); // Default to SOL balance (highest first)
  const [sortOrder, setSortOrder] = useState('desc');
  const [walletConfigExpanded, setWalletConfigExpanded] = useState(true);
  const [showHolderSniperModal, setShowHolderSniperModal] = useState(false);
  const [showTotalSolModal, setShowTotalSolModal] = useState(false);
  const [walletKeysExpanded, setWalletKeysExpanded] = useState(false);
  const [privacyRoutingExpanded, setPrivacyRoutingExpanded] = useState(false);
  const [walletSourceExpanded, setWalletSourceExpanded] = useState(true);
  const [bundleWalletsExpanded, setBundleWalletsExpanded] = useState(false);
  const [holderWalletsExpanded, setHolderWalletsExpanded] = useState(false);
  const [devBuyExpanded, setDevBuyExpanded] = useState(false);
  
  // Launch modes:
  // - 'rapid': simple create + dev buy (no Jito)
  // - 'bundle': Jito bundle + LUT (bundle + holders)
  const [launchMode, setLaunchMode] = useState('bundle');
  
  // Vanity generator state
  const [vanityAddressPool, setVanityAddressPool] = useState({ available: 0, total: 0, generating: false, checked: 0 });
  const [showVanityGenerator, setShowVanityGenerator] = useState(false);
  const [vanityGeneratorStatus, setVanityGeneratorStatus] = useState(null);
  
  // Address mode: 'vanity' (use pump address pool) or 'random' (generate fresh)
  // Load from localStorage or default to 'vanity'
  const [addressMode, setAddressMode] = useState(() => {
    const saved = localStorage.getItem('tokenLaunchAddressMode');
    return saved || 'vanity';
  });
  
  // Toast notifications
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  
  // Show toast notification
  const showToast = (message, type = 'success') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  useEffect(() => {
    loadSettings();
    loadNextAddress();
    loadDeployerWallet();
    loadWalletInfo();
    loadWarmedWallets();
    loadVanityAddressPool();
    loadWalletProfiles(); // Load wallet profiles on mount
    
    // Load MEV protection settings
    apiService.getMevProtection?.().then(res => {
      if (res?.data?.mevProtection) {
        setMevProtectionEnabled(res.data.mevProtection.enabled !== false);
        setMevConfirmationDelay(res.data.mevProtection.confirmationDelaySec || 3);
      }
    }).catch(() => {
      // Fallback to env settings or defaults - will be loaded via loadSettings
    });
    
    // Poll vanity pool status every 30 seconds when generator might be running
    const vanityPollInterval = setInterval(() => {
      loadVanityAddressPool();
    }, 30000);
    
    // Cleanup: Close launch progress event source on unmount
    return () => {
      if (launchProgressEventSourceRef.current) {
        launchProgressEventSourceRef.current.close();
        launchProgressEventSourceRef.current = null;
      }
      clearInterval(vanityPollInterval);
    };
  }, []);

  // When address mode changes, load appropriate address and update env var
  useEffect(() => {
    // Persist to localStorage
    localStorage.setItem('tokenLaunchAddressMode', addressMode);
    
    // Update VANITY_MODE env var
    const updateVanityMode = async () => {
      try {
        const vanityModeValue = addressMode === 'vanity' ? 'true' : 'false';
        await apiService.updateSettings({ VANITY_MODE: vanityModeValue });
        console.log(`[TokenLaunch] Updated VANITY_MODE to ${vanityModeValue}`);
      } catch (error) {
        console.error('[TokenLaunch] Failed to update VANITY_MODE:', error);
      }
    };
    updateVanityMode();
    
    // Load appropriate address
    if (addressMode === 'random') {
      // Generate a random address preview
      generateRandomAddressPreview();
    } else {
      // Load vanity address from pool
      loadNextAddress();
    }
  }, [addressMode]);

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

  // CRITICAL: Validate and restore wallet selections once warmed wallets are loaded
  // This fixes the race condition where selections are restored before warmedWallets is populated
  // Works for both localStorage restoration and profile loading
  useEffect(() => {
    if (warmedWallets.length === 0) return; // Wait for warmed wallets to load
    
    // Get saved wallet selections from localStorage (if any)
    try {
      const savedConfig = localStorage.getItem('walletLaunchConfig');
      if (savedConfig) {
        const config = JSON.parse(savedConfig);
        if (config._walletConfig) {
          const wc = config._walletConfig;
          
          // Validate and restore bundle wallets if they exist in warmedWallets
          if (Array.isArray(wc.selectedBundleWallets) && wc.selectedBundleWallets.length > 0) {
            const currentWarmedWalletsLower = new Set(warmedWallets.map(w => w.address.toLowerCase()));
            const validBundleWallets = wc.selectedBundleWallets.filter(addr => 
              currentWarmedWalletsLower.has(addr.toLowerCase())
            );
            if (validBundleWallets.length > 0 && JSON.stringify(validBundleWallets.sort()) !== JSON.stringify(selectedBundleWallets.sort())) {
              console.log('[WalletRestore] Restoring bundle wallets from localStorage:', validBundleWallets.length);
              setSelectedBundleWallets(validBundleWallets);
            }
          }
          
          // Validate and restore holder wallets if they exist in warmedWallets
          if (Array.isArray(wc.selectedHolderWallets) && wc.selectedHolderWallets.length > 0) {
            const currentWarmedWalletsLower = new Set(warmedWallets.map(w => w.address.toLowerCase()));
            const validHolderWallets = wc.selectedHolderWallets.filter(addr => 
              currentWarmedWalletsLower.has(addr.toLowerCase())
            );
            if (validHolderWallets.length > 0 && JSON.stringify(validHolderWallets.sort()) !== JSON.stringify(selectedHolderWallets.sort())) {
              console.log('[WalletRestore] Restoring holder wallets from localStorage:', validHolderWallets.length);
              setSelectedHolderWallets(validHolderWallets);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[WalletRestore] Failed to restore from localStorage:', e);
    }
  }, [warmedWallets.length]); // Run when warmedWallets loads

  // Track if we're currently loading a profile (to prevent auto-save during load)
  const isLoadingProfileRef = useRef(false);
  // Track if we're restoring amounts from profile (to prevent sync logic from overwriting)
  const isRestoringAmountsRef = useRef(false);

  // AUTO-SAVE: Automatically save wallet selections to loaded wallet profile when they change
  useEffect(() => {
    // Only auto-save if a wallet profile is currently loaded
    if (!selectedWalletProfileId) return;
    
    // Don't auto-save if we're currently loading a profile
    if (isLoadingProfileRef.current) return;
    
    // Debounce auto-save to avoid too many API calls
    const timeoutId = setTimeout(async () => {
      try {
        // Get current wallet profile
        const res = await apiService.getWalletProfile(selectedWalletProfileId);
        const profile = res.data.profile;
        const profileName = walletProfiles.find(p => p.id === selectedWalletProfileId)?.name || profile.name || 'Profile';
        
        // Update wallet selections AND buy amounts in the profile
        const updatedProfile = {
          ...profile,
          // Update buy amounts from current settings
          bundleSwapAmounts: settings.BUNDLE_SWAP_AMOUNTS || '',
          holderSwapAmounts: settings.HOLDER_SWAP_AMOUNTS || '',
          swapAmount: settings.SWAP_AMOUNT || '0.01',
          holderWalletAmount: settings.HOLDER_WALLET_AMOUNT || '0.10',
          walletSourceConfig: {
            ...profile.walletSourceConfig,
            selectedCreatorWallet: selectedCreatorWallet || null,
            selectedBundleWallets: selectedBundleWallets || [],
            selectedHolderWallets: selectedHolderWallets || [],
          },
        };
        
        // Save updated profile (silently - don't show toast for auto-saves)
        await apiService.updateWalletProfile(selectedWalletProfileId, profileName, updatedProfile);
        console.log('[AutoSave] ✅ Wallet selections auto-saved to profile:', profileName);
      } catch (error) {
        // Silently fail - don't spam user with errors for auto-saves
        console.warn('[AutoSave] ⚠️ Failed to auto-save wallet selections:', error);
      }
    }, 2000); // Wait 2 seconds after last change before saving
    
    return () => clearTimeout(timeoutId);
  }, [selectedWalletProfileId, selectedBundleWallets, selectedHolderWallets, selectedCreatorWallet, walletProfiles]);

  // Sync amounts with warmed wallet selections - ONLY for the specific type that's set to warmed
  useEffect(() => {
    // Don't sync if we're currently restoring amounts from a profile
    if (isRestoringAmountsRef.current) return;
    
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
    // Don't sync if we're currently restoring amounts from a profile
    if (isRestoringAmountsRef.current) return;
    
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
      
      // Ensure Direct LUT is default if no privacy routing is explicitly set
      if (loadedSettings.DIRECT_SEND_MODE === undefined && 
          loadedSettings.USE_MIXING_WALLETS === undefined && 
          loadedSettings.USE_MULTI_INTERMEDIARY_SYSTEM === undefined) {
        // Default to Direct LUT mode
        loadedSettings.DIRECT_SEND_MODE = 'true';
        loadedSettings.USE_MIXING_WALLETS = 'false';
        loadedSettings.USE_MULTI_INTERMEDIARY_SYSTEM = 'false';
      }
      
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
      
      // Sync addressMode with VANITY_MODE from settings (only on initial load)
      // Priority: localStorage > env value
      if (loadedSettings.VANITY_MODE !== undefined) {
        const vanityModeFromEnv = loadedSettings.VANITY_MODE === 'true' || loadedSettings.VANITY_MODE === true;
        const modeFromEnv = vanityModeFromEnv ? 'vanity' : 'random';
        const savedMode = localStorage.getItem('tokenLaunchAddressMode');
        // Use saved preference if exists, otherwise use env value
        const finalMode = savedMode || modeFromEnv;
        // Only update if different to avoid unnecessary re-renders
        const currentMode = localStorage.getItem('tokenLaunchAddressMode') || modeFromEnv;
        if (finalMode !== currentMode) {
          setAddressMode(finalMode);
        }
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
      // Token Profile: ONLY save token info + reference to wallet profile
      // Wallet settings are stored separately in Wallet Profiles
      const configToSave = {
        // Token Info (main content of token profiles)
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
        
        // Marketing/theme settings
        WEBSITE_THEME: settings.WEBSITE_THEME || '',
        WEBSITE_CUSTOM_COLOR: settings.WEBSITE_CUSTOM_COLOR || '',
        WEBSITE_CHAIN: settings.WEBSITE_CHAIN || '',
        
        // === WALLET PROFILE REFERENCE ===
        // Instead of duplicating all wallet settings, just store which profile was used
        _walletProfileId: selectedWalletProfileId || null,
        _walletProfileName: selectedWalletProfileId 
          ? walletProfiles.find(p => p.id === selectedWalletProfileId)?.name || null
          : null,
        
        // Note: We don't save PRIVATE_KEY or BUYER_WALLET for security
      };

      await apiService.saveTokenConfig(configSaveName.trim(), configToSave);
      setConfigSaveName('');
      setShowConfigModal(false);
      await loadSavedConfigs();
      
      const walletProfileNote = selectedWalletProfileId 
        ? `\nWallet Profile: ${configToSave._walletProfileName}`
        : '\n[!] No wallet profile linked (current settings won\'t be saved)';
      showToast(`Token profile saved!${walletProfileNote}`, 'success');
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
      
      // Update settings with saved config (excluding special wallet/sniper configs and wallet profile ref)
      const updatedSettings = { ...settings };
      Object.keys(config).forEach(key => {
        if (key !== 'id' && key !== 'name' && key !== 'createdAt' && key !== 'updatedAt' && 
            key !== '_walletConfig' && key !== '_sniperConfig' && 
            key !== '_walletProfileId' && key !== '_walletProfileName') {
          updatedSettings[key] = config[key];
        }
      });
      
      setSettings(updatedSettings);
      
      // === LOAD LINKED WALLET PROFILE (NEW FORMAT) ===
      if (config._walletProfileId) {
        try {
          await loadWalletProfile(config._walletProfileId);
          console.log(`[Config] [ok] Loaded linked wallet profile: ${config._walletProfileName}`);
        } catch (wpError) {
          console.warn(`[Config] [!] Could not load wallet profile ${config._walletProfileId}:`, wpError.message);
          showToast(`Wallet profile "${config._walletProfileName}" not found - using current settings`, 'warning');
        }
      }
      
      // === RESTORE IMAGE PREVIEWS ===
      // Restore token image preview from FILE path
      if (updatedSettings.FILE) {
        const filePath = updatedSettings.FILE;
        if (filePath.startsWith('./image/') || filePath.startsWith('image/')) {
          const filename = filePath.replace(/^\.\/image\//, '').replace(/^image\//, '');
          setImagePreview(`http://localhost:3001/image/${filename}`);
        } else if (filePath.startsWith('http')) {
          setImagePreview(filePath);
        }
      } else {
        setImagePreview(null);
      }
      
      // Restore website logo preview from WEBSITE_LOGO path
      if (updatedSettings.WEBSITE_LOGO) {
        const logoPath = updatedSettings.WEBSITE_LOGO;
        if (logoPath.startsWith('./image/') || logoPath.startsWith('image/')) {
          const filename = logoPath.replace(/^\.\/image\//, '').replace(/^image\//, '');
          setWebsiteLogoPreview(`http://localhost:3001/image/${filename}`);
        } else if (logoPath.startsWith('http')) {
          setWebsiteLogoPreview(logoPath);
        }
      } else {
        setWebsiteLogoPreview(null);
      }
      
      // Clear file inputs since we're loading from saved path
      setImageFile(null);
      setWebsiteLogoFile(null);
      
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
        // Load new per-wallet configs
        if (sc.holderAutoBuyConfigs && typeof sc.holderAutoBuyConfigs === 'object') {
          setHolderAutoBuyConfigs(sc.holderAutoBuyConfigs);
        }
        if (sc.holderAutoSellConfigs && typeof sc.holderAutoSellConfigs === 'object') {
          setHolderAutoSellConfigs(sc.holderAutoSellConfigs);
        }
        if (sc.bundleAutoSellConfigs && typeof sc.bundleAutoSellConfigs === 'object') {
          setBundleAutoSellConfigs(sc.bundleAutoSellConfigs);
        }
        if (typeof sc.frontRunThreshold === 'number') {
          setFrontRunThreshold(sc.frontRunThreshold);
        }
      }
      
      // NOTE: Don't save to .env here - just load into UI state
      // Settings will be saved to .env when launch button is pressed
      // This makes loading instant without terminal spam
      
      setShowConfigModal(false);
      showToast(`Loaded: ${config.TOKEN_NAME || 'Token config'}`, 'success');
      console.log('[Config] [ok] Loaded config:', configId);
    } catch (error) {
      console.error('Failed to load config:', error);
      showToast('Failed to load configuration', 'error');
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
      alert('[ok] Configuration deleted successfully!');
    } catch (error) {
      console.error('Failed to delete config:', error);
      alert('Failed to delete configuration: ' + (error.response?.data?.error || error.message));
    }
  };

  // =============================================
  // WALLET PROFILES - Separate from Token Configs
  // =============================================
  
  // Load saved wallet profiles
  const loadWalletProfiles = async () => {
    try {
      setLoadingWalletProfiles(true);
      const res = await apiService.getWalletProfiles();
      setWalletProfiles(res.data.profiles || []);
    } catch (error) {
      console.error('Failed to load wallet profiles:', error);
    } finally {
      setLoadingWalletProfiles(false);
    }
  };
  
  // Save current wallet settings as a profile
  const saveWalletProfile = async () => {
    if (!walletProfileSaveName.trim()) {
      alert('Please enter a name for this wallet profile');
      return;
    }

    try {
      const profileToSave = {
        description: walletProfileDescription || '',
        
        // DEV/Creator buy amount
        buyerAmount: settings.BUYER_AMOUNT || '0',
        
        // Bundle wallet settings
        bundleWalletCount: parseInt(settings.BUNDLE_WALLET_COUNT || '0'),
        bundleSwapAmounts: settings.BUNDLE_SWAP_AMOUNTS || '',
        swapAmount: settings.SWAP_AMOUNT || '0.01',
        useNormalLaunch: settings.USE_NORMAL_LAUNCH === 'true',
        bundleIntermediaryHops: parseInt(settings.BUNDLE_INTERMEDIARY_HOPS || '2'),
        
        // Holder wallet settings
        holderWalletCount: parseInt(settings.HOLDER_WALLET_COUNT || '0'),
        holderSwapAmounts: settings.HOLDER_SWAP_AMOUNTS || '',
        holderWalletAmount: settings.HOLDER_WALLET_AMOUNT || '0.10',
        autoHolderWalletBuy: settings.AUTO_HOLDER_WALLET_BUY === 'true',
        holderIntermediaryHops: parseInt(settings.HOLDER_INTERMEDIARY_HOPS || '2'),
        
        // Privacy/mixing settings
        useMixingWallets: settings.USE_MIXING_WALLETS !== 'false',
        useMultiIntermediarySystem: settings.USE_MULTI_INTERMEDIARY_SYSTEM === 'true',
        numIntermediaryHops: parseInt(settings.NUM_INTERMEDIARY_HOPS || '2'),
        
        // Wallet source preferences
        walletSourceConfig: {
          useWarmedDevWallet,
          useWarmedBundleWallets,
          useWarmedHolderWallets,
          // Selected wallet addresses (ALWAYS save - don't condition on flags)
          // This ensures wallet selections persist even if user toggles flags later
          selectedCreatorWallet: selectedCreatorWallet || null,
          selectedBundleWallets: selectedBundleWallets || [],
          selectedHolderWallets: selectedHolderWallets || [],
        },
        
        // Sniper/front-run settings
        sniperConfig: {
          frontRunThreshold,
          holderAutoBuyGroups, // Legacy
          holderAutoBuyConfigs, // New per-wallet auto-buy configs
          holderAutoSellConfigs, // New per-wallet auto-sell configs
          bundleAutoSellConfigs, // Bundle wallet auto-sell configs
        },
        
        // MEV Protection settings (complete)
        mevProtection: {
          enabled: mevProtectionEnabled,
          confirmationDelaySec: mevConfirmationDelay,
          launchCooldownSec: settings.AUTO_SELL_MEV_LAUNCH_COOLDOWN ? parseFloat(settings.AUTO_SELL_MEV_LAUNCH_COOLDOWN) : 5,
          rapidTraderWindowSec: settings.AUTO_SELL_MEV_RAPID_WINDOW ? parseFloat(settings.AUTO_SELL_MEV_RAPID_WINDOW) : 10,
        },
        
        // Auto-sell global settings
        autoSellGlobal: {
          enabled: settings.AUTO_SELL_ENABLED === 'true',
          defaultThreshold: settings.AUTO_SELL_DEFAULT_THRESHOLD ? parseFloat(settings.AUTO_SELL_DEFAULT_THRESHOLD) : 1.0,
        },
        
        // DEV wallet auto-sell
        devAutoSellConfig: devAutoSellConfig,
      };

      await apiService.saveWalletProfile(walletProfileSaveName.trim(), profileToSave);
      setWalletProfileSaveName('');
      setWalletProfileDescription('');
      await loadWalletProfiles();
      showToast('[ok] Wallet profile saved!', 'success');
    } catch (error) {
      console.error('Failed to save wallet profile:', error);
      alert('Failed to save wallet profile: ' + (error.response?.data?.error || error.message));
    }
  };
  
  // Load a wallet profile and apply settings
  const loadWalletProfile = async (profileId) => {
    try {
      // Set loading flag to prevent auto-save during load
      isLoadingProfileRef.current = true;
      
      const res = await apiService.getWalletProfile(profileId);
      const profile = res.data.profile;
      
      // Apply wallet settings
      const newSettings = { ...settings };
      
      // DEV buy
      if (profile.buyerAmount !== undefined) {
        newSettings.BUYER_AMOUNT = profile.buyerAmount.toString();
      }
      
      // Bundle wallets
      if (profile.bundleWalletCount !== undefined) {
        newSettings.BUNDLE_WALLET_COUNT = profile.bundleWalletCount.toString();
      }
      if (profile.bundleSwapAmounts !== undefined) {
        newSettings.BUNDLE_SWAP_AMOUNTS = profile.bundleSwapAmounts;
      }
      if (profile.swapAmount !== undefined) {
        newSettings.SWAP_AMOUNT = profile.swapAmount.toString();
      }
      if (profile.useNormalLaunch !== undefined) {
        newSettings.USE_NORMAL_LAUNCH = profile.useNormalLaunch ? 'true' : 'false';
      }
      if (profile.bundleIntermediaryHops !== undefined) {
        newSettings.BUNDLE_INTERMEDIARY_HOPS = profile.bundleIntermediaryHops.toString();
      }
      
      // Holder wallets
      if (profile.holderWalletCount !== undefined) {
        newSettings.HOLDER_WALLET_COUNT = profile.holderWalletCount.toString();
      }
      if (profile.holderSwapAmounts !== undefined) {
        newSettings.HOLDER_SWAP_AMOUNTS = profile.holderSwapAmounts;
      }
      if (profile.holderWalletAmount !== undefined) {
        newSettings.HOLDER_WALLET_AMOUNT = profile.holderWalletAmount.toString();
      }
      if (profile.autoHolderWalletBuy !== undefined) {
        newSettings.AUTO_HOLDER_WALLET_BUY = profile.autoHolderWalletBuy ? 'true' : 'false';
      }
      if (profile.holderIntermediaryHops !== undefined) {
        newSettings.HOLDER_INTERMEDIARY_HOPS = profile.holderIntermediaryHops.toString();
      }
      
      // Privacy settings
      if (profile.useMixingWallets !== undefined) {
        newSettings.USE_MIXING_WALLETS = profile.useMixingWallets ? 'true' : 'false';
      }
      if (profile.useMultiIntermediarySystem !== undefined) {
        newSettings.USE_MULTI_INTERMEDIARY_SYSTEM = profile.useMultiIntermediarySystem ? 'true' : 'false';
      }
      if (profile.numIntermediaryHops !== undefined) {
        newSettings.NUM_INTERMEDIARY_HOPS = profile.numIntermediaryHops.toString();
      }
      
      // CRITICAL: Don't set settings yet - we'll set them AFTER restoring wallet selections
      // This prevents the sync logic from overwriting restored amounts with defaults
      const pendingSettings = { ...newSettings };
      
      // Apply wallet source config
      if (profile.walletSourceConfig) {
        if (profile.walletSourceConfig.useWarmedDevWallet !== undefined) {
          setUseWarmedDevWallet(profile.walletSourceConfig.useWarmedDevWallet);
        }
        if (profile.walletSourceConfig.useWarmedBundleWallets !== undefined) {
          setUseWarmedBundleWallets(profile.walletSourceConfig.useWarmedBundleWallets);
        }
        if (profile.walletSourceConfig.useWarmedHolderWallets !== undefined) {
          setUseWarmedHolderWallets(profile.walletSourceConfig.useWarmedHolderWallets);
        }
        
        // CRITICAL: Load warmed wallets FIRST before trying to restore selections
        // This ensures warmedWallets is populated before we check if saved wallets exist
        await loadWarmedWallets();
        
        // Restore selected wallet addresses (ALWAYS restore, even if flags are false)
        // This ensures selections persist and are ready if user toggles flags back on
        // Now warmedWallets should be loaded
        const currentWarmedWallets = warmedWallets.map(w => w.address);
        const currentWarmedWalletsLower = new Set(currentWarmedWallets.map(addr => addr.toLowerCase()));
        
        let missingWallets = [];
        
        // Restore creator wallet (always restore if saved)
        if (profile.walletSourceConfig.selectedCreatorWallet) {
          // Check if the wallet still exists (case-insensitive)
          const walletLower = profile.walletSourceConfig.selectedCreatorWallet.toLowerCase();
          if (currentWarmedWalletsLower.has(walletLower)) {
            // Find the exact address (preserve casing)
            const exactAddress = currentWarmedWallets.find(addr => addr.toLowerCase() === walletLower);
            setSelectedCreatorWallet(exactAddress || profile.walletSourceConfig.selectedCreatorWallet);
          } else {
            missingWallets.push(`DEV: ${profile.walletSourceConfig.selectedCreatorWallet.slice(0,8)}...`);
            setSelectedCreatorWallet(null);
            // FALLBACK: Try to find a similar wallet (same type)
            const devWallets = warmedWallets.filter(w => w.type === 'DEV' || w.type === 'dev');
            if (devWallets.length > 0) {
              console.warn(`[WalletProfile] DEV wallet not found. FALLBACK: Using first available DEV wallet: ${devWallets[0].address.slice(0,8)}...`);
              setSelectedCreatorWallet(devWallets[0].address);
            }
          }
        }
        
        // Restore bundle wallets (always restore if saved, regardless of flag)
        if (Array.isArray(profile.walletSourceConfig.selectedBundleWallets) && profile.walletSourceConfig.selectedBundleWallets.length > 0) {
          // Filter to only wallets that still exist (case-insensitive)
          const validBundleWallets = [];
          for (const savedAddr of profile.walletSourceConfig.selectedBundleWallets) {
            const savedAddrLower = savedAddr.toLowerCase();
            if (currentWarmedWalletsLower.has(savedAddrLower)) {
              // Find exact address (preserve casing)
              const exactAddress = currentWarmedWallets.find(addr => addr.toLowerCase() === savedAddrLower);
              validBundleWallets.push(exactAddress || savedAddr);
            } else {
              missingWallets.push(`Bundle: ${savedAddr.slice(0,8)}...`);
            }
          }
          const removedCount = profile.walletSourceConfig.selectedBundleWallets.length - validBundleWallets.length;
          if (removedCount > 0) {
            console.warn(`[WalletProfile] ${removedCount} bundle wallet(s) no longer exist`);
            // FALLBACK: If we lost wallets, try to add similar ones
            if (validBundleWallets.length < profile.walletSourceConfig.selectedBundleWallets.length) {
              const bundleWallets = warmedWallets.filter(w => (w.type === 'Bundle' || w.type === 'bundle') && !validBundleWallets.includes(w.address));
              const needed = profile.walletSourceConfig.selectedBundleWallets.length - validBundleWallets.length;
              const fallbackWallets = bundleWallets.slice(0, needed);
              if (fallbackWallets.length > 0) {
                console.warn(`[WalletProfile] FALLBACK: Adding ${fallbackWallets.length} available bundle wallet(s) to replace missing ones`);
                validBundleWallets.push(...fallbackWallets.map(w => w.address));
              }
            }
          }
          // ALWAYS restore bundle wallets if they were saved (even if flag is false)
          setSelectedBundleWallets(validBundleWallets);
        }
        
        // Restore holder wallets (always restore if saved, regardless of flag)
        if (Array.isArray(profile.walletSourceConfig.selectedHolderWallets) && profile.walletSourceConfig.selectedHolderWallets.length > 0) {
          // Filter to only wallets that still exist (case-insensitive)
          const validHolderWallets = [];
          for (const savedAddr of profile.walletSourceConfig.selectedHolderWallets) {
            const savedAddrLower = savedAddr.toLowerCase();
            if (currentWarmedWalletsLower.has(savedAddrLower)) {
              // Find exact address (preserve casing)
              const exactAddress = currentWarmedWallets.find(addr => addr.toLowerCase() === savedAddrLower);
              validHolderWallets.push(exactAddress || savedAddr);
            } else {
              missingWallets.push(`Holder: ${savedAddr.slice(0,8)}...`);
            }
          }
          const removedCount = profile.walletSourceConfig.selectedHolderWallets.length - validHolderWallets.length;
          if (removedCount > 0) {
            console.warn(`[WalletProfile] ${removedCount} holder wallet(s) no longer exist`);
            // FALLBACK: If we lost wallets, try to add similar ones
            if (validHolderWallets.length < profile.walletSourceConfig.selectedHolderWallets.length) {
              const holderWallets = warmedWallets.filter(w => (w.type === 'Holder' || w.type === 'holder') && !validHolderWallets.includes(w.address));
              const needed = profile.walletSourceConfig.selectedHolderWallets.length - validHolderWallets.length;
              const fallbackWallets = holderWallets.slice(0, needed);
              if (fallbackWallets.length > 0) {
                console.warn(`[WalletProfile] FALLBACK: Adding ${fallbackWallets.length} available holder wallet(s) to replace missing ones`);
                validHolderWallets.push(...fallbackWallets.map(w => w.address));
              }
            }
          }
          // ALWAYS restore holder wallets if they were saved (even if flag is false)
          setSelectedHolderWallets(validHolderWallets);
        }
        
        // Show warning if wallets were missing
        if (missingWallets.length > 0) {
          const warningMsg = `⚠️ ${missingWallets.length} wallet(s) from profile no longer exist:\n${missingWallets.slice(0, 5).join('\n')}${missingWallets.length > 5 ? `\n...and ${missingWallets.length - 5} more` : ''}\n\nFallback wallets were selected where possible.`;
          setTimeout(() => showToast(warningMsg, 'warning'), 500);
        }
      }
      
      // CRITICAL: Apply settings AFTER wallet selections are restored
      // This prevents sync logic from overwriting restored buy amounts with defaults
      isRestoringAmountsRef.current = true; // Disable sync logic during restore
      setSettings(pendingSettings);
      // Re-enable sync logic after a delay (allows state to settle)
      setTimeout(() => {
        isRestoringAmountsRef.current = false;
      }, 2000);
      
      // Apply MEV Protection settings
      if (profile.mevProtection) {
        setMevProtectionEnabled(profile.mevProtection.enabled !== false);
        if (profile.mevProtection.confirmationDelaySec !== undefined) {
          setMevConfirmationDelay(profile.mevProtection.confirmationDelaySec);
        }
        // Update .env settings for MEV
        const mevSettings = { ...settings };
        if (profile.mevProtection.launchCooldownSec !== undefined) {
          mevSettings.AUTO_SELL_MEV_LAUNCH_COOLDOWN = profile.mevProtection.launchCooldownSec.toString();
        }
        if (profile.mevProtection.rapidTraderWindowSec !== undefined) {
          mevSettings.AUTO_SELL_MEV_RAPID_WINDOW = profile.mevProtection.rapidTraderWindowSec.toString();
        }
        if (profile.mevProtection.enabled !== undefined) {
          mevSettings.AUTO_SELL_MEV_ENABLED = profile.mevProtection.enabled.toString();
        }
        setSettings(mevSettings);
      }
      
      // Apply auto-sell global settings
      if (profile.autoSellGlobal) {
        const autoSellSettings = { ...settings };
        if (profile.autoSellGlobal.enabled !== undefined) {
          autoSellSettings.AUTO_SELL_ENABLED = profile.autoSellGlobal.enabled.toString();
        }
        if (profile.autoSellGlobal.defaultThreshold !== undefined) {
          autoSellSettings.AUTO_SELL_DEFAULT_THRESHOLD = profile.autoSellGlobal.defaultThreshold.toString();
        }
        setSettings(autoSellSettings);
      }
      
      // Apply DEV wallet auto-sell
      if (profile.devAutoSellConfig) {
        setDevAutoSellConfig(profile.devAutoSellConfig);
      }
      
      // Apply sniper config
      if (profile.sniperConfig) {
        if (profile.sniperConfig.frontRunThreshold !== undefined) {
          setFrontRunThreshold(profile.sniperConfig.frontRunThreshold);
        }
        if (Array.isArray(profile.sniperConfig.holderAutoBuyGroups)) {
          setHolderAutoBuyGroups(profile.sniperConfig.holderAutoBuyGroups);
        }
        
        // Load per-wallet configs - be lenient and accept all wallet IDs
        // Wallet IDs will be mapped correctly during launch (addresses for warmed, indices for fresh)
        // We only filter out obviously invalid IDs (empty, null, etc.)
        
        // Load holder auto-buy configs
        if (profile.sniperConfig.holderAutoBuyConfigs && typeof profile.sniperConfig.holderAutoBuyConfigs === 'object') {
          const validAutoBuyConfigs = {};
          let removedAutoBuyCount = 0;
          for (const [walletId, config] of Object.entries(profile.sniperConfig.holderAutoBuyConfigs)) {
            // Accept any non-empty wallet ID (address, index, or string ID)
            // The launch process will map them correctly
            if (walletId && walletId.toString().trim() !== '') {
              validAutoBuyConfigs[walletId] = config;
            } else {
              removedAutoBuyCount++;
              console.warn(`[WalletProfile] Removed auto-buy config for invalid wallet ID: ${walletId}`);
            }
          }
          if (removedAutoBuyCount > 0) {
            console.warn(`[WalletProfile] Removed ${removedAutoBuyCount} auto-buy config(s) for invalid wallet IDs`);
          }
          if (Object.keys(validAutoBuyConfigs).length > 0) {
            console.log(`[WalletProfile] ✅ Loaded ${Object.keys(validAutoBuyConfigs).length} holder auto-buy config(s)`);
          }
          setHolderAutoBuyConfigs(validAutoBuyConfigs);
        }
        
        // Load holder auto-sell configs
        if (profile.sniperConfig.holderAutoSellConfigs && typeof profile.sniperConfig.holderAutoSellConfigs === 'object') {
          const validHolderAutoSellConfigs = {};
          let removedHolderAutoSellCount = 0;
          for (const [walletId, config] of Object.entries(profile.sniperConfig.holderAutoSellConfigs)) {
            if (walletId && walletId.toString().trim() !== '') {
              validHolderAutoSellConfigs[walletId] = config;
            } else {
              removedHolderAutoSellCount++;
              console.warn(`[WalletProfile] Removed holder auto-sell config for invalid wallet ID: ${walletId}`);
            }
          }
          if (removedHolderAutoSellCount > 0) {
            console.warn(`[WalletProfile] Removed ${removedHolderAutoSellCount} holder auto-sell config(s) for invalid wallet IDs`);
          }
          if (Object.keys(validHolderAutoSellConfigs).length > 0) {
            console.log(`[WalletProfile] ✅ Loaded ${Object.keys(validHolderAutoSellConfigs).length} holder auto-sell config(s)`);
          }
          setHolderAutoSellConfigs(validHolderAutoSellConfigs);
        }
        
        // Load bundle auto-sell configs
        if (profile.sniperConfig.bundleAutoSellConfigs && typeof profile.sniperConfig.bundleAutoSellConfigs === 'object') {
          const validBundleAutoSellConfigs = {};
          let removedBundleAutoSellCount = 0;
          for (const [walletId, config] of Object.entries(profile.sniperConfig.bundleAutoSellConfigs)) {
            if (walletId && walletId.toString().trim() !== '') {
              validBundleAutoSellConfigs[walletId] = config;
            } else {
              removedBundleAutoSellCount++;
              console.warn(`[WalletProfile] Removed bundle auto-sell config for invalid wallet ID: ${walletId}`);
            }
          }
          if (removedBundleAutoSellCount > 0) {
            console.warn(`[WalletProfile] Removed ${removedBundleAutoSellCount} bundle auto-sell config(s) for invalid wallet IDs`);
          }
          if (Object.keys(validBundleAutoSellConfigs).length > 0) {
            console.log(`[WalletProfile] ✅ Loaded ${Object.keys(validBundleAutoSellConfigs).length} bundle auto-sell config(s)`);
          }
          setBundleAutoSellConfigs(validBundleAutoSellConfigs);
        }
      }
      
      // Store the selected profile ID for reference when saving token configs
      setSelectedWalletProfileId(profileId);
      
      setShowConfigModal(false);
      
      // Clear loading flag after a short delay to allow state updates to complete
      setTimeout(() => {
        isLoadingProfileRef.current = false;
      }, 1000);
      
      // Build success message with all restored settings
      const restoredParts = [];
      
      // Wallet restore info
      if (profile.walletSourceConfig) {
        const walletParts = [];
        if (profile.walletSourceConfig.selectedCreatorWallet) walletParts.push('DEV');
        if (profile.walletSourceConfig.selectedBundleWallets?.length) walletParts.push(`${profile.walletSourceConfig.selectedBundleWallets.length} bundle`);
        if (profile.walletSourceConfig.selectedHolderWallets?.length) walletParts.push(`${profile.walletSourceConfig.selectedHolderWallets.length} holder`);
        if (walletParts.length > 0) {
          restoredParts.push(`${walletParts.join(', ')} wallets`);
        }
      }
      
      // MEV protection info
      if (profile.mevProtection?.enabled) {
        restoredParts.push('MEV protection');
      }
      
      // Auto-sell info
      if (profile.autoSellGlobal?.enabled || Object.keys(profile.sniperConfig?.holderAutoSellConfigs || {}).length > 0 || 
          Object.keys(profile.sniperConfig?.bundleAutoSellConfigs || {}).length > 0 || 
          (profile.devAutoSellConfig?.enabled && profile.devAutoSellConfig?.threshold)) {
        restoredParts.push('auto-sell configs');
      }
      
      // Auto-buy info
      if (Object.keys(profile.sniperConfig?.holderAutoBuyConfigs || {}).length > 0) {
        restoredParts.push('auto-buy configs');
      }
      
      const restoredInfo = restoredParts.length > 0 ? ` (restored: ${restoredParts.join(', ')})` : '';
      showToast(`✅ Loaded wallet profile: ${profile.name}${restoredInfo}`, 'success');
    } catch (error) {
      console.error('Failed to load wallet profile:', error);
      showToast('Failed to load wallet profile', 'error');
      // Clear loading flag on error too
      isLoadingProfileRef.current = false;
    }
  };
  
  // Delete a wallet profile
  const deleteWalletProfile = async (profileId, e) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this wallet profile?')) {
      return;
    }

    try {
      await apiService.deleteWalletProfile(profileId);
      await loadWalletProfiles();
      if (selectedWalletProfileId === profileId) {
        setSelectedWalletProfileId(null);
      }
      showToast('Wallet profile deleted', 'success');
    } catch (error) {
      console.error('Failed to delete wallet profile:', error);
      alert('Failed to delete wallet profile: ' + (error.response?.data?.error || error.message));
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
    
    alert('[ok] Configuration exported as JSON file!');
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
          alert('[ok] Configuration imported successfully!');
        }).catch(err => {
          console.error('Failed to save imported config:', err);
          alert('[!] Configuration loaded but failed to save to .env: ' + (err.response?.data?.error || err.message));
        });
        
        // Reset file input
        event.target.value = '';
      } catch (error) {
        console.error('Failed to parse JSON:', error);
        alert(' Invalid JSON file: ' + error.message);
        event.target.value = '';
      }
    };
    reader.onerror = () => {
      alert(' Failed to read file');
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

  // Load vanity address pool status
  const loadVanityAddressPool = async () => {
    try {
      const res = await apiService.getVanityPoolStatus();
      if (res.data) {
        // Backward compatible: older servers may not return `checked`
        setVanityAddressPool(prev => ({
          ...prev,
          ...res.data,
          checked: res.data.checked ?? res.data.checkedCount ?? res.data.totalChecked ?? prev.checked ?? 0,
        }));
      }
    } catch (error) {
      console.error('Failed to load vanity pool status:', error);
    }
  };

  // Start vanity generator
  const startVanityGenerator = async () => {
    try {
      setVanityGeneratorStatus('starting');
      const res = await apiService.startVanityGenerator();
      if (res.data.success) {
        setVanityGeneratorStatus('running');
        setVanityAddressPool(prev => ({ ...prev, generating: true }));
        showToast('Vanity generator started', 'success');
        // Start polling for updates
        loadVanityAddressPool();
      } else {
        setVanityGeneratorStatus('error');
        showToast(res.data.error || 'Failed to start generator', 'error');
      }
    } catch (error) {
      console.error('Failed to start vanity generator:', error);
      setVanityGeneratorStatus('error');
      showToast('Failed to start vanity generator', 'error');
    }
  };

  // Stop vanity generator
  const stopVanityGenerator = async () => {
    try {
      setVanityGeneratorStatus('stopping');
      const res = await apiService.stopVanityGenerator();
      if (res.data.success) {
        setVanityGeneratorStatus('stopped');
        setVanityAddressPool(prev => ({ ...prev, generating: false }));
        showToast('Vanity generator stopped', 'success');
        loadVanityAddressPool();
      }
    } catch (error) {
      console.error('Failed to stop vanity generator:', error);
      setVanityGeneratorStatus('error');
    }
  };

  // Generate random address preview
  const generateRandomAddressPreview = async () => {
    try {
      const res = await apiService.generateRandomAddress();
      if (res.data.success && res.data.address) {
        setNextAddress({
          address: res.data.address,
          source: 'Random (pre-generated)'
        });
      }
    } catch (error) {
      console.error('Failed to generate random address:', error);
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
          setSavingStatus('[ok] Image saved!');
          showToast('.env FILE Saved', 'success');
          setTimeout(() => setSavingStatus(''), 2000);
        }
      } catch (error) {
        console.error('Failed to auto-save image:', error);
        setSavingStatus(' Failed to save image');
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
        
        // Use the imageUrl from response (local file for preview)
        // Note: Pump.fun SDK will handle IPFS upload automatically on launch
        if (response.data.imageUrl) {
          // For preview, use localhost URL
          const imageUrl = `http://localhost:3001${response.data.imageUrl}`;
          
          // Use the filePath for settings (local path - SDK handles IPFS on launch)
          const filePath = response.data.filePath;
          const newSettings = { ...settings, FILE: filePath };
          setSettings(newSettings);
          
          // Update preview to use the local URL
          setImagePreview(imageUrl);
          
          // Save to backend
          await apiService.updateSettings({ FILE: filePath });
          
          const statusMsg = '[ok] AI Image generated & saved locally. Will upload to IPFS automatically on launch.';
          setSavingStatus(statusMsg);
          showToast('.env FILE Saved', 'success');
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
        setAiGeneratorError('[!] Gemini AI requires PAID billing. Free tier has 0 quota for image generation. Enable billing or use static logo upload instead.');
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
          setSavingStatus('[ok] Logo saved!');
          showToast('.env WEBSITE_LOGO Saved', 'success');
          setTimeout(() => setSavingStatus(''), 2000);
        }
      } catch (error) {
        console.error('Failed to auto-save logo:', error);
        setSavingStatus(' Failed to save logo');
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
      
      // Handle FILE - pump.fun SDK will upload to IPFS automatically
      // FILE can be a URL or local path - SDK handles both
      // If it's a URL, use it directly. If local, SDK will read and upload to IPFS.
      let tokenImageUrl = null;
      
      if (settings.FILE) {
        // If FILE is already a URL (IPFS or http), use it directly
        if (settings.FILE.startsWith('http') || settings.FILE.startsWith('ipfs://')) {
          tokenImageUrl = settings.FILE.startsWith('ipfs://') 
            ? settings.FILE.replace('ipfs://', 'https://ipfs.io/ipfs/')
            : settings.FILE;
        } 
        // If FILE is a local path, convert to localhost URL for preview
        // SDK will handle reading the file and uploading to IPFS on launch
        else if (settings.FILE.startsWith('./image/') || settings.FILE.startsWith('image/')) {
          const filename = settings.FILE.replace(/^\.\/image\//, '').replace(/^image\//, '');
          tokenImageUrl = `http://localhost:3001/image/${filename}`;
        } else {
          // Absolute path or other format - SDK will handle it
          tokenImageUrl = settings.FILE;
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
        alert(`[ok] Website update test successful!\n\nSite: ${result.site_url || settings.WEBSITE_URL}`);
      } else {
        alert(` Website update test failed:\n\n${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      setMarketingTestResults({ ...marketingTestResults, website: { success: false, error: error.message } });
      alert(` Website update test error:\n\n${error.message}`);
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
    // Disabled in the clean bundler build (no Vercel/domain management in this repo).
    // Keeping the rest of the bundler UI focused on launching/trading/warming.
    return;
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
          alert(`[info] Domain "${selectedDomain}" is already connected to "${project?.name || selectedProjectId}".`);
        } else {
          alert(`[ok] Domain "${selectedDomain}" connected to "${project?.name || selectedProjectId}"!`);
        }
      } else {
        alert(` Failed to connect domain: ${result.error}`);
      }
    } catch (error) {
      alert(` Error: ${error.message}`);
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
          alert(`[info] Domain "${selectedDomain}" was not connected to "${project?.name || selectedProjectId}".`);
        } else {
          alert(`[ok] Domain "${selectedDomain}" disconnected from "${project?.name || selectedProjectId}"!\n\nYou still own the domain and can reconnect it later.`);
        }
      } else {
        alert(` Failed to disconnect domain: ${result.error}`);
      }
    } catch (error) {
      alert(` Error: ${error.message}`);
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
    if (!confirm(` Purchase "${domain.domain}" for ${domain.priceFormatted}?\n\nThis will charge your Vercel account.`)) {
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
        alert(`[ok] Domain "${domain.domain}" purchased successfully!\n\nIt should appear in your domains list shortly.`);
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
        alert(` Failed to purchase domain: ${result.error}`);
      }
    } catch (error) {
      console.error('Domain purchase error:', error);
      alert(` Error purchasing domain: ${error.message}`);
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
          alert('[ok] Account is already verified!');
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
        alert('[ok] Account verified successfully!');
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
          alert('[ok] Account is verified!');
        } else {
          alert('[!] Account needs verification. Click "Verify Account" to start.');
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
        alert(`[ok] Telegram creation test successful!\n\n${result.message || 'Group/channel created'}\n${result.telegram_link ? `Link: ${result.telegram_link}` : ''}`);
      } else {
        alert(` Telegram creation test failed:\n\n${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      setMarketingTestResults({ ...marketingTestResults, telegram: { success: false, error: error.message } });
      alert(` Telegram creation test error:\n\n${error.message}`);
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
        
        alert(`[ok] Account verified & saved!\n\nUsername: @${account.username}\nName: ${account.name}${account.verified ? '\n Verified Account' : ''}`);
      } else {
        alert(` Failed to verify account: ${response.data.error || 'Unknown error'}`);
        setTwitterAccountInfo(null);
      }
    } catch (error) {
      console.error('Failed to get Twitter account info:', error);
      alert(` Failed to verify account: ${error.response?.data?.error || error.message || 'Unknown error'}`);
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
      (includeImages ? `\n Profile Image: ${tokenImage ? 'Yes (token logo)' : 'No image'}\n Banner: Will generate with AI` : '');
    
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
        let msg = `[ok] Twitter profile updated!\n\nName: ${tokenName}`;
        if (result.profileImageUpdated) msg += '\n Profile image updated';
        if (result.bannerUpdated) msg += '\n Banner generated & uploaded';
        alert(msg);
        // Refresh account info
        getTwitterAccountInfo();
      } else {
        alert(` Failed to update profile: ${result.error}`);
      }
    } catch (error) {
      alert(` Error: ${error.message}`);
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
        alert(`[ok] Twitter posting test successful!\n\nTweets posted: ${tweetCount}\nProfile updated: ${profileUpdated}\n${result.message || ''}`);
      } else {
        alert(` Twitter posting test failed:\n\n${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      setMarketingTestResults({ ...marketingTestResults, twitter: { success: false, error: error.message } });
      alert(` Twitter posting test error:\n\n${error.message}`);
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
        console.log(`[ok] Auto-filled WEBSITE_URL from WEBSITE: ${extractedDomain}`);
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
          console.log(`[ok] Auto-saved: ${savedKeys}`, settingsToSave);
          console.log(`[Frontend] API Response:`, response.data);
          setSavingStatus(`[ok] Saved ${savedKeys}`);
          showToast(`Saved: ${key.replace(/_/g, ' ').toLowerCase()}`, 'success');
          setTimeout(() => setSavingStatus(''), 2000); // Clear status after 2 seconds
          // Reload wallet info if wallet-related settings changed
          if (['BUNDLE_WALLET_COUNT', 'BUNDLE_SWAP_AMOUNTS', 'HOLDER_WALLET_COUNT', 'HOLDER_SWAP_AMOUNTS', 'HOLDER_WALLET_AMOUNT', 'BUYER_AMOUNT', 'SWAP_AMOUNT', 'USE_NORMAL_LAUNCH'].includes(key)) {
            setTimeout(() => loadWalletInfo(), 300);
          }
        })
        .catch(err => {
          console.error(' Failed to auto-save setting:', key, '=', value, err);
          console.error('Error details:', err.response?.data || err.message);
          setSavingStatus(` Failed to save ${key}`);
          showToast(`Failed to save: ${key.replace(/_/g, ' ').toLowerCase()}`, 'error');
          setTimeout(() => setSavingStatus(''), 5000); // Show error for 5 seconds
          
          // Suppress alerts during auto-save - the .env file is being updated even if verification fails
          // Only show critical errors that prevent saving entirely
          const isNetworkError = err.message === 'Network Error' || err.code === 'ERR_NETWORK' || !err.response;
          const isVerificationError = err.response?.data?.error?.includes('Failed to update keys');
          
          if (isVerificationError) {
            // Verification errors are usually false positives (quote handling differences)
            // The .env file was actually written, so just log it
            console.warn(`[!] Verification warning for ${key} (file was still updated):`, err.response?.data?.error);
          } else if (isNetworkError) {
            // For network errors, just log - don't interrupt user's typing
            console.warn(`[!] Network error while auto-saving ${key}. Settings will be saved when you click "Save Settings".`);
          } else if (!isNetworkError && !isVerificationError && ['TOKEN_NAME', 'TOKEN_SYMBOL'].includes(key)) {
            // Only alert for actual save failures (not verification or network issues)
            console.error(` Actual save failure for ${key}:`, err.response?.data?.error || err.message);
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
        // Address mode: 'vanity' uses pump address pool, 'random' generates fresh address
        addressMode: addressMode,
        useVanityAddress: addressMode === 'vanity',
        
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
        
        // Auto-buy config - per-wallet configuration (wallets with Auto-Buy enabled)
        holderWalletAutoBuyAddresses: useWarmedHolderWallets
          ? Object.keys(holderAutoBuyConfigs).filter(id => selectedHolderWallets.includes(id))
          : [],
        holderWalletAutoBuyIndices: !useWarmedHolderWallets
          ? Object.keys(holderAutoBuyConfigs)
              .filter(id => id.startsWith('wallet-'))
              .map(id => parseInt(id.replace('wallet-', '')))
              .filter(idx => selectedHolderAutoBuyIndices.includes(idx) || parseInt(settings.HOLDER_WALLET_COUNT || '0') >= idx)
          : [],
        // Per-wallet auto-buy configuration: { walletId: { delay, safetyThreshold } }
        holderWalletAutoBuyConfigs: Object.keys(holderAutoBuyConfigs).length > 0 ? holderAutoBuyConfigs : null,
        // Per-wallet auto-sell configuration: { walletId: { threshold: number, enabled: boolean } }
        holderWalletAutoSellConfigs: Object.keys(holderAutoSellConfigs).length > 0 ? holderAutoSellConfigs : null,
        bundleWalletAutoSellConfigs: Object.keys(bundleAutoSellConfigs).length > 0 ? bundleAutoSellConfigs : null,
        devAutoSellConfig: (devAutoSellConfig && devAutoSellConfig.enabled && parseFloat(devAutoSellConfig.threshold) > 0) ? devAutoSellConfig : null,
        // Legacy group-based delays (for backward compatibility)
        holderWalletAutoBuyDelays: (settings.AUTO_HOLDER_WALLET_BUY === 'true' || settings.AUTO_HOLDER_WALLET_BUY === true) && holderAutoBuyGroups.length > 0
          ? holderAutoBuyGroups.map(g => `parallel:${g.count},delay:${g.delay}`).join(',')
          : null,
        frontRunThreshold: frontRunThreshold // Global fallback threshold (SOL)
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
      // Rapid mode uses quick launch (simple create + dev buy)
      // Bundle and Advanced modes use full launch with different feature sets
      const res = launchMode === 'rapid' 
        ? await apiService.quickLaunchToken({ 
            addressMode: addressMode, 
            useVanityAddress: addressMode === 'vanity' 
          })
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
              console.log('[ok] Wallets created! Pre-loading wallet info for immediate trading...');
              // Load wallets in background - don't wait, let launch continue
              loadWalletInfo().catch(err => console.warn('Failed to pre-load wallets:', err));
              
              // Auto-navigate to holders tab so user can see wallets
              if (onLaunch) {
                onLaunch(); // This switches to holders tab
              }
            }
            
            if (currentRun.launchStatus === 'SUCCESS') {
              // Launch completed successfully!
              console.log('[ok] Launch completed successfully!');
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
                  console.log('[fast] Auto-sell thresholds detected, starting auto-sell...');
                  await apiService.toggleAutoSell(true);
                  console.log('[ok] Auto-sell ENABLED automatically');
                }
              } catch (err) {
                console.warn('Failed to auto-start auto-sell:', err.message);
              }
              
              if (onLaunch) onLaunch();
              setLoading(false);
              
              // No alert popup - wallets are already loaded and ready!
              // Just show a brief status message
              setSavingStatus('[ok] Token launched! Wallets ready for trading.');
              setTimeout(() => setSavingStatus(''), 3000);
              return;
            } else if (currentRun.launchStatus === 'FAILED') {
              // Launch failed
              console.error(' Launch failed:', currentRun.failureReason);
              setLaunchStage('FAILED');
              setLaunchProgress(0);
              setLoading(false);
              alert(` Launch failed: ${currentRun.failureReason || 'Unknown error'}\n\nCheck terminal for details.`);
              return;
            } else if (currentRun.launchStatus === 'PENDING' || stage !== 'SUCCESS') {
              // Launch in progress - continue polling
              console.log(` Launch stage: ${stage} (${stageProgress[stage] || 0}%)`);
              
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
              console.log('[ok] Launch completed (legacy format)!');
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
                  console.log('[fast] Auto-sell thresholds detected, starting auto-sell...');
                  await apiService.toggleAutoSell(true);
                  console.log('[ok] Auto-sell ENABLED automatically');
                }
              } catch (err) {
                console.warn('Failed to auto-start auto-sell:', err.message);
              }
              
              if (onLaunch) onLaunch();
              setLoading(false);
              
              // No alert popup - just status message
              setSavingStatus('[ok] Token launched! Wallets ready for trading.');
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
            console.warn(`[!] Launch timeout after ${elapsedMinutes} minutes`);
            setLoading(false);
            setLaunchStage('IDLE');
            setLaunchProgress(0);
            alert(` Launch is taking longer than expected (${elapsedMinutes} minutes).\n\nIt may still be in progress. Check the API server terminal for updates.\n\nYou can retry the launch or refresh the page.`);
          }
        } catch (error) {
          // Check if error is because process exited (404 or no current-run.json)
          if (error.response?.status === 404 || error.message?.includes('404')) {
            // Process exited - no current-run.json means launch process stopped
            console.warn('[!] Launch process appears to have exited (no current-run.json)');
            setLoading(false);
            setLaunchStage('IDLE');
            setLaunchProgress(0);
            setSavingStatus('[!] Launch process exited. You can retry the launch.');
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
            alert(' Launch is taking longer than expected. Check the API server terminal for progress.\n\nYou can retry the launch or refresh the page.');
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


  // Show beautiful launch progress UI when launching
  if (loading && launchStage) {
    return (
        <LaunchProgress 
          onComplete={() => {
            setLoading(false);
            setLaunchStage(null);
            // Auto-switch to Trading Terminal
            if (onLaunch) onLaunch();
          }}
        tokenInfo={{
          name: settings.TOKEN_NAME || 'New Token',
          symbol: settings.TOKEN_SYMBOL || 'TOKEN',
          image: settings.FILE ? `http://localhost:3001/image/${settings.FILE.split('/').pop()}` : null
        }}
        />
    );
  }

  return (
    <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-lg p-4">
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-3">
          <RocketLaunchIconSolid className="w-6 h-6 text-blue-400" />
          <h2 className="text-xl font-bold text-white">Launch Token</h2>
        </div>
        {savingStatus && (
          <div className={`text-sm px-3 py-1 rounded ${
            savingStatus.startsWith('[ok]') ? 'bg-green-900/50 text-green-400' : 
            savingStatus.startsWith('[x]') ? 'bg-red-900/50 text-red-400' : 
            'bg-blue-900/50 text-blue-400'
          }`}>
            {savingStatus}
          </div>
        )}
      </div>

      {/* Platform + Launch Mode (Compact) */}
      <div className="mb-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {/* Platform */}
          <div className="flex items-center justify-between sm:justify-start gap-3">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Platform</span>
            <div className="flex items-center gap-1">
              {/* PUMP - Active */}
              <button
                type="button"
                className="relative flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#9AE65C]/20 border border-[#9AE65C]/50 transition-all hover:bg-[#9AE65C]/30"
                title="Pump.fun - Active"
              >
                <img src="/image/icons/Pump_fun_logo.png" alt="Pump.fun" className="w-4 h-4 object-contain" />
                <span className="text-[10px] font-bold text-[#9AE65C]">PUMP</span>
              </button>

              {/* BAGS - Coming Soon */}
              <div
                className="relative flex items-center gap-1.5 px-2 py-1 rounded-lg bg-gray-800/50 border border-gray-700/50 opacity-50 cursor-not-allowed"
                title="Bags.fm - Coming Soon"
              >
                <img src="/image/icons/bags-icon.png" alt="Bags.fm" className="w-4 h-4 object-contain grayscale" />
                <span className="text-[10px] font-medium text-gray-500">BAGS</span>
                <span className="absolute -top-1 -right-1 px-1 py-0.5 text-[7px] font-bold bg-gray-700 text-gray-400 rounded">SOON</span>
              </div>

              {/* BONK - Coming Soon */}
              <div
                className="relative flex items-center gap-1.5 px-2 py-1 rounded-lg bg-gray-800/50 border border-gray-700/50 opacity-50 cursor-not-allowed"
                title="Bonk.fun - Coming Soon"
              >
                <img src="/image/icons/bonk1-bonk-logo.png" alt="Bonk.fun" className="w-4 h-4 object-contain grayscale" />
                <span className="text-[10px] font-medium text-gray-500">BONK</span>
                <span className="absolute -top-1 -right-1 px-1 py-0.5 text-[7px] font-bold bg-gray-700 text-gray-400 rounded">SOON</span>
              </div>
            </div>
          </div>

          {/* Launch Mode */}
          <div className="flex items-center justify-between sm:justify-end gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Launch</span>
              <div
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                  launchMode === 'rapid'
                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                    : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                }`}
              >
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {launchMode === 'rapid' ? '~5s' : '~30-60s'}
              </div>
            </div>

            <div className="inline-flex rounded-lg border border-gray-700/50 bg-gray-900/30 p-1">
              {/* Rapid */}
              <button
                type="button"
                onClick={() => {
                  setLaunchMode('rapid');
                  handleChange('BUNDLE_WALLET_COUNT', '');
                  handleChange('BUNDLE_SWAP_AMOUNTS', '');
                  handleChange('HOLDER_WALLET_COUNT', '');
                  handleChange('HOLDER_SWAP_AMOUNTS', '');
                  handleChange('USE_NORMAL_LAUNCH', 'true');
                  setSelectedBundleWallets([]);
                  setSelectedHolderWallets([]);
                  setSelectedHolderAutoBuyWallets([]);
                  setSelectedHolderAutoBuyIndices([]);
                  setUseWarmedBundleWallets(false);
                  setUseWarmedHolderWallets(false);
                }}
                className={`relative group flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                  launchMode === 'rapid'
                    ? 'bg-green-600/30 text-green-200'
                    : 'text-gray-300 hover:bg-gray-800/60'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span>Rapid</span>
                <QuestionMarkCircleIcon className="w-3.5 h-3.5 text-gray-500 group-hover:text-gray-300" />
                <div className="absolute top-full left-0 mt-1 hidden group-hover:block z-50 w-56 p-2 bg-gray-900 border border-gray-700 rounded-lg shadow-xl text-[10px] text-gray-300">
                  <div className="font-semibold text-green-400 mb-1">Rapid Mode</div>
                  <ul className="space-y-0.5">
                    <li>✓ Simple create + dev buy</li>
                    <li>✓ Warming wallets support</li>
                    <li className="text-gray-500">✗ No bundles or LUTs</li>
                    <li className="text-gray-500">✗ No mixers</li>
                  </ul>
                </div>
              </button>

              {/* Bundle */}
              <button
                type="button"
                onClick={() => {
                  setLaunchMode('bundle');
                  handleChange('USE_NORMAL_LAUNCH', 'false');
                }}
                className={`relative group flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                  launchMode === 'bundle'
                    ? 'bg-blue-600/30 text-blue-200'
                    : 'text-gray-300 hover:bg-gray-800/60'
                }`}
              >
                <CubeIcon className="w-3.5 h-3.5" />
                <span>Bundle</span>
                <QuestionMarkCircleIcon className="w-3.5 h-3.5 text-gray-500 group-hover:text-gray-300" />
                <div className="absolute top-full right-0 mt-1 hidden group-hover:block z-50 w-60 p-2 bg-gray-900 border border-gray-700 rounded-lg shadow-xl text-[10px] text-gray-300">
                  <div className="font-semibold text-blue-400 mb-1">Bundle Mode</div>
                  <ul className="space-y-0.5">
                    <li>✓ Jito bundling</li>
                    <li>✓ LUT creation</li>
                    <li>✓ Bundle + holder wallets</li>
                  </ul>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Token Details Card - Combined Preview + Form */}
      <div className="mb-4">
        <div className="rounded-xl border border-gray-700/50 bg-gradient-to-br from-gray-900/80 to-gray-800/50 overflow-hidden">
          {/* Card Header with Config Buttons */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/50 bg-gray-900/50">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                <DocumentTextIcon className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Token Details</h3>
                <p className="text-[10px] text-gray-500">Configure your token info</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Token Profile Buttons */}
              <div className="flex items-center gap-2 pl-2 border-l border-gray-700/50">
                <button
                  type="button"
                  onClick={() => {
                    setConfigSaveName(settings.TOKEN_NAME || 'My Token');
                    setConfigModalTab('token');
                    setShowConfigModal(true);
                    loadSavedConfigs();
                  }}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2 text-xs font-semibold shadow-lg shadow-blue-600/30"
                  title="Load saved token profile (name, symbol, description, etc.)"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                  </svg>
                  Load Token Profile
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!settings.TOKEN_NAME?.trim()) {
                      showToast('Please enter a token name first', 'error');
                      return;
                    }
                    setConfigSaveName(settings.TOKEN_NAME || 'My Token');
                    setConfigModalTab('token');
                    setShowConfigModal(true);
                    await loadSavedConfigs();
                  }}
                  className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors flex items-center gap-2 text-xs font-semibold shadow-lg shadow-green-600/30"
                  title="Save current token info (name, symbol, description, etc.)"
                >
                  <ArrowDownTrayIcon className="w-4 h-4" />
                  Save Token Profile
                </button>
              </div>
            </div>
          </div>

          {/* Contract Address - Prominent at Top with Vanity Generator */}
          <div className="px-4 py-3 bg-gradient-to-r from-green-900/20 via-emerald-900/10 to-teal-900/20 border-b border-gray-700/50">
            {/* Main Address Row */}
            <div className="flex items-center justify-between gap-4 mb-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">Contract Address</span>
                  {nextAddress?.address?.toLowerCase().endsWith('pump') && (
                    <span className="text-[10px] text-green-400 bg-green-900/40 px-1.5 py-0.5 rounded border border-green-500/30">
                       pump vanity
                    </span>
                  )}
                </div>
                {nextAddress?.address ? (
                  <code className="text-lg font-mono text-white tracking-wide break-all block font-bold">
                    {nextAddress.address}
                  </code>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-400 italic">
                      {addressMode === 'vanity' && vanityAddressPool.available > 0 
                        ? 'Will use next vanity address from pool'
                        : addressMode === 'vanity' && vanityAddressPool.available === 0
                        ? 'No vanity addresses available. Run the generator locally or switch to Random.'
                        : 'Generating random address...'
                      }
                    </span>
                    <ArrowPathIcon className="w-4 h-4 text-gray-500 animate-spin" />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Address Mode Toggle */}
                <div className="flex items-center bg-gray-800/70 rounded-lg p-0.5 border border-gray-700/50">
                  <button
                    type="button"
                    onClick={() => setAddressMode('vanity')}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                      addressMode === 'vanity'
                        ? 'bg-emerald-600 text-white'
                        : 'text-gray-400 hover:text-white'
                    }`}
                    title="Use vanity address from pool"
                  >
                     Vanity
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddressMode('random')}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                      addressMode === 'random'
                        ? 'bg-gray-600 text-white'
                        : 'text-gray-400 hover:text-white'
                    }`}
                    title="Generate random address"
                  >
                    Random
                  </button>
                </div>
                {nextAddress?.address && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(nextAddress.address);
                        showToast('Address copied!', 'success');
                      }}
                      className="p-2 bg-gray-800/70 hover:bg-gray-700 rounded-lg transition-all border border-gray-700/50"
                      title="Copy address"
                    >
                      <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                    <a
                      href={`https://pump.fun/${nextAddress.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 bg-emerald-600/20 hover:bg-emerald-600/40 rounded-lg transition-all border border-emerald-500/30"
                      title="View on Pump.fun"
                    >
                      <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  </>
                )}
              </div>
            </div>

            {/* Vanity Generator Controls - Compact inline */}
            {addressMode === 'vanity' && (
              <div className="flex items-center justify-between gap-4 pt-2 border-t border-gray-700/30">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">Vanity Pool:</span>
                    <span className="text-sm font-bold text-emerald-400">{vanityAddressPool.available}</span>
                    <span className="text-xs text-gray-500">/ {vanityAddressPool.total}</span>
                  </div>
                  <div className="text-[10px] text-gray-500">
                    Checked: <span className="text-gray-300 font-mono">{vanityAddressPool.checked || 0}</span>
                  </div>
                  {vanityAddressPool.generating && (
                    <span className="flex items-center gap-1 text-[10px] text-green-400 bg-green-900/30 px-2 py-0.5 rounded animate-pulse">
                      <span className="w-1.5 h-1.5 bg-green-400 rounded-full"></span>
                      Generating...
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!vanityAddressPool.generating ? (
                    <button
                      type="button"
                      onClick={startVanityGenerator}
                      disabled={vanityGeneratorStatus === 'starting'}
                      className="px-3 py-1.5 bg-emerald-600/80 hover:bg-emerald-600 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {vanityGeneratorStatus === 'starting' ? (
                        <>
                          <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
                          Starting...
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Generate More
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={stopVanityGenerator}
                      disabled={vanityGeneratorStatus === 'stopping'}
                      className="px-3 py-1.5 bg-red-600/80 hover:bg-red-600 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {vanityGeneratorStatus === 'stopping' ? (
                        <>
                          <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
                          Stopping...
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                          </svg>
                          Stop
                        </>
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={loadVanityAddressPool}
                    className="p-1.5 bg-gray-700/50 hover:bg-gray-700 text-gray-400 rounded-lg transition-colors"
                    title="Refresh"
                  >
                    <ArrowPathIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
            {addressMode === 'vanity' && vanityAddressPool.available === 0 && (
              <div className="mt-2 text-[10px] text-gray-400">
                Vanity generation runs on your machine (local). Click <span className="text-white font-semibold">Generate More</span> to build a small pool, or switch to <span className="text-white font-semibold">Random</span> to proceed without vanity addresses.
              </div>
            )}
          </div>

          {/* Main Content - Preview + Form Side by Side */}
          <div className="p-4">
            <div className="flex gap-4">
              {/* Left: Image Preview & Upload */}
              <div className="w-32 flex-shrink-0">
                <div className="relative group">
                  {settings.FILE || imagePreview ? (
                    <img 
                      src={imagePreview || settings.FILE} 
                      alt={settings.TOKEN_NAME || 'Token'} 
                      className="w-32 h-32 rounded-xl object-cover border-2 border-gray-700/50 group-hover:border-blue-500/50 transition-colors"
                    />
                  ) : (
                    <div className="w-32 h-32 rounded-xl border-2 border-dashed border-gray-700 bg-gray-800/30 flex flex-col items-center justify-center text-gray-500 group-hover:border-blue-500/50 transition-colors">
                      <PhotoIcon className="w-8 h-8 mb-1" />
                      <span className="text-[10px]">Token Image</span>
                    </div>
                  )}
                  {/* Upload overlay */}
                  <label className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl cursor-pointer">
                    <div className="text-center">
                      <PhotoIcon className="w-6 h-6 text-white mx-auto mb-1" />
                      <span className="text-xs text-white">Change</span>
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageChange}
                      className="hidden"
                    />
                  </label>
                </div>
                {/* AI Generate Button */}
                <button
                  type="button"
                  onClick={() => setShowAiGenerator(!showAiGenerator)}
                  className={`w-full mt-2 py-1.5 px-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1 ${
                    showAiGenerator 
                      ? 'bg-purple-600 text-white' 
                      : 'bg-purple-900/30 text-purple-300 hover:bg-purple-800/50 border border-purple-500/30'
                  }`}
                >
                  <LightBulbIcon className="w-3 h-3" />
                  AI Generate
                </button>
              </div>

              {/* Right: Form Fields */}
              <div className="flex-1 space-y-3">
                {/* Name & Symbol Row */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="block text-[10px] font-medium text-gray-400 mb-1 uppercase tracking-wide">
                      Token Name *
                    </label>
                    <input
                      type="text"
                      value={settings.TOKEN_NAME || ''}
                      onChange={(e) => handleChange('TOKEN_NAME', e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-gray-800/50 border border-gray-700/50 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                      placeholder="My Awesome Token"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-gray-400 mb-1 uppercase tracking-wide">
                      Symbol *
                    </label>
                    <input
                      type="text"
                      value={settings.TOKEN_SYMBOL || ''}
                      onChange={(e) => handleChange('TOKEN_SYMBOL', e.target.value.toUpperCase())}
                      className="w-full px-3 py-2 text-sm bg-gray-800/50 border border-gray-700/50 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                      placeholder="MAT"
                      maxLength={10}
                    />
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-[10px] font-medium text-gray-400 mb-1 uppercase tracking-wide">
                    Description *
                  </label>
                  <textarea
                    value={settings.DESCRIPTION || ''}
                    onChange={(e) => handleChange('DESCRIPTION', e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 text-sm bg-gray-800/50 border border-gray-700/50 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 resize-none"
                    placeholder="Describe your token..."
                  />
                </div>

                {/* Social Links Row */}
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] font-medium text-gray-400 mb-1 uppercase tracking-wide flex items-center gap-1">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                      </svg>
                      Twitter
                    </label>
                    <input
                      type="text"
                      value={settings.TWITTER || ''}
                      onChange={(e) => handleChange('TWITTER', e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-gray-800/50 border border-gray-700/50 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                      placeholder="@username"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-gray-400 mb-1 uppercase tracking-wide flex items-center gap-1">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                      </svg>
                      Telegram
                    </label>
                    <input
                      type="text"
                      value={settings.TELEGRAM || ''}
                      onChange={(e) => handleChange('TELEGRAM', e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-gray-800/50 border border-gray-700/50 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                      placeholder="t.me/group"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-gray-400 mb-1 uppercase tracking-wide flex items-center gap-1">
                      <GlobeAltIcon className="w-3 h-3" />
                      Website
                    </label>
                    <input
                      type="text"
                      value={settings.WEBSITE || ''}
                      onChange={(e) => handleChange('WEBSITE', e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-gray-800/50 border border-gray-700/50 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                      placeholder="https://..."
                    />
                  </div>
                </div>

              </div>
            </div>

            {/* AI Image Generator Panel - Full Width Below */}
            {showAiGenerator && (
              <div className="mt-4 p-3 bg-gradient-to-br from-purple-900/20 to-blue-900/20 border border-purple-500/30 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <LightBulbIcon className="w-4 h-4 text-purple-400" />
                  <span className="text-sm font-medium text-purple-300">Nano Banana AI</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-purple-600/50 text-purple-200 rounded">Gemini</span>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  {/* Style Selector */}
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Style</label>
                    <div className="flex flex-wrap gap-1">
                      {[
                        { id: 'meme', label: 'Meme' },
                        { id: 'professional', label: 'Pro' },
                        { id: 'cartoon', label: 'Cartoon' },
                        { id: 'abstract', label: 'Abstract' },
                        { id: 'custom', label: 'Custom' },
                      ].map(style => (
                        <button
                          key={style.id}
                          type="button"
                          onClick={() => setAiImageStyle(style.id)}
                          className={`text-xs px-2 py-1 rounded transition-all ${
                            aiImageStyle === style.id
                              ? 'bg-purple-600 text-white'
                              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                          }`}
                        >
                          {style.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  {/* Prompt + Generate */}
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Custom Prompt</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={aiImagePrompt}
                        onChange={(e) => setAiImagePrompt(e.target.value)}
                        placeholder={`e.g., "A cute frog with sunglasses"`}
                        className="flex-1 px-2 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:border-purple-500"
                      />
                      <button
                        type="button"
                        onClick={handleAiGenerateImage}
                        disabled={aiImageGenerating || (aiImageStyle === 'custom' && !aiImagePrompt.trim())}
                        className={`px-3 py-1.5 rounded font-medium text-sm transition-all flex items-center gap-1 ${
                          aiImageGenerating
                            ? 'bg-purple-700 text-purple-200 cursor-wait'
                            : 'bg-purple-600 text-white hover:bg-purple-500'
                        } disabled:opacity-50`}
                      >
                        {aiImageGenerating ? (
                          <ArrowPathIcon className="w-4 h-4 animate-spin" />
                        ) : (
                          <LightBulbIcon className="w-4 h-4" />
                        )}
                        {aiImageGenerating ? 'Generating...' : 'Generate'}
                      </button>
                    </div>
                  </div>
                </div>
                
                {aiGeneratorError && (
                  <div className="mt-2 p-2 bg-red-900/30 border border-red-500/50 rounded text-xs text-red-300">
                     {aiGeneratorError}
                  </div>
                )}
              </div>
            )}

            {/* Website Logo Upload - Collapsed */}
            <div className="mt-3 pt-3 border-t border-gray-700/30">
              <details className="group">
                <summary className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-300">
                  <ChevronDownIcon className="w-3 h-3 group-open:rotate-180 transition-transform" />
                  Additional: Website Logo
                </summary>
                <div className="mt-2 flex items-center gap-3">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleWebsiteLogoChange}
                    className="block w-full text-xs text-gray-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-gray-700 file:text-gray-300 hover:file:bg-gray-600"
                  />
                  {websiteLogoPreview && (
                    <img src={websiteLogoPreview} alt="Logo" className="w-10 h-10 object-cover rounded border border-gray-700" />
                  )}
                </div>
              </details>
            </div>

          </div>
        </div>
      </div>

      {/* Step 2: Wallet Configuration */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-green-600 text-white font-bold text-sm">2</span>
            Wallet Configuration
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Wallet Profile Buttons */}
            <button
              type="button"
              onClick={async () => {
                setConfigModalTab('wallet');
                setShowConfigModal(true);
                await loadWalletProfiles();
              }}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2 text-xs font-semibold shadow-lg shadow-blue-600/30"
              title="Load saved wallet profile (MEV settings, auto-buy, auto-sell, warmed wallet selections)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
              Load Wallet Profile
            </button>
            <button
              type="button"
              onClick={async () => {
                setConfigModalTab('wallet');
                setShowConfigModal(true);
                await loadWalletProfiles();
              }}
              className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors flex items-center gap-2 text-xs font-semibold shadow-lg shadow-green-600/30"
              title="Save current wallet settings (MEV protection, auto-buy configs, auto-sell configs, warmed wallet selections)"
            >
              <ArrowDownTrayIcon className="w-4 h-4" />
              Save Wallet Profile
            </button>
            {selectedWalletProfileId && (
              <div className="px-2 py-1 bg-emerald-900/30 border border-emerald-700/50 rounded-lg">
                <span className="text-[10px] text-emerald-300">
                  Active: <span className="font-semibold">{walletProfiles.find(p => p.id === selectedWalletProfileId)?.name || 'Unknown'}</span>
                </span>
              </div>
            )}
          </div>
        </div>
        
        {/* ═══════════════════════════════════════════════════════════════════════ */}
        {/* WALLET LAUNCH CONFIGURATION - Master Header with all settings */}
        {/* ═══════════════════════════════════════════════════════════════════════ */}
        <div className="mb-4 p-4 bg-gradient-to-r from-blue-900/30 via-purple-900/30 to-green-900/30 rounded-xl border border-blue-500/30 shadow-lg">
          {/* Header Row */}
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-700/50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-600/30 rounded-lg">
                <WalletIcon className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Wallet Launch Configuration</h3>
                <p className="text-xs text-gray-400">Master wallet settings and funding options</p>
              </div>
            </div>
            {/* Select Wallets button removed - each section now has its own selector */}
          </div>
          
          {/* Settings Grid - 3 columns */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Master Wallet */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-sm text-gray-300 flex items-center gap-1.5 font-medium">
                  <LockClosedIcon className="w-4 h-4 text-blue-400" />
                  Master Wallet *
                  <InfoTooltip content="Main funding wallet private key (base58). This wallet funds all token creation and transactions." />
                </label>
                {walletInfo?.fundingWallet?.balance !== undefined && (
                  <span className={`text-sm font-bold ${walletInfo.fundingWallet.balance >= (walletInfo.breakdown?.total || 0) ? 'text-green-400' : 'text-yellow-400'}`}>
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
                  className="w-full px-3 py-2 bg-black/50 border border-gray-700 rounded-lg text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter master wallet key"
                />
                <button
                  type="button"
                  onClick={() => setShowPrivateKey(!showPrivateKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded transition-colors"
                >
                  {showPrivateKey ? 'Hide' : 'Show'}
                </button>
              </div>
              {/* Public Key Display */}
              {walletInfo?.fundingWallet?.address && (
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-gray-500">Public Key:</span>
                  <span className="text-[11px] font-mono text-blue-400">{walletInfo.fundingWallet.address}</span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(walletInfo.fundingWallet.address);
                    }}
                    className="text-[10px] text-gray-500 hover:text-blue-400 transition-colors"
                    title="Copy address"
                  >
                    📋
                  </button>
                </div>
              )}
            </div>

            {/* Funding Method */}
            <div className="space-y-1.5">
              <label className="text-sm text-gray-300 flex items-center gap-1.5 font-medium">
                <RocketLaunchIcon className="w-4 h-4 text-green-400" />
                Funding Method
                <InfoTooltip content="How SOL is sent from your master wallet to launch wallets. Direct sends straight to wallets. Privacy routes through intermediary wallets to avoid bubble map detection." />
              </label>
              <div className="space-y-1">
                {/* Direct Option */}
                <button
                  type="button"
                  onClick={() => {
                    const newSettings = { ...settings };
                    newSettings.DIRECT_SEND_MODE = 'true';
                    newSettings.USE_MIXING_WALLETS = 'false';
                    newSettings.USE_MULTI_INTERMEDIARY_SYSTEM = 'false';
                    setSettings(newSettings);
                    apiService.updateSettings({
                      DIRECT_SEND_MODE: 'true',
                      USE_MIXING_WALLETS: 'false',
                      USE_MULTI_INTERMEDIARY_SYSTEM: 'false'
                    }).catch(err => console.error('Failed to save:', err));
                  }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-all border ${
                    settings.DIRECT_SEND_MODE !== 'false' && settings.USE_MIXING_WALLETS !== 'true' && settings.USE_MULTI_INTERMEDIARY_SYSTEM !== 'true'
                      ? 'bg-green-900/40 border-green-500/60 text-green-300'
                      : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Direct</span>
                    {settings.DIRECT_SEND_MODE !== 'false' && settings.USE_MIXING_WALLETS !== 'true' && settings.USE_MULTI_INTERMEDIARY_SYSTEM !== 'true' && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-green-600/40 text-green-300 rounded">ACTIVE</span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-500 mt-0.5">Simple direct send to wallets</p>
                </button>
                
                {/* Privacy Option */}
                <button
                  type="button"
                  onClick={() => {
                    const newSettings = { ...settings };
                    newSettings.DIRECT_SEND_MODE = 'false';
                    newSettings.USE_MIXING_WALLETS = 'true';
                    newSettings.USE_MULTI_INTERMEDIARY_SYSTEM = 'false';
                    setSettings(newSettings);
                    apiService.updateSettings({
                      DIRECT_SEND_MODE: 'false',
                      USE_MIXING_WALLETS: 'true',
                      USE_MULTI_INTERMEDIARY_SYSTEM: 'false'
                    }).catch(err => console.error('Failed to save:', err));
                  }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-all border ${
                    settings.USE_MIXING_WALLETS === 'true' || settings.USE_MULTI_INTERMEDIARY_SYSTEM === 'true'
                      ? 'bg-purple-900/40 border-purple-500/60 text-purple-300'
                      : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Privacy</span>
                    {(settings.USE_MIXING_WALLETS === 'true' || settings.USE_MULTI_INTERMEDIARY_SYSTEM === 'true') && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-purple-600/40 text-purple-300 rounded">{settings.NUM_INTERMEDIARY_HOPS || '2'} HOPS</span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-500 mt-0.5">Routes via {settings.NUM_INTERMEDIARY_HOPS || '2'} intermediary hops — helps avoid bubble map detection</p>
                </button>
              </div>
            </div>

            {/* MEV Protection */}
            <div className="space-y-1">
              <label className="text-sm text-gray-300 flex items-center gap-1.5 font-medium">
                <ExclamationTriangleIcon className="w-4 h-4 text-yellow-400" />
                Auto-Sell MEV Protection
                <InfoTooltip content="MEV bots can front-run your sells. This adds a delay after detecting external buy volume (net positive SOL from non-launch wallets) to confirm real trading activity before selling. Recommended: 2-3 seconds." />
              </label>
              <div className={`p-2.5 rounded-lg border ${mevProtectionEnabled ? 'bg-yellow-900/20 border-yellow-600/50' : 'bg-black/30 border-gray-700'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { 
                        setMevProtectionEnabled(!mevProtectionEnabled); 
                        apiService.setMevProtection({ enabled: !mevProtectionEnabled }).catch(() => {}); 
                      }}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${mevProtectionEnabled ? 'bg-yellow-500' : 'bg-gray-600'}`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${mevProtectionEnabled ? 'translate-x-4' : 'translate-x-1'}`} />
                    </button>
                    <span className={`text-sm font-medium ${mevProtectionEnabled ? 'text-yellow-400' : 'text-gray-400'}`}>
                      {mevProtectionEnabled ? 'Protected' : 'Disabled'}
                    </span>
                  </div>
                  {mevProtectionEnabled && (
                    <div className="flex items-center gap-1">
                      <button 
                        type="button" 
                        onClick={() => { setMevConfirmationDelay(2); apiService.setMevProtection({ confirmationDelaySec: 2 }).catch(() => {}); }} 
                        className={`px-2 py-1 text-xs rounded ${mevConfirmationDelay === 2 ? 'bg-yellow-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
                      >
                        2s
                      </button>
                      <button 
                        type="button" 
                        onClick={() => { setMevConfirmationDelay(3); apiService.setMevProtection({ confirmationDelaySec: 3 }).catch(() => {}); }} 
                        className={`px-2 py-1 text-xs rounded ${mevConfirmationDelay === 3 ? 'bg-yellow-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
                      >
                        3s
                      </button>
                      <button 
                        type="button" 
                        onClick={() => { setMevConfirmationDelay(5); apiService.setMevProtection({ confirmationDelaySec: 5 }).catch(() => {}); }} 
                        className={`px-2 py-1 text-xs rounded ${mevConfirmationDelay === 5 ? 'bg-yellow-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
                      >
                        5s
                      </button>
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-gray-500">
                  {mevProtectionEnabled 
                    ? `Waits ${mevConfirmationDelay}s after detecting external volume (net positive SOL) to confirm real buyers — prevents selling to MEV bot buys that instantly sell while trying to sandwich someone.`
                    : 'Enable to protect against MEV sandwich attacks on auto-sells.'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Wallet Configuration - 3 Column Layout: DEV, Bundle, Holder */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          {/* OLD Wallet Launch Settings - REMOVED, content moved to header above */}
          <div className="hidden p-3 bg-gray-900/50 rounded-lg border-l-4 border-blue-500">
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
                    {showPrivateKey ? '' : ''}
                  </button>
                </div>
                {settings.PRIVATE_KEY && !showPrivateKey && (
                  <p className="text-xs text-gray-500 mt-0.5 font-mono">
                    {settings.PRIVATE_KEY.length > 20 
                      ? `${settings.PRIVATE_KEY.substring(0, 8)}...${settings.PRIVATE_KEY.substring(settings.PRIVATE_KEY.length - 8)}`
                      : '*'.repeat(Math.min(settings.PRIVATE_KEY.length, 16))}
                  </p>
                )}
              </div>

              {/* Buyer/Creator Wallet - Simplified with "Use Funding Wallet" checkbox */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm text-gray-300 flex items-center gap-1">
                    <UserIcon className="w-3.5 h-3.5 text-blue-400" />
                    <span className="font-semibold">Buyer/Creator</span>
                    <InfoTooltip content="The wallet that creates the token and makes the dev buy. Use your Funding Wallet or select from your pre-warmed wallets below." />
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
                    <span className="ml-auto text-xs text-green-400"> Using funding wallet</span>
                  )}
                </div>
                
                {/* Show hint when not using funding wallet */}
                {settings.USE_FUNDING_AS_BUYER !== 'true' && settings.BUYER_WALLET !== settings.PRIVATE_KEY && (
                  <p className="text-xs text-gray-500 mt-1">
                    {useWarmedDevWallet 
                      ? '> Using selected DEV wallet below'
                      : '> Will create a fresh wallet'
                    }
                  </p>
                )}
              </div>

              {/* Funding Method - Simple selector with Direct LUT as default */}
              <div className="pt-1 border-t border-gray-800">
                <label className="block text-sm text-gray-300 mb-1 flex items-center gap-1">
                  <RocketLaunchIcon className="w-3.5 h-3.5 text-green-400" />
                  <span className="font-semibold">Funding Method</span>
                  <InfoTooltip content="Direct LUT: Simple direct funding (default, fastest). Privacy Routing: Routes through intermediate wallets for privacy (slower but more private)." />
                </label>
                <div className="space-y-1">
                  {/* Direct LUT - Default */}
                  <label 
                    className={`flex items-center gap-1.5 p-1.5 rounded border cursor-pointer transition-all ${
                      settings.DIRECT_SEND_MODE !== 'false' && settings.USE_MIXING_WALLETS !== 'true' && settings.USE_MULTI_INTERMEDIARY_SYSTEM !== 'true'
                        ? 'border-green-500 bg-green-900/30' 
                        : 'border-gray-700 bg-gray-800/30 hover:border-gray-600'
                    }`}
                    onClick={(e) => {
                      const target = e.target;
                      if (target.type !== 'radio' && target.tagName !== 'INPUT' && target.tagName !== 'BUTTON') {
                        e.preventDefault();
                        const newSettings = { ...settings };
                        newSettings.DIRECT_SEND_MODE = 'true';
                        newSettings.USE_MIXING_WALLETS = 'false';
                        newSettings.USE_MULTI_INTERMEDIARY_SYSTEM = 'false';
                        setSettings(newSettings);
                        if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
                        autoSaveTimeoutRef.current = setTimeout(() => {
                          apiService.updateSettings({
                            DIRECT_SEND_MODE: 'true',
                            USE_MIXING_WALLETS: 'false',
                            USE_MULTI_INTERMEDIARY_SYSTEM: 'false'
                          }).catch(err => console.error('Failed to save:', err));
                        }, 100);
                      }
                    }}
                  >
                    <input
                      type="radio"
                      name="funding-method"
                      checked={
                        (settings.DIRECT_SEND_MODE === 'true' || 
                         (settings.DIRECT_SEND_MODE === undefined && settings.USE_MIXING_WALLETS !== 'true' && settings.USE_MULTI_INTERMEDIARY_SYSTEM !== 'true'))
                      }
                      onChange={(e) => {
                        e.stopPropagation();
                        const newSettings = { ...settings };
                        newSettings.DIRECT_SEND_MODE = 'true';
                        newSettings.USE_MIXING_WALLETS = 'false';
                        newSettings.USE_MULTI_INTERMEDIARY_SYSTEM = 'false';
                        setSettings(newSettings);
                        if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
                        autoSaveTimeoutRef.current = setTimeout(() => {
                          apiService.updateSettings({
                            DIRECT_SEND_MODE: 'true',
                            USE_MIXING_WALLETS: 'false',
                            USE_MULTI_INTERMEDIARY_SYSTEM: 'false'
                          }).catch(err => console.error('Failed to save:', err));
                        }, 100);
                      }}
                      className="w-3 h-3 text-green-500 bg-gray-800 border-gray-700 focus:ring-1 focus:ring-green-500 cursor-pointer"
                    />
                    <span className="text-sm text-white flex-1">Direct LUT</span>
                    <span className="text-xs px-1.5 py-0.5 bg-green-600/30 text-green-400 rounded font-medium">DEFAULT</span>
                  </label>

                  {/* Privacy Routing - Always visible */}
                  <label 
                    className={`flex items-center gap-1.5 p-1.5 rounded border cursor-pointer transition-all ${
                      settings.USE_MIXING_WALLETS === 'true' || settings.USE_MULTI_INTERMEDIARY_SYSTEM === 'true'
                        ? 'border-purple-500 bg-purple-900/30' 
                        : 'border-gray-700 bg-gray-800/30 hover:border-gray-600'
                    }`}
                    onClick={(e) => {
                      const target = e.target;
                      if (target.type !== 'radio' && target.type !== 'number' && target.tagName !== 'INPUT' && target.tagName !== 'BUTTON' && target.tagName !== 'SELECT') {
                        e.preventDefault();
                        const newSettings = { ...settings };
                        newSettings.DIRECT_SEND_MODE = 'false';
                        newSettings.USE_MIXING_WALLETS = settings.USE_MULTI_INTERMEDIARY_SYSTEM !== 'true' ? 'true' : 'false';
                        setSettings(newSettings);
                        if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
                        autoSaveTimeoutRef.current = setTimeout(() => {
                          apiService.updateSettings({
                            DIRECT_SEND_MODE: 'false',
                            USE_MIXING_WALLETS: settings.USE_MULTI_INTERMEDIARY_SYSTEM !== 'true' ? 'true' : 'false'
                          }).catch(err => console.error('Failed to save:', err));
                        }, 100);
                      }
                    }}
                  >
                    <input
                      type="radio"
                      name="funding-method"
                      checked={settings.USE_MIXING_WALLETS === 'true' || settings.USE_MULTI_INTERMEDIARY_SYSTEM === 'true'}
                      onChange={(e) => {
                        e.stopPropagation();
                        const newSettings = { ...settings };
                        newSettings.DIRECT_SEND_MODE = 'false';
                        newSettings.USE_MIXING_WALLETS = settings.USE_MULTI_INTERMEDIARY_SYSTEM !== 'true' ? 'true' : 'false';
                        setSettings(newSettings);
                        if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
                        autoSaveTimeoutRef.current = setTimeout(() => {
                          apiService.updateSettings({
                            DIRECT_SEND_MODE: 'false',
                            USE_MIXING_WALLETS: settings.USE_MULTI_INTERMEDIARY_SYSTEM !== 'true' ? 'true' : 'false'
                          }).catch(err => console.error('Failed to save:', err));
                        }, 100);
                      }}
                      className="w-3 h-3 text-purple-500 bg-gray-800 border-gray-700 focus:ring-1 focus:ring-purple-500 cursor-pointer"
                    />
                    <span className="text-sm text-white flex-1">Privacy Routing</span>
                    {(settings.USE_MIXING_WALLETS === 'true' || settings.USE_MULTI_INTERMEDIARY_SYSTEM === 'true') && (
                      <select
                        value={settings.USE_MULTI_INTERMEDIARY_SYSTEM === 'true' ? 'multi' : 'mixing'}
                        onChange={(e) => {
                          const newSettings = { ...settings };
                          newSettings.DIRECT_SEND_MODE = 'false';
                          if (e.target.value === 'multi') {
                            newSettings.USE_MULTI_INTERMEDIARY_SYSTEM = 'true';
                            newSettings.USE_MIXING_WALLETS = 'false';
                          } else {
                            newSettings.USE_MULTI_INTERMEDIARY_SYSTEM = 'false';
                            newSettings.USE_MIXING_WALLETS = 'true';
                          }
                          setSettings(newSettings);
                          if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
                          autoSaveTimeoutRef.current = setTimeout(() => {
                            apiService.updateSettings({
                              DIRECT_SEND_MODE: 'false',
                              USE_MULTI_INTERMEDIARY_SYSTEM: e.target.value === 'multi' ? 'true' : 'false',
                              USE_MIXING_WALLETS: e.target.value === 'multi' ? 'false' : 'true'
                            }).catch(err => console.error('Failed to save:', err));
                          }, 100);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="ml-2 px-1.5 py-0.5 bg-black/50 border border-gray-700 rounded text-white text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
                      >
                        <option value="mixing">Mixing (Fast)</option>
                        <option value="multi">Multi-Inter</option>
                      </select>
                    )}
                    {settings.USE_MULTI_INTERMEDIARY_SYSTEM === 'true' && (
                      <input
                        type="number"
                        min="0"
                        max="5"
                        step="1"
                        value={settings.NUM_INTERMEDIARY_HOPS || '2'}
                        onChange={(e) => handleChange('NUM_INTERMEDIARY_HOPS', e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="ml-1 w-10 px-1 py-0.5 bg-black/50 border border-gray-700 rounded text-white text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
                      />
                    )}
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* DEV Wallet */}
          <div className="p-4 bg-gray-900/50 rounded-lg border-l-4 border-purple-500">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <label className="block text-lg font-bold text-purple-400 flex items-center gap-2">
                <UserIcon className="w-5 h-5" />
                DEV Wallet
                <span className="text-[10px] px-2 py-0.5 bg-purple-600/30 text-purple-300 rounded">Creates Token</span>
            </label>
            </div>
            
            {/* Wallet Source Toggle */}
            <div className="mb-4 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400 font-medium">Wallet Source:</span>
                {(settings.USE_FUNDING_AS_BUYER === 'true' || settings.BUYER_WALLET === settings.PRIVATE_KEY) ? (
                  <span className="text-[10px] font-mono text-blue-400">Master Wallet</span>
                ) : useWarmedDevWallet && selectedCreatorWallet ? (
                  <span className="text-[10px] font-mono text-green-400">{selectedCreatorWallet.slice(0, 6)}...{selectedCreatorWallet.slice(-4)}</span>
                ) : null}
              </div>
              <div className="flex gap-2">
                {/* Use Master Wallet as Creator */}
                <button
                  type="button"
                  onClick={() => {
                    handleChange('BUYER_WALLET', settings.PRIVATE_KEY || '');
                    handleChange('USE_FUNDING_AS_BUYER', 'true');
                    setUseWarmedDevWallet(false);
                    setSelectedCreatorWallet(null);
                    setTimeout(() => loadWalletInfo(), 500);
                  }}
                  className={`flex-1 px-2 py-2 rounded-lg text-[11px] font-medium transition-all flex items-center justify-center gap-1 ${
                    settings.USE_FUNDING_AS_BUYER === 'true' || settings.BUYER_WALLET === settings.PRIVATE_KEY
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                  }`}
                >
                  <LockClosedIcon className="w-3.5 h-3.5" />
                  Use Master
                </button>
                {/* Auto-Create */}
                <button
                  type="button"
                  onClick={() => {
                    handleChange('BUYER_WALLET', '');
                    handleChange('USE_FUNDING_AS_BUYER', 'false');
                    setUseWarmedDevWallet(false);
                    setSelectedCreatorWallet(null);
                  }}
                  className={`flex-1 px-2 py-2 rounded-lg text-[11px] font-medium transition-all flex items-center justify-center gap-1 ${
                    !useWarmedDevWallet && settings.USE_FUNDING_AS_BUYER !== 'true' && settings.BUYER_WALLET !== settings.PRIVATE_KEY
                      ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30'
                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Auto-Create
                </button>
                {/* Use Existing */}
                <button
                  type="button"
                  onClick={() => {
                    handleChange('BUYER_WALLET', '');
                    handleChange('USE_FUNDING_AS_BUYER', 'false');
                    setUseWarmedDevWallet(true);
                    loadWarmedWallets(false); // Don't refresh balances - use cached data for speed
                    setWalletModalMode('dev');
                    setShowWalletModal(true);
                  }}
                  className={`flex-1 px-2 py-2 rounded-lg text-[11px] font-medium transition-all flex items-center justify-center gap-1 ${
                    useWarmedDevWallet && settings.USE_FUNDING_AS_BUYER !== 'true' && settings.BUYER_WALLET !== settings.PRIVATE_KEY
                      ? 'bg-green-600 text-white shadow-lg shadow-green-600/30'
                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                  }`}
                >
                  <WalletIcon className="w-3.5 h-3.5" />
                  Use Existing
                </button>
              </div>
              {useWarmedDevWallet && !selectedCreatorWallet && settings.USE_FUNDING_AS_BUYER !== 'true' && (
                <button
                  type="button"
                  onClick={() => {
                    loadWarmedWallets(false); // Don't refresh balances - use cached data for speed
                    setWalletModalMode('dev');
                    setShowWalletModal(true);
                  }}
                  className="mt-2 w-full px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5"
                >
                  <WalletIcon className="w-3.5 h-3.5" />
                  Select DEV Wallet ({warmedWallets.length} available)
                </button>
              )}
              {useWarmedDevWallet && selectedCreatorWallet && (
                <button
                  type="button"
                  onClick={() => {
                    loadWarmedWallets(false); // Don't refresh balances - use cached data for speed
                    setWalletModalMode('dev');
                    setShowWalletModal(true);
                  }}
                  className="mt-2 w-full px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5"
                >
                  <WalletIcon className="w-3.5 h-3.5" />
                  Change DEV Wallet
                </button>
              )}
              {(settings.USE_FUNDING_AS_BUYER === 'true' || settings.BUYER_WALLET === settings.PRIVATE_KEY) && (
                <p className="mt-2 text-[10px] text-blue-400">→ Using your Master Wallet as the token creator</p>
              )}
            </div>

            {/* DEV Wallet Card - Similar style to Bundle wallets */}
            {(() => {
              const isDevAutoSellEnabled = parseFloat(devAutoSellConfig.threshold) > 0;
              const devWalletBalance = useWarmedDevWallet && selectedCreatorWallet 
                ? (warmedWallets.find(w => w.address === selectedCreatorWallet)?.solBalance || 0)
                : 0;
              const isUsingMaster = settings.USE_FUNDING_AS_BUYER === 'true' || settings.BUYER_WALLET === settings.PRIVATE_KEY;
              const isUsingExisting = useWarmedDevWallet && selectedCreatorWallet;
              const isAutoCreated = !isUsingMaster && !isUsingExisting;
              
              return (
                <div className={`mt-3 p-4 rounded-lg border transition-all ${isDevAutoSellEnabled ? 'bg-purple-900/20 border-purple-600/50' : 'bg-gray-800/50 border-gray-700'}`}>
                  {/* Header with wallet info */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className={`p-1.5 rounded ${isDevAutoSellEnabled ? 'bg-purple-500/20' : 'bg-gray-700'}`}>
                        <UserIcon className={`w-4 h-4 ${isDevAutoSellEnabled ? 'text-purple-400' : 'text-gray-400'}`} />
                      </div>
              <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-purple-400">DEV Wallet</span>
                          {isUsingMaster && (
                            <span className="text-[9px] px-1.5 py-0.5 bg-blue-600/30 text-blue-400 rounded font-medium">MASTER</span>
                          )}
                          {isUsingExisting && (
                            <span className="text-[9px] px-1.5 py-0.5 bg-green-600/30 text-green-400 rounded font-medium">EXISTING</span>
                          )}
                          {isAutoCreated && (
                            <span className="text-[9px] px-1.5 py-0.5 bg-purple-600/30 text-purple-400 rounded font-medium">AUTO-CREATED</span>
                          )}
                        </div>
                        <span className="text-[10px] font-mono text-gray-500">
                          {isUsingMaster && walletInfo?.fundingWallet?.address ? `${walletInfo.fundingWallet.address.slice(0, 8)}...${walletInfo.fundingWallet.address.slice(-6)}` : null}
                          {isUsingExisting && selectedCreatorWallet ? `${selectedCreatorWallet.slice(0, 8)}...${selectedCreatorWallet.slice(-6)}` : null}
                          {isAutoCreated && 'Will be created at launch'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isDevAutoSellEnabled && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-red-600/30 text-red-400 rounded font-medium">SELL @ {devAutoSellConfig.threshold} SOL vol</span>
                      )}
                      {isUsingExisting && devWalletBalance > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-green-600/30 text-green-400 rounded">{devWalletBalance.toFixed(3)} SOL</span>
                      )}
                    </div>
                  </div>
                  
                  {/* Buy Amount */}
                  <div className="mb-3">
                    <label className="block text-xs text-gray-400 mb-1 font-medium">Buy Amount (SOL)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={settings.BUYER_AMOUNT || '1'}
                  onChange={(e) => handleChange('BUYER_AMOUNT', e.target.value)}
                      className="w-full px-3 py-2 bg-black/50 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
                  
                  {/* Auto-Sell Toggle */}
                  <div className={`p-3 rounded-lg border transition-all ${isDevAutoSellEnabled ? 'bg-red-900/30 border-red-600/50' : 'bg-gray-900/50 border-gray-700 hover:border-gray-600'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                        <CurrencyDollarIcon className={`w-3.5 h-3.5 ${isDevAutoSellEnabled ? 'text-red-400' : 'text-gray-500'}`} />
                        Auto-Sell (Take Profit)
                </label>
                      <button
                        type="button"
                        onClick={() => {
                          if (isDevAutoSellEnabled) {
                            setDevAutoSellConfig({ threshold: '', enabled: false });
                          } else {
                            const defaultThreshold = (parseFloat(settings.BUYER_AMOUNT || '1') * 2).toFixed(1);
                            setDevAutoSellConfig({ threshold: defaultThreshold, enabled: true });
                          }
                        }}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isDevAutoSellEnabled ? 'bg-red-500' : 'bg-gray-600'}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform ${isDevAutoSellEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </div>
                    <p className="text-[10px] text-gray-500">
                      {isDevAutoSellEnabled ? `Sells when ${devAutoSellConfig.threshold} SOL of external volume detected` : 'Enable to auto-sell based on external volume'}
                    </p>
                    
                    {/* Threshold input when enabled */}
                    {isDevAutoSellEnabled && (
                      <div className="mt-2 pt-2 border-t border-red-700/50 space-y-2">
                        <div>
                          <label className="block text-[10px] text-gray-500 mb-1">Sell when external volume reaches (SOL)</label>
                          <div className="flex gap-1">
                <input
                  type="number"
                              step="0.1"
                              min="0.1"
                              value={devAutoSellConfig.threshold}
                  onChange={(e) => {
                                const val = e.target.value;
                                setDevAutoSellConfig({ threshold: val, enabled: parseFloat(val) > 0 });
                              }}
                              className="flex-1 min-w-0 px-2 py-1 bg-black/50 border border-gray-700 rounded text-white text-xs focus:outline-none focus:ring-1 focus:ring-red-500"
                            />
                            <button type="button" onClick={() => setDevAutoSellConfig({ threshold: (parseFloat(settings.BUYER_AMOUNT || '1') * 2).toFixed(1), enabled: true })} className="flex-shrink-0 px-2 py-1 text-[10px] bg-red-600 hover:bg-red-700 text-white rounded">2x</button>
                            <button type="button" onClick={() => setDevAutoSellConfig({ threshold: (parseFloat(settings.BUYER_AMOUNT || '1') * 3).toFixed(1), enabled: true })} className="flex-shrink-0 px-2 py-1 text-[10px] bg-orange-600 hover:bg-orange-700 text-white rounded">3x</button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Bundle Wallets */}
          {launchMode === 'bundle' && (
          <div className="p-4 bg-gray-900/50 rounded-lg border-l-4 border-green-500">
            {/* Header */}
            <div className="flex items-center justify-between mb-3 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <CubeIcon className="w-5 h-5 text-green-400 flex-shrink-0" />
                <span className="text-lg font-bold text-green-400 whitespace-nowrap">Bundle Wallets</span>
                <span className="text-[10px] px-2 py-0.5 bg-green-600/30 text-green-300 rounded whitespace-nowrap flex-shrink-0">Atomic Buy with DEV</span>
              </div>
              <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">
                {useWarmedBundleWallets 
                  ? `${selectedBundleWallets.length} existing${additionalBundleCount > 0 ? ` + ${additionalBundleCount} new` : ''}`
                  : `${settings.BUNDLE_WALLET_COUNT || 0} wallets`
                }
              </span>
            </div>
            
            {/* Wallet Source Toggle */}
            <div className="mb-4 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400 font-medium">Wallet Source:</span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setUseWarmedBundleWallets(false);
                    setSelectedBundleWallets([]);
                    setAdditionalBundleCount(0);
                  }}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                    !useWarmedBundleWallets
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Auto-Create
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUseWarmedBundleWallets(true);
                    loadWarmedWallets(false); // Don't refresh balances - use cached data for speed
                    setWalletModalMode('bundle');
                    setShowWalletModal(true);
                  }}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                    useWarmedBundleWallets
                      ? 'bg-green-600 text-white shadow-lg shadow-green-600/30'
                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                  }`}
                >
                  <WalletIcon className="w-4 h-4" />
                  Select + Create
                </button>
              </div>
              {/* Select Bundle Wallets Button */}
              {useWarmedBundleWallets && (
                <button
                  type="button"
                  onClick={() => {
                    loadWarmedWallets(false); // Don't refresh balances - use cached data for speed
                    setWalletModalMode('bundle');
                    setShowWalletModal(true);
                  }}
                  className="mt-2 w-full px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5"
                >
                  <WalletIcon className="w-3.5 h-3.5" />
                  {selectedBundleWallets.length > 0 ? `Change Selection (${selectedBundleWallets.length} selected)` : `Select Bundle Wallets (${warmedWallets.length} available)`}
                </button>
              )}
              {/* Additional auto-create option when using existing wallets */}
              {useWarmedBundleWallets && (
                <div className="mt-3 pt-3 border-t border-gray-700">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-green-400 font-medium">Also auto-create new wallets?</p>
                      <p className="text-[10px] text-gray-500">Will be funded and bundle alongside your selected wallets</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => setAdditionalBundleCount(Math.max(0, additionalBundleCount - 1))} className="w-7 h-7 rounded bg-gray-700 hover:bg-gray-600 text-white text-sm font-bold">-</button>
                      <span className="w-8 text-center text-sm text-white font-bold">{additionalBundleCount}</span>
                      <button type="button" onClick={() => setAdditionalBundleCount(additionalBundleCount + 1)} className="w-7 h-7 rounded bg-green-600 hover:bg-green-700 text-white text-sm font-bold">+</button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Wallet Count (only for auto-create mode) */}
            {!useWarmedBundleWallets && (
              <div className="mb-4">
                <label className="block text-xs text-gray-400 mb-1 font-medium">Number of Bundle Wallets</label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={settings.BUNDLE_WALLET_COUNT || '0'}
                  onChange={(e) => handleChange('BUNDLE_WALLET_COUNT', e.target.value)}
                  className="w-full px-3 py-2 bg-black/50 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              )}
            
            <div className="space-y-2">
              {/* Per-Wallet Configuration - Bundle Wallets */}
              {(() => {
                const bundleCount = useWarmedBundleWallets ? selectedBundleWallets.length : parseInt(settings.BUNDLE_WALLET_COUNT || '0');
                const defaultAmount = settings.SWAP_AMOUNT || '0.5';
                
                if (bundleCount > 0) {
                  return (
                    <div className="space-y-3">
                      {/* Quick Fill All Wallets */}
                      <div>
                        <label className="block text-sm text-gray-400 mb-1.5 flex items-center gap-1">
                          <span className="font-semibold">Quick Fill All Wallets</span>
                          <InfoTooltip content="Click a preset to set all bundle wallets to that amount. You can still adjust individual amounts below." />
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                          {[0.1, 0.5, 1, 2].map((amount) => (
                            <button
                              key={amount}
                              type="button"
                              onClick={() => {
                                handleChange('SWAP_AMOUNT', amount.toString());
                                const newAmounts = Array(bundleCount).fill(amount.toString());
                            handleChange('BUNDLE_SWAP_AMOUNTS', newAmounts.join(','));
                          }}
                              className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all bg-gray-700 text-gray-300 hover:bg-green-600 hover:text-white"
                            >
                              {amount} SOL
                            </button>
                          ))}
                        </div>
                      </div>
                      
                      {/* Per-Wallet Settings */}
                      <div>
                        <label className="block text-sm text-gray-400 mb-2 flex items-center gap-1">
                          <WalletIcon className="w-4 h-4 text-green-400" />
                          <span className="font-semibold">Wallet Settings</span>
                        </label>
                        <div className="space-y-2 max-h-96 overflow-y-auto">
                          {useWarmedBundleWallets ? (<>
                            {/* Warmed bundle wallets */}
                            {selectedBundleWallets.map((addr, i) => {
                              const wallet = warmedWallets.find(w => w.address === addr);
                              const balance = wallet?.solBalance || wallet?.balance || 0;
                              const amountsArray = settings.BUNDLE_SWAP_AMOUNTS 
                                ? settings.BUNDLE_SWAP_AMOUNTS.split(',').map(a => a.trim())
                                : [];
                              const originalIdx = selectedBundleWallets.indexOf(addr);
                              const currentAmount = amountsArray[originalIdx] || '';
                              const autoSellConfig = bundleAutoSellConfigs[addr] || { threshold: '', enabled: false };
                              const isAutoSellEnabled = parseFloat(autoSellConfig.threshold) > 0;
                              
                              return (
                                <div key={addr} className={`p-4 rounded-lg border transition-all ${isAutoSellEnabled ? 'bg-green-900/20 border-green-600/50' : 'bg-gray-800/50 border-gray-700'}`}>
                                  {/* Header with wallet info */}
                                  <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                      <div className={`p-1.5 rounded ${isAutoSellEnabled ? 'bg-green-500/20' : 'bg-gray-700'}`}>
                                        <WalletIcon className={`w-4 h-4 ${isAutoSellEnabled ? 'text-green-400' : 'text-gray-400'}`} />
                                      </div>
                                      <div>
                                        <div className="flex items-center gap-2">
                                    <span className="text-sm font-bold text-green-400">Bundle #{i + 1}</span>
                                          <span className="text-[9px] px-1.5 py-0.5 bg-green-600/30 text-green-400 rounded font-medium">EXISTING</span>
                                        </div>
                                        <span className="text-[10px] font-mono text-gray-500">{addr.slice(0, 8)}...{addr.slice(-6)}</span>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {isAutoSellEnabled && (
                                        <span className="text-[10px] px-1.5 py-0.5 bg-red-600/30 text-red-400 rounded font-medium">SELL @ {autoSellConfig.threshold} SOL vol</span>
                                      )}
                                      <span className="text-[10px] px-1.5 py-0.5 bg-green-600/30 text-green-400 rounded">{balance.toFixed(3)} SOL</span>
                                    </div>
                                  </div>
                                  
                                  {/* Buy Amount */}
                                  <div className="mb-3">
                                    <label className="block text-xs text-gray-400 mb-1 font-medium">Buy Amount (SOL)</label>
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        max={balance}
                                        value={currentAmount}
                                        onChange={(e) => {
                                          const newAmounts = [...amountsArray];
                                          while (newAmounts.length <= originalIdx) {
                                            newAmounts.push('');
                                          }
                                          newAmounts[originalIdx] = e.target.value || '';
                                          handleChange('BUNDLE_SWAP_AMOUNTS', newAmounts.join(','));
                                        }}
                                        placeholder={defaultAmount}
                                      className="w-full px-3 py-2 bg-black/50 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                                      />
                                    </div>
                                    
                                  {/* Auto-Sell Toggle */}
                                  <div className={`p-3 rounded-lg border transition-all ${isAutoSellEnabled ? 'bg-red-900/30 border-red-600/50' : 'bg-gray-900/50 border-gray-700 hover:border-gray-600'}`}>
                                    <div className="flex items-center justify-between mb-2">
                                      <label className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                                        <CurrencyDollarIcon className={`w-3.5 h-3.5 ${isAutoSellEnabled ? 'text-red-400' : 'text-gray-500'}`} />
                                        Auto-Sell (Take Profit)
                                      </label>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const newConfigs = { ...bundleAutoSellConfigs };
                                          if (isAutoSellEnabled) {
                                            newConfigs[addr] = { threshold: '', enabled: false };
                                          } else {
                                            const buyAmt = parseFloat(currentAmount) || parseFloat(defaultAmount);
                                            const defaultThreshold = (buyAmt * 2).toFixed(1);
                                            newConfigs[addr] = { threshold: defaultThreshold, enabled: true };
                                          }
                                          setBundleAutoSellConfigs(newConfigs);
                                        }}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isAutoSellEnabled ? 'bg-red-500' : 'bg-gray-600'}`}
                                      >
                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform ${isAutoSellEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                                      </button>
                                    </div>
                                    <p className="text-[10px] text-gray-500">
                                      {isAutoSellEnabled ? `Sells when ${autoSellConfig.threshold} SOL of external volume detected` : 'Enable to auto-sell based on external volume'}
                                    </p>
                                    
                                    {/* Threshold input when enabled */}
                                    {isAutoSellEnabled && (
                                      <div className="mt-2 pt-2 border-t border-red-700/50 space-y-2">
                                        <div>
                                          <label className="block text-[10px] text-gray-500 mb-1">Sell when external volume reaches (SOL)</label>
                                      <div className="flex gap-1">
                                        <input
                                          type="number"
                                          step="0.1"
                                              min="0.1"
                                          value={autoSellConfig.threshold}
                                          onChange={(e) => {
                                            const newConfigs = { ...bundleAutoSellConfigs };
                                                const val = e.target.value;
                                                newConfigs[addr] = { threshold: val, enabled: parseFloat(val) > 0 };
                                            setBundleAutoSellConfigs(newConfigs);
                                          }}
                                              className="flex-1 min-w-0 px-2 py-1 bg-black/50 border border-gray-700 rounded text-white text-xs focus:outline-none focus:ring-1 focus:ring-red-500"
                                            />
                                            <button type="button" onClick={() => { const n = { ...bundleAutoSellConfigs }; const b = parseFloat(currentAmount) || parseFloat(defaultAmount); n[addr] = { threshold: (b * 2).toFixed(1), enabled: true }; setBundleAutoSellConfigs(n); }} className="flex-shrink-0 px-2 py-1 text-[10px] bg-red-600 hover:bg-red-700 text-white rounded">2x</button>
                                            <button type="button" onClick={() => { const n = { ...bundleAutoSellConfigs }; const b = parseFloat(currentAmount) || parseFloat(defaultAmount); n[addr] = { threshold: (b * 3).toFixed(1), enabled: true }; setBundleAutoSellConfigs(n); }} className="flex-shrink-0 px-2 py-1 text-[10px] bg-orange-600 hover:bg-orange-700 text-white rounded">3x</button>
                                          </div>
                                        </div>
                                        </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                            
                            {/* Additional Auto-Created Bundle Wallets */}
                            {additionalBundleCount > 0 && Array.from({ length: additionalBundleCount }, (_, i) => {
                              const walletIdx = selectedBundleWallets.length + i + 1;
                              const walletId = `bundle-new-${i + 1}`;
                              const amountsArray = settings.BUNDLE_SWAP_AMOUNTS 
                                ? settings.BUNDLE_SWAP_AMOUNTS.split(',').map(a => a.trim())
                                : [];
                              const currentAmount = amountsArray[selectedBundleWallets.length + i] || defaultAmount;
                              const autoSellConfig = bundleAutoSellConfigs[walletId] || { threshold: '', enabled: false };
                              const isAutoSellEnabled = parseFloat(autoSellConfig.threshold) > 0;
                              
                              return (
                                <div key={walletId} className={`p-4 rounded-lg border transition-all ${isAutoSellEnabled ? 'bg-blue-900/20 border-blue-600/50' : 'bg-gray-800/50 border-gray-700'}`}>
                                  <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                      <div className={`p-1.5 rounded ${isAutoSellEnabled ? 'bg-blue-500/20' : 'bg-gray-700'}`}>
                                        <WalletIcon className={`w-4 h-4 ${isAutoSellEnabled ? 'text-blue-400' : 'text-gray-400'}`} />
                                      </div>
                                      <div>
                                        <div className="flex items-center gap-2">
                                          <span className="text-sm font-bold text-blue-400">Bundle #{walletIdx}</span>
                                          <span className="text-[9px] px-1.5 py-0.5 bg-blue-600/30 text-blue-400 rounded font-medium">AUTO-CREATED</span>
                                        </div>
                                        <span className="text-[10px] text-gray-500">Buys atomically with DEV at launch</span>
                                      </div>
                                    </div>
                                    {isAutoSellEnabled && (
                                      <span className="text-[10px] px-1.5 py-0.5 bg-red-600/30 text-red-400 rounded font-medium">SELL @ {autoSellConfig.threshold} SOL vol</span>
                                    )}
                                  </div>
                                  
                                  <div className="mb-3">
                                    <label className="block text-xs text-gray-400 mb-1 font-medium">Buy Amount (SOL)</label>
                                        <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      value={currentAmount}
                                          onChange={(e) => {
                                        const newAmounts = [...amountsArray];
                                        const targetIdx = selectedBundleWallets.length + i;
                                        while (newAmounts.length <= targetIdx) {
                                          newAmounts.push(defaultAmount);
                                        }
                                        newAmounts[targetIdx] = e.target.value || '';
                                        handleChange('BUNDLE_SWAP_AMOUNTS', newAmounts.join(','));
                                      }}
                                      placeholder={defaultAmount}
                                      className="w-full px-3 py-2 bg-black/50 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    />
                                  </div>
                                  
                                  <div className={`p-3 rounded-lg border transition-all ${isAutoSellEnabled ? 'bg-red-900/30 border-red-600/50' : 'bg-gray-900/50 border-gray-700 hover:border-gray-600'}`}>
                                    <div className="flex items-center justify-between mb-2">
                                      <label className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                                        <CurrencyDollarIcon className={`w-3.5 h-3.5 ${isAutoSellEnabled ? 'text-red-400' : 'text-gray-500'}`} />
                                        Auto-Sell
                                      </label>
                                      <button
                                        type="button"
                                        onClick={() => {
                                            const newConfigs = { ...bundleAutoSellConfigs };
                                          if (isAutoSellEnabled) {
                                            delete newConfigs[walletId];
                                          } else {
                                            const defaultThreshold = (parseFloat(currentAmount) * 2).toFixed(1);
                                            newConfigs[walletId] = { threshold: defaultThreshold, enabled: true };
                                          }
                                            setBundleAutoSellConfigs(newConfigs);
                                          }}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isAutoSellEnabled ? 'bg-red-500' : 'bg-gray-600'}`}
                                      >
                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform ${isAutoSellEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                                      </button>
                                    </div>
                                    <p className="text-[10px] text-gray-500">
                                      {isAutoSellEnabled ? `Sells when ${autoSellConfig.threshold} SOL of external volume detected` : 'Enable to auto-sell based on external volume'}
                                    </p>
                                    
                                    {isAutoSellEnabled && (
                                      <div className="mt-2 pt-2 border-t border-red-700/50 space-y-2">
                                        <div>
                                          <label className="block text-[10px] text-gray-500 mb-1">Sell when external volume reaches (SOL)</label>
                                          <div className="flex gap-1">
                                            <input
                                              type="number"
                                              step="0.1"
                                              min="0.1"
                                              value={autoSellConfig.threshold}
                                              onChange={(e) => {
                                                const newConfigs = { ...bundleAutoSellConfigs };
                                                const val = e.target.value;
                                                newConfigs[walletId] = { threshold: val, enabled: parseFloat(val) > 0 };
                                                setBundleAutoSellConfigs(newConfigs);
                                              }}
                                              className="flex-1 min-w-0 px-2 py-1 bg-black/50 border border-gray-700 rounded text-white text-xs focus:outline-none focus:ring-1 focus:ring-red-500"
                                            />
                                            <button type="button" onClick={() => { const n = { ...bundleAutoSellConfigs }; const t = (parseFloat(currentAmount) * 2).toFixed(1); n[walletId] = { threshold: t, enabled: true }; setBundleAutoSellConfigs(n); }} className="flex-shrink-0 px-2 py-1 text-[10px] bg-red-600 hover:bg-red-700 text-white rounded">2x</button>
                                            <button type="button" onClick={() => { const n = { ...bundleAutoSellConfigs }; const t = (parseFloat(currentAmount) * 3).toFixed(1); n[walletId] = { threshold: t, enabled: true }; setBundleAutoSellConfigs(n); }} className="flex-shrink-0 px-2 py-1 text-[10px] bg-orange-600 hover:bg-orange-700 text-white rounded">3x</button>
                                      </div>
                                    </div>
                                        </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </>) : (
                            // Fresh bundle wallets (when not using warmed at all)
                            Array.from({ length: bundleCount }, (_, i) => {
                              const walletId = `bundle-${i + 1}`;
                              const amountsArray = settings.BUNDLE_SWAP_AMOUNTS 
                                ? settings.BUNDLE_SWAP_AMOUNTS.split(',').map(a => a.trim())
                                : [];
                              const currentAmount = amountsArray[i] || defaultAmount;
                              const autoSellConfig = bundleAutoSellConfigs[walletId] || { threshold: '', enabled: false };
                              
                              const isAutoSellEnabled = parseFloat(autoSellConfig.threshold) > 0;
                              
                              return (
                                <div key={i} className={`p-4 rounded-lg border transition-all ${isAutoSellEnabled ? 'bg-green-900/20 border-green-600/50' : 'bg-gray-800/50 border-gray-700'}`}>
                                  {/* Header with wallet info */}
                                  <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                      <div className={`p-1.5 rounded ${isAutoSellEnabled ? 'bg-green-500/20' : 'bg-gray-700'}`}>
                                        <WalletIcon className={`w-4 h-4 ${isAutoSellEnabled ? 'text-green-400' : 'text-gray-400'}`} />
                                      </div>
                                      <div>
                                        <div className="flex items-center gap-2">
                                    <span className="text-sm font-bold text-green-400">Bundle #{i + 1}</span>
                                          <span className="text-[9px] px-1.5 py-0.5 bg-blue-600/30 text-blue-400 rounded font-medium">AUTO-CREATED</span>
                                        </div>
                                        <span className="text-[10px] text-gray-500">Buys atomically with DEV at launch</span>
                                      </div>
                                    </div>
                                    {/* Status badge */}
                                    {isAutoSellEnabled && (
                                      <span className="text-[10px] px-1.5 py-0.5 bg-red-600/30 text-red-400 rounded font-medium">SELL @ {autoSellConfig.threshold} SOL vol</span>
                                    )}
                                  </div>
                                  
                                  {/* Buy Amount */}
                                  <div className="mb-3">
                                    <label className="block text-xs text-gray-400 mb-1 font-medium">Buy Amount (SOL)</label>
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0.01"
                                        value={currentAmount}
                                        onChange={(e) => {
                                          const newAmounts = Array(bundleCount).fill('').map((_, idx) => {
                                          if (idx === i) return e.target.value || defaultAmount;
                                            return amountsArray[idx] || defaultAmount;
                                          });
                                          handleChange('BUNDLE_SWAP_AMOUNTS', newAmounts.join(','));
                                        }}
                                      className="w-full px-3 py-2 bg-black/50 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                                      />
                                    </div>
                                    
                                  {/* Auto-Sell Toggle */}
                                  <div className={`p-3 rounded-lg border transition-all ${isAutoSellEnabled ? 'bg-red-900/30 border-red-600/50' : 'bg-gray-900/50 border-gray-700 hover:border-gray-600'}`}>
                                    <div className="flex items-center justify-between mb-2">
                                      <label className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                                        <CurrencyDollarIcon className={`w-3.5 h-3.5 ${isAutoSellEnabled ? 'text-red-400' : 'text-gray-500'}`} />
                                        Auto-Sell (Take Profit)
                                      </label>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const newConfigs = { ...bundleAutoSellConfigs };
                                          if (isAutoSellEnabled) {
                                            newConfigs[walletId] = { threshold: '', enabled: false };
                                          } else {
                                            const defaultThreshold = (parseFloat(currentAmount) * 2).toFixed(1);
                                            newConfigs[walletId] = { threshold: defaultThreshold, enabled: true };
                                          }
                                          setBundleAutoSellConfigs(newConfigs);
                                        }}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isAutoSellEnabled ? 'bg-red-500' : 'bg-gray-600'}`}
                                      >
                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform ${isAutoSellEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                                      </button>
                                    </div>
                                    <p className="text-[10px] text-gray-500">
                                      {isAutoSellEnabled ? `Sells when ${autoSellConfig.threshold} SOL of external volume detected` : 'Enable to auto-sell based on external volume'}
                                    </p>
                                    
                                    {/* Threshold input when enabled */}
                                    {isAutoSellEnabled && (
                                      <div className="mt-2 pt-2 border-t border-red-700/50 space-y-2">
                                        <div>
                                          <label className="block text-[10px] text-gray-500 mb-1">Sell when external volume reaches (SOL)</label>
                                      <div className="flex gap-1">
                                        <input
                                          type="number"
                                          step="0.1"
                                              min="0.1"
                                          value={autoSellConfig.threshold}
                                          onChange={(e) => {
                                            const newConfigs = { ...bundleAutoSellConfigs };
                                                const val = e.target.value;
                                                newConfigs[walletId] = { threshold: val, enabled: parseFloat(val) > 0 };
                                            setBundleAutoSellConfigs(newConfigs);
                                          }}
                                              className="flex-1 min-w-0 px-2 py-1 bg-black/50 border border-gray-700 rounded text-white text-xs focus:outline-none focus:ring-1 focus:ring-red-500"
                                            />
                                            <button type="button" onClick={() => { const n = { ...bundleAutoSellConfigs }; const t = (parseFloat(currentAmount) * 2).toFixed(1); n[walletId] = { threshold: t, enabled: true }; setBundleAutoSellConfigs(n); }} className="flex-shrink-0 px-2 py-1 text-[10px] bg-red-600 hover:bg-red-700 text-white rounded">2x</button>
                                            <button type="button" onClick={() => { const n = { ...bundleAutoSellConfigs }; const t = (parseFloat(currentAmount) * 3).toFixed(1); n[walletId] = { threshold: t, enabled: true }; setBundleAutoSellConfigs(n); }} className="flex-shrink-0 px-2 py-1 text-[10px] bg-orange-600 hover:bg-orange-700 text-white rounded">3x</button>
                                      </div>
                                    </div>
                                        </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
              {/* Launch Mode Indicator (read-only, set by mode selector above) */}
              <div className="flex items-center gap-2 pt-2 border-t border-gray-800">
                <div className={`px-2 py-1 rounded text-xs font-medium ${
                  launchMode === 'rapid' 
                    ? 'bg-green-900/30 text-green-400 border border-green-500/30'
                    : launchMode === 'bundle'
                    ? 'bg-blue-900/30 text-blue-400 border border-blue-500/30'
                    : 'bg-purple-900/30 text-purple-400 border border-purple-500/30'
                }`}>
                  {launchMode === 'rapid' ? '[fast] Rapid Mode' : launchMode === 'bundle' ? ' Bundle Mode' : ' Advanced Mode'}
                </div>
                <span className="text-[10px] text-gray-500">
                  {launchMode === 'rapid' 
                    ? 'Simple create + dev buy, no Jito' 
                    : 'Jito bundle with LUT creation'}
                </span>
              </div>
              {showAdvancedWalletSettings && settings.USE_MULTI_INTERMEDIARY_SYSTEM === 'true' && (
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
          )}

          {/* Post-Launch Trading (Holder Wallets) - Show in Bundle mode */}
          {launchMode === 'bundle' && (
          <div className="p-4 bg-gray-900/50 rounded-lg border-l-4 border-yellow-500">
            {/* Header */}
            <div className="flex items-center justify-between mb-3 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <UserGroupIcon className="w-5 h-5 text-yellow-400 flex-shrink-0" />
                <span className="text-lg font-bold text-yellow-400 whitespace-nowrap">Post-Launch Trading</span>
              </div>
              <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">
                {useWarmedHolderWallets 
                  ? `${selectedHolderWallets.length} existing${additionalHolderCount > 0 ? ` + ${additionalHolderCount} new` : ''}`
                  : `${settings.HOLDER_WALLET_COUNT || 0} wallets`
                }
              </span>
            </div>
            
            {/* Wallet Source Toggle */}
            <div className="mb-4 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400 font-medium">Wallet Source:</span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setUseWarmedHolderWallets(false);
                    setSelectedHolderWallets([]);
                    setSelectedHolderAutoBuyWallets([]);
                    setAdditionalHolderCount(0);
                  }}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                    !useWarmedHolderWallets
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Auto-Create
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUseWarmedHolderWallets(true);
                    loadWarmedWallets(false); // Don't refresh balances - use cached data for speed
                    setWalletModalMode('holder');
                    setShowWalletModal(true);
                  }}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                    useWarmedHolderWallets
                      ? 'bg-green-600 text-white shadow-lg shadow-green-600/30'
                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                  }`}
                >
                  <WalletIcon className="w-4 h-4" />
                  Select + Create
                </button>
              </div>
              {/* Select Holder Wallets Button */}
              {useWarmedHolderWallets && (
                <button
                  type="button"
                  onClick={() => {
                    loadWarmedWallets(false); // Don't refresh balances - use cached data for speed
                    setWalletModalMode('holder');
                    setShowWalletModal(true);
                  }}
                  className="mt-2 w-full px-3 py-1.5 bg-yellow-600 hover:bg-yellow-700 text-white text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5"
                >
                  <WalletIcon className="w-3.5 h-3.5" />
                  {selectedHolderWallets.length > 0 ? `Change Selection (${selectedHolderWallets.length} selected)` : `Select Wallets (${warmedWallets.length} available)`}
                </button>
              )}
              {/* Additional auto-create option when using existing wallets */}
              {useWarmedHolderWallets && (
                <div className="mt-3 pt-3 border-t border-gray-700">
                  <div className="flex items-center justify-between">
              <div>
                      <p className="text-xs text-yellow-400 font-medium">Also auto-create new wallets?</p>
                      <p className="text-[10px] text-gray-500">Will be funded and buy alongside your selected wallets</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => setAdditionalHolderCount(Math.max(0, additionalHolderCount - 1))} className="w-7 h-7 rounded bg-gray-700 hover:bg-gray-600 text-white text-sm font-bold">-</button>
                      <span className="w-8 text-center text-sm text-white font-bold">{additionalHolderCount}</span>
                      <button type="button" onClick={() => setAdditionalHolderCount(additionalHolderCount + 1)} className="w-7 h-7 rounded bg-yellow-600 hover:bg-yellow-700 text-white text-sm font-bold">+</button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Wallet Count (only for auto-create mode) */}
            {!useWarmedHolderWallets && (
              <div className="mb-4">
                <label className="block text-xs text-gray-400 mb-1 font-medium">Number of Trading Wallets</label>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={settings.HOLDER_WALLET_COUNT || '0'}
                  onChange={(e) => handleChange('HOLDER_WALLET_COUNT', e.target.value)}
                  className="w-full px-3 py-2 bg-black/50 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
                />
              </div>
            )}
            
            <div className="space-y-2">
              {/* Warmed Wallets: Per-wallet configuration */}
              {useWarmedHolderWallets && (selectedHolderWallets.length > 0 || additionalHolderCount > 0) && (
                <div className="space-y-3">
                  <div className="p-2 bg-green-900/20 border border-green-500/30 rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-green-400">💰 Wallet Configuration</span>
                      <span className="text-[10px] text-gray-500">
                        ({selectedHolderWallets.length} existing{additionalHolderCount > 0 ? ` + ${additionalHolderCount} auto-created` : ''})
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-500">
                      💰 Total: {selectedHolderWallets.reduce((sum, addr) => {
                        const w = warmedWallets.find(w => w.address === addr);
                        return sum + (w?.solBalance || w?.balance || 0);
                      }, 0).toFixed(4)} SOL
                    </div>
                  </div>
                  
                  {/* Per-Wallet Settings */}
                  <div>
                    <label className="block text-sm text-gray-400 mb-2 flex items-center gap-1">
                      <WalletIcon className="w-4 h-4 text-yellow-400" />
                      <span className="font-semibold">Wallet Settings</span>
                    </label>
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {selectedHolderWallets.map((addr, i) => {
                        const wallet = warmedWallets.find(w => w.address === addr);
                        const balance = wallet?.solBalance || wallet?.balance || 0;
                        const amountsArray = settings.HOLDER_SWAP_AMOUNTS 
                          ? settings.HOLDER_SWAP_AMOUNTS.split(',').map(a => a.trim())
                          : [];
                        const originalIdx = selectedHolderWallets.indexOf(addr);
                        const currentAmount = amountsArray[originalIdx] || '';
                        const config = holderAutoBuyConfigs[addr] || { delay: 0, safetyThreshold: 0 };
                        const isAutoBuyEnabled = holderAutoBuyConfigs[addr] !== undefined;
                        const autoSellConfig = holderAutoSellConfigs[addr] || { threshold: '', enabled: false };
                        const isAutoSellEnabled = parseFloat(autoSellConfig.threshold) > 0;
                        
                        return (
                          <div key={addr} className={`p-4 rounded-lg border transition-all ${isAutoBuyEnabled || isAutoSellEnabled ? 'bg-yellow-900/20 border-yellow-600/50' : 'bg-gray-800/50 border-gray-700'}`}>
                            {/* Header with wallet info */}
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <div className={`p-1.5 rounded ${isAutoBuyEnabled || isAutoSellEnabled ? 'bg-yellow-500/20' : 'bg-gray-700'}`}>
                                  <WalletIcon className={`w-4 h-4 ${isAutoBuyEnabled || isAutoSellEnabled ? 'text-yellow-400' : 'text-gray-400'}`} />
                              </div>
                                <div>
                              <div className="flex items-center gap-2">
                                    <span className="text-sm font-bold text-yellow-400">Holder #{i + 1}</span>
                                    <span className="text-[9px] px-1.5 py-0.5 bg-green-600/30 text-green-400 rounded font-medium">EXISTING</span>
                                  </div>
                                  <span className="text-[10px] font-mono text-gray-500">{addr.slice(0, 8)}...{addr.slice(-6)}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5">
                                {isAutoBuyEnabled && (
                                  <span className="text-[10px] px-1.5 py-0.5 bg-green-600/30 text-green-400 rounded font-medium">AUTO-BUY</span>
                                )}
                                {isAutoSellEnabled && (
                                  <span className="text-[10px] px-1.5 py-0.5 bg-red-600/30 text-red-400 rounded font-medium">SELL @ {autoSellConfig.threshold} SOL vol</span>
                                )}
                                <span className="text-[10px] px-1.5 py-0.5 bg-green-600/30 text-green-400 rounded">{balance.toFixed(3)} SOL</span>
                              </div>
                            </div>
                            
                            {/* Buy Amount */}
                            <div className="mb-3">
                              <label className="block text-xs text-gray-400 mb-1 font-medium">Buy Amount (SOL)</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max={balance}
                                  value={currentAmount}
                                  onChange={(e) => {
                                    const newAmounts = [...amountsArray];
                                    while (newAmounts.length <= originalIdx) {
                                      newAmounts.push('');
                                    }
                                    newAmounts[originalIdx] = e.target.value || '';
                                    handleChange('HOLDER_SWAP_AMOUNTS', newAmounts.join(','));
                                  }}
                                  placeholder={balance.toFixed(2)}
                                className="w-full px-3 py-2 bg-black/50 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
                                />
                              </div>
                              
                            {/* Automation Toggles */}
                            <div className="grid grid-cols-2 gap-3">
                              {/* Auto-Buy Toggle */}
                              <div className={`p-3 rounded-lg border transition-all ${isAutoBuyEnabled ? 'bg-green-900/30 border-green-600/50' : 'bg-gray-900/50 border-gray-700 hover:border-gray-600'}`}>
                                <div className="flex items-center justify-between mb-2">
                                  <label className="text-xs font-semibold text-gray-300 flex items-center gap-1.5 cursor-pointer">
                                    <RocketLaunchIcon className={`w-3.5 h-3.5 ${isAutoBuyEnabled ? 'text-green-400' : 'text-gray-500'}`} />
                                    Auto-Buy
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const newConfigs = { ...holderAutoBuyConfigs };
                                      if (isAutoBuyEnabled) {
                                        delete newConfigs[addr];
                                      } else {
                                        newConfigs[addr] = { delay: 0, safetyThreshold: 0 };
                                      }
                                      setHolderAutoBuyConfigs(newConfigs);
                                    }}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isAutoBuyEnabled ? 'bg-green-500' : 'bg-gray-600'}`}
                                  >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform ${isAutoBuyEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                                  </button>
                                </div>
                                <p className="text-[10px] text-gray-500">
                                  {isAutoBuyEnabled 
                                    ? `Buys ${config.delay > 0 ? `after ${config.delay}s` : 'immediately'}${config.safetyThreshold > 0 ? ` (skips if external vol > ${config.safetyThreshold} SOL)` : ''}`
                                    : 'Wallet gets funded but won\'t auto-buy. You can manually buy in the trading terminal after launch.'}
                                </p>
                                
                                {isAutoBuyEnabled && (
                                  <div className="mt-2 pt-2 border-t border-green-700/50 space-y-2">
                              <div>
                                      <label className="block text-[10px] text-gray-500 mb-1">Delay after launch (seconds)</label>
                                      <div className="flex gap-1">
                                        <input
                                          type="number"
                                          step="0.1"
                                          min="0"
                                          max="60"
                                          value={config.delay}
                                          onChange={(e) => {
                                            const newConfigs = { ...holderAutoBuyConfigs };
                                            newConfigs[addr] = { ...config, delay: parseFloat(e.target.value) || 0 };
                                            setHolderAutoBuyConfigs(newConfigs);
                                          }}
                                          className="flex-1 px-2 py-1 bg-black/50 border border-gray-700 rounded text-white text-xs focus:outline-none focus:ring-1 focus:ring-green-500"
                                        />
                                        <button type="button" onClick={() => { const n = { ...holderAutoBuyConfigs }; n[addr] = { ...config, delay: 0 }; setHolderAutoBuyConfigs(n); }} className="px-2 py-1 text-[10px] bg-green-600 hover:bg-green-700 text-white rounded">0s</button>
                                        <button type="button" onClick={() => { const n = { ...holderAutoBuyConfigs }; n[addr] = { ...config, delay: 1 }; setHolderAutoBuyConfigs(n); }} className="px-2 py-1 text-[10px] bg-blue-600 hover:bg-blue-700 text-white rounded">1s</button>
                                      </div>
                                    </div>
                                    <div>
                                      <label className="block text-[10px] text-gray-500 mb-1 flex items-center gap-1">
                                        Skip if external volume &gt; (SOL)
                                        <InfoTooltip content={[
                                          { bold: "What is External Volume?", text: "" },
                                          "External volume = buys/sells from wallets you DON'T control (not your dev, bundle, or holder wallets).",
                                          { bold: "Protection:", text: "If strangers buy more than this amount before your auto-buy triggers, it will SKIP to protect you from buying at inflated prices." },
                                          { bold: "Set to 0:", text: "Disables protection - always buys regardless of external activity." }
                                        ]} />
                                </label>
                                <div className="flex gap-1">
                                  <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                          max="10"
                                          value={config.safetyThreshold || 0}
                                    onChange={(e) => {
                                            const newConfigs = { ...holderAutoBuyConfigs };
                                            newConfigs[addr] = { ...config, safetyThreshold: parseFloat(e.target.value) || 0 };
                                            setHolderAutoBuyConfigs(newConfigs);
                                          }}
                                          className="flex-1 px-2 py-1 bg-black/50 border border-gray-700 rounded text-white text-xs focus:outline-none focus:ring-1 focus:ring-green-500"
                                          placeholder="0 = no protection"
                                        />
                                        <button type="button" onClick={() => { const n = { ...holderAutoBuyConfigs }; n[addr] = { ...config, safetyThreshold: 0.2 }; setHolderAutoBuyConfigs(n); }} className="px-2 py-1 text-[10px] bg-orange-600 hover:bg-orange-700 text-white rounded">0.2</button>
                                        <button type="button" onClick={() => { const n = { ...holderAutoBuyConfigs }; n[addr] = { ...config, safetyThreshold: 0.5 }; setHolderAutoBuyConfigs(n); }} className="px-2 py-1 text-[10px] bg-red-600 hover:bg-red-700 text-white rounded">0.5</button>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                              
                              {/* Auto-Sell Toggle */}
                              <div className={`p-3 rounded-lg border transition-all ${isAutoSellEnabled ? 'bg-red-900/30 border-red-600/50' : 'bg-gray-900/50 border-gray-700 hover:border-gray-600'}`}>
                                <div className="flex items-center justify-between mb-2">
                                  <label className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                                    <CurrencyDollarIcon className={`w-3.5 h-3.5 ${isAutoSellEnabled ? 'text-red-400' : 'text-gray-500'}`} />
                                    Auto-Sell
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const newConfigs = { ...holderAutoSellConfigs };
                                      if (isAutoSellEnabled) {
                                        newConfigs[addr] = { threshold: '', enabled: false };
                                      } else {
                                        const buyAmt = parseFloat(currentAmount) || balance * 0.5;
                                        const defaultThreshold = (buyAmt * 2).toFixed(1);
                                        newConfigs[addr] = { threshold: defaultThreshold, enabled: true };
                                      }
                                      setHolderAutoSellConfigs(newConfigs);
                                    }}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isAutoSellEnabled ? 'bg-red-500' : 'bg-gray-600'}`}
                                  >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform ${isAutoSellEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                                  </button>
                                </div>
                                <p className="text-[10px] text-gray-500">
                                  {isAutoSellEnabled ? `Sells when ${autoSellConfig.threshold} SOL external volume detected` : 'Enable to auto-sell based on external volume'}
                                </p>
                                
                                {isAutoSellEnabled && (
                                  <div className="mt-2 pt-2 border-t border-red-700/50 space-y-2">
                                    <div>
                                      <label className="block text-[10px] text-gray-500 mb-1">Sell when external volume reaches (SOL)</label>
                                      <div className="flex gap-1 items-center">
                                  <input
                                          type="number"
                                          step="0.1"
                                          min="0.1"
                                          value={autoSellConfig.threshold}
                                    onChange={(e) => {
                                      const newConfigs = { ...holderAutoSellConfigs };
                                            const val = e.target.value;
                                            newConfigs[addr] = { threshold: val, enabled: parseFloat(val) > 0 };
                                      setHolderAutoSellConfigs(newConfigs);
                                    }}
                                          className="flex-1 min-w-0 px-2 py-1 bg-black/50 border border-gray-700 rounded text-white text-xs focus:outline-none focus:ring-1 focus:ring-red-500"
                                  />
                                        <button type="button" onClick={() => { const n = { ...holderAutoSellConfigs }; const b = parseFloat(currentAmount) || balance * 0.5; n[addr] = { threshold: (b * 2).toFixed(1), enabled: true }; setHolderAutoSellConfigs(n); }} className="flex-shrink-0 px-2 py-1 text-[10px] bg-red-600 hover:bg-red-700 text-white rounded">2x</button>
                                        <button type="button" onClick={() => { const n = { ...holderAutoSellConfigs }; const b = parseFloat(currentAmount) || balance * 0.5; n[addr] = { threshold: (b * 3).toFixed(1), enabled: true }; setHolderAutoSellConfigs(n); }} className="flex-shrink-0 px-2 py-1 text-[10px] bg-orange-600 hover:bg-orange-700 text-white rounded">3x</button>
                                </div>
                              </div>
                            </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      
                      {/* Additional Auto-Created Holder Wallets */}
                      {additionalHolderCount > 0 && Array.from({ length: additionalHolderCount }, (_, i) => {
                        const walletIdx = selectedHolderWallets.length + i + 1;
                        const walletId = `holder-new-${i + 1}`;
                        const amountsArray = settings.HOLDER_SWAP_AMOUNTS 
                          ? settings.HOLDER_SWAP_AMOUNTS.split(',').map(a => a.trim())
                          : [];
                        const currentAmount = amountsArray[selectedHolderWallets.length + i] || settings.HOLDER_WALLET_AMOUNT || '0.5';
                        const config = holderAutoBuyConfigs[walletId] || { delay: 0, safetyThreshold: 0 };
                        const isAutoBuyEnabled = holderAutoBuyConfigs[walletId] !== undefined;
                        const autoSellConfig = holderAutoSellConfigs[walletId] || { threshold: '', enabled: false };
                        const isAutoSellEnabled = parseFloat(autoSellConfig.threshold) > 0;
                        
                        return (
                          <div key={walletId} className={`p-4 rounded-lg border transition-all ${isAutoBuyEnabled || isAutoSellEnabled ? 'bg-blue-900/20 border-blue-600/50' : 'bg-gray-800/50 border-gray-700'}`}>
                            {/* Header with wallet info */}
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <div className={`p-1.5 rounded ${isAutoBuyEnabled || isAutoSellEnabled ? 'bg-blue-500/20' : 'bg-gray-700'}`}>
                                  <WalletIcon className={`w-4 h-4 ${isAutoBuyEnabled || isAutoSellEnabled ? 'text-blue-400' : 'text-gray-400'}`} />
                                </div>
                                  <div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-bold text-blue-400">Holder #{walletIdx}</span>
                                    <span className="text-[9px] px-1.5 py-0.5 bg-blue-600/30 text-blue-400 rounded font-medium">AUTO-CREATED</span>
                                  </div>
                                  <span className="text-[10px] text-gray-500">Will be generated & funded at launch</span>
                                </div>
                              </div>
                              {/* Status badges */}
                              <div className="flex items-center gap-1.5">
                                {isAutoBuyEnabled && (
                                  <span className="text-[10px] px-1.5 py-0.5 bg-green-600/30 text-green-400 rounded font-medium">AUTO-BUY</span>
                                )}
                                {isAutoSellEnabled && (
                                  <span className="text-[10px] px-1.5 py-0.5 bg-red-600/30 text-red-400 rounded font-medium">SELL @ {autoSellConfig.threshold} SOL vol</span>
                                )}
                              </div>
                            </div>
                            
                            {/* Buy Amount */}
                            <div className="mb-3">
                              <label className="block text-xs text-gray-400 mb-1 font-medium">Buy Amount (SOL)</label>
                                      <input
                                        type="number"
                                step="0.01"
                                        min="0"
                                value={currentAmount}
                                        onChange={(e) => {
                                  const newAmounts = [...amountsArray];
                                  const targetIdx = selectedHolderWallets.length + i;
                                  while (newAmounts.length <= targetIdx) {
                                    newAmounts.push(settings.HOLDER_WALLET_AMOUNT || '0.5');
                                  }
                                  newAmounts[targetIdx] = e.target.value || '';
                                  handleChange('HOLDER_SWAP_AMOUNTS', newAmounts.join(','));
                                }}
                                placeholder="0.5"
                                className="w-full px-3 py-2 bg-black/50 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              />
                            </div>
                            
                            {/* Automation Toggles */}
                            <div className="grid grid-cols-2 gap-3">
                              {/* Auto-Buy Toggle */}
                              <div className={`p-3 rounded-lg border transition-all ${isAutoBuyEnabled ? 'bg-green-900/30 border-green-600/50' : 'bg-gray-900/50 border-gray-700 hover:border-gray-600'}`}>
                                <div className="flex items-center justify-between mb-2">
                                  <label className="text-xs font-semibold text-gray-300 flex items-center gap-1.5 cursor-pointer">
                                    <RocketLaunchIcon className={`w-3.5 h-3.5 ${isAutoBuyEnabled ? 'text-green-400' : 'text-gray-500'}`} />
                                    Auto-Buy
                                  </label>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const newConfigs = { ...holderAutoBuyConfigs };
                                      if (isAutoBuyEnabled) {
                                        delete newConfigs[walletId];
                                      } else {
                                        newConfigs[walletId] = { delay: 0, safetyThreshold: 0 };
                                      }
                                          setHolderAutoBuyConfigs(newConfigs);
                                        }}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isAutoBuyEnabled ? 'bg-green-500' : 'bg-gray-600'}`}
                                      >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform ${isAutoBuyEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                                      </button>
                                </div>
                                <p className="text-[10px] text-gray-500">
                                  {isAutoBuyEnabled 
                                    ? `Buys ${config.delay > 0 ? `after ${config.delay}s` : 'immediately'}`
                                    : 'Wallet gets funded but won\'t auto-buy. You can manually buy in the trading terminal after launch.'}
                                </p>
                              </div>
                              
                              {/* Auto-Sell Toggle */}
                              <div className={`p-3 rounded-lg border transition-all ${isAutoSellEnabled ? 'bg-red-900/30 border-red-600/50' : 'bg-gray-900/50 border-gray-700 hover:border-gray-600'}`}>
                                <div className="flex items-center justify-between mb-2">
                                  <label className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                                    <CurrencyDollarIcon className={`w-3.5 h-3.5 ${isAutoSellEnabled ? 'text-red-400' : 'text-gray-500'}`} />
                                    Auto-Sell
                                  </label>
                                      <button
                                        type="button"
                                        onClick={() => {
                                      const newConfigs = { ...holderAutoSellConfigs };
                                      if (isAutoSellEnabled) {
                                        delete newConfigs[walletId];
                                      } else {
                                        const defaultThreshold = (parseFloat(currentAmount) * 2).toFixed(1);
                                        newConfigs[walletId] = { threshold: defaultThreshold, enabled: true };
                                      }
                                      setHolderAutoSellConfigs(newConfigs);
                                    }}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isAutoSellEnabled ? 'bg-red-500' : 'bg-gray-600'}`}
                                  >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform ${isAutoSellEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                                      </button>
                                    </div>
                                <p className="text-[10px] text-gray-500">
                                  {isAutoSellEnabled ? `Sells when ${autoSellConfig.threshold} SOL external volume detected` : 'Enable to auto-sell based on external volume'}
                                </p>
                                  
                                {isAutoSellEnabled && (
                                  <div className="mt-2 pt-2 border-t border-red-700/50 space-y-2">
                                  <div>
                                      <label className="block text-[10px] text-gray-500 mb-1">Sell when external volume reaches (SOL)</label>
                                      <div className="flex gap-1 items-center">
                                    <input
                                      type="number"
                                      step="0.1"
                                          min="0.1"
                                          value={autoSellConfig.threshold}
                                      onChange={(e) => {
                                            const newConfigs = { ...holderAutoSellConfigs };
                                            const val = e.target.value;
                                            newConfigs[walletId] = { threshold: val, enabled: parseFloat(val) > 0 };
                                            setHolderAutoSellConfigs(newConfigs);
                                          }}
                                          className="flex-1 min-w-0 px-2 py-1 bg-black/50 border border-gray-700 rounded text-white text-xs focus:outline-none focus:ring-1 focus:ring-red-500"
                                        />
                                        <button type="button" onClick={() => { const n = { ...holderAutoSellConfigs }; const b = parseFloat(currentAmount) || 0.5; n[walletId] = { threshold: (b * 2).toFixed(1), enabled: true }; setHolderAutoSellConfigs(n); }} className="flex-shrink-0 px-2 py-1 text-[10px] bg-red-600 hover:bg-red-700 text-white rounded">2x</button>
                                        <button type="button" onClick={() => { const n = { ...holderAutoSellConfigs }; const b = parseFloat(currentAmount) || 0.5; n[walletId] = { threshold: (b * 3).toFixed(1), enabled: true }; setHolderAutoSellConfigs(n); }} className="flex-shrink-0 px-2 py-1 text-[10px] bg-orange-600 hover:bg-orange-700 text-white rounded">3x</button>
                                  </div>
                                </div>
                              </div>
                            )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
              
              {/* Per-Wallet Configuration - Fresh Wallets */}
              {!useWarmedHolderWallets && (() => {
                const holderCount = parseInt(settings.HOLDER_WALLET_COUNT || '0');
                const defaultAmount = settings.HOLDER_WALLET_AMOUNT || '0.5';
                
                if (holderCount > 0) {
                  return (
                    <div className="space-y-3">
                      {/* Quick Fill All Wallets */}
                      <div>
                        <label className="block text-sm text-gray-400 mb-1.5 flex items-center gap-1">
                          <span className="font-semibold">Quick Fill All Wallets</span>
                          <InfoTooltip content="Click a preset to set all holder wallets to that amount. You can still adjust individual amounts below." />
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                          {[0.1, 0.5, 1, 2].map((amount) => (
                            <button
                              key={amount}
                              type="button"
                              onClick={() => {
                                handleChange('HOLDER_WALLET_AMOUNT', amount.toString());
                                const newAmounts = Array(holderCount).fill(amount.toString());
                            handleChange('HOLDER_SWAP_AMOUNTS', newAmounts.join(','));
                          }}
                              className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all bg-gray-700 text-gray-300 hover:bg-yellow-600 hover:text-white"
                            >
                              {amount} SOL
                            </button>
                          ))}
                        </div>
                      </div>
                      
                      {/* Per-Wallet Settings */}
                      <div>
                        <label className="block text-sm text-gray-400 mb-2 flex items-center gap-1">
                          <WalletIcon className="w-4 h-4 text-yellow-400" />
                          <span className="font-semibold">Wallet Settings</span>
                        </label>
                        <div className="space-y-2 max-h-96 overflow-y-auto">
                          {Array.from({ length: holderCount }, (_, i) => {
                            const walletId = `wallet-${i + 1}`;
                            const walletIdx = i + 1;
                            const amountsArray = settings.HOLDER_SWAP_AMOUNTS 
                              ? settings.HOLDER_SWAP_AMOUNTS.split(',').map(a => a.trim())
                              : [];
                            const currentAmount = amountsArray[i] || defaultAmount;
                            const config = holderAutoBuyConfigs[walletId] || { delay: 0, safetyThreshold: 0 };
                            const isAutoBuyEnabled = holderAutoBuyConfigs[walletId] !== undefined;
                            const autoSellConfig = holderAutoSellConfigs[walletId] || { threshold: '', enabled: false };
                            
                            const isAutoSellEnabled = parseFloat(autoSellConfig.threshold) > 0;
                            
                            return (
                              <div key={i} className={`p-4 rounded-lg border transition-all ${isAutoBuyEnabled || isAutoSellEnabled ? 'bg-yellow-900/20 border-yellow-600/50' : 'bg-gray-800/50 border-gray-700'}`}>
                                {/* Header with wallet info */}
                                <div className="flex items-center justify-between mb-3">
                                  <div className="flex items-center gap-2">
                                    <div className={`p-1.5 rounded ${isAutoBuyEnabled || isAutoSellEnabled ? 'bg-yellow-500/20' : 'bg-gray-700'}`}>
                                      <WalletIcon className={`w-4 h-4 ${isAutoBuyEnabled || isAutoSellEnabled ? 'text-yellow-400' : 'text-gray-400'}`} />
                                  </div>
                                    <div>
                                  <div className="flex items-center gap-2">
                                        <span className="text-sm font-bold text-yellow-400">Holder #{walletIdx}</span>
                                        <span className="text-[9px] px-1.5 py-0.5 bg-blue-600/30 text-blue-400 rounded font-medium">AUTO-CREATED</span>
                                      </div>
                                      <span className="text-[10px] text-gray-500">Will be generated & funded at launch</span>
                                    </div>
                                  </div>
                                  {/* Status badges */}
                                  <div className="flex items-center gap-1.5">
                                    {isAutoBuyEnabled && (
                                      <span className="text-[10px] px-1.5 py-0.5 bg-green-600/30 text-green-400 rounded font-medium">AUTO-BUY</span>
                                    )}
                                    {isAutoSellEnabled && (
                                      <span className="text-[10px] px-1.5 py-0.5 bg-red-600/30 text-red-400 rounded font-medium">SELL @ {autoSellConfig.threshold} SOL vol</span>
                                    )}
                                  </div>
                                </div>
                                
                                {/* Buy Amount - Always visible */}
                                <div className="mb-3">
                                  <label className="block text-xs text-gray-400 mb-1 font-medium">Buy Amount (SOL)</label>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0.01"
                                      value={currentAmount}
                                      onChange={(e) => {
                                        const newAmounts = Array(holderCount).fill('').map((_, idx) => {
                                        if (idx === i) return e.target.value || defaultAmount;
                                          return amountsArray[idx] || defaultAmount;
                                        });
                                        handleChange('HOLDER_SWAP_AMOUNTS', newAmounts.join(','));
                                      }}
                                    className="w-full px-3 py-2 bg-black/50 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
                                    />
                                  </div>
                                  
                                {/* Automation Toggles */}
                                <div className="grid grid-cols-2 gap-3">
                                  {/* Auto-Buy Toggle */}
                                  <div className={`p-3 rounded-lg border transition-all ${isAutoBuyEnabled ? 'bg-green-900/30 border-green-600/50' : 'bg-gray-900/50 border-gray-700 hover:border-gray-600'}`}>
                                    <div className="flex items-center justify-between mb-2">
                                      <label className="text-xs font-semibold text-gray-300 flex items-center gap-1.5 cursor-pointer" htmlFor={`autoBuy-${walletId}`}>
                                        <RocketLaunchIcon className={`w-3.5 h-3.5 ${isAutoBuyEnabled ? 'text-green-400' : 'text-gray-500'}`} />
                                        Auto-Buy
                                    </label>
                                      <button
                                        type="button"
                                        id={`autoBuy-${walletId}`}
                                        onClick={() => {
                                          const newConfigs = { ...holderAutoBuyConfigs };
                                          if (isAutoBuyEnabled) {
                                            delete newConfigs[walletId];
                                          } else {
                                            newConfigs[walletId] = { delay: 0, safetyThreshold: 0 };
                                          }
                                          setHolderAutoBuyConfigs(newConfigs);
                                        }}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isAutoBuyEnabled ? 'bg-green-500' : 'bg-gray-600'}`}
                                      >
                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform ${isAutoBuyEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                                      </button>
                                    </div>
                                    <p className="text-[10px] text-gray-500">
                                      {isAutoBuyEnabled 
                                        ? `Buys ${config.delay > 0 ? `after ${config.delay}s` : 'immediately'}${config.safetyThreshold > 0 ? ` (skips if external vol > ${config.safetyThreshold} SOL)` : ''}`
                                        : 'Click to enable automatic buying'}
                                    </p>
                                    
                                    {/* Auto-Buy Settings when enabled */}
                                    {isAutoBuyEnabled && (
                                      <div className="mt-2 pt-2 border-t border-green-700/50 space-y-2">
                                        <div>
                                          <label className="block text-[10px] text-gray-500 mb-1">Delay after launch (seconds)</label>
                                    <div className="flex gap-1">
                                      <input
                                        type="number"
                                        step="0.1"
                                        min="0"
                                              max="60"
                                              value={config.delay}
                                        onChange={(e) => {
                                                const newConfigs = { ...holderAutoBuyConfigs };
                                                newConfigs[walletId] = { ...config, delay: parseFloat(e.target.value) || 0 };
                                                setHolderAutoBuyConfigs(newConfigs);
                                              }}
                                              className="flex-1 px-2 py-1 bg-black/50 border border-gray-700 rounded text-white text-xs focus:outline-none focus:ring-1 focus:ring-green-500"
                                            />
                                            <button type="button" onClick={() => { const n = { ...holderAutoBuyConfigs }; n[walletId] = { ...config, delay: 0 }; setHolderAutoBuyConfigs(n); }} className="px-2 py-1 text-[10px] bg-green-600 hover:bg-green-700 text-white rounded">0s</button>
                                            <button type="button" onClick={() => { const n = { ...holderAutoBuyConfigs }; n[walletId] = { ...config, delay: 1 }; setHolderAutoBuyConfigs(n); }} className="px-2 py-1 text-[10px] bg-blue-600 hover:bg-blue-700 text-white rounded">1s</button>
                                    </div>
                                  </div>
                                      <div>
                                          <label className="block text-[10px] text-gray-500 mb-1 flex items-center gap-1">
                                            Skip if external volume &gt; (SOL)
                                            <InfoTooltip content={[
                                              { bold: "What is External Volume?", text: "" },
                                              "External volume = buys/sells from wallets you DON'T control (not your dev, bundle, or holder wallets).",
                                              { bold: "Protection:", text: "If strangers buy more than this amount before your auto-buy triggers, it will SKIP to protect you from buying at inflated prices." },
                                              { bold: "Set to 0:", text: "Disables protection - always buys regardless of external activity." }
                                            ]} />
                                          </label>
                                        <div className="flex gap-1">
                                          <input
                                            type="number"
                                            step="0.1"
                                            min="0"
                                              max="10"
                                              value={config.safetyThreshold || 0}
                                            onChange={(e) => {
                                              const newConfigs = { ...holderAutoBuyConfigs };
                                                newConfigs[walletId] = { ...config, safetyThreshold: parseFloat(e.target.value) || 0 };
                                              setHolderAutoBuyConfigs(newConfigs);
                                            }}
                                              className="flex-1 px-2 py-1 bg-black/50 border border-gray-700 rounded text-white text-xs focus:outline-none focus:ring-1 focus:ring-green-500"
                                              placeholder="0 = no protection"
                                            />
                                            <button type="button" onClick={() => { const n = { ...holderAutoBuyConfigs }; n[walletId] = { ...config, safetyThreshold: 0.2 }; setHolderAutoBuyConfigs(n); }} className="px-2 py-1 text-[10px] bg-orange-600 hover:bg-orange-700 text-white rounded">0.2</button>
                                            <button type="button" onClick={() => { const n = { ...holderAutoBuyConfigs }; n[walletId] = { ...config, safetyThreshold: 0.5 }; setHolderAutoBuyConfigs(n); }} className="px-2 py-1 text-[10px] bg-red-600 hover:bg-red-700 text-white rounded">0.5</button>
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                  
                                  {/* Auto-Sell Toggle */}
                                  <div className={`p-3 rounded-lg border transition-all ${isAutoSellEnabled ? 'bg-red-900/30 border-red-600/50' : 'bg-gray-900/50 border-gray-700 hover:border-gray-600'}`}>
                                    <div className="flex items-center justify-between mb-2">
                                      <label className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                                        <CurrencyDollarIcon className={`w-3.5 h-3.5 ${isAutoSellEnabled ? 'text-red-400' : 'text-gray-500'}`} />
                                        Auto-Sell
                                      </label>
                                          <button
                                            type="button"
                                            onClick={() => {
                                          const newConfigs = { ...holderAutoSellConfigs };
                                          if (isAutoSellEnabled) {
                                            newConfigs[walletId] = { threshold: '', enabled: false };
                                          } else {
                                            // Enable with a default threshold of 2x the buy amount
                                            const defaultThreshold = (parseFloat(currentAmount) * 2).toFixed(1);
                                            newConfigs[walletId] = { threshold: defaultThreshold, enabled: true };
                                          }
                                          setHolderAutoSellConfigs(newConfigs);
                                        }}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isAutoSellEnabled ? 'bg-red-500' : 'bg-gray-600'}`}
                                      >
                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform ${isAutoSellEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                                          </button>
                                        </div>
                                    <p className="text-[10px] text-gray-500">
                                      {isAutoSellEnabled ? `Sells when ${autoSellConfig.threshold} SOL external volume detected` : 'Enable to auto-sell based on external volume'}
                                    </p>
                                      
                                    {/* Auto-Sell Threshold when enabled */}
                                    {isAutoSellEnabled && (
                                      <div className="mt-2 pt-2 border-t border-red-700/50 space-y-2">
                                      <div>
                                          <label className="block text-[10px] text-gray-500 mb-1">Sell when external volume reaches (SOL)</label>
                                          <div className="flex gap-1">
                                        <input
                                          type="number"
                                          step="0.1"
                                              min="0.1"
                                              value={autoSellConfig.threshold}
                                          onChange={(e) => {
                                                const newConfigs = { ...holderAutoSellConfigs };
                                                const val = e.target.value;
                                                newConfigs[walletId] = { threshold: val, enabled: parseFloat(val) > 0 };
                                                setHolderAutoSellConfigs(newConfigs);
                                              }}
                                              className="flex-1 min-w-0 px-2 py-1 bg-black/50 border border-gray-700 rounded text-white text-xs focus:outline-none focus:ring-1 focus:ring-red-500"
                                            />
                                            <button type="button" onClick={() => { const n = { ...holderAutoSellConfigs }; const t = (parseFloat(currentAmount) * 2).toFixed(1); n[walletId] = { threshold: t, enabled: true }; setHolderAutoSellConfigs(n); }} className="flex-shrink-0 px-2 py-1 text-[10px] bg-red-600 hover:bg-red-700 text-white rounded">2x</button>
                                            <button type="button" onClick={() => { const n = { ...holderAutoSellConfigs }; const t = (parseFloat(currentAmount) * 3).toFixed(1); n[walletId] = { threshold: t, enabled: true }; setHolderAutoSellConfigs(n); }} className="flex-shrink-0 px-2 py-1 text-[10px] bg-orange-600 hover:bg-orange-700 text-white rounded">3x</button>
                                      </div>
                                    </div>
                                  </div>
                                )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
              {showAdvancedWalletSettings && settings.USE_MULTI_INTERMEDIARY_SYSTEM === 'true' && (
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
      </div>

      {/* Front-Run Protection removed - now handled per-wallet in Holder Wallets section */}
      {false && launchMode === 'bundle' && (settings.AUTO_HOLDER_WALLET_BUY === 'true' || settings.AUTO_HOLDER_WALLET_BUY === true) && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span className="text-sm font-bold text-red-300"> Front-Run Protection</span>
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

      {/* Auto-Sell Configuration moved to per-wallet settings in Bundle Wallets and Holder Wallets sections */}

      {/* Wallet Selection Modal */}
      {showWalletModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl">
                {/* Modal Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-800">
                  <div>
                    <h3 className="text-xl font-bold text-white">
                      {walletModalMode === 'dev' && 'Select DEV Wallet'}
                      {walletModalMode === 'bundle' && 'Select Bundle Wallets'}
                      {walletModalMode === 'holder' && 'Select Holder Wallets'}
                      {walletModalMode === 'all' && 'Select Warmed Wallets'}
                    </h3>
                    <p className="text-sm text-gray-400 mt-1">
                      {filteredAndSortedWallets.length} of {warmedWallets.length} wallets shown
                      {walletModalMode === 'dev' && ` | Selected: ${selectedCreatorWallet ? '1' : '0'}`}
                      {walletModalMode === 'bundle' && ` | Selected: ${selectedBundleWallets.length}`}
                      {walletModalMode === 'holder' && ` | Selected: ${selectedHolderWallets.length}`}
                      {walletModalMode === 'all' && ` | Creator: ${selectedCreatorWallet ? '1' : '0'} | Bundle: ${selectedBundleWallets.length} | Holder: ${selectedHolderWallets.length}`}
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
                      X Close
                    </button>
                  </div>
                </div>
                
                {/* Filters and Sort */}
                <div className="p-4 border-b border-gray-800 bg-gray-900/50">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                    {/* Search */}
                    <div className="lg:col-span-2">
                      <label className="text-xs text-gray-400 mb-1 block"> Search Address</label>
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
                      <label className="text-xs text-gray-400 mb-1 block"> Filter by Tag</label>
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
                      <label className="text-xs text-gray-400 mb-1 block"> Filter by Status</label>
                      <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                      >
                        <option value="all">All Status</option>
                        <option value="idle"> Idle</option>
                        <option value="warming"> Warming</option>
                        <option value="ready">[ok] Ready</option>
                      </select>
                    </div>
                    
                    {/* Sort By */}
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block"> Sort By</label>
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
                      {sortOrder === 'asc' ? ' Ascending' : ' Descending'}
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
                       Clear Filters
                    </button>
                  </div>
                </div>
                
                {/* Wallet List */}
                <div className="flex-1 overflow-y-auto p-4">
                  {loadingWarmedWallets ? (
                    <div className="text-center text-gray-400 py-8">Loading wallets...</div>
                  ) : warmedWallets.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="text-gray-400 mb-4">
                        <WalletIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p className="text-lg font-medium text-gray-300">No Warmed Wallets Found</p>
                        <p className="text-sm text-gray-500 mt-1">Create and warm wallets to use them for launches</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setShowWalletModal(false);
                          window.dispatchEvent(new CustomEvent('navigate-to-tab', { detail: 'warming' }));
                        }}
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-2"
                      >
                        <Cog6ToothIcon className="w-4 h-4" />
                        Go to Wallet Settings
                      </button>
                    </div>
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
                              (walletModalMode === 'dev' && isCreator) ? 'bg-purple-900/30 border-purple-600/50' :
                              (walletModalMode === 'bundle' && isBundle) ? 'bg-green-900/30 border-green-600/50' :
                              (walletModalMode === 'holder' && isHolder) ? 'bg-yellow-900/30 border-yellow-600/50' :
                              (walletModalMode === 'all' && (isCreator || isBundle || isHolder)) ? 'bg-blue-900/30 border-blue-600/50' :
                              'bg-gray-800/50 border-gray-700'
                            }`}
                          >
                            {/* Show existing selections as badges */}
                            {(isCreator || isBundle || isHolder) && (
                              <div className="flex flex-wrap gap-1 mb-2">
                                {isCreator && (
                                  <span className="text-[10px] px-1.5 py-0.5 bg-purple-600/40 text-purple-300 rounded font-medium">DEV</span>
                                )}
                                {isBundle && (
                                  <span className="text-[10px] px-1.5 py-0.5 bg-green-600/40 text-green-300 rounded font-medium">BUNDLE</span>
                                )}
                                {isHolder && (
                                  <span className="text-[10px] px-1.5 py-0.5 bg-yellow-600/40 text-yellow-300 rounded font-medium">HOLDER</span>
                                )}
                              </div>
                            )}
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
                              {/* DEV/Creator button - only show in 'dev' or 'all' mode */}
                              {(walletModalMode === 'dev' || walletModalMode === 'all') && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (isCreator) {
                                    setSelectedCreatorWallet(null);
                                  } else {
                                    setSelectedCreatorWallet(wallet.address);
                                      // Allow same wallet to be used for multiple purposes
                                  }
                                }}
                                  className={`flex-1 px-3 py-2 text-sm rounded-lg font-medium transition-colors ${
                                  isCreator
                                    ? 'bg-purple-600 text-white'
                                    : 'bg-gray-700 text-gray-300 hover:bg-purple-600 hover:text-white'
                                }`}
                              >
                                  {isCreator ? '✓ Selected as DEV' : 'Select as DEV'}
                              </button>
                              )}
                              {/* Bundle button - only show in 'bundle' or 'all' mode */}
                              {(walletModalMode === 'bundle' || walletModalMode === 'all') && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (isBundle) {
                                    setSelectedBundleWallets(prev => prev.filter(a => a !== wallet.address));
                                  } else {
                                    setSelectedBundleWallets(prev => [...prev, wallet.address]);
                                      // Allow same wallet to be used for multiple purposes
                                    }
                                  }}
                                  className={`flex-1 px-3 py-2 text-sm rounded-lg font-medium transition-colors ${
                                  isBundle
                                    ? 'bg-green-600 text-white'
                                    : 'bg-gray-700 text-gray-300 hover:bg-green-600 hover:text-white'
                                }`}
                              >
                                  {isBundle ? '✓ Selected' : 'Select'}
                              </button>
                              )}
                              {/* Holder button - only show in 'holder' or 'all' mode */}
                              {(walletModalMode === 'holder' || walletModalMode === 'all') && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (isHolder) {
                                    setSelectedHolderWallets(prev => prev.filter(a => a !== wallet.address));
                                  } else {
                                    setSelectedHolderWallets(prev => [...prev, wallet.address]);
                                      // Allow same wallet to be used for multiple purposes
                                    }
                                  }}
                                  className={`flex-1 px-3 py-2 text-sm rounded-lg font-medium transition-colors ${
                                  isHolder
                                    ? 'bg-yellow-600 text-white'
                                    : 'bg-gray-700 text-gray-300 hover:bg-yellow-600 hover:text-white'
                                }`}
                              >
                                  {isHolder ? '✓ Selected' : 'Select'}
                              </button>
                              )}
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
                    {walletModalMode === 'dev' && `DEV Wallet: ${selectedCreatorWallet ? 'Selected' : 'Not selected'}`}
                    {walletModalMode === 'bundle' && `Bundle Wallets Selected: ${selectedBundleWallets.length}`}
                    {walletModalMode === 'holder' && `Holder Wallets Selected: ${selectedHolderWallets.length}`}
                    {walletModalMode === 'all' && `Selected: ${selectedBundleWallets.length} Bundle, ${selectedHolderWallets.length} Holder`}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        if (walletModalMode === 'dev') {
                          setSelectedCreatorWallet(null);
                        } else if (walletModalMode === 'bundle') {
                        setSelectedBundleWallets([]);
                        } else if (walletModalMode === 'holder') {
                        setSelectedHolderWallets([]);
                        } else {
                          setSelectedBundleWallets([]);
                          setSelectedHolderWallets([]);
                          setSelectedCreatorWallet(null);
                        }
                      }}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm"
                    >
                      Clear Selection
                    </button>
                    <button
                      onClick={() => setShowWalletModal(false)}
                      className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
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
        
      {/* Save Settings Button - Manual save (most settings auto-save, but useful for batch saves or if auto-save fails) */}
      <div className="mb-3">
        <button
          onClick={handleSaveSettings}
          disabled={loading}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed glow-blue flex items-center justify-center gap-2"
          title="Manually save all settings. Most settings auto-save, but this ensures everything is saved."
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
        <p className="text-xs text-gray-500 text-center mt-1">
           Most settings auto-save. Use this to manually save all settings at once or if auto-save fails.
        </p>
      </div>


      {/* LAUNCH TOKEN BUTTON */}
      <div className="mt-6 mb-6">
        <button
          onClick={handleLaunch}
          disabled={loading || !settings.TOKEN_NAME || !settings.TOKEN_SYMBOL || !settings.DESCRIPTION}
          className={`w-full py-4 text-white font-black text-xl rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-2xl flex items-center justify-center gap-3 relative overflow-hidden group ${
            launchMode === 'rapid'
              ? 'bg-gradient-to-r from-green-500 via-emerald-500 to-teal-500 hover:from-green-600 hover:via-emerald-600 hover:to-teal-600 hover:shadow-green-500/50'
              : launchMode === 'bundle'
              ? 'bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-500 hover:from-blue-600 hover:via-indigo-600 hover:to-violet-600 hover:shadow-blue-500/50'
              : 'bg-gradient-to-r from-purple-600 via-pink-600 to-red-600 hover:from-purple-700 hover:via-pink-700 hover:to-red-700 hover:shadow-purple-500/50'
          }`}
        >
          {/* Animated background effect */}
          <div className={`absolute inset-0 opacity-0 group-hover:opacity-20 transition-opacity duration-300 ${
            launchMode === 'rapid'
              ? 'bg-gradient-to-r from-green-400 via-emerald-400 to-teal-400'
              : launchMode === 'bundle'
              ? 'bg-gradient-to-r from-blue-400 via-indigo-400 to-violet-400'
              : 'bg-gradient-to-r from-purple-400 via-pink-400 to-red-400'
          }`} />
          
          {loading ? (
            <>
              <ArrowPathIcon className="w-8 h-8 animate-spin" />
              <span>LAUNCHING...</span>
            </>
          ) : (
            <>
              {launchMode === 'rapid' ? (
                <svg className="w-6 h-6 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              ) : launchMode === 'bundle' ? (
                <CubeIcon className="w-6 h-6 group-hover:scale-110 transition-transform" />
              ) : (
                <RocketLaunchIconSolid className="w-6 h-6 group-hover:scale-110 transition-transform" />
              )}
              <span className="tracking-wider font-bold">
                {launchMode === 'rapid' ? '[fast] RAPID LAUNCH' : launchMode === 'bundle' ? ' BUNDLE LAUNCH' : ' ADVANCED LAUNCH'}
              </span>
              <span className="text-sm font-normal opacity-75">
                {launchMode === 'rapid' ? '~5s' : launchMode === 'bundle' ? '~30-60s' : '~30-90s'}
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
                       {walletInfo.fundingWallet.privateKey}
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
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-semibold text-purple-400 mb-1"> Creator/DEV Wallet</p>
                  <p className="text-xs font-mono text-gray-300">
                    {walletInfo.creatorDevWallet.isAutoCreated ? 'Will be auto-created' : walletInfo.creatorDevWallet.address.substring(0, 8) + '...' + walletInfo.creatorDevWallet.address.substring(walletInfo.creatorDevWallet.address.length - 8)}
                  </p>
                  {walletInfo.creatorDevWallet.privateKey && (
                    <p className="text-xs font-mono text-gray-500 mt-1" title="Private Key (shortened for security)">
                       {walletInfo.creatorDevWallet.privateKey}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-1">{walletInfo.creatorDevWallet.source}</p>
                  {/* Show current balance for existing wallets */}
                  {!walletInfo.creatorDevWallet.isAutoCreated && !walletInfo.creatorDevWallet?.isFundingWallet && (
                    <p className="text-xs text-gray-400 mt-1">
                      Current Balance: <span className={walletInfo.creatorDevWallet.balance >= (walletInfo.buyerAmount + 0.1) ? 'text-green-400' : 'text-yellow-400'}>{walletInfo.creatorDevWallet.balance?.toFixed(4) || '0.0000'} SOL</span>
                    </p>
                  )}
                </div>
                <div className="text-right space-y-1">
                  {walletInfo.useFundingAsBuyer || walletInfo.creatorDevWallet?.isFundingWallet ? (
                    <>
                      <p className="text-xs text-gray-500">DEV Buy Amount</p>
                      <p className="text-sm font-bold text-green-400">{walletInfo.buyerAmount?.toFixed(4) || '0.0000'} SOL</p>
                      <p className="text-[10px] text-green-400/70 mt-1">✓ Uses Master Wallet</p>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-gray-500">DEV Buy Amount</p>
                      <p className="text-sm font-bold text-purple-400">{walletInfo.buyerAmount?.toFixed(4) || '0.0000'} SOL</p>
                      {walletInfo.breakdown?.creatorDevWallet > 0 ? (
                        <>
                          <p className="text-[10px] text-yellow-400 mt-1">Needs Funding: {walletInfo.breakdown.creatorDevWallet.toFixed(4)} SOL</p>
                        </>
                      ) : (
                        <p className="text-[10px] text-green-400 mt-1">✓ Has sufficient balance</p>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Bundle Wallets Summary */}
            {(walletInfo.bundleWallets.count > 0 || (useWarmedBundleWallets && selectedBundleWallets.length > 0)) && (
              <div className="p-4 bg-gray-900/50 rounded-lg border-l-4 border-green-500">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="text-sm font-semibold text-green-400 mb-1 flex items-center gap-2">
                      <CubeIcon className="w-4 h-4" />
                      {walletInfo.bundleWallets.label}
                      {useWarmedBundleWallets && selectedBundleWallets.length > 0 && walletInfo.bundleWallets.totalSol === 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-green-600/30 text-green-400 rounded">PRE-FUNDED</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500">
                      {useWarmedBundleWallets ? selectedBundleWallets.length : walletInfo.bundleWallets.count} wallet(s)
                      {useWarmedBundleWallets && ' (warmed)'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">
                      {walletInfo.bundleWallets.totalSol > 0 ? 'Funding Needed' : 'Total Buy'}
                    </p>
                    <p className="text-sm font-bold text-green-400">
                      {walletInfo.bundleWallets.totalSol > 0 
                        ? `${walletInfo.bundleWallets.totalSol.toFixed(4)} SOL`
                        : `${walletInfo.bundleWallets.amounts.reduce((a, b) => a + b, 0).toFixed(4)} SOL`
                      }
                    </p>
                    {useWarmedBundleWallets && walletInfo.breakdown?.bundleExistingBalance > 0 && (
                      <p className="text-[10px] text-gray-400">
                        Balance: {walletInfo.breakdown.bundleExistingBalance.toFixed(4)} SOL
                      </p>
                    )}
                  </div>
                </div>
                {walletInfo.bundleWallets.totalSol > 0 && (
                  <p className="text-[10px] text-blue-400 mt-1">↳ Will be funded from Master Wallet during initialization</p>
                )}
                <div className="mt-2 space-y-1">
                  {useWarmedBundleWallets && selectedBundleWallets.length > 0 ? (
                    // Show warmed bundle wallet balances
                    selectedBundleWallets.map((addr, idx) => {
                      const wallet = warmedWallets.find(w => w.address === addr);
                      const balance = wallet?.solBalance || wallet?.balance || 0;
                      const buyAmount = walletInfo.bundleWallets.amounts[idx] || 0;
                      const required = buyAmount + 0.01;
                      const deficit = Math.max(0, required - balance);
                      return (
                        <div key={idx} className="flex justify-between text-xs">
                          <span className="text-gray-500">Bundle Wallet {idx + 1}:</span>
                          <span className="flex items-center gap-2">
                            <span className="text-gray-400">{buyAmount.toFixed(4)} SOL buy</span>
                            {deficit > 0 ? (
                              <span className="text-yellow-400">+{deficit.toFixed(4)} funded</span>
                            ) : (
                              <span className="text-green-400">✓ {balance.toFixed(4)} SOL</span>
                            )}
                          </span>
                        </div>
                      );
                    })
                  ) : (
                    // Show fresh wallet amounts
                    walletInfo.bundleWallets.amounts.map((amount, idx) => (
                    <div key={idx} className="flex justify-between text-xs">
                      <span className="text-gray-500">Bundle Wallet {idx + 1}:</span>
                      <span className="text-gray-300">{amount.toFixed(4)} SOL</span>
                    </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Holder Wallets Summary */}
            {(walletInfo.holderWallets.count > 0 || (useWarmedHolderWallets && selectedHolderWallets.length > 0)) && (
              <div className={`p-4 bg-gray-900/50 rounded-lg border-l-4 ${useWarmedHolderWallets && selectedHolderWallets.length > 0 && walletInfo.holderWallets.totalSol === 0 ? 'border-green-500' : 'border-yellow-500'}`}>
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className={`text-sm font-semibold mb-1 flex items-center gap-2 ${useWarmedHolderWallets && selectedHolderWallets.length > 0 ? 'text-yellow-400' : 'text-yellow-400'}`}>
                      <UserGroupIcon className="w-4 h-4" />
                      {walletInfo.holderWallets.label}
                      {useWarmedHolderWallets && selectedHolderWallets.length > 0 && walletInfo.holderWallets.totalSol === 0 && (
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
                      {walletInfo.holderWallets.totalSol > 0 ? 'Funding Needed' : 'Total Buy'}
                    </p>
                    <p className={`text-sm font-bold ${walletInfo.holderWallets.totalSol > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
                      {walletInfo.holderWallets.totalSol > 0 
                        ? `${walletInfo.holderWallets.totalSol.toFixed(4)} SOL`
                        : `${walletInfo.holderWallets.amounts.reduce((a, b) => a + b, 0).toFixed(4)} SOL`
                      }
                    </p>
                    {useWarmedHolderWallets && walletInfo.breakdown?.holderExistingBalance > 0 && (
                      <p className="text-[10px] text-gray-400">
                        Balance: {walletInfo.breakdown.holderExistingBalance.toFixed(4)} SOL
                      </p>
                    )}
                  </div>
                </div>
                {walletInfo.holderWallets.totalSol > 0 && (
                  <p className="text-[10px] text-blue-400 mt-1">↳ Will be funded from Master Wallet during initialization</p>
                )}
                <div className="mt-2 space-y-1">
                  {useWarmedHolderWallets && selectedHolderWallets.length > 0 ? (
                    // Show warmed holder wallet balances with deficit calculation
                    selectedHolderWallets.map((addr, idx) => {
                      const wallet = warmedWallets.find(w => w.address === addr);
                      const balance = wallet?.solBalance || wallet?.balance || 0;
                      const buyAmount = walletInfo.holderWallets.amounts[idx] || 0;
                      const required = buyAmount + 0.01;
                      const deficit = Math.max(0, required - balance);
                      return (
                        <div key={idx} className="flex justify-between text-xs">
                          <span className="text-gray-500">Holder Wallet {idx + 1}:</span>
                          <span className="flex items-center gap-2">
                            <span className="text-gray-400">{buyAmount.toFixed(4)} SOL buy</span>
                            {deficit > 0 ? (
                              <span className="text-yellow-400">+{deficit.toFixed(4)} funded</span>
                            ) : (
                              <span className="text-green-400">✓ {balance.toFixed(4)} SOL</span>
                            )}
                          </span>
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
                <p className="text-lg font-bold text-yellow-400"> Total SOL Required</p>
                <p className={`text-2xl font-bold ${walletInfo.fundingWallet.balance >= walletInfo.breakdown.total ? 'text-green-400' : 'text-red-400'}`}>
                  {walletInfo.breakdown.total.toFixed(4)} SOL
                </p>
              </div>
              <div className="space-y-1.5 text-xs border-t border-gray-700 pt-3">
                {/* Bundle Wallets */}
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-1">
                    <span className="text-gray-400">Bundle Wallets</span>
                    <InfoTooltip content="SOL sent to bundle wallets to buy tokens in the same transaction as the token creation. These wallets buy at launch price." />
                  </div>
                  <span className={useWarmedBundleWallets && selectedBundleWallets.length > 0 ? 'text-green-400' : 'text-gray-300'}>
                    {useWarmedBundleWallets && selectedBundleWallets.length > 0 
                      ? `Self-funded`
                      : `${walletInfo.breakdown.bundleWallets.toFixed(4)} SOL`
                    }
                  </span>
                </div>
                
                {/* Holder Wallets */}
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-1">
                    <span className="text-gray-400">Holder Wallets</span>
                    <InfoTooltip content="SOL sent to holder wallets that snipe the token after launch. These wallets simulate organic buying activity." />
                  </div>
                  <span className={useWarmedHolderWallets && selectedHolderWallets.length > 0 ? 'text-green-400' : 'text-gray-300'}>
                    {useWarmedHolderWallets && selectedHolderWallets.length > 0 
                      ? `Self-funded`
                      : `${walletInfo.breakdown.holderWallets.toFixed(4)} SOL`
                    }
                  </span>
                </div>
                
                {/* DEV Buy Amount */}
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-1">
                    <span className="text-gray-400">DEV Buy Amount</span>
                    <InfoTooltip content="SOL used by the creator/DEV wallet to buy tokens at launch. This is included in the bundle transaction." />
                  </div>
                  <span className={walletInfo.useFundingAsBuyer || walletInfo.creatorDevWallet?.isFundingWallet ? 'text-green-400' : 'text-gray-300'}>
                    {walletInfo.useFundingAsBuyer || walletInfo.creatorDevWallet?.isFundingWallet
                      ? `${walletInfo.buyerAmount.toFixed(4)} SOL (from wallet)`
                      : `${walletInfo.buyerAmount.toFixed(4)} SOL`
                    }
                  </span>
                </div>
                
                {/* Only show separate DEV funding if not using funding wallet as DEV */}
                {!walletInfo.useFundingAsBuyer && !walletInfo.creatorDevWallet?.isFundingWallet && walletInfo.breakdown.creatorDevWallet > 0 && (
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-1">
                      <span className="text-gray-400">DEV Wallet Funding</span>
                      <InfoTooltip content="Additional SOL sent to fund the DEV wallet for transaction fees and rent." />
                    </div>
                    <span className="text-gray-300">{walletInfo.breakdown.creatorDevWallet.toFixed(4)} SOL</span>
                  </div>
                )}
                
                <div className="border-t border-gray-600 pt-1.5 mt-1.5">
                  {/* Jito Fee */}
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500">Jito Tip</span>
                      <InfoTooltip content="Priority fee paid to Jito validators to include your bundle transaction. Higher tips = faster confirmation." />
                </div>
                    <span className="text-gray-400">{walletInfo.breakdown.jitoFee.toFixed(4)} SOL</span>
                </div>
                  
                  {/* LUT Creation */}
                  <div className="flex justify-between items-start mt-1">
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500">LUT Creation</span>
                      <InfoTooltip content="Lookup Table (LUT) rent - allows bundling more wallets in a single transaction. Rent is recoverable when LUT is closed." />
                    </div>
                    <span className="text-gray-400">{walletInfo.breakdown.lutFee.toFixed(4)} SOL</span>
                  </div>
                  
                  {/* Buffer */}
                  <div className="flex justify-between items-start mt-1">
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500">Buffer</span>
                      <InfoTooltip content="Safety buffer for network fees and rent. Usually much less is actually used. Any unused buffer is automatically refunded to your master wallet after the launch." />
                    </div>
                    <span className="text-gray-400">{walletInfo.breakdown.buffer.toFixed(4)} SOL <span className="text-green-500/70">(refundable)</span></span>
                  </div>
                </div>
              </div>
              {/* Warning: Only show if funding wallet doesn't have enough for ACTUAL transfers needed */}
              {/* Use totalNeededToTransfer (accounts for pre-funded wallets) instead of total (total spending) */}
              {walletInfo.breakdown.totalNeededToTransfer !== undefined && 
               walletInfo.fundingWallet.balance < walletInfo.breakdown.totalNeededToTransfer && (
                <div className="mt-3 p-2 bg-red-900/30 border border-red-500 rounded text-xs text-red-400">
                  [!] Insufficient balance! Need {((walletInfo.breakdown.totalNeededToTransfer - walletInfo.fundingWallet.balance).toFixed(4))} more SOL
                  <br />
                  <span className="text-yellow-400/80 text-[10px]">
                    (Note: Pre-funded wallets reduce the amount needed from master wallet)
                  </span>
                </div>
              )}
              {/* Fallback: If totalNeededToTransfer not available, use old calculation */}
              {walletInfo.breakdown.totalNeededToTransfer === undefined && 
               walletInfo.fundingWallet.balance < walletInfo.breakdown.total && (
                <div className="mt-3 p-2 bg-red-900/30 border border-red-500 rounded text-xs text-red-400">
                  [!] Insufficient balance! Need {((walletInfo.breakdown.total - walletInfo.fundingWallet.balance).toFixed(4))} more SOL
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
                    ? "Click wallets to select. Selected wallets will buy in the order shown below. Use  buttons to reorder."
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
                                    
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedHolderAutoBuyWallets(prev => prev.filter(a => a !== addr));
                                    }}
                                    className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded"
                                    title="Remove"
                                  >
                                    x
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
                                  
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedHolderAutoBuyIndices(prev => prev.filter(i => i !== idx));
                                  }}
                                  className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded"
                                  title="Remove"
                                >
                                  x
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
                          <span className="text-xs text-green-400 w-20"> {balance.toFixed(3)}</span>
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

              {/* Step 3: Configure Per-Wallet Timing & Safety */}
              {((useWarmedHolderWallets && selectedHolderAutoBuyWallets.length > 0) || (!useWarmedHolderWallets && selectedHolderAutoBuyIndices.length > 0)) && (
                <div className="pt-4 border-t border-gray-700">
                  <label className="block text-sm font-semibold text-yellow-400 mb-2">
                    {useWarmedHolderWallets ? 'Step 3' : 'Step 2'}: Configure When Each Wallet Buys
                  </label>
                  <p className="text-xs text-gray-400 mb-3">
                    Set timing and safety options for each wallet individually. Delay is seconds after launch (0 = buy immediately).
                  </p>
                  
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {useWarmedHolderWallets ? (
                      // Warmed wallets - use addresses as IDs
                      selectedHolderAutoBuyWallets.map((addr, idx) => {
                        const wallet = warmedWallets.find(w => w.address === addr);
                        const config = holderAutoBuyConfigs[addr] || { delay: idx === 0 ? 0 : idx * 0.5, safetyThreshold: 0 };
                        return (
                          <div key={addr} className="p-3 bg-gray-800/50 rounded border border-gray-700">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-yellow-400 w-8">#{idx + 1}</span>
                                <span className="text-xs font-mono text-white">
                                  {addr.slice(0, 8)}...{addr.slice(-6)}
                                </span>
                                {wallet && (
                                  <span className="text-xs text-gray-500">
                                    ({wallet.totalTrades || 0} trades)
                                  </span>
                                )}
                              </div>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-3">
                              {/* Delay */}
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Buy Delay (seconds)</label>
                                <div className="flex gap-1">
                                  <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    max="60"
                                    value={config.delay}
                                    onChange={(e) => {
                                      const newConfigs = { ...holderAutoBuyConfigs };
                                      newConfigs[addr] = { ...config, delay: parseFloat(e.target.value) || 0 };
                                      setHolderAutoBuyConfigs(newConfigs);
                                    }}
                                    className="flex-1 px-2 py-1.5 bg-black/50 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-yellow-500"
                                  />
                                  <div className="flex flex-col gap-0.5">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const newConfigs = { ...holderAutoBuyConfigs };
                                        newConfigs[addr] = { ...config, delay: 0 };
                                        setHolderAutoBuyConfigs(newConfigs);
                                      }}
                                      className="px-2 py-0.5 text-[10px] bg-green-600 hover:bg-green-700 text-white rounded"
                                      title="Buy immediately"
                                    >
                                      0s
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const newConfigs = { ...holderAutoBuyConfigs };
                                        newConfigs[addr] = { ...config, delay: 1 };
                                        setHolderAutoBuyConfigs(newConfigs);
                                      }}
                                      className="px-2 py-0.5 text-[10px] bg-blue-600 hover:bg-blue-700 text-white rounded"
                                      title="Buy 1 second after launch"
                                    >
                                      1s
                                    </button>
                                  </div>
                                </div>
                              </div>
                              
                              {/* Safety Threshold */}
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">
                                  Skip if external volume &gt; (SOL)
                                  <InfoTooltip content={[
                                    { bold: "External Volume Protection", text: "" },
                                    "External volume = buys/sells from wallets you DON'T control (not your dev, bundle, or holder wallets).",
                                    { bold: "How it works:", text: "If strangers buy more than this amount BEFORE your auto-buy triggers, it will SKIP the buy to protect you from buying at inflated prices." },
                                    { bold: "Set to 0:", text: "Disables protection - always buys regardless of external activity." }
                                  ]} />
                                </label>
                                <div className="flex gap-1">
                                  <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    max="10"
                                    value={config.safetyThreshold}
                                    onChange={(e) => {
                                      const newConfigs = { ...holderAutoBuyConfigs };
                                      newConfigs[addr] = { ...config, safetyThreshold: parseFloat(e.target.value) || 0 };
                                      setHolderAutoBuyConfigs(newConfigs);
                                    }}
                                    className="flex-1 px-2 py-1.5 bg-black/50 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-yellow-500"
                                    placeholder="0 = disabled"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const newConfigs = { ...holderAutoBuyConfigs };
                                      newConfigs[addr] = { ...config, safetyThreshold: 0 };
                                      setHolderAutoBuyConfigs(newConfigs);
                                    }}
                                    className="px-2 py-1.5 text-xs bg-gray-600 hover:bg-gray-700 text-white rounded"
                                    title="Disable safety"
                                  >
                                    Off
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      // Fresh wallets - use indices as IDs
                      selectedHolderAutoBuyIndices.map((walletIdx, idx) => {
                        const walletId = `wallet-${walletIdx}`;
                        const config = holderAutoBuyConfigs[walletId] || { delay: idx === 0 ? 0 : idx * 0.5, safetyThreshold: 0 };
                        return (
                          <div key={walletIdx} className="p-3 bg-gray-800/50 rounded border border-gray-700">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-yellow-400 w-8">#{idx + 1}</span>
                                <span className="text-xs font-mono text-white">
                                  Wallet #{walletIdx} (will be created at launch)
                                </span>
                              </div>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-3">
                              {/* Delay */}
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Buy Delay (seconds)</label>
                                <div className="flex gap-1">
                                  <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    max="60"
                                    value={config.delay}
                                    onChange={(e) => {
                                      const newConfigs = { ...holderAutoBuyConfigs };
                                      newConfigs[walletId] = { ...config, delay: parseFloat(e.target.value) || 0 };
                                      setHolderAutoBuyConfigs(newConfigs);
                                    }}
                                    className="flex-1 px-2 py-1.5 bg-black/50 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-yellow-500"
                                  />
                                  <div className="flex flex-col gap-0.5">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const newConfigs = { ...holderAutoBuyConfigs };
                                        newConfigs[walletId] = { ...config, delay: 0 };
                                        setHolderAutoBuyConfigs(newConfigs);
                                      }}
                                      className="px-2 py-0.5 text-[10px] bg-green-600 hover:bg-green-700 text-white rounded"
                                      title="Buy immediately"
                                    >
                                      0s
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const newConfigs = { ...holderAutoBuyConfigs };
                                        newConfigs[walletId] = { ...config, delay: 1 };
                                        setHolderAutoBuyConfigs(newConfigs);
                                      }}
                                      className="px-2 py-0.5 text-[10px] bg-blue-600 hover:bg-blue-700 text-white rounded"
                                      title="Buy 1 second after launch"
                                    >
                                      1s
                                    </button>
                                  </div>
                                </div>
                              </div>
                              
                              {/* Safety Threshold */}
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">
                                  Skip if external volume &gt; (SOL)
                                  <InfoTooltip content={[
                                    { bold: "External Volume Protection", text: "" },
                                    "External volume = buys/sells from wallets you DON'T control (not your dev, bundle, or holder wallets).",
                                    { bold: "How it works:", text: "If strangers buy more than this amount BEFORE your auto-buy triggers, it will SKIP the buy to protect you from buying at inflated prices." },
                                    { bold: "Set to 0:", text: "Disables protection - always buys regardless of external activity." }
                                  ]} />
                                </label>
                                <div className="flex gap-1">
                                  <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    max="10"
                                    value={config.safetyThreshold}
                                    onChange={(e) => {
                                      const newConfigs = { ...holderAutoBuyConfigs };
                                      newConfigs[walletId] = { ...config, safetyThreshold: parseFloat(e.target.value) || 0 };
                                      setHolderAutoBuyConfigs(newConfigs);
                                    }}
                                    className="flex-1 px-2 py-1.5 bg-black/50 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-yellow-500"
                                    placeholder="0 = disabled"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const newConfigs = { ...holderAutoBuyConfigs };
                                      newConfigs[walletId] = { ...config, safetyThreshold: 0 };
                                      setHolderAutoBuyConfigs(newConfigs);
                                    }}
                                    className="px-2 py-1.5 text-xs bg-gray-600 hover:bg-gray-700 text-white rounded"
                                    title="Disable safety"
                                  >
                                    Off
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                  
                  {/* Quick Actions */}
                  <div className="mt-3 flex gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => {
                        const newConfigs = { ...holderAutoBuyConfigs };
                        const wallets = useWarmedHolderWallets ? selectedHolderAutoBuyWallets : selectedHolderAutoBuyIndices.map(i => `wallet-${i}`);
                        wallets.forEach((id, idx) => {
                          newConfigs[id] = { delay: 0, safetyThreshold: 0 };
                        });
                        setHolderAutoBuyConfigs(newConfigs);
                      }}
                      className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 text-white rounded transition-colors"
                    >
                      Set All: Buy Immediately (0s delay)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const newConfigs = { ...holderAutoBuyConfigs };
                        const wallets = useWarmedHolderWallets ? selectedHolderAutoBuyWallets : selectedHolderAutoBuyIndices.map(i => `wallet-${i}`);
                        wallets.forEach((id, idx) => {
                          newConfigs[id] = { delay: idx * 0.5, safetyThreshold: 0 };
                        });
                        setHolderAutoBuyConfigs(newConfigs);
                      }}
                      className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                    >
                      Set All: Staggered (0s, 0.5s, 1s...)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const newConfigs = { ...holderAutoBuyConfigs };
                        const wallets = useWarmedHolderWallets ? selectedHolderAutoBuyWallets : selectedHolderAutoBuyIndices.map(i => `wallet-${i}`);
                        wallets.forEach((id) => {
                          if (newConfigs[id]) {
                            newConfigs[id].safetyThreshold = 0.5;
                          } else {
                            newConfigs[id] = { delay: 0, safetyThreshold: 0.5 };
                          }
                        });
                        setHolderAutoBuyConfigs(newConfigs);
                      }}
                      className="px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded transition-colors"
                    >
                      Set All Safety: 0.5 SOL
                    </button>
                  </div>
                  
                  <div className="mt-3 p-3 bg-blue-900/20 border border-blue-700/50 rounded">
                    <p className="text-xs text-blue-300 font-semibold mb-1">💡 Tips:</p>
                    <div className="space-y-1.5 text-xs text-blue-200">
                      <p>• <strong>Delay 0s:</strong> Buy immediately after launch (fastest, but most risky)</p>
                      <p>• <strong>Delay 1s+:</strong> Wait before buying - useful to stagger buys and look more organic</p>
                      <p className="pt-1 border-t border-blue-400/30">
                        <strong>External Volume Protection:</strong> External volume means buys/sells from wallets you DON'T control - i.e. NOT your dev wallet, bundle wallets, or holder wallets. If strangers buy more than the threshold before your auto-buy triggers, it skips to protect you from buying at inflated prices.
                      </p>
                      <p>• Set to <strong>0.2 SOL</strong>: Skip if strangers bought more than 0.2 SOL</p>
                      <p>• Set to <strong>0</strong>: No protection - always buy regardless of external activity</p>
                    </div>
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
                      <p className="text-xs text-red-300 font-semibold mb-1"> How it works:</p>
                      <div className="space-y-1 text-xs text-red-200">
                        <p>* Before each auto-buy, checks how much external wallets have bought</p>
                        <p>* If external buys &gt; threshold, <strong>skips the buy</strong> to avoid front-running</p>
                        <p>* Protects you from buying at inflated prices after snipers</p>
                      </div>
                      {frontRunThreshold > 0 && (
                        <p className="text-xs text-yellow-400 mt-2 font-semibold">
                          [fast] Current: Skip buy if external buys &gt; {frontRunThreshold} SOL
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

      {/* Token & Wallet Profiles Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-start justify-center p-4 pt-20 overflow-y-auto">
          <div className="bg-gray-900 border border-gray-800 rounded-lg max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-800">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <ArrowDownTrayIcon className="w-5 h-5 text-blue-400" />
                  Profiles
                </h3>
                <button
                  onClick={() => {
                    setShowConfigModal(false);
                    setConfigSaveName('');
                    setWalletProfileSaveName('');
                    setWalletProfileDescription('');
                  }}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <XCircleIcon className="w-5 h-5" />
                </button>
              </div>
              
              {/* Tab Navigation */}
              <div className="flex gap-2">
                <button
                  onClick={() => { setConfigModalTab('token'); loadSavedConfigs(); }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    configModalTab === 'token' 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                  }`}
                >
                   Token Profiles
                </button>
                <button
                  onClick={() => { setConfigModalTab('wallet'); loadWalletProfiles(); }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    configModalTab === 'wallet' 
                      ? 'bg-green-600 text-white' 
                      : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                  }`}
                >
                   Wallet Profiles
                </button>
              </div>
            </div>

            <div className="p-4 overflow-y-auto flex-1">
              {/* ========== TOKEN PROFILES TAB ========== */}
              {configModalTab === 'token' && (
                <>
                  {/* Save New Token Configuration */}
                  <div className="mb-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-white">Save Current Token Info</h4>
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
                        placeholder="Enter token profile name..."
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
                      Saves: Token name, symbol, description, images, links, theme
                      {selectedWalletProfileId && (
                        <span className="text-green-400 ml-1">
                          + links to wallet profile "{walletProfiles.find(p => p.id === selectedWalletProfileId)?.name}"
                        </span>
                      )}
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
                  </div>

                </>
              )}

              {/* ========== WALLET PROFILES TAB ========== */}
              {configModalTab === 'wallet' && (
                <>
                  {/* Currently Selected Wallet Profile */}
                  {selectedWalletProfileId && (
                    <div className="mb-3 p-3 bg-green-900/30 rounded-lg border border-green-700/50">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs text-green-400 font-semibold">Currently Active</p>
                          <p className="text-white font-medium">
                            {walletProfiles.find(p => p.id === selectedWalletProfileId)?.name || 'Unknown'}
                          </p>
                        </div>
                        <button
                          onClick={() => setSelectedWalletProfileId(null)}
                          className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Save New Wallet Profile */}
                  <div className="mb-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                    <h4 className="text-sm font-semibold text-white mb-3">Save Current Wallet Settings</h4>
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={walletProfileSaveName}
                        onChange={(e) => setWalletProfileSaveName(e.target.value)}
                        placeholder="Profile name (e.g., 'Aggressive', 'Safe Mode')..."
                        className="w-full px-3 py-2 bg-black/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                      />
                      <input
                        type="text"
                        value={walletProfileDescription}
                        onChange={(e) => setWalletProfileDescription(e.target.value)}
                        placeholder="Optional description..."
                        className="w-full px-3 py-2 bg-black/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      />
                      <button
                        onClick={saveWalletProfile}
                        disabled={!walletProfileSaveName.trim()}
                        className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                      >
                        Save Wallet Profile
                      </button>
                    </div>
                    <div className="mt-3 p-2 bg-black/30 rounded text-xs text-gray-400 space-y-1">
                      <p className="font-semibold text-gray-300">This will save:</p>
                      <p>* Bundle wallets: {settings.BUNDLE_WALLET_COUNT || 0} wallets</p>
                      <p>* Holder wallets: {settings.HOLDER_WALLET_COUNT || 0} wallets</p>
                      <p>* DEV buy amount: {settings.BUYER_AMOUNT || 0} SOL</p>
                      <p>* Swap amounts, privacy settings, auto-sell config</p>
                    </div>
                  </div>

                  {/* Load Saved Wallet Profiles */}
                  <div>
                    <h4 className="text-sm font-semibold text-white mb-3">Load Wallet Profile</h4>
                    {loadingWalletProfiles ? (
                      <div className="text-center py-8 text-gray-400">
                        <ArrowPathIcon className="w-8 h-8 animate-spin mx-auto mb-2" />
                        Loading wallet profiles...
                      </div>
                    ) : walletProfiles.length === 0 ? (
                      <div className="text-center py-8 text-gray-400">
                        <p>No wallet profiles saved yet.</p>
                        <p className="text-xs mt-2">Save your wallet settings above to create reusable profiles!</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {walletProfiles.map((profile) => (
                          <div
                            key={profile.id}
                            onClick={() => loadWalletProfile(profile.id)}
                            className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                              selectedWalletProfileId === profile.id
                                ? 'bg-green-900/30 border-green-600'
                                : 'bg-gray-800/50 border-gray-700 hover:bg-gray-800 hover:border-gray-600'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="flex items-center gap-2">
                                  <h5 className="font-semibold text-white">{profile.name}</h5>
                                  {selectedWalletProfileId === profile.id && (
                                    <span className="text-xs px-2 py-0.5 bg-green-600 text-white rounded">Active</span>
                                  )}
                                </div>
                                {profile.description && (
                                  <p className="text-xs text-gray-400 mt-1">{profile.description}</p>
                                )}
                                <div className="flex gap-3 mt-2 text-xs text-gray-500">
                                  <span> {profile.bundleWalletCount || 0} bundle</span>
                                  <span> {profile.holderWalletCount || 0} holder</span>
                                </div>
                              </div>
                              <button
                                onClick={(e) => deleteWalletProfile(profile.id, e)}
                                className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-900/30 rounded transition-colors"
                                title="Delete wallet profile"
                              >
                                <TrashIcon className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Token Profiles List (only show when on token tab) */}
              {configModalTab === 'token' && (
                <>
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
                                   {config.data.WEBSITE.replace(/^https?:\/\//, '')}
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
                                   Twitter
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
                                   Telegram
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
                </>
              )}
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
                      ? ` Self-funded (${walletInfo.breakdown.bundleExistingBalance?.toFixed(3) || '0'} SOL)`
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
                      ? ` Self-funded (${walletInfo.breakdown.holderExistingBalance?.toFixed(3) || '0'} SOL)`
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

      {/* Toast Notifications */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`px-4 py-3 rounded-lg shadow-lg border backdrop-blur-sm animate-slide-in flex items-center gap-2 min-w-[200px] ${
              toast.type === 'success' 
                ? 'bg-green-900/90 border-green-500/50 text-green-300' 
                : toast.type === 'error'
                ? 'bg-red-900/90 border-red-500/50 text-red-300'
                : 'bg-blue-900/90 border-blue-500/50 text-blue-300'
            }`}
          >
            {toast.type === 'success' && (
              <CheckCircleIcon className="w-4 h-4 text-green-400 flex-shrink-0" />
            )}
            {toast.type === 'error' && (
              <ExclamationTriangleIcon className="w-4 h-4 text-red-400 flex-shrink-0" />
            )}
            <span className="text-sm">{toast.message}</span>
          </div>
        ))}
      </div>

    </div>
  );
}


