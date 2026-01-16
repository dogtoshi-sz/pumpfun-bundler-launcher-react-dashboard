/**
 * Browser-based Wallet Storage Service
 * 
 * Stores all wallet private keys in browser localStorage.
 * Keys NEVER leave the browser - server only receives addresses.
 * 
 * Storage Keys:
 * - goat_wallets: All wallet keys (bundle, holder, dev, intermediary, etc.)
 * - goat_current_run: Current run state
 * - goat_run_history: History of all runs
 * - goat_settings: User settings
 */

const STORAGE_KEYS = {
  WALLETS: 'goat_wallets',
  CURRENT_RUN: 'goat_current_run',
  RUN_HISTORY: 'goat_run_history',
  SETTINGS: 'goat_settings',
  INTERMEDIARY_WALLETS: 'goat_intermediary_wallets',
  WARMED_WALLETS: 'goat_warmed_wallets',
  PUMP_ADDRESSES: 'goat_pump_addresses',
};

// Wallet types
export const WALLET_TYPES = {
  BUNDLE: 'bundle',
  HOLDER: 'holder',
  DEV: 'dev',
  CREATOR: 'creator',
  INTERMEDIARY_HOP1: 'intermediary_hop1',
  INTERMEDIARY_HOP2: 'intermediary_hop2',
  INTERMEDIARY_HOP3: 'intermediary_hop3',
  WARMED_BUNDLE: 'warmed_bundle',
  WARMED_HOLDER: 'warmed_holder',
  WARMED_CREATOR: 'warmed_creator',
  MIXING: 'mixing',
  FUNDING: 'funding',
};

/**
 * Initialize storage with default values if empty
 */
export function initializeStorage() {
  if (!localStorage.getItem(STORAGE_KEYS.WALLETS)) {
    localStorage.setItem(STORAGE_KEYS.WALLETS, JSON.stringify([]));
  }
  if (!localStorage.getItem(STORAGE_KEYS.RUN_HISTORY)) {
    localStorage.setItem(STORAGE_KEYS.RUN_HISTORY, JSON.stringify([]));
  }
  if (!localStorage.getItem(STORAGE_KEYS.INTERMEDIARY_WALLETS)) {
    localStorage.setItem(STORAGE_KEYS.INTERMEDIARY_WALLETS, JSON.stringify({ hop1: [], hop2: [], hop3: [] }));
  }
  if (!localStorage.getItem(STORAGE_KEYS.WARMED_WALLETS)) {
    localStorage.setItem(STORAGE_KEYS.WARMED_WALLETS, JSON.stringify([]));
  }
  if (!localStorage.getItem(STORAGE_KEYS.PUMP_ADDRESSES)) {
    localStorage.setItem(STORAGE_KEYS.PUMP_ADDRESSES, JSON.stringify([]));
  }
}

// ============================================
// WALLET OPERATIONS
// ============================================

/**
 * Get all wallets
 */
export function getAllWallets() {
  const data = localStorage.getItem(STORAGE_KEYS.WALLETS);
  return data ? JSON.parse(data) : [];
}

/**
 * Get wallets by type
 */
export function getWalletsByType(type) {
  const wallets = getAllWallets();
  return wallets.filter(w => w.type === type);
}

/**
 * Get wallets by run ID
 */
export function getWalletsByRunId(runId) {
  const wallets = getAllWallets();
  return wallets.filter(w => w.runId === runId);
}

/**
 * Get wallet by address
 */
export function getWalletByAddress(address) {
  const wallets = getAllWallets();
  return wallets.find(w => w.address.toLowerCase() === address.toLowerCase());
}

/**
 * Get private key by address (for signing)
 */
export function getPrivateKeyByAddress(address) {
  const wallet = getWalletByAddress(address);
  return wallet ? wallet.privateKey : null;
}

/**
 * Add a new wallet
 */
export function addWallet(wallet) {
  const wallets = getAllWallets();
  
  // Check for duplicates
  const exists = wallets.some(w => w.address.toLowerCase() === wallet.address.toLowerCase());
  if (exists) {
    console.warn(`[WalletStorage] Wallet ${wallet.address} already exists`);
    return false;
  }
  
  wallets.push({
    ...wallet,
    createdAt: wallet.createdAt || new Date().toISOString(),
  });
  
  localStorage.setItem(STORAGE_KEYS.WALLETS, JSON.stringify(wallets));
  console.log(`[WalletStorage] Added wallet: ${wallet.address.slice(0, 8)}... (${wallet.type})`);
  return true;
}

