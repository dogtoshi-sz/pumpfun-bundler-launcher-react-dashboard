import { useState, useEffect } from 'react';
import {
  SparklesIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';

import TokenLaunchSimple from './TokenLaunchSimple';
import TokenLaunchClassic from './TokenLaunchClassic';

const STORAGE_KEY = 'launcherMode';

export default function TokenLaunch({ onLaunch }) {
  const [mode, setMode] = useState(() => localStorage.getItem(STORAGE_KEY) || 'simple');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  return (
    <div>
      <div className="flex justify-center mb-4">
        <div className="inline-flex bg-gray-900 border border-gray-800 rounded-full p-1">
          <button
            onClick={() => setMode('simple')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
              mode === 'simple'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            <SparklesIcon className="w-3.5 h-3.5" />
            Simple
          </button>
          <button
            onClick={() => setMode('classic')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
              mode === 'classic'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            <WrenchScrewdriverIcon className="w-3.5 h-3.5" />
            Advanced
          </button>
        </div>
      </div>

      {mode === 'simple' ? (
        <TokenLaunchSimple onLaunch={onLaunch} />
      ) : (
        <TokenLaunchClassic onLaunch={onLaunch} />
      )}
    </div>
  );
}
