import axios from 'axios';
import { isProductionMode } from './productionMode';
import { getHotWalletPrivateKey, getHotWalletAddress } from './hotWallet';

// In production, use the full API URL. In development, use relative /api path
const API_BASE = import.meta.env.VITE_API_URL 
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

console.log('[API] Using base URL:', API_BASE);

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
});

/**
 * In PRODUCTION mode, attach the hot wallet private key to requests
 * that need signing. The server will use this key instead of .env PRIVATE_KEY
 */
const attachHotWalletKey = (data = {}) => {
  if (isProductionMode()) {
    const hotWalletKey = getHotWalletPrivateKey();
    const hotWalletAddress = getHotWalletAddress();
    if (hotWalletKey) {
      console.log('[API] 🔥 Production mode: Using Hot Wallet for signing');
      return {
        ...data,
        _hotWalletKey: hotWalletKey,
        _hotWalletAddress: hotWalletAddress,
        _isProductionMode: true
      };
    } else {
      console.warn('[API] ⚠️ Production mode but no Hot Wallet set up!');
    }
  }
  return data;
};

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
  
  // Token launch - in production, uses Hot Wallet
  launchToken: (data = {}) => api.post('/launch-token', attachHotWalletKey(data)),
  quickLaunchToken: (data = {}) => api.post('/quick-launch-token', attachHotWalletKey(data)),
  // Rapid Launch - passes all data directly, uses Hot Wallet in production
  rapidLaunch: (data) => api.post('/rapid-launch', attachHotWalletKey(data), { timeout: 120000 }),
  getNextPumpAddress: () => api.get('/next-pump-address'),
  
  // Deployer wallet
  getDeployerWallet: () => api.get('/deployer-wallet'),
  
  // Holder wallets
  getHolderWallets: () => api.get('/holder-wallets'),
  // Now uses walletAddress - backend looks up privateKey securely server-side
  buyTokens: (walletAddress, mintAddress, solAmount, referrerPrivateKey, priorityFee) => 
    api.post('/holder-wallet/buy', { walletAddress, mintAddress, solAmount, referrerPrivateKey, priorityFee }),
  sellTokens: (walletAddress, mintAddress, percentage, priorityFee) => 
    api.post('/holder-wallet/sell', { walletAddress, mintAddress, percentage, priorityFee }),
  
  // Commands
  executeCommand: (command) => api.post('/command', { command }),
  
  // Current run
  getCurrentRun: () => api.get('/current-run'),
  
  // Launch wallet info (accepts optional params for warmed wallet addresses)
  getLaunchWalletInfo: (params = {}) => api.get('/launch-wallet-info', { params }),
  
  // Retry bundle
  retryBundle: () => api.post('/retry-bundle'),
  
  // Test wallets (for testing stream)
  addTestWallets: (wallets) => api.post('/live-trades/add-test-wallets', { wallets }),
  clearTestWallets: () => api.post('/live-trades/clear-test-wallets'),
  getTestWallets: () => api.get('/live-trades/test-wallets'),
  
  // Transfer SOL
  transferSol: (fromPrivateKey, toAddress, amount) => api.post('/transfer-sol', { fromPrivateKey, toAddress, amount }),
  
  // Wallet warming (SIMPLIFIED)
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
  
  // Volume Wallet Spawning (multi-hop funded fresh wallets)
  spawnVolumeWallets: (count = 1, amountPerWallet = 0.05, hops = 2, delayBetweenHopsMs = 2000) => 
    api.post('/volume-wallets/spawn', { count, amountPerWallet, hops, delayBetweenHopsMs }),
  
  // Relaunch with same wallets but new pump address
  relaunchToken: () => api.post('/relaunch-token'),
  
  // Dune Analytics
  getDuneVolumeData: (forceRefresh = false, days = 7, executeQuery = false) => {
    const params = new URLSearchParams();
    if (forceRefresh) params.append('refresh', 'true');
    if (days) params.append('days', days.toString());
    if (executeQuery) params.append('execute', 'true');
    const queryString = params.toString();
    return api.get(`/dune/pumpfun-volume${queryString ? '?' + queryString : ''}`);
  },

  // AI Content Generation
  generateAIContent: (prompt, options = {}) => 
    api.post('/ai/generate', { prompt, ...options }),
  generateAIVariations: (prompt, count = 3, options = {}) => 
    api.post('/ai/generate-variations', { prompt, count, ...options }),
  getAIColorSchemes: () => api.get('/ai/color-schemes'),
  getAIStatus: () => api.get('/ai/status'),

  // Auto-Sell Configuration
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
  
  // Launch Tracker - PnL & History
  getLaunchTrackerCurrent: () => api.get('/launch-tracker/current'),
  getLaunchTrackerStats: () => api.get('/launch-tracker/stats'),
  calculatePnL: () => api.post('/launch-tracker/calculate-pnl'),
  completeLaunch: () => api.post('/launch-tracker/complete'),
  getLaunchHistory: (limit = 10) => api.get(`/launch-tracker/history?limit=${limit}`),
  getLaunchTrades: (launchId) => api.get(`/launch-tracker/trades/${launchId}`),
  getAggregatedStats: () => api.get('/launch-tracker/aggregated-stats'),
  
  // AI Image Generation (Gemini/Nano Banana)
  getAIStatus: () => api.get('/ai/status'),
  getAIStyles: () => api.get('/ai/styles'),
  generateAIImage: (prompt, style = 'meme', aspectRatio = '1:1') => 
    api.post('/ai/generate-image', { prompt, style, aspectRatio }, { timeout: 60000 }),

  // Private Funding (Mayan Bridge: SOL → ETH → SOL)
  getPrivateFundingStatus: () => api.get('/private-funding/status'),
  getPrivateFundingSolWallets: () => api.get('/private-funding/sol-wallets'),
  getPrivateFundingIntermediaryWallets: () => api.get('/private-funding/intermediary-wallets'),
  createPrivateFundingIntermediary: () => api.post('/private-funding/create-intermediary'),
  checkPrivateFundingBalance: (address, chain) => 
    api.post('/private-funding/check-balance', { address, chain }),
  
  // Private Fund Wallets (automated SOL → ETH → SOL flow)
  autoFundWallets: (sourceWalletId, destinationAddresses, totalAmount, chain = 'base') =>
    api.post('/private-funding/auto-fund-wallets', { 
      sourceWalletId, destinationAddresses, totalAmount, chain, createNewIntermediary: true 
    }, { timeout: 600000 }), // 10 minute timeout for bridge
  
  // Private Withdraw Wallets (automated SOL → ETH → SOL withdrawal)
  autoWithdrawWallets: (sourceAddresses, destinationWalletId = 'main', chain = 'base') =>
    api.post('/private-funding/auto-withdraw-wallets', { 
      sourceAddresses, destinationWalletId, chain, createNewIntermediary: true 
    }, { timeout: 600000 }), // 10 minute timeout for bridge
  
  // Manual bridge steps
  bridgeSolToEth: (sourcePrivateKey, intermediaryAddress, amount, chain = 'base') =>
    api.post('/private-funding/bridge-sol-to-eth', { sourcePrivateKey, intermediaryAddress, amount, chain }, { timeout: 120000 }),
  bridgeEthToSol: (intermediaryPrivateKey, destinationAddresses, amountPerWallet, chain = 'base') =>
    api.post('/private-funding/bridge-eth-to-sol', { intermediaryPrivateKey, destinationAddresses, amountPerWallet, chain }, { timeout: 120000 }),
  bridgeFromWallet: (walletId, intermediaryAddress, amount, chain = 'base') =>
    api.post('/private-funding/bridge-from-wallet', { walletId, intermediaryAddress, amount, chain }, { timeout: 120000 }),
  
  // Wait/poll for balances
  waitForEthBalance: (intermediaryAddress, minBalance, timeoutSeconds, chain) =>
    api.post('/private-funding/wait-for-eth-balance', { intermediaryAddress, minBalance, timeoutSeconds, chain }, { timeout: 600000 }),
  waitForSolBalance: (walletAddress, minBalance, timeoutSeconds) =>
    api.post('/private-funding/wait-for-sol-balance', { walletAddress, minBalance, timeoutSeconds }, { timeout: 600000 }),

  // Recovery: Bridge stuck ETH back to SOL
  recoverIntermediaryEth: (intermediaryAddress, destinationSolAddress, chain = 'base') =>
    api.post('/private-funding/recover-intermediary', { intermediaryAddress, destinationSolAddress, chain }, { timeout: 300000 }),
  
  // List all intermediary wallets
  listIntermediaryWallets: () => api.get('/private-funding/intermediary-wallets'),
};

export default apiService;

