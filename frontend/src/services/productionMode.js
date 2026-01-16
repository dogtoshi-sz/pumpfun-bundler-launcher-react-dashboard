/**
 * Production Mode Service
 * 
 * Detects whether we're running in production (browser-keys) mode
 * and provides utilities for production-specific functionality.
 * 
 * LOCAL MODE: Uses server's PRIVATE_KEY from .env
 * PRODUCTION MODE: Uses browser's Hot Wallet for signing
 */

// Check if we're in production/browser-keys mode
export const isProductionMode = () => {
  return import.meta.env.VITE_BROWSER_KEYS === 'true' || 
         import.meta.env.MODE === 'production';
};

// Check if we're in local development mode
export const isLocalMode = () => {
  return !isProductionMode();
};

// Get the API base URL
export const getApiUrl = () => {
  return import.meta.env.VITE_API_URL || '';
};

// Log mode on init
console.log(`[ProductionMode] Running in ${isProductionMode() ? 'PRODUCTION' : 'LOCAL'} mode`);
if (isProductionMode()) {
  console.log('[ProductionMode] 🔥 Browser signing enabled - Hot Wallet will sign all transactions');
} else {
  console.log('[ProductionMode] 🔑 Server signing enabled - Using server PRIVATE_KEY');
}

export default {
  isProductionMode,
  isLocalMode,
  getApiUrl
};
