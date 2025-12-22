import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './TradingTerminal.css';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

function TradingTerminal({ defaultMint }) {
  const [wallets, setWallets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  
  // Trading form state
  const [tradingForm, setTradingForm] = useState({
    selectedWallet: '',
    mintAddress: defaultMint || '',
    solAmount: '',
    sellPercentage: 100
  });

  // Update mint address if defaultMint changes
  useEffect(() => {
    if (defaultMint && !tradingForm.mintAddress) {
      setTradingForm(prev => ({ ...prev, mintAddress: defaultMint }));
    }
  }, [defaultMint, tradingForm.mintAddress]);
  
  // Wallet management state
  const [newWalletPrivateKey, setNewWalletPrivateKey] = useState('');
  const [showAddWallet, setShowAddWallet] = useState(false);
  
  // Token balance state
  const [tokenBalance, setTokenBalance] = useState(null);
  const [checkingBalance, setCheckingBalance] = useState(false);

  useEffect(() => {
    loadWallets();
  }, []);

  const loadWallets = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/trading/wallets`);
      if (res.data.success) {
        setWallets(res.data.wallets);
        if (res.data.wallets.length > 0 && !tradingForm.selectedWallet) {
          setTradingForm(prev => ({ ...prev, selectedWallet: res.data.wallets[0].address }));
        }
      }
    } catch (error) {
      setMessage({ type: 'error', text: `Failed to load wallets: ${error.message}` });
    }
  };

  const addWallet = async () => {
    if (!newWalletPrivateKey.trim()) {
      setMessage({ type: 'error', text: 'Please enter a private key' });
      return;
    }

    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/api/trading/wallets/add`, {
        privateKey: newWalletPrivateKey.trim()
      });
      
      if (res.data.success) {
        setMessage({ type: 'success', text: `Wallet added: ${res.data.address}` });
        setNewWalletPrivateKey('');
        setShowAddWallet(false);
        loadWallets();
      }
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.error || error.message });
    } finally {
      setLoading(false);
    }
  };

  const removeWallet = async (address) => {
    if (!window.confirm('Are you sure you want to remove this wallet?')) {
      return;
    }

    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/api/trading/wallets/remove`, {
        address: address
      });
      
      if (res.data.success) {
        setMessage({ type: 'success', text: 'Wallet removed' });
        loadWallets();
        if (wallets.length === 1) {
          setTradingForm(prev => ({ ...prev, selectedWallet: '' }));
        }
      }
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.error || error.message });
    } finally {
      setLoading(false);
    }
  };

  const checkTokenBalance = async () => {
    if (!tradingForm.selectedWallet || !tradingForm.mintAddress) {
      setMessage({ type: 'error', text: 'Please select a wallet and enter a mint address' });
      return;
    }

    setCheckingBalance(true);
    setMessage({ type: '', text: '' });
    try {
      const res = await axios.post(`${API_BASE}/api/trading/balance`, {
        walletAddress: tradingForm.selectedWallet,
        mintAddress: tradingForm.mintAddress
      });
      
      if (res.data.success) {
        setTokenBalance(res.data);
        setMessage({ type: 'success', text: `Balance: ${res.data.balance.toFixed(4)} tokens` });
      }
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.error || error.message });
    } finally {
      setCheckingBalance(false);
    }
  };

  const buyToken = async () => {
    if (!tradingForm.selectedWallet || !tradingForm.mintAddress || !tradingForm.solAmount) {
      setMessage({ type: 'error', text: 'Please fill in all required fields' });
      return;
    }

    setLoading(true);
    setMessage({ type: '', text: '' });
    
    try {
      const res = await axios.post(`${API_BASE}/api/trading/buy`, {
        walletAddress: tradingForm.selectedWallet,
        mintAddress: tradingForm.mintAddress,
        solAmount: parseFloat(tradingForm.solAmount)
      });
      
      if (res.data.success) {
        setMessage({ type: 'success', text: `🚀 Buy successful! Signature: ${res.data.signature.slice(0, 12)}...` });
        // Refresh wallet balance
        setTimeout(() => loadWallets(), 2000);
      } else {
        setMessage({ type: 'error', text: res.data.error || 'Buy failed' });
      }
    } catch (error) {
      console.error('Buy error:', error);
      setMessage({ type: 'error', text: error.response?.data?.error || error.message });
    } finally {
      setLoading(false);
    }
  };

  const sellToken = async () => {
    if (!tradingForm.selectedWallet || !tradingForm.mintAddress) {
      setMessage({ type: 'error', text: 'Please select a wallet and enter a mint address' });
      return;
    }

    setLoading(true);
    setMessage({ type: '', text: '' });
    
    try {
      const res = await axios.post(`${API_BASE}/api/trading/sell`, {
        walletAddress: tradingForm.selectedWallet,
        mintAddress: tradingForm.mintAddress,
        percentage: parseFloat(tradingForm.sellPercentage)
      });
      
      if (res.data.success) {
        setMessage({ type: 'success', text: `📉 Sell successful! Signature: ${res.data.signature.slice(0, 12)}...` });
        // Refresh wallet balance
        setTimeout(() => loadWallets(), 2000);
      } else {
        setMessage({ type: 'error', text: res.data.error || 'Sell failed' });
      }
    } catch (error) {
      console.error('Sell error:', error);
      setMessage({ type: 'error', text: error.response?.data?.error || error.message });
    } finally {
      setLoading(false);
    }
  };

  // Get DexScreener URL for the token
  const getDexScreenerUrl = (mintAddress) => {
    if (!mintAddress) return null;
    // DexScreener uses Solana token addresses
    return `https://dexscreener.com/solana/${mintAddress}?embed=1&theme=dark&trades=0&info=0`;
  };

  const selectedWallet = wallets.find(w => w.address === tradingForm.selectedWallet);

  return (
    <div className="trading-terminal">
      <div className="terminal-header">
        <h2>🔄 Trading Terminal</h2>
        <p>Buy and sell tokens using simple RPC (no Jito bundles)</p>
      </div>

      {message.text && (
        <div className={`message ${message.type}`}>
          {message.text}
          <button onClick={() => setMessage({ type: '', text: '' })}>×</button>
        </div>
      )}

      <div className="terminal-layout">
        {/* Left Panel: Wallet Management & Trading */}
        <div className="terminal-left">
          {/* Wallet Management */}
          <div className="wallet-section">
            <div className="section-header">
              <h3>💰 Trading Wallets</h3>
              <button 
                className="btn-add" 
                onClick={() => setShowAddWallet(!showAddWallet)}
              >
                {showAddWallet ? 'Cancel' : '+ Add Wallet'}
              </button>
            </div>

            {showAddWallet && (
              <div className="add-wallet-form">
                <input
                  type="text"
                  placeholder="Enter private key (base58)"
                  value={newWalletPrivateKey}
                  onChange={(e) => setNewWalletPrivateKey(e.target.value)}
                  className="input-field"
                />
                <button 
                  onClick={addWallet} 
                  disabled={loading}
                  className="btn-primary"
                >
                  Add Wallet
                </button>
              </div>
            )}

            <div className="wallet-list">
              {wallets.length === 0 ? (
                <p className="empty-state">No wallets added. Add a wallet to start trading.</p>
              ) : (
                wallets.map((wallet, index) => (
                  <div key={index} className="wallet-item">
                    <div className="wallet-info">
                      <div className="wallet-address">{wallet.address}</div>
                      <div className="wallet-balance">{wallet.balance.toFixed(4)} SOL</div>
                    </div>
                    <button
                      onClick={() => removeWallet(wallet.address)}
                      className="btn-remove"
                      disabled={loading}
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Trading Form */}
          <div className="trading-section">
            <h3>📈 Trade Tokens</h3>
            
            <div className="form-group">
              <label>Select Wallet</label>
              <select
                value={tradingForm.selectedWallet}
                onChange={(e) => setTradingForm(prev => ({ ...prev, selectedWallet: e.target.value }))}
                className="input-field"
              >
                <option value="">Select a wallet...</option>
                {wallets.map((wallet, index) => (
                  <option key={index} value={wallet.address}>
                    {wallet.address} ({wallet.balance.toFixed(4)} SOL)
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Token Mint Address</label>
              <div style={{ display: 'flex', gap: '10px' }}>
                <input
                  type="text"
                  placeholder="Enter token mint address"
                  value={tradingForm.mintAddress}
                  onChange={(e) => setTradingForm(prev => ({ ...prev, mintAddress: e.target.value }))}
                  className="input-field"
                  style={{ flex: 1 }}
                />
                <button
                  onClick={checkTokenBalance}
                  disabled={checkingBalance || !tradingForm.selectedWallet || !tradingForm.mintAddress}
                  className="btn-primary"
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {checkingBalance ? 'Checking...' : 'Check Balance'}
                </button>
              </div>
              {tokenBalance && (
                <div style={{ marginTop: '8px', fontSize: '13px', color: '#666' }}>
                  Token Balance: {tokenBalance.balance.toFixed(4)} {tokenBalance.hasTokens ? '✅' : '❌'}
                </div>
              )}
            </div>

            {selectedWallet && (
              <div className="wallet-summary">
                <strong>Selected Wallet:</strong> {selectedWallet.address}<br/>
                <strong>Balance:</strong> {selectedWallet.balance.toFixed(4)} SOL
              </div>
            )}

            {/* Buy Section */}
            <div className="trade-actions">
              <div className="buy-section">
                <h4>🟢 Buy</h4>
                <div className="form-group">
                  <label>SOL Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.1"
                    value={tradingForm.solAmount}
                    onChange={(e) => setTradingForm(prev => ({ ...prev, solAmount: e.target.value }))}
                    className="input-field"
                  />
                </div>
                <button
                  onClick={buyToken}
                  disabled={loading || !tradingForm.selectedWallet || !tradingForm.mintAddress || !tradingForm.solAmount}
                  className="btn-buy"
                >
                  {loading ? 'Buying...' : 'Buy Tokens'}
                </button>
              </div>

              {/* Sell Section */}
              <div className="sell-section">
                <h4>🔴 Sell</h4>
                <div className="form-group">
                  <label>Sell Percentage</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={tradingForm.sellPercentage}
                    onChange={(e) => setTradingForm(prev => ({ ...prev, sellPercentage: e.target.value }))}
                    className="input-field"
                  />
                </div>
                <button
                  onClick={sellToken}
                  disabled={loading || !tradingForm.selectedWallet || !tradingForm.mintAddress}
                  className="btn-sell"
                >
                  {loading ? 'Selling...' : `Sell ${tradingForm.sellPercentage}%`}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel: DexScreener Chart */}
        <div className="terminal-right">
          <div className="chart-section">
            <h3>📊 DexScreener Chart</h3>
            {tradingForm.mintAddress ? (
              <div className="chart-container">
                <iframe
                  src={getDexScreenerUrl(tradingForm.mintAddress)}
                  title="DexScreener Chart"
                  className="dexscreener-iframe"
                  frameBorder="0"
                />
                <div className="chart-actions">
                  <a
                    href={getDexScreenerUrl(tradingForm.mintAddress)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-link"
                  >
                    Open in DexScreener →
                  </a>
                </div>
              </div>
            ) : (
              <div className="chart-placeholder">
                <p>Enter a token mint address to view the chart</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default TradingTerminal;

