import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

function ProfitDashboard({ mintAddress, onQuickBuy, onQuickSell }) {
  const [priceData, setPriceData] = useState(null);
  const [walletStatus, setWalletStatus] = useState([]);
  const [profitMetrics, setProfitMetrics] = useState({
    totalInvested: 0,
    currentValue: 0,
    profit: 0,
    profitPercent: 0,
    walletsSold: 0,
    walletsHolding: 0
  });
  const [loading, setLoading] = useState(false);

  // Fetch wallet status and profit data
  const fetchWalletStatus = async () => {
    if (!mintAddress) return;
    
    try {
      // Get wallet status from current-run.json and sold-wallets.json
      const res = await axios.get(`${API_BASE}/api/wallet-status`, {
        params: { mintAddress }
      });
      
      if (res.data.success) {
        setWalletStatus(res.data.wallets);
        
        // Calculate profit metrics
        const metrics = calculateProfitMetrics(res.data.wallets);
        setProfitMetrics(metrics);
      }
    } catch (error) {
      console.error('Error fetching wallet status:', error);
    }
  };

  // Calculate profit metrics from wallet data
  const calculateProfitMetrics = (wallets) => {
    let totalInvested = 0;
    let currentValue = 0;
    let walletsSold = 0;
    let walletsHolding = 0;

    wallets.forEach(wallet => {
      totalInvested += wallet.invested || 0;
      currentValue += wallet.currentValue || 0;
      if (wallet.sold) {
        walletsSold++;
      } else {
        walletsHolding++;
      }
    });

    const profit = currentValue - totalInvested;
    const profitPercent = totalInvested > 0 ? (profit / totalInvested) * 100 : 0;

    return {
      totalInvested,
      currentValue,
      profit,
      profitPercent,
      walletsSold,
      walletsHolding
    };
  };

  // Fetch price data from Birdeye (or use iframe)
  useEffect(() => {
    if (!mintAddress) return;

    // Fetch wallet status every 2 seconds
    const interval = setInterval(fetchWalletStatus, 2000);
    fetchWalletStatus(); // Initial fetch

    return () => clearInterval(interval);
  }, [mintAddress]);

  if (!mintAddress) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
        <p>🚀 Launch a token to see the profit dashboard</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      {/* Profit Metrics Header */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
        gap: '15px', 
        marginBottom: '20px' 
      }}>
        <div style={{ 
          padding: '15px', 
          backgroundColor: profitMetrics.profit >= 0 ? '#d4edda' : '#f8d7da', 
          borderRadius: '8px',
          border: `2px solid ${profitMetrics.profit >= 0 ? '#28a745' : '#dc3545'}`
        }}>
          <div style={{ fontSize: '12px', color: '#666', marginBottom: '5px' }}>Total Profit</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: profitMetrics.profit >= 0 ? '#28a745' : '#dc3545' }}>
            {profitMetrics.profit >= 0 ? '+' : ''}{profitMetrics.profit.toFixed(4)} SOL
          </div>
          <div style={{ fontSize: '14px', color: '#666' }}>
            {profitMetrics.profitPercent >= 0 ? '+' : ''}{profitMetrics.profitPercent.toFixed(2)}%
          </div>
        </div>

        <div style={{ padding: '15px', backgroundColor: '#e7f3ff', borderRadius: '8px', border: '2px solid #007bff' }}>
          <div style={{ fontSize: '12px', color: '#666', marginBottom: '5px' }}>Total Invested</div>
          <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#007bff' }}>
            {profitMetrics.totalInvested.toFixed(4)} SOL
          </div>
        </div>

        <div style={{ padding: '15px', backgroundColor: '#fff3cd', borderRadius: '8px', border: '2px solid #ffc107' }}>
          <div style={{ fontSize: '12px', color: '#666', marginBottom: '5px' }}>Current Value</div>
          <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#856404' }}>
            {profitMetrics.currentValue.toFixed(4)} SOL
          </div>
        </div>

        <div style={{ padding: '15px', backgroundColor: '#f0f0f0', borderRadius: '8px' }}>
          <div style={{ fontSize: '12px', color: '#666', marginBottom: '5px' }}>Wallet Status</div>
          <div style={{ fontSize: '16px', fontWeight: 'bold' }}>
            <span style={{ color: '#dc3545' }}>Sold: {profitMetrics.walletsSold}</span>
            {' / '}
            <span style={{ color: '#28a745' }}>Holding: {profitMetrics.walletsHolding}</span>
          </div>
        </div>
      </div>

      {/* Birdeye Chart */}
      <div style={{ marginBottom: '20px', backgroundColor: '#fff', borderRadius: '8px', padding: '10px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
        <h3 style={{ marginTop: '0', marginBottom: '10px' }}>📈 Price Chart</h3>
        <iframe
          src={`https://birdeye.so/token/${mintAddress}?embed=true`}
          style={{
            width: '100%',
            height: '500px',
            border: 'none',
            borderRadius: '5px'
          }}
          title="Birdeye Chart"
        />
        <div style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>
          <a href={`https://birdeye.so/token/${mintAddress}`} target="_blank" rel="noopener noreferrer" style={{ color: '#007bff' }}>
            Open in Birdeye ↗
          </a>
        </div>
      </div>

      {/* Quick Actions */}
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ marginBottom: '10px' }}>⚡ Quick Actions</h3>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            onClick={async () => {
              const amount = prompt('💰 Enter SOL amount to buy:', '0.1');
              if (amount && !isNaN(parseFloat(amount)) && parseFloat(amount) > 0) {
                await onQuickBuy(parseFloat(amount));
              }
            }}
            style={{
              padding: '12px 24px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 'bold'
            }}
          >
            🟢 Quick Buy
          </button>
          <button
            onClick={async () => {
              const confirm = window.confirm('🔴 Sell 100% of tokens from main wallet?');
              if (confirm) {
                await onQuickSell();
              }
            }}
            style={{
              padding: '12px 24px',
              backgroundColor: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 'bold'
            }}
          >
            🔴 Quick Sell (100%)
          </button>
          <button
            onClick={fetchWalletStatus}
            disabled={loading}
            style={{
              padding: '12px 24px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: 'bold',
              opacity: loading ? 0.6 : 1
            }}
          >
            🔄 Refresh Status
          </button>
        </div>
      </div>

      {/* Wallet Status Table */}
      <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '15px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
        <h3 style={{ marginTop: '0', marginBottom: '15px' }}>💰 Wallet Status</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
                <th style={{ padding: '10px', textAlign: 'left' }}>Wallet</th>
                <th style={{ padding: '10px', textAlign: 'left' }}>Type</th>
                <th style={{ padding: '10px', textAlign: 'right' }}>Invested</th>
                <th style={{ padding: '10px', textAlign: 'right' }}>Current Value</th>
                <th style={{ padding: '10px', textAlign: 'right' }}>Profit</th>
                <th style={{ padding: '10px', textAlign: 'center' }}>Status</th>
                <th style={{ padding: '10px', textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {walletStatus.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
                    Loading wallet status...
                  </td>
                </tr>
              ) : (
                walletStatus.map((wallet, index) => (
                  <tr key={index} style={{ borderBottom: '1px solid #dee2e6' }}>
                    <td style={{ padding: '10px', fontFamily: 'monospace', fontSize: '12px' }}>
                      {wallet.address?.slice(0, 8)}...{wallet.address?.slice(-6)}
                    </td>
                    <td style={{ padding: '10px' }}>
                      {wallet.type || 'Bundler'}
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>
                      {wallet.invested?.toFixed(4) || '0.0000'} SOL
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>
                      {wallet.currentValue?.toFixed(4) || '0.0000'} SOL
                    </td>
                    <td style={{ 
                      padding: '10px', 
                      textAlign: 'right',
                      color: (wallet.profit || 0) >= 0 ? '#28a745' : '#dc3545',
                      fontWeight: 'bold'
                    }}>
                      {(wallet.profit || 0) >= 0 ? '+' : ''}{wallet.profit?.toFixed(4) || '0.0000'} SOL
                    </td>
                    <td style={{ padding: '10px', textAlign: 'center' }}>
                      {wallet.sold ? (
                        <span style={{ color: '#dc3545', fontWeight: 'bold' }}>🔴 SOLD</span>
                      ) : (
                        <span style={{ color: '#28a745', fontWeight: 'bold' }}>🟢 HOLDING</span>
                      )}
                    </td>
                    <td style={{ padding: '10px', textAlign: 'center' }}>
                      {!wallet.sold && (
                        <button
                          onClick={() => onQuickSell && onQuickSell(wallet.address)}
                          style={{
                            padding: '5px 10px',
                            backgroundColor: '#dc3545',
                            color: 'white',
                            border: 'none',
                            borderRadius: '3px',
                            cursor: 'pointer',
                            fontSize: '12px'
                          }}
                        >
                          Sell
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default ProfitDashboard;

