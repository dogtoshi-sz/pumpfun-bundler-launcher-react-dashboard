# Pump.fun Bundler Frontend

Modern React frontend for the Pump.fun Bundler control panel.

## Features

- 🚀 **Token Launch**: Fill in token info and launch tokens
- 👥 **Holder Wallet Trading**: Buy and sell tokens with holder wallets
- 📋 **Menu Features**: Access all menu commands (rapid sell, gather, etc.)
- ⚙️ **Settings**: Configure bundle wallets, holder wallets, and options
- 📝 **Current Run Info**: View current token launch information

## Installation

```bash
cd frontend
npm install
```

## Development

### Quick Start

1. **Start the API Server** (in a separate terminal):
   ```bash
   cd ../api-server
   npm install  # First time only
   npm start
   ```
   The API server runs on `http://localhost:3001`

2. **Start the Frontend**:
   ```bash
   npm install  # First time only
   npm run dev
   ```
   The frontend will run on `http://localhost:3000` and proxy API requests to `http://localhost:3001`.

### Running a Test Token

1. **Configure your `.env` file** in the project root with:
   - `PRIVATE_KEY` - Your main wallet private key (base58 encoded)
   - `RPC_ENDPOINT` - Solana RPC endpoint
   - Token metadata (TOKEN_NAME, TOKEN_SYMBOL, DESCRIPTION, etc.)
   - Wallet configuration (BUNDLE_WALLET_COUNT, HOLDER_WALLET_COUNT, etc.)

2. **For Testing (Recommended)**:
   - Use Devnet: Set `RPC_ENDPOINT=https://api.devnet.solana.com`
   - Get free Devnet SOL from https://faucet.solana.com
   - Use small amounts for testing

3. **Launch a Token**:
   - Fill in token metadata in the frontend
   - Upload an image (optional)
   - Click "💾 Save Settings"
   - Click "🚀 Launch Token"
   - Wait for launch to complete (check terminal for progress)
   - Holder wallets will appear automatically

## Build

```bash
npm run build
```

## Requirements

- The API server must be running on port 3001 (`api-server/control-panel-server.js`)
- Node.js 18+ recommended


