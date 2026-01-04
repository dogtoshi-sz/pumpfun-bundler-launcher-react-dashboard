import { useState, useEffect } from 'react';
import apiService from '../services/api';

export default function CurrentRun() {
  const [currentRun, setCurrentRun] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCurrentRun();
    const interval = setInterval(loadCurrentRun, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadCurrentRun = async () => {
    try {
      const res = await apiService.getCurrentRun();
      setCurrentRun(res.data.data);
      setLoading(false);
    } catch (error) {
      console.error('Failed to load current run:', error);
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-gray-900/50 rounded-lg p-6">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!currentRun) {
    return (
      <div className="bg-gray-900/50 rounded-lg p-6">
        <h2 className="text-2xl font-bold mb-4 text-white">📝 Current Run Info</h2>
        <p className="text-gray-500">No token launched yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900/50 rounded-lg p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white">📝 Current Run Info</h2>
        <button
          onClick={loadCurrentRun}
          className="px-4 py-2 bg-gray-900/50 hover:bg-gray-800 text-white rounded-lg transition-colors"
        >
          🔄 Refresh
        </button>
      </div>

      <div className="space-y-4">
        <div className="bg-gray-900/50 rounded-lg p-4">
          <p className="text-sm text-gray-300 mb-1">Mint Address</p>
          <p className="text-sm font-mono text-white break-all">{currentRun.mintAddress || 'N/A'}</p>
        </div>

        <div className="bg-gray-900/50 rounded-lg p-4">
          <p className="text-sm text-gray-300 mb-1">Launch Status</p>
          <p className="text-lg font-bold text-white">{currentRun.launchStatus || 'N/A'}</p>
        </div>

        <div className="bg-gray-900/50 rounded-lg p-4">
          <p className="text-sm text-gray-300 mb-1">Wallet Count</p>
          <p className="text-lg font-bold text-white">
            {currentRun.walletKeys?.length || currentRun.count || 'N/A'}
          </p>
        </div>

        {currentRun.timestamp && (
          <div className="bg-gray-900/50 rounded-lg p-4">
            <p className="text-sm text-gray-300 mb-1">Launch Time</p>
            <p className="text-white">
              {new Date(currentRun.timestamp).toLocaleString()}
            </p>
          </div>
        )}

        {currentRun.bundleWalletsUsed && (
          <div className="bg-gray-900/50 rounded-lg p-4">
            <p className="text-sm text-gray-300 mb-1">Bundle Wallets</p>
            <p className="text-white">{currentRun.bundleWalletsUsed.length}</p>
          </div>
        )}

        {currentRun.holderWalletKeys && (
          <div className="bg-gray-900/50 rounded-lg p-4">
            <p className="text-sm text-gray-300 mb-1">Holder Wallets</p>
            <p className="text-white">{currentRun.holderWalletKeys.length}</p>
          </div>
        )}
      </div>
    </div>
  );
}





