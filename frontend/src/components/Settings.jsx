import { useState, useEffect } from 'react';
import apiService from '../services/api';

export default function Settings() {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const res = await apiService.getSettings();
      setSettings(res.data.settings || {});
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const handleChange = (key, value) => {
    setSettings({ ...settings, [key]: value });
    setSaved(false);
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      await apiService.updateSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      alert('Failed to save settings: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const settingGroups = [
    {
      title: 'Bundle Wallets',
      settings: [
        { key: 'BUNDLE_WALLET_COUNT', label: 'Bundle Wallet Count', type: 'number' },
        { key: 'BUNDLE_SWAP_AMOUNTS', label: 'Bundle Swap Amounts (comma-separated)', type: 'text' },
        { key: 'SWAP_AMOUNT', label: 'Default Swap Amount (SOL)', type: 'number' },
      ],
    },
    {
      title: 'Holder Wallets',
      settings: [
        { key: 'HOLDER_WALLET_COUNT', label: 'Holder Wallet Count', type: 'number' },
        { key: 'HOLDER_WALLET_AMOUNT', label: 'Holder Wallet Amount (SOL)', type: 'number' },
        { key: 'HOLDER_SWAP_AMOUNTS', label: 'Holder Swap Amounts (comma-separated)', type: 'text' },
      ],
    },
    {
      title: 'DEV Buy',
      settings: [
        { key: 'BUYER_AMOUNT', label: 'DEV Buy Amount (SOL)', type: 'number' },
      ],
    },
    {
      title: 'Options',
      settings: [
        { key: 'VANITY_MODE', label: 'Vanity Mode', type: 'checkbox' },
        { key: 'LIL_JIT_MODE', label: 'Lil Jit Mode', type: 'checkbox' },
      ],
    },
    {
      title: 'Auto Actions',
      settings: [
        { key: 'AUTO_RAPID_SELL', label: 'Auto Rapid Sell', type: 'checkbox' },
        { key: 'AUTO_SELL_50_PERCENT', label: 'Auto Sell 50%', type: 'checkbox' },
        { key: 'AUTO_GATHER', label: 'Auto Gather', type: 'checkbox' },
        { key: 'AUTO_COLLECT_FEES', label: 'Auto Collect Fees', type: 'checkbox' },
      ],
    },
  ];

  return (
    <div className="bg-slate-800 rounded-lg p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white">⚙️ Settings</h2>
        <div className="flex gap-2">
          <button
            onClick={loadSettings}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
          >
            🔄 Reload
          </button>
          <button
            onClick={handleSave}
            disabled={loading || saved}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors disabled:opacity-50"
          >
            {saved ? '✅ Saved!' : loading ? 'Saving...' : '💾 Save'}
          </button>
        </div>
      </div>

      <div className="space-y-6">
        {settingGroups.map((group) => (
          <div key={group.title} className="bg-slate-700 rounded-lg p-4">
            <h3 className="text-lg font-bold text-white mb-4">{group.title}</h3>
            <div className="space-y-3">
              {group.settings.map((setting) => (
                <div key={setting.key}>
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    {setting.label}
                  </label>
                  {setting.type === 'checkbox' ? (
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings[setting.key] === 'true' || settings[setting.key] === true}
                        onChange={(e) => handleChange(setting.key, e.target.checked ? 'true' : 'false')}
                        className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                      />
                      <span className="ml-2 text-white">
                        {settings[setting.key] === 'true' || settings[setting.key] === true ? 'Enabled' : 'Disabled'}
                      </span>
                    </label>
                  ) : (
                    <input
                      type={setting.type}
                      value={settings[setting.key] || ''}
                      onChange={(e) => handleChange(setting.key, e.target.value)}
                      className="w-full px-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


