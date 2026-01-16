/**
 * BackupReminder Component
 * 
 * Shows a reminder to backup wallets.
 * Warns user before leaving if they have unsaved data.
 */

import React, { useState, useEffect } from 'react';
import backupService from '../services/backupService';
import walletStorage from '../services/walletStorage';

const BackupReminder = () => {
  const [showReminder, setShowReminder] = useState(false);
  const [backupStatus, setBackupStatus] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check backup status
    const status = backupService.checkBackupNeeded();
    setBackupStatus(status);
    setShowReminder(status.needsBackup && !dismissed);

    // Warn before leaving page
    const handleBeforeUnload = (e) => {
      if (status.needsBackup) {
        e.preventDefault();
        e.returnValue = 'You have wallet data that may not be backed up. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [dismissed]);

  const handleBackup = () => {
    backupService.autoBackupFull();
    setDismissed(true);
    setShowReminder(false);
  };

  const handleDismiss = () => {
    setDismissed(true);
    setShowReminder(false);
  };

  if (!showReminder) return null;

  return (
    <div className="backup-reminder">
      <div className="backup-reminder-content">
        <span className="backup-icon">⚠️</span>
        <div className="backup-message">
          <strong>Backup Reminder</strong>
          <p>
            You have {backupStatus?.walletCount || 0} wallets stored in your browser.
            {backupStatus?.hasCurrentRun && ' There is also an active run.'}
          </p>
        </div>
        <div className="backup-actions">
          <button onClick={handleBackup} className="backup-btn primary">
            📦 Download Backup
          </button>
          <button onClick={handleDismiss} className="backup-btn dismiss">
            Later
          </button>
        </div>
      </div>
      
      <style>{`
        .backup-reminder {
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 1000;
          max-width: 400px;
        }
        
        .backup-reminder-content {
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          border: 1px solid #e3a008;
          border-radius: 12px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
        }
        
        .backup-icon {
          font-size: 24px;
        }
        
        .backup-message {
          flex: 1;
        }
        
        .backup-message strong {
          color: #fbbf24;
          display: block;
          margin-bottom: 4px;
        }
        
        .backup-message p {
          color: #9ca3af;
          font-size: 13px;
          margin: 0;
        }
        
        .backup-actions {
          display: flex;
          gap: 8px;
        }
        
        .backup-btn {
          padding: 8px 16px;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          transition: all 0.2s;
        }
        
        .backup-btn.primary {
          background: #2563eb;
          color: white;
        }
        
        .backup-btn.primary:hover {
          background: #3b82f6;
        }
        
        .backup-btn.dismiss {
          background: transparent;
          color: #6b7280;
          border: 1px solid #374151;
        }
        
        .backup-btn.dismiss:hover {
          background: #374151;
          color: #9ca3af;
        }
      `}</style>
    </div>
  );
};

export default BackupReminder;
