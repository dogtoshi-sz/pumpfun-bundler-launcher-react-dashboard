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
  MegaphoneIcon,
  ArrowTrendingUpIcon
} from '@heroicons/react/24/outline';
import { 
  RocketLaunchIcon as RocketLaunchIconSolid,
  UserGroupIcon as UserGroupIconSolid,
  Cog6ToothIcon as Cog6ToothIconSolid,
  LockClosedIcon as LockClosedIconSolid,
  CubeIcon as CubeIconSolid,
  CpuChipIcon as CpuChipIconSolid,
  MegaphoneIcon as MegaphoneIconSolid,
  ArrowTrendingUpIcon as ArrowTrendingUpIconSolid
} from '@heroicons/react/24/solid';
import TokenLaunch from './components/TokenLaunch';
import HolderWallets from './components/HolderWallets';
import Settings from './components/Settings';
import WalletWarming from './components/WalletWarming';
import { TrendDetector } from './components/trend-detector';
import { useLaunchScore } from './hooks/useLaunchScore';
import FundingWallet from './components/FundingWallet';

function App() {
  const [activeTab, setActiveTab] = useState('launch');
  const [settingsSearch, setSettingsSearch] = useState('');
  const [activeSettingsSection, setActiveSettingsSection] = useState('wallets');
  const [flashMarketing, setFlashMarketing] = useState(false);
  const [trendSuggestion, setTrendSuggestion] = useState(null);

  // Handle copying trend token to launcher
  const handleCopyToLauncher = useCallback((suggestion) => {
    setTrendSuggestion(suggestion);
    setActiveTab('launch');
  }, []);
  const [marketData, setMarketData] = useState({
    sol: { price: 0, change24h: 0 },
    eth: { price: 0, change24h: 0 },
    bnb: { price: 0, change24h: 0 },
    fearGreed: { value: 50, classification: 'Neutral' },
    totalMarketCap: 0,
    altcoinMarketCap: 0
  });
  const [loadingMarketData, setLoadingMarketData] = useState(true);
  
  // Launch score for the Data button
  const { score: launchScore } = useLaunchScore();

  // Flash marketing button when navigating to Terminal page
  useEffect(() => {
    if (activeTab === 'holders') {
      setFlashMarketing(true);
      // Flash for 5 seconds then stop
      const timer = setTimeout(() => {
        setFlashMarketing(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [activeTab]);

  useEffect(() => {
    // Listen for navigation events from Settings
    const handleNavigate = (e) => {
      setActiveTab(e.detail);
    };
    window.addEventListener('navigate-to-tab', handleNavigate);
    
    const fetchMarketData = async () => {
      try {
        // Fetch crypto prices from CoinGecko API
        const coinsResponse = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana,ethereum,binancecoin&vs_currencies=usd&include_24hr_change=true');
        const coinsData = await coinsResponse.json();
        
        // Fetch global market data
        const globalResponse = await fetch('https://api.coingecko.com/api/v3/global');
        const globalData = await globalResponse.json();
        
        // Fetch Fear & Greed Index
        let fearGreedValue = 50;
        let fearGreedClassification = 'Neutral';
        try {
          const fearGreedResponse = await fetch('https://api.alternative.me/fng/');
          const fearGreedData = await fearGreedResponse.json();
          if (fearGreedData.data && fearGreedData.data[0]) {
            fearGreedValue = parseInt(fearGreedData.data[0].value);
            fearGreedClassification = fearGreedData.data[0].value_classification;
          }
        } catch (e) {
          console.error('Failed to fetch fear & greed:', e);
        }

        setMarketData({
          sol: {
            price: coinsData.solana?.usd || 0,
            change24h: coinsData.solana?.usd_24h_change || 0
          },
          eth: {
            price: coinsData.ethereum?.usd || 0,
            change24h: coinsData.ethereum?.usd_24h_change || 0
          },
          bnb: {
            price: coinsData.binancecoin?.usd || 0,
            change24h: coinsData.binancecoin?.usd_24h_change || 0
          },
          fearGreed: {
            value: fearGreedValue,
            classification: fearGreedClassification
          },
          totalMarketCap: globalData.data?.total_market_cap?.usd || 0,
          altcoinMarketCap: globalData.data?.total_market_cap?.usd && globalData.data?.market_cap_percentage?.btc 
            ? (globalData.data.total_market_cap.usd * (100 - globalData.data.market_cap_percentage.btc) / 100)
            : 0
        });
        setLoadingMarketData(false);
      } catch (error) {
        console.error('Failed to fetch market data:', error);
        setLoadingMarketData(false);
      }
    };

    fetchMarketData();
    // Refresh every 60 seconds
    const interval = setInterval(fetchMarketData, 60000);
    return () => {
      clearInterval(interval);
      window.removeEventListener('navigate-to-tab', handleNavigate);
    };
  }, []);

  const formatMarketCap = (value) => {
    if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
    return `$${value.toFixed(2)}`;
  };

  const getFearGreedColor = (value) => {
    if (value >= 75) return 'text-red-400';
    if (value >= 55) return 'text-yellow-400';
    if (value >= 45) return 'text-green-400';
    if (value >= 25) return 'text-yellow-400';
    return 'text-red-400';
  };

  const tabs = [
    { id: 'launch', name: 'Launch', icon: RocketLaunchIcon, iconSolid: RocketLaunchIconSolid, component: TokenLaunch },
    { id: 'holders', name: 'Trading Terminal', icon: UserGroupIcon, iconSolid: UserGroupIconSolid, component: HolderWallets },
    { id: 'trends', name: 'Trends', icon: ArrowTrendingUpIcon, iconSolid: ArrowTrendingUpIconSolid, component: TrendDetector },
    { id: 'warming', name: 'Wallets', icon: CpuChipIcon, iconSolid: CpuChipIconSolid, component: WalletWarming },
    { id: 'pnl', name: 'PnL', icon: null, iconSolid: null, component: null, isExternal: true, url: 'http://localhost:3001/profit-loss' },
    { id: 'settings', name: 'Settings', icon: Cog6ToothIcon, iconSolid: Cog6ToothIconSolid, component: Settings },
  ];

  const settingsSections = [
    { id: 'wallets', name: 'Wallets', icon: LockClosedIcon, iconSolid: LockClosedIconSolid },
    { id: 'bundle', name: 'Bundle', icon: CubeIcon, iconSolid: CubeIconSolid },
    { id: 'holders', name: 'Holders', icon: UserGroupIcon, iconSolid: UserGroupIconSolid },
    { id: 'marketing', name: 'Marketing', icon: MegaphoneIcon, iconSolid: MegaphoneIconSolid },
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
        {/* Header - Full Width, Sticky */}
        <header className="bg-black/80 backdrop-blur-sm border-b border-gray-900 sticky top-0 z-50">
          <div className="w-full px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-8">
                <div className="flex items-center">
                  <img 
                    src="/image/goatlogo.png" 
                    alt="GOAT TOOLS Logo" 
                    className="h-10 w-auto object-contain"
                  />
                </div>
                <nav className="flex gap-1">
                  {tabs.filter(tab => tab.id !== 'settings').map((tab) => {
                    if (tab.isExternal) {
                      return (
                        <a
                          key={tab.id}
                          href={tab.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 text-gray-400 hover:text-white hover:bg-gray-900/50"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                          </svg>
                          <span>{tab.name}</span>
                        </a>
                      );
                    }
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
                            ? 'bg-blue-600 text-white glow-blue'
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
                {/* Funding Wallet Widget - Sleek header integration */}
                <FundingWallet 
                  onWalletReady={(wallet) => {
                    console.log('[App] Hot wallet ready:', wallet.address);
                  }}
                  onSwitchToPrivateKey={() => {
                    // Navigate to settings and highlight private key section
                    setActiveTab('settings');
                    setActiveSettingsSection('wallets');
                  }}
                />
                
                <div className="h-6 w-px bg-gray-800"></div>
                
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search..."
                    className="bg-gray-900/50 border border-gray-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-purple-500 w-36"
                  />
                </div>
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

        {/* Main Content Area - Full Height */}
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
                  className="w-full bg-gray-900/50 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                          ? 'bg-blue-600 text-white glow-blue'
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
                activeTab === 'trends' ? (
                  <TrendDetector onCopyToLauncher={handleCopyToLauncher} />
                ) : activeTab === 'launch' ? (
                  <TokenLaunch 
                    onLaunch={() => {
                      setActiveTab('holders');
                      setTimeout(() => {
                        window.dispatchEvent(new Event('refresh-wallets'));
                      }, 3000);
                    }}
                    trendSuggestion={trendSuggestion}
                    onTrendSuggestionUsed={() => setTrendSuggestion(null)}
                  />
                ) : (
                  <ActiveComponent 
                    onLaunch={() => {
                      setActiveTab('holders');
                      setTimeout(() => {
                        window.dispatchEvent(new Event('refresh-wallets'));
                      }, 3000);
                    }}
                  />
                )
              )}
            </div>
          </main>
        </div>

        {/* Footer - Sticky Bottom */}
        <footer className="bg-black/80 backdrop-blur-sm border-t border-gray-900">
          <div className="w-full px-6 py-3">
            <div className="flex items-center justify-between gap-4 overflow-x-auto">
              <div className="flex items-center gap-6 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-sm text-gray-300">Connected</span>
                </div>
                <span className="text-sm text-gray-500">Fees</span>
              </div>
              <div className="flex items-center gap-4 flex-shrink-0">
                {/* Crypto Prices */}
                {!loadingMarketData && (
                  <>
                    {/* SOL */}
                    <div className="flex items-center gap-1.5">
                      <img src="/image/icons/sol_logo.svg" alt="SOL" className="w-4 h-4 flex-shrink-0" />
                      <span className="text-xs text-gray-300 font-semibold">SOL</span>
                      <span className="text-sm text-white font-medium">${marketData.sol.price.toFixed(2)}</span>
                      <span className={`text-xs font-semibold ${marketData.sol.change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {marketData.sol.change24h >= 0 ? '↑' : '↓'} {Math.abs(marketData.sol.change24h).toFixed(2)}%
                      </span>
                    </div>

                    {/* ETH */}
                    <div className="flex items-center gap-1.5">
                      <img src="/image/icons/eth-logo.svg" alt="ETH" className="w-4 h-4 flex-shrink-0" />
                      <span className="text-xs text-gray-300 font-semibold">ETH</span>
                      <span className="text-sm text-white font-medium">${marketData.eth.price.toFixed(2)}</span>
                      <span className={`text-xs font-semibold ${marketData.eth.change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {marketData.eth.change24h >= 0 ? '↑' : '↓'} {Math.abs(marketData.eth.change24h).toFixed(2)}%
                      </span>
                    </div>

                    {/* BNB */}
                    <div className="flex items-center gap-1.5">
                      <img src="/image/icons/bnb_logo.svg" alt="BNB" className="w-4 h-4 flex-shrink-0" />
                      <span className="text-xs text-gray-300 font-semibold">BNB</span>
                      <span className="text-sm text-white font-medium">${marketData.bnb.price.toFixed(2)}</span>
                      <span className={`text-xs font-semibold ${marketData.bnb.change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {marketData.bnb.change24h >= 0 ? '↑' : '↓'} {Math.abs(marketData.bnb.change24h).toFixed(2)}%
                      </span>
                    </div>

                    {/* Fear & Greed Index */}
                    <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-800/50 rounded border border-gray-700">
                      <span className="text-xs text-gray-400">Fear & Greed:</span>
                      <span className={`text-xs font-bold ${getFearGreedColor(marketData.fearGreed.value)}`}>
                        {marketData.fearGreed.value}
                      </span>
                      <span className="text-[10px] text-gray-500">({marketData.fearGreed.classification})</span>
                    </div>

                    {/* Total Market Cap */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-gray-400">Total MCap:</span>
                      <span className="text-sm text-white font-semibold">{formatMarketCap(marketData.totalMarketCap)}</span>
                    </div>

                    {/* Altcoin Market Cap */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-gray-400">Altcoin MCap:</span>
                      <span className="text-sm text-white font-semibold">{formatMarketCap(marketData.altcoinMarketCap)}</span>
                    </div>
                  </>
                )}
                {loadingMarketData && (
                  <span className="text-xs text-gray-400">Loading market data...</span>
                )}
                <button 
                  onClick={() => window.dispatchEvent(new Event('open-dune-widget'))}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-medium transition-all bg-gray-800/50 hover:bg-gray-700/50 border border-gray-700/50"
                  title="Launch Analytics - Best time to launch based on Pump.fun volume"
                >
                  <ChartBarIcon className="w-3.5 h-3.5 text-gray-400" />
                  {launchScore !== null ? (
                    <span className={`font-bold ${
                      launchScore >= 70 ? 'text-emerald-400' : 
                      launchScore >= 50 ? 'text-amber-400' : 
                      launchScore >= 30 ? 'text-orange-400' : 'text-red-400'
                    }`}>
                      {launchScore}
                    </span>
                  ) : (
                    <span className="text-gray-500">--</span>
                  )}
                </button>
                <button 
                  onClick={() => window.dispatchEvent(new Event('open-marketing-widget'))}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    flashMarketing 
                      ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white animate-pulse shadow-lg shadow-purple-500/50' 
                      : 'text-purple-400 hover:text-purple-300 hover:bg-purple-500/10'
                  }`}
                  title="Open Marketing Widget"
                >
                  <MegaphoneIcon className="w-4 h-4" />
                  <span>Marketing</span>
                  {flashMarketing && <SparklesIcon className="w-4 h-4 animate-spin" />}
                </button>
              </div>
            </div>
          </div>
        </footer>
      </div>

      {/* Marketing Widget - Shows on Launch and Terminal pages */}
      {(activeTab === 'launch' || activeTab === 'holders') && <MarketingWidget isTerminalPage={activeTab === 'holders'} flashOnMount={flashMarketing} />}
      
      {/* Dune Data Widget - Launch Analytics */}
      <DuneDataWidget />
    </div>
  );
}

export default App;
