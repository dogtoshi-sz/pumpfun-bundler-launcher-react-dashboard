# ✅ Helius MCP - Correct Setup (Documentation Server)

## 🎯 What Helius MCP Actually Is

**Helius MCP is a DOCUMENTATION server**, not an npm package!

- **URL:** `https://docs.helius.dev/mcp`
- **Type:** Documentation context server
- **Purpose:** Provides AI access to Helius API docs and examples

## 🔧 Correct Configuration

### File Location:
```
C:\Users\emilk\AppData\Roaming\Cursor\User\globalStorage\mcp-config.json
```

### Correct Config:
```json
{
  "mcpServers": {
    "helius": {
      "url": "https://docs.helius.dev/mcp"
    }
  }
}
```

**That's it!** No npm packages, no API keys in the config.

---

## 🚀 Alternative Setup Methods

### Method 1: Contextual Menu (Easiest)

1. Visit: https://docs.helius.dev
2. Look for contextual menu icon (top-right corner)
3. Click "Connect to Cursor"
4. Done!

### Method 2: Cursor Settings UI

1. Open Cursor IDE
2. Go to: **Settings → MCP Servers**
3. Add server URL: `https://docs.helius.dev/mcp`
4. Save

### Method 3: Manual Config (What I Just Did)

1. Edit the config file directly
2. Add the URL-based server
3. Restart Cursor

---

## ✅ How to Verify It Works

After restarting Cursor, I should be able to help you with Helius-specific questions like:

- "Write a Node.js script to get wallet balance using Helius"
- "How do I use Helius enhanced transactions API?"
- "Show me code examples for Helius webhooks"

The MCP server will provide documentation context automatically!

---

## 🎯 What This Gives You

### Documentation Access
- I can search Helius API docs in real-time
- Get accurate, up-to-date code examples
- Access best practices from official docs

### NOT Blockchain Queries
- This MCP does NOT let me query blockchain data directly
- It only provides documentation and examples
- For actual blockchain queries, you'd still use your `.env` setup

---

## 📝 Next Steps

1. **Restart Cursor completely**
2. **Test with:** "Show me a Helius API example for getting token balances"
3. I should be able to pull documentation from the MCP server

---

## ⚠️ What I Got Wrong Earlier

**Wrong:** I tried to install npm packages (`@helius-labs/helius-mcp-server`, `@dcspark/mcp-server-helius`)

**Right:** Helius MCP is a URL-based documentation server at `https://docs.helius.dev/mcp`

**My apologies!** This is a completely different type of MCP server (documentation vs npm package).

---

**Created:** January 2026
**Status:** ✅ PROPERLY CONFIGURED (restart Cursor to test)
