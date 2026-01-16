<p align="center">
  <img src="frontend/public/image/goatlogo.png" alt="Pumpfun Bundler Dashboard" width="120" />
</p>

<h1 align="center">Pumpfun Bundler Dashboard</h1>

<p align="center">
  <strong>The only Pump.fun bundler with a full web dashboard. No CLI needed.</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#screenshots">Screenshots</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#architecture">Architecture</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Solana-blueviolet?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/Frontend-React-61DAFB?style=flat-square&logo=react" alt="React" />
  <img src="https://img.shields.io/badge/Backend-Node.js-339933?style=flat-square&logo=node.js" alt="Node.js" />
  <img src="https://img.shields.io/badge/Bundler-Jito-orange?style=flat-square" alt="Jito" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License" />
</p>

---

## 🎯 Why This Bundler?

Most Pump.fun bundlers are **CLI-only tools** that require terminal expertise. This is the **first bundler with a complete web dashboard** - designed for beginners and pros alike.

| Feature | CLI Bundlers | This Dashboard |
|---------|--------------|----------------|
| Easy to use | ❌ Terminal required | ✅ Point & click |
| Visual feedback | ❌ Text only | ✅ Real-time UI |
| Wallet management | ❌ Manual | ✅ Built-in |
| P&L tracking | ❌ None | ✅ Automatic |
| Beginner friendly | ❌ No | ✅ Yes |

---

## ✨ Features

### 🚀 Token Launch
- **Jito Bundle Launch** - Anti-bubble map, undetectable distribution
- **Rapid Sell** - Beat bots with sub-second sell execution
- **Auto-Gather** - Automatically recover SOL after sells
- **Custom Vanity Addresses** - Generate pump addresses with custom prefixes

### 💼 Wallet Management
- **Wallet Warming** - Age wallets with organic transaction history
- **Multi-Wallet Support** - Manage unlimited bundle + holder wallets
- **Balance Tracking** - Real-time SOL & token balances
- **One-Click Withdraw** - Gather all funds instantly

### 📊 Analytics & Tracking
- **P&L Dashboard** - Track profit/loss per launch
- **Live Trade Feed** - Real-time transaction monitoring
- **External Buy Detection** - WebSocket-powered buy alerts
- **Market Cap Tracking** - Auto-sell at target market cap

### 🤖 Automation
- **Auto Rapid Sell** - Instant sell after launch (beats bots!)
- **Staged Selling** - Sell in waves based on volume thresholds
- **Auto Holder Buys** - Holder wallets auto-buy after launch
- **WebSocket Triggers** - Auto-sell when external volume detected

### 🎨 Content Generation
- **AI Image Generation** - Generate token logos with AI
- **Trend Detection** - Find trending tokens to copy
- **Marketing Tools** - Twitter & Telegram integration

---

## 📸 Screenshots

<!-- Add your screenshots here -->
<p align="center">
  <i>Screenshots coming soon...</i>
</p>

<!-- Example format:
<p align="center">
  <img src="docs/screenshots/dashboard.png" alt="Dashboard" width="800" />
</p>
-->

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- Solana wallet with SOL
- Helius RPC endpoint (recommended)

### Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/pumpfun-bundler-dashboard.git
cd pumpfun-bundler-dashboard

# Install dependencies
npm install

# Install frontend dependencies
cd frontend && npm install && cd ..

# Install API server dependencies
cd api-server && npm install && cd ..
```

### Configuration

```bash
# Copy example environment file
cp .env.example .env

# Edit with your settings
nano .env
```

**Required settings:**
```env
PRIVATE_KEY=your_funding_wallet_private_key
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
JITO_FEE=0.003
```

### Running

```bash
# Start the API server (in one terminal)
cd api-server && node control-panel-server.js

# Start the frontend (in another terminal)
cd frontend && npm run dev
```

Open `http://localhost:5173` in your browser.

---

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PRIVATE_KEY` | Funding wallet private key (base58) | Required |
| `HELIUS_RPC_URL` | Helius RPC endpoint | Required |
| `JITO_FEE` | Jito bundle tip (SOL) | `0.003` |
| `BUNDLE_WALLET_COUNT` | Number of bundle wallets | `5` |
| `HOLDER_WALLET_COUNT` | Number of holder wallets | `10` |
| `AUTO_RAPID_SELL` | Enable instant sell after launch | `true` |
| `AUTO_GATHER` | Enable auto SOL recovery | `false` |

See `.env.example` for full configuration options.

---

## 🏗️ Architecture

```
pumpfun-bundler-dashboard/
├── frontend/           # React dashboard (Vite + Tailwind)
├── api-server/         # Express.js API server
├── src/                # Core TypeScript logic
├── executor/           # Jito bundle execution
├── features/           # Optional feature modules
│   ├── ai-generator/   # AI content generation
│   └── trends/         # Trend detection
├── marketing/          # Twitter & Telegram tools
├── lib/                # Shared libraries
├── utils/              # Utility functions
└── scripts/            # Helper scripts
```

### Tech Stack

- **Frontend:** React 18, Vite, Tailwind CSS, Heroicons
- **Backend:** Node.js, Express.js
- **Blockchain:** Solana Web3.js, Jito SDK
- **Language:** TypeScript

---

## 🔒 Security

⚠️ **Important Security Notes:**

- Never share your `.env` file or private keys
- The `keys/` folder is gitignored - never commit wallet keys
- Use a dedicated funding wallet, not your main wallet
- Start with small amounts when testing

---

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

## ⭐ Support

If this project helped you, please consider giving it a star!

---

<p align="center">
  <strong>Built for the Solana community 🐐</strong>
</p>
