/**
 * Launch Tracker - Comprehensive tracking for launches, trades, and PnL
 * 
 * Features:
 * - Pre-launch wallet snapshots for accurate PnL
 * - Trade history with wallet classification
 * - Launch configuration history
 * - Pattern recognition data
 */

const fs = require('fs');
const path = require('path');
const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const base58 = require('bs58');

class LaunchTracker {
  constructor() {
    // Tracking data directory removed - not used in public version
    this.dataDir = null;
    
    // File paths (disabled - tracking-data not used)
    this.currentSnapshotPath = null;
    this.tradeHistoryPath = null;
    this.launchHistoryPath = null;
    
    // In-memory state
    this.currentSnapshot = null;
    this.currentTrades = [];
    
    // Load existing data
    this.loadCurrentSnapshot();
  }

  ensureDataDir() {
    // Disabled - tracking-data directory not used in public version
  }

  // Generate unique launch ID
  generateLaunchId() {
    return `launch-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  // ============================================
  // PRE-LAUNCH SNAPSHOT
  // ============================================

  /**
   * Create a pre-launch snapshot of all wallets and configuration
   */
  async createPreLaunchSnapshot(config) {
    const {
      mintAddress,
      tokenInfo,
      marketing,
      launchConfig,
      wallets, // Array of { address, type, privateKey?, isWarmed, buyAmount }
      fundingWallet,
      connection
    } = config;

    const launchId = this.generateLaunchId();
    console.log(`[LaunchTracker] 📸 Creating pre-launch snapshot: ${launchId}`);

    // Fetch SOL balances for all wallets
    const walletSnapshots = {};
    const balancePromises = [];

    for (const wallet of wallets) {
      balancePromises.push(
        this.getWalletBalance(wallet.address, connection)
          .then(balance => {
            walletSnapshots[wallet.address] = {
              type: wallet.type,
              isWarmed: wallet.isWarmed || false,
              solBefore: balance,
              buyAmount: wallet.buyAmount || 0,
              privateKeyHash: wallet.privateKey ? this.hashPrivateKey(wallet.privateKey) : null
            };
          })
          .catch(err => {
            console.warn(`[LaunchTracker] Failed to get balance for ${wallet.address.slice(0, 8)}...: ${err.message}`);
            walletSnapshots[wallet.address] = {
              type: wallet.type,
              isWarmed: wallet.isWarmed || false,
              solBefore: 0,
              buyAmount: wallet.buyAmount || 0,
              error: err.message
            };
          })
      );
    }

    // Get funding wallet balance
    let fundingBalance = 0;
    if (fundingWallet) {
      try {
        fundingBalance = await this.getWalletBalance(fundingWallet.address, connection);
      } catch (err) {
        console.warn(`[LaunchTracker] Failed to get funding wallet balance: ${err.message}`);
      }
    }

    await Promise.all(balancePromises);

    // Create snapshot
    this.currentSnapshot = {
      launchId,
      timestamp: new Date().toISOString(),
      timestampMs: Date.now(),
      mintAddress,
      tokenInfo: {
        name: tokenInfo?.name || '',
        symbol: tokenInfo?.symbol || '',
        description: tokenInfo?.description || '',
        image: tokenInfo?.image || ''
      },
      marketing: {
        website: marketing?.website || '',
        twitter: marketing?.twitter || '',
        telegram: marketing?.telegram || ''
      },
      launchConfig: {
        devBuyAmount: launchConfig?.devBuyAmount || 0,
        bundleWalletCount: launchConfig?.bundleWalletCount || 0,
        holderWalletCount: launchConfig?.holderWalletCount || 0,
        useWarmedWallets: launchConfig?.useWarmedWallets || false,
        frontRunThreshold: launchConfig?.frontRunThreshold || 0,
        priorityFee: launchConfig?.priorityFee || 'low',
        useNormalLaunch: launchConfig?.useNormalLaunch || false,
        autoHolderWalletBuy: launchConfig?.autoHolderWalletBuy || false,
        jitoFee: launchConfig?.jitoFee || 0
      },
      walletSnapshots,
      fundingWallet: fundingWallet ? {
        address: fundingWallet.address,
        solBefore: fundingBalance
      } : null,
      status: 'PENDING', // PENDING, LAUNCHED, COMPLETED, FAILED
      trades: [],
      pnl: null
    };

    // Save snapshot
    this.saveCurrentSnapshot();

    console.log(`[LaunchTracker] ✅ Snapshot created with ${Object.keys(walletSnapshots).length} wallets`);
    console.log(`[LaunchTracker]    Total SOL before: ${Object.values(walletSnapshots).reduce((sum, w) => sum + w.solBefore, 0).toFixed(4)}`);

    return this.currentSnapshot;
  }

  /**
   * Update snapshot status after launch
   */
  updateSnapshotStatus(status, mintAddress) {
    if (this.currentSnapshot) {
      this.currentSnapshot.status = status;
      if (mintAddress) {
        this.currentSnapshot.mintAddress = mintAddress;
      }
      this.saveCurrentSnapshot();
      console.log(`[LaunchTracker] 📝 Status updated: ${status}`);
    }
  }

  // ============================================
  // TRADE TRACKING
  // ============================================

  /**
   * Record a trade
   */
  recordTrade(trade) {
    if (!this.currentSnapshot) {
      console.warn('[LaunchTracker] No active snapshot, cannot record trade');
      return;
    }

    const tradeRecord = {
      timestamp: trade.timestamp || Date.now(),
      signature: trade.signature || '',
      type: trade.type, // 'buy' or 'sell'
      trader: trade.trader || trade.fullTrader || '',
      isOurWallet: trade.isOurWallet || false,
      walletType: trade.walletType || null,
      solAmount: trade.solAmount || 0,
      tokenAmount: trade.tokenAmount || 0,
      marketCap: trade.marketCap || 0,
      usdValue: trade.usdValue || 0
    };

    this.currentSnapshot.trades.push(tradeRecord);
    this.currentTrades.push(tradeRecord);

    // Save periodically (every 10 trades)
    if (this.currentSnapshot.trades.length % 10 === 0) {
      this.saveCurrentSnapshot();
    }

    return tradeRecord;
  }

  /**
   * Get trade statistics
   */
  getTradeStats() {
    if (!this.currentSnapshot) return null;

    const trades = this.currentSnapshot.trades;
    const ourTrades = trades.filter(t => t.isOurWallet);
    const externalTrades = trades.filter(t => !t.isOurWallet);

    const stats = {
      totalTrades: trades.length,
      ourTrades: ourTrades.length,
      externalTrades: externalTrades.length,
      ourBuys: ourTrades.filter(t => t.type === 'buy').reduce((sum, t) => sum + t.solAmount, 0),
      ourSells: ourTrades.filter(t => t.type === 'sell').reduce((sum, t) => sum + t.solAmount, 0),
      externalBuys: externalTrades.filter(t => t.type === 'buy').reduce((sum, t) => sum + t.solAmount, 0),
      externalSells: externalTrades.filter(t => t.type === 'sell').reduce((sum, t) => sum + t.solAmount, 0),
      peakMarketCap: Math.max(...trades.map(t => t.marketCap || 0), 0),
      uniqueTraders: new Set(externalTrades.map(t => t.trader)).size
    };

    stats.externalNet = stats.externalBuys - stats.externalSells;
    stats.ourNet = stats.ourSells - stats.ourBuys; // Positive = profit

    return stats;
  }

  // ============================================
  // PNL CALCULATION
  // ============================================

  /**
   * Calculate PnL for the current launch
   */
  async calculatePnL(connection) {
    if (!this.currentSnapshot) {
      console.warn('[LaunchTracker] No active snapshot for PnL calculation');
      return null;
    }

    console.log(`[LaunchTracker] 💰 Calculating PnL...`);

    const pnl = {
      timestamp: Date.now(),
      wallets: {},
      summary: {
        totalSolBefore: 0,
        totalSolAfter: 0,
        totalSolSpent: 0,
        totalSolRecovered: 0,
        netPnlSol: 0,
        fundingWalletChange: 0
      }
    };

    // Calculate for each wallet
    for (const [address, snapshot] of Object.entries(this.currentSnapshot.walletSnapshots)) {
      try {
        const solAfter = await this.getWalletBalance(address, connection);
        const solBefore = snapshot.solBefore || 0;
        const solChange = solAfter - solBefore;

        pnl.wallets[address] = {
          type: snapshot.type,
          isWarmed: snapshot.isWarmed,
          solBefore,
          solAfter,
          solChange,
          buyAmount: snapshot.buyAmount || 0
        };

        pnl.summary.totalSolBefore += solBefore;
        pnl.summary.totalSolAfter += solAfter;

        if (solChange < 0) {
          pnl.summary.totalSolSpent += Math.abs(solChange);
        } else {
          pnl.summary.totalSolRecovered += solChange;
        }
      } catch (err) {
        console.warn(`[LaunchTracker] Failed to get current balance for ${address.slice(0, 8)}...: ${err.message}`);
        pnl.wallets[address] = {
          type: snapshot.type,
          isWarmed: snapshot.isWarmed,
          solBefore: snapshot.solBefore || 0,
          solAfter: null,
          solChange: null,
          error: err.message
        };
      }
    }

    // Funding wallet
    if (this.currentSnapshot.fundingWallet) {
      try {
        const fundingAfter = await this.getWalletBalance(
          this.currentSnapshot.fundingWallet.address,
          connection
        );
        const fundingBefore = this.currentSnapshot.fundingWallet.solBefore || 0;
        pnl.summary.fundingWalletChange = fundingAfter - fundingBefore;
        pnl.summary.fundingWalletBefore = fundingBefore;
        pnl.summary.fundingWalletAfter = fundingAfter;
      } catch (err) {
        console.warn(`[LaunchTracker] Failed to get funding wallet balance: ${err.message}`);
      }
    }

    // Net PnL = total SOL recovered - total SOL spent (excluding funding)
    // Or simply: total SOL after - total SOL before
    pnl.summary.netPnlSol = pnl.summary.totalSolAfter - pnl.summary.totalSolBefore;
    
    // Include funding wallet in total
    if (pnl.summary.fundingWalletChange !== undefined) {
      pnl.summary.totalPnlIncludingFunding = pnl.summary.netPnlSol + pnl.summary.fundingWalletChange;
    }

    this.currentSnapshot.pnl = pnl;
    this.saveCurrentSnapshot();

    console.log(`[LaunchTracker] ✅ PnL calculated:`);
    console.log(`[LaunchTracker]    Total SOL before: ${pnl.summary.totalSolBefore.toFixed(4)}`);
    console.log(`[LaunchTracker]    Total SOL after: ${pnl.summary.totalSolAfter.toFixed(4)}`);
    console.log(`[LaunchTracker]    Net PnL: ${pnl.summary.netPnlSol >= 0 ? '+' : ''}${pnl.summary.netPnlSol.toFixed(4)} SOL`);

    return pnl;
  }

  // ============================================
  // LAUNCH HISTORY
  // ============================================

  /**
   * Complete the current launch and save to history
   */
  async completeLaunch(connection) {
    if (!this.currentSnapshot) {
      console.warn('[LaunchTracker] No active snapshot to complete');
      return null;
    }

    console.log(`[LaunchTracker] 📊 Completing launch and saving to history...`);

    // Calculate final PnL
    const pnl = await this.calculatePnL(connection);

    // Get trade stats
    const stats = this.getTradeStats();

    // Mark as completed
    this.currentSnapshot.status = 'COMPLETED';
    this.currentSnapshot.completedAt = new Date().toISOString();
    this.currentSnapshot.stats = stats;

    // Disabled - tracking-data not used in public version
    console.log(`[LaunchTracker] ✅ Launch completed (tracking-data disabled)`);

    // Clear current snapshot
    const completedSnapshot = this.currentSnapshot;
    this.currentSnapshot = null;
    this.currentTrades = [];

    return completedSnapshot;
  }

  /**
   * Save trades to history file
   */
  saveTradeHistory() {
    // Disabled - tracking-data not used in public version
    if (this.currentSnapshot && this.currentSnapshot.trades.length > 0) {
      console.log(`[LaunchTracker] 💾 Trade recorded (tracking-data disabled)`);
    }
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  async getWalletBalance(address, connection) {
    try {
      const pubkey = new PublicKey(address);
      const balance = await connection.getBalance(pubkey);
      return balance / 1e9; // Convert lamports to SOL
    } catch (err) {
      throw new Error(`Failed to get balance: ${err.message}`);
    }
  }

  hashPrivateKey(privateKey) {
    // Create a simple hash of the private key for verification without storing it
    // This helps identify if the same wallet was used across launches
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(privateKey).digest('hex').slice(0, 16);
  }

  saveCurrentSnapshot() {
    // Disabled - tracking-data not used in public version
  }

  loadCurrentSnapshot() {
    // Disabled - tracking-data not used in public version
  }

  // ============================================
  // API METHODS
  // ============================================

  getCurrentSnapshot() {
    return this.currentSnapshot;
  }

  getLaunchHistory(limit = 10) {
    // Disabled - tracking-data not used in public version
    return [];
  }

  getTradeHistory(launchId) {
    // Disabled - tracking-data not used in public version
    return null;
  }

  /**
   * Get aggregated stats across all launches (for pattern recognition)
   */
  getAggregatedStats() {
    const history = this.getLaunchHistory(1000); // Get all
    
    if (history.length === 0) return null;

    const stats = {
      totalLaunches: history.length,
      successfulLaunches: history.filter(h => h.status === 'COMPLETED').length,
      totalPnl: 0,
      avgPnl: 0,
      bestLaunch: null,
      worstLaunch: null,
      avgExternalBuys: 0,
      avgExternalSells: 0,
      avgUniqueTraders: 0,
      launchTimes: {} // Hour -> count mapping
    };

    let totalExternalBuys = 0;
    let totalExternalSells = 0;
    let totalUniqueTraders = 0;
    let launchesWithStats = 0;

    for (const launch of history) {
      // PnL
      if (launch.pnl?.summary?.netPnlSol !== undefined) {
        stats.totalPnl += launch.pnl.summary.netPnlSol;
        
        if (!stats.bestLaunch || launch.pnl.summary.netPnlSol > stats.bestLaunch.pnl) {
          stats.bestLaunch = {
            launchId: launch.launchId,
            mintAddress: launch.mintAddress,
            pnl: launch.pnl.summary.netPnlSol,
            timestamp: launch.timestamp
          };
        }
        
        if (!stats.worstLaunch || launch.pnl.summary.netPnlSol < stats.worstLaunch.pnl) {
          stats.worstLaunch = {
            launchId: launch.launchId,
            mintAddress: launch.mintAddress,
            pnl: launch.pnl.summary.netPnlSol,
            timestamp: launch.timestamp
          };
        }
      }

      // Trade stats
      if (launch.stats) {
        totalExternalBuys += launch.stats.externalBuys || 0;
        totalExternalSells += launch.stats.externalSells || 0;
        totalUniqueTraders += launch.stats.uniqueTraders || 0;
        launchesWithStats++;
      }

      // Launch time distribution
      const launchHour = new Date(launch.timestamp).getHours();
      stats.launchTimes[launchHour] = (stats.launchTimes[launchHour] || 0) + 1;
    }

    stats.avgPnl = history.length > 0 ? stats.totalPnl / history.length : 0;
    
    if (launchesWithStats > 0) {
      stats.avgExternalBuys = totalExternalBuys / launchesWithStats;
      stats.avgExternalSells = totalExternalSells / launchesWithStats;
      stats.avgUniqueTraders = totalUniqueTraders / launchesWithStats;
    }

    return stats;
  }
}

// Singleton instance
let launchTrackerInstance = null;

function getLaunchTracker() {
  if (!launchTrackerInstance) {
    launchTrackerInstance = new LaunchTracker();
  }
  return launchTrackerInstance;
}

module.exports = {
  LaunchTracker,
  getLaunchTracker
};