/**
 * Add multiple wallets at once
 */
export function addWallets(walletsToAdd) {
  const wallets = getAllWallets();
  let added = 0;
  
  for (const wallet of walletsToAdd) {
    const exists = wallets.some(w => w.address.toLowerCase() === wallet.address.toLowerCase());
    if (!exists) {
      wallets.push({
        ...wallet,
        createdAt: wallet.createdAt || new Date().toISOString(),
      });
      added++;
    }
  }
  
  localStorage.setItem(STORAGE_KEYS.WALLETS, JSON.stringify(wallets));
  console.log(`[WalletStorage] Added ${added} wallets`);
  return added;
}

/**
 * Remove wallet by address
 */
export function removeWallet(address) {
  const wallets = getAllWallets();
  const filtered = wallets.filter(w => w.address.toLowerCase() !== address.toLowerCase());
  localStorage.setItem(STORAGE_KEYS.WALLETS, JSON.stringify(filtered));
  return wallets.length !== filtered.length;
}

/**
 * Clear all wallets (dangerous!)
 */
export function clearAllWallets() {
  localStorage.setItem(STORAGE_KEYS.WALLETS, JSON.stringify([]));
  console.warn('[WalletStorage] All wallets cleared!');
}

// ============================================
// INTERMEDIARY WALLET OPERATIONS
// ============================================

/**
 * Get intermediary wallets
 */
export function getIntermediaryWallets() {
  const data = localStorage.getItem(STORAGE_KEYS.INTERMEDIARY_WALLETS);
  return data ? JSON.parse(data) : { hop1: [], hop2: [], hop3: [] };
}

/**
 * Add intermediary wallets for a hop
 */
export function addIntermediaryWallets(hop, wallets) {
  const intermediary = getIntermediaryWallets();
  
  if (!intermediary[hop]) {
    intermediary[hop] = [];
  }
  
  for (const wallet of wallets) {
    const exists = intermediary[hop].some(w => w.publicKey === wallet.publicKey);
    if (!exists) {
      intermediary[hop].push({
        ...wallet,
        createdAt: new Date().toISOString(),
      });
    }
  }
  
  localStorage.setItem(STORAGE_KEYS.INTERMEDIARY_WALLETS, JSON.stringify(intermediary));
  console.log(`[WalletStorage] Added ${wallets.length} intermediary wallets to ${hop}`);
}

/**
 * Get all intermediary wallets as flat array
 */
export function getAllIntermediaryWalletsFlat() {
  const intermediary = getIntermediaryWallets();
  return [
    ...intermediary.hop1.map(w => ({ ...w, hop: 'hop1' })),
    ...intermediary.hop2.map(w => ({ ...w, hop: 'hop2' })),
    ...(intermediary.hop3 || []).map(w => ({ ...w, hop: 'hop3' })),
  ];
}

/**
 * Clear intermediary wallets
 */
export function clearIntermediaryWallets() {
  localStorage.setItem(STORAGE_KEYS.INTERMEDIARY_WALLETS, JSON.stringify({ hop1: [], hop2: [], hop3: [] }));
}

// ============================================
// WARMED WALLET OPERATIONS
// ============================================

/**
 * Get warmed wallets
 */
export function getWarmedWallets() {
  const data = localStorage.getItem(STORAGE_KEYS.WARMED_WALLETS);
  return data ? JSON.parse(data) : [];
}

/**
 * Add warmed wallet
 */
export function addWarmedWallet(wallet) {
  const warmed = getWarmedWallets();
  const exists = warmed.some(w => w.address.toLowerCase() === wallet.address.toLowerCase());
  
  if (!exists) {
    warmed.push({
      ...wallet,
      createdAt: wallet.createdAt || new Date().toISOString(),
    });
    localStorage.setItem(STORAGE_KEYS.WARMED_WALLETS, JSON.stringify(warmed));
    return true;
  }
  return false;
}

/**
 * Remove warmed wallet
 */
