import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import WalletProvider from './components/WalletProvider.jsx'
import './index.css'

// Get RPC endpoint from env or use API server's endpoint
const rpcEndpoint = import.meta.env.VITE_RPC_ENDPOINT || 
  (import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api/rpc-proxy` : undefined);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WalletProvider rpcEndpoint={rpcEndpoint}>
      <App />
    </WalletProvider>
  </React.StrictMode>,
)




