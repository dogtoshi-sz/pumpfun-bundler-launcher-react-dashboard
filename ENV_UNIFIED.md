# Unified .env Configuration

## ✅ Both Terminal and Frontend Use the SAME .env File

**Good news:** Your terminal scripts and frontend API server both read from the **exact same `.env` file**. There's no duplication or separate configs needed!

### How It Works:

1. **Terminal Scripts** (e.g., `npm run start`, `npm run rapid-sell`)
   - Read `.env` directly using `dotenv` or `constants.ts`
   - Use all values including `PRIVATE_KEY`, `RPC_ENDPOINT`, etc.

2. **Frontend API Server** (`api-server/server.js`)
   - Reads the **same `.env` file** on startup
   - Updates `.env` when you change settings in the frontend
   - **NEVER exposes sensitive data** to the frontend

### 🔒 Security: Private Keys Are NEVER Exposed

The API server has a **filtered config cache** that only includes safe, non-sensitive values:

**✅ Included in Frontend Config:**
- Token info (name, symbol, description, social links)
- Wallet counts and amounts
- Toggle settings (vanity mode, auto actions)

**❌ NEVER Sent to Frontend:**
- `PRIVATE_KEY` - Only used server-side
- `RPC_ENDPOINT` - Only used server-side
- `OPENAI_API_KEY` - Only used server-side
- Any other sensitive credentials

### How to Use:

1. **Edit `.env` directly** - Both terminal and frontend will use it
2. **Edit via Frontend** - Changes are saved to `.env` and terminal scripts will use them
3. **No conflicts** - Both read from the same source of truth

### Example:

```bash
# Edit .env directly
TOKEN_NAME="My Token"
PRIVATE_KEY=your_key_here  # Only used server-side, never exposed

# Terminal script uses it:
npm run start  # Reads PRIVATE_KEY from .env ✅

# Frontend also uses it:
# - API server reads PRIVATE_KEY from .env ✅
# - Frontend gets token name but NOT private key ✅
```

### Verification:

Check `api-server/server.js` line 61-83 - you'll see `configCache` only includes safe values. `PRIVATE_KEY` is never added to the cache, so it's impossible for the frontend to access it.