export function removeWarmedWallet(address) {
  const warmed = getWarmedWallets();
  const filtered = warmed.filter(w => w.address.toLowerCase() !== address.toLowerCase());
  localStorage.setItem(STORAGE_KEYS.WARMED_WALLETS, JSON.stringify(filtered));
  return warmed.length !== filtered.length;
}

// ============================================
// CURRENT RUN OPERATIONS
// ============================================

/**
 * Get current run
 */
export function getCurrentRun() {
  const data = localStorage.getItem(STORAGE_KEYS.CURRENT_RUN);
  return data ? JSON.parse(data) : null;
}

/**
 * Set current run
 */
export function setCurrentRun(runData) {
  const run = {
    ...runData,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEYS.CURRENT_RUN, JSON.stringify(run));
  console.log(`[WalletStorage] Current run updated: ${run.runId || 'new'}`);
}

/**
 * Create a new run
 */
export function createNewRun(mintAddress, settings = {}) {
  const runId = `run-${Date.now()}`;
  const run = {
    runId,
    mintAddress,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings,
    bundleWallets: [],
    holderWallets: [],
    devWallet: null,
    intermediaryWallets: { hop1: [], hop2: [] },
  };
  
  setCurrentRun(run);
  return run;
}

/**
 * Update current run status
 */
export function updateRunStatus(status, additionalData = {}) {
  const run = getCurrentRun();
  if (run) {
    setCurrentRun({
      ...run,
      status,
      ...additionalData,
    });
  }
}

/**
 * Complete current run and move to history
 */
export function completeCurrentRun(result = {}) {
  const run = getCurrentRun();
  if (!run) return null;
  
  const completedRun = {
    ...run,
    status: 'completed',
    completedAt: new Date().toISOString(),
    result,
  };
  
  // Add to history
  addToRunHistory(completedRun);
  
  // Clear current run
  localStorage.removeItem(STORAGE_KEYS.CURRENT_RUN);
  
  return completedRun;
}

// ============================================
// RUN HISTORY OPERATIONS
// ============================================

/**
 * Get run history
 */
export function getRunHistory() {
  const data = localStorage.getItem(STORAGE_KEYS.RUN_HISTORY);
  return data ? JSON.parse(data) : [];
}

/**
 * Add to run history
 */
export function addToRunHistory(run) {
  const history = getRunHistory();
  history.unshift(run); // Add to beginning (newest first)
  
  // Keep last 100 runs
  const trimmed = history.slice(0, 100);
  localStorage.setItem(STORAGE_KEYS.RUN_HISTORY, JSON.stringify(trimmed));
}

/**
 * Get run from history by ID
 */
export function getRunFromHistory(runId) {
  const history = getRunHistory();
  return history.find(r => r.runId === runId);
}

// ============================================
// PUMP ADDRESSES (Pre-generated vanity addresses)
// ============================================

/**
 * Get pump addresses
 */
export function getPumpAddresses() {
  const data = localStorage.getItem(STORAGE_KEYS.PUMP_ADDRESSES);
  return data ? JSON.parse(data) : [];
}

/**
 * Add pump addresses
 */
export function addPumpAddresses(addresses) {
  const existing = getPumpAddresses();
  const newAddresses = addresses.filter(a => !existing.some(e => e.publicKey === a.publicKey));
  const combined = [...existing, ...newAddresses];
  localStorage.setItem(STORAGE_KEYS.PUMP_ADDRESSES, JSON.stringify(combined));
  return newAddresses.length;
}

/**
 * Get next available pump address
 */
export function getNextPumpAddress() {
  const addresses = getPumpAddresses();
  return addresses.find(a => !a.used);
}

/**
 * Mark pump address as used
 */
export function markPumpAddressUsed(publicKey) {
  const addresses = getPumpAddresses();
  const updated = addresses.map(a => 
    a.publicKey === publicKey ? { ...a, used: true, usedAt: new Date().toISOString() } : a
  );
  localStorage.setItem(STORAGE_KEYS.PUMP_ADDRESSES, JSON.stringify(updated));
}

// ============================================
// SETTINGS OPERATIONS
// ============================================

/**
 * Get settings
 */
export function getSettings() {
  const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
  return data ? JSON.parse(data) : {};
}

