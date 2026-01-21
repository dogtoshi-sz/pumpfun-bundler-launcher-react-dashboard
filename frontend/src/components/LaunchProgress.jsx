/**
 * 🚀 Launch Progress Component - User-Friendly Version
 * 
 * Clean, clear progress UI that shows exactly what's happening during launch.
 * Key features:
 * - Clear step-by-step progress
 * - WALLET SAVED confirmation (peace of mind)
 * - Important updates only (no log spam)
 * - Modern, clean design
 */

import { useState, useEffect, useRef } from 'react';
import { 
  RocketLaunchIcon, 
  CheckCircleIcon, 
  ArrowPathIcon,
  WalletIcon,
  CurrencyDollarIcon,
  ShieldCheckIcon,
  BoltIcon,
  ExclamationTriangleIcon,
  ClipboardDocumentIcon,
  ArrowTopRightOnSquareIcon
} from '@heroicons/react/24/outline';
import { CheckIcon } from '@heroicons/react/24/solid';
import { apiService } from '../services/api';

// Launch steps - simplified and clear
const STEPS = [
  { 
    id: 'wallets', 
    label: 'Creating Wallets', 
    icon: WalletIcon,
    successMessage: '✅ Wallets created & saved securely'
  },
  { 
    id: 'funding', 
    label: 'Funding Wallets', 
    icon: CurrencyDollarIcon,
    successMessage: '✅ SOL distributed to all wallets'
  },
  { 
    id: 'bundle', 
    label: 'Building Bundle', 
    icon: BoltIcon,
    successMessage: '✅ Bundle transaction ready'
  },
  { 
    id: 'sending', 
    label: 'Sending to Jito', 
    icon: RocketLaunchIcon,
    successMessage: '✅ Bundle submitted'
  },
  { 
    id: 'confirming', 
    label: 'Confirming', 
    icon: ShieldCheckIcon,
    successMessage: '✅ Token is LIVE!'
  }
];

