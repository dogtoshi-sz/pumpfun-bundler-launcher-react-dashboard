# Telegram & Twitter Account Management Guide

## Overview

This document explains how to properly connect Telegram and Twitter accounts without getting logged out, how PIN verification works, and how accounts are saved locally for reuse.

## Telegram Account Management

### How It Works

1. **Account Verification Flow:**
   - Enter API ID, API Hash, and Phone Number
   - Click "Verify Account"
   - If PIN is required, you'll see a PIN input field
   - Enter the PIN code sent to your Telegram
   - Account is verified and saved locally

2. **Session Files:**
   - Telegram uses `.session` files to maintain login state
   - Session files are stored in `marketing/telegram/` directory
   - Format: `{phone_number}.session` (e.g., `13124733150.session`)
   - **IMPORTANT:** Don't delete session files or you'll get logged out!

3. **Account Storage:**
   - Verified accounts are saved to browser `localStorage`
   - Key: `telegram_verified_accounts`
   - Includes: phone, API ID, API Hash, username, user ID
   - You can select saved accounts from a dropdown

4. **Avoiding Logout:**
   - **Don't create a new session if one already exists** - this will log you out
   - If you have a session file, you can verify without API credentials
   - Upload session files instead of creating new ones when possible

### PIN Verification Process

1. First request: Send API ID, API Hash, Phone → Returns `requiresCode: true` and `phoneCodeHash`
2. Second request: Send PIN code and `phoneCodeHash` → Returns verified user info
3. Account is saved to localStorage for future use

## Twitter Account Management

### How It Works

1. **Account Verification:**
   - Enter API Key, API Secret, Access Token, Access Token Secret
   - Click "Verify Account"
   - Account is verified and saved locally

2. **Account Storage:**
   - Verified accounts are saved to browser `localStorage`
   - Key: `twitter_verified_accounts`
   - Includes: username, API credentials, profile info
   - You can select saved accounts from a dropdown

3. **No PIN Required:**
   - Twitter uses OAuth tokens, so no PIN verification needed
   - Just verify once and the account is saved

## Implementation Files

### Account Store Utilities

- `frontend/src/utils/telegram-accounts-store.js` - Telegram account storage
- `frontend/src/utils/twitter-accounts-store.js` - Twitter account storage

### API Endpoints

- `POST /api/marketing/telegram/verify` - Verify Telegram account (with PIN support)
- `POST /api/marketing/twitter/verify` - Verify Twitter account

### Frontend Components

- Account selection dropdowns in `TokenLaunch.jsx`
- PIN verification UI in Telegram section
- Account manager modals for viewing/deleting saved accounts

## Usage

1. **First Time Setup:**
   - Enter credentials in the marketing section
   - Click "Verify Account"
   - Enter PIN if prompted (Telegram only)
   - Account is automatically saved

2. **Reusing Accounts:**
   - Select account from dropdown
   - Credentials are auto-filled
   - No need to verify again (unless session expired)

3. **Managing Accounts:**
   - Click "Manage Accounts" button
   - View all saved accounts
   - Delete accounts you no longer need

## Troubleshooting

### Telegram Logout Issues

- **Problem:** Getting logged out after verification
- **Solution:** Don't create a new session if one exists. Upload session file instead.

### PIN Not Received

- **Problem:** PIN code not arriving
- **Solution:** Check phone number format (include country code, e.g., +13124733150)

### Session File Missing

- **Problem:** Session file deleted or not found
- **Solution:** Re-verify account with API credentials and PIN

## Security Notes

- Account credentials are stored in browser localStorage (client-side only)
- Session files are stored locally in `marketing/telegram/` directory
- Never commit session files or credentials to git
- `.gitignore` should exclude `*.session` files



