/**
 * Backup Service
 * 
 * Handles automatic backup downloads after each run.
 * Ensures users never lose their wallet keys.
 */

import walletStorage from './walletStorage';

/**
 * Generate backup filename with timestamp
 */
function generateBackupFilename(prefix = 'goat-backup') {
  const now = new Date();
  const timestamp = now.toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  return `${prefix}-${timestamp}.json`;
}

/**
 * Create a comprehensive backup of all wallet data
 */
export function createBackup() {
  const backup = {
    version: '1.0.0',
    type: 'full_backup',
    createdAt: new Date().toISOString(),
    data: walletStorage.exportAllData(),
    meta: {
      totalWallets: walletStorage.getAllWallets().length,
      totalIntermediaryWallets: walletStorage.getAllIntermediaryWalletsFlat().length,
      totalWarmedWallets: walletStorage.getWarmedWallets().length,
      runsInHistory: walletStorage.getRunHistory().length,
    }
  };
  
  return backup;
}

/**
 * Create a backup focused on current run only
 */
export function createRunBackup(runData = null) {
  const currentRun = runData || walletStorage.getCurrentRun();
  if (!currentRun) {
    console.warn('[BackupService] No current run to backup');
    return null;
  }
  
  // Get wallets associated with this run
  const runWallets = walletStorage.getWalletsByRunId(currentRun.runId);
  
  const backup = {
    version: '1.0.0',
    type: 'run_backup',
    createdAt: new Date().toISOString(),
    run: currentRun,
    wallets: runWallets,
    intermediaryWallets: walletStorage.getIntermediaryWallets(),
    meta: {
      runId: currentRun.runId,
      mintAddress: currentRun.mintAddress,
      walletCount: runWallets.length,
    }
  };
  
  return backup;
}

/**
 * Download backup as JSON file
 */
export function downloadBackup(backup, filename = null) {
  if (!backup) {
    console.error('[BackupService] No backup data to download');
    return false;
  }
  
  const finalFilename = filename || generateBackupFilename(
    backup.type === 'run_backup' ? `goat-run-${backup.meta?.runId || 'unknown'}` : 'goat-backup'
  );
  
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = finalFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  console.log(`[BackupService] Downloaded backup: ${finalFilename}`);
  return true;
}

/**
 * Auto-backup: Create and download full backup
 */
export function autoBackupFull() {
  const backup = createBackup();
  return downloadBackup(backup);
}

/**
 * Auto-backup: Create and download current run backup
 */
export function autoBackupCurrentRun() {
  const backup = createRunBackup();
  if (backup) {
    return downloadBackup(backup);
  }
  return false;
}

/**
 * Read and parse backup file
 */
export function readBackupFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const backup = JSON.parse(e.target.result);
        
        // Validate backup structure
        if (!backup.version || !backup.type || !backup.data) {
          // Try legacy format (direct data)
          if (backup.wallets || backup.currentRun) {
            resolve({
              version: '0.0.0',
              type: 'legacy_backup',
              data: backup,
              isLegacy: true,
            });
            return;
          }
          reject(new Error('Invalid backup file format'));
          return;
        }
        
        resolve(backup);
      } catch (err) {
        reject(new Error(`Failed to parse backup file: ${err.message}`));
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read backup file'));
    reader.readAsText(file);
  });
}

/**
 * Restore from backup
 */
export function restoreFromBackup(backup, options = {}) {
  const { 
    clearExisting = false, 
    restoreSettings = true,
    restoreHistory = true,
  } = options;
  
  if (!backup || !backup.data) {
    throw new Error('Invalid backup data');
  }
  
  const data = backup.data;
  
  // Clear existing data if requested
  if (clearExisting) {
    walletStorage.clearAllWallets();
    walletStorage.clearIntermediaryWallets();
    localStorage.removeItem(walletStorage.STORAGE_KEYS.RUN_HISTORY);
    console.log('[BackupService] Cleared existing data');
  }
  
  // Restore wallets
  if (data.wallets && data.wallets.length > 0) {
    const added = walletStorage.addWallets(data.wallets);
    console.log(`[BackupService] Restored ${added} wallets`);
  }
  
  // Restore intermediary wallets
  if (data.intermediaryWallets) {
    if (data.intermediaryWallets.hop1) {
      walletStorage.addIntermediaryWallets('hop1', data.intermediaryWallets.hop1);
    }
    if (data.intermediaryWallets.hop2) {
      walletStorage.addIntermediaryWallets('hop2', data.intermediaryWallets.hop2);
    }
    if (data.intermediaryWallets.hop3) {
      walletStorage.addIntermediaryWallets('hop3', data.intermediaryWallets.hop3);
    }
    console.log('[BackupService] Restored intermediary wallets');
  }
  
  // Restore warmed wallets
  if (data.warmedWallets && data.warmedWallets.length > 0) {
    for (const wallet of data.warmedWallets) {
      walletStorage.addWarmedWallet(wallet);
    }
    console.log(`[BackupService] Restored ${data.warmedWallets.length} warmed wallets`);
  }
  
  // Restore pump addresses
  if (data.pumpAddresses && data.pumpAddresses.length > 0) {
    const added = walletStorage.addPumpAddresses(data.pumpAddresses);
    console.log(`[BackupService] Restored ${added} pump addresses`);
  }
  
  // Restore current run
  if (data.currentRun) {
    walletStorage.setCurrentRun(data.currentRun);
    console.log('[BackupService] Restored current run');
  }
  
  // Restore run history
  if (restoreHistory && data.runHistory && data.runHistory.length > 0) {
    localStorage.setItem(
      walletStorage.STORAGE_KEYS.RUN_HISTORY,
      JSON.stringify(data.runHistory)
    );
    console.log(`[BackupService] Restored ${data.runHistory.length} runs in history`);
  }
  
  // Restore settings
  if (restoreSettings && data.settings) {
    walletStorage.saveSettings(data.settings);
    console.log('[BackupService] Restored settings');
  }
  
  return {
    success: true,
    walletsRestored: data.wallets?.length || 0,
    intermediaryRestored: walletStorage.getAllIntermediaryWalletsFlat().length,
    warmedRestored: data.warmedWallets?.length || 0,
    historyRestored: data.runHistory?.length || 0,
  };
}