export default function LaunchProgress({ onComplete, tokenInfo }) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [status, setStatus] = useState('launching'); // launching, success, failed
  const [mintAddress, setMintAddress] = useState(null);
  const [error, setError] = useState(null);
  const [keyEvents, setKeyEvents] = useState([]);
  const [walletsSaved, setWalletsSaved] = useState(false);
  const [runData, setRunData] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const pollRef = useRef(null);
  const timerRef = useRef(null);
  const startTimeRef = useRef(Date.now());

  // Start polling and timer
  useEffect(() => {
    startPolling();
    startTimer();
    
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startTimer = () => {
    timerRef.current = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
  };

  const startPolling = () => {
    const poll = async () => {
      try {
        const res = await apiService.getCurrentRun();
        const data = res.data.data || res.data;
        setRunData(data);

        // Check for mint address
        if (data.mintAddress && !mintAddress) {
          setMintAddress(data.mintAddress);
          addKeyEvent('🪙 Token address generated');
        }

        // Check for wallets saved
        if (data.bundleWalletKeys?.length > 0 && !walletsSaved) {
          setWalletsSaved(true);
          addKeyEvent('💾 All wallets saved to current-run.json');
          setCurrentStepIndex(1);
        }

        // Determine current step from data
        if (data.launchStatus === 'SUCCESS') {
          setStatus('success');
          setCurrentStepIndex(STEPS.length);
          addKeyEvent('🎉 TOKEN IS LIVE!');
          if (timerRef.current) clearInterval(timerRef.current);
          setTimeout(() => {
            if (onComplete) onComplete();
          }, 3000);
        } else if (data.launchStatus === 'FAILED') {
          setStatus('failed');
          setError(data.failureReason || 'Bundle may not have landed');
          addKeyEvent('❌ Launch failed - ' + (data.failureReason || 'Unknown error'));
          if (timerRef.current) clearInterval(timerRef.current);
        } else if (data.launchStage) {
          // Map backend stages to our steps
          const stageMap = {
            'CREATING_WALLETS': 0,
            'DISTRIBUTING': 1,
            'BUILDING_BUNDLE': 2,
            'SENDING_BUNDLE': 3,
            'CONFIRMING': 4,
            'PENDING': 4
          };
          const step = stageMap[data.launchStage];
          if (step !== undefined && step > currentStepIndex) {
            setCurrentStepIndex(step);
          }
        }
      } catch (err) {
        // Ignore polling errors
      }
    };

    poll();
    pollRef.current = setInterval(poll, 1000);
  };

  const addKeyEvent = (message) => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setKeyEvents(prev => {
      // Prevent duplicates
      if (prev.some(e => e.message === message)) return prev;
      return [...prev, { time, message }].slice(-8);
    });
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    addKeyEvent('📋 Address copied to clipboard');
  };

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${
              status === 'success' ? 'bg-green-500' :
              status === 'failed' ? 'bg-red-500' :
              'bg-yellow-500 animate-pulse'
            }`} />
            <h1 className="text-xl font-bold text-white">
              {status === 'success' ? 'Launch Complete!' :
               status === 'failed' ? 'Launch Failed' :
               'Launching Token...'}
            </h1>
          </div>
          <div className="text-gray-400 font-mono">
            {formatTime(elapsedTime)}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 max-w-4xl mx-auto w-full p-6">
        {/* Token Info */}
        {tokenInfo && (
          <div className="bg-gray-900 rounded-xl p-4 mb-6 border border-gray-800 flex items-center gap-4">
            {tokenInfo.image && (
              <img src={tokenInfo.image} alt="" className="w-16 h-16 rounded-lg object-cover" />
            )}
            <div>
              <h2 className="text-2xl font-bold text-white">{tokenInfo.name || 'New Token'}</h2>
              <p className="text-indigo-400 font-semibold">${tokenInfo.symbol || 'TOKEN'}</p>
            </div>
          </div>
        )}

        {/* Progress Steps - FRONT AND CENTER */}
        <div className="bg-gray-900 rounded-xl p-6 mb-6 border border-gray-800">
          <div className="space-y-4">
            {STEPS.map((step, idx) => {
              const isCompleted = idx < currentStepIndex || status === 'success';
              const isCurrent = idx === currentStepIndex && status === 'launching';
              const isPending = idx > currentStepIndex;
              const StepIcon = step.icon;

              return (
                <div 
                  key={step.id}
                  className={`flex items-center gap-4 p-4 rounded-lg transition-all ${
                    isCompleted ? 'bg-green-500/10 border border-green-500/30' :
                    isCurrent ? 'bg-indigo-500/10 border border-indigo-500/50' :
                    'bg-gray-800/30 border border-gray-700/30'
                  }`}
                >
                  {/* Step indicator */}
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${
                    isCompleted ? 'bg-green-500' :
                    isCurrent ? 'bg-indigo-500' :
                    'bg-gray-700'
                  }`}>
                    {isCompleted ? (
                      <CheckIcon className="w-6 h-6 text-white" />
                    ) : isCurrent ? (
                      <ArrowPathIcon className="w-6 h-6 text-white animate-spin" />
                    ) : (
                      <StepIcon className="w-6 h-6 text-gray-400" />
                    )}
                  </div>

                  {/* Step info */}
                  <div className="flex-1">
                    <div className={`font-semibold ${
                      isCompleted ? 'text-green-400' :
                      isCurrent ? 'text-white' :
                      'text-gray-500'
                    }`}>
                      {step.label}
                    </div>
                    {isCompleted && (
                      <div className="text-sm text-green-400/70">{step.successMessage}</div>
                    )}
                    {isCurrent && (
                      <div className="text-sm text-indigo-300">In progress...</div>
                    )}
                  </div>

                  {/* Status badge */}
                  {isCompleted && (
                    <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs font-bold rounded">
                      DONE
                    </span>
                  )}
                  {isCurrent && (
                    <span className="px-2 py-1 bg-indigo-500/20 text-indigo-400 text-xs font-bold rounded animate-pulse">
                      ACTIVE
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* WALLET SAVED - Big confirmation when saved */}
        {walletsSaved && status === 'launching' && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 mb-6 flex items-center gap-3">
            <ShieldCheckIcon className="w-8 h-8 text-green-400 flex-shrink-0" />
            <div>
              <div className="text-green-400 font-bold">Wallets Saved Securely</div>
              <div className="text-green-400/70 text-sm">
                All wallet keys are saved in current-run.json. Even if launch fails, your SOL is recoverable.
              </div>
            </div>
          </div>
        )}

        {/* Mint Address - when available */}
        {mintAddress && (
          <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-4 mb-6">
            <div className="text-indigo-400 text-sm font-semibold mb-2">Token Address</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-gray-900 px-3 py-2 rounded text-white font-mono text-sm break-all">
                {mintAddress}
              </code>
              <button
                onClick={() => copyToClipboard(mintAddress)}
                className="p-2 bg-gray-800 rounded hover:bg-gray-700 transition-colors"
                title="Copy"
              >
                <ClipboardDocumentIcon className="w-5 h-5 text-gray-400" />
              </button>
              <a
                href={`https://pump.fun/${mintAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 bg-gray-800 rounded hover:bg-gray-700 transition-colors"
                title="Open on Pump.fun"
              >
                <ArrowTopRightOnSquareIcon className="w-5 h-5 text-gray-400" />
              </a>
            </div>
          </div>
        )}

        {/* Error message */}
        {status === 'failed' && error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6">
            <div className="flex items-center gap-3">
              <ExclamationTriangleIcon className="w-8 h-8 text-red-400 flex-shrink-0" />
              <div>
                <div className="text-red-400 font-bold">Launch Failed</div>
                <div className="text-red-400/70 text-sm">{error}</div>
                <div className="text-gray-400 text-xs mt-2">
                  Your wallets are saved. Run `npm run gather` to recover SOL.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Key Events Log - Clean and minimal */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="px-4 py-3 bg-gray-800/50 border-b border-gray-800">
            <h3 className="text-sm font-semibold text-gray-400">Activity Log</h3>
          </div>
          <div className="p-4 max-h-48 overflow-y-auto space-y-2">
            {keyEvents.length === 0 ? (
              <div className="text-gray-600 text-sm">Waiting for updates...</div>
            ) : (
              keyEvents.map((event, idx) => (
                <div key={idx} className="flex items-start gap-3 text-sm">
                  <span className="text-gray-600 font-mono text-xs whitespace-nowrap">{event.time}</span>
                  <span className="text-gray-300">{event.message}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Success CTA */}
        {status === 'success' && mintAddress && (
          <div className="mt-6 flex gap-3">
            <a
              href={`https://pump.fun/${mintAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 bg-gradient-to-r from-green-600 to-green-500 text-white font-bold py-3 px-6 rounded-xl text-center hover:from-green-500 hover:to-green-400 transition-all"
            >
              🚀 View on Pump.fun
            </a>
            <a
              href={`https://dexscreener.com/solana/${mintAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 bg-gray-800 text-white font-bold py-3 px-6 rounded-xl text-center hover:bg-gray-700 transition-all border border-gray-700"
            >
              📊 DexScreener
            </a>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="bg-gray-900 border-t border-gray-800 px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between text-sm">
          <div className="text-gray-500">
            {runData?.bundleWalletKeys?.length || 0} bundle wallets • {runData?.holderWalletKeys?.length || 0} holder wallets
          </div>
          <div className="text-gray-600">
            Tip: Don't close this window until launch completes
          </div>
        </div>
      </div>
    </div>
  );
}
