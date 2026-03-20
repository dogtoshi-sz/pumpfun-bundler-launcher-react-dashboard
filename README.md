# Pump.fun Bundler Launcher (V1.2)

> ## ⚠️ This project is now in maintenance mode.
>
> **V1 has been updated to work with pump.fun's February 2026 SDK update** — the migration to Token Extensions (`TOKEN_2022_PROGRAM_ID`) and the new V2 program instructions broke most existing bundlers. This repo has been patched so it functions again.
>
> **However, all active development is moving to [Trencher Bundler V2](https://trenchytools.lol)** — a completely rewritten, more streamlined bundler built on the official `@pump-fun/pump-sdk` from the ground up. V2 is faster, cleaner, and has significantly better architecture.
>
> **V1 (this repo)** will only receive critical bug fixes going forward. No new features will be added here.
>
> ### What's different in V2?
> - Built natively on `@pump-fun/pump-sdk` (V2 protocol) — not patched on top of the old SDK
> - Cleaner codebase — full TypeScript frontend and backend
> - AI token generation (name, symbol, description, image via Google Gemini)
> - Vanity mint addresses (`...pump` suffix) with multi-threaded generation
> - Imported wallet vault with custom wallet selection for any launch slot
> - Improved Jito bundle submission with multi-endpoint racing and RPC fallback
> - Creator fee collection and scanning across all launches
> - Better wallet lifecycle — generate, import, archive, gather, close accounts
>
> **Get V2:** [trenchytools.lol](https://trenchytools.lol) | Twitter: [@trenchytools_x](https://x.com/trenchytools_x) | Dev Telegram: [@dogtoshi_x](https://t.me/dogtoshi_x)

---

![Trencher Bundler](./docs/images/introimage.png)

**The ONLY Pump.fun bundler with a full web dashboard.** Launch tokens, manage wallets, auto-sell, and track P&L — all from one page.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🚀 Quick Overview

Pump.fun bundler that handles everything from launch to profit-taking with a beautiful React dashboard. Uses Jito bundles for coordinated buys, includes auto-sell, wallet management, and real-time P&L tracking.

### Launching a token with LUT

[![Watch Demo](./docs/images/tokenlaunch.png)](./docs/images/lut-launch-demo.mp4)
*Click the image above to download and watch the demo video*

**Connect with us:**
- Website: [trenchytools.lol](https://trenchytools.lol)
- Twitter: [@trenchytools_x](https://x.com/trenchytools_x)
- Dev Telegram: [@dogtoshi_x](https://t.me/dogtoshi_x)

## ✨ Key Features

- **Single-Page Dashboard** - Complete control from one beautiful UI
- **Jito Bundle Execution** - Launch tokens with coordinated buys in the same block
- **Wallet Management** - Create, warm, and manage unlimited wallets
- **Real-Time P&L Tracking** - Track profits/losses across all wallets
- **Auto-Sell** - Configure automatic selling at price thresholds
- **Rapid Sell** - Instantly sell all positions via Jito bundles
- **Secure Key Management** - All keys saved locally, never exposed
- **Fund Recovery** - Built-in tools to recover stuck SOL from failed launches

## 📸 Screenshots

### Trading Terminal - Main Dashboard
![Trading Terminal](./docs/images/tradingterminal.png)
*Real-time trading, P&L tracking, and position management - Our main selling point*

### Token Launch Configuration
![Token Launch](./docs/images/tokenlaunch.png)
*Configure and launch your token with bundled buys*

### Wallet Management
![Wallet Management](./docs/images/walletmanagement.png)
*Create, warm, and manage wallets*

### DEV, Bundle & Holder Wallet Configuration
![Wallet Configuration](./docs/images/devbundleholderwalletconfig.png)
*Detailed wallet configuration and auto-sell settings*

## ⚡ Quick Start

### Prerequisites

- **Node.js 18+** ([Download](https://nodejs.org/))
- **Solana RPC Endpoint** - Get free Helius RPC: https://helius.dev
- **SOL** for transaction fees and token launches

### Installation

```bash
# Clone the repository
git clone https://github.com/dogtoshi-sz/Trenchy-Tools-pumpfun-bundler-launcher-react-dashboard.git
cd Trenchy-Tools-pumpfun-bundler-launcher-react-dashboard

# Install root dependencies (automatically creates .env from .env.example)
npm install

# Install API server dependencies
cd api-server
npm install

# Install frontend dependencies
cd ../frontend
npm install
cd ..
```

**✨ Auto-Setup:** The `.env` file is automatically created from `.env.example` during `npm install`. No manual copying needed!

### Configuration

The `.env` file is **automatically created** from `.env.example` when you run `npm install`.

**Manual setup (if needed):**

1. **Copy the example environment file** (only if auto-setup didn't work):
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` with your settings:**
   ```env
   # REQUIRED - Your main funding wallet private key (base58)
   PRIVATE_KEY=your_private_key_here
   
   # REQUIRED - Solana RPC endpoint (use Helius/QuickNode)
   RPC_ENDPOINT=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
   RPC_WEBSOCKET_ENDPOINT=wss://mainnet.helius-rpc.com/?api-key=YOUR_KEY
   ```

3. **Start both frontend + API server (single command):**
   ```bash
   npm run dev
   ```

   - This is the fastest way to get running.
   - For debugging and cleaner logs, running them separately is recommended (below).

4. **Start the API server** (Terminal 1):
   ```bash
   cd api-server
   npm run dev
   ```

5. **Start the frontend** (Terminal 2):
   ```bash
   cd frontend
   npm run dev
   ```

6. **Open your browser:**
   ```
   http://localhost:5173
   ```

## 📖 Documentation

- **[User Guide](./USER_GUIDE.md)** - Complete documentation with detailed explanations, button reference, troubleshooting, and more
- **[Setup Guide](./SETUP.md)** - Detailed setup instructions
- **[Security Analysis](./SECURITY_ANALYSIS.md)** - Security review and best practices

## 🔧 How It Works (TL;DR)

1. **Token Creation** - Creates your token on Pump.fun
2. **DEV Buy** - First buy from your creator wallet
3. **Bundle Buys** - Multiple wallets buying simultaneously via Jito bundle
4. **Jito Execution** - All transactions bundled and sent via Jito block engine

**Why Jito?** Atomic execution (all buys land in the same block or none do), MEV protection, and faster execution.

## 🛡️ Security

- All wallet keys are saved **locally only** in the `keys/` directory
- The `keys/` folder is **gitignored** by default
- **ALL private keys are automatically saved to `archive.txt`** for recovery
- **Never commit or share your `.env` file or `keys/` folder**

## 🆘 Need Help?

- **Full Documentation:** See [USER_GUIDE.md](./USER_GUIDE.md)
- **Issues:** [GitHub Issues](https://github.com/dogtoshi-sz/Trenchy-Tools-pumpfun-bundler-launcher-react-dashboard/issues)
- **Dev Telegram:** [@dogtoshi_x](https://t.me/dogtoshi_x)

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## ⚠️ Disclaimer

This software is provided "as is" without warranty. Use at your own risk. Always test with small amounts first. The authors are not responsible for any losses.

---

**Built for the Solana community by traders, for traders.**
