/**
 * WalletManager Component
 * 
 * UI for managing browser-stored wallets.
 * Displays wallet balances, allows backup/restore, and recovery operations.
 */

import React, { useState, useEffect } from 'react';
import walletStorage, { WALLET_TYPES } from '../services/walletStorage';
import walletGenerator from '../services/walletGenerator';
import backupService from '../services/backupService';
import transactionService from '../services/transactionService';

const WalletManager = () => {
  const [wallets, setWallets] = useState([]);
  const [intermediaryWallets, setIntermediaryWallets] = useState([]);
  const [warmedWallets, setWarmedWallets] = useState([]);
  const [currentRun, setCurrentRun] = useState(null);
  const [balances, setBalances] = useState({});
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const [message, setMessage] = useState(null);

  // Load wallet data on mount
  useEffect(() => {
    loadWalletData();
  }, []);

  const loadWalletData = () => {
    setWallets(walletStorage.getAllWallets());
    setIntermediaryWallets(walletStorage.getAllIntermediaryWalletsFlat());
    setWarmedWallets(walletStorage.getWarmedWallets());
    setCurrentRun(walletStorage.getCurrentRun());
    setStats(walletStorage.getStorageStats());
  };

  const showMessage = (text, type = 'info') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 5000);
  };

  // Check all balances
  const checkBalances = async () => {
    setLoading(true);
    try {
      const allAddresses = [
        ...wallets.map(w => w.address),
        ...intermediaryWallets.map(w => w.publicKey),
      ];
      
      if (allAddresses.length === 0) {
        showMessage('No wallets to check', 'warning');
        setLoading(false);
        return;
      }
      
      const result = await transactionService.checkBalances(allAddresses);
      
      const balanceMap = {};
      for (const b of result.balances) {
        balanceMap[b.address] = b.balance;
      }
      setBalances(balanceMap);
      showMessage(`Checked ${allAddresses.length} wallets. Total: ${result.totalSol.toFixed(4)} SOL`, 'success');
    } catch (err) {
      showMessage(`Error checking balances: ${err.message}`, 'error');
    }
    setLoading(false);
  };

  // Generate new wallets
  const handleGenerateWallets = async (type, count) => {
    const runId = currentRun?.runId || `manual-${Date.now()}`;
    
    if (type === 'bundle') {
      walletGenerator.generateBundleWallets(count, runId);
    } else if (type === 'holder') {
      walletGenerator.generateHolderWallets(count, runId);
    } else if (type === 'intermediary') {
      walletGenerator.generateIntermediaryWallets({ hop1Count: 3, hop2Count: 9 });
    } else if (type === 'warmed') {
      walletGenerator.generateWarmedWallets(count, 'bundle');
    }
    
    loadWalletData();
    showMessage(`Generated ${count || 12} ${type} wallets`, 'success');
    
    // Auto-backup
    backupService.scheduleAutoBackup();
  };

  // Backup operations
  const handleFullBackup = () => {
    backupService.autoBackupFull();
    showMessage('Full backup downloaded', 'success');
  };

  const handleRunBackup = () => {
    if (!currentRun) {
      showMessage('No current run to backup', 'warning');
      return;
    }
    backupService.autoBackupCurrentRun();
    showMessage('Run backup downloaded', 'success');
  };

  const handleEmergencyBackup = () => {
    const backup = backupService.createEmergencyBackup();
    backupService.downloadBackup(backup, `emergency-backup-${Date.now()}.json`);
    showMessage('Emergency backup downloaded', 'success');
  };

  // Import backup
  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    try {
      const result = await backupService.importFromFileInput(e.target, { clearExisting: false });
      loadWalletData();
      showMessage(`Imported ${result.walletsRestored} wallets`, 'success');
    } catch (err) {
      showMessage(`Import failed: ${err.message}`, 'error');
    }
    
    // Clear file input
    e.target.value = '';
  };

  // Recover intermediary funds
  const handleRecoverIntermediaryFunds = async () => {
    if (intermediaryWallets.length === 0) {
      showMessage('No intermediary wallets to recover', 'warning');
      return;
    }
    
    const destination = prompt('Enter destination address for recovered funds:');
    if (!destination) return;
    
    setLoading(true);
    try {
      const result = await transactionService.recoverIntermediaryFunds(destination);
      loadWalletData();
      
      if (result.totalRecovered > 0) {
        showMessage(`Recovered ${result.totalRecovered.toFixed(4)} SOL`, 'success');
      } else {
        showMessage('No funds to recover', 'info');
      }
    } catch (err) {
      showMessage(`Recovery failed: ${err.message}`, 'error');
    }
    setLoading(false);
  };

  // Gather all funds
  const handleGatherFunds = async () => {
    const walletsWithBalance = wallets.filter(w => (balances[w.address] || 0) > 0.0001);
    
    if (walletsWithBalance.length === 0) {
      showMessage('No wallets with balance to gather', 'warning');
      return;
    }
    
    const destination = prompt('Enter destination address for gathered funds:');
    if (!destination) return;
    
    setLoading(true);
    try {
      const result = await transactionService.gatherFunds(
        walletsWithBalance.map(w => w.address),
        destination
      );
      
      await checkBalances();
      showMessage(`Gathered ${result.totalGathered?.toFixed(4) || '?'} SOL from ${result.successCount} wallets`, 'success');
    } catch (err) {
      showMessage(`Gather failed: ${err.message}`, 'error');
    }
    setLoading(false);
  };

  // Clear all data (dangerous!)
  const handleClearAll = () => {
    const confirmed = window.confirm(
      '⚠️ DANGER: This will DELETE ALL your wallet data!\n\n' +
      'Make sure you have a backup first!\n\n' +
      'Type "DELETE" to confirm.'
    );
    if (confirmed) {
      const input = prompt('Type DELETE to confirm:');
      if (input === 'DELETE') {
        walletStorage.clearAllWallets();
        walletStorage.clearIntermediaryWallets();
        localStorage.removeItem(walletStorage.STORAGE_KEYS.RUN_HISTORY);
        loadWalletData();
        showMessage('All wallet data cleared', 'warning');
      }
    }
  };

  return (
    <div className="wallet-manager">
      <h2>🔐 Wallet Manager (Browser Storage)</h2>
      
      {message && (
        <div className={`message message-${message.type}`}>
          {message.text}
        </div>
      )}
      
      {/* Stats Section */}
      <div className="stats-section">
        <h3>📊 Storage Stats</h3>
        {stats && (
          <div className="stats-grid">
            <div className="stat-item">
              <span className="stat-label">Total Wallets</span>
              <span className="stat-value">{stats.totalWallets}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Bundle Wallets</span>
              <span className="stat-value">{stats.walletsByType.bundle}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Holder Wallets</span>
              <span className="stat-value">{stats.walletsByType.holder}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Intermediary</span>
              <span className="stat-value">{stats.intermediaryWallets}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Warmed</span>
              <span className="stat-value">{stats.warmedWallets}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Run History</span>
              <span className="stat-value">{stats.runHistory}</span>
            </div>
          </div>
        )}
      </div>
      
      {/* Action Buttons */}
      <div className="actions-section">
        <h3>⚡ Actions</h3>
        <div className="button-grid">
          <button onClick={checkBalances} disabled={loading}>
            {loading ? '⏳ Checking...' : '💰 Check Balances'}
          </button>
          <button onClick={handleRecoverIntermediaryFunds} disabled={loading}>
            🔄 Recover Intermediary
          </button>
          <button onClick={handleGatherFunds} disabled={loading}>
            📥 Gather All Funds
          </button>
        </div>
      </div>
      
      {/* Generate Wallets */}
      <div className="generate-section">
        <h3>🔑 Generate Wallets</h3>
        <div className="button-grid">
          <button onClick={() => handleGenerateWallets('bundle', 24)}>
            + 24 Bundle Wallets
          </button>
          <button onClick={() => handleGenerateWallets('holder', 10)}>
            + 10 Holder Wallets
          </button>
          <button onClick={() => handleGenerateWallets('intermediary', 12)}>
            + Intermediary Set
          </button>
          <button onClick={() => handleGenerateWallets('warmed', 24)}>
            + 24 Warmed Wallets
          </button>
        </div>
      </div>
      
      {/* Backup/Restore */}
      <div className="backup-section">
        <h3>💾 Backup & Restore</h3>
        <p className="backup-warning">
          ⚠️ Your keys are stored only in this browser. 
          <strong> Always download backups!</strong>
        </p>
        <div className="button-grid">
          <button onClick={handleFullBackup} className="primary">
            📦 Full Backup
          </button>
          <button onClick={handleRunBackup}>
            📄 Current Run Backup
          </button>
          <button onClick={handleEmergencyBackup}>
            🆘 Emergency Backup
          </button>
          <label className="file-input-label">
            📂 Import Backup
            <input 
              type="file" 
              accept=".json" 
              onChange={handleImport}
              style={{ display: 'none' }}
            />
          </label>
        </div>
      </div>
      
      {/* Current Run */}
      {currentRun && (
        <div className="current-run-section">
          <h3>🎯 Current Run</h3>
          <div className="run-info">
            <p><strong>Run ID:</strong> {currentRun.runId}</p>
            <p><strong>Status:</strong> {currentRun.status}</p>
            {currentRun.mintAddress && (
              <p><strong>Mint:</strong> {currentRun.mintAddress}</p>
            )}
            <p><strong>Created:</strong> {new Date(currentRun.createdAt).toLocaleString()}</p>
          </div>
        </div>
      )}
      
      {/* Wallet Lists */}
      <div className="wallets-section">
        <h3>📋 Bundle Wallets ({wallets.filter(w => w.type === WALLET_TYPES.BUNDLE).length})</h3>
        <div className="wallet-list">
          {wallets
            .filter(w => w.type === WALLET_TYPES.BUNDLE)
            .slice(0, 10)
            .map((w, i) => (
              <div key={w.address} className="wallet-item">
                <span className="wallet-index">#{i + 1}</span>
                <span className="wallet-address">{w.address.slice(0, 8)}...{w.address.slice(-6)}</span>
                <span className="wallet-balance">
                  {balances[w.address] !== undefined 
                    ? `${balances[w.address].toFixed(4)} SOL` 
                    : '—'}
                </span>
              </div>
            ))}
          {wallets.filter(w => w.type === WALLET_TYPES.BUNDLE).length > 10 && (
            <div className="wallet-more">
              ...and {wallets.filter(w => w.type === WALLET_TYPES.BUNDLE).length - 10} more
            </div>
          )}
        </div>
      </div>
      
      {/* Intermediary Wallets */}
      {intermediaryWallets.length > 0 && (
        <div className="wallets-section">
          <h3>🔀 Intermediary Wallets ({intermediaryWallets.length})</h3>
          <div className="wallet-list">
            {intermediaryWallets.slice(0, 5).map((w, i) => (
              <div key={w.publicKey} className="wallet-item">
                <span className="wallet-hop">{w.hop}</span>
                <span className="wallet-address">{w.publicKey.slice(0, 8)}...{w.publicKey.slice(-6)}</span>
                <span className="wallet-balance">
                  {balances[w.publicKey] !== undefined 
                    ? `${balances[w.publicKey].toFixed(4)} SOL` 
                    : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Danger Zone */}
      <div className="danger-section">
        <h3>⚠️ Danger Zone</h3>
        <button onClick={handleClearAll} className="danger">
          🗑️ Clear All Data
        </button>
      </div>
      
      <style>{`
        .wallet-manager {
          padding: 20px;
          max-width: 800px;
          margin: 0 auto;
        }
        
        .wallet-manager h2 {
          margin-bottom: 20px;
          color: #fff;
        }
        
        .wallet-manager h3 {
          margin: 20px 0 10px;
          color: #888;
          font-size: 14px;
          text-transform: uppercase;
        }
        
        .message {
          padding: 12px 16px;
          border-radius: 8px;
          margin-bottom: 20px;
          font-weight: 500;
        }
        
        .message-info { background: #1e3a5f; color: #7dd3fc; }
        .message-success { background: #14532d; color: #86efac; }
        .message-warning { background: #713f12; color: #fde047; }
        .message-error { background: #7f1d1d; color: #fca5a5; }
        
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }
        
        .stat-item {
          background: #1a1a1a;
          padding: 12px;
          border-radius: 8px;
          text-align: center;
        }
        
        .stat-label {
          display: block;
          font-size: 11px;
          color: #666;
          margin-bottom: 4px;
        }
        
        .stat-value {
          font-size: 20px;
          font-weight: bold;
          color: #fff;
        }
        
        .button-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
        }
        
        button, .file-input-label {
          padding: 12px 16px;
          border: none;
          border-radius: 8px;
          background: #2a2a2a;
          color: #fff;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.2s;
          text-align: center;
        }
        
        button:hover, .file-input-label:hover {
          background: #3a3a3a;
        }
        
        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        button.primary {
          background: #2563eb;
        }
        
        button.primary:hover {
          background: #3b82f6;
        }
        
        button.danger {
          background: #7f1d1d;
        }
        
        button.danger:hover {
          background: #991b1b;
        }
        
        .backup-warning {
          background: #713f12;
          color: #fde047;
          padding: 10px;
          border-radius: 8px;
          font-size: 13px;
          margin-bottom: 10px;
        }
        
        .run-info {
          background: #1a1a1a;
          padding: 15px;
          border-radius: 8px;
        }
        
        .run-info p {
          margin: 5px 0;
          font-size: 13px;
        }
        
        .wallet-list {
          background: #1a1a1a;
          border-radius: 8px;
          overflow: hidden;
        }
        
        .wallet-item {
          display: flex;
          align-items: center;
          padding: 10px 15px;
          border-bottom: 1px solid #2a2a2a;
        }
        
        .wallet-item:last-child {
          border-bottom: none;
        }
        
        .wallet-index, .wallet-hop {
          width: 50px;
          font-size: 12px;
          color: #666;
        }
        
        .wallet-address {
          flex: 1;
          font-family: monospace;
          font-size: 13px;
        }
        
        .wallet-balance {
          font-family: monospace;
          color: #4ade80;
          font-size: 13px;
        }
        
        .wallet-more {
          padding: 10px;
          text-align: center;
          color: #666;
          font-size: 12px;
        }
        
        .danger-section {
          margin-top: 40px;
          padding-top: 20px;
          border-top: 1px solid #333;
        }
      `}</style>
    </div>
  );
};

export default WalletManager;
