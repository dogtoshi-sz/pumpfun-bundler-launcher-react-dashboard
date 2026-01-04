# Marketing Module

Self-contained marketing features for the pumpfun bundler.

## Structure

```
marketing/
├── website/
│   └── website-update.ts      # PostgreSQL website config updates
├── twitter/
│   └── twitter-poster.ts       # Twitter/X posting and profile updates
├── telegram/
│   ├── telegram-wrapper.ts    # Node.js wrapper for Python script
│   ├── run_campaign.py        # Python script (copy from Nodematrix-v2)
│   ├── telegram_user_client.py # Python dependencies (copy from Nodematrix-v2)
│   ├── telegram_campaign.py   # Python dependencies (copy from Nodematrix-v2)
│   ├── config.py              # Python dependencies (copy from Nodematrix-v2)
│   ├── requirements.txt       # Python dependencies
│   └── README.md              # Telegram-specific setup guide
├── index.ts                   # Central exports
└── README.md                   # This file
```

## Setup

### 1. Install Node.js Dependencies

```bash
cd api-server
npm install pg twitter-api-v2
```

### 2. Install Python Dependencies (for Telegram)

```bash
cd marketing/telegram
pip install -r requirements.txt
```

### 3. Copy Telegram Python Files

Copy these files from `Nodematrix-v2/telegram/` to `marketing/telegram/`:

- `run_campaign.py`
- `telegram_user_client.py`
- `telegram_campaign.py`
- `config.py`

### 4. Configure Environment Variables

Add to your `.env` file:

```env
# Database (for Website Update)
DATABASE_URL=postgresql://user:password@host:port/database

# Telegram (optional)
ENABLE_TELEGRAM_CREATION=true
TELEGRAM_API_ID=your_api_id
TELEGRAM_API_HASH=your_api_hash
TELEGRAM_PHONE=+1234567890

# Twitter (optional)
ENABLE_TWITTER_POSTING=true
TWITTER_API_KEY=your_api_key
TWITTER_API_SECRET=your_api_secret
TWITTER_ACCESS_TOKEN=your_access_token
TWITTER_ACCESS_TOKEN_SECRET=your_access_token_secret

# Website (optional)
ENABLE_WEBSITE_UPDATE=true
WEBSITE_URL=mytoken.com
```

## Usage

The marketing modules are automatically called from `index.ts` after a successful token launch, if `ENABLE_MARKETING=true` is set.

You can also call them directly:

```typescript
import { updateWebsiteConfig, postToTwitter, createTelegramGroup } from './marketing';

// Website update
await updateWebsiteConfig({
  siteUrl: 'mytoken.com',
  tokenConfig: { tokenName: 'My Token', ... }
});

// Twitter posting
await postToTwitter({
  apiKey: '...',
  tweets: ['[token_name] is live!'],
  ...
});

// Telegram creation
await createTelegramGroup({
  config: {
    telegram_api_id: '...',
    telegram_api_hash: '...',
    ...
  }
});
```

## Features

### Website Update
- Saves token configuration to PostgreSQL
- Updates existing config if domain matches
- Supports all token metadata fields

### Twitter Posting
- Posts multiple tweets with delays
- Updates profile (name, bio, URL, pictures)
- Supports placeholder replacement
- Can delete old tweets

### Telegram Creation
- Creates groups/channels using Python/Telethon
- Posts filter scripts
- Sets up Safeguard bot
- Creates portals (group + channel)

## Notes

- All features are **optional** - only run if enabled in `.env`
- Each feature is **independent** - failures don't block others
- Marketing runs **after** token launch succeeds
- TypeScript files are compiled/transpiled by ts-node when called from API server



