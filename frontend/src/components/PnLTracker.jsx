import { useState, useEffect } from 'react';
import { apiService } from '../services/api';

/**
 * PnL Tracker Component
 * Displays real-time PnL for the current launch and launch history
 */
const PnLTracker = ({ mintAddress, isExpanded = false, onToggle }) => {
  const [snapshot, setSnapshot] = useState(null);
  const [pnl, setPnl] = useState(null);
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState([]);
  const [aggregatedStats, setAggregatedStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  
  // Load current snapshot and stats
  const loadCurrentData = async () => {
    try {
      const [snapshotRes, statsRes] = await Promise.all([
        apiService.getLaunchTrackerCurrent(),
        apiService.getLaunchTrackerStats()
      ]);
      
      if (snapshotRes.data?.success) {
        setSnapshot(snapshotRes.data.snapshot);
        if (snapshotRes.data.snapshot?.pnl) {
          setPnl(snapshotRes.data.snapshot.pnl);
        }
      }
      
      if (statsRes.data?.success) {
        setStats(statsRes.data.stats);
      }
    } catch (err) {
      console.error('[PnL] Error loading data:', err);
    }
  };
  
  // Calculate PnL
  const handleCalculatePnL = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiService.calculatePnL();
      if (res.data?.success) {
        setPnl(res.data.pnl);
        // Reload snapshot to get updated data
        loadCurrentData();
      } else {
        setError(res.data?.error || 'Failed to calculate PnL');
      }
    } catch (err) {
      setError(err.message || 'Failed to calculate PnL');
    }
    setLoading(false);
  };
  
  // Complete launch and save to history
  const handleCompleteLaunch = async () => {
    if (!confirm('Complete this launch and save to history? This will clear the current tracking data.')) {
      return;
    }
    
    setLoading(true);
    setError(null);
    try {
      const res = await apiService.completeLaunch();
      if (res.data?.success) {
        setSnapshot(null);
        setPnl(null);
        setStats(null);
        // Reload history
        loadHistory();
      } else {
        setError(res.data?.error || 'Failed to complete launch');
      }
    } catch (err) {
      setError(err.message || 'Failed to complete launch');
    }
    setLoading(false);
  };
  
  // Load history
  const loadHistory = async () => {
    try {
      const [historyRes, aggRes] = await Promise.all([
        apiService.getLaunchHistory(10),
        apiService.getAggregatedStats()
      ]);
      
      if (historyRes.data?.success) {
        setHistory(historyRes.data.history || []);
      }
      
      if (aggRes.data?.success) {
        setAggregatedStats(aggRes.data.stats);
      }
    } catch (err) {
      console.error('[PnL] Error loading history:', err);
    }
  };
  
  // Auto-load on mount and when mintAddress changes
  useEffect(() => {
    loadCurrentData();
    loadHistory();
    
    // Refresh every 30 seconds
    const interval = setInterval(loadCurrentData, 30000);
    return () => clearInterval(interval);
  }, [mintAddress]);
  
  // Format SOL with color
  const formatSol = (amount, showSign = true) => {
    if (amount === null || amount === undefined) return '-';
    const formatted = Math.abs(amount).toFixed(4);
    const sign = amount >= 0 ? '+' : '-';
    const color = amount >= 0 ? 'text-green-400' : 'text-red-400';
    return (
      <span className={color}>
        {showSign ? sign : ''}{formatted} SOL
      </span>
    );
  };
  
  // Compact view
  if (!isExpanded) {
    return (
      <div 
        className="bg-gray-900/80 border border-gray-800 rounded-lg p-2 cursor-pointer hover:bg-gray-800/80 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">📊</span>
            <span className="text-sm font-medium text-gray-300">PnL</span>
          </div>
          {pnl?.summary?.netPnlSol !== undefined ? (
            <div className="text-sm font-mono">
              {formatSol(pnl.summary.netPnlSol)}
            </div>
          ) : snapshot ? (
            <button 
              onClick={(e) => { e.stopPropagation(); handleCalculatePnL(); }}
              className="text-xs bg-blue-600 hover:bg-blue-500 px-2 py-0.5 rounded"
              disabled={loading}
            >
              {loading ? '...' : 'Calculate'}
            </button>
          ) : (
            <span className="text-xs text-gray-500">No launch</span>
          )}
          <span className="text-gray-500">▶</span>
        </div>
      </div>
    );
  }
  
  return (
    <div className="bg-gray-900/90 border border-gray-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div 
        className="flex items-center justify-between p-3 bg-gray-800/50 cursor-pointer hover:bg-gray-800/80"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2">
          <span className="text-xl">📊</span>
          <span className="font-semibold text-white">PnL Tracker</span>
        </div>
        <span className="text-gray-400">▼</span>
      </div>
      
      {/* Content */}
      <div className="p-3 space-y-3">
        {error && (
          <div className="text-red-400 text-sm bg-red-900/20 p-2 rounded">
            {error}
          </div>
        )}
        
        {/* Current Launch */}
        {snapshot ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Current Launch</span>
              <span className="text-xs text-gray-500">{snapshot.launchId?.slice(0, 20)}...</span>
            </div>
            
            {/* Token Info */}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-400">Token:</span>
              <span className="text-white font-medium">{snapshot.tokenInfo?.name || 'Unknown'}</span>
              <span className="text-gray-500">({snapshot.tokenInfo?.symbol})</span>
            </div>
            
            {/* Wallet Stats */}
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="bg-gray-800/50 p-2 rounded text-center">
                <div className="text-gray-500">Wallets</div>
                <div className="text-white font-medium">{Object.keys(snapshot.walletSnapshots || {}).length}</div>
              </div>
              <div className="bg-gray-800/50 p-2 rounded text-center">
                <div className="text-gray-500">SOL Before</div>
                <div className="text-white font-medium">
                  {Object.values(snapshot.walletSnapshots || {}).reduce((sum, w) => sum + (w.solBefore || 0), 0).toFixed(3)}
                </div>
              </div>
              <div className="bg-gray-800/50 p-2 rounded text-center">
                <div className="text-gray-500">Status</div>
                <div className={`font-medium ${snapshot.status === 'COMPLETED' ? 'text-green-400' : 'text-yellow-400'}`}>
                  {snapshot.status}
                </div>
              </div>
            </div>
            
            {/* PnL Summary */}
            {pnl ? (
              <div className="bg-gray-800/30 p-3 rounded-lg space-y-2">
                <div className="text-sm font-medium text-gray-300">PnL Summary</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-gray-500">SOL Before:</span>
                    <span className="ml-2 text-white">{pnl.summary?.totalSolBefore?.toFixed(4)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">SOL After:</span>
                    <span className="ml-2 text-white">{pnl.summary?.totalSolAfter?.toFixed(4)}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-gray-700">
                  <span className="text-sm text-gray-300">Net PnL:</span>
                  <span className="text-lg font-bold font-mono">
                    {formatSol(pnl.summary?.netPnlSol)}
                  </span>
                </div>
                {pnl.summary?.fundingWalletChange !== undefined && (
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>Funding wallet change:</span>
                    {formatSol(pnl.summary.fundingWalletChange)}
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={handleCalculatePnL}
                disabled={loading}
                className="w-full py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium disabled:opacity-50"
              >
                {loading ? 'Calculating...' : '💰 Calculate PnL'}
              </button>
            )}
            
            {/* Trade Stats */}
            {stats && (
              <div className="text-xs grid grid-cols-2 gap-2">
                <div className="bg-gray-800/30 p-2 rounded">
                  <span className="text-gray-500">Our trades:</span>
                  <span className="ml-2 text-white">{stats.ourTrades}</span>
                </div>
                <div className="bg-gray-800/30 p-2 rounded">
                  <span className="text-gray-500">External:</span>
                  <span className="ml-2 text-white">{stats.externalTrades}</span>
                </div>
                <div className="bg-gray-800/30 p-2 rounded">
                  <span className="text-gray-500">Ext. buys:</span>
                  <span className="ml-2 text-green-400">{stats.externalBuys?.toFixed(2)} SOL</span>
                </div>
                <div className="bg-gray-800/30 p-2 rounded">
                  <span className="text-gray-500">Ext. sells:</span>
                  <span className="ml-2 text-red-400">{stats.externalSells?.toFixed(2)} SOL</span>
                </div>
              </div>
            )}
            
            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleCalculatePnL}
                disabled={loading}
                className="flex-1 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs disabled:opacity-50"
              >
                🔄 Refresh PnL
              </button>
              <button
                onClick={handleCompleteLaunch}
                disabled={loading}
                className="flex-1 py-1.5 bg-green-700 hover:bg-green-600 rounded text-xs disabled:opacity-50"
              >
                ✅ Complete & Save
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-4 text-gray-500">
            <div className="text-2xl mb-2">📈</div>
            <div>No active launch</div>
            <div className="text-xs mt-1">Launch a token to start tracking</div>
          </div>
        )}
        
        {/* Toggle History */}
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="w-full py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-400"
        >
          {showHistory ? '▲ Hide History' : '▼ Show History'} ({history.length} launches)
        </button>
        
        {/* History */}
        {showHistory && (
          <div className="space-y-2">
            {/* Aggregated Stats */}
            {aggregatedStats && (
              <div className="bg-gray-800/30 p-2 rounded text-xs">
                <div className="font-medium text-gray-300 mb-1">Overall Stats</div>
                <div className="grid grid-cols-3 gap-1">
                  <div>
                    <span className="text-gray-500">Launches:</span>
                    <span className="ml-1 text-white">{aggregatedStats.totalLaunches}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Total PnL:</span>
                    <span className="ml-1">{formatSol(aggregatedStats.totalPnl, true)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Avg PnL:</span>
                    <span className="ml-1">{formatSol(aggregatedStats.avgPnl, true)}</span>
                  </div>
                </div>
              </div>
            )}
            
            {/* Launch List */}
            <div className="max-h-48 overflow-y-auto space-y-1">
              {history.length === 0 ? (
                <div className="text-center text-gray-500 text-xs py-2">No launch history yet</div>
              ) : (
                history.slice().reverse().map((launch, idx) => (
                  <div 
                    key={launch.launchId}
                    className="bg-gray-800/30 p-2 rounded text-xs flex items-center justify-between"
                  >
                    <div>
                      <span className="text-white font-medium">{launch.tokenInfo?.symbol || 'Unknown'}</span>
                      <span className="text-gray-500 ml-2">
                        {new Date(launch.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="font-mono">
                      {launch.pnl?.summary?.netPnlSol !== undefined 
                        ? formatSol(launch.pnl.summary.netPnlSol)
                        : <span className="text-gray-500">-</span>
                      }
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PnLTracker;
