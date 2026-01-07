import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useEffect, useState } from 'react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

export default function WalletConnection() {
  const { publicKey, wallet, disconnect, connected, connecting } = useWallet();
  const { connection } = useConnection();
  const [balance, setBalance] = useState(null);
  const [loadingBalance, setLoadingBalance] = useState(false);

  // Fetch balance when wallet is connected
  useEffect(() => {
    if (!connected || !publicKey || !connection) {
      setBalance(null);
      return;
    }

    const fetchBalance = async () => {
      try {
        setLoadingBalance(true);
        const balance = await connection.getBalance(publicKey);
        setBalance(balance / LAMPORTS_PER_SOL);
      } catch (error) {
        console.error('Error fetching balance:', error);
        setBalance(null);
      } finally {
        setLoadingBalance(false);
      }
    };

    // Fetch immediately
    fetchBalance();
    
    // Set up interval to refresh balance every 10 seconds
    const interval = setInterval(fetchBalance, 10000);
    return () => clearInterval(interval);
  }, [connected, publicKey, connection]);

  if (!connected) {
    return (
      <div className="flex items-center gap-2">
        <WalletMultiButton className="!bg-blue-600 hover:!bg-blue-700 !text-white !rounded-lg !px-4 !py-2 !text-sm !font-medium !transition-colors" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-900/50 border border-gray-800 rounded-lg">
        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
        <span className="text-xs text-gray-400">
          {wallet?.adapter?.name || 'Wallet'}
        </span>
      </div>
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-900/50 border border-gray-800 rounded-lg">
        <span className="text-xs text-gray-400">Balance:</span>
        {loadingBalance ? (
          <span className="text-xs text-gray-500">Loading...</span>
        ) : (
          <span className="text-xs text-white font-medium">
            {balance !== null ? `${balance.toFixed(4)} SOL` : '—'}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-900/50 border border-gray-800 rounded-lg">
        <span className="text-xs text-gray-400">Address:</span>
        <span className="text-xs text-white font-mono">
          {publicKey?.toBase58().slice(0, 4)}...{publicKey?.toBase58().slice(-4)}
        </span>
      </div>
      <button
        onClick={disconnect}
        className="px-3 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-600/50 rounded-lg text-xs text-red-400 hover:text-red-300 transition-colors"
      >
        Disconnect
      </button>
    </div>
  );
}

