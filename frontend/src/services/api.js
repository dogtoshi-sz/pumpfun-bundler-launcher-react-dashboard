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
  
  // Batch sell - INSTANT parallel sells
  batchSellAll: (percentage = 100, priorityFee = 'high') => 
    api.post('/batch-sell', { percentage, priorityFee }),
  batchSellBundles: (percentage = 100, priorityFee = 'high') => 
    api.post('/batch-sell-bundles', { percentage, priorityFee }),
  batchSellHolders: (percentage = 100, priorityFee = 'high') => 
    api.post('/batch-sell-holders', { percentage, priorityFee }),
  
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
  updateWalletStats: (walletAddresses) => api.post('/warming-wallets/update-stats', { walletAddresses }, { timeout: 120000 }), // 2 minute timeout for blockchain queries
  updateWalletBalances: (walletAddresses) => api.post('/warming-wallets/update-balances', { walletAddresses }),
  gatherSolFromWallets: (walletAddresses) => api.post('/warming-wallets/gather-sol', { walletAddresses }),
  sellAllTokensFromWallet: (walletAddress) => api.post('/warming-wallets/sell-all-tokens', { walletAddress }),
  closeEmptyTokenAccounts: (walletAddress) => api.post('/warming-wallets/close-empty-accounts', { walletAddress }),
  withdrawSolFromWallet: (walletAddress) => api.post('/warming-wallets/withdraw-sol', { walletAddress }),
  startWarming: (walletAddresses, config) => 
    api.post('/warm-wallets/start', { walletAddresses, config }),
  getWarmingProgress: () => api.get('/warm-wallets/progress'),
  getTrendingTokens: (limit = 100) => api.get(`/warm-wallets/trending-tokens?limit=${limit}`),
  addWalletsToLaunch: (walletAddresses, roles) => 
    api.post('/warm-wallets/add-to-launch', { walletAddresses, roles }),
  
  // Private funding (cross-chain)
  autoFundWallets: (sourceWalletId, destinationAddresses, totalAmount, chain = 'base') =>
    api.post('/private-funding/auto-fund-wallets', { 
      sourceWalletId, 
      destinationAddresses, 
      totalAmount, 
      chain 
    }, { timeout: 600000 }), // 10 minute timeout for long-running bridge operations
  autoWithdrawWallets: (sourceAddresses, destinationWalletId = 'main', chain = 'base') =>
    api.post('/private-funding/auto-withdraw-wallets', { 
      sourceAddresses, 
      destinationWalletId, 
      chain 
    }, { timeout: 600000 }), // 10 minute timeout
  withdrawAllEth: (chain = 'base') =>
    api.post('/private-funding/withdraw-all-eth', { chain }, { timeout: 600000 }),
  recoverIntermediaryEth: (intermediaryAddress, destinationSolAddress, chain = 'base') =>
    api.post('/private-funding/recover-intermediary', { intermediaryAddress, destinationSolAddress, chain }, { timeout: 600000 }),
  recoverSolIntermediaries: (destinationWalletId = 'main') =>
    api.post('/private-funding/recover-sol-intermediaries', { destinationWalletId }, { timeout: 600000 }),
  listIntermediaryWallets: () => api.get('/private-funding/intermediary-wallets'),
  // Private funding via SOL intermediaries (no Mayan)
  fundWalletsViaSolIntermediaries: (sourceWalletId, destinationAddresses, totalAmountSol, intermediaryCount = 10, reuseSaved = false) =>
    api.post('/private-funding/sol-intermediary', {
      sourceWalletId, // 'main' uses PRIVATE_KEY from .env, or provide sourcePrivateKey directly
      destinationAddresses,
      totalAmountSol,
      intermediaryCount,
      reuseSavedIntermediaries: reuseSaved
    }, { timeout: 600000 }), // 10 minute timeout
  
  // Relaunch with same wallets
  relaunchToken: () => api.post('/relaunch-token'),
  
  // Auto-Sell (using unified TradeManager)
  getAutoSellConfig: () => api.get('/auto-sell/config'),
  configureAutoSell: (walletAddress, threshold, enabled = true) => 
    api.post('/auto-sell/configure', { walletAddress, threshold, enabled }),
  configureAllAutoSell: (wallets, enabled = true) => 
    api.post('/auto-sell/configure-all', { wallets, enabled }),
  toggleAutoSell: (enabled) => api.post('/auto-sell/toggle', { enabled }),
  resetAutoSell: () => api.post('/auto-sell/reset'),
  
  // MEV Protection
  getMevProtection: () => api.get('/auto-sell/mev-protection'),
  setMevProtection: (settings) => api.post('/auto-sell/mev-protection', settings),
  
  // Trade Manager (new unified system)
  getTradeManagerStatus: () => api.get('/trade-manager/status'),
  getTradeManagerTrades: () => api.get('/trade-manager/trades'),
  getTradeManagerPnL: () => api.get('/trade-manager/pnl'),
  getExternalVolume: () => api.get('/trade-manager/external-volume'),
  startTracking: (mintAddress) => api.post('/trade-manager/track', { mintAddress }),
  
  // Clean P&L Tracker (accurate, simple)
  getPnLWallets: () => api.get('/pnl/wallets'),
  getPnLWallet: (label) => api.get(`/pnl/wallet/${encodeURIComponent(label)}`),
  getPnLTotal: () => api.get('/pnl/total'),
  getPnLExternalVolume: () => api.get('/pnl/external-volume'),
  getPnLAutoSellConfig: () => api.get('/pnl/auto-sell/config'),
  configurePnLAutoSell: (walletLabel, config) => api.post('/pnl/auto-sell/configure', { walletLabel, ...config }),
  configurePnLAutoBuy: (config) => api.post('/pnl/auto-buy/configure', config),
  resetPnL: () => api.post('/pnl/reset'),
  
  // Token Configurations (Token Info Only)
  getTokenConfigs: () => api.get('/token-configs'),
  getTokenConfig: (id) => api.get(`/token-configs/${id}`),
  saveTokenConfig: (name, config) => api.post('/token-configs', { name, config }),
  updateTokenConfig: (id, name, config) => api.put(`/token-configs/${id}`, { name, config }),
  deleteTokenConfig: (id) => api.delete(`/token-configs/${id}`),
  
  // Wallet Profiles (Wallet/Sell Settings)
  getWalletProfiles: () => api.get('/wallet-profiles'),
  getWalletProfile: (id) => api.get(`/wallet-profiles/${id}`),
  saveWalletProfile: (name, profile) => api.post('/wallet-profiles', { name, profile }),
  updateWalletProfile: (id, name, profile) => api.put(`/wallet-profiles/${id}`, { name, profile }),
  deleteWalletProfile: (id) => api.delete(`/wallet-profiles/${id}`),
  
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
  
  // ===========================================
  // Marketing Features (DISABLED in simple version)
  // These return disabled responses from the server
  // ===========================================
  
  // Website
  updateWebsite: (data) => api.post('/marketing/website/update', data),
  testWebsiteConnection: (vercelSiteUrl, secret, tokenConfig) => 
    api.post('/marketing/website/update', { vercelSiteUrl, secret, tokenConfig, test: true }),
  
  // Twitter (matching expected signatures)
  getTwitterAccountInfo: (apiKey, apiSecret, accessToken, accessTokenSecret) => 
    api.post('/marketing/twitter/get-account-info', { apiKey, apiSecret, accessToken, accessTokenSecret }),
  verifyTwitterAccount: (apiKey, apiSecret, accessToken, accessTokenSecret) => 
    api.post('/marketing/twitter/get-account-info', { apiKey, apiSecret, accessToken, accessTokenSecret }),
  postTweet: (data) => api.post('/marketing/twitter/post-single', data),
  autoPostTwitter: (data) => api.post('/marketing/twitter/auto-post', data),
  updateTwitterProfile: (data) => api.post('/marketing/twitter/update-profile', data),
  
  // Telegram (matching expected signatures)
  checkTelegramStatus: (api_id, api_hash, phone) => 
    api.post('/marketing/telegram/check-status', { api_id, api_hash, phone }),
  sendTelegramCode: (api_id, api_hash, phone) => 
    api.post('/marketing/telegram/send-code', { api_id, api_hash, phone }),
  verifyTelegramCode: (api_id, api_hash, phone, code, phone_code_hash, password) => 
    api.post('/marketing/telegram/verify-code', { api_id, api_hash, phone, code, phone_code_hash, password }),
  createTelegramGroup: (data) => api.post('/marketing/telegram/create-group', data),
  getTelegramMessages: (data) => api.post('/marketing/telegram/get-messages', data),
  sendTelegramMessage: (data) => api.post('/marketing/telegram/send-message', data),
  
  // AI Generator (also disabled)
  getAIStatus: () => api.get('/ai/status'),
  generateContent: (data) => api.post('/ai/generate', data),
  getColorSchemes: () => api.get('/ai/color-schemes'),
  
  // AI Image Generation
  generateAIImage: (prompt, style) => api.post('/ai/generate-image', { prompt, style }),
  
  // Vanity Address Generator
  getVanityPoolStatus: () => api.get('/vanity-pool-status'),
  startVanityGenerator: () => api.post('/vanity-generator/start'),
  stopVanityGenerator: () => api.post('/vanity-generator/stop'),
  
  // Generate random address preview
  generateRandomAddress: () => api.post('/generate-random-address'),
};

export default apiService;
