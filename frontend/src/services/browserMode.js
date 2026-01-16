/**
 * Browser Mode Service
 * 
 * Bridges existing API-based components to use browser localStorage
 * when running in production (browser-keys mode).
 * 
 * Detects mode automatically:
 * - LOCAL mode: Uses API with server-side key storage (existing behavior)
 * - BROWSER mode: Uses localStorage for keys, API for unsigned txs only
 */

import walletStorage, { WALLET_TYPES } from './walletStorage';
import walletGenerator from './walletGenerator';
import backupService from './backupService';

// Detect which mode we're in
const BROWSER_MODE = import.meta.env.VITE_BROWSER_KEYS === 'true' || 
                     localStorage.getItem('goat_browser_mode') === 'true';

console.log(`[BrowserMode] Running in ${BROWSER_MODE ? 'BROWSER' : 'LOCAL'} mode`);

/**
 * Enable/disable browser mode
 */
export function setBrowserMode(enabled) {
  localStorage.setItem('goat_browser_mode', enabled ? 'true' : 'false');
  console.log(`[BrowserMode] Mode set to ${enabled ? 'BROWSER' : 'LOCAL'}`);
  // Reload to apply
  window.location.reload();
}

export function isBrowserMode() {
  return BROWSER_MODE;
}

// ============================================
// SETTINGS - Store in localStorage
// ============================================

const SETTINGS_DEFAULTS = {
  // Bundle settings
  NUM_BUNDLE_WALLETS: 24,
  BUY_AMOUNT_SOL: '0.015',
  BUY_AMOUNT_PERCENT: 80,
  JITO_TIP: '0.0001',
  
  // Token metadata
  TOKEN_NAME: '',
  TOKEN_SYMBOL: '',
  TOKEN_DESCRIPTION: '',
  IMAGE_PATH: '',
  TWITTER: '',
  TELEGRAM: '',
  WEBSITE: '',
  
  // RPC
  HELIUS_RPC_URL: '',
  RPC_URL: '',
  
  // Auto-sell
  AUTO_SELL_ENABLED: false,
  MCAP_THRESHOLD: 50000,
  SELL_PERCENTAGE: 100,
  
  // Warming
  WARMING_TRADES_PER_WALLET: 2,
  WARMING_MIN_BUY: 0.002,
  WARMING_MAX_BUY: 0.003,
};

/**
 * Get all settings (from localStorage in browser mode)
 */
export function getSettings() {
  if (!BROWSER_MODE) {
    return null; // Let API handle it
  }
  
  const saved = localStorage.getItem('goat_settings');
  const settings = saved ? JSON.parse(saved) : {};
  return { ...SETTINGS_DEFAULTS, ...settings };
}

/**
 * Update settings
 */
export function updateSettings(newSettings) {
  if (!BROWSER_MODE) {
    return null; // Let API handle it
  }
  
  const current = getSettings();
  const merged = { ...current, ...newSettings };
  localStorage.setItem('goat_settings', JSON.stringify(merged));
  return merged;
}

/**
 * Get single setting
 */
export function getSetting(key, defaultValue = null) {
  const settings = getSettings();
  if (settings && settings[key] !== undefined) {
    return settings[key];
  }
  return defaultValue;
}

// ============================================
// TOKEN CONFIGS - Store in localStorage
// ============================================

const TOKEN_CONFIGS_KEY = 'goat_token_configs';

/**
 * Get all token configurations
 */
export function getTokenConfigs() {
  if (!BROWSER_MODE) return null;
  
  const data = localStorage.getItem(TOKEN_CONFIGS_KEY);
  return data ? JSON.parse(data) : [];
}

/**
 * Save token configuration
 */
export function saveTokenConfig(name, config) {
  if (!BROWSER_MODE) return null;
  
  const configs = getTokenConfigs() || [];
  const id = `config-${Date.now()}`;
  
  configs.push({
    id,
    name,
    config,
    createdAt: new Date().toISOString(),
  });
  
  localStorage.setItem(TOKEN_CONFIGS_KEY, JSON.stringify(configs));
  return { id, name, config };
}

/**
 * Update token configuration
 */
