import { useState, useEffect } from 'react';
import {
  PlusIcon,
  TrashIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
  MegaphoneIcon,
  ChatBubbleLeftRightIcon,
  EyeIcon,
  EyeSlashIcon
} from '@heroicons/react/24/outline';

/**
 * Marketing Accounts Manager
 * Manage Twitter and Telegram API accounts
 */
export default function MarketingAccounts() {
  const [twitterAccounts, setTwitterAccounts] = useState([]);
  const [telegramAccounts, setTelegramAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddTwitter, setShowAddTwitter] = useState(false);
  const [showAddTelegram, setShowAddTelegram] = useState(false);
  
  // Twitter form
  const [twitterForm, setTwitterForm] = useState({
    name: '',
    apiKey: '',
    apiSecret: '',
    accessToken: '',
    accessTokenSecret: ''
  });
  const [twitterTesting, setTwitterTesting] = useState(false);
  const [twitterTestResult, setTwitterTestResult] = useState(null);
  
  // Telegram form
  const [telegramForm, setTelegramForm] = useState({
    name: '',
    apiId: '',
    apiHash: '',
    phone: ''
  });
  
  // Show/hide credentials
  const [showCredentials, setShowCredentials] = useState({});

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    setLoading(true);
    try {
      const [twitterRes, telegramRes] = await Promise.all([
        fetch('http://localhost:3001/api/twitter-accounts'),
        fetch('http://localhost:3001/api/telegram-accounts')
      ]);
      
      const twitterData = await twitterRes.json();
      const telegramData = await telegramRes.json();
      
      if (twitterData.success) setTwitterAccounts(twitterData.accounts);
      if (telegramData.success) setTelegramAccounts(telegramData.accounts);
    } catch (error) {
      console.error('Failed to load accounts:', error);
    } finally {
      setLoading(false);
    }
  };

  const testTwitterCredentials = async () => {
    setTwitterTesting(true);
    setTwitterTestResult(null);
    
    try {
      const response = await fetch('http://localhost:3001/api/twitter-accounts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: twitterForm.apiKey,
          apiSecret: twitterForm.apiSecret,
          accessToken: twitterForm.accessToken,
          accessTokenSecret: twitterForm.accessTokenSecret
        })
      });
      
      const result = await response.json();
      setTwitterTestResult(result);
    } catch (error) {
      setTwitterTestResult({ success: false, error: error.message });
    } finally {
      setTwitterTesting(false);
    }
  };

  const addTwitterAccount = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/twitter-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(twitterForm)
      });
      
      const result = await response.json();
      
      if (result.success) {
        setShowAddTwitter(false);
        setTwitterForm({ name: '', apiKey: '', apiSecret: '', accessToken: '', accessTokenSecret: '' });
        setTwitterTestResult(null);
        loadAccounts();
        alert('Twitter account added successfully!');
      } else {
        alert(`Failed to add account: ${result.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  };

  const addTelegramAccount = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/telegram-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(telegramForm)
      });
      
      const result = await response.json();
      
      if (result.success) {
        setShowAddTelegram(false);
        setTelegramForm({ name: '', apiId: '', apiHash: '', phone: '' });
        loadAccounts();
        alert('Telegram account added successfully!');
      } else {
        alert(`Failed to add account: ${result.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  };

  const deleteTwitterAccount = async (id) => {
    if (!confirm('Delete this Twitter account?')) return;
    
    try {
      const response = await fetch(`http://localhost:3001/api/twitter-accounts/${id}`, {
        method: 'DELETE'
      });
      
      const result = await response.json();
      
      if (result.success) {
        loadAccounts();
      } else {
        alert(`Failed to delete: ${result.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  };

  const deleteTelegramAccount = async (id) => {
    if (!confirm('Delete this Telegram account? This will also remove the session file.')) return;
    
    try {
      const response = await fetch(`http://localhost:3001/api/telegram-accounts/${id}`, {
        method: 'DELETE'
      });
      
      const result = await response.json();
      
      if (result.success) {
        loadAccounts();
      } else {
        alert(`Failed to delete: ${result.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <ArrowPathIcon className="w-8 h-8 animate-spin text-purple-400" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Twitter Accounts */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <MegaphoneIcon className="w-6 h-6 text-purple-400" />
            <h3 className="text-lg font-semibold">Twitter Accounts</h3>
            <span className="px-2 py-0.5 text-xs bg-purple-500/20 text-purple-400 rounded-full">
              {twitterAccounts.length} saved
            </span>
          </div>
          <button
            onClick={() => setShowAddTwitter(!showAddTwitter)}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors text-sm font-medium"
          >
            <PlusIcon className="w-4 h-4" />
            Add Account
          </button>
        </div>

        {/* Add Twitter Account Form */}
        {showAddTwitter && (
          <div className="mb-4 p-6 bg-gray-800/50 border border-gray-700 rounded-lg space-y-4">
            <h4 className="text-md font-medium mb-4">Add Twitter Account</h4>
            
            <div>
              <label className="block text-sm text-gray-400 mb-2">Account Name</label>
              <input
                type="text"
                value={twitterForm.name}
                onChange={(e) => setTwitterForm({ ...twitterForm, name: e.target.value })}
                placeholder="My Twitter Account"
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-2">API Key</label>
                <input
                  type="text"
                  value={twitterForm.apiKey}
                  onChange={(e) => setTwitterForm({ ...twitterForm, apiKey: e.target.value })}
                  placeholder="API Key"
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-2">API Secret</label>
                <input
                  type="password"
                  value={twitterForm.apiSecret}
                  onChange={(e) => setTwitterForm({ ...twitterForm, apiSecret: e.target.value })}
                  placeholder="API Secret"
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-2">Access Token</label>
                <input
                  type="text"
                  value={twitterForm.accessToken}
                  onChange={(e) => setTwitterForm({ ...twitterForm, accessToken: e.target.value })}
                  placeholder="Access Token"
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-2">Access Token Secret</label>
                <input
                  type="password"
                  value={twitterForm.accessTokenSecret}
                  onChange={(e) => setTwitterForm({ ...twitterForm, accessTokenSecret: e.target.value })}
                  placeholder="Access Token Secret"
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
                />
              </div>
            </div>

            {/* Test Result */}
            {twitterTestResult && (
              <div className={`p-3 rounded ${twitterTestResult.success ? 'bg-green-900/20 border border-green-800 text-green-400' : 'bg-red-900/20 border border-red-800 text-red-400'}`}>
                {twitterTestResult.success ? (
                  <div className="flex items-center gap-2">
                    <CheckCircleIcon className="w-5 h-5" />
                    <div>
                      <p className="font-medium">Credentials Valid!</p>
                      <p className="text-sm">@{twitterTestResult.account?.username} - {twitterTestResult.account?.name}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <XCircleIcon className="w-5 h-5" />
                    <p>{twitterTestResult.error}</p>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={testTwitterCredentials}
                disabled={!twitterForm.apiKey || !twitterForm.apiSecret || !twitterForm.accessToken || !twitterForm.accessTokenSecret || twitterTesting}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded transition-colors text-sm font-medium"
              >
                {twitterTesting ? 'Testing...' : 'Test Credentials'}
              </button>
              <button
                onClick={addTwitterAccount}
                disabled={!twitterForm.name || !twitterTestResult?.success}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded transition-colors text-sm font-medium"
              >
                Save Account
              </button>
              <button
                onClick={() => {
                  setShowAddTwitter(false);
                  setTwitterForm({ name: '', apiKey: '', apiSecret: '', accessToken: '', accessTokenSecret: '' });
                  setTwitterTestResult(null);
                }}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors text-sm font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Twitter Accounts List */}
        <div className="space-y-2">
          {twitterAccounts.length === 0 ? (
            <div className="p-6 bg-gray-800/30 border border-gray-700 rounded-lg text-center text-gray-500">
              <MegaphoneIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No Twitter accounts saved</p>
              <p className="text-sm mt-1">Add an account to get started</p>
            </div>
          ) : (
            twitterAccounts.map((account) => (
              <div key={account.id} className="p-4 bg-gray-800/50 border border-gray-700 hover:border-gray-600 rounded-lg flex items-center justify-between transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-purple-500/20 rounded-full flex items-center justify-center">
                    <MegaphoneIcon className="w-5 h-5 text-purple-400" />
                  </div>
                  <div>
                    <p className="font-medium">{account.name}</p>
                    <p className="text-sm text-gray-400">
                      @{account.accountInfo?.username || 'Unknown'}
                      {account.accountInfo?.verified && <span className="ml-2">✓</span>}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => deleteTwitterAccount(account.id)}
                  className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition-colors"
                  title="Delete account"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Telegram Accounts */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <ChatBubbleLeftRightIcon className="w-6 h-6 text-blue-400" />
            <h3 className="text-lg font-semibold">Telegram Accounts</h3>
            <span className="px-2 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded-full">
              {telegramAccounts.length} saved
            </span>
          </div>
          <button
            onClick={() => setShowAddTelegram(!showAddTelegram)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium"
          >
            <PlusIcon className="w-4 h-4" />
            Add Account
          </button>
        </div>

        {/* Add Telegram Account Form */}
        {showAddTelegram && (
          <div className="mb-4 p-6 bg-gray-800/50 border border-gray-700 rounded-lg space-y-4">
            <h4 className="text-md font-medium mb-4">Add Telegram Account</h4>
            
            <div>
              <label className="block text-sm text-gray-400 mb-2">Account Name</label>
              <input
                type="text"
                value={telegramForm.name}
                onChange={(e) => setTelegramForm({ ...telegramForm, name: e.target.value })}
                placeholder="My Telegram Account"
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-2">API ID</label>
                <input
                  type="text"
                  value={telegramForm.apiId}
                  onChange={(e) => setTelegramForm({ ...telegramForm, apiId: e.target.value })}
                  placeholder="12345678"
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-2">API Hash</label>
                <input
                  type="password"
                  value={telegramForm.apiHash}
                  onChange={(e) => setTelegramForm({ ...telegramForm, apiHash: e.target.value })}
                  placeholder="abcdef1234567890..."
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2">Phone Number</label>
              <input
                type="tel"
                value={telegramForm.phone}
                onChange={(e) => setTelegramForm({ ...telegramForm, phone: e.target.value })}
                placeholder="+1234567890"
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">Include country code (e.g., +1 for US)</p>
            </div>

            <div className="p-3 bg-blue-900/20 border border-blue-800 rounded text-sm text-blue-400">
              <p className="font-medium mb-1">Note:</p>
              <p>Telegram requires 2FA authorization on first use. You'll be prompted for a code when you first load messages.</p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={addTelegramAccount}
                disabled={!telegramForm.name || !telegramForm.apiId || !telegramForm.apiHash || !telegramForm.phone}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded transition-colors text-sm font-medium"
              >
                Save Account
              </button>
              <button
                onClick={() => {
                  setShowAddTelegram(false);
                  setTelegramForm({ name: '', apiId: '', apiHash: '', phone: '' });
                }}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors text-sm font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Telegram Accounts List */}
        <div className="space-y-2">
          {telegramAccounts.length === 0 ? (
            <div className="p-6 bg-gray-800/30 border border-gray-700 rounded-lg text-center text-gray-500">
              <ChatBubbleLeftRightIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No Telegram accounts saved</p>
              <p className="text-sm mt-1">Add an account to get started</p>
            </div>
          ) : (
            telegramAccounts.map((account) => (
              <div key={account.id} className="p-4 bg-gray-800/50 border border-gray-700 hover:border-gray-600 rounded-lg flex items-center justify-between transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-500/20 rounded-full flex items-center justify-center">
                    <ChatBubbleLeftRightIcon className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <p className="font-medium">{account.name}</p>
                    <p className="text-sm text-gray-400">{account.phone}</p>
                  </div>
                </div>
                <button
                  onClick={() => deleteTelegramAccount(account.id)}
                  className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition-colors"
                  title="Delete account"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Help Text */}
      <div className="p-4 bg-blue-900/20 border border-blue-800 rounded-lg text-sm text-blue-400">
        <p className="font-medium mb-2">💡 How to use:</p>
        <ul className="list-disc list-inside space-y-1 text-gray-400">
          <li>Add your Twitter/Telegram API accounts here</li>
          <li>Select accounts from dropdown in Marketing Widget</li>
          <li>Switch between accounts without re-entering credentials</li>
          <li>Accounts are stored locally in <code className="px-1 py-0.5 bg-gray-800 rounded text-xs">keys/</code> folder</li>
        </ul>
      </div>
    </div>
  );
}
