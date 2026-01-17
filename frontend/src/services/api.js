import axios from 'axios';

// Local API - always uses relative /api path
const API_BASE = '/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
});

export const apiService = {
  // Settings
  getSettings: () => api.get('/settings'),
  updateSettings: (settings) => api.post('/settings', { settings }),
  
  // Image upload
  uploadImage: (file) => {
    const formData = new FormData();
    formData.append('image', file);
    return api.post('/upload-image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  
  // Token launch
  launchToken: (data = {}) => api.post('/launch-token', data),
  quickLaunchToken: (data = {}) => api.post('/quick-launch-token', data),
  rapidLaunch: (data) => api.post('/rapid-launch', data, { timeout: 120000 }),
  getNextPumpAddress: () => api.get('/next-pump-address'),
  
  // Deployer wallet
  getDeployerWallet: () => api.get('/deployer-wallet'),
  
  // Holder wallets
  getHolderWallets: () => api.get('/holder-wallets'),
  buyTokens: (walletAddress, mintAddress, solAmount, referrerPrivateKey, priorityFee) => 
    api.post('/holder-wallet/buy', { walletAddress, mintAddress, solAmount, referrerPrivateKey, priorityFee }),
  sellTokens: (walletAddress, mintAddress, percentage, priorityFee) => 
    api.post('/holder-wallet/sell', { walletAddress, mintAddress, percentage, priorityFee }),
  
  // Commands
  executeCommand: (command) => api.post('/command', { command }),
  
  // Current run
  getCurrentRun: () => api.get('/current-run'),
  
  // Launch wallet info
  getLaunchWalletInfo: (params = {}) => api.get('/launch-wallet-info', { params }),
  
  // Retry bundle
  retryBundle: () => api.post('/retry-bundle'),
  
  // Transfer SOL
  transferSol: (fromPrivateKey, toAddress, amount) => api.post('/transfer-sol', { fromPrivateKey, toAddress, amount }),
  
  // Wallet warming
  getWarmingWallets: () => api.get('/warming-wallets'),
  getWalletPrivateKey: (walletAddress) => api.post('/warming-wallets/get-private-key', { walletAddress }),
  createWarmingWallet: (tags) => api.post('/warming-wallets/create', { tags }),
  addWarmingWallet: (privateKey, tags) => api.post('/warming-wallets/add', { privateKey, tags }),
  previewWallet: (privateKey) => api.post('/warming-wallets/preview', { privateKey }),
  updateWalletTags: (address, tags) => api.put(`/warming-wallets/${address}/tags`, { tags }),
  deleteWarmingWallet: (address) => api.delete(`/warming-wallets/${address}`),
  updateWalletStats: (walletAddresses) => api.post('/warming-wallets/update-stats', { walletAddresses }),
  updateWalletBalances: (walletAddresses) => api.post('/warming-wallets/update-balances', { walletAddresses }),
  gatherSolFromWallets: (walletAddresses) => api.post('/warming-wallets/gather-sol', { walletAddresses }),
  sellAllTokensFromWallet: (walletAddress) => api.post('/warming-wallets/sell-all-tokens', { walletAddress }),
  withdrawSolFromWallet: (walletAddress) => api.post('/warming-wallets/withdraw-sol', { walletAddress }),
  startWarming: (walletAddresses, config) => 
    api.post('/warm-wallets/start', { walletAddresses, config }),
  getWarmingProgress: () => api.get('/warm-wallets/progress'),
  getTrendingTokens: (limit = 100) => api.get(`/warm-wallets/trending-tokens?limit=${limit}`),
  addWalletsToLaunch: (walletAddresses, roles) => 
    api.post('/warm-wallets/add-to-launch', { walletAddresses, roles }),
  
  // Relaunch with same wallets
  relaunchToken: () => api.post('/relaunch-token'),
  
  // Auto-Sell
  getAutoSellConfig: () => api.get('/auto-sell/config'),
  configureAutoSell: (walletAddress, threshold, enabled = true) => 
    api.post('/auto-sell/configure', { walletAddress, threshold, enabled }),
  configureAllAutoSell: (wallets, enabled = true) => 
    api.post('/auto-sell/configure-all', { wallets, enabled }),
  toggleAutoSell: (enabled) => api.post('/auto-sell/toggle', { enabled }),
  resetAutoSell: () => api.post('/auto-sell/reset'),
  
  // Token Configurations
  getTokenConfigs: () => api.get('/token-configs'),
  getTokenConfig: (id) => api.get(`/token-configs/${id}`),
  saveTokenConfig: (name, config) => api.post('/token-configs', { name, config }),
  updateTokenConfig: (id, name, config) => api.put(`/token-configs/${id}`, { name, config }),
  deleteTokenConfig: (id) => api.delete(`/token-configs/${id}`),
  
  // Token Info
  getTokenInfo: (mintAddress) => api.get(`/token-info/${mintAddress}`),
  
  // Launch Tracker - PnL
  getLaunchTrackerCurrent: () => api.get('/launch-tracker/current'),
  getLaunchTrackerStats: () => api.get('/launch-tracker/stats'),
  calculatePnL: () => api.post('/launch-tracker/calculate-pnl'),
  completeLaunch: () => api.post('/launch-tracker/complete'),
  getLaunchHistory: (limit = 10) => api.get(`/launch-tracker/history?limit=${limit}`),
  getLaunchTrades: (launchId) => api.get(`/launch-tracker/trades/${launchId}`),
  getAggregatedStats: () => api.get('/launch-tracker/aggregated-stats'),
};

export default apiService;
