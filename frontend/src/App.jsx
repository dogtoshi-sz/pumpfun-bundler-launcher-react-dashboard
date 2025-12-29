import { useState } from 'react';
import TokenLaunch from './components/TokenLaunch';
import HolderWallets from './components/HolderWallets';
import Settings from './components/Settings';
import WalletTester from './components/WalletTester';

function App() {
  const [activeTab, setActiveTab] = useState('launch');

  const tabs = [
    { id: 'launch', name: '🚀 Launch', component: TokenLaunch },
    { id: 'holders', name: '👥 Holders', component: HolderWallets },
    { id: 'test', name: '🧪 Test', component: WalletTester },
    { id: 'settings', name: '⚙️ Settings', component: Settings },
  ];

  const ActiveComponent = tabs.find(tab => tab.id === activeTab)?.component;

  return (
    <div className="min-h-screen bg-slate-900">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">Pump.fun Bundler</h1>
          <p className="text-slate-400">Control Panel</p>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 mb-6 border-b border-slate-700">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-6 py-3 font-medium rounded-t-lg transition-colors ${
                activeTab === tab.id
                  ? 'bg-slate-800 text-white border-b-2 border-blue-500'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              {tab.name}
            </button>
          ))}
        </div>

        {/* Content */}
        {ActiveComponent && (
          <ActiveComponent 
            onLaunch={() => {
              setActiveTab('holders'); // Switch to holders tab after launch
              // Force refresh wallets after a short delay (wait for launch to complete)
              setTimeout(() => {
                window.dispatchEvent(new Event('refresh-wallets'));
              }, 3000);
            }}
          />
        )}
      </div>
    </div>
  );
}

export default App;

