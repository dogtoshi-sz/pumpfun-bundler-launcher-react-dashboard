# 📱 Telegram Integration Guide - Marketing Widget

## Overview

The Marketing Widget now includes a **Telegram tab** that allows you to monitor and respond to messages from your Telegram group in real-time! No more switching between windows - manage your community directly from the Terminal page while monitoring your token launch.

---

## 🚀 Features

### ✅ Message Monitoring
- **Live feed** of recent messages (last 24 hours)
- **Auto-refresh** every 10 seconds
- **User filtering** (excludes bots and service messages)
- **50 message limit** for performance

### ✅ Quick Reply
- **Direct replies** to specific messages
- **Quick templates** for common responses
- **Keyboard shortcut** (Enter to send, Shift+Enter for new line)

### ✅ Moderation Tools
- **Pin messages** (highlight important info)
- **Delete messages** (remove spam)
- **Flag messages** for follow-up

### ✅ Message Templates
- CA (Contract Address)
- Website
- Roadmap
- Team Active
- LFG 🚀

---

## 🎯 Setup

### 1. Get Telegram API Credentials

1. Go to https://my.telegram.org/auth
2. Log in with your phone number
3. Click "API development tools"
4. Create a new application (or use existing)
5. Copy your `api_id` and `api_hash`

### 2. Configure .env File

Add these to your `.env` file:

```env
# Telegram API Credentials
TELEGRAM_API_ID=your_api_id_here
TELEGRAM_API_HASH=your_api_hash_here
TELEGRAM_PHONE=+1234567890  # Your phone number with country code
```

### 3. Get Your Group Chat ID

**Method 1: Using @userinfobot**
1. Add @userinfobot to your Telegram group
2. Send any message in the group
3. The bot will reply with the Chat ID (e.g., `-1001234567890`)
4. Copy this Chat ID

**Method 2: Using @getidsbot**
1. Add @getidsbot to your group
2. Type `/start` in the group
3. The bot will show the Chat ID

**Method 3: Using Username**
- If your group has a public username (e.g., @mytoken_official)
- You can use the username directly with @ symbol

---

## 📝 Using the Telegram Tab

### Opening the Widget

1. Launch a token or navigate to Terminal page
2. Click the **purple megaphone button** (bottom-right)
3. Click the **"Telegram" tab**

### Loading Messages

1. Enter your Chat ID in the input field:
   - Public group: `@groupname`
   - Private group: `-1001234567890` (numeric ID)
2. Click **"Load"** button
3. Messages will appear below

### Reading Messages

Each message shows:
- **User info** (name, username)
- **Timestamp** (how long ago)
- **Message content**
- **Action buttons** (Reply, Pin, Delete)

### Replying to Messages

**Quick Reply:**
1. Click the **reply icon** (✈️) on any message
2. Type your response in the box
3. Press **Enter** to send

**Template Reply:**
1. Click a template button (CA, Website, etc.)
2. The text auto-fills in the reply box
3. Edit if needed, press **Enter** to send

### Using Templates

**Built-in Templates:**
- **CA** - Posts the contract address
- **Website** - Links to your website
- **Roadmap** - Standard roadmap response
- **Team** - "Team is active 24/7!"
- **LFG** - "LFG! 🚀🌙"

**Custom Templates:**
Templates automatically use your token data:
- Contract address from `current-run.json`
- Website URL from token config
- Dynamic placeholders

### Moderation

**Pin Message:**
1. Click the **flag icon** on important messages
2. Confirms pin action
3. Message stays at top of group

**Delete Message:**
1. Click the **trash icon** on spam/unwanted messages
2. Confirms deletion
3. Message removed instantly

---

## 💡 Use Cases

### During Token Launch

```
YOU: 🚀 Token is LIVE!
     CA: 8xkKj...9kPs
     Buy now: https://pump.fun/8xkKj...9kPs

USER: What's the contract address?
↪️  YOU: [Template: CA]
     Contract Address: 8xkKj9hPs...

USER: When roadmap?
↪️  YOU: [Template: Roadmap]
     Check our website for the full roadmap!
```

### Monitoring Sentiment

Watch for:
- ❓ Questions about CA/website → Reply with templates
- 💬 Positive sentiment → Engage and build hype
- 🚨 FUD/Spam → Delete and moderate
- 💎 Holder discussions → Pin important messages

### Quick Community Management

1. **Morning announcement:**
   - Pin a "GM" message with day's goals
   
2. **Price milestones:**
   - Pin when you hit ATH or targets
   
3. **Updates:**
   - Pin important updates (listings, partnerships)
   
4. **Spam control:**
   - Delete scam links instantly
   - Remove bot messages

---

## 🔧 Advanced Tips

### Multi-Token Workflow

1. Launch Token A
2. Get Token A's Telegram group Chat ID
3. Enter Chat ID in widget
4. Monitor and respond
5. Launch Token B
6. Change Chat ID to Token B's group
7. Widget updates automatically

### Keyboard Shortcuts

- **Enter** - Send message
- **Shift + Enter** - New line in message
- **Click template** - Auto-fill reply

### Auto-Refresh

Messages auto-refresh every **10 seconds** when:
- Telegram tab is active
- Widget is open and not minimized
- Chat ID is configured

