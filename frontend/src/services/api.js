import axios from 'axios';

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
  getNextPumpAddress: () => api.get('/next-pump-address'),
  
  // Deployer wallet
  getDeployerWallet: () => api.get('/deployer-wallet'),
  
  // Holder wallets
  getHolderWallets: () => api.get('/holder-wallets'),
  buyTokens: (privateKey, mintAddress, solAmount, referrerPrivateKey, priorityFee) => 
    api.post('/holder-wallet/buy', { privateKey, mintAddress, solAmount, referrerPrivateKey, priorityFee }),
  sellTokens: (privateKey, mintAddress, percentage, priorityFee) => 
    api.post('/holder-wallet/sell', { privateKey, mintAddress, percentage, priorityFee }),
  
  // Commands
  executeCommand: (command) => api.post('/command', { command }),
  
  // Current run
  getCurrentRun: () => api.get('/current-run'),
  
  // Launch wallet info
  getLaunchWalletInfo: () => api.get('/launch-wallet-info'),
  
  // Retry bundle
  retryBundle: () => api.post('/retry-bundle'),
  
  // Wallet warming (SIMPLIFIED)
  getWarmingWallets: () => api.get('/warming-wallets'),
  getWalletPrivateKey: (walletAddress) => api.post('/warming-wallets/get-private-key', { walletAddress }),
  createWarmingWallet: (tags) => api.post('/warming-wallets/create', { tags }),
  addWarmingWallet: (privateKey, tags) => api.post('/warming-wallets/add', { privateKey, tags }),
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
  
  // Twitter
  getTwitterAccountInfo: (apiKey, apiSecret, accessToken, accessTokenSecret) =>
    api.post('/marketing/twitter/get-account-info', { apiKey, apiSecret, accessToken, accessTokenSecret }),
  
  // Telegram Verification
  sendTelegramCode: (api_id, api_hash, phone) =>
    api.post('/marketing/telegram/send-code', { api_id, api_hash, phone }),
  verifyTelegramCode: (api_id, api_hash, phone, code, phone_code_hash, password) =>
    api.post('/marketing/telegram/verify-code', { api_id, api_hash, phone, code, phone_code_hash, password }),
  checkTelegramStatus: (api_id, api_hash, phone) =>
    api.post('/marketing/telegram/check-status', { api_id, api_hash, phone }),
  
  // Token Configurations
  getTokenConfigs: () => api.get('/token-configs'),
  getTokenConfig: (id) => api.get(`/token-configs/${id}`),
  saveTokenConfig: (name, config) => api.post('/token-configs', { name, config }),
  updateTokenConfig: (id, name, config) => api.put(`/token-configs/${id}`, { name, config }),
  deleteTokenConfig: (id) => api.delete(`/token-configs/${id}`),
  
  // Token Info
  getTokenInfo: (mintAddress) => api.get(`/token-info/${mintAddress}`),
};

export default apiService;

