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
  ChevronUpIcon
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

// Compact Info Tooltip Component
const InfoTooltip = ({ content }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow(!show)}
        className="inline-flex items-center justify-center w-4 h-4 text-gray-400 hover:text-gray-300 transition-colors"
      >
        <QuestionMarkCircleIcon className="w-4 h-4" />
      </button>
      {show && (
        <div className="absolute z-50 left-0 top-6 w-64 p-3 bg-gray-900 border border-gray-700 rounded-lg shadow-xl text-xs text-gray-300">
          {typeof content === 'string' ? (
            <p>{content}</p>
          ) : (
            <div className="space-y-1">
              {content.map((item, i) => (
                <p key={i}>{item}</p>
              ))}
            </div>
          )}
          <div className="absolute -top-1 left-2 w-2 h-2 bg-gray-900 border-l border-t border-gray-700 transform rotate-45"></div>
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
  const [savingStatus, setSavingStatus] = useState('');
  const autoSaveTimeoutRef = useRef(null);
  const [launchStage, setLaunchStage] = useState(null);
  const [launchProgress, setLaunchProgress] = useState(0);
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
  const [tweetList, setTweetList] = useState([]); // Array of { text: string, image: File | null, imagePreview: string | null }
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [showBuyerWallet, setShowBuyerWallet] = useState(false);
  const [useWarmedWallets, setUseWarmedWallets] = useState(false);
  const [warmedWallets, setWarmedWallets] = useState([]);
  const [selectedBundleWallets, setSelectedBundleWallets] = useState([]);
  const [selectedHolderWallets, setSelectedHolderWallets] = useState([]);
  const [loadingWarmedWallets, setLoadingWarmedWallets] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  // Filter and sort state for wallet modal
  const [searchQuery, setSearchQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');

  useEffect(() => {
    loadSettings();
    loadNextAddress();
    loadDeployerWallet();
    loadWalletInfo();
    loadWarmedWallets();
  }, []);

  const loadWarmedWallets = async () => {
    try {
      setLoadingWarmedWallets(true);
      const res = await apiService.getWarmingWallets();
      if (res.data.success) {
        setWarmedWallets(res.data.wallets || []);
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

  // Sync amounts with warmed wallet selections
  useEffect(() => {
    if (useWarmedWallets) {
      const bundleCount = selectedBundleWallets.length;
      const holderCount = selectedHolderWallets.length;
      
      // Sync bundle amounts
      if (bundleCount === 0) {
        // Clear amounts if no wallets selected
        if (settings.BUNDLE_SWAP_AMOUNTS) {
          handleChange('BUNDLE_SWAP_AMOUNTS', '');
        }
        if (settings.BUNDLE_WALLET_COUNT !== '0') {
          handleChange('BUNDLE_WALLET_COUNT', '0');
        }
      } else {
        // Adjust amounts to match selected wallet count
        const currentAmounts = settings.BUNDLE_SWAP_AMOUNTS || '';
        const amountsArray = currentAmounts ? currentAmounts.split(',').map(a => a.trim()).filter(a => a) : [];
        const defaultAmount = settings.SWAP_AMOUNT || '0.01';
        
          if (bundleCount !== amountsArray.length) {
            let newAmounts;
            if (bundleCount > amountsArray.length) {
            // Pad with default amount
            newAmounts = [...amountsArray];
            while (newAmounts.length < bundleCount) {
              newAmounts.push(defaultAmount);
            }
          } else {
            // Trim to match count
            newAmounts = amountsArray.slice(0, bundleCount);
          }
          handleChange('BUNDLE_SWAP_AMOUNTS', newAmounts.join(','));
        }
        if (settings.BUNDLE_WALLET_COUNT !== bundleCount.toString()) {
          handleChange('BUNDLE_WALLET_COUNT', bundleCount.toString());
        }
      }
      
      // Sync holder amounts
      if (holderCount === 0) {
        // Clear amounts if no wallets selected
        if (settings.HOLDER_SWAP_AMOUNTS) {
          handleChange('HOLDER_SWAP_AMOUNTS', '');
        }
        if (settings.HOLDER_WALLET_COUNT !== '0') {
          handleChange('HOLDER_WALLET_COUNT', '0');
        }
      } else {
        // Adjust amounts to match selected wallet count
        const currentAmounts = settings.HOLDER_SWAP_AMOUNTS || '';
        const amountsArray = currentAmounts ? currentAmounts.split(',').map(a => a.trim()).filter(a => a) : [];
        const defaultAmount = settings.HOLDER_WALLET_AMOUNT || '0.01';
        
        if (holderCount !== amountsArray.length) {
          let newAmounts: string[];
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
  }, [useWarmedWallets, selectedBundleWallets.length, selectedHolderWallets.length]);

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
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

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

  const handleWebsiteLogoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setWebsiteLogoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setWebsiteLogoPreview(reader.result);
      };
      reader.readAsDataURL(file);
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
        // Normalize theme to lowercase for CSS file names (blue.css, green.css, purple.css, etc.)
        colorScheme = websiteTheme.toLowerCase().trim();
        darkMode = false;
      }
      // If DEFAULT, leave colorScheme as undefined so it doesn't update the database field
      
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
            chain: 'solana',
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
            chain: 'solana',
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
      } else {
        // If amounts cleared, reset count to 0 (unless using warmed wallets)
        if (!useWarmedWallets) {
          newSettings.BUNDLE_WALLET_COUNT = '0';
        }
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
          if (['BUNDLE_WALLET_COUNT', 'BUNDLE_SWAP_AMOUNTS', 'HOLDER_WALLET_COUNT', 'HOLDER_SWAP_AMOUNTS', 'HOLDER_WALLET_AMOUNT', 'BUYER_AMOUNT', 'SWAP_AMOUNT', 'USE_NORMAL_LAUNCH'].includes(key)) {
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
      // Include warmed wallet selections if using warmed wallets
      const launchData = useWarmedWallets ? {
        useWarmedWallets: true,
        bundleWalletAddresses: selectedBundleWallets,
        holderWalletAddresses: selectedHolderWallets
      } : {};
      const res = await apiService.launchToken(launchData);
      
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
            
            // Auto-navigate to holders once wallets are created and funded
            if (stage === 'FUNDING_WALLETS' && onLaunch) {
              console.log('✅ Wallets created! Auto-navigating to Holders page...');
              onLaunch(); // This switches to holders tab
            }
            
            if (currentRun.launchStatus === 'SUCCESS') {
              // Launch completed successfully!
              console.log('✅ Launch completed successfully!');
              setLaunchStage('SUCCESS');
              setLaunchProgress(100);
              await loadWalletInfo();
              if (onLaunch) onLaunch();
              setLoading(false);
              alert('✅ Token launched successfully!');
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
            } else if (currentRun.mintAddress && 
                       ((currentRun.bundleWalletKeys && currentRun.bundleWalletKeys.length > 0) ||
                        (currentRun.holderWalletKeys && currentRun.holderWalletKeys.length > 0) ||
                        (currentRun.walletKeys && currentRun.walletKeys.length > 0))) {
              // Legacy check: has mintAddress and wallets but no launchStatus (old format)
              // Assume success
              console.log('✅ Launch completed (legacy format)!');
              setLaunchStage('SUCCESS');
              setLaunchProgress(100);
              await loadWalletInfo();
              if (onLaunch) onLaunch();
              setLoading(false);
              alert('✅ Token launched successfully!');
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
            alert(`⏳ Launch is taking longer than expected (${elapsedMinutes} minutes).\n\nIt may still be in progress. Check the API server terminal for updates.\n\nYou can refresh the page to check status manually.`);
          }
        } catch (error) {
          // current-run.json might not exist yet (launch just started)
          setLaunchStage('INITIALIZING');
          setLaunchProgress(5);
          attempts++;
          
          if (attempts < maxAttempts) {
            setTimeout(checkLaunchComplete, checkInterval);
          } else {
            setLoading(false);
            alert('⏳ Launch is taking longer than expected. Check the API server terminal for progress.\n\nYou can refresh the page to check status manually.');
          }
        }
      };
      
      // Start checking immediately (faster response)
      setTimeout(checkLaunchComplete, 1000);
      
    } catch (error) {
      alert('Failed to launch token: ' + (error.response?.data?.error || error.message));
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-lg p-6">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <RocketLaunchIconSolid className="w-7 h-7 text-blue-400" />
          <h2 className="text-2xl font-bold text-white">Launch Token</h2>
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

      {/* Next Pump Address */}
      {nextAddress && (
        <div className="mb-6 p-4 bg-gray-900/50 border border-gray-800 rounded-lg">
          <p className="text-sm text-gray-300 mb-1">Next Pump Address</p>
          {nextAddress.address ? (
            <>
              <p className="text-sm font-mono text-white break-all">{nextAddress.address}</p>
              {nextAddress.source && (
                <p className="text-xs text-gray-500 mt-1">Source: {nextAddress.source}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-yellow-400">{nextAddress.source || 'No address available'}</p>
          )}
        </div>
      )}

      {/* Token Details Section */}
      <div className="mb-6 p-5 bg-gray-900/50 rounded-lg border border-gray-800">
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
          </svg>
          Token Details
        </h3>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Token Name *
              </label>
              <input
                type="text"
                value={settings.TOKEN_NAME || ''}
                onChange={(e) => handleChange('TOKEN_NAME', e.target.value)}
                className="w-full px-4 py-2 bg-black/50 border border-gray-800 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="My Awesome Token"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Token Symbol *
              </label>
              <input
                type="text"
                value={settings.TOKEN_SYMBOL || ''}
                onChange={(e) => handleChange('TOKEN_SYMBOL', e.target.value.toUpperCase())}
                className="w-full px-4 py-2 bg-black/50 border border-gray-800 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="MAT"
                maxLength={10}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Description *
            </label>
            <textarea
              value={settings.DESCRIPTION || ''}
              onChange={(e) => handleChange('DESCRIPTION', e.target.value)}
              rows={3}
              className="w-full px-4 py-2 bg-black/50 border border-gray-800 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Describe your token..."
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Twitter
              </label>
              <input
                type="text"
                value={settings.TWITTER || ''}
                onChange={(e) => handleChange('TWITTER', e.target.value)}
                className="w-full px-4 py-2 bg-black/50 border border-gray-800 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="@username"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Telegram
              </label>
              <input
                type="text"
                value={settings.TELEGRAM || ''}
                onChange={(e) => handleChange('TELEGRAM', e.target.value)}
                className="w-full px-4 py-2 bg-black/50 border border-gray-800 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="t.me/..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Website
              </label>
              <input
                type="text"
                value={settings.WEBSITE || ''}
                onChange={(e) => handleChange('WEBSITE', e.target.value)}
                className="w-full px-4 py-2 bg-black/50 border border-gray-800 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="https://..."
              />
            </div>
          </div>
        </div>
      </div>

      {/* Wallet Private Keys Section - PROMINENT */}
      <div className="mb-6 p-5 bg-gradient-to-r from-blue-900/30 to-purple-900/30 rounded-lg border-2 border-blue-500/50">
        <div className="flex items-center gap-3 mb-4">
          <LockClosedIcon className="w-6 h-6 text-blue-400" />
          <h3 className="text-lg font-bold text-white">Wallet Private Keys</h3>
        </div>
        <div className="space-y-4">
          {/* Master Wallet Private Key */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-white">
                <span className="flex items-center gap-2">
                  <WalletIcon className="w-4 h-4" />
                  Master Wallet (PRIVATE_KEY) *
                </span>
              </label>
              {walletInfo?.fundingWallet?.balance !== undefined && (
                <div className="text-right">
                  <p className="text-xs text-gray-400">Balance</p>
                  <p className={`text-sm font-bold ${walletInfo.fundingWallet.balance >= (walletInfo.breakdown?.total || 0) ? 'text-green-400' : 'text-yellow-400'}`}>
                    {walletInfo.fundingWallet.balance.toFixed(4)} SOL
                  </p>
                </div>
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
                className="w-full px-4 py-2 pr-24 bg-black/50 border border-gray-800 rounded-lg text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter master wallet private key (base58)"
              />
              <button
                type="button"
                onClick={() => setShowPrivateKey(!showPrivateKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 bg-gray-800 hover:bg-gray-700 text-white text-xs rounded transition-colors"
              >
                {showPrivateKey ? '👁️ Hide' : '👁️ Show'}
              </button>
            </div>
            {settings.PRIVATE_KEY && !showPrivateKey && (
              <p className="text-xs text-gray-500 mt-1 font-mono">
                {settings.PRIVATE_KEY.length > 20 
                  ? `${settings.PRIVATE_KEY.substring(0, 10)}...${settings.PRIVATE_KEY.substring(settings.PRIVATE_KEY.length - 10)}`
                  : '•'.repeat(settings.PRIVATE_KEY.length)}
              </p>
            )}
            <div className="flex items-center justify-between mt-1">
              <p className="text-xs text-gray-400">
                Main funding wallet for token creation and transactions
              </p>
              <button
                type="button"
                onClick={() => loadWalletInfo()}
                className="text-xs text-blue-400 hover:text-blue-300 underline"
                title="Refresh balance"
              >
                🔄 Refresh
              </button>
            </div>
          </div>

          {/* Buyer/Creator Wallet */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-white">
                <span className="flex items-center gap-2">
                  <UserIcon className="w-4 h-4" />
                  Buyer/Creator Wallet (BUYER_WALLET)
                </span>
              </label>
              {walletInfo?.creatorDevWallet?.balance !== undefined && !walletInfo?.creatorDevWallet?.isAutoCreated && (
                <div className="text-right">
                  <p className="text-xs text-gray-400">Balance</p>
                  <p className="text-sm font-bold text-green-400">
                    {walletInfo.creatorDevWallet.balance.toFixed(4)} SOL
                  </p>
                </div>
              )}
            </div>
            <div className="relative">
              <input
                type={showBuyerWallet ? 'text' : 'password'}
                value={settings.BUYER_WALLET || ''}
                onChange={(e) => {
                  handleChange('BUYER_WALLET', e.target.value);
                  setTimeout(() => loadWalletInfo(), 1000);
                }}
                className="w-full px-4 py-2 pr-24 bg-black/50 border border-gray-800 rounded-lg text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter buyer/creator wallet private key (base58, optional)"
              />
              <button
                type="button"
                onClick={() => setShowBuyerWallet(!showBuyerWallet)}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 bg-gray-800 hover:bg-gray-700 text-white text-xs rounded transition-colors"
              >
                {showBuyerWallet ? '👁️ Hide' : '👁️ Show'}
              </button>
            </div>
            {settings.BUYER_WALLET && !showBuyerWallet && (
              <p className="text-xs text-gray-500 mt-1 font-mono">
                {settings.BUYER_WALLET.length > 20 
                  ? `${settings.BUYER_WALLET.substring(0, 10)}...${settings.BUYER_WALLET.substring(settings.BUYER_WALLET.length - 10)}`
                  : '•'.repeat(settings.BUYER_WALLET.length)}
              </p>
            )}
            <CollapsibleInfo title="How DEV Wallet Creation Works">
              <ul className="ml-3 list-disc space-y-1">
                <li><strong>If BUYER_WALLET is set:</strong> Uses that wallet for all launches (persistent wallet)</li>
                <li><strong>If BUYER_WALLET is empty:</strong> Auto-creates a new wallet for each launch</li>
                <li><strong>Auto-created wallets:</strong> Generated fresh for each token launch, saved to <code className="text-blue-400">current-run.json</code></li>
                <li><strong>Funding:</strong> Master Wallet funds the DEV wallet with <code className="text-blue-400">BUYER_AMOUNT</code> SOL before launch</li>
                <li><strong>Distribution:</strong> DEV wallet buys tokens first, then Bundle wallets, then Holder wallets</li>
              </ul>
            </CollapsibleInfo>
          </div>
        </div>
      </div>

      {/* Wallet Configuration - PROMINENT */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <CurrencyDollarIcon className="w-5 h-5 text-blue-400" />
            Wallet Configuration
          </h3>
          {settings.USE_MIXING_WALLETS === 'true' && (
            <div className="flex items-center gap-2 px-3 py-1 bg-purple-900/30 border border-purple-500/50 rounded-lg">
              <ArrowPathRoundedSquareIcon className="w-4 h-4 text-purple-400" />
              <span className="text-xs text-purple-300">Mixing Wallets Enabled</span>
            </div>
          )}
        </div>
        {/* Mixing Wallets Toggle */}
        <div className="mb-4 p-4 bg-purple-900/20 rounded-lg border border-purple-500/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ArrowPathRoundedSquareIcon className="w-5 h-5 text-purple-400" />
              <div>
                <label htmlFor="use-mixing-wallets" className="text-sm font-semibold text-white cursor-pointer">
                  Use Mixing Wallets (Break Connection Trail)
                </label>
                <p className="text-xs text-gray-400 mt-1">
                  Routes SOL through intermediate wallets to prevent bubble maps from connecting your wallets
                </p>
              </div>
            </div>
            <input
              type="checkbox"
              id="use-mixing-wallets"
              checked={settings.USE_MIXING_WALLETS !== 'false'}
              onChange={(e) => handleChange('USE_MIXING_WALLETS', e.target.checked ? 'true' : 'false')}
              className="w-5 h-5 text-purple-500 bg-gray-800 border-gray-700 rounded focus:ring-2 focus:ring-purple-500 cursor-pointer"
            />
          </div>
          {settings.USE_MIXING_WALLETS !== 'false' && (
            <div className="mt-2 space-y-2">
              {/* Fresh Mixing Wallets Toggle */}
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="create-fresh-mixing-wallets"
                  checked={settings.CREATE_FRESH_MIXING_WALLETS !== 'false'}
                  onChange={(e) => handleChange('CREATE_FRESH_MIXING_WALLETS', e.target.checked ? 'true' : 'false')}
                  className="w-4 h-4 text-purple-500 bg-gray-800 border-gray-700 rounded focus:ring-2 focus:ring-purple-500"
                />
                <label htmlFor="create-fresh-mixing-wallets" className="text-xs text-gray-300 cursor-pointer">
                  Create Fresh Mixing Wallets Each Launch
                </label>
                <InfoTooltip content={settings.CREATE_FRESH_MIXING_WALLETS !== 'false' 
                  ? "✨ Fresh Wallets: Creates brand new mixing wallets for each launch. Better privacy - no wallet reuse. Old wallets preserved in file."
                  : "⚠️ Reuse Mode: Reuses existing mixing wallets. Less private - wallets can be traced across launches."
                } />
              </div>
              <CollapsibleInfo title="How Mixing Wallets Work">
                <ul className="ml-3 list-disc space-y-0.5">
                  <li>Main Wallet → Mixing Wallet → Target Wallet</li>
                  <li>Breaks on-chain connection trail</li>
                  <li>Prevents bubble map detection</li>
                  <li>Auto-creates mixing wallets if missing</li>
                </ul>
              </CollapsibleInfo>
            </div>
          )}
        </div>

        {/* Wallet Source Selection */}
        <div className="mb-6 p-4 bg-blue-900/20 rounded-lg border border-blue-500/30">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <WalletIcon className="w-5 h-5 text-blue-400" />
              <div>
                <label className="text-sm font-semibold text-white cursor-pointer">
                  Wallet Source
                </label>
                <p className="text-xs text-gray-400 mt-1">
                  Choose to create fresh wallets or use warmed wallets with transaction history
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setUseWarmedWallets(false)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  !useWarmedWallets
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                Create Fresh Wallets
              </button>
              <button
                type="button"
                onClick={() => {
                  setUseWarmedWallets(true);
                  loadWarmedWallets();
                }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  useWarmedWallets
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                Use Warmed Wallets
              </button>
            </div>
          </div>
          {useWarmedWallets && (
            <div className="mt-4 space-y-4">
              {/* Selected Wallets Summary */}
              <div className="p-4 bg-gray-900/50 rounded border border-gray-800">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      Selected Wallets Summary
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      Total Available: {warmedWallets.length} | 
                      Bundle: {selectedBundleWallets.length} | 
                      Holder: {selectedHolderWallets.length}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      loadWarmedWallets();
                      setShowWalletModal(true);
                    }}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
                  >
                    📋 Select Wallets
                  </button>
                </div>
                
                {/* Selected Bundle Wallets */}
                {selectedBundleWallets.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs font-semibold text-green-400 mb-2">
                      Bundle Wallets ({selectedBundleWallets.length}):
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {selectedBundleWallets.map(addr => {
                        const wallet = warmedWallets.find(w => w.address === addr);
                        return (
                          <div
                            key={addr}
                            className="px-2 py-1 bg-green-900/30 border border-green-600/50 rounded text-xs"
                          >
                            <p className="text-white font-mono">{addr.slice(0, 8)}...{addr.slice(-6)}</p>
                            {wallet && (
                              <div className="text-gray-400 text-[10px] mt-0.5">
                                Trades: {wallet.totalTrades || wallet.transactionCount || 0} | 
                                SOL: {(wallet.solBalance || 0).toFixed(4)}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                
                {/* Selected Holder Wallets */}
                {selectedHolderWallets.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-yellow-400 mb-2">
                      Holder Wallets ({selectedHolderWallets.length}):
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {selectedHolderWallets.map(addr => {
                        const wallet = warmedWallets.find(w => w.address === addr);
                        return (
                          <div
                            key={addr}
                            className="px-2 py-1 bg-yellow-900/30 border border-yellow-600/50 rounded text-xs"
                          >
                            <p className="text-white font-mono">{addr.slice(0, 8)}...{addr.slice(-6)}</p>
                            {wallet && (
                              <div className="text-gray-400 text-[10px] mt-0.5">
                                Trades: {wallet.totalTrades || wallet.transactionCount || 0} | 
                                SOL: {(wallet.solBalance || 0).toFixed(4)}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                
                {selectedBundleWallets.length === 0 && selectedHolderWallets.length === 0 && (
                  <p className="text-xs text-gray-500 italic">
                    No wallets selected. Click "Select Wallets" to choose warmed wallets for your launch.
                  </p>
                )}
              </div>
            </div>
          )}
          
          {/* Wallet Selection Modal */}
          {showWalletModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
              <div className="bg-gray-900 border border-gray-700 rounded-lg w-[95vw] h-[90vh] max-w-7xl flex flex-col">
                {/* Modal Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-800">
                  <div>
                    <h3 className="text-xl font-bold text-white">Select Warmed Wallets</h3>
                    <p className="text-sm text-gray-400 mt-1">
                      {filteredAndSortedWallets.length} of {warmedWallets.length} wallets shown | 
                      Bundle: {selectedBundleWallets.length} | 
                      Holder: {selectedHolderWallets.length}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowWalletModal(false)}
                    className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors"
                  >
                    ✕ Close
                  </button>
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
                      className={`px-3 py-1 rounded text-xs font-medium ${
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
                        return (
                          <div
                            key={wallet.address}
                            className={`p-3 rounded-lg border ${
                              isBundle || isHolder
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
                                  <span className="text-white text-[10px]">
                                    {new Date(wallet.firstTransactionDate).toLocaleDateString()}
                                  </span>
                                </div>
                              )}
                              {wallet.lastTransactionDate && (
                                <div className="flex justify-between">
                                  <span className="text-gray-400">Last TX:</span>
                                  <span className="text-white text-[10px]">
                                    {new Date(wallet.lastTransactionDate).toLocaleDateString()}
                                  </span>
                                </div>
                              )}
                              {wallet.tags && wallet.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {wallet.tags.map(tag => (
                                    <span key={tag} className="px-1.5 py-0.5 bg-blue-900/50 text-blue-300 rounded text-[10px]">
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
                                  if (isBundle) {
                                    setSelectedBundleWallets(prev => prev.filter(a => a !== wallet.address));
                                  } else {
                                    setSelectedBundleWallets(prev => [...prev, wallet.address]);
                                    // Remove from holder if it was there
                                    setSelectedHolderWallets(prev => prev.filter(a => a !== wallet.address));
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
                                    // Remove from bundle if it was there
                                    setSelectedBundleWallets(prev => prev.filter(a => a !== wallet.address));
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
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Bundle Wallets */}
          <div className="p-4 bg-gray-900/50 rounded-lg border-l-4 border-green-500">
            <label className="block text-sm font-semibold text-green-400 mb-3 flex items-center gap-2">
              <CubeIcon className="w-4 h-4" />
              Bundle Wallets
              <InfoTooltip content="Wallets that participate in Jito bundle for atomic execution. 5-6 max recommended to avoid bundle size limits." />
            </label>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Count {useWarmedWallets && selectedBundleWallets.length > 0 && (
                    <span className="text-green-400">({selectedBundleWallets.length} selected)</span>
                  )}
                </label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={useWarmedWallets ? selectedBundleWallets.length : (settings.BUNDLE_WALLET_COUNT || '0')}
                  onChange={(e) => {
                    if (!useWarmedWallets) {
                      handleChange('BUNDLE_WALLET_COUNT', e.target.value);
                    }
                  }}
                  disabled={useWarmedWallets}
                  className={`w-full px-3 py-2 bg-black/50 border border-gray-800 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500 ${
                    useWarmedWallets ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                />
                {useWarmedWallets && (
                  <p className="text-xs text-gray-500 mt-1">
                    Select warmed wallets above to use as bundle wallets
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Amounts (comma-separated SOL)</label>
                <input
                  type="text"
                  value={settings.BUNDLE_SWAP_AMOUNTS || ''}
                  onChange={(e) => handleChange('BUNDLE_SWAP_AMOUNTS', e.target.value)}
                  placeholder="0.1,0.1,0.2"
                  className="w-full px-3 py-2 bg-black/50 border border-gray-800 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <p className="text-xs text-gray-600 mt-1">Leave empty to use SWAP_AMOUNT</p>
              </div>
              <div className="flex items-center space-x-2 pt-2 border-t border-gray-800">
                <input
                  type="checkbox"
                  id="use-normal-launch"
                  checked={settings.USE_NORMAL_LAUNCH === 'true'}
                  onChange={(e) => handleChange('USE_NORMAL_LAUNCH', e.target.checked ? 'true' : 'false')}
                  className="w-4 h-4 text-green-500 bg-gray-800 border-gray-700 rounded focus:ring-2 focus:ring-green-500"
                />
                <label htmlFor="use-normal-launch" className="text-xs text-gray-300 cursor-pointer flex items-center gap-1">
                  <RocketLaunchIcon className="w-3 h-3" />
                  Use Normal Launch
                </label>
              </div>
              <InfoTooltip content={settings.USE_NORMAL_LAUNCH === 'true' 
                ? "Normal Launch: Skips Jito bundling and LUT creation. Best for token creation + DEV buy only."
                : "Bundle Launch: Uses Jito bundling and LUT for faster, atomic execution of multiple transactions."
              } />
            </div>
          </div>

          {/* Holder Wallets */}
          <div className="p-4 bg-gray-900/50 rounded-lg border-l-4 border-yellow-500">
            <label className="block text-sm font-semibold text-yellow-400 mb-3 flex items-center gap-2">
              <UserGroupIcon className="w-4 h-4" />
              Holder Wallets
              <InfoTooltip content="Wallets funded for post-launch buying. Not included in bundle - used for organic trading after launch." />
            </label>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Count {useWarmedWallets && selectedHolderWallets.length > 0 && (
                    <span className="text-yellow-400">({selectedHolderWallets.length} selected)</span>
                  )}
                </label>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={useWarmedWallets ? selectedHolderWallets.length : (settings.HOLDER_WALLET_COUNT || '0')}
                  onChange={(e) => {
                    if (!useWarmedWallets) {
                      handleChange('HOLDER_WALLET_COUNT', e.target.value);
                    }
                  }}
                  disabled={useWarmedWallets}
                  className={`w-full px-3 py-2 bg-black/50 border border-gray-800 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500 ${
                    useWarmedWallets ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                />
                {useWarmedWallets && (
                  <p className="text-xs text-gray-500 mt-1">
                    Select warmed wallets above to use as holder wallets
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Amounts (comma-separated SOL)</label>
                <input
                  type="text"
                  value={settings.HOLDER_SWAP_AMOUNTS || ''}
                  onChange={(e) => handleChange('HOLDER_SWAP_AMOUNTS', e.target.value)}
                  placeholder="0.5,0.2,1"
                  className="w-full px-3 py-2 bg-black/50 border border-gray-800 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
                />
                <p className="text-xs text-gray-600 mt-1">Leave empty to use Amount per Wallet</p>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Amount per Wallet (SOL)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={settings.HOLDER_WALLET_AMOUNT || '0.10'}
                  onChange={(e) => handleChange('HOLDER_WALLET_AMOUNT', e.target.value)}
                  className="w-full px-3 py-2 bg-black/50 border border-gray-800 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
                />
              </div>
            </div>
          </div>

          {/* DEV Buy */}
          <div className="p-4 bg-gray-900/50 rounded-lg border-l-4 border-purple-500">
            <label className="block text-sm font-semibold text-purple-400 mb-3 flex items-center gap-2">
              <WalletIcon className="w-4 h-4" />
              DEV Buy Amount
              <InfoTooltip content="Amount of SOL the DEV/creator wallet uses to buy tokens. This is the first buy after token creation." />
            </label>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Amount (SOL)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={settings.BUYER_AMOUNT || '1'}
                onChange={(e) => handleChange('BUYER_AMOUNT', e.target.value)}
                className="w-full px-3 py-2 bg-black/50 border border-gray-800 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
          </div>
        </div>

        {/* WebSocket Tracking Section */}
        <div className="mt-6 p-5 bg-gradient-to-r from-cyan-900/30 to-blue-900/30 rounded-lg border-2 border-cyan-500/50">
          <div className="flex items-center gap-3 mb-4">
            <BellIcon className="w-6 h-6 text-cyan-400" />
            <h3 className="text-lg font-bold text-white">WebSocket Tracking (Auto-Sell on External Buys)</h3>
          </div>
          <div className="space-y-4">
            {/* Enable Toggle */}
            <div className="flex items-center justify-between mb-3">
              <label htmlFor="websocket-tracking-enabled" className="text-sm font-semibold text-white cursor-pointer flex items-center gap-2">
                Enable WebSocket Tracking
              </label>
              <input
                type="checkbox"
                id="websocket-tracking-enabled"
                checked={settings.WEBSOCKET_TRACKING_ENABLED === 'true'}
                onChange={(e) => handleChange('WEBSOCKET_TRACKING_ENABLED', e.target.checked ? 'true' : 'false')}
                className="w-5 h-5 text-cyan-500 bg-gray-800 border-gray-700 rounded focus:ring-2 focus:ring-cyan-500 cursor-pointer"
              />
            </div>

            {settings.WEBSOCKET_TRACKING_ENABLED === 'true' && (
              <div className="space-y-3 pl-3 border-l-2 border-cyan-500">
                {/* External Buy Threshold */}
                <div>
                  <label className="block text-xs font-medium text-white mb-1 flex items-center gap-1">
                    External Buy Threshold (SOL)
                    <InfoTooltip content="Cumulative SOL volume from external buys that triggers auto-sell" />
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={settings.WEBSOCKET_EXTERNAL_BUY_THRESHOLD || '1.0'}
                    onChange={(e) => handleChange('WEBSOCKET_EXTERNAL_BUY_THRESHOLD', e.target.value)}
                    className="w-full px-3 py-2 bg-black/50 border border-gray-800 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    placeholder="1.0"
                  />
                </div>

                {/* Aggregation Window */}
                <div>
                  <label className="block text-xs font-medium text-white mb-1 flex items-center gap-1">
                    Aggregation Window (seconds)
                    <InfoTooltip content="Time window to aggregate external buys (10-300 seconds)" />
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="10"
                    max="300"
                    value={settings.WEBSOCKET_EXTERNAL_BUY_WINDOW || '60'}
                    onChange={(e) => handleChange('WEBSOCKET_EXTERNAL_BUY_WINDOW', e.target.value)}
                    className="w-full px-3 py-2 bg-black/50 border border-gray-800 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    placeholder="60"
                  />
                </div>

                {/* Ultra-Fast Mode */}
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="websocket-ultra-fast"
                    checked={settings.WEBSOCKET_ULTRA_FAST_MODE === 'true'}
                    onChange={(e) => handleChange('WEBSOCKET_ULTRA_FAST_MODE', e.target.checked ? 'true' : 'false')}
                    className="w-4 h-4 text-cyan-500 bg-gray-800 border-gray-700 rounded focus:ring-2 focus:ring-cyan-500"
                  />
                  <label htmlFor="websocket-ultra-fast" className="text-xs text-gray-300 cursor-pointer">
                    Ultra-Fast Mode (Sub-500ms)
                  </label>
                  <InfoTooltip content="Ultra-fast WebSocket mode for sub-500ms reaction time. Uses processed commitment and pre-built transactions." />
                </div>

                {/* Info Box */}
                <div className="p-3 bg-cyan-900/30 border border-cyan-500/50 rounded text-xs text-cyan-300">
                  <p className="font-semibold mb-1 flex items-center gap-1">
                    <LightBulbIcon className="w-3 h-3" />
                    How It Works:
                  </p>
                  <ul className="ml-3 list-disc space-y-0.5 text-xs">
                    <li>Monitors all pump.fun transactions for your token</li>
                    <li>Excludes your wallets (DEV, bundle, holder) from tracking</li>
                    <li>Aggregates external buy volume within the time window</li>
                    <li>Triggers rapid sell when threshold is met (HIGH priority fee)</li>
                    <li>Requires RPC_WEBSOCKET_ENDPOINT in .env (Helius WebSocket)</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Image/Logo Uploads */}
      <div className="mb-6 p-5 bg-gray-900/50 rounded-lg border border-gray-800">
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          Images & Logos
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Token Image</label>
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
            <label className="block text-sm font-medium text-gray-300 mb-2">Website Logo</label>
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

      {/* Launch Token Button - PROMINENT */}
      <div className="mb-6">
        <button
          onClick={handleLaunch}
          disabled={loading}
          className="w-full py-4 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-bold text-lg rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed glow-blue flex items-center justify-center gap-3"
        >
          {loading ? (
            <>
              <ArrowPathIcon className="w-6 h-6 animate-spin" />
              Launching...
            </>
          ) : (
            <>
              <RocketLaunchIconSolid className="w-6 h-6" />
              Launch Token
            </>
          )}
        </button>
      </div>
        
        {/* Launch Progress Bar */}
        {loading && launchStage && (
          <div className="mt-6 p-4 bg-gray-900/50 rounded-lg border border-gray-800">
            <div className="flex justify-between items-center mb-2">
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
      <div className="mb-6">
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
      <div className="mb-6 p-5 bg-gradient-to-r from-purple-900/30 to-pink-900/30 rounded-lg border-2 border-purple-500/50">
        <div className="flex items-center gap-3 mb-4">
          <MegaphoneIcon className="w-6 h-6 text-purple-400" />
          <h3 className="text-lg font-bold text-white">Marketing Options</h3>
          <span className="text-xs text-gray-400 bg-gray-800/50 px-2 py-1 rounded">Optional</span>
        </div>
        <div className="space-y-4">
              {/* Enable Marketing Toggle */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="ENABLE_MARKETING"
                  checked={settings.ENABLE_MARKETING === 'true'}
                  onChange={(e) => handleChange('ENABLE_MARKETING', e.target.checked ? 'true' : 'false')}
                  className="w-4 h-4 rounded"
                />
                <label htmlFor="ENABLE_MARKETING" className="text-sm font-medium text-gray-300 cursor-pointer">
                  Enable Marketing (runs after successful launch)
                </label>
              </div>

              {settings.ENABLE_MARKETING === 'true' && (
                <div className="space-y-4 pl-4 border-l-2 border-blue-500">
                  {/* Website Update */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="ENABLE_WEBSITE_UPDATE"
                        checked={settings.ENABLE_WEBSITE_UPDATE === 'true'}
                        onChange={(e) => handleChange('ENABLE_WEBSITE_UPDATE', e.target.checked ? 'true' : 'false')}
                        className="w-4 h-4 rounded"
                      />
                      <label htmlFor="ENABLE_WEBSITE_UPDATE" className="text-sm font-medium text-gray-300 cursor-pointer">
                        🌐 Update Website Configuration
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
                            ⛓️ Chain
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
                            📍 Custom Contract Address (Optional)
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
                            🎨 Website Theme
                          </label>
                          <select
                            value={settings.WEBSITE_THEME || 'DEFAULT'}
                            onChange={(e) => handleChange('WEBSITE_THEME', e.target.value)}
                            className="w-full px-3 py-2 bg-gray-900/50 border border-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="DEFAULT">Default (Blue)</option>
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
                              <span className="animate-spin">⏳</span> Testing...
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
                            {marketingTestResults.website.success ? '✅ Test passed' : `❌ Test failed: ${marketingTestResults.website.error || 'Unknown error'}`}
                          </div>
                        )}
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
                        📱 Create Telegram Group/Channel
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
                              <span className="animate-spin">⏳</span> Testing...
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
                            {marketingTestResults.telegram.success ? `✅ Test passed: ${marketingTestResults.telegram.message || 'Group/channel created'}` : `❌ Test failed: ${marketingTestResults.telegram.error || 'Unknown error'}`}
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
                        🐦 Post to Twitter/X
                      </label>
                    </div>
                    {settings.ENABLE_TWITTER_POSTING === 'true' && (
                      <div className="pl-6 space-y-2">
                        <input
                          type="password"
                          value={settings.TWITTER_API_KEY || ''}
                          onChange={(e) => handleChange('TWITTER_API_KEY', e.target.value)}
                          className="w-full px-3 py-2 bg-gray-900/50 border border-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Twitter API Key"
                        />
                        <input
                          type="password"
                          value={settings.TWITTER_API_SECRET || ''}
                          onChange={(e) => handleChange('TWITTER_API_SECRET', e.target.value)}
                          className="w-full px-3 py-2 bg-gray-900/50 border border-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Twitter API Secret"
                        />
                        <input
                          type="password"
                          value={settings.TWITTER_ACCESS_TOKEN || ''}
                          onChange={(e) => handleChange('TWITTER_ACCESS_TOKEN', e.target.value)}
                          className="w-full px-3 py-2 bg-gray-900/50 border border-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Twitter Access Token"
                        />
                        <input
                          type="password"
                          value={settings.TWITTER_ACCESS_TOKEN_SECRET || ''}
                          onChange={(e) => handleChange('TWITTER_ACCESS_TOKEN_SECRET', e.target.value)}
                          className="w-full px-3 py-2 bg-gray-900/50 border border-gray-800 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Twitter Access Token Secret"
                        />
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
                                    ✕
                                  </button>
                                )}
                              </div>
                              
                              {/* Image Upload */}
                              <div className="flex items-center gap-2">
                                <label className="px-3 py-1.5 bg-gray-900/50 hover:bg-gray-800 text-white text-xs font-medium rounded-lg cursor-pointer transition-colors">
                                  📷 {tweet.imagePreview ? 'Change Image' : 'Add Image'}
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
                              <span className="animate-spin">⏳</span> Testing...
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
                            {marketingTestResults.twitter.success ? `✅ Test passed: ${marketingTestResults.twitter.message || 'Tweets posted'}` : `❌ Test failed: ${marketingTestResults.twitter.error || 'Unknown error'}`}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
        </div>
      </div>

      {/* Wallet Info & Fee Breakdown */}
      {walletInfo && (
        <div className="mt-6 space-y-4">
            {/* Funding Wallet */}
            <div className="p-4 bg-gray-900/50 rounded-lg border-l-4 border-blue-500">
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
                  <p className="text-xs text-gray-500">Will Fund</p>
                  <p className="text-sm font-bold text-purple-400">{walletInfo.buyerAmount.toFixed(4)} SOL</p>
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
            {walletInfo.holderWallets.count > 0 && (
              <div className="p-4 bg-gray-900/50 rounded-lg border-l-4 border-yellow-500">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="text-sm font-semibold text-yellow-400 mb-1 flex items-center gap-2">
                      <UserGroupIcon className="w-4 h-4" />
                      {walletInfo.holderWallets.label}
                    </p>
                    <p className="text-xs text-gray-500">{walletInfo.holderWallets.count} wallet(s)</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Total</p>
                    <p className="text-sm font-bold text-yellow-400">{walletInfo.holderWallets.totalSol.toFixed(4)} SOL</p>
                  </div>
                </div>
                <div className="mt-2 space-y-1">
                  {walletInfo.holderWallets.amounts.map((amount, idx) => (
                    <div key={idx} className="flex justify-between text-xs">
                      <span className="text-gray-500">Holder Wallet {idx + 1}:</span>
                      <span className="text-gray-300">{amount.toFixed(4)} SOL</span>
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
              <div className="space-y-1 text-xs border-t border-gray-700 pt-2">
                <div className="flex justify-between">
                  <span className="text-gray-500">Bundle Wallets:</span>
                  <span className="text-gray-300">{walletInfo.breakdown.bundleWallets.toFixed(4)} SOL</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Holder Wallets:</span>
                  <span className="text-gray-300">{walletInfo.breakdown.holderWallets.toFixed(4)} SOL</span>
                </div>
                {(walletInfo.breakdown.creatorDevWallet > 0 || walletInfo.breakdown.devBuyAmount > 0) && (
                  <>
                    {walletInfo.breakdown.creatorDevWallet > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Creator/DEV Wallet Funding:</span>
                        <span className="text-gray-300">{walletInfo.breakdown.creatorDevWallet.toFixed(4)} SOL</span>
                      </div>
                    )}
                    {walletInfo.breakdown.devBuyAmount > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">DEV Buy Amount:</span>
                        <span className="text-gray-300">{walletInfo.breakdown.devBuyAmount.toFixed(4)} SOL</span>
                      </div>
                    )}
                  </>
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
      )}

    </div>
  );
}


