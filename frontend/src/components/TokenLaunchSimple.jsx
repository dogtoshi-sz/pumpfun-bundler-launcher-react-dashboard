import { useState, useEffect, useRef } from 'react';
import {
  RocketLaunchIcon,
  PhotoIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ArrowPathIcon,
  LinkIcon,
  CurrencyDollarIcon,
  WalletIcon,
  Cog6ToothIcon,
  EyeIcon,
  EyeSlashIcon,
  CubeIcon,
  UserGroupIcon,
  ShieldCheckIcon,
  BoltIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolid } from '@heroicons/react/24/solid';
import apiService from '../services/api';
import LaunchProgress from './LaunchProgress';

// ─── STEP INDICATOR ─────────────────────────────────────────
function StepIndicator({ steps, current }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={i} className="flex items-center gap-2">
            <div className={`
              w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all
              ${done ? 'bg-green-500 text-white' : active ? 'bg-purple-600 text-white ring-2 ring-purple-400/50 ring-offset-2 ring-offset-gray-950' : 'bg-gray-800 text-gray-500'}
            `}>
              {done ? <CheckCircleSolid className="w-5 h-5" /> : i + 1}
            </div>
            <span className={`text-sm font-medium hidden sm:block ${active ? 'text-white' : done ? 'text-green-400' : 'text-gray-500'}`}>
              {s}
            </span>
            {i < steps.length - 1 && (
              <div className={`w-12 h-0.5 ${done ? 'bg-green-500' : 'bg-gray-700'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── TOAST SYSTEM ───────────────────────────────────────────
function Toasts({ toasts }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-4 right-4 z-50 space-y-2">
      {toasts.map(t => (
        <div key={t.id} className={`px-4 py-2 rounded-lg text-sm font-medium shadow-xl animate-slide-in
          ${t.type === 'error' ? 'bg-red-500/90 text-white' : 'bg-green-500/90 text-white'}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ─── STATUS DOT ─────────────────────────────────────────────
function StatusDot({ active, warn, label, icon }) {
  const color = warn
    ? 'text-yellow-400'
    : active
      ? 'text-green-400'
      : 'text-red-400';
  const dotColor = warn
    ? 'bg-yellow-400'
    : active
      ? 'bg-green-400'
      : 'bg-red-400/60';

  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      <span className={`${color} opacity-80`}>{icon}</span>
      <span className={`text-[11px] ${active && !warn ? 'text-gray-300' : warn ? 'text-yellow-300/80' : 'text-gray-500'}`}>
        {label}
      </span>
    </div>
  );
}

// ─── MAIN COMPONENT ─────────────────────────────────────────
export default function TokenLaunchSimple({ onLaunch }) {
  // Step wizard
  const [step, setStep] = useState(0);
  const STEPS = ['Token Info', 'Launch Config', 'Review & Launch'];

  // Settings from backend
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // Token info
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);

  // Launch state
  const [launchStage, setLaunchStage] = useState(null);
  const [launchProgress, setLaunchProgress] = useState(0);
  const launchProgressEventSourceRef = useRef(null);

  // Wallet info (fee breakdown)
  const [walletInfo, setWalletInfo] = useState(null);

  // Advanced toggle
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showSocials, setShowSocials] = useState(false);
  const [showPerWalletBundle, setShowPerWalletBundle] = useState(false);
  const [showPerWalletHolder, setShowPerWalletHolder] = useState(false);

  // Per-wallet auto-buy config: { walletId: { delay, safetyThreshold } }
  const [holderAutoBuyConfigs, setHolderAutoBuyConfigs] = useState({});
  // Per-wallet auto-sell config: { walletId: { threshold, enabled } }
  const [holderAutoSellConfigs, setHolderAutoSellConfigs] = useState({});
  const [bundleAutoSellConfigs, setBundleAutoSellConfigs] = useState({});
  const [devAutoSell, setDevAutoSell] = useState({ enabled: false, threshold: '' });
  const [showAutoSell, setShowAutoSell] = useState(false);

  // MEV protection
  const [mevEnabled, setMevEnabled] = useState(true);
  const [mevDelay, setMevDelay] = useState(3);

  // Address
  const [nextAddress, setNextAddress] = useState(null);
  const [addressMode, setAddressMode] = useState(() => localStorage.getItem('tokenLaunchAddressMode') || 'vanity');

  // Master wallet balance
  const [masterBalance, setMasterBalance] = useState(null);
  const [showPrivateKey, setShowPrivateKey] = useState(false);

  // Vanity generator
  const [vanityPool, setVanityPool] = useState({ available: 0, total: 0, generating: false, checked: 0 });
  const [vanityStatus, setVanityStatus] = useState(null); // 'starting' | 'running' | 'stopping' | 'stopped' | 'error'

  // Toasts
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  const showToast = (message, type = 'success') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };

  // Auto-save debounce
  const autoSaveTimeoutRef = useRef(null);

  // ── Lifecycle ─────────────────────────────────────
  useEffect(() => {
    (async () => {
      await loadSettings();
      await Promise.all([loadNextAddress(), loadWalletInfo(), loadVanityPool()]);
      setInitialLoading(false);
    })();
    const vanityPoll = setInterval(loadVanityPool, 15000);
    return () => {
      clearInterval(vanityPoll);
      if (launchProgressEventSourceRef.current) {
        launchProgressEventSourceRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('tokenLaunchAddressMode', addressMode);
    apiService.updateSettings({ VANITY_MODE: addressMode === 'vanity' ? 'true' : 'false' }).catch(() => {});
    if (addressMode === 'random') {
      apiService.generateRandomAddress().then(res => {
        if (res.data?.success) setNextAddress({ address: res.data.address, source: 'Random' });
      }).catch(() => {});
    } else {
      loadNextAddress();
    }
  }, [addressMode]);

  // Reload wallet info when wallet counts / amounts change
  useEffect(() => {
    if (Object.keys(settings).length > 0) {
      const t = setTimeout(loadWalletInfo, 600);
      return () => clearTimeout(t);
    }
  }, [
    settings.BUNDLE_WALLET_COUNT,
    settings.HOLDER_WALLET_COUNT,
    settings.BUNDLE_SWAP_AMOUNTS,
    settings.HOLDER_SWAP_AMOUNTS,
    settings.BUYER_AMOUNT,
    settings.SWAP_AMOUNT,
    settings.HOLDER_WALLET_AMOUNT,
  ]);

  // ── API helpers ───────────────────────────────────
  const loadSettings = async () => {
    try {
      const res = await apiService.getSettings();
      const s = res.data.settings || {};
      if (!s.DIRECT_SEND_MODE && !s.USE_MIXING_WALLETS && !s.USE_MULTI_INTERMEDIARY_SYSTEM) {
        s.DIRECT_SEND_MODE = 'true';
        s.USE_MIXING_WALLETS = 'false';
        s.USE_MULTI_INTERMEDIARY_SYSTEM = 'false';
      }
      setSettings(s);
      if (s.FILE && !imageFile) {
        const filePath = s.FILE;
        if (filePath.startsWith('./image/') || filePath.startsWith('image/')) {
          const filename = filePath.replace(/^\.\/image\//, '').replace(/^image\//, '');
          setImagePreview(`http://localhost:3001/image/${filename}`);
        } else if (filePath.startsWith('http')) {
          setImagePreview(filePath);
        }
      }
      if (s.PRIVATE_KEY) {
        try {
          const walletRes = await apiService.getDeployerWallet();
          setMasterBalance(walletRes.data?.balance ?? walletRes.data?.solBalance ?? null);
        } catch {}
      }
      // No-op: auto-buy is now per-wallet, not a global toggle
      // Restore MEV settings
      try {
        const mevRes = await apiService.getMevProtection?.();
        if (mevRes?.data?.mevProtection) {
          setMevEnabled(mevRes.data.mevProtection.enabled !== false);
          setMevDelay(mevRes.data.mevProtection.confirmationDelaySec || 3);
        }
      } catch {}
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  };

  const loadNextAddress = async () => {
    try {
      const res = await apiService.getNextPumpAddress();
      setNextAddress(res.data?.address !== undefined ? res.data : null);
    } catch { setNextAddress(null); }
  };

  const loadWalletInfo = async () => {
    try {
      const res = await apiService.getLaunchWalletInfo({});
      setWalletInfo(res.data.data);
    } catch {}
  };

  const loadVanityPool = async () => {
    try {
      const res = await apiService.getVanityPoolStatus();
      if (res.data) {
        setVanityPool(prev => ({
          ...prev,
          ...res.data,
          checked: res.data.checked ?? res.data.checkedCount ?? res.data.totalChecked ?? prev.checked ?? 0,
        }));
        if (res.data.generating && vanityStatus !== 'running') setVanityStatus('running');
        if (!res.data.generating && vanityStatus === 'running') setVanityStatus('stopped');
      }
    } catch {}
  };

  const startVanityGenerator = async () => {
    try {
      setVanityStatus('starting');
      const res = await apiService.startVanityGenerator();
      if (res.data.success) {
        setVanityStatus('running');
        setVanityPool(prev => ({ ...prev, generating: true }));
        showToast('Vanity generator started');
        loadVanityPool();
      } else {
        setVanityStatus('error');
        showToast(res.data.error || 'Failed to start', 'error');
      }
    } catch (e) {
      setVanityStatus('error');
      showToast('Failed to start vanity generator', 'error');
    }
  };

  const stopVanityGenerator = async () => {
    try {
      setVanityStatus('stopping');
      const res = await apiService.stopVanityGenerator();
      if (res.data.success) {
        setVanityStatus('stopped');
        setVanityPool(prev => ({ ...prev, generating: false }));
        showToast('Vanity generator stopped');
        loadVanityPool();
      }
    } catch {
      setVanityStatus('error');
    }
  };

  const uploadImage = async () => {
    if (!imageFile) return null;
    try {
      const res = await apiService.uploadImage(imageFile);
      return res.data.filePath;
    } catch (e) {
      showToast('Failed to upload image: ' + e.message, 'error');
      return null;
    }
  };

  // ── Settings change handler with auto-save ────────
  const handleChange = (key, value) => {
    const next = { ...settings, [key]: value };

    if (key === 'BUNDLE_WALLET_COUNT') {
      const count = parseInt(value) || 0;
      const arr = (settings.BUNDLE_SWAP_AMOUNTS || '').split(',').map(a => a.trim()).filter(Boolean);
      const def = settings.SWAP_AMOUNT || '0.01';
      while (arr.length < count) arr.push(def);
      next.BUNDLE_SWAP_AMOUNTS = arr.slice(0, count).join(',');
    }

    if (key === 'HOLDER_WALLET_COUNT') {
      const count = parseInt(value) || 0;
      const arr = (settings.HOLDER_SWAP_AMOUNTS || '').split(',').map(a => a.trim()).filter(Boolean);
      const def = settings.HOLDER_WALLET_AMOUNT || '0.01';
      while (arr.length < count) arr.push(def);
      next.HOLDER_SWAP_AMOUNTS = arr.slice(0, count).join(',');
    }

    setSettings(next);

    if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
    autoSaveTimeoutRef.current = setTimeout(() => {
      const payload = { [key]: value };
      if (next.BUNDLE_SWAP_AMOUNTS !== settings.BUNDLE_SWAP_AMOUNTS) payload.BUNDLE_SWAP_AMOUNTS = next.BUNDLE_SWAP_AMOUNTS;
      if (next.HOLDER_SWAP_AMOUNTS !== settings.HOLDER_SWAP_AMOUNTS) payload.HOLDER_SWAP_AMOUNTS = next.HOLDER_SWAP_AMOUNTS;
      apiService.updateSettings(payload).then(() => {
        showToast(`Saved`);
      }).catch(() => showToast('Failed to save', 'error'));
    }, 500);
  };

  // ── Launch handler ────────────────────────────────
  const handleLaunch = async () => {
    if (!settings.TOKEN_NAME || !settings.TOKEN_SYMBOL || !settings.DESCRIPTION) {
      showToast('Please fill in Token Name, Symbol, and Description', 'error');
      return;
    }
    if (!settings.PRIVATE_KEY || !settings.RPC_ENDPOINT) {
      showToast('Please configure your Private Key and RPC Endpoint in Settings first', 'error');
      return;
    }

    setLoading(true);
    try {
      let settingsToSave = { ...settings };
      if (imageFile) {
        const filePath = await uploadImage();
        if (!filePath) { setLoading(false); return; }
        settingsToSave.FILE = filePath;
        setSettings(settingsToSave);
      }
      await apiService.updateSettings(settingsToSave);

      const launchMode = settings.USE_NORMAL_LAUNCH === 'true' ? 'rapid' : 'bundle';

      // Build auto-sell configs
      let devAutoSellPayload = null;
      if (devAutoSell.enabled && parseFloat(devAutoSell.threshold) > 0) {
        devAutoSellPayload = { threshold: devAutoSell.threshold, enabled: true };
      }

      // Bundle auto-sell: use per-wallet configs
      const bundleAutoSellPayload = Object.keys(bundleAutoSellConfigs).length > 0
        ? bundleAutoSellConfigs : null;

      // Holder auto-sell: use per-wallet configs
      const holderAutoSellPayload = Object.keys(holderAutoSellConfigs).length > 0
        ? holderAutoSellConfigs : null;

      // Build holder auto-buy indices from per-wallet configs
      const holderAutoBuyIndices = Object.keys(holderAutoBuyConfigs)
        .filter(id => id.startsWith('wallet-'))
        .map(id => parseInt(id.replace('wallet-', '')));

      const launchData = {
        addressMode,
        useVanityAddress: addressMode === 'vanity',
        useWarmedWallets: false,
        useWarmedDevWallet: false,
        useWarmedBundleWallets: false,
        useWarmedHolderWallets: false,
        creatorWalletAddress: null,
        bundleWalletAddresses: [],
        holderWalletAddresses: [],
        holderWalletAutoBuyAddresses: [],
        holderWalletAutoBuyIndices: holderAutoBuyIndices,
        holderWalletAutoBuyConfigs: Object.keys(holderAutoBuyConfigs).length > 0 ? holderAutoBuyConfigs : null,
        holderWalletAutoSellConfigs: holderAutoSellPayload,
        bundleWalletAutoSellConfigs: bundleAutoSellPayload,
        devAutoSellConfig: devAutoSellPayload,
        holderWalletAutoBuyDelays: null,
        frontRunThreshold: 0,
      };

      if (onLaunch) {
        onLaunch();
        await new Promise(r => setTimeout(r, 100));
      }

      const progressEventSource = new EventSource('http://localhost:3001/api/launch-progress');
      progressEventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'close') progressEventSource.close();
        } catch {}
      };
      progressEventSource.onerror = () => progressEventSource.close();
      launchProgressEventSourceRef.current = progressEventSource;

      const stageProgress = {
        'INITIALIZING': 5, 'CREATING_WALLETS': 15, 'FUNDING_WALLETS': 30,
        'CREATING_LUT': 45, 'BUILDING_BUNDLE': 60, 'SUBMITTING_BUNDLE': 75,
        'CONFIRMING': 90, 'SUCCESS': 100, 'FAILED': 0
      };

      const res = launchMode === 'rapid'
        ? await apiService.quickLaunchToken({ addressMode, useVanityAddress: addressMode === 'vanity' })
        : await apiService.launchToken(launchData);

      let attempts = 0;
      const maxAttempts = 600;

      const checkLaunchComplete = async () => {
        try {
          const runRes = await apiService.getCurrentRun();
          const currentRun = runRes.data.data;
          if (currentRun) {
            const stage = currentRun.launchStage || 'INITIALIZING';
            setLaunchStage(stage);
            setLaunchProgress(stageProgress[stage] || 0);

            if (currentRun.launchStatus === 'SUCCESS') {
              setLaunchStage('SUCCESS');
              setLaunchProgress(100);
              try {
                const asc = await apiService.getAutoSellConfig();
                const wc = asc?.data?.wallets || {};
                if (Object.values(wc).some(c => c.threshold > 0)) {
                  await apiService.toggleAutoSell(true);
                }
              } catch {}
              if (onLaunch) onLaunch();
              setLoading(false);
              return;
            } else if (currentRun.launchStatus === 'FAILED') {
              setLaunchStage('FAILED');
              setLoading(false);
              showToast(`Launch failed: ${currentRun.failureReason || 'Unknown'}`, 'error');
              return;
            }
          }
          attempts++;
          if (attempts < maxAttempts) setTimeout(checkLaunchComplete, 1000);
          else { setLoading(false); showToast('Launch timeout - check terminal', 'error'); }
        } catch (err) {
          if (err.response?.status === 404) {
            setLoading(false);
            showToast('Launch process exited', 'error');
            return;
          }
          attempts++;
          if (attempts < maxAttempts) setTimeout(checkLaunchComplete, 1000);
          else { setLoading(false); }
        }
      };
      setTimeout(checkLaunchComplete, 1000);
    } catch (error) {
      showToast('Failed: ' + (error.response?.data?.error || error.message), 'error');
      setLoading(false);
      if (launchProgressEventSourceRef.current) {
        launchProgressEventSourceRef.current.close();
        launchProgressEventSourceRef.current = null;
      }
    }
  };

  // ── Launch progress view ──────────────────────────
  if (loading && launchStage) {
    return (
      <LaunchProgress
        onComplete={() => { setLoading(false); setLaunchStage(null); if (onLaunch) onLaunch(); }}
        tokenInfo={{ name: settings.TOKEN_NAME, symbol: settings.TOKEN_SYMBOL, image: imagePreview }}
      />
    );
  }

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <ArrowPathIcon className="w-8 h-8 text-purple-500 animate-spin" />
      </div>
    );
  }

  // ── Derived values ────────────────────────────────
  const bundleCount = parseInt(settings.BUNDLE_WALLET_COUNT) || 0;
  const holderCount = parseInt(settings.HOLDER_WALLET_COUNT) || 0;
  const devBuy = parseFloat(settings.BUYER_AMOUNT) || 0;
  const bundleAmounts = (settings.BUNDLE_SWAP_AMOUNTS || '').split(',').filter(Boolean).map(Number);
  const holderAmounts = (settings.HOLDER_SWAP_AMOUNTS || '').split(',').filter(Boolean).map(Number);
  const totalBundleSol = bundleAmounts.reduce((s, v) => s + v, 0);
  const totalHolderSol = holderAmounts.reduce((s, v) => s + v, 0);
  const jitoFee = parseFloat(settings.JITO_FEE) || 0.001;
  const totalSolNeeded = devBuy + totalBundleSol + totalHolderSol + jitoFee + 0.05;
  const hasBalance = masterBalance !== null && masterBalance >= totalSolNeeded;
  const canLaunch = settings.TOKEN_NAME && settings.TOKEN_SYMBOL && settings.DESCRIPTION && settings.PRIVATE_KEY && settings.RPC_ENDPOINT;
  const isRapid = settings.USE_NORMAL_LAUNCH === 'true';

  // ── Render ────────────────────────────────────────
  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <Toasts toasts={toasts} />

      <StepIndicator steps={STEPS} current={step} />

      {/* ═══════════════ TOKEN CARD — LIVE SUMMARY ═══════════════ */}
      <div className="mb-6 bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="p-4 flex gap-4">
          {/* Token image */}
          {imagePreview ? (
            <img src={imagePreview} alt="" className="w-14 h-14 rounded-xl object-cover border border-gray-700 flex-shrink-0" />
          ) : (
            <div className="w-14 h-14 rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center flex-shrink-0">
              <PhotoIcon className="w-7 h-7 text-gray-600" />
            </div>
          )}

          {/* Token info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-white truncate">
                {settings.TOKEN_NAME || <span className="text-gray-500 font-normal italic">Token Name</span>}
              </h3>
              {settings.TOKEN_SYMBOL && (
                <span className="px-2 py-0.5 text-xs font-semibold bg-purple-500/20 text-purple-400 rounded">
                  ${settings.TOKEN_SYMBOL}
                </span>
              )}
            </div>

            {/* Contract address */}
            <div className="mt-1.5 flex items-center gap-2">
              <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                addressMode === 'vanity' ? 'bg-purple-500/15 text-purple-400' : 'bg-gray-700 text-gray-400'
              }`}>
                {addressMode === 'vanity' ? 'VANITY' : 'RANDOM'}
              </span>
              {nextAddress?.address ? (
                <span className="text-xs font-mono text-gray-400 truncate">{nextAddress.address}</span>
              ) : (
                <span className="text-xs text-gray-500 italic">
                  {addressMode === 'vanity' && vanityPool.available === 0 ? 'No vanity addresses — start generator below' : 'Address will be assigned on launch'}
                </span>
              )}
            </div>

            {/* Status indicators */}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {/* Wallet — always visible, reflects actual state */}
              <StatusDot
                active={!!settings.PRIVATE_KEY}
                label={settings.PRIVATE_KEY
                  ? masterBalance !== null ? `${masterBalance.toFixed(2)} SOL` : 'Wallet connected'
                  : 'Wallet not set'}
                icon={<WalletIcon className="w-3 h-3" />}
                warn={settings.PRIVATE_KEY && masterBalance !== null && !hasBalance}
              />
              {/* Launch config items — only light up green after Step 2 is done */}
              <StatusDot
                active={step >= 2}
                label={isRapid ? 'Quick Launch' : 'Jito Bundle'}
                icon={<RocketLaunchIcon className="w-3 h-3" />}
              />
              <StatusDot
                active={step >= 2 && devBuy > 0}
                label={devBuy > 0 ? `Dev ${devBuy} SOL` : 'Dev buy not set'}
                icon={<CurrencyDollarIcon className="w-3 h-3" />}
              />
              {!isRapid && (
                <StatusDot
                  active={step >= 2 && bundleCount > 0}
                  label={bundleCount > 0 ? `${bundleCount} bundle (${totalBundleSol.toFixed(2)} SOL)` : 'No bundle wallets'}
                  icon={<CubeIcon className="w-3 h-3" />}
                />
              )}
              {!isRapid && (
                <StatusDot
                  active={step >= 2 && holderCount > 0}
                  label={holderCount > 0
                    ? `${holderCount} holder (${totalHolderSol.toFixed(2)} SOL)${Object.keys(holderAutoBuyConfigs).length > 0 ? ' AB' : ''}`
                    : 'No holder wallets'}
                  icon={<UserGroupIcon className="w-3 h-3" />}
                />
              )}
              <StatusDot
                active={step >= 2 && mevEnabled}
                label={mevEnabled ? `MEV protection ${mevDelay}s` : 'MEV protection off'}
                icon={<ShieldCheckIcon className="w-3 h-3" />}
              />
              <StatusDot
                active={step >= 2 && !!(devAutoSell.enabled || Object.keys(bundleAutoSellConfigs).length > 0 || Object.values(holderAutoSellConfigs).some(c => c.enabled && parseFloat(c.threshold) > 0))}
                label={(devAutoSell.enabled || Object.keys(bundleAutoSellConfigs).length > 0 || Object.values(holderAutoSellConfigs).some(c => c.enabled)) ? 'Auto-sell set' : 'Auto-sell off'}
                icon={<BoltIcon className="w-3 h-3" />}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════ VANITY ADDRESS GENERATOR ═══════════════ */}
      <div className={`mb-6 rounded-xl border overflow-hidden transition-all ${
        vanityPool.generating
          ? 'border-purple-500/50 bg-purple-500/5'
          : vanityPool.available > 0
            ? 'border-green-500/30 bg-green-500/5'
            : 'border-yellow-500/30 bg-yellow-500/5'
      }`}>
        <div className="px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                vanityPool.generating ? 'bg-purple-500/20' : vanityPool.available > 0 ? 'bg-green-500/20' : 'bg-yellow-500/20'
              }`}>
                <span className="text-lg">{vanityPool.generating ? '...' : vanityPool.available > 0 ? '\u2713' : '!'}</span>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  Vanity Address Generator
                  {vanityPool.generating && (
                    <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] bg-purple-500/20 text-purple-400 rounded-full font-medium">
                      <ArrowPathIcon className="w-3 h-3 animate-spin" />
                      RUNNING
                    </span>
                  )}
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  <span className={`font-bold ${vanityPool.available > 0 ? 'text-green-400' : 'text-yellow-400'}`}>
                    {vanityPool.available}
                  </span>
                  {' '}vanity addresses ready
                  {vanityPool.total > 0 && <span className="text-gray-500"> ({vanityPool.total} total generated)</span>}
                  {vanityPool.checked > 0 && <span className="text-gray-600"> {'\u00B7'} {vanityPool.checked.toLocaleString()} checked</span>}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {vanityPool.generating ? (
                <button
                  onClick={stopVanityGenerator}
                  disabled={vanityStatus === 'stopping'}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-gray-700 text-white text-sm font-medium rounded-lg transition-all"
                >
                  {vanityStatus === 'stopping' ? 'Stopping...' : 'Stop'}
                </button>
              ) : (
                <button
                  onClick={startVanityGenerator}
                  disabled={vanityStatus === 'starting'}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 text-white text-sm font-medium rounded-lg transition-all"
                >
                  {vanityStatus === 'starting' ? 'Starting...' : 'Start Generator'}
                </button>
              )}
            </div>
          </div>

          {vanityPool.available === 0 && !vanityPool.generating && (
            <div className="mt-3 px-3 py-2.5 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
              <p className="text-xs text-yellow-300/90 leading-relaxed">
                <span className="font-semibold">Tip:</span> To pre-generate vanity addresses (starting with "pump"), start the generator and 
                let it run for a while. The more addresses in the pool, the faster future launches will be &mdash; you won't have to 
                wait for one to generate at launch time.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════ STEP 1: TOKEN INFO ═══════════════ */}
      {step === 0 && (
        <div className="space-y-6 animate-fadeIn">
          <div className="text-center mb-2">
            <h2 className="text-2xl font-bold text-white">Create Your Token</h2>
            <p className="text-gray-400 text-sm mt-1">Set up your token's identity</p>
          </div>

          {/* Image upload */}
          <div className="flex justify-center">
            <label className="relative group cursor-pointer">
              <div className={`w-32 h-32 rounded-2xl border-2 border-dashed flex items-center justify-center overflow-hidden transition-all
                ${imagePreview ? 'border-purple-500/50' : 'border-gray-600 hover:border-purple-500/50'}`}>
                {imagePreview ? (
                  <img src={imagePreview} alt="Token" className="w-full h-full object-cover" />
                ) : (
                  <div className="text-center p-2">
                    <PhotoIcon className="w-10 h-10 text-gray-500 mx-auto" />
                    <span className="text-xs text-gray-500 mt-1 block">Upload Logo</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl flex items-center justify-center">
                  <span className="text-white text-xs font-medium">Change</span>
                </div>
              </div>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files[0];
                  if (file) {
                    setImageFile(file);
                    const reader = new FileReader();
                    reader.onloadend = () => setImagePreview(reader.result);
                    reader.readAsDataURL(file);
                  }
                }}
              />
            </label>
          </div>

          {/* Name & Symbol */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Token Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={settings.TOKEN_NAME || ''}
                onChange={(e) => handleChange('TOKEN_NAME', e.target.value)}
                placeholder="e.g. Doge Coin"
                className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/30 transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Symbol <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={settings.TOKEN_SYMBOL || ''}
                onChange={(e) => handleChange('TOKEN_SYMBOL', e.target.value.toUpperCase().slice(0, 10))}
                placeholder="e.g. DOGE"
                maxLength={10}
                className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 uppercase focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/30 transition-all"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Description <span className="text-red-400">*</span>
            </label>
            <textarea
              value={settings.DESCRIPTION || ''}
              onChange={(e) => handleChange('DESCRIPTION', e.target.value)}
              placeholder="What's your token about?"
              rows={3}
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 resize-none focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/30 transition-all"
            />
          </div>

          {/* Social links — always visible, inline row */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Social Links</label>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="text"
                value={settings.TWITTER || ''}
                onChange={(e) => handleChange('TWITTER', e.target.value)}
                placeholder="@twitter"
                className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-purple-500 transition-all"
              />
              <input
                type="text"
                value={settings.TELEGRAM || ''}
                onChange={(e) => handleChange('TELEGRAM', e.target.value)}
                placeholder="t.me/group"
                className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-purple-500 transition-all"
              />
              <input
                type="text"
                value={settings.WEBSITE || ''}
                onChange={(e) => handleChange('WEBSITE', e.target.value)}
                placeholder="https://..."
                className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-purple-500 transition-all"
              />
            </div>
          </div>

          {/* Next button */}
          <div className="flex justify-end pt-4">
            <button
              onClick={() => setStep(1)}
              disabled={!settings.TOKEN_NAME || !settings.TOKEN_SYMBOL || !settings.DESCRIPTION}
              className="flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold rounded-xl transition-all"
            >
              Next
              <ChevronRightIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════ STEP 2: LAUNCH CONFIG ═══════════════ */}
      {step === 1 && (
        <div className="space-y-6 animate-fadeIn">
          <div className="text-center mb-2">
            <h2 className="text-2xl font-bold text-white">Configure Launch</h2>
            <p className="text-gray-400 text-sm mt-1">Set how you want to launch</p>
          </div>

          {/* Funding wallet */}
          <div className={`bg-gray-900 rounded-xl border p-5 ${settings.PRIVATE_KEY ? 'border-gray-800' : 'border-red-500/40'}`}>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Funding Wallet <span className="text-red-400">*</span>
            </label>
            <p className="text-xs text-gray-500 mb-3">Your master wallet that funds all sub-wallets on launch</p>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type={showPrivateKey ? 'text' : 'password'}
                  value={settings.PRIVATE_KEY || ''}
                  onChange={(e) => handleChange('PRIVATE_KEY', e.target.value)}
                  placeholder="Paste base58 private key"
                  className="w-full px-4 py-2.5 pr-10 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 font-mono focus:outline-none focus:border-purple-500 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPrivateKey(!showPrivateKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                >
                  {showPrivateKey ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                </button>
              </div>
              {settings.PRIVATE_KEY && masterBalance !== null && (
                <span className={`px-3 py-2.5 rounded-lg text-sm font-bold whitespace-nowrap ${
                  hasBalance ? 'bg-green-500/10 text-green-400 border border-green-500/30' : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/30'
                }`}>
                  {masterBalance.toFixed(3)} SOL
                </span>
              )}
            </div>
            {/* RPC Endpoint */}
            <div className="mt-3">
              <input
                type="text"
                value={settings.RPC_ENDPOINT || ''}
                onChange={(e) => handleChange('RPC_ENDPOINT', e.target.value)}
                placeholder="RPC Endpoint (e.g. https://mainnet.helius-rpc.com/?api-key=...)"
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 font-mono focus:outline-none focus:border-purple-500 transition-all"
              />
            </div>
            {!settings.PRIVATE_KEY && (
              <p className="text-xs text-red-400/80 mt-2">Required — this wallet pays for all launch transactions. Fees are returned after launch.</p>
            )}
          </div>

          {/* Launch mode */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
            <label className="block text-sm font-medium text-gray-300 mb-3">Launch Mode</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleChange('USE_NORMAL_LAUNCH', 'false')}
                className={`p-4 rounded-xl border-2 transition-all text-left
                  ${!isRapid ? 'border-purple-500 bg-purple-500/10' : 'border-gray-700 hover:border-gray-600 bg-gray-800/50'}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <RocketLaunchIcon className={`w-5 h-5 ${!isRapid ? 'text-purple-400' : 'text-gray-400'}`} />
                  <span className={`font-semibold ${!isRapid ? 'text-white' : 'text-gray-300'}`}>Bundle</span>
                </div>
                <p className="text-xs text-gray-400">Multi-wallet Jito bundle. All buys land in the same block.</p>
              </button>
              <button
                onClick={() => handleChange('USE_NORMAL_LAUNCH', 'true')}
                className={`p-4 rounded-xl border-2 transition-all text-left
                  ${isRapid ? 'border-purple-500 bg-purple-500/10' : 'border-gray-700 hover:border-gray-600 bg-gray-800/50'}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-lg ${isRapid ? '' : 'grayscale opacity-50'}`}>{'\u26A1'}</span>
                  <span className={`font-semibold ${isRapid ? 'text-white' : 'text-gray-300'}`}>Quick</span>
                </div>
                <p className="text-xs text-gray-400">Single wallet, fast launch (~5 sec). No Jito bundle.</p>
              </button>
            </div>
          </div>

          {/* Dev buy amount */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Dev Buy Amount (SOL)
            </label>
            <p className="text-xs text-gray-500 mb-3">How much SOL the creator wallet buys on launch</p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={settings.BUYER_AMOUNT || ''}
                onChange={(e) => handleChange('BUYER_AMOUNT', e.target.value)}
                placeholder="1.0"
                step="0.1"
                min="0"
                className="flex-1 px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 transition-all"
              />
              <span className="text-gray-400 font-medium">SOL</span>
            </div>
            <div className="flex gap-2 mt-3">
              {[0.5, 1, 2, 5].map(v => (
                <button key={v} onClick={() => handleChange('BUYER_AMOUNT', v.toString())}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                    ${parseFloat(settings.BUYER_AMOUNT) === v
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                  {v} SOL
                </button>
              ))}
            </div>
          </div>

          {/* Bundle wallet config (only in bundle mode) */}
          {!isRapid && (
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-5">
              {/* ── Bundle Wallets ── */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Bundle Wallets</label>
                <p className="text-xs text-gray-500 mb-3">Extra wallets that buy in the same Jito bundle as the dev</p>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={settings.BUNDLE_WALLET_COUNT || '0'}
                    onChange={(e) => handleChange('BUNDLE_WALLET_COUNT', e.target.value)}
                    min="0" max="10"
                    className="w-24 px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white text-center focus:outline-none focus:border-purple-500 transition-all"
                  />
                  <span className="text-gray-400 text-sm">wallets</span>
                </div>

                {bundleCount > 0 && (
                  <div className="mt-3 space-y-3">
                    {/* Fill All shortcut */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">Fill all:</span>
                      {[0.1, 0.5, 1, 2].map(v => (
                        <button key={v} onClick={() => {
                          handleChange('SWAP_AMOUNT', v.toString());
                          handleChange('BUNDLE_SWAP_AMOUNTS', Array(bundleCount).fill(v).join(','));
                        }}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-800 text-gray-400 hover:bg-gray-700 transition-all">
                          {v} SOL
                        </button>
                      ))}
                    </div>

                    {/* Per-wallet toggle */}
                    <button
                      onClick={() => setShowPerWalletBundle(!showPerWalletBundle)}
                      className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors"
                    >
                      {showPerWalletBundle ? <ChevronUpIcon className="w-3.5 h-3.5" /> : <ChevronDownIcon className="w-3.5 h-3.5" />}
                      {showPerWalletBundle ? 'Hide' : 'Set'} per-wallet amounts
                    </button>

                    {showPerWalletBundle ? (
                      <div className="space-y-2">
                        {bundleAmounts.map((amt, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 w-20">Bundle {i + 1}</span>
                            <input
                              type="number"
                              value={amt || ''}
                              onChange={(e) => {
                                const arr = [...bundleAmounts];
                                arr[i] = parseFloat(e.target.value) || 0;
                                handleChange('BUNDLE_SWAP_AMOUNTS', arr.join(','));
                              }}
                              step="0.01" min="0"
                              className="w-24 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm text-center focus:outline-none focus:border-purple-500 transition-all"
                            />
                            <span className="text-xs text-gray-500">SOL</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-gray-400">
                        <span>{bundleCount} wallets</span>
                        <span className="text-gray-600">&times;</span>
                        <span>{bundleAmounts.length > 0 && new Set(bundleAmounts).size === 1 ? `${bundleAmounts[0]} SOL each` : `${totalBundleSol.toFixed(3)} SOL total`}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="border-t border-gray-800" />

              {/* ── Holder Wallets ── */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-gray-300">Holder Wallets (Post-Launch)</label>
                  {holderCount > 0 && (
                    <span className="text-xs text-gray-500">{holderCount} wallets &middot; {totalHolderSol.toFixed(2)} SOL</span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mb-3">Additional wallets created and funded on launch. Configure auto-buy and auto-sell per wallet.</p>

                <div className="flex items-center gap-3 mb-3">
                  <input
                    type="number"
                    value={settings.HOLDER_WALLET_COUNT || '0'}
                    onChange={(e) => handleChange('HOLDER_WALLET_COUNT', e.target.value)}
                    min="0" max="50"
                    className="w-24 px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white text-center focus:outline-none focus:border-purple-500 transition-all"
                  />
                  <span className="text-gray-400 text-sm">wallets</span>
                </div>

                {holderCount > 0 && (
                  <div className="space-y-3">
                    {/* Quick Fill All */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">Fill all:</span>
                      {[0.1, 0.5, 1, 2].map(v => (
                        <button key={v} onClick={() => {
                          handleChange('HOLDER_WALLET_AMOUNT', v.toString());
                          handleChange('HOLDER_SWAP_AMOUNTS', Array(holderCount).fill(v).join(','));
                        }}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-800 text-gray-400 hover:bg-gray-700 transition-all">
                          {v} SOL
                        </button>
                      ))}
                    </div>

                    {/* Bulk auto-buy/sell shortcuts */}
                    <div className="flex flex-wrap items-center gap-2">
                      <button onClick={() => {
                        const configs = {};
                        for (let i = 0; i < holderCount; i++) configs[`wallet-${i + 1}`] = { delay: 0, safetyThreshold: 0 };
                        setHolderAutoBuyConfigs(configs);
                        handleChange('AUTO_HOLDER_WALLET_BUY', 'true');
                      }} className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-green-600/20 text-green-400 border border-green-600/30 hover:bg-green-600/30 transition-all">
                        Enable All Auto-Buy
                      </button>
                      <button onClick={() => {
                        const configs = {};
                        for (let i = 0; i < holderCount; i++) {
                          const delay = i * 0.5;
                          configs[`wallet-${i + 1}`] = { delay, safetyThreshold: 0 };
                        }
                        setHolderAutoBuyConfigs(configs);
                        handleChange('AUTO_HOLDER_WALLET_BUY', 'true');
                      }} className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-purple-600/20 text-purple-400 border border-purple-600/30 hover:bg-purple-600/30 transition-all">
                        Staggered Auto-Buy (0.5s apart)
                      </button>
                      <button onClick={() => {
                        setHolderAutoBuyConfigs({});
                        handleChange('AUTO_HOLDER_WALLET_BUY', 'false');
                      }} className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-gray-700 text-gray-400 hover:bg-gray-600 transition-all">
                        Disable All Auto-Buy
                      </button>
                    </div>

                    {/* Per-wallet toggle */}
                    <button
                      onClick={() => setShowPerWalletHolder(!showPerWalletHolder)}
                      className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors"
                    >
                      {showPerWalletHolder ? <ChevronUpIcon className="w-3.5 h-3.5" /> : <ChevronDownIcon className="w-3.5 h-3.5" />}
                      {showPerWalletHolder ? 'Hide' : 'Show'} per-wallet settings
                    </button>

                    {showPerWalletHolder ? (
                      <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                        {Array.from({ length: holderCount }, (_, i) => {
                          const walletId = `wallet-${i + 1}`;
                          const currentAmount = holderAmounts[i] || settings.HOLDER_WALLET_AMOUNT || '0.5';
                          const buyConfig = holderAutoBuyConfigs[walletId] || { delay: 0, safetyThreshold: 0 };
                          const isAutoBuyEnabled = holderAutoBuyConfigs[walletId] !== undefined;
                          const sellConfig = holderAutoSellConfigs[walletId] || { threshold: '', enabled: false };
                          const isAutoSellEnabled = parseFloat(sellConfig.threshold) > 0 && sellConfig.enabled;

                          return (
                            <div key={i} className={`p-4 rounded-xl border transition-all ${
                              isAutoBuyEnabled || isAutoSellEnabled
                                ? 'bg-yellow-900/10 border-yellow-600/40'
                                : 'bg-gray-800/40 border-gray-700'
                            }`}>
                              {/* Header */}
                              <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                  <UserGroupIcon className={`w-4 h-4 ${isAutoBuyEnabled ? 'text-yellow-400' : 'text-gray-500'}`} />
                                  <span className="text-sm font-bold text-yellow-400">Holder #{i + 1}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  {isAutoBuyEnabled && (
                                    <span className="text-[10px] px-1.5 py-0.5 bg-green-600/30 text-green-400 rounded font-medium">
                                      AUTO-BUY {buyConfig.delay > 0 ? `${buyConfig.delay}s` : ''}
                                    </span>
                                  )}
                                  {isAutoSellEnabled && (
                                    <span className="text-[10px] px-1.5 py-0.5 bg-red-600/30 text-red-400 rounded font-medium">
                                      SELL @ {sellConfig.threshold} SOL
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Buy Amount */}
                              <div className="mb-3">
                                <label className="block text-xs text-gray-400 mb-1 font-medium">Buy Amount (SOL)</label>
                                <input
                                  type="number"
                                  step="0.01" min="0"
                                  value={currentAmount}
                                  onChange={(e) => {
                                    const arr = Array.from({ length: holderCount }, (_, idx) =>
                                      idx === i ? (e.target.value || '0') : (holderAmounts[idx] || settings.HOLDER_WALLET_AMOUNT || '0.5')
                                    );
                                    handleChange('HOLDER_SWAP_AMOUNTS', arr.join(','));
                                  }}
                                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500 transition-all"
                                />
                              </div>

                              {/* Auto-Buy & Auto-Sell side by side */}
                              <div className="grid grid-cols-2 gap-3">
                                {/* Auto-Buy */}
                                <div className={`p-3 rounded-lg border transition-all ${
                                  isAutoBuyEnabled ? 'bg-green-900/20 border-green-600/40' : 'bg-gray-900/50 border-gray-700 hover:border-gray-600'
                                }`}>
                                  <div className="flex items-center justify-between mb-1.5">
                                    <label className="text-xs font-semibold text-gray-300 flex items-center gap-1">
                                      <RocketLaunchIcon className={`w-3.5 h-3.5 ${isAutoBuyEnabled ? 'text-green-400' : 'text-gray-500'}`} />
                                      Auto-Buy
                                    </label>
                                    <button type="button" onClick={() => {
                                      const next = { ...holderAutoBuyConfigs };
                                      if (isAutoBuyEnabled) delete next[walletId];
                                      else next[walletId] = { delay: 0, safetyThreshold: 0 };
                                      setHolderAutoBuyConfigs(next);
                                    }} className={`relative w-9 h-5 rounded-full transition-colors ${isAutoBuyEnabled ? 'bg-green-500' : 'bg-gray-600'}`}>
                                      <div className={`absolute w-3.5 h-3.5 rounded-full bg-white top-[3px] transition-transform ${isAutoBuyEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                                    </button>
                                  </div>

                                  {isAutoBuyEnabled ? (
                                    <div className="space-y-2 mt-2 pt-2 border-t border-green-700/40">
                                      <div>
                                        <label className="block text-[10px] text-gray-500 mb-1">Delay after launch (sec)</label>
                                        <div className="flex gap-1">
                                          <input type="number" step="0.1" min="0" max="60" value={buyConfig.delay}
                                            onChange={(e) => {
                                              const next = { ...holderAutoBuyConfigs };
                                              next[walletId] = { ...buyConfig, delay: parseFloat(e.target.value) || 0 };
                                              setHolderAutoBuyConfigs(next);
                                            }}
                                            className="flex-1 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-white text-xs text-center focus:outline-none focus:border-green-500"
                                          />
                                          {[0, 1, 3].map(d => (
                                            <button key={d} type="button" onClick={() => {
                                              const next = { ...holderAutoBuyConfigs };
                                              next[walletId] = { ...buyConfig, delay: d };
                                              setHolderAutoBuyConfigs(next);
                                            }} className={`px-1.5 py-1 text-[10px] rounded font-medium transition-all ${
                                              buyConfig.delay === d ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                                            }`}>{d}s</button>
                                          ))}
                                        </div>
                                      </div>
                                      <div>
                                        <label className="block text-[10px] text-gray-500 mb-1">Skip if external vol &gt; (SOL)</label>
                                        <div className="flex gap-1">
                                          <input type="number" step="0.1" min="0" value={buyConfig.safetyThreshold || 0}
                                            onChange={(e) => {
                                              const next = { ...holderAutoBuyConfigs };
                                              next[walletId] = { ...buyConfig, safetyThreshold: parseFloat(e.target.value) || 0 };
                                              setHolderAutoBuyConfigs(next);
                                            }}
                                            placeholder="0 = off"
                                            className="flex-1 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-white text-xs text-center focus:outline-none focus:border-green-500"
                                          />
                                          {[0.2, 0.5].map(t => (
                                            <button key={t} type="button" onClick={() => {
                                              const next = { ...holderAutoBuyConfigs };
                                              next[walletId] = { ...buyConfig, safetyThreshold: t };
                                              setHolderAutoBuyConfigs(next);
                                            }} className="px-1.5 py-1 text-[10px] bg-orange-600 hover:bg-orange-700 text-white rounded">{t}</button>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  ) : (
                                    <p className="text-[10px] text-gray-500 mt-1">Wallet gets funded but won't auto-buy</p>
                                  )}
                                </div>

                                {/* Auto-Sell */}
                                <div className={`p-3 rounded-lg border transition-all ${
                                  isAutoSellEnabled ? 'bg-red-900/20 border-red-600/40' : 'bg-gray-900/50 border-gray-700 hover:border-gray-600'
                                }`}>
                                  <div className="flex items-center justify-between mb-1.5">
                                    <label className="text-xs font-semibold text-gray-300 flex items-center gap-1">
                                      <CurrencyDollarIcon className={`w-3.5 h-3.5 ${isAutoSellEnabled ? 'text-red-400' : 'text-gray-500'}`} />
                                      Auto-Sell
                                    </label>
                                    <button type="button" onClick={() => {
                                      const next = { ...holderAutoSellConfigs };
                                      if (isAutoSellEnabled) {
                                        next[walletId] = { threshold: '', enabled: false };
                                      } else {
                                        const buyAmt = parseFloat(currentAmount) || 0.5;
                                        next[walletId] = { threshold: (buyAmt * 2).toFixed(1), enabled: true };
                                      }
                                      setHolderAutoSellConfigs(next);
                                    }} className={`relative w-9 h-5 rounded-full transition-colors ${isAutoSellEnabled ? 'bg-red-500' : 'bg-gray-600'}`}>
                                      <div className={`absolute w-3.5 h-3.5 rounded-full bg-white top-[3px] transition-transform ${isAutoSellEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                                    </button>
                                  </div>

                                  {isAutoSellEnabled ? (
                                    <div className="space-y-2 mt-2 pt-2 border-t border-red-700/40">
                                      <div>
                                        <label className="block text-[10px] text-gray-500 mb-1">Sell when external vol reaches (SOL)</label>
                                        <div className="flex gap-1">
                                          <input type="number" step="0.1" min="0.1" value={sellConfig.threshold}
                                            onChange={(e) => {
                                              const next = { ...holderAutoSellConfigs };
                                              const val = e.target.value;
                                              next[walletId] = { threshold: val, enabled: parseFloat(val) > 0 };
                                              setHolderAutoSellConfigs(next);
                                            }}
                                            className="flex-1 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-white text-xs text-center focus:outline-none focus:border-red-500"
                                          />
                                          {[2, 3].map(mult => (
                                            <button key={mult} type="button" onClick={() => {
                                              const next = { ...holderAutoSellConfigs };
                                              const buyAmt = parseFloat(currentAmount) || 0.5;
                                              next[walletId] = { threshold: (buyAmt * mult).toFixed(1), enabled: true };
                                              setHolderAutoSellConfigs(next);
                                            }} className="px-1.5 py-1 text-[10px] bg-red-600 hover:bg-red-700 text-white rounded">{mult}x</button>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  ) : (
                                    <p className="text-[10px] text-gray-500 mt-1">Enable to auto-sell on external volume</p>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-sm text-gray-400">
                        <div className="flex items-center gap-2">
                          <span>{holderCount} wallets</span>
                          <span className="text-gray-600">&times;</span>
                          <span>{holderAmounts.length > 0 && new Set(holderAmounts).size === 1 ? `${holderAmounts[0]} SOL each` : `${totalHolderSol.toFixed(3)} SOL total`}</span>
                        </div>
                        {Object.keys(holderAutoBuyConfigs).length > 0 && (
                          <div className="mt-1 text-[11px] text-green-400/80">
                            {Object.keys(holderAutoBuyConfigs).length} wallet(s) with auto-buy enabled
                          </div>
                        )}
                        {Object.values(holderAutoSellConfigs).filter(c => c.enabled && parseFloat(c.threshold) > 0).length > 0 && (
                          <div className="mt-0.5 text-[11px] text-red-400/80">
                            {Object.values(holderAutoSellConfigs).filter(c => c.enabled && parseFloat(c.threshold) > 0).length} wallet(s) with auto-sell triggers
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Auto-Sell & MEV Protection ── */}
          {!isRapid && (bundleCount > 0 || holderCount > 0) && (
            <div className="border border-gray-800 rounded-xl overflow-hidden">
              <button
                onClick={() => setShowAutoSell(!showAutoSell)}
                className="w-full flex items-center justify-between px-5 py-3 text-sm text-gray-400 hover:text-gray-300 hover:bg-gray-900/50 transition-all"
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">{'\u26A1'}</span>
                  Dev & Bundle Auto-Sell + MEV Protection
                  {(devAutoSell.enabled || Object.keys(bundleAutoSellConfigs).length > 0) && (
                    <span className="px-1.5 py-0.5 text-[10px] bg-green-500/20 text-green-400 rounded font-medium">CONFIGURED</span>
                  )}
                </div>
                {showAutoSell ? <ChevronUpIcon className="w-4 h-4" /> : <ChevronDownIcon className="w-4 h-4" />}
              </button>
              {showAutoSell && (
                <div className="px-5 pb-5 space-y-4 bg-gray-900/30">
                  <p className="text-xs text-gray-500">
                    Auto-sell triggers when net external buys (others buying your token) reach a threshold.
                    Holder wallet auto-sell is configured per-wallet above.
                  </p>

                  {/* DEV auto-sell */}
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-24">Dev Wallet</span>
                    <input
                      type="number"
                      value={devAutoSell.threshold}
                      onChange={(e) => setDevAutoSell({ enabled: !!e.target.value, threshold: e.target.value })}
                      placeholder="Off"
                      step="0.5" min="0"
                      className="w-20 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs text-center focus:outline-none focus:border-purple-500 transition-all"
                    />
                    <span className="text-xs text-gray-500">SOL threshold</span>
                  </div>

                  {/* Bundle auto-sell */}
                  {bundleCount > 0 && (
                    <>
                      <div className="text-[10px] text-gray-600 uppercase tracking-wider">Bundle Wallets</div>
                      {bundleAmounts.map((amt, i) => {
                        const bId = `bundle-${i}`;
                        const bConfig = bundleAutoSellConfigs[bId] || { threshold: '', enabled: false };
                        const bEnabled = parseFloat(bConfig.threshold) > 0 && bConfig.enabled;
                        return (
                          <div key={bId} className="flex items-center gap-3">
                            <span className="text-xs text-gray-400 w-24">Bundle {i + 1}</span>
                            <input
                              type="number"
                              value={bConfig.threshold}
                              onChange={(e) => {
                                const next = { ...bundleAutoSellConfigs };
                                const val = e.target.value;
                                next[bId] = { threshold: val, enabled: parseFloat(val) > 0 };
                                setBundleAutoSellConfigs(next);
                              }}
                              placeholder="Off"
                              step="0.5" min="0"
                              className={`w-20 px-2 py-1.5 border rounded-lg text-white text-xs text-center focus:outline-none transition-all ${
                                bEnabled ? 'bg-red-900/30 border-red-600/40 focus:border-red-500' : 'bg-gray-800 border-gray-700 focus:border-purple-500'
                              }`}
                            />
                            <span className="text-xs text-gray-500">SOL</span>
                            {bEnabled && <span className="text-[10px] text-red-400">active</span>}
                          </div>
                        );
                      })}
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-gray-500">Quick set all bundle:</span>
                        {[1, 2, 5].map(t => (
                          <button key={t} onClick={() => {
                            const next = {};
                            for (let i = 0; i < bundleCount; i++) next[`bundle-${i}`] = { threshold: t, enabled: true };
                            setBundleAutoSellConfigs(next);
                          }} className="px-2 py-1 text-[10px] bg-gray-700 text-gray-400 hover:bg-gray-600 rounded">{t} SOL</button>
                        ))}
                      </div>
                    </>
                  )}

                  <div className="border-t border-gray-800 pt-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-400">MEV Protection</span>
                        <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${mevEnabled ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-500'}`}>
                          {mevEnabled ? 'ON' : 'OFF'}
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          const next = !mevEnabled;
                          setMevEnabled(next);
                          apiService.setMevProtection({ enabled: next, confirmationDelaySec: mevDelay }).catch(() => {});
                        }}
                        className={`relative w-10 h-5 rounded-full transition-colors ${mevEnabled ? 'bg-green-600' : 'bg-gray-700'}`}
                      >
                        <div className={`absolute w-4 h-4 rounded-full bg-white top-0.5 transition-transform ${mevEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                      </button>
                    </div>
                    {mevEnabled && (
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-[11px] text-gray-500">Confirm delay:</span>
                        {[2, 3, 5].map(v => (
                          <button key={v} onClick={() => {
                            setMevDelay(v);
                            apiService.setMevProtection({ enabled: true, confirmationDelaySec: v }).catch(() => {});
                          }}
                            className={`px-2 py-1 rounded text-[11px] font-medium transition-all
                              ${mevDelay === v ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-500 hover:bg-gray-700'}`}>
                            {v}s
                          </button>
                        ))}
                      </div>
                    )}
                    <p className="text-[11px] text-gray-500 mt-2">Waits before selling to filter out MEV bots that buy then immediately dump</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Advanced settings */}
          <div className="border border-gray-800 rounded-xl overflow-hidden">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between px-5 py-3 text-sm text-gray-400 hover:text-gray-300 hover:bg-gray-900/50 transition-all"
            >
              <div className="flex items-center gap-2">
                <Cog6ToothIcon className="w-4 h-4" />
                Advanced Settings
              </div>
              {showAdvanced ? <ChevronUpIcon className="w-4 h-4" /> : <ChevronDownIcon className="w-4 h-4" />}
            </button>
            {showAdvanced && (
              <div className="px-5 pb-5 space-y-4 bg-gray-900/30">
                {/* Jito Fee */}
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Jito Tip (SOL)</label>
                  <input
                    type="number"
                    value={settings.JITO_FEE || '0.001'}
                    onChange={(e) => handleChange('JITO_FEE', e.target.value)}
                    step="0.0001"
                    min="0"
                    className="w-40 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500 transition-all"
                  />
                </div>

                {/* Funding method */}
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Funding Method</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        handleChange('DIRECT_SEND_MODE', 'true');
                        handleChange('USE_MIXING_WALLETS', 'false');
                        handleChange('USE_MULTI_INTERMEDIARY_SYSTEM', 'false');
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                        ${settings.DIRECT_SEND_MODE === 'true' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                      Direct
                    </button>
                    <button
                      onClick={() => {
                        handleChange('DIRECT_SEND_MODE', 'false');
                        handleChange('USE_MIXING_WALLETS', 'true');
                        handleChange('USE_MULTI_INTERMEDIARY_SYSTEM', 'false');
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                        ${settings.USE_MIXING_WALLETS === 'true' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                      Privacy (Mixing)
                    </button>
                  </div>
                </div>

                {/* Address type */}
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Contract Address</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setAddressMode('vanity')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                        ${addressMode === 'vanity' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                      Vanity (pump...)
                    </button>
                    <button
                      onClick={() => setAddressMode('random')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                        ${addressMode === 'random' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                      Random
                    </button>
                  </div>
                  {nextAddress?.address && (
                    <p className="text-xs text-gray-500 mt-1 font-mono truncate">{nextAddress.address}</p>
                  )}
                </div>

                {/* Multi-intermediary hops */}
                {settings.USE_MULTI_INTERMEDIARY_SYSTEM === 'true' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">Intermediary Hops</label>
                    <input
                      type="number"
                      value={settings.NUM_INTERMEDIARY_HOPS || '2'}
                      onChange={(e) => handleChange('NUM_INTERMEDIARY_HOPS', e.target.value)}
                      min="1" max="5"
                      className="w-20 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm text-center focus:outline-none focus:border-purple-500 transition-all"
                    />
                  </div>
                )}

                {/* Simulation mode */}
                <div className="flex items-center justify-between pt-2 border-t border-gray-800">
                  <div>
                    <span className="text-xs font-medium text-gray-400">Simulation Mode</span>
                    <p className="text-[11px] text-gray-500">Dry run — everything executes without sending real transactions</p>
                  </div>
                  <button
                    onClick={() => handleChange('SIMULATE_ONLY', settings.SIMULATE_ONLY === 'true' ? 'false' : 'true')}
                    className={`relative w-10 h-5 rounded-full transition-colors ${settings.SIMULATE_ONLY === 'true' ? 'bg-yellow-600' : 'bg-gray-700'}`}
                  >
                    <div className={`absolute w-4 h-4 rounded-full bg-white top-0.5 transition-transform ${settings.SIMULATE_ONLY === 'true' ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </div>

                {/* WebSocket RPC */}
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">WebSocket RPC (optional)</label>
                  <input
                    type="text"
                    value={settings.RPC_WEBSOCKET_ENDPOINT || ''}
                    onChange={(e) => handleChange('RPC_WEBSOCKET_ENDPOINT', e.target.value)}
                    placeholder="wss://mainnet.helius-rpc.com/?api-key=..."
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm font-mono placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-all"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="flex justify-between pt-4">
            <button onClick={() => setStep(0)}
              className="flex items-center gap-2 px-5 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl transition-all">
              <ChevronLeftIcon className="w-5 h-5" />
              Back
            </button>
            <button onClick={() => setStep(2)}
              className="flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl transition-all">
              Review
              <ChevronRightIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════ STEP 3: REVIEW & LAUNCH ═══════════════ */}
      {step === 2 && (
        <div className="space-y-6 animate-fadeIn">
          <div className="text-center mb-2">
            <h2 className="text-2xl font-bold text-white">Review & Launch</h2>
            <p className="text-gray-400 text-sm mt-1">Double-check everything before you launch</p>
          </div>

          {/* Token preview */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
            <div className="flex items-center gap-4">
              {imagePreview ? (
                <img src={imagePreview} alt="" className="w-16 h-16 rounded-xl object-cover border border-gray-700" />
              ) : (
                <div className="w-16 h-16 rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center">
                  <PhotoIcon className="w-8 h-8 text-gray-600" />
                </div>
              )}
              <div>
                <h3 className="text-xl font-bold text-white">{settings.TOKEN_NAME || 'Untitled'}</h3>
                <p className="text-purple-400 font-semibold">${settings.TOKEN_SYMBOL || '???'}</p>
                <p className="text-gray-400 text-xs mt-1 line-clamp-2">{settings.DESCRIPTION || 'No description'}</p>
              </div>
            </div>
            {(settings.TWITTER || settings.TELEGRAM || settings.WEBSITE) && (
              <div className="flex gap-4 mt-3 pt-3 border-t border-gray-800 text-xs text-gray-500">
                {settings.TWITTER && <span>Twitter: {settings.TWITTER}</span>}
                {settings.TELEGRAM && <span>Telegram: {settings.TELEGRAM}</span>}
                {settings.WEBSITE && <span>Website: {settings.WEBSITE}</span>}
              </div>
            )}
          </div>

          {/* Launch config summary */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
            <h4 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
              <Cog6ToothIcon className="w-4 h-4 text-gray-500" />
              Launch Configuration
            </h4>
            <div className="space-y-3">
              <Row label="Mode" value={isRapid ? 'Quick (single wallet)' : 'Bundle (Jito)'} />
              <Row label="Dev Buy" value={`${devBuy} SOL`} />
              {!isRapid && (
                <>
                  <Row label="Bundle Wallets" value={bundleCount > 0
                    ? new Set(bundleAmounts).size === 1
                      ? `${bundleCount} x ${bundleAmounts[0]} SOL = ${totalBundleSol.toFixed(3)} SOL`
                      : `${bundleCount} wallets, ${totalBundleSol.toFixed(3)} SOL total (varied)`
                    : 'None'} />
                  <Row label="Holder Wallets" value={holderCount > 0
                    ? new Set(holderAmounts).size === 1
                      ? `${holderCount} x ${holderAmounts[0]} SOL = ${totalHolderSol.toFixed(3)} SOL`
                      : `${holderCount} wallets, ${totalHolderSol.toFixed(3)} SOL total (varied)`
                    : 'None'} />
                  {holderCount > 0 && (
                    <Row label="Holder Auto-Buy" value={
                      Object.keys(holderAutoBuyConfigs).length > 0
                        ? `${Object.keys(holderAutoBuyConfigs).length} wallet(s) enabled`
                        : 'None (fund only)'
                    } />
                  )}
                  {(devAutoSell.enabled || Object.keys(bundleAutoSellConfigs).length > 0 || Object.values(holderAutoSellConfigs).some(c => c.enabled)) && (
                    <Row label="Auto-Sell" value="Configured" />
                  )}
                  <Row label="MEV Protection" value={mevEnabled ? `ON (${mevDelay}s delay)` : 'OFF'} />
                </>
              )}
              <Row label="Address" value={addressMode === 'vanity' ? 'Vanity (pump...)' : 'Random'} />
              {nextAddress?.address && (
                <Row label="" value={<span className="font-mono text-xs">{nextAddress.address}</span>} />
              )}
            </div>
          </div>

          {/* Cost breakdown */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
            <h4 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
              <CurrencyDollarIcon className="w-4 h-4 text-gray-500" />
              Cost Estimate
            </h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-gray-400">
                <span>Dev Buy</span>
                <span>{devBuy} SOL</span>
              </div>
              {!isRapid && bundleCount > 0 && (
                <div className="flex justify-between text-gray-400">
                  <span>Bundle Buys</span>
                  <span>{totalBundleSol.toFixed(3)} SOL</span>
                </div>
              )}
              {!isRapid && holderCount > 0 && (
                <div className="flex justify-between text-gray-400">
                  <span>Holder Buys</span>
                  <span>{totalHolderSol.toFixed(3)} SOL</span>
                </div>
              )}
              <div className="flex justify-between text-gray-400">
                <span>Jito Tip + Fees</span>
                <span>~{(jitoFee + 0.05).toFixed(4)} SOL</span>
              </div>
              <div className="border-t border-gray-700 pt-2 flex justify-between font-bold text-white">
                <span>Total</span>
                <span>~{totalSolNeeded.toFixed(3)} SOL</span>
              </div>
            </div>
            <p className="text-[11px] text-gray-500 mt-3 leading-relaxed">
              Fees are used as a gas buffer for each wallet and are returned back to you after launch. 
              You can recover them from the Trading Terminal or by running the gather command.
            </p>
          </div>

          {/* Master wallet balance */}
          <div className={`rounded-xl border p-4 flex items-center justify-between
            ${!settings.PRIVATE_KEY
              ? 'bg-red-500/10 border-red-500/30'
              : hasBalance
                ? 'bg-green-500/10 border-green-500/30'
                : masterBalance !== null
                  ? 'bg-yellow-500/10 border-yellow-500/30'
                  : 'bg-gray-900 border-gray-800'}`}>
            <div className="flex items-center gap-3">
              <WalletIcon className="w-5 h-5 text-gray-400" />
              <div>
                <span className="text-sm font-medium text-gray-300">Master Wallet</span>
                {!settings.PRIVATE_KEY ? (
                  <p className="text-xs text-red-400">Not configured &mdash; go back to Step 2</p>
                ) : masterBalance !== null ? (
                  <p className="text-xs text-gray-500">{masterBalance.toFixed(4)} SOL available</p>
                ) : (
                  <p className="text-xs text-gray-500">Checking balance...</p>
                )}
              </div>
            </div>
            {settings.PRIVATE_KEY && masterBalance !== null && (
              <span className={`text-sm font-bold ${hasBalance ? 'text-green-400' : 'text-yellow-400'}`}>
                {hasBalance ? 'Sufficient' : 'Low balance'}
              </span>
            )}
          </div>

          {/* Warnings */}
          {!settings.PRIVATE_KEY && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3">
              <ExclamationTriangleIcon className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-red-400 font-medium">Private Key Missing</p>
                <p className="text-xs text-red-400/70">Go back to Step 2 and enter your funding wallet private key.</p>
              </div>
            </div>
          )}

          {/* Navigation + Launch */}
          <div className="flex justify-between pt-4">
            <button onClick={() => setStep(1)}
              className="flex items-center gap-2 px-5 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl transition-all">
              <ChevronLeftIcon className="w-5 h-5" />
              Back
            </button>
            <button
              onClick={handleLaunch}
              disabled={loading || !canLaunch}
              className={`flex items-center gap-2 px-8 py-3.5 rounded-xl font-bold text-lg transition-all shadow-lg
                ${loading
                  ? 'bg-gray-700 text-gray-500 cursor-wait'
                  : canLaunch
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white shadow-purple-500/25 hover:shadow-purple-500/40'
                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'}`}
            >
              {loading ? (
                <>
                  <ArrowPathIcon className="w-5 h-5 animate-spin" />
                  Launching...
                </>
              ) : (
                <>
                  <RocketLaunchIcon className="w-5 h-5" />
                  Launch & Open Trading Terminal
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ROW HELPER ─────────────────────────────────────────────
function Row({ label, value }) {
  return (
    <div className="flex justify-between items-start text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-200 text-right">{value}</span>
    </div>
  );
}
