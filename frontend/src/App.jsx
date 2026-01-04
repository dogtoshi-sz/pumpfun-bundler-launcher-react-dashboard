import { useState } from 'react';
import { 
  RocketLaunchIcon, 
  UserGroupIcon, 
  BeakerIcon, 
  Cog6ToothIcon,
  LockClosedIcon,
  CubeIcon,
  CpuChipIcon,
  BellIcon,
  Squares2X2Icon,
  UserIcon,
  ChatBubbleLeftRightIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';
import { 
  RocketLaunchIcon as RocketLaunchIconSolid,
  UserGroupIcon as UserGroupIconSolid,
  BeakerIcon as BeakerIconSolid,
  Cog6ToothIcon as Cog6ToothIconSolid,
  LockClosedIcon as LockClosedIconSolid,
  CubeIcon as CubeIconSolid,
  CpuChipIcon as CpuChipIconSolid
} from '@heroicons/react/24/solid';
import TokenLaunch from './components/TokenLaunch';
import HolderWallets from './components/HolderWallets';
import Settings from './components/Settings';
import WalletTester from './components/WalletTester';

function App() {
  const [activeTab, setActiveTab] = useState('launch');
  const [settingsSearch, setSettingsSearch] = useState('');
  const [activeSettingsSection, setActiveSettingsSection] = useState('wallets');

  const tabs = [
    { id: 'launch', name: 'Launch', icon: RocketLaunchIcon, iconSolid: RocketLaunchIconSolid, component: TokenLaunch },
    { id: 'holders', name: 'Holders', icon: UserGroupIcon, iconSolid: UserGroupIconSolid, component: HolderWallets },
    { id: 'test', name: 'Test', icon: BeakerIcon, iconSolid: BeakerIconSolid, component: WalletTester },
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
        {/* Header - Full Width, Sticky */}
        <header className="bg-black/80 backdrop-blur-sm border-b border-gray-900 sticky top-0 z-50">
          <div className="w-full px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-8">
                <div>
                  <h1 className="text-xl font-bold text-white">Pump.fun Bundler</h1>
                  <p className="text-xs text-gray-500">Version 2.9.1</p>
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
              <div className="flex items-center gap-4">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search tokens..."
                    className="bg-gray-900/50 border border-gray-800 rounded-lg px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-48"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button className="p-2 hover:bg-gray-900/50 rounded-lg transition-colors">
                    <BellIcon className="w-5 h-5 text-gray-400" />
                  </button>
                  <button className="p-2 hover:bg-gray-900/50 rounded-lg transition-colors">
                    <Squares2X2Icon className="w-5 h-5 text-gray-400" />
                  </button>
                  <button className="p-2 hover:bg-gray-900/50 rounded-lg transition-colors">
                    <UserIcon className="w-5 h-5 text-gray-400" />
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
          <main className={`flex-1 overflow-y-auto ${isSettingsPage ? 'p-6' : 'p-8'}`}>
            <div className={isSettingsPage ? '' : 'max-w-7xl mx-auto'}>
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

        {/* Footer - Sticky Bottom */}
        <footer className="bg-black/80 backdrop-blur-sm border-t border-gray-900">
          <div className="w-full px-6 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-sm text-gray-300">Connected</span>
                </div>
                <span className="text-sm text-gray-500">Fees</span>
              </div>
              <div className="flex items-center gap-6">
                <button className="text-gray-400 hover:text-white transition-colors">
                  <ChatBubbleLeftRightIcon className="w-5 h-5" />
                </button>
                <button className="text-gray-400 hover:text-white transition-colors">
                  <XMarkIcon className="w-5 h-5" />
                </button>
                <span className="text-sm text-gray-300">$133.76</span>
                <span className="text-sm text-gray-300">$881.79</span>
                <span className="text-sm text-gray-300">$3143.56</span>
                <button className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
                  Popout
                </button>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default App;
