/**
 * Services Index
 * 
 * Export all browser-based wallet services
 */

export { default as walletStorage, WALLET_TYPES, STORAGE_KEYS } from './walletStorage';
export { default as walletGenerator } from './walletGenerator';
export { default as backupService } from './backupService';
export { default as transactionService } from './transactionService';

// Initialize storage on app load
import walletStorage from './walletStorage';
walletStorage.initializeStorage();
