# Pumpfun Token Bundler - Frontend

A beautiful web interface for launching tokens and managing wallets on Pump.fun.

## 🚀 Quick Start

### 1. Install API Server Dependencies

```bash
cd api-server
npm install
```

### 2. Install Frontend Dependencies

```bash
cd ../frontend
npm install
```

### 3. Start the API Server

In one terminal:
```bash
cd api-server
npm start
```

The API server will run on `http://localhost:3001`

### 4. Start the Frontend

In another terminal:
```bash
cd frontend
npm start
```

The frontend will open at `http://localhost:3000`

## 📋 Process Flow

### Launch Token Flow:
1. **Upload Image** - Select and upload your token image
2. **Fill Token Info** - Enter token name, symbol, description, social links
3. **Configure Bundle** - Set number of wallets and swap amounts
4. **Launch** - Click "Launch Token" button
   - Creates token on Pump.fun
   - Generates wallets
   - Distributes SOL
   - Creates Lookup Table (LUT)
   - Bundles all buy transactions
   - Sends bundle via Jito

### Gather/Sell Flow:
1. **Gather All** - Sells all tokens from all wallets and collects SOL
2. **Gather SOL Only** - Collects SOL without selling tokens

## 🎯 Features

- ✅ **Image Upload** - Upload token images directly from browser
- ✅ **Token Configuration** - Fill in all token metadata
- ✅ **Bundle Configuration** - Set wallet count and swap amounts
- ✅ **One-Click Launch** - Launch tokens with a single button
- ✅ **Gather/Sell** - Recover SOL and sell tokens easily
- ✅ **Real-time Status** - See wallet count and last mint address
- ✅ **Beautiful UI** - Modern, responsive design

## 🔧 Configuration

Make sure your `.env` file in the root directory is configured with:
- `PRIVATE_KEY` - Your main wallet private key
- `RPC_ENDPOINT` - Your RPC endpoint (Helius recommended)
- All other required variables

## 📝 API Endpoints

- `GET /api/status` - Get current status (wallets, mint address)
- `POST /api/upload-image` - Upload token image
- `POST /api/update-config` - Update token configuration
- `POST /api/launch-token` - Launch token (creates and bundles)
- `POST /api/gather` - Gather all (sells tokens + collects SOL)
- `POST /api/gather-sol` - Gather SOL only
- `GET /api/wallets` - Get wallet balances

## 🎨 UI Features

### Launch Tab:
- Image upload with preview
- Token information form
- Social media links
- Bundle configuration
- Vanity mode toggle
- Lil Jito mode toggle

### Gather Tab:
- Gather All button (sells tokens + collects SOL)
- Gather SOL Only button
- Status information

## ⚠️ Important Notes

1. **Main Wallet Balance**: Make sure your main wallet has enough SOL before launching
2. **Image Format**: Supports JPEG, PNG, GIF, WebP (max 10MB)
3. **Wallets**: All wallets are automatically saved to `keys/data.json`
4. **Gather**: Always gather after launching to recover SOL

## 🐛 Troubleshooting

- **API Connection Error**: Make sure the API server is running on port 3001
- **Image Upload Fails**: Check file size (max 10MB) and format
- **Launch Fails**: Check console logs and ensure main wallet has enough SOL
- **Gather Fails**: Check that wallets exist in `keys/data.json`

## 📦 Project Structure

```
pumpfun/
├── api-server/          # Express API server
│   ├── server.js       # Main API server
│   └── package.json
├── frontend/            # React frontend
│   ├── src/
│   │   ├── App.js      # Main app component
│   │   ├── App.css     # Styles
│   │   └── index.js    # Entry point
│   └── package.json
└── ... (existing backend files)
```

## 🚀 Production Build

To build for production:

```bash
cd frontend
npm run build
```

The built files will be in `frontend/build/`

