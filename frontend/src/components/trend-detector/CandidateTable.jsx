import React from 'react';
import {
  RocketLaunchIcon,
  ClipboardDocumentIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  UserGroupIcon,
  CurrencyDollarIcon,
  GlobeAltIcon,
  BoltIcon,
} from '@heroicons/react/24/outline';

// Social icons as simple components
const TwitterIcon = () => (
  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const TelegramIcon = () => (
  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
  </svg>
);

export default function CandidateTable({ candidates: rawCandidates, onSelect, onCopyToLauncher, onRapidLaunch, selectedMint }) {
  // Ensure candidates is always an array
  const candidates = Array.isArray(rawCandidates) ? rawCandidates : [];
  
  // Format age
  const formatAge = (ms) => {
    if (!ms || isNaN(ms)) return '0s';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  // Score color
  const getScoreColor = (score) => {
    if (score >= 80) return 'text-green-400 bg-green-500/20';
    if (score >= 60) return 'text-yellow-400 bg-yellow-500/20';
    if (score >= 40) return 'text-orange-400 bg-orange-500/20';
    return 'text-red-400 bg-red-500/20';
  };

  // Trend indicator
  const TrendIndicator = ({ value }) => {
    if (value > 0) {
      return <ArrowTrendingUpIcon className="w-4 h-4 text-green-400" />;
    } else if (value < 0) {
      return <ArrowTrendingDownIcon className="w-4 h-4 text-red-400" />;
    }
    return <span className="w-4 h-4 text-gray-500">-</span>;
  };

  if (candidates.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        <ArrowTrendingUpIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p>No candidates yet</p>
        <p className="text-sm mt-1">Tokens need to pass the Alive Gate (2min) to become candidates</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-gray-800/50">
          <tr>
            <th className="px-4 py-3 text-left text-gray-400 font-medium text-sm">#</th>
            <th className="px-4 py-3 text-left text-gray-400 font-medium text-sm">Token</th>
            <th className="px-4 py-3 text-center text-gray-400 font-medium text-sm">Score</th>
            <th className="px-4 py-3 text-right text-gray-400 font-medium text-sm">Buyers</th>
            <th className="px-4 py-3 text-right text-gray-400 font-medium text-sm">Buys/Sells</th>
            <th className="px-4 py-3 text-right text-gray-400 font-medium text-sm">Volume</th>
            <th className="px-4 py-3 text-right text-gray-400 font-medium text-sm">B/S Ratio</th>
            <th className="px-4 py-3 text-center text-gray-400 font-medium text-sm">Trend</th>
            <th className="px-4 py-3 text-center text-gray-400 font-medium text-sm">Links</th>
            <th className="px-4 py-3 text-right text-gray-400 font-medium text-sm">Age</th>
            <th className="px-4 py-3 text-center text-gray-400 font-medium text-sm">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/50">
          {candidates.map((token, index) => (
            <tr
              key={token.mint}
              onClick={() => onSelect?.(token)}
              className={`hover:bg-gray-800/30 cursor-pointer transition-colors ${
                selectedMint === token.mint ? 'bg-purple-500/10' : ''
              }`}
            >
              {/* Rank */}
              <td className="px-4 py-3">
                <span className={`font-bold ${
                  index === 0 ? 'text-yellow-400' :
                  index === 1 ? 'text-gray-300' :
                  index === 2 ? 'text-orange-400' :
                  'text-gray-500'
                }`}>
                  {index + 1}
                </span>
              </td>
              
              {/* Token info */}
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  {token.imageUrl ? (
                    <img
                      src={token.imageUrl}
                      alt={token.symbol}
                      className="w-8 h-8 rounded-full object-cover bg-gray-800"
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold">
                      {token.symbol?.charAt(0) || '?'}
                    </div>
                  )}
                  <div>
                    <p className="font-medium text-white">{token.symbol}</p>
                    <p className="text-xs text-gray-500 font-mono">{token.mint?.slice(0, 8)}...</p>
                  </div>
                </div>
              </td>
              
              {/* Score */}
              <td className="px-4 py-3 text-center">
                <span className={`px-3 py-1 rounded-full font-bold text-sm ${getScoreColor(token.score)}`}>
                  {token.score}
                </span>
              </td>
              
              {/* Unique Buyers */}
              <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-1">
                  <UserGroupIcon className="w-4 h-4 text-gray-500" />
                  <span className="text-white font-medium">{token.uniqueBuyers}</span>
                </div>
              </td>
              
              {/* Buys/Sells */}
              <td className="px-4 py-3 text-right">
                <span className="text-green-400">{token.totalBuys}</span>
                <span className="text-gray-500">/</span>
                <span className="text-red-400">{token.totalSells}</span>
              </td>
              
              {/* Volume */}
              <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-1">
                  <CurrencyDollarIcon className="w-4 h-4 text-gray-500" />
                  <span className="text-white">{token.solVolume?.toFixed(2)}</span>
                  <span className="text-gray-500 text-xs">SOL</span>
                </div>
              </td>
              
              {/* Buy/Sell Ratio */}
              <td className="px-4 py-3 text-right">
                <span className={`font-medium ${
                  token.metrics?.buySellRatio >= 1.5 ? 'text-green-400' :
                  token.metrics?.buySellRatio >= 1.0 ? 'text-yellow-400' :
                  'text-red-400'
                }`}>
                  {token.metrics?.buySellRatio?.toFixed(2) || '-'}
                </span>
              </td>
              
              {/* Trend */}
              <td className="px-4 py-3 text-center">
                <div className="flex items-center justify-center gap-1">
                  <TrendIndicator value={token.metrics?.accelTrades} />
                  <TrendIndicator value={token.metrics?.accelVol} />
                </div>
              </td>
              
              {/* Links */}
              <td className="px-4 py-3">
                <div className="flex items-center justify-center gap-1.5">
                  {token.twitter && (
                    <a
                      href={token.twitter.startsWith('http') ? token.twitter : `https://twitter.com/${token.twitter}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="p-1 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded transition-colors"
                      title="Twitter"
                    >
                      <TwitterIcon />
                    </a>
                  )}
                  {token.telegram && (
                    <a
                      href={token.telegram.startsWith('http') ? token.telegram : `https://t.me/${token.telegram}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="p-1 bg-sky-500/20 text-sky-400 hover:bg-sky-500/30 rounded transition-colors"
                      title="Telegram"
                    >
                      <TelegramIcon />
                    </a>
                  )}
                  {token.website && (
                    <a
                      href={token.website.startsWith('http') ? token.website : `https://${token.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="p-1 bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded transition-colors"
                      title="Website"
                    >
                      <GlobeAltIcon className="w-3.5 h-3.5" />
                    </a>
                  )}
                  {!token.twitter && !token.telegram && !token.website && (
                    <span className="text-gray-600 text-xs">-</span>
                  )}
                </div>
              </td>
              
              {/* Age */}
              <td className="px-4 py-3 text-right text-gray-400 text-sm">
                {formatAge(token.ageMs)}
              </td>
              
              {/* Actions */}
              <td className="px-4 py-3">
                <div className="flex items-center justify-center gap-1.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRapidLaunch?.(token);
                    }}
                    className="p-1.5 bg-gradient-to-r from-yellow-500/20 to-orange-500/20 text-yellow-400 hover:from-yellow-500/30 hover:to-orange-500/30 rounded transition-colors"
                    title="Rapid Launch (Copy & Launch)"
                  >
                    <BoltIcon className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCopyToLauncher?.(token.mint);
                    }}
                    className="p-1.5 bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 rounded transition-colors"
                    title="Copy to Launcher"
                  >
                    <RocketLaunchIcon className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigator.clipboard.writeText(token.mint);
                    }}
                    className="p-1.5 bg-gray-700/50 text-gray-400 hover:bg-gray-700 rounded transition-colors"
                    title="Copy Mint Address"
                  >
                    <ClipboardDocumentIcon className="w-4 h-4" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
