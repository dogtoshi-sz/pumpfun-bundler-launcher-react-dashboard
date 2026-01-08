# GMGN Chart Integration

## Overview
The GMGN chart has been integrated into the pumpfun bundler frontend, allowing you to view real-time trading charts with automatic wallet tracking for your launched tokens.

## How It Works

### 1. Iframe Communication
The integration uses the same iframe communication protocol as razebot:
- **Iframe URL**: `https://frame.raze.sh/sol/?theme=green&token={mintAddress}`
- **Communication**: Uses `postMessage` API for bidirectional communication
- **Protocol**: Based on GMGN/Raze iframe API

### 2. Wallet Tracking
When wallets are loaded in the HolderWallets component:
- All wallets (holder, bundle, dev) are automatically sent to the GMGN iframe
- Each wallet gets a label (e.g., "Wallet 1", "Bundle Wallet", etc.)
- The iframe tracks all trades from these wallets in real-time

### 3. Token Navigation
When a token is launched:
- The chart automatically navigates to the token's trading page
- All wallets are sent to the iframe for tracking
- The chart displays real-time price, volume, and trading activity

## Components

### GMGNChart.jsx
A React component that:
- Embeds the GMGN iframe
- Manages iframe communication
- Sends wallets to the iframe via `ADD_WALLETS` message
- Navigates to token via `NAVIGATE` message
- Handles iframe ready state and message queuing

**Props:**
- `wallets`: Array of wallet objects with `address` property
- `mintAddress`: Token mint address (optional)
- `className`: Additional CSS classes

### Integration in HolderWallets.jsx
- Added tab navigation: "Wallets" and "GMGN Chart"
- Chart tab displays the GMGN chart component
- Automatically passes wallets and mintAddress to the chart

## Message Protocol

### Messages Sent TO Iframe:
1. **ADD_WALLETS**: Send wallets for tracking
   ```javascript
   {
     type: 'ADD_WALLETS',
     wallets: [
       { address: '...', label: 'Wallet 1' },
       ...
     ]
   }
   ```

2. **NAVIGATE**: Navigate to token view
   ```javascript
   {
     type: 'NAVIGATE',
     view: 'token',
     tokenMint: '...',
     wallets: [...]
   }
   ```

### Messages Received FROM Iframe:
1. **IFRAME_READY**: Iframe is loaded and ready
2. **WHITELIST_TRADING_STATS**: Trading statistics for tracked wallets
3. **WHITELIST_TRADE**: Individual trades from tracked wallets
4. **TOKEN_PRICE_UPDATE**: Real-time token price updates
5. **SOL_PRICE_UPDATE**: SOL price updates

## Usage

1. Launch a token using the TokenLaunch component
2. Navigate to HolderWallets component
3. Click the "📊 GMGN Chart" tab
4. The chart will automatically:
   - Load with your token
   - Track all your wallets
   - Display real-time trading data

## Features

✅ **Automatic Wallet Tracking**: All wallets are automatically tracked  
✅ **Real-time Updates**: Chart updates in real-time with trading activity  
✅ **Token Navigation**: Automatically navigates to your launched token  
✅ **Wallet Labels**: Each wallet gets a descriptive label  
✅ **Responsive Design**: Chart adapts to container size  

## Technical Details

### Iframe URL Format
```
https://frame.raze.sh/sol/?theme=green&token={mintAddress}
```

### Wallet Format
Wallets are sent as:
```javascript
{
  address: string,  // Wallet public key
  label: string     // Display label (e.g., "Wallet 1", "Bundle Wallet")
}
```

### Message Queue
Messages are queued if the iframe isn't ready yet, ensuring all commands are executed once the iframe loads.

### Retry Logic
Navigation messages are sent multiple times with delays to ensure the iframe receives them, handling race conditions.

## Future Enhancements

Potential improvements:
- Display trading stats in a sidebar
- Show recent trades from tracked wallets
- Add wallet filtering options
- Display PnL for each wallet
- Add export functionality for trading data

## Notes

- The iframe uses `postMessage` API for cross-origin communication
- Origin validation should be added in production
- The chart theme is set to "green" to match the pumpfun bundler theme
- All wallet addresses are automatically tracked - no manual configuration needed

