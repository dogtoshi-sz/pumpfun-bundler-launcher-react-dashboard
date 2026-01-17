# 🚀 Solana Pump.fun Bundler Dashboard

A powerful local dashboard for launching and managing tokens on Pump.fun with bundled transactions.

## ✨ Features

- **Token Launch** - Create and launch tokens on Pump.fun with a single click
- **Bundle Buys** - Bundle multiple wallets buying in the same block as token creation
- **Trading Terminal** - Monitor and manage your token positions
- **Wallet Management** - Create, manage, and warm up wallets for launches
- **Auto Sell** - Configure automatic selling at price thresholds
- **Rapid Sell** - Instantly sell all positions via Jito bundles

## 🛠️ Quick Start

### Prerequisites
- Node.js 18+
- A Solana RPC endpoint (Helius recommended)
- SOL for transaction fees

### Installation

```bash
# Clone the repo
git clone https://github.com/yourusername/solana-pumpfun-bundler-dashboard.git
cd solana-pumpfun-bundler-dashboard

# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your settings (RPC endpoint, private key, etc.)

# Start the dashboard
npm start
```

### Frontend (in a separate terminal)
```bash
cd frontend
npm install
npm run dev
```

Then open http://localhost:5173 in your browser.

## 📁 Project Structure

```
├── api-server/       # API server for the dashboard
├── cli/              # Command-line tools
├── frontend/         # React dashboard UI
├── src/              # Core bundler logic
├── lib/              # Utility libraries
├── executor/         # Transaction execution
├── constants/        # Configuration constants
└── keys/             # Wallet keys (gitignored)
```

## ⚙️ Configuration

Edit `.env` to configure:

```env
# Required
RPC_ENDPOINT=https://your-rpc.helius.xyz
PRIVATE_KEY=your_funding_wallet_private_key

# Optional
JITO_BLOCK_ENGINE_URL=https://mainnet.block-engine.jito.wtf
AUTO_RAPID_SELL=false
```

## 🔐 Security

- All private keys are stored locally in the `keys/` folder
- The `keys/` folder is gitignored by default
- Never commit or share your `.env` file

## 📄 License

MIT License - see [LICENSE](LICENSE)
