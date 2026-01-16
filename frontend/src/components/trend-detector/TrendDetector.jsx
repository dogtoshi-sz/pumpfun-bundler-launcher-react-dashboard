import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ChartBarIcon,
  ArrowTrendingUpIcon,
  Cog6ToothIcon,
  ArrowPathIcon,
  RocketLaunchIcon,
  ClipboardDocumentIcon,
  FunnelIcon,
  PlayIcon,
  StopIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XCircleIcon,
  ServerIcon,
  CommandLineIcon,
  SparklesIcon,
  LightBulbIcon,
  FireIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline';
import CandidateTable from './CandidateTable';
import TrendConfig from './TrendConfig';
import TokenProfile from './TokenProfile';
import RapidLaunchModal from './RapidLaunchModal';

// Trend Detector runs as a separate service on port 3003
const TREND_API_BASE = 'http://localhost:3003';

export default function TrendDetector({ onCopyToLauncher }) {
  // State
  const [candidates, setCandidates] = useState([]);
  const [allTokens, setAllTokens] = useState([]);
  const [stats, setStats] = useState(null);
  const [heuristics, setHeuristics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [selectedToken, setSelectedToken] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [serviceAvailable, setServiceAvailable] = useState(null); // null = checking, true/false = result
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [lastAiUpdate, setLastAiUpdate] = useState(null);
  const [rapidLaunchToken, setRapidLaunchToken] = useState(null); // Token to rapid launch
  
  // SSE connection ref
  const eventSourceRef = useRef(null);

  // Check if service is running
  const checkService = useCallback(async () => {
    try {
      const res = await fetch(`${TREND_API_BASE}/health`, { 
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      const data = await res.json();
      setServiceAvailable(data.status === 'ok');
      return data.status === 'ok';
    } catch {
      setServiceAvailable(false);
      return false;
    }
  }, []);

  // Fetch initial data
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      
      // First check if service is available
      const available = await checkService();
      if (!available) {
        setError('Trend Detector service not running');
        setLoading(false);
        return;
      }
      
      const [candidatesRes, statsRes, heuristicsRes] = await Promise.all([
        fetch(`${TREND_API_BASE}/api/candidates`),
        fetch(`${TREND_API_BASE}/api/stats`),
        fetch(`${TREND_API_BASE}/api/heuristics`),
      ]);
      
      const candidatesData = await candidatesRes.json();
      const statsData = await statsRes.json();
      const heuristicsData = await heuristicsRes.json();
      
      if (candidatesData.success) setCandidates(candidatesData.candidates || []);
      if (statsData.success) setStats(statsData.stats);
      if (heuristicsData.success) setHeuristics(heuristicsData.heuristics);
      
      setError(null);
    } catch (err) {
      setError('Failed to connect to trend detector');
      console.error('[TrendDetector] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [checkService]);

  // Connect to SSE stream
  const connectStream = useCallback(() => {
    if (!serviceAvailable) return;
    
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    
    const es = new EventSource(`${TREND_API_BASE}/api/stream`);
    
    es.onopen = () => {
      setIsConnected(true);
      setError(null);
    };
    
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
          case 'init':
            setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
            setStats(data.stats);
            break;
          case 'candidatesUpdated':
            setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
            break;
          case 'tokenTracked':
          case 'tokenDropped':
          case 'aliveGatePassed':
            // Refresh full list
            fetch(`${TREND_API_BASE}/api/tokens`)
              .then(r => r.json())
              .then(d => d.success && setAllTokens(d.tokens || []));
            break;
          case 'aiAnalysis':
            if (data.analysis) {
              setAiAnalysis(data.analysis);
              setLastAiUpdate(new Date());
            }
            break;
          default:
            break;
        }
      } catch (e) {
        console.error('[TrendDetector] SSE parse error:', e);
      }
    };
    
    es.onerror = () => {
      setIsConnected(false);
      setError('Stream disconnected - reconnecting...');
      setTimeout(() => connectStream(), 3000);
    };
    
    eventSourceRef.current = es;
  }, [serviceAvailable]);

  // Initialize
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Connect stream when service becomes available
  useEffect(() => {
    if (serviceAvailable) {
      connectStream();
    }
    
    // Cleanup
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [serviceAvailable, connectStream]);

  // Periodic refresh of all tokens
  useEffect(() => {
    if (!serviceAvailable) return;
    
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${TREND_API_BASE}/api/tokens`);
        const data = await res.json();
        if (data.success) setAllTokens(data.tokens || []);
      } catch (e) {
        // Ignore
      }
    }, 5000);
    
    return () => clearInterval(interval);
  }, [serviceAvailable]);

  // Fetch AI analysis on load and periodically
  useEffect(() => {
    if (!serviceAvailable) return;
    
    const fetchAiAnalysis = async () => {
      try {
        const res = await fetch(`${TREND_API_BASE}/api/ai/analysis`);
        const data = await res.json();
        if (data.success && data.analysis) {
          setAiAnalysis(data.analysis);
          setLastAiUpdate(new Date());
        }
      } catch (e) {
        // Ignore - AI might not be enabled
      }
    };
    
    // Fetch immediately
    fetchAiAnalysis();
    
    // Fetch every 20 seconds
    const interval = setInterval(fetchAiAnalysis, 20000);
    
    return () => clearInterval(interval);
  }, [serviceAvailable]);

  // Force AI analysis
  const handleForceAiAnalysis = async () => {
    setAiLoading(true);
    try {
      const res = await fetch(`${TREND_API_BASE}/api/ai/analyze`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.analysis) {
        setAiAnalysis(data.analysis);
        setLastAiUpdate(new Date());
      }
    } catch (e) {
      console.error('[TrendDetector] AI analysis error:', e);
    } finally {
      setAiLoading(false);
    }
  };

  // Update heuristics
  const handleUpdateHeuristics = async (updates) => {
    try {
      const res = await fetch(`${TREND_API_BASE}/api/heuristics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.success) {
        setHeuristics(data.heuristics);
      }
    } catch (err) {
      console.error('[TrendDetector] Update heuristics error:', err);
    }
  };

  // Reset heuristics
  const handleResetHeuristics = async () => {
    try {
      const res = await fetch(`${TREND_API_BASE}/api/heuristics/reset`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        setHeuristics(data.heuristics);
      }
    } catch (err) {
      console.error('[TrendDetector] Reset heuristics error:', err);
    }
  };

  // Copy token to launcher - this just copies the data locally, no API needed
  const handleCopyToLauncher = (token) => {
    if (onCopyToLauncher && token) {
      // Create suggestion from token data
      const variations = ['Super', 'Ultra', 'Mega', 'Hyper', 'Epic', 'Based', 'Degen'];
      const prefix = variations[Math.floor(Math.random() * variations.length)];
      
      const suggestion = {
        name: `${prefix} ${token.name}`.slice(0, 32),
        symbol: token.symbol?.slice(0, 8),
        description: `Inspired by ${token.symbol} momentum - ${token.score}/100 score`,
        imageUrl: token.imageUrl || null,
        originalMint: token.mint,
        originalScore: token.score,
      };
      onCopyToLauncher(suggestion);
    }
  };

  // Format uptime
  const formatUptime = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-lg">
            <ArrowTrendingUpIcon className="w-6 h-6 text-purple-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Trend Detector</h2>
            <p className="text-sm text-gray-400">
              Real-time pump.fun token monitoring with momentum scoring
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Connection status */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${
            isConnected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
          }`}>
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            {isConnected ? 'Live' : 'Disconnected'}
          </div>
          
          {/* Config button */}
          <button
            onClick={() => setShowConfig(!showConfig)}
            className={`p-2 rounded-lg transition-colors ${
              showConfig ? 'bg-purple-500/30 text-purple-400' : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}
            title="Configure Heuristics"
          >
            <Cog6ToothIcon className="w-5 h-5" />
          </button>
          
          {/* Refresh button */}
          <button
            onClick={fetchData}
            className="p-2 bg-gray-800 text-gray-400 hover:text-white rounded-lg transition-colors"
            title="Refresh"
          >
            <ArrowPathIcon className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Service Not Running - Show setup instructions */}
      {serviceAvailable === false && (
        <div className="p-6 bg-gray-900/80 border border-purple-500/30 rounded-xl">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-purple-500/20 rounded-lg">
              <ServerIcon className="w-8 h-8 text-purple-400" />
            </div>
            <div className="flex-grow">
              <h3 className="text-lg font-semibold text-white mb-2">Trend Detector Service Not Running</h3>
              <p className="text-gray-400 mb-4">
                The Trend Detector runs as a separate service to keep your bundler lightweight.
                Start it in a new terminal to enable trend tracking:
              </p>
              
              <div className="bg-gray-800 rounded-lg p-4 font-mono text-sm mb-4">
                <div className="flex items-center gap-2 text-gray-400 mb-2">
                  <CommandLineIcon className="w-4 h-4" />
                  <span>Terminal</span>
                </div>
                <code className="text-green-400">cd features/trends && npm install && npm run dev</code>
              </div>
              
              <div className="flex items-center gap-3">
                <button
                  onClick={fetchData}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors flex items-center gap-2"
                >
                  <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                  Check Connection
                </button>
                <span className="text-sm text-gray-500">
                  Service runs on http://localhost:3003
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error message (for other errors when service is running) */}
      {error && serviceAvailable && (
        <div className="p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 flex items-center gap-2">
          <ExclamationTriangleIcon className="w-5 h-5" />
          {error}
        </div>
      )}

      {/* Stats bar - only show when service is available */}
      {stats && serviceAvailable && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="p-4 bg-gray-900/50 rounded-lg border border-gray-800">
            <p className="text-xs text-gray-500 uppercase">Tracking</p>
            <p className="text-2xl font-bold text-white">{stats.currentlyTracking}</p>
          </div>
          <div className="p-4 bg-gray-900/50 rounded-lg border border-gray-800">
            <p className="text-xs text-gray-500 uppercase">Candidates</p>
            <p className="text-2xl font-bold text-green-400">{stats.currentCandidates}</p>
          </div>
          <div className="p-4 bg-gray-900/50 rounded-lg border border-gray-800">
            <p className="text-xs text-gray-500 uppercase">Total Tracked</p>
            <p className="text-2xl font-bold text-purple-400">{stats.totalTracked}</p>
          </div>
          <div className="p-4 bg-gray-900/50 rounded-lg border border-gray-800">
            <p className="text-xs text-gray-500 uppercase">Dropped</p>
            <p className="text-2xl font-bold text-red-400">{stats.totalDropped}</p>
          </div>
          <div className="p-4 bg-gray-900/50 rounded-lg border border-gray-800">
            <p className="text-xs text-gray-500 uppercase">Uptime</p>
            <p className="text-2xl font-bold text-gray-300">{formatUptime(stats.uptimeMs)}</p>
          </div>
        </div>
      )}

      {/* AI Trend Analysis Box */}
      {serviceAvailable && (
        <div className="bg-gradient-to-r from-purple-900/30 to-pink-900/30 rounded-lg border border-purple-500/30 overflow-hidden">
          <div className="p-4 border-b border-purple-500/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SparklesIcon className="w-5 h-5 text-purple-400" />
              <h3 className="font-semibold text-white">AI Trend Analysis</h3>
              {lastAiUpdate && (
                <span className="text-xs text-gray-500">
                  Updated {Math.floor((Date.now() - lastAiUpdate.getTime()) / 1000)}s ago
                </span>
              )}
            </div>
            <button
              onClick={handleForceAiAnalysis}
              disabled={aiLoading}
              className="px-3 py-1 bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 rounded-lg text-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <ArrowPathIcon className={`w-4 h-4 ${aiLoading ? 'animate-spin' : ''}`} />
              Analyze Now
            </button>
          </div>
          
          {aiAnalysis ? (
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Narratives */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-purple-300">
                  <LightBulbIcon className="w-4 h-4" />
                  Narratives
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {aiAnalysis.narratives?.slice(0, 5).map((narrative, i) => (
                    <span key={i} className="px-2 py-0.5 bg-purple-500/20 text-purple-300 text-xs rounded-full">
                      {narrative}
                    </span>
                  )) || <span className="text-gray-500 text-sm">No narratives detected</span>}
                </div>
              </div>
              
              {/* Hot Patterns */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-orange-300">
                  <FireIcon className="w-4 h-4" />
                  Hot Patterns
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {aiAnalysis.hotPatterns?.slice(0, 4).map((pattern, i) => (
                    <span key={i} className="px-2 py-0.5 bg-orange-500/20 text-orange-300 text-xs rounded-full">
                      {pattern}
                    </span>
                  )) || <span className="text-gray-500 text-sm">No patterns detected</span>}
                </div>
              </div>
              
              {/* Top Picks */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-green-300">
                  <ArrowTrendingUpIcon className="w-4 h-4" />
                  Top Picks
                </div>
                <div className="space-y-1">
                  {aiAnalysis.topPicks?.slice(0, 3).map((pick, i) => (
                    <div key={i} className="text-sm">
                      <span className="text-green-400 font-medium">{pick.symbol || pick}</span>
                      {pick.reason && <span className="text-gray-400 text-xs ml-1.5">- {pick.reason}</span>}
                    </div>
                  )) || <span className="text-gray-500 text-sm">No picks yet</span>}
                </div>
              </div>
              
              {/* Warnings */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-red-300">
                  <ExclamationCircleIcon className="w-4 h-4" />
                  Warnings
                </div>
                <div className="space-y-1">
                  {aiAnalysis.warnings?.slice(0, 3).map((warning, i) => (
                    <div key={i} className="text-xs text-red-400/80">
                      {warning}
                    </div>
                  )) || <span className="text-gray-500 text-sm">No warnings</span>}
                </div>
              </div>
              
              {/* Meta Insight - Full width */}
              {aiAnalysis.metaInsight && (
                <div className="md:col-span-2 lg:col-span-4 pt-3 border-t border-purple-500/20">
                  <p className="text-sm text-gray-300 italic">
                    💡 {aiAnalysis.metaInsight}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="p-6 text-center text-gray-500">
              <SparklesIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>AI analysis loading...</p>
              <p className="text-xs mt-1">Analysis updates every 20 seconds</p>
            </div>
          )}
        </div>
      )}

      {/* Config panel (collapsible) */}
      {showConfig && heuristics && (
        <TrendConfig
          heuristics={heuristics}
          onUpdate={handleUpdateHeuristics}
          onReset={handleResetHeuristics}
        />
      )}

      {/* Main content area - responsive grid when token selected */}
      <div className={`grid gap-6 ${selectedToken ? 'lg:grid-cols-3' : 'grid-cols-1'}`}>
        {/* Candidates table */}
        <div className={`bg-gray-900/50 rounded-lg border border-gray-800 overflow-hidden ${selectedToken ? 'lg:col-span-2' : ''}`}>
          <div className="p-4 border-b border-gray-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ChartBarIcon className="w-5 h-5 text-green-400" />
              <h3 className="font-semibold text-white">Top Candidates</h3>
              <span className="text-sm text-gray-500">({candidates.length})</span>
            </div>
          </div>
          
          <CandidateTable
            candidates={candidates}
            onSelect={setSelectedToken}
            onCopyToLauncher={handleCopyToLauncher}
            onRapidLaunch={(token) => setRapidLaunchToken(token)}
            selectedMint={selectedToken?.mint}
          />
        </div>

        {/* Token Profile Panel - shows when token is selected */}
        {selectedToken && (
          <div className="lg:col-span-1">
            <TokenProfile
              token={selectedToken}
              onClose={() => setSelectedToken(null)}
              onRapidLaunch={(token) => setRapidLaunchToken(token)}
            />
          </div>
        )}
      </div>

      {/* All tokens (smaller) */}
      <div className="bg-gray-900/50 rounded-lg border border-gray-800 overflow-hidden">
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FunnelIcon className="w-5 h-5 text-gray-400" />
            <h3 className="font-semibold text-white">All Tracked</h3>
            <span className="text-sm text-gray-500">({allTokens.length})</span>
          </div>
        </div>
        
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-800/50 sticky top-0">
              <tr>
                <th className="px-4 py-2 text-left text-gray-400 font-medium">Token</th>
                <th className="px-4 py-2 text-right text-gray-400 font-medium">Score</th>
                <th className="px-4 py-2 text-right text-gray-400 font-medium">Buyers</th>
                <th className="px-4 py-2 text-right text-gray-400 font-medium">Volume</th>
                <th className="px-4 py-2 text-center text-gray-400 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {allTokens.slice(0, 50).map((token) => (
                <tr key={token.mint} className="hover:bg-gray-800/30">
                  <td className="px-4 py-2">
                    <span className="font-mono text-gray-300">{token.symbol}</span>
                    <span className="text-gray-500 text-xs ml-2">{token.mint?.slice(0, 6)}...</span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <span className={`font-bold ${
                      token.score >= 70 ? 'text-green-400' :
                      token.score >= 40 ? 'text-yellow-400' :
                      'text-gray-400'
                    }`}>
                      {token.score}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right text-gray-300">{token.uniqueBuyers}</td>
                  <td className="px-4 py-2 text-right text-gray-300">{token.solVolume?.toFixed(2)} SOL</td>
                  <td className="px-4 py-2 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      token.status === 'candidate' ? 'bg-green-500/20 text-green-400' :
                      token.status === 'dropped' ? 'bg-red-500/20 text-red-400' :
                      'bg-gray-500/20 text-gray-400'
                    }`}>
                      {token.status}
                    </span>
                  </td>
                </tr>
              ))}
              {allTokens.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    No tokens being tracked yet. Waiting for new launches...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rapid Launch Modal */}
      {rapidLaunchToken && (
        <RapidLaunchModal
          token={rapidLaunchToken}
          onClose={() => setRapidLaunchToken(null)}
          onLaunchComplete={(result) => {
            console.log('[TrendDetector] Rapid launch complete:', result);
            // Optionally close after a delay
            setTimeout(() => setRapidLaunchToken(null), 3000);
          }}
        />
      )}
    </div>
  );
}
