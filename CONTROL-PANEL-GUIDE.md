# Control Panel Guide

## Quick Start

### Starting the Frontend and API Server

1. **Start the API Server** (Terminal 1):
   ```bash
   cd api-server
   npm install  # First time only
   npm start
   ```
   The API server will run on `http://localhost:3001`

2. **Start the Frontend** (Terminal 2):
   ```bash
   cd frontend
   npm install  # First time only
   npm run dev
   ```
   The frontend will run on `http://localhost:3000` and automatically open in your browser

3. **Access the Control Panel**:
   - Open `http://localhost:3000` in your browser
   - The frontend will automatically connect to the API server

### Running a Test Token Launch

1. **Configure Settings**:
   - Fill in token metadata (Name, Symbol, Description)
   - Upload an image (optional)
   - Set wallet counts and amounts
   - Click "💾 Save Settings"

2. **Launch Token**:
   - Click "🚀 Launch Token"
   - The launch process will run in the background (check terminal for progress)
   - Wait for launch to complete (usually 30-60 seconds)
   - Holder wallets will appear automatically when ready

3. **Test Features**:
   - View holder wallets with balances
   - Buy/sell tokens using holder wallets
   - Use rapid sell commands
   - Gather SOL from wallets

**Note:** For testing, consider using Devnet (see "Testing with a Test Token" section below) to avoid spending real SOL.

## How It Works

### 1. **Token Launch Process**

The control panel works **exactly like the terminal version** (`npm start`). When you click "Launch Token" (when we add it), it will:

1. Read all settings from `.env` file
2. Create token using pump.fun SDK
3. Create bundle wallets and holder wallets
4. Fund all wallets with SOL
5. Create Jito bundle with token creation + buys
6. Save everything to `keys/current-run.json`

**It's the same code** - just triggered from the web UI instead of terminal.

### 2. **How Wallets Load**

Wallets are loaded from `keys/current-run.json` which is created after a successful token launch:

```json
{
  "mintAddress": "...",
  "holderWalletKeys": ["privateKey1", "privateKey2", ...],
  "bundleWalletKeys": ["privateKey1", "privateKey2", ...],
  ...
}
```

**Holder Wallets:**
- Created during token launch
- Funded with SOL (from `HOLDER_WALLET_AMOUNT` in .env)
- Saved to `current-run.json`
- Auto-loaded in the control panel
- Displayed with SOL and token balances
- Can buy/sell manually

**Bundle Wallets:**
- Created during token launch
- Used in Jito bundle for rapid buying
- Also saved to `current-run.json`
- Can be used for selling via "Rapid Sell All" button

### 3. **Testing with a Test Token**

To test all features with a test token:

#### Option 1: Use Devnet (Recommended for Testing)

1. **Change RPC to Devnet** in `.env`:
   ```
   RPC_ENDPOINT=https://api.devnet.solana.com
   RPC_WEBSOCKET_ENDPOINT=wss://api.devnet.solana.com
   ```

2. **Get Devnet SOL** (free):
   - Visit: https://faucet.solana.com
   - Request SOL to your deployer wallet address

3. **Launch a test token**:
   - Fill out token metadata in the control panel
   - Click "Launch Token" (when we add it)
   - Or use terminal: `npm start`

4. **Test all features**:
   - ✅ Holder wallets will load automatically
   - ✅ Buy/sell buttons will work
   - ✅ Rapid sell commands will work
   - ✅ Gather commands will work
   - ✅ All buttons are functional

#### Option 2: Use Mainnet with Small Amounts

1. **Set small amounts** in `.env`:
   ```
   BUNDLE_WALLET_COUNT=2
   BUNDLE_SWAP_AMOUNTS=0.01,0.01
   HOLDER_WALLET_COUNT=2
   BUYER_AMOUNT=0.01
   ```

2. **Launch token** (uses real SOL, but small amounts)

3. **Test features** with the launched token

### 4. **Image Upload**

The control panel now supports **image upload**:

1. Click "Upload Image" button in token metadata form
2. Select an image file (PNG, JPG, etc. - max 10MB)
3. Image is saved to `image/` folder
4. `FILE` path in `.env` is automatically updated
5. Image is used when launching the token

**Note:** The image is saved locally, just like when you specify a path manually.

### 5. **Command Buttons**

All command buttons execute the **same scripts** as the terminal:

- **Rapid Sell All** → Runs `npm run rapid-sell`
- **Gather All** → Runs `npm run gather-all`
- **Check Balance** → Runs `npm run check-balance`
- etc.

They work exactly the same - just triggered from the UI.

### 6. **Settings Updates**

When you update settings in the control panel:
- Changes are saved directly to `.env` file
- Takes effect immediately
- Next token launch will use new settings
- Same as editing `.env` manually

## Quick Test Checklist

1. ✅ **Deployer wallet loads** - Shows address and balance
2. ✅ **Token metadata form** - Fill out and save
3. ✅ **Image upload** - Upload an image file
4. ✅ **Launch token** (when button is added) - Creates token and wallets
5. ✅ **Holder wallets appear** - Auto-load after launch
6. ✅ **Buy tokens** - Use holder wallet buy buttons
7. ✅ **Sell tokens** - Use holder wallet sell buttons
8. ✅ **Rapid sell** - Test "Rapid Sell All" button
9. ✅ **Gather** - Test "Gather All" button
10. ✅ **Settings** - Update .env values from UI

## Differences from Terminal Version

**Same functionality, different interface:**
- ✅ Same token launch process
- ✅ Same wallet creation
- ✅ Same buy/sell functions
- ✅ Same commands
- ✅ Same .env file usage

**Only difference:**
- Web UI instead of terminal menus
- Image upload instead of file path
- Visual wallet display instead of text list