/**
 * Restore from run backup (smaller scope)
 */
export function restoreFromRunBackup(backup) {
  if (!backup || backup.type !== 'run_backup') {
    throw new Error('Invalid run backup');
  }
  
  // Add wallets from this run
  if (backup.wallets && backup.wallets.length > 0) {
    walletStorage.addWallets(backup.wallets);
  }
  
  // Restore intermediary wallets
  if (backup.intermediaryWallets) {
    if (backup.intermediaryWallets.hop1) {
      walletStorage.addIntermediaryWallets('hop1', backup.intermediaryWallets.hop1);
    }
    if (backup.intermediaryWallets.hop2) {
      walletStorage.addIntermediaryWallets('hop2', backup.intermediaryWallets.hop2);
    }
  }
  
  // Set as current run if it wasn't completed
  if (backup.run && backup.run.status !== 'completed') {
    walletStorage.setCurrentRun(backup.run);
  } else if (backup.run) {
    walletStorage.addToRunHistory(backup.run);
  }
  
  return {
    success: true,
    runId: backup.run?.runId,
    walletsRestored: backup.wallets?.length || 0,
  };
}

/**
 * Import from file input element
 */
export async function importFromFileInput(fileInput, options = {}) {
  const file = fileInput.files?.[0];
  if (!file) {
    throw new Error('No file selected');
  }
  
  const backup = await readBackupFile(file);
  
  if (backup.type === 'run_backup') {
    return restoreFromRunBackup(backup);
  }
  
  return restoreFromBackup(backup, options);
}

/**
 * Schedule auto-backup (call after each run completion)
 */
export function scheduleAutoBackup(delayMs = 1000) {
  setTimeout(() => {
    autoBackupFull();
  }, delayMs);
}

/**
 * Check if backup is needed (e.g., if there's unsaved wallet data)
 */
export function checkBackupNeeded() {
  const currentRun = walletStorage.getCurrentRun();
  const wallets = walletStorage.getAllWallets();
  
  return {
    hasCurrentRun: !!currentRun,
    walletCount: wallets.length,
    needsBackup: wallets.length > 0 || !!currentRun,
    recommendation: wallets.length > 0 
      ? 'You have wallets stored. Consider downloading a backup.'
      : 'No wallets stored.',
  };
}

/**
 * Create emergency backup (minimal data for recovery)
 */
export function createEmergencyBackup() {
  const wallets = walletStorage.getAllWallets();
  const intermediary = walletStorage.getAllIntermediaryWalletsFlat();
  
  // Only include essential data: addresses and private keys
  const essential = {
    version: '1.0.0',
    type: 'emergency_backup',
    createdAt: new Date().toISOString(),
    wallets: wallets.map(w => ({
      address: w.address,
      privateKey: w.privateKey,
      type: w.type,
    })),
    intermediaryWallets: intermediary.map(w => ({
      publicKey: w.publicKey,
      secretKey: w.secretKey,
      hop: w.hop,
    })),
  };
  
  return essential;
}

export default {
  createBackup,
  createRunBackup,
  downloadBackup,
  autoBackupFull,
  autoBackupCurrentRun,
  readBackupFile,
  restoreFromBackup,
  restoreFromRunBackup,
  importFromFileInput,
  scheduleAutoBackup,
  checkBackupNeeded,
  createEmergencyBackup,
  generateBackupFilename,
};
