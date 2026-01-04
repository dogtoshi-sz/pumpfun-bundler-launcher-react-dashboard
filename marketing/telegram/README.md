# Telegram Marketing Module

This module handles Telegram group/channel creation using Python/Telethon.

## Setup

### 1. Install Python Dependencies

```bash
cd marketing/telegram
pip install -r requirements.txt
```

Or install manually:
```bash
pip install telethon>=1.34.0 python-dotenv>=1.0.0 requests>=2.31.0
```

### 2. Copy Python Files from Nodematrix-v2

Copy these files from `Nodematrix-v2/telegram/` to `marketing/telegram/`:

- `run_campaign.py` - Main campaign runner
- `telegram_user_client.py` - Telegram user client
- `telegram_campaign.py` - Campaign logic
- `config.py` - Configuration loader
- `requirements.txt` - Python dependencies

### 3. Session Files

Telegram session files (`.session`) should be placed in `marketing/telegram/` directory.

Session files are created automatically when you verify a Telegram account for the first time.

## Usage

The module is called automatically from the API server when `ENABLE_TELEGRAM_CREATION=true` is set in `.env`.

## Configuration

Set these in your `.env` file:

```env
ENABLE_TELEGRAM_CREATION=true
TELEGRAM_API_ID=your_api_id
TELEGRAM_API_HASH=your_api_hash
TELEGRAM_PHONE=+1234567890
TELEGRAM_CREATE_GROUP=true
TELEGRAM_CREATE_CHANNEL=false
TELEGRAM_CHANNEL_USERNAME=@mychannel
TELEGRAM_GROUP_TITLE_TEMPLATE={token_name} Official
TELEGRAM_USE_SAFEGUARD_BOT=true
TELEGRAM_SAFEGUARD_BOT_USERNAME=@safeguard
TELEGRAM_CREATE_PORTAL=false
```

## Notes

- The Python script must be in `marketing/telegram/` directory
- Python 3.x must be installed and in your PATH
- Session files are stored in `marketing/telegram/` directory
- The script uses Telethon library for Telegram API access



