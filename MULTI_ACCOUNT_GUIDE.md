# 🔐 Multi-Account Management System

## Overview

The **Multi-Account System** allows you to save and manage multiple Twitter and Telegram API accounts. No more copy-pasting credentials - just select an account from the dropdown and start posting!

---

## 🚀 Key Features

### ✅ Account Management
- **Save unlimited accounts** - Store multiple Twitter & Telegram accounts
- **Automatic validation** - Credentials tested when added
- **Quick switching** - Dropdown to select active account
- **Persistent storage** - Accounts saved in `keys/` folder
- **Secure deletion** - Remove accounts and session files

### ✅ Smart Integration
- **Marketing Widget** - Select account per tweet/message
- **Settings UI** - Add/delete accounts easily
- **LocalStorage sync** - Remember your last selected account
- **Auto-loading** - Selected account auto-loads on page refresh

### ✅ Safety Features
- **Credential testing** - Validates before saving
- **Account info display** - Shows username/handle
- **Session cleanup** - Deletes Telegram session files when removing account
- **Secure storage** - Credentials never exposed to browser

---

## 📁 File Structure

```
keys/
├── twitter-accounts/
│   ├── twitter_1234567890_abc123.json
│   ├── twitter_9876543210_xyz789.json
│   └── README.md
├── telegram-accounts/
│   ├── telegram_1234567890_def456.json
│   ├── telegram_9876543210_uvw012.json
│   └── README.md
└── ...

marketing/telegram/
├── telegram_session_+1234567890.session
└── telegram_session_+9876543210.session
```

---

## 🎯 Setup Guide

### Step 1: Add Twitter Account

1. **Navigate to Settings → Marketing**
2. **Click "Add Account"** under Twitter Accounts
3. **Fill in the form:**
   - **Account Name:** "My Main Twitter" (friendly name)
   - **API Key:** Your Twitter API key
   - **API Secret:** Your Twitter API secret
   - **Access Token:** Your access token
   - **Access Token Secret:** Your access token secret
4. **Click "Test Credentials"**
   - ✅ If valid: Shows your Twitter username
   - ❌ If invalid: Shows error message
5. **Click "Save Account"**
   - Account saved to `keys/twitter-accounts/`
   - Automatically selected in Marketing Widget

### Step 2: Add Telegram Account

1. **Navigate to Settings → Marketing**
2. **Click "Add Account"** under Telegram Accounts
3. **Fill in the form:**
   - **Account Name:** "My Telegram" (friendly name)
   - **API ID:** From https://my.telegram.org/auth
   - **API Hash:** From https://my.telegram.org/auth
   - **Phone Number:** +1234567890 (with country code)
4. **Click "Save Account"**
   - Account saved to `keys/telegram-accounts/`
   - On first use, you'll need to authorize via 2FA code

### Step 3: Use Accounts in Marketing Widget

1. **Open Marketing Widget** (purple megaphone button)
2. **Select Account:**
   - Twitter tab: Choose account from dropdown
   - Telegram tab: Choose account from dropdown
3. **Start posting/messaging!**

---

## 📝 Account Files

### Twitter Account File Example

```json
{
  "id": "twitter_1234567890_abc123",
  "name": "My Main Twitter",
  "apiKey": "your_api_key",
  "apiSecret": "your_api_secret",
  "accessToken": "your_access_token",
  "accessTokenSecret": "your_access_token_secret",
  "accountInfo": {
    "id": "123456789",
    "username": "myhandle",
    "name": "My Display Name",
    "verified": false,
    "followersCount": 1000
  },
  "createdAt": "2024-01-08T20:00:00.000Z"
}
```

### Telegram Account File Example

```json
{
  "id": "telegram_9876543210_xyz789",
  "name": "My Telegram",
  "apiId": "12345678",
  "apiHash": "abcdef1234567890...",
  "phone": "+1234567890",
  "accountInfo": {
    "phone": "+1234567890",
    "note": "Authorization required on first use"
  },
  "createdAt": "2024-01-08T20:00:00.000Z"
}
```

---

## 🎨 UI Walkthrough

### Settings → Marketing

```
┌─ Marketing Accounts ──────────────────────────┐
│                                                │
│ 🐦 Twitter Accounts (2 saved) [+ Add Account] │
├────────────────────────────────────────────────┤
│ ┌─ My Main Twitter ────────────────────┐      │
│ │ 🐦 @myhandle                    [🗑️]  │      │
│ └──────────────────────────────────────┘      │
│ ┌─ Backup Twitter ─────────────────────┐      │
│ │ 🐦 @backuphandle                [🗑️]  │      │
│ └──────────────────────────────────────┘      │
│                                                │
│ 💬 Telegram Accounts (1 saved) [+ Add Account]│
├────────────────────────────────────────────────┤
│ ┌─ My Telegram ────────────────────────┐      │
│ │ 💬 +1234567890                  [🗑️]  │      │
│ └──────────────────────────────────────┘      │
│                                                │
│ 💡 Add accounts here, then select in          │
│    Marketing Widget for posting                │
└────────────────────────────────────────────────┘
```

### Marketing Widget - Account Selection

```
┌─ Marketing Control ───────────────────────────┐
│ [Twitter] [Telegram]                          │
├───────────────────────────────────────────────┤
│ Twitter Account: [My Main Twitter ▼]          │
├───────────────────────────────────────────────┤
│ [Post All (3)] [↻] [+]                        │
├───────────────────────────────────────────────┤
│ Tweet #1 ...                                  │
└───────────────────────────────────────────────┘
```

---

