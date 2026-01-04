import os
from dotenv import load_dotenv
from pathlib import Path

# Load .env from project root (Nodematrix-trading/.env)
# Try multiple possible locations
env_paths = [
    Path(__file__).parent.parent / '.env',  # Project root
    Path(__file__).parent / '.env',  # telegram/.env (fallback)
]
env_path = None
for path in env_paths:
    if path.exists():
        env_path = path
        break
if env_path:
    load_dotenv(dotenv_path=env_path)
else:
    # Fallback: try loading from current directory
    load_dotenv()

class Config:
    # Telegram User Account API (Client API - not Bot API)
    # Get these from https://my.telegram.org/apps
    TELEGRAM_API_ID = os.getenv('TELEGRAM_API_ID')
    TELEGRAM_API_HASH = os.getenv('TELEGRAM_API_HASH')
    TELEGRAM_PHONE_NUMBER = os.getenv('TELEGRAM_PHONE_NUMBER')  # Format: +1234567890
    TELEGRAM_SESSION_NAME = os.getenv('TELEGRAM_SESSION_NAME', 'user_session')
    
    # Multiple Telegram User Accounts (comma-separated phone numbers)
    TELEGRAM_USER_PHONES_STR = os.getenv('TELEGRAM_USER_PHONES', '')
    TELEGRAM_USER_PHONES = [phone.strip() for phone in TELEGRAM_USER_PHONES_STR.split(',') if phone.strip()] if TELEGRAM_USER_PHONES_STR else []
    
    # Multiple User Accounts with Custom API Credentials (JSON format)
    # Format: {"+18492849804": {"api_id": "21429419", "api_hash": "cb30e3c94b864b01a4e3c7aa2bd59588"}, "+1234567890": {"api_id": "25237914", "api_hash": "e89019afb491bdb6363ae87a5d7e0c2c"}}
    # Or simple format: +phone1:api_id1:api_hash1|+phone2:api_id2:api_hash2
    TELEGRAM_USER_CREDENTIALS_STR = os.getenv('TELEGRAM_USER_CREDENTIALS', '')
    TELEGRAM_USER_CREDENTIALS = {}
    if TELEGRAM_USER_CREDENTIALS_STR:
        import json
        try:
            # Try JSON format first
            TELEGRAM_USER_CREDENTIALS = json.loads(TELEGRAM_USER_CREDENTIALS_STR)
        except:
            # Fallback to simple format: +phone:api_id:api_hash|+phone2:api_id2:api_hash2
            for pair in TELEGRAM_USER_CREDENTIALS_STR.split('|'):
                if ':' in pair:
                    parts = pair.split(':')
                    if len(parts) >= 3:
                        phone = parts[0].strip()
                        api_id = parts[1].strip()
                        api_hash = ':'.join(parts[2:]).strip()  # In case hash has colons
                        TELEGRAM_USER_CREDENTIALS[phone] = {'api_id': api_id, 'api_hash': api_hash}
    
    # User Tags/Names (JSON format: phone:tag)
    # Simple tags like "dev", "mod", "user1", "user2" for identifying users
    TELEGRAM_USER_NAMES_STR = os.getenv('TELEGRAM_USER_NAMES', '')
    TELEGRAM_USER_NAMES = {}
    if TELEGRAM_USER_NAMES_STR:
        import json
        try:
            # Try JSON format first
            TELEGRAM_USER_NAMES = json.loads(TELEGRAM_USER_NAMES_STR)
        except:
            # Fallback to simple format: phone1:tag1|phone2:tag2
            for pair in TELEGRAM_USER_NAMES_STR.split('|'):
                if ':' in pair:
                    phone, tag = pair.split(':', 1)
                    TELEGRAM_USER_NAMES[phone.strip()] = tag.strip()
    
    # User Personalities (JSON format: phone:personality) - DEPRECATED: Not used for scripted conversations
    TELEGRAM_USER_PERSONALITIES_STR = os.getenv('TELEGRAM_USER_PERSONALITIES', '')
    TELEGRAM_USER_PERSONALITIES = {}
    if TELEGRAM_USER_PERSONALITIES_STR:
        import json
        try:
            # Try JSON format first
            TELEGRAM_USER_PERSONALITIES = json.loads(TELEGRAM_USER_PERSONALITIES_STR)
        except:
            # Fallback to simple format: phone1:personality1|phone2:personality2
            for pair in TELEGRAM_USER_PERSONALITIES_STR.split('|'):
                if ':' in pair:
                    phone, personality = pair.split(':', 1)
                    TELEGRAM_USER_PERSONALITIES[phone.strip()] = personality.strip()
    
    # Telegram Bot API (BotFather bot)
    TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '8598053737:AAF1G5LEK3B442cs62S5TRiKUbt4d1pqFlk')
    
    # OpenAI API Credentials
    OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

