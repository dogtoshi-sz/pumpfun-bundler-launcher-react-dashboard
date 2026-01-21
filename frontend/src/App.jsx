import { useState, useEffect, useCallback } from 'react';
import { 
  RocketLaunchIcon, 
  UserGroupIcon, 
  Cog6ToothIcon,
  LockClosedIcon,
  CubeIcon,
  CpuChipIcon,
  BellIcon,
  UserIcon,
  ServerIcon,
  KeyIcon,
  CurrencyDollarIcon,
  ChartBarIcon,
  SparklesIcon,
  GlobeAltIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import { 
  RocketLaunchIcon as RocketLaunchIconSolid,
  UserGroupIcon as UserGroupIconSolid,
  Cog6ToothIcon as Cog6ToothIconSolid,
  LockClosedIcon as LockClosedIconSolid,
  CubeIcon as CubeIconSolid,
  CpuChipIcon as CpuChipIconSolid,
  ServerIcon as ServerIconSolid,
  KeyIcon as KeyIconSolid,
  CurrencyDollarIcon as CurrencyDollarIconSolid,
  ChartBarIcon as ChartBarIconSolid,
  SparklesIcon as SparklesIconSolid,
  GlobeAltIcon as GlobeAltIconSolid,
  ExclamationTriangleIcon as ExclamationTriangleIconSolid
} from '@heroicons/react/24/solid';
import TokenLaunch from './components/TokenLaunch';
import HolderWallets from './components/HolderWallets';
import Settings from './components/Settings';
import WalletWarming from './components/WalletWarming';

function App() {
  const [activeTab, setActiveTab] = useState('launch');
  const [settingsSearch, setSettingsSearch] = useState('');
  const [activeSettingsSection, setActiveSettingsSection] = useState('required');
  const [settings, setSettings] = useState({});

  const [marketData, setMarketData] = useState({
    sol: { price: 0, change24h: 0 },
    btc: { price: 0, change24h: 0 },
    eth: { price: 0, change24h: 0 },
    bnb: { price: 0, change24h: 0 },
  });
  const [fearGreedIndex, setFearGreedIndex] = useState({ value: 0, classification: 'Loading...' });
  const [loadingMarketData, setLoadingMarketData] = useState(true);
  
  useEffect(() => {
    // Load settings to check if required fields are satisfied
    const loadSettings = async () => {
      try {
        const response = await fetch('http://localhost:3001/api/settings');
        const data = await response.json();
        if (data.settings) {
          setSettings(data.settings);
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
      }
    };
    loadSettings();
    
    // Listen for settings updates
    const handleSettingsUpdate = () => {
      loadSettings();
    };
    window.addEventListener('settings-updated', handleSettingsUpdate);
    
    // Listen for navigation events from Settings
    const handleNavigate = (e) => {
      setActiveTab(e.detail);
    };
    window.addEventListener('navigate-to-tab', handleNavigate);
    
    const fetchMarketData = async () => {
      try {
        // Fetch all coin prices
        const coinsResponse = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana,bitcoin,ethereum,binancecoin&vs_currencies=usd&include_24hr_change=true');
        const coinsData = await coinsResponse.json();
        
        setMarketData({
          sol: {
            price: coinsData.solana?.usd || 0,
            change24h: coinsData.solana?.usd_24h_change || 0
          },
          btc: {
            price: coinsData.bitcoin?.usd || 0,
            change24h: coinsData.bitcoin?.usd_24h_change || 0
          },
          eth: {
            price: coinsData.ethereum?.usd || 0,
            change24h: coinsData.ethereum?.usd_24h_change || 0
          },
          bnb: {
            price: coinsData.binancecoin?.usd || 0,
            change24h: coinsData.binancecoin?.usd_24h_change || 0
          }
        });
        setLoadingMarketData(false);
      } catch (error) {
        console.error('Failed to fetch market data:', error);
        setLoadingMarketData(false);
      }
    };

    const fetchFearGreed = async () => {
      try {
        const response = await fetch('https://api.alternative.me/fng/?limit=1');
        const data = await response.json();
        if (data.data && data.data[0]) {
          setFearGreedIndex({
            value: parseInt(data.data[0].value),
            classification: data.data[0].value_classification
          });
        }
      } catch (error) {
        console.error('Failed to fetch Fear & Greed Index:', error);
      }
    };

    fetchMarketData();
    fetchFearGreed();
    const marketInterval = setInterval(fetchMarketData, 60000);
    const fgInterval = setInterval(fetchFearGreed, 300000); // Every 5 min
    return () => {
      clearInterval(marketInterval);
      clearInterval(fgInterval);
      window.removeEventListener('navigate-to-tab', handleNavigate);
      window.removeEventListener('settings-updated', handleSettingsUpdate);
    };
  }, []);

  // Check if required settings are satisfied
  const isRequiredSatisfied = () => {
    const privateKey = settings.PRIVATE_KEY?.trim();
    const rpcEndpoint = settings.RPC_ENDPOINT?.trim();
    return !!(privateKey && rpcEndpoint && privateKey.length > 0 && rpcEndpoint.length > 0);
  };

  const requiredSatisfied = isRequiredSatisfied();

  const tabs = [
    { id: 'launch', name: 'Launch Token', icon: RocketLaunchIcon, iconSolid: RocketLaunchIconSolid, component: TokenLaunch },
    { id: 'holders', name: 'Trading Terminal', icon: UserGroupIcon, iconSolid: UserGroupIconSolid, component: HolderWallets },
    { id: 'warming', name: 'Wallets', icon: CpuChipIcon, iconSolid: CpuChipIconSolid, component: WalletWarming },
    { id: 'settings', name: 'Settings', icon: Cog6ToothIcon, iconSolid: Cog6ToothIconSolid, component: Settings },
  ];

  const settingsSections = [
    { id: 'required', name: 'Required', icon: ExclamationTriangleIcon, iconSolid: ExclamationTriangleIconSolid },
    { id: 'rpc', name: 'RPC Config', icon: ServerIcon, iconSolid: ServerIconSolid },
    { id: 'wallets', name: 'Wallets', icon: LockClosedIcon, iconSolid: LockClosedIconSolid },
    { id: 'bundle', name: 'Bundle', icon: CubeIcon, iconSolid: CubeIconSolid },
    { id: 'holders', name: 'Holders', icon: UserGroupIcon, iconSolid: UserGroupIconSolid },
    { id: 'trading', name: 'Trading', icon: CurrencyDollarIcon, iconSolid: CurrencyDollarIconSolid },
    { id: 'jito', name: 'Jito', icon: SparklesIcon, iconSolid: SparklesIconSolid },
    { id: 'autosell', name: 'Auto-Sell', icon: ChartBarIcon, iconSolid: ChartBarIconSolid },
    { id: 'auto', name: 'Auto Actions', icon: CpuChipIcon, iconSolid: CpuChipIconSolid },
    { id: 'apikeys', name: 'API Keys', icon: KeyIcon, iconSolid: KeyIconSolid },
    { id: 'options', name: 'Advanced', icon: Cog6ToothIcon, iconSolid: Cog6ToothIconSolid },
  ];

  const ActiveComponent = tabs.find(tab => tab.id === activeTab)?.component;
  const isSettingsPage = activeTab === 'settings';

  return (
    <div className="fixed inset-0 bg-black text-white overflow-hidden">
      {/* Starry Background */}
      <div className="starry-background"></div>
      <div className="grid-overlay"></div>

      {/* Main Container */}
      <div className="relative z-10 h-full flex flex-col">
        {/* Header */}
        <header className="bg-black/80 backdrop-blur-sm border-b border-gray-900 sticky top-0 z-50">
          <div className="w-full px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-8">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
                    <RocketLaunchIcon className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h1 className="text-lg font-bold text-white">Trencher Bundler</h1>
                    <p className="text-xs text-gray-500">Pump.fun Token Launcher</p>
                  </div>
                </div>
                <nav className="flex gap-1">
                  {tabs.filter(tab => tab.id !== 'settings').map((tab) => {
                    const Icon = activeTab === tab.id ? tab.iconSolid : tab.icon;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                          activeTab === tab.id
                            ? 'bg-gray-900 text-white'
                            : 'text-gray-400 hover:text-white hover:bg-gray-900/50'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span>{tab.name}</span>
                      </button>
                    );
                  })}
                  {(() => {
                    const settingsTab = tabs.find(t => t.id === 'settings');
                    const SettingsIcon = activeTab === 'settings' ? settingsTab.iconSolid : settingsTab.icon;
                    return (
                      <button
                        onClick={() => setActiveTab('settings')}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                          activeTab === 'settings'
                            ? 'bg-purple-600 text-white'
                            : 'text-gray-400 hover:text-white hover:bg-gray-900/50'
                        }`}
                      >
                        <SettingsIcon className="w-4 h-4" />
                        <span>{settingsTab.name}</span>
                      </button>
                    );
                  })()}
                </nav>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <button className="p-1.5 hover:bg-gray-900/50 rounded-lg transition-colors">
                    <BellIcon className="w-4 h-4 text-gray-500" />
                  </button>
                  <button className="p-1.5 hover:bg-gray-900/50 rounded-lg transition-colors">
                    <UserIcon className="w-4 h-4 text-gray-500" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar - Only show on Settings page */}
          {isSettingsPage && (
            <aside className="w-64 bg-black/60 backdrop-blur-sm border-r border-gray-900 p-6 overflow-y-auto">
              <div className="mb-6">
                <h2 className="text-lg font-bold text-white mb-1">Settings</h2>
                <p className="text-xs text-gray-500">Manage your settings & preferences.</p>
              </div>
              
              <div className="mb-6">
                <input
                  type="text"
                  placeholder="Search Settings"
                  value={settingsSearch}
                  onChange={(e) => setSettingsSearch(e.target.value)}
                  className="w-full bg-gray-900/50 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
              </div>

              <nav className="space-y-1">
                {settingsSections.map((section) => {
                  const Icon = activeSettingsSection === section.id ? section.iconSolid : section.icon;
                  const isRequired = section.id === 'required';
                  
                  return (
                    <button
                      key={section.id}
                      onClick={() => {
                        setActiveSettingsSection(section.id);
                        window.dispatchEvent(new CustomEvent('settings-section-change', { detail: section.id }));
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                        activeSettingsSection === section.id
                          ? isRequired 
                            ? requiredSatisfied
                              ? 'bg-green-600 text-white border border-green-500'
                              : 'bg-red-600 text-white border border-red-500'
                            : 'bg-purple-600 text-white'
                          : isRequired
                            ? requiredSatisfied
                              ? 'hover:bg-green-900/30 text-green-300 hover:text-green-200 border border-green-900/50'
                              : 'hover:bg-red-900/30 text-red-300 hover:text-red-200 border border-red-900/50'
                            : 'hover:bg-gray-900/50 text-gray-300 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className="w-5 h-5" />
                        <span>{section.name}</span>
                        {isRequired && (
                          requiredSatisfied ? (
                            <span className="px-1.5 py-0.5 text-[10px] rounded-full font-bold bg-green-500/20 text-green-300 border border-green-500/50">
                              [check]
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 text-[10px] rounded-full font-bold bg-red-500/20 text-red-300 border border-red-500/50">
                              !
                            </span>
                          )
                        )}
                      </div>
                    </button>
                  );
                })}
              </nav>
            </aside>
          )}

          {/* Main Content Area - Scrollable */}
          <main className={`flex-1 overflow-y-auto ${isSettingsPage ? 'p-6' : (activeTab === 'holders' ? 'p-4' : 'p-8')}`}>
            <div className={isSettingsPage ? '' : (activeTab === 'holders' ? 'w-full h-full' : 'max-w-7xl mx-auto')}>
              {ActiveComponent && (
                <ActiveComponent 
                  onLaunch={() => {
                    setActiveTab('holders');
                    setTimeout(() => {
                      window.dispatchEvent(new Event('refresh-wallets'));
                    }, 3000);
                  }}
                />
              )}
            </div>
          </main>
        </div>

        {/* Footer */}
        <footer className="bg-black/80 backdrop-blur-sm border-t border-gray-900">
          <div className="w-full px-4 py-2">
            <div className="flex items-center justify-center gap-4">
              {/* All content centered */}
              {!loadingMarketData ? (
                <>
                  {/* Connection Status */}
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
                    <span className="text-[10px] text-gray-400">Live</span>
                  </div>
                  
                  <div className="w-px h-3 bg-gray-700"></div>
                  
                  {/* BTC */}
                  <div className="flex items-center gap-1 text-[10px]">
                    <span className="text-orange-400 font-bold">₿</span>
                    <span className="text-gray-400">BTC</span>
                    <span className="text-white font-medium">${marketData.btc.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    <span className={`${marketData.btc.change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {marketData.btc.change24h >= 0 ? '^' : 'v'}{Math.abs(marketData.btc.change24h).toFixed(1)}%
                    </span>
                  </div>
                  
                  <div className="w-px h-3 bg-gray-700"></div>
                  
                  {/* ETH */}
                  <div className="flex items-center gap-1 text-[10px]">
                    <img src="/image/icons/eth-logo.svg" alt="ETH" className="w-3 h-3" />
                    <span className="text-gray-400">ETH</span>
                    <span className="text-white font-medium">${marketData.eth.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    <span className={`${marketData.eth.change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {marketData.eth.change24h >= 0 ? '^' : 'v'}{Math.abs(marketData.eth.change24h).toFixed(1)}%
                    </span>
                  </div>
                  
                  <div className="w-px h-3 bg-gray-700"></div>
                  
                  {/* BNB */}
                  <div className="flex items-center gap-1 text-[10px]">
                    <img src="/image/icons/bnb_logo.svg" alt="BNB" className="w-3 h-3" />
                    <span className="text-gray-400">BNB</span>
                    <span className="text-white font-medium">${marketData.bnb.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    <span className={`${marketData.bnb.change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {marketData.bnb.change24h >= 0 ? '^' : 'v'}{Math.abs(marketData.bnb.change24h).toFixed(1)}%
                    </span>
                  </div>
                  
                  <div className="w-px h-3 bg-gray-700"></div>
                  
                  {/* SOL - Highlighted */}
                  <div className="flex items-center gap-1.5 px-2 py-0.5 bg-purple-900/30 rounded border border-purple-500/30 text-[10px]">
                    <img src="/image/icons/sol_logo.svg" alt="SOL" className="w-3.5 h-3.5" />
                    <span className="text-purple-300 font-semibold">SOL</span>
                    <span className="text-white font-bold">${marketData.sol.price.toFixed(2)}</span>
                    <span className={`font-semibold ${marketData.sol.change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {marketData.sol.change24h >= 0 ? '^' : 'v'}{Math.abs(marketData.sol.change24h).toFixed(1)}%
                    </span>
                  </div>
                  
                  <div className="w-px h-3 bg-gray-700"></div>
                  
                  {/* Fear & Greed Index */}
                  <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                    fearGreedIndex.value >= 75 ? 'bg-green-900/50 text-green-400 border border-green-500/30' :
                    fearGreedIndex.value >= 55 ? 'bg-lime-900/50 text-lime-400 border border-lime-500/30' :
                    fearGreedIndex.value >= 45 ? 'bg-yellow-900/50 text-yellow-400 border border-yellow-500/30' :
                    fearGreedIndex.value >= 25 ? 'bg-orange-900/50 text-orange-400 border border-orange-500/30' :
                    'bg-red-900/50 text-red-400 border border-red-500/30'
                  }`}>
                    <span></span>
                    <span>Fear & Greed</span>
                    <span className="font-bold">{fearGreedIndex.value}</span>
                    <span className="hidden sm:inline text-[9px] opacity-75">({fearGreedIndex.classification})</span>
                  </div>
                </>
              ) : (
                <span className="text-[10px] text-gray-500">Loading market data...</span>
              )}
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default App;
