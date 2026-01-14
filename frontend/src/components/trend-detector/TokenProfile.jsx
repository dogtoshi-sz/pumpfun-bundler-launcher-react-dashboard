import React from 'react';
import {
  GlobeAltIcon,
  ChatBubbleLeftRightIcon,
  XMarkIcon,
  ClipboardDocumentIcon,
  ArrowTopRightOnSquareIcon,
  UserGroupIcon,
  CurrencyDollarIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  ClockIcon,
  ChartBarIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  BoltIcon,
} from '@heroicons/react/24/outline';

// Twitter/X icon component
const TwitterIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

// Telegram icon component
const TelegramIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
  </svg>
);

// Format age in human readable form
const formatAge = (ms) => {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
};

// Copy to clipboard helper
const copyToClipboard = (text, label) => {
  navigator.clipboard.writeText(text);
  // Could add toast notification here
};

export default function TokenProfile({ token, onClose, onRapidLaunch }) {
  if (!token) return null;

  const {
    mint,
    name,
    symbol,
    imageUrl,
    description,
    twitter,
    telegram,
    website,
    creator,
    score,
    uniqueBuyers,
    totalBuys,
    totalSells,
    solVolume,
    status,
    ageMs,
    metrics,
  } = token;

  // Status badge
  const StatusBadge = () => {
    const styles = {
      candidate: 'bg-green-500/20 text-green-400 border-green-500/30',
      tracking: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      dropped: 'bg-red-500/20 text-red-400 border-red-500/30',
    };
    const icons = {
      candidate: <CheckCircleIcon className="w-4 h-4" />,
      tracking: <ClockIcon className="w-4 h-4" />,
      dropped: <XCircleIcon className="w-4 h-4" />,
    };
    return (
      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border ${styles[status] || styles.tracking}`}>
        {icons[status] || icons.tracking}
        {status?.charAt(0).toUpperCase() + status?.slice(1)}
      </span>
    );
  };

  // Score gauge
  const ScoreGauge = () => {
    const getColor = (s) => {
      if (s >= 80) return 'from-green-500 to-emerald-400';
      if (s >= 60) return 'from-yellow-500 to-amber-400';
      if (s >= 40) return 'from-orange-500 to-amber-500';
      return 'from-red-500 to-rose-400';
    };
    return (
      <div className="text-center">
        <div className="relative w-24 h-24 mx-auto">
          {/* Background circle */}
          <div className="absolute inset-0 rounded-full border-4 border-gray-700/50"></div>
          {/* Progress circle */}
          <svg className="absolute inset-0 transform -rotate-90" viewBox="0 0 100 100">
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="url(#scoreGradient)"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${(score / 100) * 264} 264`}
            />
            <defs>
              <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" className={`text-${score >= 60 ? 'green' : score >= 40 ? 'yellow' : 'red'}-500`} stopColor="currentColor" />
                <stop offset="100%" className={`text-${score >= 60 ? 'emerald' : score >= 40 ? 'amber' : 'rose'}-400`} stopColor="currentColor" />
              </linearGradient>
            </defs>
          </svg>
          {/* Score number */}
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-2xl font-bold bg-gradient-to-r ${getColor(score)} bg-clip-text text-transparent`}>
              {score || 0}
            </span>
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-400">Momentum Score</p>
      </div>
    );
  };

  return (
    <div className="bg-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-700/50 overflow-hidden">
      {/* Header with close button */}
      <div className="flex items-center justify-between p-4 border-b border-gray-800">
        <h3 className="text-lg font-semibold text-white">Token Profile</h3>
        <button
          onClick={onClose}
          className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
        >
          <XMarkIcon className="w-5 h-5" />
        </button>
      </div>

      <div className="p-4 space-y-6">
        {/* Token Identity */}
        <div className="flex items-start gap-4">
          {/* Token Image */}
          <div className="flex-shrink-0">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={symbol}
                className="w-20 h-20 rounded-xl object-cover bg-gray-800 border border-gray-700"
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'flex';
                }}
              />
            ) : null}
            <div
              className={`w-20 h-20 rounded-xl bg-gradient-to-br from-purple-600 to-pink-500 flex items-center justify-center text-white text-2xl font-bold ${imageUrl ? 'hidden' : ''}`}
            >
              {symbol?.charAt(0) || '?'}
            </div>
          </div>

          {/* Token Info */}
          <div className="flex-grow min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h4 className="text-xl font-bold text-white truncate">{name || symbol}</h4>
              <StatusBadge />
            </div>
            <p className="text-lg text-gray-400 font-mono">${symbol}</p>
            
            {/* Mint address */}
            <div className="mt-2 flex items-center gap-2">
              <code className="text-xs text-gray-500 font-mono bg-gray-800 px-2 py-1 rounded">
                {mint?.slice(0, 12)}...{mint?.slice(-8)}
              </code>
              <button
                onClick={() => copyToClipboard(mint, 'Mint address')}
                className="p-1 text-gray-500 hover:text-white transition-colors"
                title="Copy mint address"
              >
                <ClipboardDocumentIcon className="w-4 h-4" />
              </button>
              <a
                href={`https://pump.fun/${mint}`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 text-gray-500 hover:text-purple-400 transition-colors"
                title="View on pump.fun"
              >
                <ArrowTopRightOnSquareIcon className="w-4 h-4" />
              </a>
            </div>

            {/* Age */}
            <div className="mt-2 flex items-center gap-2 text-sm text-gray-400">
              <ClockIcon className="w-4 h-4" />
              <span>Age: {formatAge(ageMs || 0)}</span>
            </div>
          </div>

          {/* Score Gauge */}
          <ScoreGauge />
        </div>

        {/* Rapid Launch Button */}
        {onRapidLaunch && (
          <button
            onClick={() => onRapidLaunch(token)}
            className="w-full py-3 bg-gradient-to-r from-yellow-500/20 to-orange-500/20 hover:from-yellow-500/30 hover:to-orange-500/30 border border-yellow-500/30 rounded-lg text-yellow-400 font-bold flex items-center justify-center gap-2 transition-all"
          >
            <BoltIcon className="w-5 h-5" />
            Rapid Launch (Copy & Deploy)
          </button>
        )}

        {/* Description */}
        {description && (
          <div className="p-3 bg-gray-800/50 rounded-lg border border-gray-700/50">
            <p className="text-sm text-gray-300 leading-relaxed">{description}</p>
          </div>
        )}

        {/* Social Links */}
        <div className="flex items-center gap-3 flex-wrap">
          {website && (
            <a
              href={website.startsWith('http') ? website : `https://${website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg transition-colors"
            >
              <GlobeAltIcon className="w-4 h-4" />
              Website
            </a>
          )}
          {twitter && (
            <a
              href={twitter.startsWith('http') ? twitter : `https://twitter.com/${twitter.replace('@', '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg transition-colors"
            >
              <TwitterIcon className="w-4 h-4" />
              Twitter
            </a>
          )}
          {telegram && (
            <a
              href={telegram.startsWith('http') ? telegram : `https://t.me/${telegram.replace('@', '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg transition-colors"
            >
              <TelegramIcon className="w-4 h-4" />
              Telegram
            </a>
          )}
          {!website && !twitter && !telegram && (
            <span className="text-sm text-gray-500 italic">No social links available</span>
          )}
        </div>

        {/* Key Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 bg-gray-800/50 rounded-lg border border-gray-700/30 text-center">
            <UserGroupIcon className="w-5 h-5 text-blue-400 mx-auto mb-1" />
            <p className="text-xl font-bold text-white">{uniqueBuyers || 0}</p>
            <p className="text-xs text-gray-400">Unique Buyers</p>
          </div>
          <div className="p-3 bg-gray-800/50 rounded-lg border border-gray-700/30 text-center">
            <ChartBarIcon className="w-5 h-5 text-green-400 mx-auto mb-1" />
            <p className="text-xl font-bold text-white">
              <span className="text-green-400">{totalBuys || 0}</span>
              <span className="text-gray-500 mx-1">/</span>
              <span className="text-red-400">{totalSells || 0}</span>
            </p>
            <p className="text-xs text-gray-400">Buys / Sells</p>
          </div>
          <div className="p-3 bg-gray-800/50 rounded-lg border border-gray-700/30 text-center">
            <CurrencyDollarIcon className="w-5 h-5 text-yellow-400 mx-auto mb-1" />
            <p className="text-xl font-bold text-white">{(solVolume || 0).toFixed(2)}</p>
            <p className="text-xs text-gray-400">SOL Volume</p>
          </div>
          <div className="p-3 bg-gray-800/50 rounded-lg border border-gray-700/30 text-center">
            {(metrics?.buySellRatio || 1) >= 1 ? (
              <ArrowTrendingUpIcon className="w-5 h-5 text-green-400 mx-auto mb-1" />
            ) : (
              <ArrowTrendingDownIcon className="w-5 h-5 text-red-400 mx-auto mb-1" />
            )}
            <p className={`text-xl font-bold ${(metrics?.buySellRatio || 1) >= 1 ? 'text-green-400' : 'text-red-400'}`}>
              {(metrics?.buySellRatio || 1).toFixed(2)}
            </p>
            <p className="text-xs text-gray-400">Buy/Sell Ratio</p>
          </div>
        </div>

        {/* Rolling Metrics (60s window) */}
        {metrics && (
          <div className="p-4 bg-gray-800/30 rounded-lg border border-gray-700/30">
            <h5 className="text-sm font-medium text-gray-400 mb-3">Rolling 60s Metrics</h5>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-lg font-bold text-white">{metrics.trades60s || 0}</p>
                <p className="text-xs text-gray-500">Trades</p>
              </div>
              <div>
                <p className="text-lg font-bold text-white">{metrics.uniqueBuyers60s || 0}</p>
                <p className="text-xs text-gray-500">New Buyers</p>
              </div>
              <div>
                <p className="text-lg font-bold text-white">{(metrics.solVol60s || 0).toFixed(2)}</p>
                <p className="text-xs text-gray-500">SOL Vol</p>
              </div>
            </div>
            
            {/* Acceleration indicators */}
            <div className="mt-3 pt-3 border-t border-gray-700/50 flex items-center justify-center gap-6">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Trade Accel:</span>
                {metrics.accelTrades > 0 ? (
                  <span className="flex items-center gap-1 text-green-400 text-sm">
                    <ArrowTrendingUpIcon className="w-4 h-4" />
                    +{metrics.accelTrades}
                  </span>
                ) : metrics.accelTrades < 0 ? (
                  <span className="flex items-center gap-1 text-red-400 text-sm">
                    <ArrowTrendingDownIcon className="w-4 h-4" />
                    {metrics.accelTrades}
                  </span>
                ) : (
                  <span className="text-gray-500 text-sm">-</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Vol Accel:</span>
                {metrics.accelVol > 0 ? (
                  <span className="flex items-center gap-1 text-green-400 text-sm">
                    <ArrowTrendingUpIcon className="w-4 h-4" />
                    +{metrics.accelVol.toFixed(2)}
                  </span>
                ) : metrics.accelVol < 0 ? (
                  <span className="flex items-center gap-1 text-red-400 text-sm">
                    <ArrowTrendingDownIcon className="w-4 h-4" />
                    {metrics.accelVol.toFixed(2)}
                  </span>
                ) : (
                  <span className="text-gray-500 text-sm">-</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Creator */}
        {creator && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span>Creator:</span>
            <code className="font-mono bg-gray-800 px-2 py-0.5 rounded text-xs">
              {creator.slice(0, 8)}...{creator.slice(-6)}
            </code>
            <button
              onClick={() => copyToClipboard(creator, 'Creator address')}
              className="p-1 hover:text-white transition-colors"
              title="Copy creator address"
            >
              <ClipboardDocumentIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
