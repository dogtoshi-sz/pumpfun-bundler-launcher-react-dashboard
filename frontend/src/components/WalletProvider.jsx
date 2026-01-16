/**
 * Solana Wallet Provider
 * Wraps the app with wallet adapter context for Phantom integration
 */

import React, { useMemo } from 'react';
import { ConnectionProvider, WalletProvider as SolanaWalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';

// Import wallet adapter CSS
import '@solana/wallet-adapter-react-ui/styles.css';

const WalletProvider = ({ children, rpcEndpoint }) => {
  // Use env variable or fallback to mainnet
  const endpoint = rpcEndpoint || import.meta.env.VITE_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
  
  // Initialize wallet adapters (Phantom only for simplicity)
  const wallets = useMemo(() => [
    new PhantomWalletAdapter(),
  ], []);
  
  return (
    <ConnectionProvider endpoint={endpoint}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
};

export default WalletProvider;
