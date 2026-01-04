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
  launchToken: () => api.post('/launch-token'),
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
  createWarmingWallet: () => api.post('/warming-wallets/create'),
  addWarmingWallet: (privateKey) => api.post('/warming-wallets/add', { privateKey }),
  deleteWarmingWallet: (address) => api.delete(`/warming-wallets/${address}`),
  updateWalletStats: (walletAddresses) => api.post('/warming-wallets/update-stats', { walletAddresses }),
  updateWalletBalances: (walletAddresses) => api.post('/warming-wallets/update-balances', { walletAddresses }),
  gatherSolFromWallets: (walletAddresses) => api.post('/warming-wallets/gather-sol', { walletAddresses }),
  startWarming: (walletAddresses, config) => 
    api.post('/warm-wallets/start', { walletAddresses, config }),
  getWarmingProgress: () => api.get('/warm-wallets/progress'),
  getTrendingTokens: (limit = 100) => api.get(`/warm-wallets/trending-tokens?limit=${limit}`),
  addWalletsToLaunch: (walletAddresses, roles) => 
    api.post('/warm-wallets/add-to-launch', { walletAddresses, roles }),
};

export default apiService;

