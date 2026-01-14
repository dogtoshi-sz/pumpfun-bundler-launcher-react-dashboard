import React, { useState, useEffect, useRef } from 'react';

const API_BASE = 'http://localhost:3001';

const PumpPortalTest = () => {
  const [mintAddress, setMintAddress] = useState('');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [pumpPortalTrades, setPumpPortalTrades] = useState([]);
  const [heliusTrades, setHeliusTrades] = useState([]);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  
  const pumpPortalEventSource = useRef(null);
  const heliusEventSource = useRef(null);

  // Fetch status on mount
  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/pumpportal/status`);
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      console.error('Error fetching status:', err);
    }
  };

  const subscribe = async () => {
    if (!mintAddress.trim()) {
      setError('Please enter a mint address');
      return;
    }

    setError('');
    setPumpPortalTrades([]);
    setHeliusTrades([]);

    try {
      // Subscribe to PumpPortal
      const res = await fetch(`${API_BASE}/api/pumpportal/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mintAddress: mintAddress.trim() })
      });
      const data = await res.json();
      
      if (data.success) {
        setIsSubscribed(true);
        
        // Start PumpPortal SSE stream
        pumpPortalEventSource.current = new EventSource(`${API_BASE}/api/pumpportal/trades/stream`);
        pumpPortalEventSource.current.onmessage = (event) => {
          const trade = JSON.parse(event.data);
          if (trade.type === 'connected') return;
          
          // Only add trades for our mint
          if (trade.mintAddress === mintAddress.trim()) {
            setPumpPortalTrades(prev => [trade, ...prev].slice(0, 50));
          }
        };
        pumpPortalEventSource.current.onerror = () => {
          console.error('PumpPortal SSE error');
        };

        // Also start Helius stream for comparison
        heliusEventSource.current = new EventSource(`${API_BASE}/api/live-trades/stream?mint=${mintAddress.trim()}`);
        heliusEventSource.current.onmessage = (event) => {
          const trade = JSON.parse(event.data);
          setHeliusTrades(prev => [trade, ...prev].slice(0, 50));
        };
        heliusEventSource.current.onerror = () => {
          console.error('Helius SSE error');
        };

        // Trigger Helius to start tracking too
        await fetch(`${API_BASE}/api/live-trades/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mintAddress: mintAddress.trim() })
        });
      } else {
        setError(data.error || 'Failed to subscribe');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const unsubscribe = async () => {
    // Close SSE connections
    if (pumpPortalEventSource.current) {
      pumpPortalEventSource.current.close();
      pumpPortalEventSource.current = null;
    }
    if (heliusEventSource.current) {
      heliusEventSource.current.close();
      heliusEventSource.current = null;
    }

    try {
      await fetch(`${API_BASE}/api/pumpportal/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mintAddress: mintAddress.trim() })
      });
    } catch (err) {
      console.error('Error unsubscribing:', err);
    }

    setIsSubscribed(false);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pumpPortalEventSource.current) pumpPortalEventSource.current.close();
      if (heliusEventSource.current) heliusEventSource.current.close();
    };
  }, []);

  const TradeRow = ({ trade, source }) => {
    const isBuy = trade.type === 'buy';
    return (
      <div 
        className={`flex items-center justify-between p-2 rounded text-sm ${
          isBuy ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'
        }`}
      >
        <span className={`font-bold ${isBuy ? 'text-green-400' : 'text-red-400'}`}>
          {trade.type?.toUpperCase()}
        </span>
        <span className="text-gray-300">{trade.solAmount?.toFixed(4)} SOL</span>
        <span className="text-gray-400 text-xs">{trade.trader}</span>
        <span className="text-gray-500 text-xs">{trade.signature}</span>
      </div>
    );
  };

  return (
    <div className="p-6 bg-gray-900 min-h-screen text-white">
      <h1 className="text-2xl font-bold mb-6">🧪 PumpPortal vs Helius Comparison</h1>
      
      {/* Status */}
      {status && (
        <div className="mb-4 p-3 bg-gray-800 rounded">
          <span className={`inline-block w-3 h-3 rounded-full mr-2 ${status.connected ? 'bg-green-500' : 'bg-red-500'}`}></span>
          PumpPortal: {status.connected ? 'Connected' : 'Disconnected'}
          {status.subscribedTokens?.length > 0 && (
            <span className="ml-4 text-gray-400">
              Tracking: {status.subscribedTokens.length} token(s)
            </span>
          )}
        </div>
      )}

      {/* Subscribe Form */}
      <div className="flex gap-4 mb-6">
        <input
          type="text"
          value={mintAddress}
          onChange={(e) => setMintAddress(e.target.value)}
          placeholder="Enter token mint address..."
          className="flex-1 p-3 bg-gray-800 border border-gray-700 rounded text-white"
          disabled={isSubscribed}
        />
        {!isSubscribed ? (
          <button
            onClick={subscribe}
            className="px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded font-bold"
          >
            Subscribe & Compare
          </button>
        ) : (
          <button
            onClick={unsubscribe}
            className="px-6 py-3 bg-red-600 hover:bg-red-700 rounded font-bold"
          >
            Stop
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/20 border border-red-500 rounded text-red-400">
          {error}
        </div>
      )}

      {/* Side by Side Comparison */}
      {isSubscribed && (
        <div className="grid grid-cols-2 gap-6">
          {/* PumpPortal Column */}
          <div>
            <h2 className="text-lg font-bold mb-3 text-purple-400">
              🟣 PumpPortal ({pumpPortalTrades.length} trades)
            </h2>
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {pumpPortalTrades.length === 0 ? (
                <div className="text-gray-500 text-center py-8">
                  Waiting for trades...
                </div>
              ) : (
                pumpPortalTrades.map((trade, i) => (
                  <TradeRow key={`pp-${trade.fullSignature || i}`} trade={trade} source="pumpportal" />
                ))
              )}
            </div>
          </div>

          {/* Helius Column */}
          <div>
            <h2 className="text-lg font-bold mb-3 text-blue-400">
              🔵 Helius ({heliusTrades.length} trades)
            </h2>
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {heliusTrades.length === 0 ? (
                <div className="text-gray-500 text-center py-8">
                  Waiting for trades...
                </div>
              ) : (
                heliusTrades.map((trade, i) => (
                  <TradeRow key={`h-${trade.fullSignature || i}`} trade={trade} source="helius" />
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Instructions */}
      {!isSubscribed && (
        <div className="mt-8 p-4 bg-gray-800 rounded">
          <h3 className="font-bold mb-2">📋 How to Test</h3>
          <ol className="list-decimal list-inside space-y-1 text-gray-300">
            <li>Find an active token on pump.fun that's getting trades</li>
            <li>Copy its mint address (Contract Address / CA)</li>
            <li>Paste it above and click "Subscribe & Compare"</li>
            <li>Watch both columns - PumpPortal should show accurate BUY/SELL</li>
            <li>Compare with Helius to see if they match</li>
          </ol>
          <p className="mt-4 text-yellow-400 text-sm">
            💡 Tip: Pick a token with active trading to see trades quickly
          </p>
        </div>
      )}
    </div>
  );
};

export default PumpPortalTest;