export function updateTokenConfig(id, name, config) {
  if (!BROWSER_MODE) return null;
  
  const configs = getTokenConfigs() || [];
  const index = configs.findIndex(c => c.id === id);
  
  if (index !== -1) {
    configs[index] = {
      ...configs[index],
      name,
      config,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(TOKEN_CONFIGS_KEY, JSON.stringify(configs));
    return configs[index];
  }
  return null;
}

/**
 * Delete token configuration
 */
export function deleteTokenConfig(id) {
  if (!BROWSER_MODE) return null;
  
  const configs = getTokenConfigs() || [];
  const filtered = configs.filter(c => c.id !== id);
  localStorage.setItem(TOKEN_CONFIGS_KEY, JSON.stringify(filtered));
  return true;
}

// ============================================
// WARMING WALLETS - Use browser storage
// ============================================

const WARMING_WALLETS_KEY = 'goat_warming_wallets';

/**
 * Get warming wallets
 */
export function getWarmingWallets() {
  if (!BROWSER_MODE) return null;
  
  const data = localStorage.getItem(WARMING_WALLETS_KEY);
  return data ? JSON.parse(data) : [];
}

/**
 * Add warming wallet
 */
export function addWarmingWallet(wallet) {
  if (!BROWSER_MODE) return null;
  
  const wallets = getWarmingWallets() || [];
  
  // Check for duplicates
  if (wallets.some(w => w.address === wallet.address)) {
    return { success: false, error: 'Wallet already exists' };
  }
  
  wallets.push({
    ...wallet,
    createdAt: new Date().toISOString(),
    status: 'idle',
    transactionCount: 0,
    totalTrades: 0,
    tags: wallet.tags || [],
  });
  
  localStorage.setItem(WARMING_WALLETS_KEY, JSON.stringify(wallets));
  
  // Also add to main wallet storage
  walletStorage.addWallet({
    address: wallet.address,
    privateKey: wallet.privateKey,
    type: WALLET_TYPES.WARMED_BUNDLE,
  });
  
  return { success: true, wallet: wallets[wallets.length - 1] };
}

/**
 * Create new warming wallet
 */
export function createWarmingWallet(tags = []) {
  if (!BROWSER_MODE) return null;
  
  const { publicKey, secretKey } = walletGenerator.generateKeypair();
  
  return addWarmingWallet({
    address: publicKey,
    privateKey: secretKey,
    tags,
  });
}

/**
 * Delete warming wallet
 */
export function deleteWarmingWallet(address) {
  if (!BROWSER_MODE) return null;
  
  const wallets = getWarmingWallets() || [];
  const filtered = wallets.filter(w => w.address !== address);
  localStorage.setItem(WARMING_WALLETS_KEY, JSON.stringify(filtered));
  
  // Also remove from main storage
  walletStorage.removeWallet(address);
  
  return { success: true };
}

/**
 * Update warming wallet stats
 */
export function updateWarmingWalletStats(address, updates) {
  if (!BROWSER_MODE) return null;
  
  const wallets = getWarmingWallets() || [];
  const index = wallets.findIndex(w => w.address === address);
  
  if (index !== -1) {
    wallets[index] = { ...wallets[index], ...updates };
    localStorage.setItem(WARMING_WALLETS_KEY, JSON.stringify(wallets));
    return { success: true };
  }
  return { success: false };
}

// ============================================
// TRADE HISTORY - Store in localStorage
// ============================================

const TRADE_HISTORY_KEY = 'goat_trade_history';

/**
 * Get trade history
 */
export function getTradeHistory() {
  if (!BROWSER_MODE) return null;
  
  const data = localStorage.getItem(TRADE_HISTORY_KEY);
  return data ? JSON.parse(data) : [];
}

/**
 * Add trade to history
 */
export function addTradeToHistory(trade) {
  if (!BROWSER_MODE) return null;
  
  const history = getTradeHistory() || [];
  history.unshift({
    ...trade,
    id: `trade-${Date.now()}`,
    timestamp: new Date().toISOString(),
  });
  
  // Keep last 500 trades
  const trimmed = history.slice(0, 500);
  localStorage.setItem(TRADE_HISTORY_KEY, JSON.stringify(trimmed));
  
  return trade;
}

/**
 * Get trades for specific mint
 */
export function getTradesForMint(mintAddress) {
  const history = getTradeHistory() || [];
  return history.filter(t => t.mintAddress === mintAddress);
}

// ============================================
// LAUNCH HISTORY - Store in localStorage
// ============================================

const LAUNCH_HISTORY_KEY = 'goat_launch_history';

/**
 * Get launch history
 */
export function getLaunchHistory() {
  if (!BROWSER_MODE) return null;
  
  const data = localStorage.getItem(LAUNCH_HISTORY_KEY);
  return data ? JSON.parse(data) : [];
}

/**
 * Add launch to history
 */
export function addLaunchToHistory(launch) {
  if (!BROWSER_MODE) return null;
  
  const history = getLaunchHistory() || [];
  history.unshift({
    ...launch,
    id: launch.id || `launch-${Date.now()}`,
    completedAt: new Date().toISOString(),
  });
  
  // Keep last 100 launches
  const trimmed = history.slice(0, 100);
  localStorage.setItem(LAUNCH_HISTORY_KEY, JSON.stringify(trimmed));
  
  // Trigger backup after successful launch
  backupService.scheduleAutoBackup();
  
  return launch;
}

// ============================================
// PUMP ADDRESSES - Store in localStorage
// ============================================

/**
 * Get pump addresses (vanity addresses)
 */
export function getPumpAddresses() {
  if (!BROWSER_MODE) return null;
  return walletStorage.getPumpAddresses();
}

/**
 * Add pump addresses
 */
export function addPumpAddresses(addresses) {
  if (!BROWSER_MODE) return null;
  return walletStorage.addPumpAddresses(addresses);
}

/**
 * Get next available pump address
 */
export function getNextPumpAddress() {
  if (!BROWSER_MODE) return null;
  return walletStorage.getNextPumpAddress();
}

// ============================================
// EXPORT DATA - For full backup
// ============================================

/**
 * Export all browser data
 */
export function exportAllBrowserData() {
  return {
    settings: getSettings(),
    tokenConfigs: getTokenConfigs(),
    warmingWallets: getWarmingWallets(),
    tradeHistory: getTradeHistory(),
    launchHistory: getLaunchHistory(),
    walletData: walletStorage.exportAllData(),
    exportedAt: new Date().toISOString(),
    version: '1.0.0',
  };
}

/**
 * Import browser data
 */
export function importBrowserData(data) {
  if (data.settings) {
    localStorage.setItem('goat_settings', JSON.stringify(data.settings));
  }
  if (data.tokenConfigs) {
    localStorage.setItem(TOKEN_CONFIGS_KEY, JSON.stringify(data.tokenConfigs));
  }
  if (data.warmingWallets) {
    localStorage.setItem(WARMING_WALLETS_KEY, JSON.stringify(data.warmingWallets));
  }
  if (data.tradeHistory) {
    localStorage.setItem(TRADE_HISTORY_KEY, JSON.stringify(data.tradeHistory));
  }
  if (data.launchHistory) {
    localStorage.setItem(LAUNCH_HISTORY_KEY, JSON.stringify(data.launchHistory));
  }
  if (data.walletData) {
    walletStorage.importData(data.walletData);
  }
  
  return { success: true };
}

export default {
  // Mode
  isBrowserMode,
  setBrowserMode,
  
  // Settings
  getSettings,
  updateSettings,
  getSetting,
  
  // Token configs
  getTokenConfigs,
  saveTokenConfig,
  updateTokenConfig,
  deleteTokenConfig,
  
  // Warming wallets
  getWarmingWallets,
  addWarmingWallet,
  createWarmingWallet,
  deleteWarmingWallet,
  updateWarmingWalletStats,
  
  // Trade history
  getTradeHistory,
  addTradeToHistory,
  getTradesForMint,
  
  // Launch history
  getLaunchHistory,
  addLaunchToHistory,
  
  // Pump addresses
  getPumpAddresses,
  addPumpAddresses,
  getNextPumpAddress,
  
  // Data export/import
  exportAllBrowserData,
  importBrowserData,
};
