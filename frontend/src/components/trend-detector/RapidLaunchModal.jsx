import React, { useState, useEffect } from 'react';
import {
  XMarkIcon,
  RocketLaunchIcon,
  CurrencyDollarIcon,
  PhotoIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ClipboardDocumentIcon,
  BoltIcon,
} from '@heroicons/react/24/outline';
import apiService from '../../services/api';

export default function RapidLaunchModal({ token, onClose, onLaunchComplete }) {
  // State
  const [devBuy, setDevBuy] = useState(0.5);
  const [nextAddress, setNextAddress] = useState(null);
  const [loading, setLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchStatus, setLaunchStatus] = useState(null); // 'success' | 'error' | null
  const [launchMessage, setLaunchMessage] = useState('');
  const [launchProgress, setLaunchProgress] = useState([]);

  // Load next pump address on mount
  useEffect(() => {
    loadNextAddress();
  }, []);

  const loadNextAddress = async () => {
    try {
      setLoading(true);
      const res = await apiService.getNextPumpAddress();
      if (res.data.success) {
        setNextAddress(res.data.address);
      }
    } catch (error) {
      console.error('Failed to load next pump address:', error);
    } finally {
      setLoading(false);
    }
  };

  // Launch the token
  const handleLaunch = async () => {
    if (!token || !nextAddress) return;

    setLaunching(true);
    setLaunchStatus(null);
    setLaunchProgress(['🚀 Preparing rapid launch...']);

    try {
      setLaunchProgress(prev => [...prev, `📝 Token: ${token.name} ($${token.symbol})`]);
      setLaunchProgress(prev => [...prev, `💰 Dev Buy: ${devBuy} SOL`]);
      if (token.imageUrl) {
        setLaunchProgress(prev => [...prev, '🖼️ Image will be downloaded by server...']);
      }
      setLaunchProgress(prev => [...prev, '⏳ Launching on pump.fun...']);

      // Call rapid launch with ALL data inline (no .env dependency)
      const res = await apiService.rapidLaunch({
        name: token.name,
        symbol: token.symbol,
        description: token.description || `Inspired by ${token.symbol}`,
        twitter: token.twitter || '',
        telegram: token.telegram || '',
        website: token.website || '',
        imageUrl: token.imageUrl || null,
        devBuyAmount: devBuy,
      });

      if (res.data.success) {
        setLaunchStatus('success');
        setLaunchMessage(`Token launched successfully! Mint: ${res.data.mintAddress?.slice(0, 12)}...`);
        setLaunchProgress(prev => [...prev, '✅ Launch complete!']);
        
        if (onLaunchComplete) {
          onLaunchComplete(res.data);
        }
      } else {
        throw new Error(res.data.error || 'Launch failed');
      }

    } catch (error) {
      setLaunchStatus('error');
      setLaunchMessage(error.response?.data?.error || error.message || 'Launch failed');
      setLaunchProgress(prev => [...prev, `❌ Error: ${error.message}`]);
    } finally {
      setLaunching(false);
    }
  };

  if (!token) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 rounded-xl border border-purple-500/30 shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-gradient-to-r from-purple-600/20 to-pink-600/20 border-b border-purple-500/30">
          <div className="flex items-center gap-2">
            <BoltIcon className="w-6 h-6 text-yellow-400" />
            <h2 className="text-xl font-bold text-white">Rapid Launch</h2>
          </div>
          <button
            onClick={onClose}
            disabled={launching}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Token Preview */}
          <div className="flex items-start gap-4 p-4 bg-gray-800/50 rounded-lg border border-gray-700/50">
            {/* Image */}
            <div className="flex-shrink-0">
              {token.imageUrl ? (
                <img
                  src={token.imageUrl}
                  alt={token.symbol}
                  className="w-16 h-16 rounded-xl object-cover bg-gray-700"
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              ) : (
                <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-purple-600 to-pink-500 flex items-center justify-center text-white text-2xl font-bold">
                  {token.symbol?.charAt(0) || '?'}
                </div>
              )}
            </div>

            {/* Token Info */}
            <div className="flex-grow min-w-0">
              <h3 className="text-lg font-bold text-white truncate">{token.name}</h3>
              <p className="text-gray-400 font-mono">${token.symbol}</p>
              {token.description && (
                <p className="text-sm text-gray-500 mt-1 line-clamp-2">{token.description}</p>
              )}
            </div>
          </div>

          {/* Next Pump Address */}
          <div className="p-4 bg-gray-800/30 rounded-lg border border-gray-700/50">
            <label className="block text-sm font-medium text-gray-400 mb-2">
              Next Available Pump Address
            </label>
            <div className="flex items-center gap-2">
              {loading ? (
                <div className="flex items-center gap-2 text-gray-500">
                  <ArrowPathIcon className="w-4 h-4 animate-spin" />
                  <span>Loading...</span>
                </div>
              ) : nextAddress ? (
                <>
                  <code className="flex-grow text-sm text-green-400 font-mono bg-gray-900 px-3 py-2 rounded truncate">
                    {nextAddress}
                  </code>
                  <button
                    onClick={() => navigator.clipboard.writeText(nextAddress)}
                    className="p-2 text-gray-400 hover:text-white transition-colors"
                    title="Copy address"
                  >
                    <ClipboardDocumentIcon className="w-4 h-4" />
                  </button>
                  <button
                    onClick={loadNextAddress}
                    className="p-2 text-gray-400 hover:text-white transition-colors"
                    title="Refresh"
                  >
                    <ArrowPathIcon className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <span className="text-red-400">Failed to load address</span>
              )}
            </div>
          </div>

          {/* Dev Buy Amount */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              <CurrencyDollarIcon className="w-4 h-4 inline mr-1" />
              Dev Buy Amount (SOL)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={devBuy}
                onChange={(e) => setDevBuy(parseFloat(e.target.value) || 0)}
                step="0.1"
                min="0"
                max="10"
                className="flex-grow px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white text-lg focus:border-purple-500 focus:outline-none"
                disabled={launching}
              />
              <div className="flex gap-1">
                {[0.1, 0.5, 1, 2, 5].map((amount) => (
                  <button
                    key={amount}
                    onClick={() => setDevBuy(amount)}
                    className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                      devBuy === amount
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                    disabled={launching}
                  >
                    {amount}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Launch Progress */}
          {launchProgress.length > 0 && (
            <div className="p-3 bg-gray-800/50 rounded-lg border border-gray-700/50 max-h-32 overflow-y-auto">
              {launchProgress.map((msg, i) => (
                <p key={i} className="text-sm text-gray-300 py-0.5">{msg}</p>
              ))}
            </div>
          )}

          {/* Status Messages */}
          {launchStatus === 'success' && (
            <div className="p-4 bg-green-500/20 border border-green-500/50 rounded-lg flex items-center gap-3">
              <CheckCircleIcon className="w-6 h-6 text-green-400" />
              <p className="text-green-400">{launchMessage}</p>
            </div>
          )}

          {launchStatus === 'error' && (
            <div className="p-4 bg-red-500/20 border border-red-500/50 rounded-lg flex items-center gap-3">
              <ExclamationTriangleIcon className="w-6 h-6 text-red-400" />
              <p className="text-red-400">{launchMessage}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-800/50 border-t border-gray-700/50 flex items-center justify-between">
          <button
            onClick={onClose}
            disabled={launching}
            className="px-6 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          
          <button
            onClick={handleLaunch}
            disabled={launching || !nextAddress || launchStatus === 'success'}
            className="px-8 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold rounded-lg transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {launching ? (
              <>
                <ArrowPathIcon className="w-5 h-5 animate-spin" />
                Launching...
              </>
            ) : launchStatus === 'success' ? (
              <>
                <CheckCircleIcon className="w-5 h-5" />
                Launched!
              </>
            ) : (
              <>
                <RocketLaunchIcon className="w-5 h-5" />
                Launch Now
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