## 💡 Use Cases

### Multiple Tokens, One Account
```
1. Add your Twitter account once
2. Launch Token A → Post tweets
3. Launch Token B → Same account, new tweets
4. Credentials automatically used
```

### Multiple Accounts, One Token
```
1. Add 3 Twitter accounts
2. Launch token
3. Post from Account 1 (main)
4. Switch to Account 2 (engagement)
5. Post from Account 3 (influencer)
6. Cross-promotion across accounts!
```

### Team Management
```
Team Member 1:
- Adds their Twitter account
- Handles main announcements

Team Member 2:
- Adds their Telegram account
- Monitors community messages

Both using same Marketing Widget!
```

---

## 🔧 Advanced Features

### Account Deletion

When you delete an account:
- **Twitter:** Removes JSON file from `keys/twitter-accounts/`
- **Telegram:** Removes JSON file + session file (complete cleanup)
- **Widget:** Auto-selects next available account

### Credential Testing

Before saving a Twitter account:
1. Widget calls Twitter API
2. Fetches account info (@username, name, verified status)
3. Displays result in UI
4. Only saves if valid

### Auto-Selection

When opening Marketing Widget:
1. Loads saved accounts from backend
2. Checks localStorage for last selected account
3. Auto-selects that account
4. Falls back to first account if none saved
5. Credentials stay in backend (never exposed)

### Session Management

Telegram accounts use session files:
- Created on first authorization
- Stored in `marketing/telegram/`
- Reused for future connections
- Deleted when account is removed

---

## 🛠️ API Endpoints

### Twitter Accounts
```
GET    /api/twitter-accounts           # List all accounts
GET    /api/twitter-accounts/:id       # Get account with credentials
POST   /api/twitter-accounts/test      # Test credentials
POST   /api/twitter-accounts           # Add new account
DELETE /api/twitter-accounts/:id       # Delete account
```

### Telegram Accounts
```
GET    /api/telegram-accounts          # List all accounts
GET    /api/telegram-accounts/:id      # Get account with credentials
POST   /api/telegram-accounts/test     # Test credentials (requires auth)
POST   /api/telegram-accounts          # Add new account
DELETE /api/telegram-accounts/:id      # Delete account + session
```

---

## 🔒 Security

### Credentials Storage
- ✅ Stored in `keys/` folder (gitignored)
- ✅ Never sent to browser localStorage
- ✅ Only fetched when needed for API calls
- ✅ Transmitted over localhost only

### Account Listing
When listing accounts:
- ✅ Only sends account metadata (id, name, username)
- ✅ Credentials NOT included in list endpoint
- ✅ Full credentials only fetched when posting

### File Permissions
```bash
# Recommended: Restrict access to keys folder
chmod 700 keys/twitter-accounts
chmod 700 keys/telegram-accounts
chmod 600 keys/twitter-accounts/*.json
chmod 600 keys/telegram-accounts/*.json
```

---

## 🆘 Troubleshooting

### "No accounts saved" in Marketing Widget

**Solution:**
1. Go to Settings → Marketing
2. Add at least one account
3. Refresh Marketing Widget
4. Account will appear in dropdown

### "Failed to load account credentials"

**Possible causes:**
1. **Account deleted** - Re-add the account
2. **File corrupted** - Delete and re-add
3. **Permissions issue** - Check file access rights

### Twitter test fails

**Causes:**
1. **Invalid API keys** - Double-check credentials
2. **Revoked tokens** - Regenerate on developer.twitter.com
3. **Expired access** - Reauthorize your app
4. **Rate limited** - Wait and try again

### Telegram test not working

**Note:** Telegram testing requires existing authorization.
- First time: Add account without testing
- Use it in Marketing Widget
- Authorization prompt appears in API server terminal
- Enter code when requested

### Account dropdown empty

**Solution:**
1. Check accounts exist in Settings
2. Refresh the page
3. Check browser console for errors
4. Verify API server is running

---

## 📊 Example Workflow

### Setup (One Time)

```
1. Settings → Marketing
2. Add Twitter Account
   - Name: "Main Account"
   - Enter credentials
   - Test → ✅ Valid
   - Save
3. Add Telegram Account
   - Name: "Community Manager"
   - Enter credentials
   - Save
4. Done! Accounts ready to use
```

### Daily Usage

```
1. Launch token
2. Open Marketing Widget (🔊 button)
3. Twitter tab:
   - Select "Main Account" from dropdown
   - Configure tweets
   - Post manually
4. Telegram tab:
   - Select "Community Manager" from dropdown
   - Enter Chat ID
   - Monitor messages
   - Reply to community
5. Switch accounts anytime!
```

---

## 🎯 Best Practices

### Organization
- **Descriptive names:** "Main Twitter", "Backup Twitter", "Team Telegram"
- **Multiple accounts:** One for announcements, one for engagement
- **Team coordination:** Each member adds their own accounts

### Security
- **Don't share accounts** - Each team member uses their own
- **Backup credentials** - Save API keys elsewhere too
- **Monitor usage** - Check Twitter/Telegram developer dashboard
- **Rotate regularly** - Update API keys periodically

### Workflow
- **Test before launch** - Make sure accounts work
- **Pre-select accounts** - Choose before token launches
- **Quick switching** - Change accounts mid-campaign
- **Clean up** - Delete old/unused accounts

---

## 🔮 Future Enhancements

Potential additions:
- Account nicknames/tags
- Usage statistics per account
- Account groups/teams
- Bulk account import
- Account backup/export
- Permission roles

---

Enjoy your multi-account system! 🔐🚀