To force refresh: Click the **refresh icon** (↻)

### Managing Multiple Groups

The widget saves your last Chat ID to localStorage. To switch groups:
1. Enter new Chat ID
2. Click "Load"
3. Previous Chat ID is saved for quick switching

---

## 🛠️ Troubleshooting

### "Telegram credentials not configured"

**Solution:**
1. Check `.env` file has all three credentials:
   - `TELEGRAM_API_ID`
   - `TELEGRAM_API_HASH`
   - `TELEGRAM_PHONE`
2. Restart API server: `npm start` in `api-server` folder

### "Failed to load messages"

**Possible causes:**
1. **Invalid Chat ID**
   - Double-check the Chat ID format
   - Private groups: Use `-1001234567890` format
   - Public groups: Use `@groupname` format

2. **Bot not authorized**
   - First time: Python will ask for 2FA code
   - Check API server terminal for prompts
   - Enter code when requested

3. **Group privacy settings**
   - Make sure your account is a member of the group
   - Check group isn't restricted

### Messages not updating

**Solution:**
1. Click the refresh icon (↻)
2. Check Chat ID is correct
3. Make sure Telegram tab is active
4. Widget must be open (not minimized)

### Can't send messages

**Possible causes:**
1. **Not a group member** - Join the group first
2. **Muted/restricted** - Check your group permissions
3. **No chat loaded** - Enter Chat ID and click Load

### Python package errors

**Solution:**
```bash
cd marketing/telegram
pip install python-dotenv telethon requests
```

Or use requirements.txt:
```bash
cd marketing/telegram
pip install -r requirements.txt
```

---

## 🔒 Security & Privacy

### API Credentials
- Stored in `.env` file (never committed to git)
- Transmitted securely through your local backend
- Never exposed to frontend

### Session Files
- Telegram creates a session file after first auth
- Stored in `marketing/telegram/telegram_session_[phone].session`
- Reused for future connections (no re-auth needed)
- **Keep this file secure!**

### Message Data
- Messages fetched from Telegram API
- Not stored permanently (only in-memory)
- Auto-refreshed every 10 seconds
- No message history saved to disk

---

## 📊 Message Filters

### Current Filters
- **Users only** - Excludes bots
- **Last 24 hours** - Only recent messages
- **50 message limit** - Performance optimization
- **No service messages** - Cleaner feed

### Customization
To change filters, edit:
```javascript
// In MarketingWidget.jsx
await fetch('/api/marketing/telegram/get-messages', {
  body: JSON.stringify({
    limit: 50,        // Change message count
    users_only: true, // Include/exclude bots
    hours_ago: 24     // Time window
  })
});
```

---

## 🎯 Best Practices

### Response Strategy

1. **Immediate (Template):**
   - CA requests
   - Website links
   - Common questions

2. **Quick (1-2 min):**
   - Price questions
   - Roadmap inquiries
   - Team status

3. **Detailed (5+ min):**
   - Technical questions
   - Partnership inquiries
   - Feature requests

### Moderation Guidelines

**Pin These:**
- ✅ Contract address posts
- ✅ Important announcements
- ✅ Milestone celebrations
- ✅ AMA/Event notices

**Delete These:**
- ❌ Scam links
- ❌ Other project spam
- ❌ Inappropriate content
- ❌ Bot messages

**Reply To These:**
- 💬 Questions about token
- 💬 Positive engagement
- 💬 Constructive feedback
- 💬 New member welcomes

---

## 🆘 Need Help?

### Check Logs
- **Frontend console:** Right-click → Inspect → Console
- **Backend logs:** Check API server terminal
- **Python logs:** Check for Python script output

### Common Issues

1. **First-time setup takes time**
   - Telegram authentication can be slow
   - Be patient with the initial load

2. **Rate limits**
   - Don't spam replies
   - Auto-refresh is already rate-limited

3. **Session expired**
   - Delete session file
   - Restart API server
   - Re-authenticate

---

## 🎨 Widget Layout

```
┌─ Marketing Control ──────────────────┐
│ [🎯 Twitter] [💬 Telegram (50)]      │
├──────────────────────────────────────┤
│ Chat ID: [@mytoken] [Load] [↻]      │
├──────────────────────────────────────┤
│ 👤 @user123 (2m ago)         [↩️ 🚩 🗑️] │
│ "What's the CA?"                     │
├──────────────────────────────────────┤
│ 👤 @whale_hunter (5m ago)    [↩️ 🚩 🗑️] │
│ "LFG! Just aped in 🚀"               │
├──────────────────────────────────────┤
│ [CA] [Website] [Roadmap] [Team] [LFG]│
├──────────────────────────────────────┤
│ Replying to @user123                  │
│ [Type message... Enter to send]  [↗️] │
│ ✨ Auto-refreshes every 10s          │
└──────────────────────────────────────┘
```

---

## 🚀 Pro Tips

1. **Pre-configure templates** before launch
2. **Keep widget open** on Terminal page during launch
3. **Pin CA immediately** after launch
4. **Quick reply to first 10 messages** - builds engagement
5. **Delete spam instantly** - keeps chat clean
6. **Monitor while selling** - gauge community sentiment
7. **Use templates for speed** - consistency matters

---

Enjoy your new Telegram control center! 📱💬
