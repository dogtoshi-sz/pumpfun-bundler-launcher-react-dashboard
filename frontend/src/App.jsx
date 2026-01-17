import { useState, useEffect, useCallback } from 'react';
import { 
  RocketLaunchIcon, 
  UserGroupIcon, 
  Cog6ToothIcon,
  LockClosedIcon,
  CubeIcon,
  CpuChipIcon,
  BellIcon,
  UserIcon
} from '@heroicons/react/24/outline';
import { 
  RocketLaunchIcon as RocketLaunchIconSolid,
  UserGroupIcon as UserGroupIconSolid,
  Cog6ToothIcon as Cog6ToothIconSolid,
  LockClosedIcon as LockClosedIconSolid,
  CubeIcon as CubeIconSolid,
  CpuChipIcon as CpuChipIconSolid
} from '@heroicons/react/24/solid';
import TokenLaunch from './components/TokenLaunch';
import HolderWallets from './components/HolderWallets';
import Settings from './components/Settings';
import WalletWarming from './components/WalletWarming';

function App() {
  const [activeTab, setActiveTab] = useState('launch');
  const [settingsSearch, setSettingsSearch] = useState('');
  const [activeSettingsSection, setActiveSettingsSection] = useState('wallets');

  const [marketData, setMarketData] = useState({
    sol: { price: 0, change24h: 0 },
  });
  const [loadingMarketData, setLoadingMarketData] = useState(true);

  useEffect(() => {
    // Listen for navigation events from Settings
    const handleNavigate = (e) => {
      setActiveTab(e.detail);
    };
    window.addEventListener('navigate-to-tab', handleNavigate);
    
    const fetchMarketData = async () => {
      try {
        const coinsResponse = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true');
        const coinsData = await coinsResponse.json();
        
        setMarketData({
          sol: {
            price: coinsData.solana?.usd || 0,
            change24h: coinsData.solana?.usd_24h_change || 0
          }
        });
        setLoadingMarketData(false);
      } catch (error) {
        console.error('Failed to fetch market data:', error);
        setLoadingMarketData(false);
      }
    };

    fetchMarketData();
    const interval = setInterval(fetchMarketData, 60000);
    return () => {
      clearInterval(interval);
      window.removeEventListener('navigate-to-tab', handleNavigate);
    };
  }, []);

  const tabs = [
    { id: 'launch', name: 'Launch Token', icon: RocketLaunchIcon, iconSolid: RocketLaunchIconSolid, component: TokenLaunch },
    { id: 'holders', name: 'Trading Terminal', icon: UserGroupIcon, iconSolid: UserGroupIconSolid, component: HolderWallets },
    { id: 'warming', name: 'Wallets', icon: CpuChipIcon, iconSolid: CpuChipIconSolid, component: WalletWarming },
    { id: 'settings', name: 'Settings', icon: Cog6ToothIcon, iconSolid: Cog6ToothIconSolid, component: Settings },
  ];

  const settingsSections = [
    { id: 'wallets', name: 'Wallets', icon: LockClosedIcon, iconSolid: LockClosedIconSolid },
    { id: 'bundle', name: 'Bundle', icon: CubeIcon, iconSolid: CubeIconSolid },
    { id: 'holders', name: 'Holders', icon: UserGroupIcon, iconSolid: UserGroupIconSolid },
    { id: 'options', name: 'Options', icon: Cog6ToothIcon, iconSolid: Cog6ToothIconSolid },
    { id: 'auto', name: 'Auto Actions', icon: CpuChipIcon, iconSolid: CpuChipIconSolid },
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
                    <h1 className="text-lg font-bold text-white">Solana Bundler</h1>
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
                  return (
                    <button
                      key={section.id}
                      onClick={() => {
                        setActiveSettingsSection(section.id);
                        window.dispatchEvent(new CustomEvent('settings-section-change', { detail: section.id }));
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                        activeSettingsSection === section.id
                          ? 'bg-purple-600 text-white'
                          : 'hover:bg-gray-900/50 text-gray-300 hover:text-white'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                      <span>{section.name}</span>
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
          <div className="w-full px-6 py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-sm text-gray-300">Connected</span>
                </div>
              </div>
              <div className="flex items-center gap-4">
                {/* SOL Price */}
                {!loadingMarketData && (
                  <div className="flex items-center gap-1.5">
                    <img src="/image/icons/sol_logo.svg" alt="SOL" className="w-4 h-4 flex-shrink-0" />
                    <span className="text-xs text-gray-300 font-semibold">SOL</span>
                    <span className="text-sm text-white font-medium">${marketData.sol.price.toFixed(2)}</span>
                    <span className={`text-xs font-semibold ${marketData.sol.change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {marketData.sol.change24h >= 0 ? '↑' : '↓'} {Math.abs(marketData.sol.change24h).toFixed(2)}%
                    </span>
                  </div>
                )}
                {loadingMarketData && (
                  <span className="text-xs text-gray-400">Loading...</span>
                )}
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default App;
