import { useState, useEffect } from 'react';
import { 
  MegaphoneIcon, 
  XMarkIcon, 
  ChevronUpIcon,
  ChevronDownIcon,
  PaperAirplaneIcon,
  CheckCircleIcon,
  ClockIcon,
  PhotoIcon,
  PlusIcon,
  TrashIcon,
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
  UserIcon,
  FlagIcon,
  SparklesIcon
} from '@heroicons/react/24/outline';

/**
 * Marketing Widget - Floating component for Twitter & Telegram
 * Tabs: Twitter (manual posting), Telegram (message monitoring & replies)
 * Persists across Launch and Terminal pages
 */
export default function MarketingWidget({ isTerminalPage = false, flashOnMount = false }) {
  // Widget state
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [activeTab, setActiveTab] = useState('twitter'); // 'twitter' or 'telegram'
  
  // Account management
  const [twitterAccounts, setTwitterAccounts] = useState([]);
  const [telegramAccounts, setTelegramAccounts] = useState([]);
  const [selectedTwitterAccount, setSelectedTwitterAccount] = useState(null);
  const [selectedTelegramAccount, setSelectedTelegramAccount] = useState(null);
  
  // Twitter state
  const [tweets, setTweets] = useState([
    {
      id: 1,
      text: '🚀 [token_name] is LIVE!\n\nContract Address:\n[CA]\n\n#Solana #PumpFun',
      imagePath: '',
      delay: 0,
      delayType: 'immediate', // 'immediate', 'after_launch', 'manual'
      condition: 'none', // 'none', 'price_target', 'market_cap'
      conditionValue: '',
      status: 'pending', // 'pending', 'posted', 'failed'
      postedAt: null,
      tweetId: null
    }
  ]);
  const [posting, setPosting] = useState(false);
  
  // Telegram state
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [chatId, setChatId] = useState('');
  const [replyText, setReplyText] = useState('');
  const [replyToMessage, setReplyToMessage] = useState(null);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [telegramError, setTelegramError] = useState(null);
  
  // Shared state
  const [tokenData, setTokenData] = useState(null);

  // Load accounts and settings on mount
  useEffect(() => {
    const savedTweets = localStorage.getItem('marketing_tweets');
    if (savedTweets) {
      try {
        setTweets(JSON.parse(savedTweets));
      } catch (e) {
        console.error('Failed to load saved tweets:', e);
      }
    }

    // Load saved account selections
    const savedTwitterAccountId = localStorage.getItem('selected_twitter_account');
    const savedTelegramAccountId = localStorage.getItem('selected_telegram_account');
    const savedChatId = localStorage.getItem('telegram_chat_id');
    if (savedChatId) {
      setChatId(savedChatId);
    }

    // Load accounts from API
    loadAccounts();

    // Load token data from current-run.json
    loadTokenData();

    // Listen for open widget event from footer button
    const handleOpenWidget = () => {
      setIsOpen(true);
    };
    window.addEventListener('open-marketing-widget', handleOpenWidget);
    
    return () => {
      window.removeEventListener('open-marketing-widget', handleOpenWidget);
    };
  }, []);
  
  // Auto-refresh Telegram messages every 10 seconds when tab is active
  useEffect(() => {
    if (activeTab === 'telegram' && chatId && isOpen && !isMinimized) {
      loadTelegramMessages();
      const interval = setInterval(loadTelegramMessages, 10000);
      return () => clearInterval(interval);
    }
  }, [activeTab, chatId, isOpen, isMinimized]);

  // Save tweets to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('marketing_tweets', JSON.stringify(tweets));
  }, [tweets]);

  const loadTokenData = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/current-run');
      if (response.ok) {
        const data = await response.json();
        setTokenData(data);
      }
    } catch (error) {
      console.error('Failed to load token data:', error);
    }
  };

  const loadAccounts = async () => {
    try {
      const [twitterRes, telegramRes] = await Promise.all([
        fetch('http://localhost:3001/api/twitter-accounts'),
        fetch('http://localhost:3001/api/telegram-accounts')
      ]);
      
      const twitterData = await twitterRes.json();
      const telegramData = await telegramRes.json();
      
      if (twitterData.success) {
        setTwitterAccounts(twitterData.accounts);
        
        // Auto-select first account if none selected
        const savedId = localStorage.getItem('selected_twitter_account');
        if (savedId) {
          const account = twitterData.accounts.find(a => a.id === savedId);
          if (account) setSelectedTwitterAccount(account);
        } else if (twitterData.accounts.length > 0) {
          setSelectedTwitterAccount(twitterData.accounts[0]);
        }
      }
      
      if (telegramData.success) {
        setTelegramAccounts(telegramData.accounts);
        
        // Auto-select first account if none selected
        const savedId = localStorage.getItem('selected_telegram_account');
        if (savedId) {
          const account = telegramData.accounts.find(a => a.id === savedId);
          if (account) setSelectedTelegramAccount(account);
        } else if (telegramData.accounts.length > 0) {
          setSelectedTelegramAccount(telegramData.accounts[0]);
        }
      }
    } catch (error) {
      console.error('Failed to load accounts:', error);
    }
  };

  const selectTwitterAccount = (accountId) => {
    const account = twitterAccounts.find(a => a.id === accountId);
    setSelectedTwitterAccount(account);
    localStorage.setItem('selected_twitter_account', accountId);
  };

  const selectTelegramAccount = (accountId) => {
    const account = telegramAccounts.find(a => a.id === accountId);
    setSelectedTelegramAccount(account);
    localStorage.setItem('selected_telegram_account', accountId);
  };

  const addTweet = () => {
    const newTweet = {
      id: Date.now(),
      text: '',
      imagePath: '',
      delay: 0,
      delayType: 'immediate',
      condition: 'none',
      conditionValue: '',
      status: 'pending',
      postedAt: null,
      tweetId: null
    };
    setTweets([...tweets, newTweet]);
  };

  const removeTweet = (id) => {
    setTweets(tweets.filter(t => t.id !== id));
  };

  const updateTweet = (id, field, value) => {
    setTweets(tweets.map(t => t.id === id ? { ...t, [field]: value } : t));
  };

  const postTweet = async (tweet) => {
    if (!tokenData || !tokenData.mintAddress) {
      alert('No token data found. Please launch a token first.');
      return;
    }

    if (!selectedTwitterAccount) {
      alert('No Twitter account selected. Please select an account or add one in Settings → Marketing.');
      return;
    }

    try {
      setPosting(true);
      updateTweet(tweet.id, 'status', 'posting');

      // Fetch full credentials for selected account
      const accountRes = await fetch(`http://localhost:3001/api/twitter-accounts/${selectedTwitterAccount.id}`);
      const accountData = await accountRes.json();
      
      if (!accountData.success) {
        throw new Error('Failed to load account credentials');
      }

      const credentials = accountData.account;

      const response = await fetch('http://localhost:3001/api/marketing/twitter/post-single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credentials: {
            apiKey: credentials.apiKey,
            apiSecret: credentials.apiSecret,
            accessToken: credentials.accessToken,
            accessTokenSecret: credentials.accessTokenSecret
          },
          tweet: {
            text: tweet.text,
            imagePath: tweet.imagePath || null
          },
          tokenData: {
            tokenName: tokenData.tokenName || '',
            tokenSymbol: tokenData.tokenSymbol || '',
            tokenAddress: tokenData.mintAddress,
            website: tokenData.website || '',
            telegram: tokenData.telegram || '',
            twitter: tokenData.twitter || '',
            description: tokenData.description || ''
          }
        })
      });

      const result = await response.json();
      
      if (result.success && result.tweetId) {
        updateTweet(tweet.id, 'status', 'posted');
        updateTweet(tweet.id, 'postedAt', new Date().toISOString());
        updateTweet(tweet.id, 'tweetId', result.tweetId);
      } else {
        updateTweet(tweet.id, 'status', 'failed');
        alert(`Failed to post tweet: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to post tweet:', error);
      updateTweet(tweet.id, 'status', 'failed');
      alert(`Failed to post tweet: ${error.message}`);
    } finally {
      setPosting(false);
    }
  };

  const postAllTweets = async () => {
    const pendingTweets = tweets.filter(t => t.status === 'pending' || t.status === 'failed');
    
    for (let i = 0; i < pendingTweets.length; i++) {
      const tweet = pendingTweets[i];
      
      // Apply delay
      if (i > 0 || tweet.delay > 0) {
        const delay = tweet.delay * 1000;
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      await postTweet(tweet);
    }
  };

  const resetTweets = () => {
    if (confirm('Reset all tweets to pending status?')) {
      setTweets(tweets.map(t => ({ ...t, status: 'pending', postedAt: null, tweetId: null })));
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'posted':
        return <CheckCircleIcon className="w-4 h-4 text-green-400" />;
      case 'posting':
        return <ArrowPathIcon className="w-4 h-4 text-blue-400 animate-spin" />;
      case 'failed':
        return <XMarkIcon className="w-4 h-4 text-red-400" />;
      default:
        return <ClockIcon className="w-4 h-4 text-gray-400" />;
    }
  };

  // ===== TELEGRAM FUNCTIONS =====
  
  const loadTelegramMessages = async () => {
    if (!chatId) return;
    
    if (!selectedTelegramAccount) {
      setTelegramError('No Telegram account selected. Please select an account or add one in Settings → Marketing.');
      return;
    }
    
    setLoadingMessages(true);
    setTelegramError(null);
    
    try {
      // Fetch full credentials for selected account
      const accountRes = await fetch(`http://localhost:3001/api/telegram-accounts/${selectedTelegramAccount.id}`);
      const accountData = await accountRes.json();
      
      if (!accountData.success) {
        throw new Error('Failed to load account credentials');
      }

      const credentials = accountData.account;

      const response = await fetch('http://localhost:3001/api/marketing/telegram/get-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credentials: {
            api_id: credentials.apiId,
            api_hash: credentials.apiHash,
            phone: credentials.phone
          },
          chat_id: chatId,
          limit: 50,
          users_only: true,
          hours_ago: 24
        })
      });
      
      const result = await response.json();
      
      if (result.success && result.messages) {
        setMessages(result.messages);
      } else {
        setTelegramError(result.error || 'Failed to load messages');
      }
    } catch (error) {
      setTelegramError(`Error: ${error.message}`);
    } finally {
      setLoadingMessages(false);
    }
  };
  
  const sendTelegramMessage = async () => {
    if (!chatId || !replyText.trim()) return;
    
    if (!selectedTelegramAccount) {
      alert('No Telegram account selected. Please select an account in Settings → Marketing.');
      return;
    }
    
    setSendingMessage(true);
    
    try {
      // Fetch full credentials for selected account
      const accountRes = await fetch(`http://localhost:3001/api/telegram-accounts/${selectedTelegramAccount.id}`);
      const accountData = await accountRes.json();
      
      if (!accountData.success) {
        throw new Error('Failed to load account credentials');
      }

      const credentials = accountData.account;

      const response = await fetch('http://localhost:3001/api/marketing/telegram/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credentials: {
            api_id: credentials.apiId,
            api_hash: credentials.apiHash,
            phone: credentials.phone
          },
          chat_id: chatId,
          text: replyText,
          reply_to_msg_id: replyToMessage?.id
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        setReplyText('');
        setReplyToMessage(null);
        loadTelegramMessages(); // Refresh messages
      } else {
        alert(`Failed to send message: ${result.error}`);
      }
    } catch (error) {
      alert(`Error sending message: ${error.message}`);
    } finally {
      setSendingMessage(false);
    }
  };
  
  const pinMessage = async (messageId) => {
    if (!chatId) return;
    
    if (!selectedTelegramAccount) {
      alert('No Telegram account selected');
      return;
    }
    
    try {
      // Fetch full credentials for selected account
      const accountRes = await fetch(`http://localhost:3001/api/telegram-accounts/${selectedTelegramAccount.id}`);
      const accountData = await accountRes.json();
      
      if (!accountData.success) {
        throw new Error('Failed to load account credentials');
      }

      const credentials = accountData.account;

      const response = await fetch('http://localhost:3001/api/marketing/telegram/pin-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credentials: {
            api_id: credentials.apiId,
            api_hash: credentials.apiHash,
            phone: credentials.phone
          },
          chat_id: chatId,
          message_id: messageId
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        alert('Message pinned successfully!');
      } else {
        alert(`Failed to pin message: ${result.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  };
  
  const deleteMessage = async (messageId) => {
    if (!chatId || !confirm('Delete this message?')) return;
    
    if (!selectedTelegramAccount) {
      alert('No Telegram account selected');
      return;
    }
    
    try {
      // Fetch full credentials for selected account
      const accountRes = await fetch(`http://localhost:3001/api/telegram-accounts/${selectedTelegramAccount.id}`);
      const accountData = await accountRes.json();
      
      if (!accountData.success) {
        throw new Error('Failed to load account credentials');
      }

      const credentials = accountData.account;

      const response = await fetch('http://localhost:3001/api/marketing/telegram/delete-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credentials: {
            api_id: credentials.apiId,
            api_hash: credentials.apiHash,
            phone: credentials.phone
          },
          chat_id: chatId,
          message_id: messageId
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        loadTelegramMessages(); // Refresh messages
      } else {
        alert(`Failed to delete message: ${result.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  };
  
  const insertTemplate = (template) => {
    const templates = {
      ca: `Contract Address: ${tokenData?.mintAddress || '[CA]'}`,
      website: tokenData?.website || 'Check pinned message for website',
      roadmap: 'Check our website for the full roadmap!',
      team: 'Team is active 24/7! 💪',
      lfg: 'LFG! 🚀🌙',
    };
    
    setReplyText(templates[template] || template);
  };
  
  const saveChatId = () => {
    localStorage.setItem('telegram_chat_id', chatId);
    loadTelegramMessages();
  };
  
  const formatTimeAgo = (timestamp) => {
    const seconds = Math.floor(Date.now() / 1000 - timestamp);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  // Don't show floating button - only use footer button
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[600px] max-h-[700px] bg-gray-900/95 backdrop-blur-sm border border-gray-800 rounded-lg shadow-2xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <MegaphoneIcon className="w-5 h-5 text-purple-400" />
          <h3 className="text-lg font-semibold">Marketing Control</h3>
          {tokenData && (
            <span className="text-xs text-gray-400 ml-2">
              {tokenData.tokenSymbol || 'No token'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1 hover:bg-gray-800 rounded transition-colors"
          >
            {isMinimized ? (
              <ChevronUpIcon className="w-5 h-5" />
            ) : (
              <ChevronDownIcon className="w-5 h-5" />
            )}
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 hover:bg-gray-800 rounded transition-colors"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {/* Tabs */}
          <div className="flex border-b border-gray-800 bg-gray-900/50">
            <button
              onClick={() => setActiveTab('twitter')}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                activeTab === 'twitter'
                  ? 'text-white border-b-2 border-purple-500 bg-gray-800/50'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/30'
              }`}
            >
              <MegaphoneIcon className="w-4 h-4" />
              Twitter
            </button>
            <button
              onClick={() => setActiveTab('telegram')}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                activeTab === 'telegram'
                  ? 'text-white border-b-2 border-blue-500 bg-gray-800/50'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/30'
              }`}
            >
              <ChatBubbleLeftRightIcon className="w-4 h-4" />
              Telegram
              {messages.length > 0 && (
                <span className="px-1.5 py-0.5 text-xs bg-blue-500 text-white rounded-full">
                  {messages.length}
                </span>
              )}
            </button>
          </div>

          {/* Twitter Tab Content */}
          {activeTab === 'twitter' && (
            <>
          {/* Twitter Account Selector */}
          <div className="p-4 border-b border-gray-800 bg-gray-900/50">
            <label className="block text-xs text-gray-400 mb-2">Twitter Account</label>
            {twitterAccounts.length === 0 ? (
              <div className="text-sm text-gray-500">
                No accounts saved. Add one in Settings → Marketing
              </div>
            ) : (
              <select
                value={selectedTwitterAccount?.id || ''}
                onChange={(e) => selectTwitterAccount(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
              >
                {twitterAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} (@{account.accountInfo?.username || 'Unknown'})
                  </option>
                ))}
              </select>
            )}
          </div>
          
          {/* Action Buttons */}
          <div className="p-4 border-b border-gray-800 flex gap-2">
            <button
              onClick={postAllTweets}
              disabled={posting || tweets.filter(t => t.status === 'pending').length === 0}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed text-white rounded-lg transition-all"
            >
              <PaperAirplaneIcon className="w-4 h-4" />
              Post All ({tweets.filter(t => t.status === 'pending').length})
            </button>
            <button
              onClick={resetTweets}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors"
              title="Reset all tweets to pending"
            >
              <ArrowPathIcon className="w-4 h-4" />
            </button>
            <button
              onClick={addTweet}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors"
              title="Add new tweet"
            >
              <PlusIcon className="w-4 h-4" />
            </button>
          </div>

          {/* Tweets List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {tweets.length === 0 ? (
              <div className="text-center text-gray-500 py-8">
                <MegaphoneIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No tweets configured</p>
                <button
                  onClick={addTweet}
                  className="mt-4 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
                >
                  Add First Tweet
                </button>
              </div>
            ) : (
              tweets.map((tweet, index) => (
                <div
                  key={tweet.id}
                  className={`p-3 rounded-lg border ${
                    tweet.status === 'posted' 
                      ? 'bg-green-900/20 border-green-800' 
                      : tweet.status === 'failed'
                      ? 'bg-red-900/20 border-red-800'
                      : 'bg-gray-800/50 border-gray-700'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-400">Tweet #{index + 1}</span>
                      {getStatusIcon(tweet.status)}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => postTweet(tweet)}
                        disabled={posting || tweet.status === 'posted'}
                        className="px-2 py-1 text-xs bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded transition-colors"
                      >
                        Post
                      </button>
                      <button
                        onClick={() => removeTweet(tweet.id)}
                        className="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                      >
                        <TrashIcon className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  <textarea
                    value={tweet.text}
                    onChange={(e) => updateTweet(tweet.id, 'text', e.target.value)}
                    placeholder="Tweet text (use [token_name], [CA], [website], etc.)"
                    className="w-full px-3 py-2 bg-gray-900/50 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-colors resize-none"
                    rows={3}
                    disabled={tweet.status === 'posted'}
                  />

                  {/* Tweet Controls */}
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Delay (seconds)</label>
                      <input
                        type="number"
                        value={tweet.delay}
                        onChange={(e) => updateTweet(tweet.id, 'delay', parseInt(e.target.value) || 0)}
                        className="w-full px-2 py-1 bg-gray-900/50 border border-gray-700 rounded text-sm text-white focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
                        min="0"
                        disabled={tweet.status === 'posted'}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Image Path</label>
                      <div className="relative">
                        <input
                          type="text"
                          value={tweet.imagePath}
                          onChange={(e) => updateTweet(tweet.id, 'imagePath', e.target.value)}
                          placeholder="./image/token.png"
                          className="w-full px-2 py-1 pr-8 bg-gray-900/50 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
                          disabled={tweet.status === 'posted'}
                        />
                        {tweet.imagePath && (
                          <PhotoIcon className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-purple-400" />
                        )}
                      </div>
                    </div>
                  </div>

                  {tweet.postedAt && (
                    <div className="mt-2 text-xs text-gray-500">
                      Posted: {new Date(tweet.postedAt).toLocaleString()}
                      {tweet.tweetId && (
                        <a
                          href={`https://twitter.com/user/status/${tweet.tweetId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-2 text-purple-400 hover:text-purple-300"
                        >
                          View Tweet →
                        </a>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Help Text */}
          <div className="p-3 border-t border-gray-800 bg-gray-900/50">
            <p className="text-xs text-gray-400">
              <strong>Placeholders:</strong> [token_name], [token_symbol], [CA], [website], [telegram], [twitter]
            </p>
          </div>
            </>
          )}

          {/* Telegram Tab Content */}
          {activeTab === 'telegram' && (
            <>
              {/* Telegram Account Selector */}
              <div className="p-4 border-b border-gray-800 bg-gray-900/50">
                <label className="block text-xs text-gray-400 mb-2">Telegram Account</label>
                {telegramAccounts.length === 0 ? (
                  <div className="text-sm text-gray-500">
                    No accounts saved. Add one in Settings → Marketing
                  </div>
                ) : (
                  <select
                    value={selectedTelegramAccount?.id || ''}
                    onChange={(e) => selectTelegramAccount(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  >
                    {telegramAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name} ({account.phone})
                      </option>
                    ))}
                  </select>
                )}
              </div>
              
              {/* Chat ID Configuration */}
              <div className="p-4 border-b border-gray-800 bg-gray-900/50">
                <label className="block text-xs text-gray-400 mb-2">Telegram Group Chat ID</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={chatId}
                    onChange={(e) => setChatId(e.target.value)}
                    placeholder="@groupname or -100123456789"
                    className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    onClick={saveChatId}
                    disabled={!chatId.trim()}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded transition-colors text-sm font-medium"
                  >
                    Load
                  </button>
                  <button
                    onClick={loadTelegramMessages}
                    disabled={!chatId || loadingMessages}
                    className="px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded transition-colors"
                    title="Refresh messages"
                  >
                    <ArrowPathIcon className={`w-4 h-4 ${loadingMessages ? 'animate-spin' : ''}`} />
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Get Chat ID: Forward a message from your group to @userinfobot
                </p>
              </div>

              {/* Error Display */}
              {telegramError && (
                <div className="p-3 mx-4 mt-4 bg-red-900/20 border border-red-800 rounded text-sm text-red-400">
                  {telegramError}
                </div>
              )}

              {/* Message Feed */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {loadingMessages && messages.length === 0 ? (
                  <div className="text-center text-gray-500 py-8">
                    <ArrowPathIcon className="w-8 h-8 mx-auto mb-2 animate-spin opacity-50" />
                    <p>Loading messages...</p>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center text-gray-500 py-8">
                    <ChatBubbleLeftRightIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>No messages yet</p>
                    <p className="text-xs mt-1">Enter a Chat ID and click Load</p>
                  </div>
                ) : (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className="p-3 rounded-lg bg-gray-800/50 border border-gray-700 hover:border-gray-600 transition-colors"
                    >
                      {/* Message Header */}
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <UserIcon className="w-4 h-4 text-blue-400 flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-white truncate">
                              {message.sender.first_name || 'User'}{' '}
                              {message.sender.username && (
                                <span className="text-gray-400">@{message.sender.username}</span>
                              )}
                            </p>
                            <p className="text-xs text-gray-500">
                              {formatTimeAgo(message.timestamp)}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <button
                            onClick={() => setReplyToMessage(message)}
                            className="p-1 text-gray-400 hover:text-blue-400 hover:bg-gray-700 rounded transition-colors"
                            title="Reply"
                          >
                            <PaperAirplaneIcon className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => pinMessage(message.id)}
                            className="p-1 text-gray-400 hover:text-yellow-400 hover:bg-gray-700 rounded transition-colors"
                            title="Pin"
                          >
                            <FlagIcon className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => deleteMessage(message.id)}
                            className="p-1 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition-colors"
                            title="Delete"
                          >
                            <TrashIcon className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      
                      {/* Message Text */}
                      {message.text && (
                        <p className="text-sm text-gray-200 whitespace-pre-wrap break-words">
                          {message.text}
                        </p>
                      )}
                      
                      {/* Media Indicator */}
                      {message.has_media && (
                        <div className="mt-2 flex items-center gap-1 text-xs text-gray-400">
                          <PhotoIcon className="w-3 h-3" />
                          <span>Has media</span>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Quick Templates */}
              <div className="px-4 py-2 border-t border-gray-800 bg-gray-900/50">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => insertTemplate('ca')}
                    className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
                  >
                    CA
                  </button>
                  <button
                    onClick={() => insertTemplate('website')}
                    className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
                  >
                    Website
                  </button>
                  <button
                    onClick={() => insertTemplate('roadmap')}
                    className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
                  >
                    Roadmap
                  </button>
                  <button
                    onClick={() => insertTemplate('team')}
                    className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
                  >
                    Team
                  </button>
                  <button
                    onClick={() => insertTemplate('lfg')}
                    className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
                  >
                    LFG 🚀
                  </button>
                </div>
              </div>

              {/* Reply Box */}
              <div className="p-4 border-t border-gray-800 bg-gray-900">
                {replyToMessage && (
                  <div className="mb-2 p-2 bg-blue-900/20 border border-blue-800 rounded text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-blue-400">Replying to @{replyToMessage.sender.username || replyToMessage.sender.first_name}</span>
                      <button
                        onClick={() => setReplyToMessage(null)}
                        className="text-gray-400 hover:text-white"
                      >
                        <XMarkIcon className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="text-gray-400 truncate">{replyToMessage.text}</p>
                  </div>
                )}
                <div className="flex gap-2">
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendTelegramMessage();
                      }
                    }}
                    placeholder="Type your message... (Enter to send, Shift+Enter for new line)"
                    className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none"
                    rows={2}
                    disabled={!chatId}
                  />
                  <button
                    onClick={sendTelegramMessage}
                    disabled={!chatId || !replyText.trim() || sendingMessage}
                    className="px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed text-white rounded transition-all flex items-center gap-2"
                  >
                    {sendingMessage ? (
                      <ArrowPathIcon className="w-4 h-4 animate-spin" />
                    ) : (
                      <PaperAirplaneIcon className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  <SparklesIcon className="w-3 h-3 inline mr-1" />
                  Auto-refreshes every 10s • Use templates for quick replies
                </p>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
