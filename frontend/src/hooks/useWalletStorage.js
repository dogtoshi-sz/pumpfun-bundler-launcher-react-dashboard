/**
 * useWalletStorage Hook
 * 
 * React hook for accessing browser wallet storage.
 * Provides reactive state updates when wallet data changes.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import walletStorage from '../services/walletStorage';
import walletGenerator from '../services/walletGenerator';
import backupService from '../services/backupService';
import transactionService from '../services/transactionService';

export function useWalletStorage() {
  const [wallets, setWallets] = useState([]);
  const [intermediaryWallets, setIntermediaryWallets] = useState([]);
  const [warmedWallets, setWarmedWallets] = useState([]);
  const [currentRun, setCurrentRun] = useState(null);
  const [runHistory, setRunHistory] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  
  // Track if component is mounted
  const isMounted = useRef(true);

  // Refresh all data from storage
  const refresh = useCallback(() => {
    if (!isMounted.current) return;
    
    setWallets(walletStorage.getAllWallets());
    setIntermediaryWallets(walletStorage.getAllIntermediaryWalletsFlat());
    setWarmedWallets(walletStorage.getWarmedWallets());
    setCurrentRun(walletStorage.getCurrentRun());
    setRunHistory(walletStorage.getRunHistory());
    setStats(walletStorage.getStorageStats());
  }, []);

  // Load on mount
  useEffect(() => {
    isMounted.current = true;
    refresh();
    
    // Listen for storage changes (from other tabs)
    const handleStorageChange = (e) => {
      if (e.key?.startsWith('goat_')) {
        refresh();
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    
    return () => {
      isMounted.current = false;
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [refresh]);

  // Generate wallets
  const generateBundleWallets = useCallback((count, runId) => {
    const result = walletGenerator.generateBundleWallets(count, runId);
    refresh();
    return result;
  }, [refresh]);

  const generateHolderWallets = useCallback((count, runId) => {
    const result = walletGenerator.generateHolderWallets(count, runId);
    refresh();
    return result;
  }, [refresh]);

  const generateDevWallet = useCallback((runId) => {
    const result = walletGenerator.generateDevWallet(runId);
    refresh();
    return result;
  }, [refresh]);

  const generateIntermediaryWallets = useCallback((config) => {
    const result = walletGenerator.generateIntermediaryWallets(config);
    refresh();
    return result;
  }, [refresh]);

  const generateWarmedWallets = useCallback((count, type) => {
    const result = walletGenerator.generateWarmedWallets(count, type);
    refresh();
    return result;
  }, [refresh]);

  const generateRunWalletSet = useCallback((runId, config) => {
    const result = walletGenerator.generateRunWalletSet(runId, config);
    refresh();
    return result;
  }, [refresh]);

  // Run management
  const createRun = useCallback((mintAddress, settings) => {
    const run = walletStorage.createNewRun(mintAddress, settings);
    refresh();
    return run;
  }, [refresh]);

  const updateRunStatus = useCallback((status, data) => {
    walletStorage.updateRunStatus(status, data);
    refresh();
  }, [refresh]);

  const completeRun = useCallback((result) => {
    const completed = walletStorage.completeCurrentRun(result);
    refresh();
    
    // Auto-backup after run completion
    backupService.autoBackupFull();
    
    return completed;
  }, [refresh]);

  // Backup operations
  const downloadFullBackup = useCallback(() => {
    return backupService.autoBackupFull();
  }, []);

  const downloadRunBackup = useCallback(() => {
    return backupService.autoBackupCurrentRun();
  }, []);

  const restoreBackup = useCallback(async (file, options) => {
    const result = await backupService.importFromFileInput({ files: [file] }, options);
    refresh();
    return result;
  }, [refresh]);

  // Transaction operations
  const checkBalances = useCallback(async (addresses) => {
    setLoading(true);
    try {
      const result = await transactionService.checkBalances(addresses);
      return result;
    } finally {
      setLoading(false);
    }
  }, []);

  const recoverIntermediaryFunds = useCallback(async (destinationAddress) => {
    setLoading(true);
    try {
      const result = await transactionService.recoverIntermediaryFunds(destinationAddress);
      refresh();
      return result;
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  const gatherFunds = useCallback(async (walletAddresses, destinationAddress) => {
    setLoading(true);
    try {
      const result = await transactionService.gatherFunds(walletAddresses, destinationAddress);
      return result;
    } finally {
      setLoading(false);
    }
  }, []);

  // Clear operations
  const clearAllWallets = useCallback(() => {
    walletStorage.clearAllWallets();
    refresh();
  }, [refresh]);

  const clearIntermediaryWallets = useCallback(() => {
    walletStorage.clearIntermediaryWallets();
    refresh();
  }, [refresh]);

  // Get wallet by address
  const getWalletByAddress = useCallback((address) => {
    return walletStorage.getWalletByAddress(address);
  }, []);

  // Get wallets by type
  const getWalletsByType = useCallback((type) => {
    return walletStorage.getWalletsByType(type);
  }, []);

  // Check if backup is needed
  const checkBackupNeeded = useCallback(() => {
    return backupService.checkBackupNeeded();
  }, []);

  return {
    // State
    wallets,
    intermediaryWallets,
    warmedWallets,
    currentRun,
    runHistory,
    stats,
    loading,
    
    // Refresh
    refresh,
    
    // Generate
    generateBundleWallets,
    generateHolderWallets,
    generateDevWallet,
    generateIntermediaryWallets,
    generateWarmedWallets,
    generateRunWalletSet,
    
    // Run management
    createRun,
    updateRunStatus,
    completeRun,
    
    // Backup
    downloadFullBackup,
    downloadRunBackup,
    restoreBackup,
    checkBackupNeeded,
    
    // Transactions
    checkBalances,
    recoverIntermediaryFunds,
    gatherFunds,
    
    // Clear
    clearAllWallets,
    clearIntermediaryWallets,
    
    // Utility
    getWalletByAddress,
    getWalletsByType,
  };
}

export default useWalletStorage;