/**
 * Save settings
 */
export function saveSettings(settings) {
  const existing = getSettings();
  const merged = { ...existing, ...settings };
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(merged));
}

/**
 * Get specific setting
 */
export function getSetting(key, defaultValue = null) {
  const settings = getSettings();
  return settings[key] !== undefined ? settings[key] : defaultValue;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Get storage stats
 */
export function getStorageStats() {
  const wallets = getAllWallets();
  const intermediary = getAllIntermediaryWalletsFlat();
  const warmed = getWarmedWallets();
  const history = getRunHistory();
  const pumpAddresses = getPumpAddresses();
  
  return {
    totalWallets: wallets.length,
    walletsByType: {
      bundle: wallets.filter(w => w.type === WALLET_TYPES.BUNDLE).length,
      holder: wallets.filter(w => w.type === WALLET_TYPES.HOLDER).length,
      dev: wallets.filter(w => w.type === WALLET_TYPES.DEV).length,
    },
    intermediaryWallets: intermediary.length,
    warmedWallets: warmed.length,
    runHistory: history.length,
    pumpAddresses: {
      total: pumpAddresses.length,
      available: pumpAddresses.filter(a => !a.used).length,
      used: pumpAddresses.filter(a => a.used).length,
    },
    storageUsed: new Blob([JSON.stringify(localStorage)]).size,
  };
}

/**
 * Export all data (for debugging)
 */
export function exportAllData() {
  return {
    wallets: getAllWallets(),
    intermediaryWallets: getIntermediaryWallets(),
    warmedWallets: getWarmedWallets(),
    currentRun: getCurrentRun(),
    runHistory: getRunHistory(),
    pumpAddresses: getPumpAddresses(),
    settings: getSettings(),
    exportedAt: new Date().toISOString(),
  };
}

/**
 * Import data (for restore)
 */
export function importData(data) {
  if (data.wallets) {
    localStorage.setItem(STORAGE_KEYS.WALLETS, JSON.stringify(data.wallets));
  }
  if (data.intermediaryWallets) {
    localStorage.setItem(STORAGE_KEYS.INTERMEDIARY_WALLETS, JSON.stringify(data.intermediaryWallets));
  }
  if (data.warmedWallets) {
    localStorage.setItem(STORAGE_KEYS.WARMED_WALLETS, JSON.stringify(data.warmedWallets));
  }
  if (data.currentRun) {
    localStorage.setItem(STORAGE_KEYS.CURRENT_RUN, JSON.stringify(data.currentRun));
  }
  if (data.runHistory) {
    localStorage.setItem(STORAGE_KEYS.RUN_HISTORY, JSON.stringify(data.runHistory));
  }
  if (data.pumpAddresses) {
    localStorage.setItem(STORAGE_KEYS.PUMP_ADDRESSES, JSON.stringify(data.pumpAddresses));
  }
  if (data.settings) {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(data.settings));
  }
  
  console.log('[WalletStorage] Data imported successfully');
}

// Initialize on load
initializeStorage();

export default {
  // Wallet operations
  getAllWallets,
  getWalletsByType,
  getWalletsByRunId,
  getWalletByAddress,
  getPrivateKeyByAddress,
  addWallet,
  addWallets,
  removeWallet,
  clearAllWallets,
  
  // Intermediary operations
  getIntermediaryWallets,
  addIntermediaryWallets,
  getAllIntermediaryWalletsFlat,
  clearIntermediaryWallets,
  
  // Warmed wallet operations
  getWarmedWallets,
  addWarmedWallet,
  removeWarmedWallet,
  
  // Run operations
  getCurrentRun,
  setCurrentRun,
  createNewRun,
  updateRunStatus,
  completeCurrentRun,
  getRunHistory,
  addToRunHistory,
  getRunFromHistory,
  
  // Pump addresses
  getPumpAddresses,
  addPumpAddresses,
  getNextPumpAddress,
  markPumpAddressUsed,
  
  // Settings
  getSettings,
  saveSettings,
  getSetting,
  
  // Utilities
  getStorageStats,
  exportAllData,
  importData,
  initializeStorage,
  
  // Constants
  WALLET_TYPES,
  STORAGE_KEYS,
};
