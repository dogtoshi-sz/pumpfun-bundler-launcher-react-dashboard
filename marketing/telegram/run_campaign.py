#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Telegram Campaign Runner - Accepts JSON config from Node.js
Runs a single Telegram conversation campaign
"""
import json
import sys
import asyncio
import logging
import threading
import io
import os
import time
from datetime import datetime
# Set UTF-8 encoding for Windows compatibility
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

from telegram_user_client import TelegramUserClient
from telegram_campaign import TelegramCampaign
from config import Config
from telethon.tl.functions.channels import InviteToChannelRequest

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def initialize_clients(config_data):
    """Initialize Telegram clients based on config"""
    clients = []
    user_roles = {}
    user_is_mod = {}
    
    users = config_data.get('users', {})
    
    # Handle case where users might be a JSON string (double-stringified)
    if isinstance(users, str):
        try:
            users = json.loads(users)
            # If it's still a string after parsing, parse again (double-stringified)
            if isinstance(users, str):
                users = json.loads(users)
        except (json.JSONDecodeError, TypeError) as e:
            logger.error(f"Failed to parse users JSON: {e}")
            logger.error(f"Users value (first 200 chars): {str(users)[:200]}")
            users = {}
    
    # Ensure users is a dict
    if not isinstance(users, dict):
        logger.error(f"Users is not a dict, got type: {type(users)}")
        logger.error(f"Users value: {users}")
        users = {}
    
    # Get phone from config_data first, then fallback to hardcoded value
    CREATOR_PHONE = config_data.get('telegram_phone') or '+13124733150'
    logger.info(f"🔍 Initializing ONLY creator account: {CREATOR_PHONE}")
    logger.info(f"🔍 Ignoring all other users for now")
    
    # ONLY initialize the creator account
    phone = CREATOR_PHONE
    user_config = users.get(phone, {})
    
    if not user_config:
        # Create a default config for the creator
        user_config = {'enabled': True, 'role': 'dev'}
        logger.info(f"   Creator account not in users config, using defaults")
    
    try:
        # Get credentials from config_data first, then fallback to Config (env vars)
        api_id = config_data.get('telegram_api_id') or Config.TELEGRAM_API_ID
        api_hash = config_data.get('telegram_api_hash') or Config.TELEGRAM_API_HASH
        
        # If not in config_data, try TELEGRAM_USER_CREDENTIALS
        if not api_id or not api_hash:
            credentials = Config.TELEGRAM_USER_CREDENTIALS.get(phone, {})
            api_id = api_id or credentials.get('api_id', Config.TELEGRAM_API_ID)
            api_hash = api_hash or credentials.get('api_hash', Config.TELEGRAM_API_HASH)
        
        # Convert api_id to int
        try:
            api_id = int(api_id) if api_id else None
        except (ValueError, TypeError):
            logger.warning(f"Invalid API ID for {phone}, using default")
            api_id = Config.TELEGRAM_API_ID
        
        # Final check - if still None, raise error
        if not api_id or not api_hash:
            raise ValueError("Telegram API ID and API Hash are required. Get them from https://my.telegram.org/apps")
        
        # Create session name - match the format used by verify_account (just phone number without +)
        # Prefer the simple format (13124733150.session) as that's what verify_account creates
        phone_clean = phone.replace('+', '').replace('-', '').replace(' ', '')
        import os
        # Check in telegram directory (where script runs from)
        # Get the directory where this script is located
        try:
            script_dir = os.path.dirname(os.path.abspath(__file__))
        except:
            script_dir = os.getcwd()
        session_file_simple = os.path.join(script_dir, f"{phone_clean}.session")
        session_file_full = os.path.join(script_dir, f"user_session_{phone_clean}.session")
        
        # Prefer simple format (what verify_account creates), fallback to user_session format
        if os.path.exists(session_file_simple):
            session_name = phone_clean
            logger.info(f"   ✓ Using session file: {os.path.basename(session_file_simple)}")
        elif os.path.exists(session_file_full):
            session_name = f"user_session_{phone_clean}"
            logger.info(f"   ✓ Using session file: {os.path.basename(session_file_full)}")
        else:
            logger.warning(f"   ⚠️  No session file found for {phone} (checked {os.path.basename(session_file_simple)} and {os.path.basename(session_file_full)})")
            logger.warning(f"   Please verify this account first using the Verify button")
        
        # Get user tag from config
        user_tag = Config.TELEGRAM_USER_NAMES.get(phone, 'creator')
        
        # Create client
        client = TelegramUserClient(
            api_id=api_id,
            api_hash=api_hash,
            phone=phone,
            session_name=session_name,
            user_tag=user_tag
        )
        clients.append(client)
        
        # Store role and mod status
        user_roles[phone] = user_config.get('role', 'dev')
        user_is_mod[phone] = user_config.get('is_mod', False)
        logger.info(f"   ✓ Initialized creator account: [{user_tag}] {phone} (role: {user_roles[phone]}, mod: {user_is_mod[phone]})")
    except Exception as e:
        logger.error(f"Failed to initialize {phone}: {e}")
        import traceback
        logger.error(traceback.format_exc())
    
    # Verify creator was initialized
    creator_found = any(getattr(client, 'phone', None) == CREATOR_PHONE or 
                       getattr(client, 'phone', '').replace(' ', '').replace('-', '') == CREATOR_PHONE.replace(' ', '').replace('-', '')
                       for client in clients)
    if not creator_found:
        logger.warning(f"⚠️ Creator account ({CREATOR_PHONE}) was NOT initialized!")
        logger.warning(f"   Initialized clients: {[getattr(c, 'phone', 'unknown') for c in clients]}")
    else:
        logger.info(f"✅ Creator account ({CREATOR_PHONE}) was successfully initialized")
    
    return clients, user_roles, user_is_mod

def run_campaign(config_data, scripted_conversations):
    """Run the campaign"""
    # Import datetime at function level to avoid shadowing issues
    from datetime import datetime as dt
    
    clients, user_roles, user_is_mod = initialize_clients(config_data)
    
    # Create a dictionary mapping phone numbers to clients for easy lookup
    clients_by_phone = {getattr(client, 'phone', None): client for client in clients if hasattr(client, 'phone')}
    
    # Check if we're creating groups/channels or running a campaign
    create_group = config_data.get('create_group', False) or False
    create_channel = config_data.get('create_channel', False) or False
    create_portal = config_data.get('create_portal', False) or False
    reuse_existing = config_data.get('reuse_existing', False) or False
    
    # For group/channel/portal creation, only need 1 user (the creator)
    # For campaigns with scripted conversations, need at least 2 users
    is_group_creation_mode = create_group or create_channel or create_portal or reuse_existing
    has_scripted_conversations = scripted_conversations and len(scripted_conversations) > 0
    
    if not is_group_creation_mode and has_scripted_conversations:
        # Only require 2+ users for campaigns with scripted conversations
        if len(clients) < 2:
            logger.error(f"Need at least 2 enabled users for campaigns with scripted conversations (have {len(clients)})")
            return False
    elif len(clients) < 1:
        # Need at least 1 user (the creator)
        logger.error(f"Need at least 1 enabled user (have {len(clients)})")
        return False
    else:
        logger.info(f"✓ Using {len(clients)} user(s) - {'group/channel creation mode' if is_group_creation_mode else 'campaign mode'}")
    
    campaign_id = config_data.get('campaign_id', f"campaign_{dt.now().strftime('%Y%m%d_%H%M%S')}")
    chat_ids = config_data.get('chat_ids', [])
    
    # Log chat_ids received from frontend
    logger.info(f"\n{'='*60}")
    logger.info(f"CHAT IDS RECEIVED FROM FRONTEND")
    logger.info(f"{'='*60}")
    logger.info(f"chat_ids: {chat_ids}")
    logger.info(f"chat_ids type: {type(chat_ids)}")
    logger.info(f"chat_ids length: {len(chat_ids) if chat_ids else 0}")
    if chat_ids:
        for i, chat_id in enumerate(chat_ids):
            logger.info(f"  [{i}] {chat_id} (type: {type(chat_id)})")
    logger.info(f"{'='*60}\n")
    
    token_name = config_data.get('token_name', 'TOKEN')
    token_symbol = config_data.get('token_symbol', '$TOKEN')
    contract_name = config_data.get('contract_name', '')  # Contract name for username generation
    token_address = config_data.get('token_address', '')
    website = config_data.get('website', '')
    telegram = config_data.get('telegram', '')
    twitter = config_data.get('twitter', '')
    docs = config_data.get('docs', '')
    description = config_data.get('description', '')
    chain = config_data.get('chain', '')
    direction = config_data.get('direction', 'Telegram launch chat conversation')
    
    logger.info(f"\n{'='*60}")
    logger.info(f"STARTING CAMPAIGN: {campaign_id}")
    logger.info(f"{'='*60}")
    logger.info(f"Direction: {direction}")
    logger.info(f"Chat IDs: {chat_ids}")
    logger.info(f"Users: {len(clients)}")
    logger.info(f"Token: {token_name} ({token_symbol})")
    if token_address:
        logger.info(f"Contract: {token_address}")
    if website:
        logger.info(f"Website: {website}")
    if telegram:
        logger.info(f"Telegram: {telegram}")
    logger.info(f"{'='*60}\n")
    
    # Create a persistent event loop in a background thread
    loop = asyncio.new_event_loop()
    
    def run_event_loop():
        asyncio.set_event_loop(loop)
        loop.run_forever()
    
    loop_thread = threading.Thread(target=run_event_loop, daemon=True)
    loop_thread.start()
    
    CREATOR_PHONE = '+13124733150'  # Define here for use in connect_all
    
    async def connect_all():
        # Connect clients sequentially with delays to avoid database locked errors
        # Skip clients that require interactive authentication (can't use input() from Node.js)
        # BUT never skip the creator account - it must work
        connected_clients = []
        for idx, client in enumerate(clients):
            try:
                # Add delay between connections to avoid SQLite database lock conflicts
                if idx > 0:
                    await asyncio.sleep(0.5)  # 500ms delay between connections
                
                # Check if session file exists before trying to connect
                phone = getattr(client, 'phone', 'unknown')
                session_name = getattr(client, '_session_name', None)
                if session_name:
                    import os
                    # Check both possible session file locations
                    session_file = f"{session_name}.session"
                    phone_clean = phone.replace('+', '').replace('-', '').replace(' ', '')
                    session_file_simple = f"{phone_clean}.session"
                    
                    # Check if either session file exists
                    if not os.path.exists(session_file) and not os.path.exists(session_file_simple):
                        logger.warning(f"Skipping {phone}: No session file found (checked {session_file} and {session_file_simple}). User needs to verify account first using the Verify button.")
                        continue
                    elif os.path.exists(session_file_simple):
                        # Update client to use the simple format session file (preferred)
                        logger.info(f"Found session file {session_file_simple} for {phone}, updating client session name")
                        # Update the session name - the client will use this when connecting
                        if hasattr(client, '_session_name'):
                            client._session_name = phone_clean
                        if hasattr(client, 'session_name'):
                            client.session_name = phone_clean
                
                await client.connect()
                logger.info(f"✓ Connected {phone}")
                connected_clients.append(client)
            except (ValueError, EOFError) as e:
                error_msg = str(e)
                # Skip clients that need interactive authentication UNLESS it's the creator account
                phone = getattr(client, 'phone', 'unknown')
                is_creator = phone == CREATOR_PHONE or phone.replace(' ', '').replace('-', '') == CREATOR_PHONE.replace(' ', '').replace('-', '')
                
                if "EOF" in error_msg or "read" in error_msg.lower() or "input" in error_msg.lower():
                    if is_creator:
                        # Creator account MUST work - fail if it can't authenticate
                        logger.error(f"❌ Creator account {phone} requires authentication but cannot authenticate interactively.")
                        logger.error(f"   Session file may be invalid or expired.")
                        logger.error(f"   Please verify this account first using the Verify button in the Telegram Group Creator node.")
                        raise ValueError(f"Creator account {phone} authentication failed: {error_msg}")
                    else:
                        logger.warning(f"Skipping {phone}: Requires interactive authentication. Session file may be missing or expired. Please verify this account first using the Verify button.")
                        continue
                else:
                    logger.error(f"Failed to connect client {getattr(client, 'phone', 'unknown')}: {error_msg}")
                    import traceback
                    logger.error(traceback.format_exc())
            except Exception as e:
                error_msg = str(e)
                logger.error(f"Failed to connect client {getattr(client, 'phone', 'unknown')}: {error_msg}")
                # If database locked, wait longer and retry once
                if "database is locked" in error_msg.lower() or "locked" in error_msg.lower():
                    logger.warning(f"Database locked, waiting 2 seconds and retrying...")
                    await asyncio.sleep(2)
                    try:
                        await client.connect()
                        phone = getattr(client, 'phone', 'unknown')
                        logger.info(f"✓ Connected {phone} on retry")
                        connected_clients.append(client)
                    except Exception as e2:
                        logger.error(f"Retry failed for {getattr(client, 'phone', 'unknown')}: {e2}")
                        import traceback
                        logger.error(traceback.format_exc())
                else:
                    import traceback
                    logger.error(traceback.format_exc())
        
        # Update clients list to only include successfully connected clients
        clients.clear()
        clients.extend(connected_clients)
        logger.info(f"Successfully connected {len(clients)} out of {len(connected_clients) + (len(clients) - len(connected_clients))} client(s)")
    
    # Run connection in the persistent loop
    try:
        asyncio.run_coroutine_threadsafe(connect_all(), loop).result(timeout=60)
    except Exception as e:
        logger.error(f"Connection failed: {e}")
        return False
    
    # Pre-check: Verify all accounts can access the chat_ids
    async def verify_chat_access():
        """Verify all clients can access all chat_ids before starting campaign"""
        errors = []
        for client in clients:
            phone = getattr(client, 'phone', 'unknown')
            for chat_id in chat_ids:
                try:
                    await client.client.get_entity(int(chat_id))
                    logger.info(f"✓ {phone} can access chat {chat_id}")
                except Exception as e:
                    error_msg = (
                        f"❌ {phone} cannot access chat/channel {chat_id}\n"
                        f"   Error: {str(e)}\n"
                        f"   To fix: Make sure the Telegram account {phone} has joined the channel/group before running the campaign."
                    )
                    logger.error(error_msg)
                    errors.append((phone, chat_id, str(e)))
        return errors
    
    logger.info(f"\n{'='*60}")
    logger.info(f"VERIFYING CHAT ACCESS")
    logger.info(f"{'='*60}")
    try:
        access_errors = asyncio.run_coroutine_threadsafe(verify_chat_access(), loop).result(timeout=30)
        if access_errors:
            logger.warning(f"\n⚠️ Found {len(access_errors)} access error(s). Campaign may fail.")
            logger.warning("Please ensure all accounts have joined the channels/groups before running the campaign.")
            logger.warning("Proceeding anyway - campaign will attempt to run but may fail.\n")
            # Don't return False - let it try anyway, errors will be caught during actual message sending
        else:
            logger.info(f"✅ All accounts can access all chats\n")
    except Exception as e:
        logger.warning(f"Could not verify chat access: {e}")
        logger.warning("Proceeding anyway, but campaign may fail if accounts haven't joined channels.\n")
    
    # Check if we need to create or reuse a group/channel
    reuse_existing = config_data.get('reuse_existing', False) or False
    existing_group_chat_id = config_data.get('existing_group_chat_id', None)
    existing_channel_chat_id = config_data.get('existing_channel_chat_id', None)
    
    create_group = config_data.get('create_group', False) or False
    create_channel = config_data.get('create_channel', False) or False
    
    logger.info(f"🔍 Group/Channel mode check:")
    logger.info(f"   - reuse_existing: {reuse_existing}")
    logger.info(f"   - existing_group_chat_id: {existing_group_chat_id}")
    logger.info(f"   - existing_channel_chat_id: {existing_channel_chat_id}")
    logger.info(f"   - create_group: {create_group}")
    logger.info(f"   - create_channel: {create_channel}")
    create_portal = config_data.get('create_portal', False) or False
    safeguard_bot_username = config_data.get('safeguard_bot_username', '@safeguard')  # Default to @safeguard
    group_title_template = config_data.get('group_title_template', '{token_name}')
    group_description = config_data.get('group_description', '')
    channel_username = config_data.get('channel_username', None)  # Channel username (optional)
    contract_name = config_data.get('contract_name', '')  # Contract name for username generation
    group_photo_path = config_data.get('group_photo_path', None)
    group_photo_base64 = config_data.get('group_photo_base64', None)
    group_photo_filename = config_data.get('group_photo_filename', 'group_photo.png')
    token_image_url = config_data.get('token_image_url', None)  # Fallback: download from URL if base64 missing
    filter_script = config_data.get('filter_script', None)  # Filter commands to send after group creation
    group_settings = config_data.get('group_settings', {})
    
    created_group_chat_id = None
    created_channel_chat_id = None
    
    # Skip reuse logic if we're only doing portal setup (create_group=False, create_portal=True)
    # Portal setup doesn't need to access/reuse groups, it just needs the IDs
    # Note: token_address is NOT required for portal setup
    portal_only_mode = not create_group and create_portal
    
    if reuse_existing and not portal_only_mode:
        logger.info(f"\n{'='*60}")
        logger.info(f"REUSING EXISTING GROUP/CHANNEL")
        logger.info(f"{'='*60}")
        
        # Find creator account (phone: +13124733150) to manage groups/channels
        CREATOR_PHONE = '+13124733150'
        dev_client = None
        dev_phone = None
        
        # First try to find by specific phone number
        if CREATOR_PHONE in clients_by_phone:
            dev_client = clients_by_phone.get(CREATOR_PHONE)
            dev_phone = CREATOR_PHONE
        else:
            # Fallback: find dev account (role='dev')
            for phone, user_config in config_data.get('users', {}).items():
                if user_config.get('role') == 'dev':
                    dev_client = clients_by_phone.get(phone)
                    dev_phone = phone
                    break
        
        if not dev_client:
            logger.error(f"❌ Creator account ({CREATOR_PHONE}) not found. Cannot reuse group/channel.")
            return False
        
        logger.info(f"Using creator account to manage group/channel: {dev_phone}")
        
        # Prepare token info for updates
        token_name = config_data.get('token_name', 'TOKEN')
        token_symbol = config_data.get('token_symbol', '$TOKEN')
        contract_name = config_data.get('contract_name', '')  # Contract name for username generation
        final_title = group_title_template.replace('{token_name}', token_name).replace('{token_symbol}', token_symbol)
        final_description = group_description.replace('{token_name}', token_name).replace('{token_symbol}', token_symbol) if group_description else ''
        
        # Handle photo: Try base64 first, then URL download, then path
        final_photo_path = None
        if group_photo_base64:
            try:
                import base64
                # Extract base64 data (remove data:image/...;base64, prefix if present)
                base64_data = group_photo_base64
                if ',' in base64_data:
                    base64_data = base64_data.split(',')[1]
                
                photo_data = base64.b64decode(base64_data)
                
                # CRITICAL: Validate and resize image if too small
                # Telegram requires minimum 160x160 pixels
                try:
                    from PIL import Image
                    import io
                    
                    # Open image from bytes
                    img = Image.open(io.BytesIO(photo_data))
                    width, height = img.size
                    
                    logger.info(f"📸 Image dimensions: {width}x{height} pixels, size: {len(photo_data)} bytes")
                    
                    # Telegram minimum is 160x160, but we'll use 200x200 to be safe
                    min_size = 200
                    if width < min_size or height < min_size:
                        logger.warning(f"⚠️ Image too small ({width}x{height}), resizing to minimum {min_size}x{min_size}...")
                        # Resize maintaining aspect ratio, then crop to square
                        if width < height:
                            new_width = min_size
                            new_height = int(height * (min_size / width))
                        else:
                            new_height = min_size
                            new_width = int(width * (min_size / height))
                        
                        img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
                        # Crop to square
                        left = (new_width - min_size) // 2
                        top = (new_height - min_size) // 2
                        img = img.crop((left, top, left + min_size, top + min_size))
                        
                        # Convert to RGB if needed (for JPEG compatibility)
                        if img.mode != 'RGB':
                            img = img.convert('RGB')
                        
                        # Save resized image
                        output = io.BytesIO()
                        img.save(output, format='PNG', quality=95)
                        photo_data = output.getvalue()
                        logger.info(f"✅ Resized image to {min_size}x{min_size}, new size: {len(photo_data)} bytes")
                    else:
                        logger.info(f"✅ Image size OK ({width}x{height})")
                except ImportError:
                    logger.warning(f"⚠️ PIL/Pillow not available - cannot validate/resize image. Install with: pip install Pillow")
                except Exception as e:
                    logger.warning(f"⚠️ Could not validate/resize image: {e}. Using original image.")
                
                temp_dir = os.path.join(os.path.dirname(__file__), '..', 'temp', 'group_photos')
                os.makedirs(temp_dir, exist_ok=True)
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                extension = group_photo_filename.split('.')[-1] if '.' in group_photo_filename else 'png'
                photo_filename = f"{timestamp}_{group_photo_filename}"
                final_photo_path = os.path.join(temp_dir, photo_filename)
                with open(final_photo_path, 'wb') as f:
                    f.write(photo_data)
                logger.info(f"✅ Saved base64 photo to: {final_photo_path} ({len(photo_data)} bytes)")
            except Exception as e:
                logger.warning(f"⚠️ Could not save base64 photo: {e}. Will try URL download or photo_path.")
                final_photo_path = None  # Reset so we can try URL download
        
        # If base64 failed or missing, try downloading from token_image_url
        if not final_photo_path and token_image_url:
            try:
                import requests
                import os
                from datetime import datetime as dt
                
                logger.info(f"📥 Downloading token image from URL: {token_image_url}")
                response = requests.get(token_image_url, timeout=30)
                response.raise_for_status()
                
                image_data = response.content
                
                # CRITICAL: Validate and resize downloaded image if too small
                # Telegram requires minimum 160x160 pixels
                try:
                    from PIL import Image
                    import io
                    
                    # Open image from bytes
                    img = Image.open(io.BytesIO(image_data))
                    width, height = img.size
                    
                    logger.info(f"📸 Downloaded image dimensions: {width}x{height} pixels, size: {len(image_data)} bytes")
                    
                    # Telegram minimum is 160x160, but we'll use 200x200 to be safe
                    min_size = 200
                    if width < min_size or height < min_size:
                        logger.warning(f"⚠️ Downloaded image too small ({width}x{height}), resizing to minimum {min_size}x{min_size}...")
                        # Resize maintaining aspect ratio, then crop to square
                        if width < height:
                            new_width = min_size
                            new_height = int(height * (min_size / width))
                        else:
                            new_height = min_size
                            new_width = int(width * (min_size / height))
                        
                        img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
                        # Crop to square
                        left = (new_width - min_size) // 2
                        top = (new_height - min_size) // 2
                        img = img.crop((left, top, left + min_size, top + min_size))
                        
                        # Convert to RGB if needed (for JPEG compatibility)
                        if img.mode != 'RGB':
                            img = img.convert('RGB')
                        
                        # Save resized image
                        output = io.BytesIO()
                        img.save(output, format='PNG', quality=95)
                        image_data = output.getvalue()
                        logger.info(f"✅ Resized downloaded image to {min_size}x{min_size}, new size: {len(image_data)} bytes")
                    else:
                        logger.info(f"✅ Downloaded image size OK ({width}x{height})")
                except ImportError:
                    logger.warning(f"⚠️ PIL/Pillow not available - cannot validate/resize image. Install with: pip install Pillow")
                except Exception as e:
                    logger.warning(f"⚠️ Could not validate/resize downloaded image: {e}. Using original image.")
                
                # Create temp directory if it doesn't exist
                temp_dir = os.path.join(os.path.dirname(__file__), '..', 'temp', 'group_photos')
                os.makedirs(temp_dir, exist_ok=True)
                
                # Generate filename from URL or use default
                timestamp = dt.now().strftime('%Y%m%d_%H%M%S')
                # Try to get extension from URL
                url_extension = token_image_url.split('.')[-1].split('?')[0] if '.' in token_image_url else 'png'
                if url_extension not in ['png', 'jpg', 'jpeg', 'webp', 'gif']:
                    url_extension = 'png'
                photo_filename = f"{timestamp}_token_image.{url_extension}"
                final_photo_path = os.path.join(temp_dir, photo_filename)
                
                # Save downloaded image
                with open(final_photo_path, 'wb') as f:
                    f.write(image_data)
                
                logger.info(f"✅ Downloaded and saved token image to: {final_photo_path} ({len(image_data)} bytes)")
            except Exception as e:
                logger.warning(f"⚠️ Failed to download token image from URL: {e}. Will use photo_path if provided.")
                final_photo_path = group_photo_path  # Fallback to path if provided
        
        # Reuse group
        if existing_group_chat_id:
            logger.info(f"\n{'='*60}")
            logger.info(f"REUSING GROUP: {existing_group_chat_id}")
            logger.info(f"{'='*60}")
            
            try:
                async def reuse_group():
                    # Handle chat ID format: -1001234567890
                    # Telethon needs the entity to be in cache, so we need to access it first
                    chat_id_int = int(existing_group_chat_id)
                    try:
                        # First try: use the full negative ID directly
                        entity = await dev_client.client.get_entity(chat_id_int)
                    except ValueError as e:
                        # If entity not in cache, try to get dialogs first to populate cache
                        logger.info(f"Entity not in cache, fetching dialogs to populate cache...")
                        await dev_client.client.get_dialogs(limit=100)
                        # Now try again
                        try:
                            entity = await dev_client.client.get_entity(chat_id_int)
                        except Exception as e2:
                            # Last resort: try extracting channel ID for supergroups
                            if str(chat_id_int).startswith('-100'):
                                channel_id = abs(chat_id_int) - 1000000000000
                                from telethon.tl.types import PeerChannel
                                # Try to get from dialogs
                                async for dialog in dev_client.client.iter_dialogs():
                                    if hasattr(dialog.entity, 'id') and abs(dialog.entity.id) == abs(chat_id_int):
                                        entity = dialog.entity
                                        break
                                else:
                                    raise ValueError(f"Could not find group/channel {chat_id_int}. Make sure the dev account has joined it.")
                            else:
                                raise e2
                    
                    # STEP 1: Kick all users except dev account
                    logger.info("STEP 1: Kicking all users from group...")
                    me = await dev_client.client.get_me()
                    kicked_count = 0
                    async for participant in dev_client.client.iter_participants(entity):
                        if participant.id != me.id:  # Don't kick ourselves
                            try:
                                await dev_client.client.kick_participant(entity, participant)
                                kicked_count += 1
                                if kicked_count % 10 == 0:  # Log every 10 kicks
                                    logger.info(f"   Kicked {kicked_count} users...")
                                await asyncio.sleep(0.5)  # Small delay to avoid rate limits
                            except Exception as e:
                                logger.warning(f"   Could not kick user {participant.id}: {e}")
                    logger.info(f"✅ Kicked {kicked_count} users from group")
                    
                    # STEP 2: Update group title
                    logger.info(f"STEP 2: Updating group title to: {final_title}")
                    from telethon.tl.functions.channels import EditTitleRequest
                    await dev_client.client(EditTitleRequest(channel=entity, title=final_title))
                    logger.info("✅ Group title updated")
                    
                    # STEP 3: Update group description
                    if final_description:
                        logger.info(f"STEP 3: Updating group description")
                        await dev_client.client.edit_channel(entity, about=final_description)
                        logger.info("✅ Group description updated")
                    
                    # STEP 4: Update group photo
                    if final_photo_path and os.path.exists(final_photo_path):
                        logger.info(f"STEP 4: Updating group photo")
                        from telethon.tl.functions.channels import EditPhotoRequest
                        from telethon.tl.types import InputChatUploadedPhoto
                        from telethon.errors import FloodWaitError
                        try:
                            photo = await dev_client.client.upload_file(final_photo_path)
                            await dev_client.client(EditPhotoRequest(
                                channel=entity,
                                photo=InputChatUploadedPhoto(file=photo)
                            ))
                            logger.info("✅ Group photo updated")
                        except FloodWaitError as e:
                            wait_time = e.seconds
                            logger.warning(f"⚠️ Rate limited: Waiting {wait_time} seconds...")
                            await asyncio.sleep(wait_time)
                            photo = await dev_client.client.upload_file(final_photo_path)
                            await dev_client.client(EditPhotoRequest(
                                channel=entity,
                                photo=InputChatUploadedPhoto(file=photo)
                            ))
                            logger.info("✅ Group photo updated after wait")
                    
                    return {'success': True, 'chat_id': int(existing_group_chat_id)}
                
                # Ensure dev_client uses the same event loop
                if hasattr(dev_client, '_event_loop'):
                    dev_client._event_loop = loop
                group_result = asyncio.run_coroutine_threadsafe(reuse_group(), loop).result(timeout=600)
                if group_result.get('success'):
                    created_group_chat_id = group_result.get('chat_id')
                    logger.info(f"✅ Group reused successfully: {created_group_chat_id}")
            except Exception as e:
                logger.error(f"❌ Error reusing group: {e}")
                import traceback
                logger.error(traceback.format_exc())
        
        # Reuse channel
        if existing_channel_chat_id:
            logger.info(f"\n{'='*60}")
            logger.info(f"REUSING CHANNEL: {existing_channel_chat_id}")
            logger.info(f"{'='*60}")
            
            try:
                async def reuse_channel():
                    # Handle chat ID format: -1001234567890
                    # Telethon needs the entity to be in cache, so we need to access it first
                    chat_id_int = int(existing_channel_chat_id)
                    try:
                        # First try: use the full negative ID directly
                        entity = await dev_client.client.get_entity(chat_id_int)
                    except ValueError as e:
                        # If entity not in cache, try to get dialogs first to populate cache
                        logger.info(f"Entity not in cache, fetching dialogs to populate cache...")
                        await dev_client.client.get_dialogs(limit=100)
                        # Now try again
                        try:
                            entity = await dev_client.client.get_entity(chat_id_int)
                        except Exception as e2:
                            # Last resort: try extracting channel ID for supergroups
                            if str(chat_id_int).startswith('-100'):
                                channel_id = abs(chat_id_int) - 1000000000000
                                from telethon.tl.types import PeerChannel
                                # Try to get from dialogs
                                async for dialog in dev_client.client.iter_dialogs():
                                    if hasattr(dialog.entity, 'id') and abs(dialog.entity.id) == abs(chat_id_int):
                                        entity = dialog.entity
                                        break
                                else:
                                    raise ValueError(f"Could not find channel {chat_id_int}. Make sure the dev account has joined it.")
                            else:
                                raise e2
                    
                    # STEP 1: Kick all users except dev account
                    logger.info("STEP 1: Kicking all users from channel...")
                    me = await dev_client.client.get_me()
                    kicked_count = 0
                    async for participant in dev_client.client.iter_participants(entity):
                        if participant.id != me.id:  # Don't kick ourselves
                            try:
                                await dev_client.client.kick_participant(entity, participant)
                                kicked_count += 1
                                if kicked_count % 10 == 0:
                                    logger.info(f"   Kicked {kicked_count} users...")
                                await asyncio.sleep(0.5)
                            except Exception as e:
                                logger.warning(f"   Could not kick user {participant.id}: {e}")
                    logger.info(f"✅ Kicked {kicked_count} users from channel")
                    
                    # STEP 2: Update channel title
                    logger.info(f"STEP 2: Updating channel title to: {final_title}")
                    from telethon.tl.functions.channels import EditTitleRequest
                    await dev_client.client(EditTitleRequest(channel=entity, title=final_title))
                    logger.info("✅ Channel title updated")
                    
                    # STEP 3: Update channel description
                    if final_description:
                        logger.info(f"STEP 3: Updating channel description")
                        await dev_client.client.edit_channel(entity, about=final_description)
                        logger.info("✅ Channel description updated")
                    
                    # STEP 4: Update channel photo
                    if final_photo_path and os.path.exists(final_photo_path):
                        logger.info(f"STEP 4: Updating channel photo")
                        from telethon.tl.functions.channels import EditPhotoRequest
                        from telethon.tl.types import InputChatUploadedPhoto
                        from telethon.errors import FloodWaitError
                        try:
                            photo = await dev_client.client.upload_file(final_photo_path)
                            await dev_client.client(EditPhotoRequest(
                                channel=entity,
                                photo=InputChatUploadedPhoto(file=photo)
                            ))
                            logger.info("✅ Channel photo updated")
                        except FloodWaitError as e:
                            wait_time = e.seconds
                            logger.warning(f"⚠️ Rate limited: Waiting {wait_time} seconds...")
                            await asyncio.sleep(wait_time)
                            photo = await dev_client.client.upload_file(final_photo_path)
                            await dev_client.client(EditPhotoRequest(
                                channel=entity,
                                photo=InputChatUploadedPhoto(file=photo)
                            ))
                            logger.info("✅ Channel photo updated after wait")
                    
                    # STEP 5: Update channel username
                    if channel_username or token_symbol:
                        logger.info(f"STEP 5: Updating channel username")
                        from telethon.tl.functions.channels import UpdateUsernameRequest, CheckUsernameRequest
                        
                        # Generate username variations
                        # Use contract_name if available, otherwise fallback to token_name
                        if not channel_username:
                            # Generate base username from contract name (preferred), then token name, then symbol
                            contract_name = config_data.get('contract_name', '')
                            if contract_name:
                                base_name = contract_name.lower().replace(' ', '').replace('-', '').replace('_', '')
                            else:
                                base_name = token_name.lower().replace(' ', '').replace('-', '').replace('_', '')
                            
                            if not base_name or len(base_name) < 3:
                                base_name = token_symbol.replace('$', '').lower()
                            
                            # Username variations: name, name_tg, name_chat, name_group
                            username_variations = [
                                base_name,  # Just contract name
                                f"{base_name}_tg",  # name_tg
                                f"{base_name}_chat",  # name_chat
                                f"{base_name}_group",  # name_group
                            ]
                        else:
                            username_variations = [channel_username.replace('@', '')]
                        
                        final_channel_username = None
                        for username_variant in username_variations:
                            username_variant = username_variant.replace('@', '').lower().strip()
                            if len(username_variant) < 5 or len(username_variant) > 32:
                                continue
                            
                            try:
                                # Check if available
                                check_result = await dev_client.client(CheckUsernameRequest(
                                    channel=entity,
                                    username=username_variant
                                ))
                                
                                if check_result:
                                    # Set username
                                    await dev_client.client(UpdateUsernameRequest(
                                        channel=entity,
                                        username=username_variant
                                    ))
                                    final_channel_username = username_variant
                                    logger.info(f"✅ Channel username set to: @{final_channel_username}")
                                    break
                            except Exception as e:
                                continue
                        
                        if not final_channel_username:
                            logger.warning("⚠️ Could not set channel username")
                    
                    return {'success': True, 'chat_id': int(existing_channel_chat_id), 'username': final_channel_username}
                
                channel_result = asyncio.run_coroutine_threadsafe(reuse_channel(), loop).result(timeout=600)
                if channel_result.get('success'):
                    created_channel_chat_id = channel_result.get('chat_id')
                    logger.info(f"✅ Channel reused successfully: {created_channel_chat_id}")
            except Exception as e:
                logger.error(f"❌ Error reusing channel: {e}")
                import traceback
                logger.error(traceback.format_exc())
        
        # Output result for reuse mode (same format as creation mode)
        if reuse_existing and (created_group_chat_id or created_channel_chat_id):
            logger.info(f"\n{'='*60}")
            logger.info(f"GROUP/CHANNEL REUSE COMPLETE")
            logger.info(f"{'='*60}")
            logger.info(f"Using created group and channel: {created_group_chat_id}, {created_channel_chat_id}")
            
            # Get telegram link for channel if it has username
            telegram_link = None
            if created_channel_chat_id:
                try:
                    async def get_channel_link():
                        entity = await dev_client.client.get_entity(int(created_channel_chat_id))
                        if hasattr(entity, 'username') and entity.username:
                            return f"https://t.me/{entity.username.replace('@', '')}"
                        return None
                    telegram_link = asyncio.run_coroutine_threadsafe(get_channel_link(), loop).result(timeout=10)
                except Exception as e:
                    logger.warning(f"Could not get channel link: {e}")
            
            # Output GROUP_CREATOR_RESULT JSON (same format as creation mode)
            output_data = {
                "success": True,
                "group_chat_id": str(created_group_chat_id) if created_group_chat_id else None,
                "channel_chat_id": str(created_channel_chat_id) if created_channel_chat_id else None,
                "telegram_link": telegram_link,
                "portal_created": False
            }
            print(f"\n{'='*60}")
            print("GROUP_CREATOR_RESULT:")
            print(json.dumps(output_data))
            print(f"{'='*60}\n")
            return True
    
    elif create_group or portal_only_mode:
        if portal_only_mode:
            logger.info(f"\n{'='*60}")
            logger.info(f"PORTAL-ONLY MODE: Skipping group/channel creation/reuse")
            logger.info(f"{'='*60}")
            logger.info(f"Will use existing IDs for portal setup:")
            logger.info(f"  - Group ID: {existing_group_chat_id}")
            logger.info(f"  - Channel ID: {existing_channel_chat_id}")
        else:
            logger.info(f"\n{'='*60}")
            logger.info(f"CREATING TELEGRAM GROUP/CHANNEL")
            logger.info(f"{'='*60}")
        
        # Skip group creation if portal-only mode
        if portal_only_mode:
            # In portal-only mode, skip all group/channel creation/reuse
            # Portal setup will happen at the end using existing IDs
            logger.info("Portal-only mode: Skipping group/channel operations, will proceed to portal setup")
        else:
            # Find creator account - use phone from config_data or fallback to hardcoded
            CREATOR_PHONE = config_data.get('telegram_phone') or '+13124733150'
            dev_client = None
            dev_phone = None
            
            # First try to find by specific phone number (from config_data)
            for client in clients:
                if getattr(client, 'phone', None) == CREATOR_PHONE:
                    # Use the client if found, even if not in users config (for group creator mode)
                    dev_client = client
                    dev_phone = CREATOR_PHONE
                    logger.info(f"Found creator account by phone: {CREATOR_PHONE}")
                    break
            
            # Fallback: find dev account (role='dev') in users config
            if not dev_client:
                for phone, user_config in config_data.get('users', {}).items():
                    if user_config.get('role') == 'dev' and user_config.get('enabled', False):
                        # Find corresponding client
                        for client in clients:
                            if getattr(client, 'phone', None) == phone:
                                dev_client = client
                                dev_phone = phone
                                logger.info(f"Found creator account by role='dev': {phone}")
                                break
                        if dev_client:
                            break
            
            # Final fallback: use first client if only one exists (group creator mode)
            if not dev_client and len(clients) == 1:
                dev_client = clients[0]
                dev_phone = getattr(dev_client, 'phone', None) or CREATOR_PHONE
                logger.info(f"Using single available client as creator: {dev_phone}")
            
            if not dev_client:
                logger.error(f"No creator account found ({CREATOR_PHONE} or role='dev'). Cannot create group.")
                logger.error(f"Available clients: {[getattr(c, 'phone', 'unknown') for c in clients]}")
                return False
            
            logger.info(f"Using creator account to create group/channel: {dev_phone}")
        
        # Replace placeholders in group title
        group_title = group_title_template.replace('{token_name}', token_name)
        group_title = group_title.replace('{token_symbol}', token_symbol)
        
        # Replace placeholders in description
        final_description = group_description.replace('{token_name}', token_name)
        final_description = final_description.replace('{token_symbol}', token_symbol)
        final_description = final_description.replace('{description}', description)
        final_description = final_description.replace('{website}', website)
        final_description = final_description.replace('{telegram}', telegram)
        final_description = final_description.replace('{twitter}', twitter)
        final_description = final_description.replace('{chain}', chain)
        
        logger.info(f"Group title: {group_title}")
        if final_description:
            logger.info(f"Group description: {final_description[:100]}...")
        
        # Handle photo: Save base64 to file if provided, otherwise use path
        final_photo_path = group_photo_path
        if group_photo_base64:
            try:
                import base64
                import os
                # datetime is already imported at module level
                
                # Create temp directory if it doesn't exist
                temp_dir = os.path.join(os.path.dirname(__file__), '..', 'temp', 'group_photos')
                os.makedirs(temp_dir, exist_ok=True)
                
                # Extract base64 data (remove data:image/...;base64, prefix if present)
                base64_data = group_photo_base64
                if ',' in base64_data:
                    base64_data = base64_data.split(',')[1]
                
                photo_data = base64.b64decode(base64_data)
                
                # CRITICAL: Validate and resize image if too small
                # Telegram requires minimum 160x160 pixels
                try:
                    from PIL import Image
                    import io
                    
                    # Open image from bytes
                    img = Image.open(io.BytesIO(photo_data))
                    width, height = img.size
                    
                    logger.info(f"📸 Image dimensions: {width}x{height} pixels, size: {len(photo_data)} bytes")
                    
                    # Telegram minimum is 160x160, but we'll use 200x200 to be safe
                    min_size = 200
                    if width < min_size or height < min_size:
                        logger.warning(f"⚠️ Image too small ({width}x{height}), resizing to minimum {min_size}x{min_size}...")
                        # Resize maintaining aspect ratio, then crop to square
                        if width < height:
                            new_width = min_size
                            new_height = int(height * (min_size / width))
                        else:
                            new_height = min_size
                            new_width = int(width * (min_size / height))
                        
                        img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
                        # Crop to square
                        left = (new_width - min_size) // 2
                        top = (new_height - min_size) // 2
                        img = img.crop((left, top, left + min_size, top + min_size))
                        
                        # Convert to RGB if needed (for JPEG compatibility)
                        if img.mode != 'RGB':
                            img = img.convert('RGB')
                        
                        # Save resized image
                        output = io.BytesIO()
                        img.save(output, format='PNG', quality=95)
                        photo_data = output.getvalue()
                        logger.info(f"✅ Resized image to {min_size}x{min_size}, new size: {len(photo_data)} bytes")
                    else:
                        logger.info(f"✅ Image size OK ({width}x{height})")
                except ImportError:
                    logger.warning(f"⚠️ PIL/Pillow not available - cannot validate/resize image. Install with: pip install Pillow")
                except Exception as e:
                    logger.warning(f"⚠️ Could not validate/resize image: {e}. Using original image.")
                
                # Generate filename
                from datetime import datetime as dt
                timestamp = dt.now().strftime('%Y%m%d_%H%M%S')
                extension = group_photo_filename.split('.')[-1] if '.' in group_photo_filename else 'png'
                photo_filename = f"{timestamp}_{group_photo_filename}"
                final_photo_path = os.path.join(temp_dir, photo_filename)
                
                # Save base64 to file
                with open(final_photo_path, 'wb') as f:
                    f.write(photo_data)
                
                logger.info(f"✅ Saved base64 photo to: {final_photo_path} ({len(photo_data)} bytes)")
            except Exception as e:
                logger.warning(f"⚠️ Failed to save base64 photo: {e}. Will try URL download or photo_path.")
                final_photo_path = None  # Reset so we can try URL download
        
        # If base64 failed or missing, try downloading from token_image_url
        if not final_photo_path and token_image_url:
            try:
                import requests
                import os
                from datetime import datetime as dt
                
                logger.info(f"📥 Downloading token image from URL: {token_image_url}")
                response = requests.get(token_image_url, timeout=30)
                response.raise_for_status()
                
                image_data = response.content
                
                # CRITICAL: Validate and resize downloaded image if too small
                # Telegram requires minimum 160x160 pixels
                try:
                    from PIL import Image
                    import io
                    
                    # Open image from bytes
                    img = Image.open(io.BytesIO(image_data))
                    width, height = img.size
                    
                    logger.info(f"📸 Downloaded image dimensions: {width}x{height} pixels, size: {len(image_data)} bytes")
                    
                    # Telegram minimum is 160x160, but we'll use 200x200 to be safe
                    min_size = 200
                    if width < min_size or height < min_size:
                        logger.warning(f"⚠️ Downloaded image too small ({width}x{height}), resizing to minimum {min_size}x{min_size}...")
                        # Resize maintaining aspect ratio, then crop to square
                        if width < height:
                            new_width = min_size
                            new_height = int(height * (min_size / width))
                        else:
                            new_height = min_size
                            new_width = int(width * (min_size / height))
                        
                        img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
                        # Crop to square
                        left = (new_width - min_size) // 2
                        top = (new_height - min_size) // 2
                        img = img.crop((left, top, left + min_size, top + min_size))
                        
                        # Convert to RGB if needed (for JPEG compatibility)
                        if img.mode != 'RGB':
                            img = img.convert('RGB')
                        
                        # Save resized image
                        output = io.BytesIO()
                        img.save(output, format='PNG', quality=95)
                        image_data = output.getvalue()
                        logger.info(f"✅ Resized downloaded image to {min_size}x{min_size}, new size: {len(image_data)} bytes")
                    else:
                        logger.info(f"✅ Downloaded image size OK ({width}x{height})")
                except ImportError:
                    logger.warning(f"⚠️ PIL/Pillow not available - cannot validate/resize image. Install with: pip install Pillow")
                except Exception as e:
                    logger.warning(f"⚠️ Could not validate/resize downloaded image: {e}. Using original image.")
                
                # Create temp directory if it doesn't exist
                temp_dir = os.path.join(os.path.dirname(__file__), '..', 'temp', 'group_photos')
                os.makedirs(temp_dir, exist_ok=True)
                
                # Generate filename from URL or use default
                timestamp = dt.now().strftime('%Y%m%d_%H%M%S')
                # Try to get extension from URL
                url_extension = token_image_url.split('.')[-1].split('?')[0] if '.' in token_image_url else 'png'
                if url_extension not in ['png', 'jpg', 'jpeg', 'webp', 'gif']:
                    url_extension = 'png'
                photo_filename = f"{timestamp}_token_image.{url_extension}"
                final_photo_path = os.path.join(temp_dir, photo_filename)
                
                # Save downloaded image
                with open(final_photo_path, 'wb') as f:
                    f.write(image_data)
                
                logger.info(f"✅ Downloaded and saved token image to: {final_photo_path} ({len(image_data)} bytes)")
            except Exception as e:
                logger.warning(f"⚠️ Failed to download token image from URL: {e}. Will use photo_path if provided.")
                final_photo_path = group_photo_path  # Fallback to path if provided
        
        # IMPORTANT: If create_channel is true, we want to create BOTH a group AND a channel
        # So the first block should ALWAYS create a GROUP (not a channel)
        # The channel will be created separately in the create_channel block
        # Only use is_channel=true if create_channel is false (meaning we only want one thing)
        is_channel_for_group = False  # Always create a group in the first block
        if not create_channel:
            # If we're not creating a separate channel, check if user wants a channel instead of group
            is_channel_for_group = config_data.get('group_is_channel', False)
        
        # Use Telethon directly for group/channel creation
        # Skip if portal-only mode (we'll handle portal setup separately)
        if not portal_only_mode:
            try:
                entity_type = 'channel' if is_channel_for_group else 'group'
                logger.info(f"🔵 STEP 1: Creating {entity_type} via Telethon (direct)")
                logger.info(f"   - is_channel parameter: {is_channel_for_group}")
                logger.info(f"   - create_channel flag: {create_channel}")
                logger.info(f"   - Will create {'CHANNEL' if is_channel_for_group else 'GROUP'}")
                # STEP 1: Create group WITHOUT photo first (we'll upload photo after)
                logger.info(f"\n{'='*60}")
                logger.info(f"STEP 1: CREATING GROUP")
                logger.info(f"{'='*60}")
                # Use async version directly with the persistent event loop to avoid event loop conflicts
                async def create_group_async():
                    await dev_client._ensure_connected()
                    return await dev_client.create_group_async(
                        title=group_title,
                        description=final_description if final_description else None,
                        photo_path=None,  # Upload photo after creation
                        is_channel=is_channel_for_group,  # False if creating group+channel, True if only channel
                        is_megagroup=config_data.get('group_is_megagroup', True)
                    )
                
                result = asyncio.run_coroutine_threadsafe(create_group_async(), loop).result(timeout=600)
                logger.info(f"   - Result: {result.get('success')}, chat_id: {result.get('chat_id')}")
                
                # Add delay to avoid rate limits
                logger.info(f"⏳ Waiting 2 seconds before next step...")
                time.sleep(2)
                
                if result.get('success'):
                    created_group_chat_id = result.get('chat_id')
                    group_username = result.get('username')  # Username if channel has one
                    
                    # STEP 2: Upload group photo
                    logger.info(f"\n{'='*60}")
                    logger.info(f"STEP 2: CHECKING GROUP PHOTO")
                    logger.info(f"{'='*60}")
                    logger.info(f"   - final_photo_path: {final_photo_path}")
                    logger.info(f"   - final_photo_path exists: {final_photo_path and os.path.exists(final_photo_path) if final_photo_path else False}")
                    if final_photo_path:
                        logger.info(f"   - Photo file size: {os.path.getsize(final_photo_path)} bytes" if os.path.exists(final_photo_path) else "   - Photo file does NOT exist")
                    
                    if final_photo_path and os.path.exists(final_photo_path):
                        logger.info(f"\n{'='*60}")
                        logger.info(f"STEP 2: UPLOADING GROUP PHOTO")
                        logger.info(f"{'='*60}")
                        try:
                            logger.info(f"Uploading group photo: {final_photo_path}")
                            async def upload_group_photo():
                                entity = await dev_client.client.get_entity(created_group_chat_id)
                                from telethon.tl.functions.channels import EditPhotoRequest
                                from telethon.tl.types import InputChatUploadedPhoto
                                from telethon.errors import FloodWaitError
                                
                                try:
                                    photo = await dev_client.client.upload_file(final_photo_path)
                                    await dev_client.client(EditPhotoRequest(
                                        channel=entity,
                                        photo=InputChatUploadedPhoto(file=photo)
                                    ))
                                    logger.info(f"✅ Group photo uploaded successfully")
                                    return {'success': True}
                                except FloodWaitError as e:
                                    wait_time = e.seconds
                                    logger.warning(f"⚠️ Rate limited: Need to wait {wait_time} seconds before uploading group photo")
                                    logger.info(f"⏳ Waiting {wait_time} seconds (Telegram rate limit)...")
                                    await asyncio.sleep(wait_time)
                                    # Retry after waiting
                                    logger.info(f"Retrying group photo upload...")
                                    photo = await dev_client.client.upload_file(final_photo_path)
                                    await dev_client.client(EditPhotoRequest(
                                        channel=entity,
                                        photo=InputChatUploadedPhoto(file=photo)
                                    ))
                                    logger.info(f"✅ Group photo uploaded successfully after wait")
                                    return {'success': True}
                            
                            photo_result = asyncio.run_coroutine_threadsafe(upload_group_photo(), loop).result(timeout=600)  # Increased timeout for flood wait
                            if photo_result.get('success'):
                                logger.info(f"✅ Group photo set successfully")
                            else:
                                logger.error(f"❌ Failed to set group photo: {photo_result.get('error')}")
                        except Exception as e:
                            logger.error(f"❌ Error setting group photo: {e}")
                            import traceback
                            logger.error(traceback.format_exc())
                    else:
                        logger.error(f"❌ CANNOT UPLOAD GROUP PHOTO: final_photo_path is {'None' if not final_photo_path else 'set but file does not exist'}")
                        logger.error(f"   - final_photo_path: {final_photo_path}")
                        logger.error(f"   - group_photo_base64 was provided: {bool(group_photo_base64)}")
                        logger.error(f"   - token_image_url was provided: {bool(token_image_url)}")
                        logger.error(f"   - group_photo_path was provided: {bool(group_photo_path)}")
                    
                    # Add delay to avoid rate limits
                    logger.info(f"⏳ Waiting 2 seconds before next step...")
                    time.sleep(2)
                
                # STEP 3: Skip anonymous for now - will enable AFTER users are invited (STEP 5)
                logger.info(f"\n{'='*60}")
                logger.info(f"STEP 3: SKIPPING 'REMAIN ANONYMOUS' - Will enable AFTER users are invited (STEP 5)")
                logger.info(f"{'='*60}")
                
                # Verify what type of entity was actually created
                try:
                    async def verify_entity_type():
                        entity = await dev_client.client.get_entity(created_group_chat_id)
                        is_channel_entity = hasattr(entity, 'broadcast') and entity.broadcast
                        entity_type = 'CHANNEL' if is_channel_entity else 'GROUP'
                        logger.info(f"✅ Verified entity type: {entity_type} (ID: {created_group_chat_id})")
                        return entity_type
                    entity_type = asyncio.run_coroutine_threadsafe(verify_entity_type(), loop).result(timeout=10)
                    if entity_type == 'CHANNEL' and not is_channel_for_group:
                        logger.error(f"❌ ERROR: Created a CHANNEL but we expected a GROUP!")
                    elif entity_type == 'GROUP' and is_channel_for_group:
                        logger.error(f"❌ ERROR: Created a GROUP but we expected a CHANNEL!")
                except Exception as e:
                    logger.warning(f"Could not verify entity type: {e}")
                
                logger.info(f"✅ Created {'channel' if is_channel_for_group else 'group'} via Telethon: (ID: {created_group_chat_id})")
                
                # NOTE: Group is private - we don't change its name/username
                # Only the CHANNEL gets updated with token branding (done in STEP 6 below)
                logger.info(f"✅ Created group: {group_title} (ID: {created_group_chat_id}) - Group is private, no name/username changes")
                
                # Try to get invite link or username for telegram link
                telegram_link = None
                try:
                    if group_username:
                        # Channel with username
                        telegram_link = f"https://t.me/{group_username.replace('@', '')}"
                    else:
                        # Group/channel without username - try to export invite link
                        async def get_invite_link():
                            entity = await dev_client.client.get_entity(created_group_chat_id)
                            try:
                                # Try channels module first
                                from telethon.tl.functions.channels import ExportInviteRequest
                                invite_link = await dev_client.client(ExportInviteRequest(entity))
                                return invite_link.link
                            except:
                                try:
                                    # Fallback to messages module
                                    from telethon.tl.functions.messages import ExportChatInviteLinkRequest
                                    invite_link = await dev_client.client(ExportChatInviteLinkRequest(entity))
                                    return invite_link.link
                                except Exception as e:
                                    logger.warning(f"Could not export invite link: {e}")
                                    return None
                        
                        invite_link = asyncio.run_coroutine_threadsafe(get_invite_link(), loop).result(timeout=10)
                        if invite_link:
                            telegram_link = invite_link
                except Exception as e:
                    logger.warning(f"Could not get Telegram link: {e}")
                
                if telegram_link:
                    logger.info(f"Telegram link: {telegram_link}")
                
                # Configure settings if provided
                if group_settings:
                    logger.info("Configuring group settings...")
                    settings_result = dev_client.configure_group_settings(created_group_chat_id, group_settings)
                    if settings_result.get('success'):
                        logger.info("✅ Group settings configured")
                    else:
                        logger.warning(f"Failed to configure settings: {settings_result.get('error')}")
                
                # Determine which users to invite
                # Check if we should invite user1/user2 (only after token launch)
                invite_user1_user2 = config_data.get('invite_user1_user2_after_launch', False)
                token_address = config_data.get('token_address', '')
                token_verified = config_data.get('token_verified', False)
                
                # If conditional joining is enabled, only invite user1/user2 if token is live
                should_invite_user1_user2 = True
                if invite_user1_user2:
                    should_invite_user1_user2 = bool(token_address and token_verified)
                    if not should_invite_user1_user2:
                        logger.info("Token not live yet - user1/user2 will join later (conditional joining enabled)")
                
                # Get users to invite from config, or default to all except dev
                users_to_invite_roles = config_data.get('invite_users', [])
                if not users_to_invite_roles:
                    # Default: invite all except dev
                    users_to_invite_roles = ['mod', 'user1', 'user2']
                
                # Filter user1/user2 if conditional joining
                if not should_invite_user1_user2:
                    users_to_invite_roles = [r for r in users_to_invite_roles if r not in ['user1', 'user2']]
                    logger.info(f"Conditional joining: Filtered out user1/user2. Inviting roles: {users_to_invite_roles}")
                
                # Get clients for users to invite
                other_clients = []
                for phone, user_config in config_data.get('users', {}).items():
                    user_role = user_config.get('role', '')
                    if user_role in users_to_invite_roles and user_config.get('enabled', False):
                        for client in clients:
                            if getattr(client, 'phone', None) == phone:
                                other_clients.append(client)
                                break
                
                if other_clients:
                    logger.info(f"Inviting {len(other_clients)} users to group...")
                    # Get user entities from clients
                    async def get_user_entities():
                        user_entities = []
                        for client in other_clients:
                            try:
                                # Get the user's own entity
                                me = await client.client.get_me()
                                user_entities.append(me)
                            except Exception as e:
                                logger.warning(f"Could not get entity for {getattr(client, 'phone', 'unknown')}: {e}")
                        return user_entities
                    
                    try:
                        user_entities = asyncio.run_coroutine_threadsafe(get_user_entities(), loop).result(timeout=30)
                        
                        if user_entities:
                            async def invite_users():
                                entity = await dev_client.client.get_entity(created_group_chat_id)
                                await dev_client.client(InviteToChannelRequest(
                                    channel=entity,
                                    users=user_entities
                                ))
                                return len(user_entities)
                            
                            invited_count = asyncio.run_coroutine_threadsafe(invite_users(), loop).result(timeout=30)
                            logger.info(f"✅ Invited {invited_count} users to group")
                            
                            # Wait for users to join AND load participants (CRITICAL for Telegram sync)
                            logger.info(f"⏳ Waiting 3 seconds for users to join...")
                            time.sleep(3)
                            
                            # STEP 3.5: Promote mod users to admin RIGHT AFTER they join
                            logger.info(f"\n{'='*60}")
                            logger.info(f"STEP 3.5: PROMOTING MOD USERS TO ADMIN (AFTER JOINING)")
                            logger.info(f"{'='*60}")
                            
                            async def promote_mods_after_join():
                                entity = await dev_client.client.get_entity(created_group_chat_id)
                                
                                # CRITICAL: Load participants first to ensure Telegram has synced user status
                                logger.info(f"  🔍 Loading participants to sync user status...")
                                try:
                                    await dev_client.client.get_participants(entity, limit=100)
                                    logger.info(f"  ✅ Participants loaded")
                                    await asyncio.sleep(2)  # Wait for Telegram to fully sync
                                except Exception as e:
                                    logger.warning(f"  ⚠️ Could not load participants: {e}")
                                    await asyncio.sleep(2)  # Still wait even if load fails
                                
                                # Verify creator is owner and has "Add Admins" permission
                                logger.info(f"  🔍 Verifying creator permissions...")
                                try:
                                    from telethon.tl.functions.channels import GetParticipantRequest
                                    creator_me = await dev_client.client.get_me()
                                    creator_participant = await dev_client.client(GetParticipantRequest(
                                        channel=entity,
                                        participant=creator_me
                                    ))
                                    
                                    from telethon.tl.types import ChannelParticipantCreator, ChannelParticipantAdmin
                                    is_owner = isinstance(creator_participant.participant, ChannelParticipantCreator)
                                    
                                    if is_owner:
                                        logger.info(f"  ✅ Creator is group owner (has full permissions)")
                                    elif isinstance(creator_participant.participant, ChannelParticipantAdmin):
                                        admin_rights_check = creator_participant.participant.admin_rights
                                        can_add_admins = getattr(admin_rights_check, 'add_admins', False)
                                        if can_add_admins:
                                            logger.info(f"  ✅ Creator has 'Add Admins' permission")
                                        else:
                                            logger.error(f"  ❌ Creator does NOT have 'Add Admins' permission!")
                                            logger.error(f"     Promotion will fail. Please enable 'Add Admins' in Telegram.")
                                            return {'promoted': 0, 'failed': 0, 'error': 'Creator lacks Add Admins permission'}
                                    else:
                                        logger.error(f"  ❌ Creator is not an admin!")
                                        return {'promoted': 0, 'failed': 0, 'error': 'Creator is not an admin'}
                                except Exception as e:
                                    logger.warning(f"  ⚠️ Could not verify creator permissions: {e}")
                                    logger.warning(f"     Continuing anyway, but promotion may fail...")
                                
                                # Get user roles and is_mod flags from config
                                user_roles = {}
                                user_is_mod = {}
                                for phone, user_config in config_data.get('users', {}).items():
                                    user_roles[phone] = user_config.get('role', '')
                                    user_is_mod[phone] = user_config.get('is_mod', False)
                                
                                promoted_count = 0
                                failed_count = 0
                                
                                # Create admin rights for mods - MUST specify ALL fields explicitly
                                # Based on tutorial: Telegram requires ALL admin rights to be specified
                                from telethon.tl.types import ChatAdminRights
                                admin_rights = ChatAdminRights(
                                    change_info=True,
                                    post_messages=True,
                                    edit_messages=True,
                                    delete_messages=True,
                                    ban_users=True,
                                    invite_users=True,
                                    pin_messages=True,
                                    add_admins=False,  # Mods can't add admins
                                    anonymous=False,  # Mods are not anonymous
                                    manage_call=True,
                                    other=True  # Full permissions for filter management
                                )
                                
                                logger.info(f"  📋 Admin rights being set:")
                                logger.info(f"     - change_info: {admin_rights.change_info}")
                                logger.info(f"     - post_messages: {admin_rights.post_messages}")
                                logger.info(f"     - edit_messages: {admin_rights.edit_messages}")
                                logger.info(f"     - delete_messages: {admin_rights.delete_messages}")
                                logger.info(f"     - ban_users: {admin_rights.ban_users}")
                                logger.info(f"     - invite_users: {admin_rights.invite_users}")
                                logger.info(f"     - pin_messages: {admin_rights.pin_messages}")
                                logger.info(f"     - add_admins: {admin_rights.add_admins}")
                                logger.info(f"     - anonymous: {admin_rights.anonymous}")
                                logger.info(f"     - manage_call: {admin_rights.manage_call}")
                                logger.info(f"     - other: {admin_rights.other}")
                                
                                # Promote each mod user
                                for client in other_clients:
                                    phone = getattr(client, 'phone', None)
                                    if not phone:
                                        continue
                                    
                                    # Skip creator (can't self-promote)
                                    CREATOR_PHONE = '+13124733150'
                                    if phone == CREATOR_PHONE:
                                        logger.info(f"  ⏭️ Skipping creator {phone} (cannot self-promote)")
                                        continue
                                    
                                    # Check if this user should be promoted
                                    is_mod_flag = user_is_mod.get(phone, False)
                                    user_role = user_roles.get(phone, '').lower() if user_roles.get(phone) else ''
                                    should_promote = is_mod_flag or user_role == 'mod' or user_role == 'dev'
                                    
                                    if not should_promote:
                                        logger.info(f"  ⏭️ Skipping {phone} (role: {user_roles.get(phone, 'unknown')}, is_mod: {is_mod_flag}) - not a mod/dev")
                                        continue
                                    
                                    try:
                                        mod_user_entity = await client.client.get_me()
                                        logger.info(f"  📤 Promoting {phone} (ID: {mod_user_entity.id}, Username: {getattr(mod_user_entity, 'username', 'N/A')}) to moderator...")
                                        
                                        # Verify user is actually in the group (with retry for database locks)
                                        for retry in range(3):
                                            try:
                                                from telethon.tl.functions.channels import GetParticipantRequest
                                                participant_check = await dev_client.client(GetParticipantRequest(
                                                    channel=entity,
                                                    participant=mod_user_entity
                                                ))
                                                logger.info(f"     ✅ User is confirmed member of group")
                                                break
                                            except Exception as check_error:
                                                error_str = str(check_error).lower()
                                                if 'database is locked' in error_str or 'locked' in error_str:
                                                    if retry < 2:
                                                        wait_time = (retry + 1) * 2
                                                        logger.warning(f"     ⚠️ Database locked (verify), waiting {wait_time}s and retrying...")
                                                        await asyncio.sleep(wait_time)
                                                        continue
                                                logger.warning(f"     ⚠️ Could not verify user is in group: {check_error}")
                                                logger.warning(f"     Continuing anyway...")
                                                break
                                        
                                        from telethon.errors import FloodWaitError
                                        
                                        # Promote with retry for both rate limits and database locks
                                        # Use EditAdminRequest directly (correct Telegram API)
                                        from telethon.tl.functions.channels import EditAdminRequest
                                        promotion_success = False
                                        for retry in range(3):
                                            try:
                                                result = await dev_client.client(EditAdminRequest(
                                                    channel=entity,
                                                    user_id=mod_user_entity,
                                                    admin_rights=admin_rights,
                                                    rank="Moderator"
                                                ))
                                                
                                                logger.info(f"     ✅ EditAdminRequest completed successfully")
                                                
                                                # Wait for Telegram to process
                                                await asyncio.sleep(3)  # Increased delay per tutorial
                                                promotion_success = True
                                                break
                                            except FloodWaitError as flood_error:
                                                wait_time = flood_error.seconds
                                                logger.warning(f"     ⚠️ RATE LIMITED: Telegram requires {wait_time} seconds wait")
                                                logger.warning(f"     ⏳ Waiting {wait_time} seconds before retrying...")
                                                await asyncio.sleep(wait_time)
                                                
                                                # Retry after waiting
                                                logger.info(f"     🔄 Retrying promotion after rate limit wait...")
                                                result = await dev_client.client(EditAdminRequest(
                                                    channel=entity,
                                                    user_id=mod_user_entity,
                                                    admin_rights=admin_rights,
                                                    rank="Moderator"
                                                ))
                                                logger.info(f"     ✅ edit_admin() completed successfully after retry")
                                                await asyncio.sleep(3)
                                                promotion_success = True
                                                break
                                            except Exception as promote_error:
                                                error_str = str(promote_error).lower()
                                                if 'database is locked' in error_str or 'locked' in error_str:
                                                    if retry < 2:
                                                        wait_time = (retry + 1) * 2  # 2s, 4s
                                                        logger.warning(f"     ⚠️ DATABASE LOCKED: Waiting {wait_time}s and retrying...")
                                                        await asyncio.sleep(wait_time)
                                                        continue
                                                    else:
                                                        logger.error(f"     ❌ Database locked after {retry + 1} retries - giving up")
                                                        raise promote_error
                                                else:
                                                    # Not a lock error - raise immediately
                                                    raise promote_error
                                        
                                        if not promotion_success:
                                            logger.error(f"  ❌ Failed to promote {phone} after retries")
                                            failed_count += 1
                                        else:
                                            logger.info(f"  ✅ Successfully promoted {phone} (ID: {mod_user_entity.id}) to moderator")
                                            promoted_count += 1
                                            await asyncio.sleep(2)  # Delay between promotions
                                    except Exception as e:
                                        error_str = str(e)
                                        error_type = type(e).__name__
                                        logger.error(f"  ❌ Failed to promote {phone}: {error_str}")
                                        logger.error(f"     Error type: {error_type}")
                                        import traceback
                                        logger.error(f"     Traceback:\n{traceback.format_exc()}")
                                        failed_count += 1
                                
                                return {'promoted': promoted_count, 'failed': failed_count}
                            
                            try:
                                promote_result = asyncio.run_coroutine_threadsafe(promote_mods_after_join(), loop).result(timeout=60)
                                logger.info(f"✅ Promoted {promote_result.get('promoted', 0)} mod(s) to admin")
                                if promote_result.get('failed', 0) > 0:
                                    logger.warning(f"⚠️ Failed to promote {promote_result.get('failed', 0)} mod(s)")
                            except Exception as e:
                                logger.warning(f"⚠️ Error promoting mods: {e}")
                                import traceback
                                logger.warning(traceback.format_exc())
                        else:
                            logger.warning("No user entities found to invite")
                    except Exception as e:
                        logger.warning(f"Failed to invite users: {e}")
                        import traceback
                        logger.warning(traceback.format_exc())
                
                # STEP 4: Enable "Remain Anonymous" for creator AFTER users are invited AND mods are promoted
                logger.info(f"\n{'='*60}")
                logger.info(f"STEP 4: ENABLING 'REMAIN ANONYMOUS' FOR CREATOR (AFTER USERS INVITED)")
                logger.info(f"{'='*60}")
                try:
                    async def enable_creator_anonymous():
                        entity = await dev_client.client.get_entity(created_group_chat_id)
                        # Get the creator (dev account) user entity
                        me = await dev_client.client.get_me()
                        from telethon.tl.functions.channels import EditAdminRequest
                        from telethon.tl.types import ChatAdminRights, InputUserSelf
                        
                        try:
                            # Get current admin info to preserve existing rights
                            from telethon.tl.functions.channels import GetFullChannelRequest
                            full_channel = await dev_client.client(GetFullChannelRequest(entity))
                            
                            # Get current admin rights if available
                            current_rights = None
                            if hasattr(full_channel, 'full_chat') and hasattr(full_channel.full_chat, 'admins'):
                                for admin in full_channel.full_chat.admins:
                                    if admin.user_id == me.id and hasattr(admin, 'admin_rights'):
                                        current_rights = admin.admin_rights
                                        break
                            
                            # Create admin rights with anonymous=True
                            # Preserve existing rights if available, otherwise use full admin rights
                            if current_rights:
                                anonymous_rights = ChatAdminRights(
                                    change_info=getattr(current_rights, 'change_info', True),
                                    post_messages=getattr(current_rights, 'post_messages', True),
                                    edit_messages=getattr(current_rights, 'edit_messages', True),
                                    delete_messages=getattr(current_rights, 'delete_messages', True),
                                    ban_users=getattr(current_rights, 'ban_users', True),
                                    invite_users=getattr(current_rights, 'invite_users', True),
                                    pin_messages=getattr(current_rights, 'pin_messages', True),
                                    add_admins=getattr(current_rights, 'add_admins', True),
                                    anonymous=True,  # Enable "Remain Anonymous" - THIS IS THE KEY
                                    manage_call=getattr(current_rights, 'manage_call', False),
                                    other=getattr(current_rights, 'other', False)
                                )
                            else:
                                # Use full admin rights with anonymous=True
                                anonymous_rights = ChatAdminRights(
                                    change_info=True,
                                    post_messages=True,
                                    edit_messages=True,
                                    delete_messages=True,
                                    ban_users=True,
                                    invite_users=True,
                                    pin_messages=True,
                                    add_admins=True,
                                    anonymous=True,  # Enable "Remain Anonymous"
                                    manage_call=False,
                                    other=False
                                )
                            
                            # Update admin rights with anonymous=True
                            # Use InputUserSelf() to reference the current user
                            await dev_client.client(EditAdminRequest(
                                channel=entity,
                                user_id=InputUserSelf(),  # Use InputUserSelf() instead of me
                                admin_rights=anonymous_rights,
                                rank="Admin"
                            ))
                            logger.info(f"✅ Creator 'Remain Anonymous' enabled (anonymous=True)")
                            return {'success': True}
                        except Exception as e:
                            error_str = str(e)
                            logger.error(f"❌ Could not enable 'Remain Anonymous' for creator: {error_str}")
                            import traceback
                            logger.error(traceback.format_exc())
                            return {'success': False, 'error': error_str}
                    
                    anonymous_result = asyncio.run_coroutine_threadsafe(enable_creator_anonymous(), loop).result(timeout=30)
                    if anonymous_result.get('success'):
                        logger.info(f"✅ Creator 'Remain Anonymous' enabled successfully")
                    else:
                        logger.warning(f"⚠️ Could not enable 'Remain Anonymous': {anonymous_result.get('error')}")
                except Exception as e:
                    logger.warning(f"⚠️ Error enabling 'Remain Anonymous': {e}")
                    import traceback
                    logger.warning(traceback.format_exc())
                
                # Add delay to avoid rate limits
                logger.info(f"⏳ Waiting 2 seconds after enabling anonymous...")
                time.sleep(2)
                
                # Store created group chat ID (already set above)
                # Update chat_ids to use the created group (if no channel will be created)
                # BUT ONLY if we're running conversations - otherwise skip this
                if not create_channel and len(scripted_conversations) > 0:
                    chat_ids = [str(created_group_chat_id)]
                    logger.info(f"Using created group for conversation: {created_group_chat_id}")
                
                # If we also need to create a channel, do it now
                logger.info(f"\n{'='*60}")
                logger.info(f"CHECKING IF CHANNEL SHOULD BE CREATED")
                logger.info(f"   - create_channel flag: {create_channel}")
                logger.info(f"   - create_group flag: {create_group}")
                logger.info(f"{'='*60}")
                
                if create_channel:
                    logger.info(f"\n{'='*60}")
                    logger.info(f"STEP 4: CREATING TELEGRAM CHANNEL")
                    logger.info(f"{'='*60}")
                    
                    try:
                        # Generate channel username variations if not provided
                        # Use contract_name if available, otherwise fallback to token_name
                        if not channel_username:
                            # Generate base username from contract name (preferred), then token name, then symbol
                            if contract_name:
                                base_name = contract_name.lower().replace(' ', '').replace('-', '').replace('_', '')
                            else:
                                base_name = token_name.lower().replace(' ', '').replace('-', '').replace('_', '')
                            
                            if not base_name or len(base_name) < 3:
                                base_name = token_symbol.replace('$', '').lower()
                            
                            # Username variations: name, name_tg, name_chat, name_group
                            username_variations = [
                                base_name,  # Just contract name
                                f"{base_name}_tg",  # name_tg
                                f"{base_name}_chat",  # name_chat
                                f"{base_name}_group",  # name_group
                            ]
                        else:
                            username_variations = [channel_username.replace('@', '')]
                        
                        # STEP 4: Create channel WITHOUT photo first (we'll upload photo after)
                        logger.info(f"Creating CHANNEL without photo (will upload after)")
                        logger.info(f"   - is_channel=True")
                        logger.info(f"   - is_megagroup=False (broadcast channel, not interactive)")
                        logger.info(f"   - title: {group_title}")
                        logger.info(f"   - Will try usernames: {username_variations[:3]}...")
                        
                        # Create channel WITHOUT photo (upload after)
                        # Use async version directly with the persistent event loop
                        async def create_channel_async():
                            await dev_client._ensure_connected()
                            return await dev_client.create_group_async(
                                title=group_title,
                                description=final_description if final_description else None,
                                photo_path=None,
                                is_channel=True,
                                is_megagroup=False  # Channel, not megagroup
                            )
                        
                        channel_result = asyncio.run_coroutine_threadsafe(create_channel_async(), loop).result(timeout=600)
                        
                        logger.info(f"Channel creation returned: success={channel_result.get('success')}, chat_id={channel_result.get('chat_id')}, error={channel_result.get('error')}")
                        
                        # Add delay to avoid rate limits
                        logger.info(f"⏳ Waiting 2 seconds before next step...")
                        time.sleep(2)
                        
                        if channel_result.get('success'):
                            created_channel_id = channel_result.get('chat_id')
                            
                            # STEP 5: Upload channel photo
                            logger.info(f"\n{'='*60}")
                            logger.info(f"STEP 5: CHECKING CHANNEL PHOTO")
                            logger.info(f"{'='*60}")
                            logger.info(f"   - final_photo_path: {final_photo_path}")
                            logger.info(f"   - final_photo_path exists: {final_photo_path and os.path.exists(final_photo_path) if final_photo_path else False}")
                            if final_photo_path:
                                logger.info(f"   - Photo file size: {os.path.getsize(final_photo_path)} bytes" if os.path.exists(final_photo_path) else "   - Photo file does NOT exist")
                            
                            if final_photo_path and os.path.exists(final_photo_path):
                                logger.info(f"\n{'='*60}")
                                logger.info(f"STEP 5: UPLOADING CHANNEL PHOTO")
                                logger.info(f"{'='*60}")
                                try:
                                    logger.info(f"Uploading channel photo: {final_photo_path}")
                                    logger.info(f"   - Photo file exists: {os.path.exists(final_photo_path)}")
                                    logger.info(f"   - Photo file size: {os.path.getsize(final_photo_path)} bytes")
                                    
                                    async def upload_channel_photo():
                                        entity = await dev_client.client.get_entity(created_channel_id)
                                        from telethon.tl.functions.channels import EditPhotoRequest
                                        from telethon.tl.types import InputChatUploadedPhoto
                                        from telethon.errors import FloodWaitError
                                        
                                        try:
                                            photo = await dev_client.client.upload_file(final_photo_path)
                                            await dev_client.client(EditPhotoRequest(
                                                channel=entity,
                                                photo=InputChatUploadedPhoto(file=photo)
                                            ))
                                            logger.info(f"✅ Channel photo uploaded successfully")
                                            return {'success': True}
                                        except FloodWaitError as e:
                                            wait_time = e.seconds
                                            logger.warning(f"⚠️ Rate limited: Need to wait {wait_time} seconds before uploading channel photo")
                                            logger.info(f"⏳ Waiting {wait_time} seconds (Telegram rate limit)...")
                                            await asyncio.sleep(wait_time)
                                            # Retry after waiting
                                            logger.info(f"Retrying channel photo upload...")
                                            photo = await dev_client.client.upload_file(final_photo_path)
                                            await dev_client.client(EditPhotoRequest(
                                                channel=entity,
                                                photo=InputChatUploadedPhoto(file=photo)
                                            ))
                                            logger.info(f"✅ Channel photo uploaded successfully after wait")
                                            return {'success': True}
                                    
                                    photo_result = asyncio.run_coroutine_threadsafe(upload_channel_photo(), loop).result(timeout=600)  # Increased timeout for flood wait
                                    
                                    if photo_result.get('success'):
                                        logger.info(f"✅ Channel photo set successfully")
                                    else:
                                        logger.error(f"❌ Failed to set channel photo: {photo_result.get('error')}")
                                except Exception as e:
                                    logger.error(f"❌ Error setting channel photo: {e}")
                                    import traceback
                                    logger.error(traceback.format_exc())
                            else:
                                logger.error(f"❌ CANNOT UPLOAD CHANNEL PHOTO: final_photo_path is {'None' if not final_photo_path else 'set but file does not exist'}")
                                logger.error(f"   - final_photo_path: {final_photo_path}")
                                logger.error(f"   - group_photo_base64 was provided: {bool(group_photo_base64)}")
                                logger.error(f"   - token_image_url was provided: {bool(token_image_url)}")
                                logger.error(f"   - group_photo_path was provided: {bool(group_photo_path)}")
                                
                                # Add delay to avoid rate limits
                                logger.info(f"⏳ Waiting 2 seconds before next step...")
                                time.sleep(2)
                            
                            # STEP 6: Update channel title and set username (make channel public)
                            logger.info(f"\n{'='*60}")
                            logger.info(f"STEP 6: UPDATING CHANNEL TITLE AND SETTING USERNAME (MAKING PUBLIC)")
                            logger.info(f"{'='*60}")
                            
                            # First, update channel title
                            try:
                                async def update_channel_title():
                                    entity = await dev_client.client.get_entity(created_channel_id)
                                    await dev_client.client.edit_title(entity, group_title)
                                    logger.info(f"✅ Channel title updated to: {group_title}")
                                    return {'success': True}
                                title_result = asyncio.run_coroutine_threadsafe(update_channel_title(), loop).result(timeout=30)
                                if title_result.get('success'):
                                    logger.info(f"✅ Channel title set successfully")
                            except Exception as e:
                                logger.warning(f"⚠️ Could not update channel title: {e}")
                            
                            # Add delay before username setting
                            logger.info(f"⏳ Waiting 2 seconds before setting username...")
                            time.sleep(2)
                            
                            logger.info(f"Will try {len(username_variations)} username variations:")
                            for idx, var in enumerate(username_variations, 1):
                                logger.info(f"  {idx}. @{var}")
                            
                            # According to Telethon docs: Channels are private by default, need to set username to make public
                            logger.info(f"\n{'='*60}")
                            logger.info(f"STARTING USERNAME SETTING PROCESS")
                            logger.info(f"   Channel ID: {created_channel_id}")
                            logger.info(f"   Account: {dev_phone}")
                            logger.info(f"   Variations to try: {len(username_variations)}")
                            logger.info(f"{'='*60}")
                            
                            final_channel_username = None
                            rate_limited = False
                            for attempt, username_variant in enumerate(username_variations):
                                # CRITICAL: Stop immediately if rate limited - don't try more variations
                                if rate_limited:
                                    logger.warning(f"⚠️ Rate limit detected - stopping username attempts to prevent further rate limiting")
                                    break
                                
                                # Add delay between attempts to avoid rate limits (except first attempt)
                                if attempt > 0:
                                    delay = 3  # 3 seconds between attempts
                                    logger.info(f"⏳ Waiting {delay} seconds before next username attempt (to avoid rate limits)...")
                                    time.sleep(delay)
                                
                                try:
                                    username_variant = username_variant.replace('@', '').lower().strip()
                                    
                                    # Telegram usernames must be 5-32 chars, alphanumeric + underscores only
                                    # Remove any invalid characters
                                    import re
                                    username_variant = re.sub(r'[^a-z0-9_]', '', username_variant)
                                    
                                    if len(username_variant) < 5:
                                        logger.warning(f"Username @{username_variant} too short (min 5 chars) after cleaning, skipping...")
                                        continue
                                    if len(username_variant) > 32:
                                        username_variant = username_variant[:32]
                                        logger.info(f"Truncated username to 32 chars: @{username_variant}")
                                    
                                    # Validate: must start with letter
                                    if not username_variant[0].isalpha():
                                        logger.warning(f"Username @{username_variant} must start with a letter, skipping...")
                                        continue
                                    
                                    logger.info(f"Making channel public and setting username (attempt {attempt + 1}/{len(username_variations)}): @{username_variant}")
                                    
                                    # Use UpdateChannelUsernameRequest directly to make channel public
                                    # First check if username is available, then set it
                                    async def set_channel_username():
                                        # IMPORTANT: Use created_channel_id (channel), NOT created_group_chat_id (group)
                                        entity = await dev_client.client.get_entity(created_channel_id)
                                        from telethon.tl.functions.channels import UpdateUsernameRequest
                                        from telethon.errors import UsernameOccupiedError, UsernameInvalidError, UsernameNotModifiedError, FloodWaitError
                                        
                                        try:
                                            # Use UpdateUsernameRequest to set username (makes channel public)
                                            # EditChannelRequest was removed from modern Telethon
                                            logger.info(f"Setting CHANNEL username to @{username_variant} (channel ID: {created_channel_id}, this will make channel public)...")
                                            
                                            try:
                                                # UpdateUsernameRequest makes channel public and sets username
                                                await dev_client.client(UpdateUsernameRequest(
                                                    channel=entity,
                                                    username=username_variant
                                                ))
                                                logger.info(f"✅ Channel made public with username: @{username_variant}")
                                                return {'success': True}
                                            except FloodWaitError as e:
                                                wait_time = e.seconds
                                                logger.error(f"❌ RATE LIMITED: Need to wait {wait_time} seconds ({wait_time/60:.1f} minutes) before setting username")
                                                logger.error(f"   This is a Telegram rate limit - username changes are limited to prevent abuse")
                                                logger.error(f"   STOPPING all further username attempts to prevent further rate limiting")
                                                logger.error(f"   Channel was created successfully, but username will need to be set manually later")
                                                logger.error(f"   Channel ID: {created_channel_id}")
                                                logger.error(f"   You can set the username manually via Telegram or wait {wait_time} seconds and try again")
                                                # CRITICAL: Return rate limit flag so we stop trying more variations
                                                return {'success': False, 'error': f'Rate limited: wait {wait_time} seconds', 'rate_limit': wait_time, 'stop_trying': True}
                                            except UsernameOccupiedError as e:
                                                logger.warning(f"Username @{username_variant} is occupied/taken: {e}")
                                                return {'success': False, 'error': f'Username @{username_variant} is occupied'}
                                            except UsernameInvalidError as e:
                                                logger.warning(f"Username @{username_variant} is invalid: {e}")
                                                return {'success': False, 'error': f'Username @{username_variant} is invalid: {e}'}
                                            except UsernameNotModifiedError:
                                                # Username is already set to this value (success!)
                                                logger.info(f"Username @{username_variant} is already set (channel is public)")
                                                return {'success': True}
                                            except Exception as e:
                                                error_str = str(e)
                                                error_type = type(e).__name__
                                                error_lower = error_str.lower()
                                                
                                                # Check for ChannelsAdminPublicTooMuchError
                                                from telethon.errors import ChannelsAdminPublicTooMuchError
                                                if isinstance(e, ChannelsAdminPublicTooMuchError) or 'ChannelsAdminPublicTooMuchError' in error_type or 'too many public channels' in error_lower:
                                                    logger.warning(f"⚠️ Channel limit reached: Account is admin of too many public channels")
                                                    logger.warning(f"   This is a Telegram limit - accounts can only be admin of a limited number of public channels")
                                                    logger.warning(f"   Channel was created successfully, but username cannot be set due to this limit")
                                                    logger.warning(f"   Channel ID: {created_channel_id}")
                                                    logger.warning(f"   Account: {dev_phone}")
                                                    logger.warning(f"   SOLUTION: Make some existing channels private, or use a different account")
                                                    logger.warning(f"   The channel is still usable - you can set the username manually later")
                                                    # This is a permanent limit, not a temporary rate limit
                                                    return {'success': False, 'error': 'Too many public channels (make some private)', 'channel_limit': True}
                                                
                                                # Check for common "not available" errors
                                                if any(keyword in error_lower for keyword in ['taken', 'occupied', 'unavailable', 'already', 'not available']):
                                                    logger.warning(f"Username @{username_variant} is not available: {error_str}")
                                                    return {'success': False, 'error': f'Username @{username_variant} is not available: {error_str}'}
                                                else:
                                                    # Other error (might be rate limit, permissions, etc.)
                                                    logger.error(f"Unexpected error setting username @{username_variant}: {error_str}")
                                                    import traceback
                                                    logger.error(traceback.format_exc())
                                                    return {'success': False, 'error': error_str}
                                        except Exception as e:
                                            error_str = str(e)
                                            logger.error(f"❌ Failed to set username @{username_variant}: {error_str}")
                                            import traceback
                                            logger.error(traceback.format_exc())
                                            return {'success': False, 'error': error_str}
                                    
                                    logger.info(f"Calling set_channel_username() for @{username_variant}...")
                                    username_result = asyncio.run_coroutine_threadsafe(set_channel_username(), loop).result(timeout=60)  # Increased timeout
                                    
                                    logger.info(f"Username result: {username_result}")
                                    
                                    if username_result.get('success'):
                                        logger.info(f"✅ Channel username set to: @{username_variant}")
                                        final_channel_username = username_variant
                                        channel_result['username'] = username_variant
                                        break  # Success, stop trying
                                    else:
                                        error_msg = username_result.get('error', 'Unknown error')
                                        rate_limit = username_result.get('rate_limit')
                                        stop_trying = username_result.get('stop_trying', False)
                                        
                                        logger.warning(f"❌ Username setting failed for @{username_variant}")
                                        logger.warning(f"   Error: {error_msg}")
                                        
                                        # CRITICAL: Stop immediately if rate limited
                                        if stop_trying or rate_limit:
                                            rate_limited = True
                                            logger.error(f"❌ RATE LIMITED - Stopping all username attempts immediately")
                                            logger.error(f"   Channel created successfully but username not set")
                                            logger.error(f"   Channel ID: {created_channel_id}")
                                            break  # Stop trying more variations
                                        
                                        # Check for channel limit (too many public channels)
                                        channel_limit = username_result.get('channel_limit')
                                        if channel_limit:
                                            logger.warning(f"⚠️ CHANNEL LIMIT: Account is admin of too many public channels")
                                            logger.warning(f"   Channel was created successfully, but username cannot be set")
                                            logger.warning(f"   Channel ID: {created_channel_id}")
                                            logger.warning(f"   Account: {dev_phone}")
                                            logger.warning(f"   SOLUTION: Make some existing channels private, or use a different account")
                                            logger.warning(f"   The channel is still usable - you can set the username manually later")
                                            break  # Stop trying - this is a permanent limit
                                        
                                        # Rate limit already handled above with break - continue to next variation if not rate limited
                                        
                                        logger.warning(f"Username @{username_variant} failed: {error_msg}")
                                        # Check if error indicates username is taken
                                        error_lower = error_msg.lower()
                                        if any(keyword in error_lower for keyword in ['taken', 'already', 'unavailable', 'occupied', 'not available']):
                                            logger.info(f"Username @{username_variant} is taken/unavailable, trying next variation...")
                                            continue  # Try next variation
                                        else:
                                            # Log the error but try next anyway (might be rate limit or other issue)
                                            logger.warning(f"Username error (not 'taken'): {error_msg} - will try next variation")
                                            continue
                                except Exception as e:
                                    error_str = str(e)
                                    logger.error(f"❌ Exception setting username @{username_variant}: {error_str}")
                                    import traceback
                                    logger.error(traceback.format_exc())
                                    # Continue to next variation unless this is the last one
                                    if attempt < len(username_variations) - 1:
                                        logger.info(f"Trying next username variation...")
                                        continue
                            
                            if not final_channel_username:
                                logger.warning(f"⚠️ Could not set username for channel (this is OK - channel was created successfully)")
                                logger.warning(f"   Channel ID: {created_channel_id}")
                                logger.warning(f"   Token: {token_name} ({token_symbol})")
                                logger.warning(f"   Tried variations: {', '.join([f'@{v}' for v in username_variations])}")
                                logger.warning(f"   Reason: Likely rate-limited by Telegram (username changes are limited)")
                                logger.warning(f"   You can set the username manually later via Telegram app")
                            else:
                                logger.info(f"✅ Successfully set channel username: @{final_channel_username}")
                                logger.info(f"   Channel is now public: https://t.me/{final_channel_username}")
                            
                            # Add delay after username setting
                            logger.info(f"⏳ Waiting 2 seconds before next step...")
                            time.sleep(2)
                        
                        logger.info(f"   - Channel creation result: {channel_result}")
                        
                        if channel_result.get('success'):
                            created_channel_chat_id = channel_result.get('chat_id')
                            channel_username_from_result = channel_result.get('username')
                            
                            # Verify what type of entity was actually created
                            try:
                                async def verify_channel_entity_type():
                                    entity = await dev_client.client.get_entity(created_channel_chat_id)
                                    is_channel_entity = hasattr(entity, 'broadcast') and entity.broadcast
                                    entity_type = 'CHANNEL' if is_channel_entity else 'GROUP'
                                    logger.info(f"✅ Verified channel entity type: {entity_type} (ID: {created_channel_chat_id})")
                                    if entity_type != 'CHANNEL':
                                        logger.error(f"❌ ERROR: Created a GROUP but we expected a CHANNEL!")
                                    return entity_type
                                entity_type = asyncio.run_coroutine_threadsafe(verify_channel_entity_type(), loop).result(timeout=10)
                            except Exception as e:
                                logger.warning(f"Could not verify channel entity type: {e}")
                            
                            logger.info(f"✅ Created channel via Telethon: (ID: {created_channel_chat_id})")
                            
                            # Photo and username are already set above, just log final status
                            logger.info(f"✅ Final channel: {group_title} (ID: {created_channel_chat_id})")
                            if channel_username_from_result:
                                logger.info(f"   - Channel username: @{channel_username_from_result}")
                            else:
                                logger.warning(f"   - Channel username: NOT SET")
                            
                            # Configure channel settings if provided (additional settings beyond branding)
                            if group_settings:
                                logger.info("Configuring additional channel settings...")
                                settings_result = dev_client.configure_group_settings(created_channel_chat_id, group_settings)
                                if settings_result.get('success'):
                                    logger.info("✅ Additional channel settings configured")
                            
                            # Update chat_ids to include channel
                            chat_ids = [str(created_group_chat_id), str(created_channel_chat_id)]
                            logger.info(f"Using created group and channel: {created_group_chat_id}, {created_channel_chat_id}")
                        else:
                            error_msg = channel_result.get('error', 'Unknown error')
                            logger.error(f"❌ Failed to create channel: {error_msg}")
                            logger.error(f"Channel creation result: {channel_result}")
                    except Exception as e:
                        logger.error(f"❌ Exception while creating channel: {e}")
                        import traceback
                        logger.error(traceback.format_exc())
                
                # Create portal if requested (using interactive flow)
                # Use created IDs if available, otherwise try existing IDs from config
                portal_group_id = created_group_chat_id or existing_group_chat_id
                portal_channel_id = created_channel_chat_id or existing_channel_chat_id
                
                # Track if portal was successfully created to prevent duplicate runs
                portal_created_successfully = False
                
                # Portal setup only requires group and channel IDs (token_address is optional)
                if create_portal and portal_group_id and portal_channel_id:
                    logger.info(f"\n{'='*60}")
                    logger.info(f"CREATING SAFEGUARD PORTAL (INTERACTIVE FLOW)")
                    logger.info(f"{'='*60}")
                    
                    try:
                        logger.info(f"Starting interactive portal setup flow...")
                        if token_address:
                            logger.info(f"  - Token address: {token_address}")
                        else:
                            logger.info(f"  - Token address: (not set - portal setup doesn't require it)")
                        logger.info(f"  - Group ID: {portal_group_id} {'(newly created)' if created_group_chat_id else '(existing)'}")
                        logger.info(f"  - Channel ID: {portal_channel_id} {'(newly created)' if created_channel_chat_id else '(existing)'}")
                        
                        # Find creator account for portal setup - use phone from config_data or fallback
                        CREATOR_PHONE = config_data.get('telegram_phone') or '+13124733150'
                        portal_dev_client = None
                        
                        # First try to find by specific phone number (from config_data)
                        for client in clients:
                            if getattr(client, 'phone', None) == CREATOR_PHONE:
                                # Use the client if found, even if not in users config (for group creator mode)
                                portal_dev_client = client
                                logger.info(f"Found creator account for portal by phone: {CREATOR_PHONE}")
                                break
                        
                        # Fallback: find dev account (role='dev') in users config
                        if not portal_dev_client:
                            for phone, user_config in config_data.get('users', {}).items():
                                if user_config.get('role') == 'dev' and user_config.get('enabled', False):
                                    for client in clients:
                                        if getattr(client, 'phone', None) == phone:
                                            portal_dev_client = client
                                            logger.info(f"Found creator account for portal by role='dev': {phone}")
                                            break
                                    if portal_dev_client:
                                        break
                        
                        # Final fallback: use first client if only one exists (group creator mode)
                        if not portal_dev_client and len(clients) == 1:
                            portal_dev_client = clients[0]
                            logger.info(f"Using single available client for portal: {getattr(portal_dev_client, 'phone', 'unknown')}")
                        
                        if not portal_dev_client:
                            logger.error("No creator account found for portal setup")
                            logger.warning("⚠️ Portal setup skipped - continuing without portal")
                        else:
                            portal_result = portal_dev_client.setup_safeguard_portal_interactive(
                                group_chat_id=str(portal_group_id),
                                channel_chat_id=str(portal_channel_id),
                                safeguard_bot_username=safeguard_bot_username
                            )
                            
                            if portal_result.get('success'):
                                logger.info(f"✅ Portal setup completed successfully")
                                logger.info(f"Safeguard bot response: {portal_result.get('response', 'No response')}")
                                portal_created_successfully = True
                            else:
                                error_msg = portal_result.get('error', 'Unknown error')
                                logger.warning(f"⚠️ Failed to create portal: {error_msg}")
                                logger.warning(f"   Group and channel were created successfully, but portal setup failed.")
                                logger.warning(f"   You can manually set up the portal later via @safeguard bot.")
                                logger.warning(f"   Group ID: {portal_group_id}, Channel ID: {portal_channel_id}")
                    except Exception as e:
                        logger.error(f"Error creating portal: {e}")
                        import traceback
                        logger.error(traceback.format_exc())
                        logger.warning("⚠️ Portal setup failed, but group/channel creation succeeded. Continuing...")
                elif create_portal:
                    logger.warning(f"⚠️ Cannot create portal: Missing group_chat_id or channel_chat_id")
                    logger.warning(f"   Created Group ID: {created_group_chat_id}")
                    logger.warning(f"   Created Channel ID: {created_channel_chat_id}")
                    logger.warning(f"   Existing Group ID: {existing_group_chat_id}")
                    logger.warning(f"   Existing Channel ID: {existing_channel_chat_id}")
                    logger.warning(f"   Token address: {token_address}")
                
                # Note: Group/channel creation already succeeded at this point
                # Filter script will be sent after portal setup (if any) or before final result
            except Exception as e:
                logger.error(f"Error creating group: {e}")
                import traceback
                logger.error(traceback.format_exc())
                return False
        
        # Handle portal setup (after group/channel creation OR with existing IDs)
        # Note: token_address is NOT required for portal setup (only needed for buy bot later)
        # Skip if portal was already created successfully above
        if create_portal and not portal_created_successfully:
            # Use created IDs if available, otherwise use existing IDs
            portal_group_id = created_group_chat_id or existing_group_chat_id
            portal_channel_id = created_channel_chat_id or existing_channel_chat_id
            
            if portal_group_id and portal_channel_id:
                logger.info(f"\n{'='*60}")
                logger.info(f"CREATING SAFEGUARD PORTAL")
                logger.info(f"{'='*60}")
                
                try:
                    logger.info(f"Starting interactive portal setup flow...")
                    if token_address:
                        logger.info(f"  - Token address: {token_address}")
                    else:
                        logger.info(f"  - Token address: (not set - portal setup doesn't require it)")
                    logger.info(f"  - Group ID: {portal_group_id}")
                    logger.info(f"  - Channel ID: {portal_channel_id}")
                    
                    # Find creator account for portal setup - use phone from config_data or fallback
                    CREATOR_PHONE = config_data.get('telegram_phone') or '+13124733150'
                    portal_dev_client = None
                    
                    # First try to find by specific phone number (from config_data)
                    for client in clients:
                        if getattr(client, 'phone', None) == CREATOR_PHONE:
                            # Use the client if found, even if not in users config (for group creator mode)
                            portal_dev_client = client
                            logger.info(f"Found creator account for portal by phone: {CREATOR_PHONE}")
                            break
                    
                    # Fallback: find dev account (role='dev') in users config
                    if not portal_dev_client:
                        for phone, user_config in config_data.get('users', {}).items():
                            if user_config.get('role') == 'dev' and user_config.get('enabled', False):
                                for client in clients:
                                    if getattr(client, 'phone', None) == phone:
                                        portal_dev_client = client
                                        logger.info(f"Found creator account for portal by role='dev': {phone}")
                                        break
                                if portal_dev_client:
                                    break
                    
                    # Final fallback: use first client if only one exists (group creator mode)
                    if not portal_dev_client and len(clients) == 1:
                        portal_dev_client = clients[0]
                        logger.info(f"Using single available client for portal: {getattr(portal_dev_client, 'phone', 'unknown')}")
                    
                    if not portal_dev_client:
                        logger.error("No creator account found for portal setup")
                        logger.error(f"Available clients: {[getattr(c, 'phone', 'unknown') for c in clients]}")
                        return False
                    
                    portal_result = portal_dev_client.setup_safeguard_portal_interactive(
                        group_chat_id=str(portal_group_id),
                        channel_chat_id=str(portal_channel_id),
                        safeguard_bot_username=safeguard_bot_username
                    )
                    
                    if portal_result.get('success'):
                        logger.info(f"✅ Portal setup completed successfully")
                        logger.info(f"Safeguard bot response: {portal_result.get('response', 'No response')}")
                    else:
                        error_msg = portal_result.get('error', 'Unknown error')
                        logger.warning(f"⚠️ Failed to create portal: {error_msg}")
                        logger.warning(f"   This usually means:")
                        logger.warning(f"   1. The account ({portal_dev_client.phone}) is not a member/admin of the group/channel")
                        logger.warning(f"   2. The group/channel is not visible in Safeguard bot's menu")
                        logger.warning(f"   SOLUTION: Create NEW groups/channels (they will automatically work)")
                except Exception as e:
                    logger.error(f"Error creating portal: {e}")
                    import traceback
                    logger.error(traceback.format_exc())
            else:
                logger.warning(f"⚠️ Cannot create portal: Missing existing group_chat_id or channel_chat_id")
                logger.warning(f"   Existing Group ID: {existing_group_chat_id}")
                logger.warning(f"   Existing Channel ID: {existing_channel_chat_id}")
                logger.warning(f"   Token address: {token_address}")
        
        # Setup Safeguard buy bot (if requested)
        setup_buy_bot = config_data.get('setup_buy_bot', False) or False
        buy_bot_token_address = config_data.get('buy_bot_token_address') or token_address
        buy_bot_chain = config_data.get('buy_bot_chain', 'base') or 'base'
        safeguard_bot_username = config_data.get('safeguard_bot_username', '@safeguard') or '@safeguard'
        
        if setup_buy_bot and buy_bot_token_address:
            # Use created group ID if available, otherwise use existing
            buy_bot_group_id = created_group_chat_id or existing_group_chat_id
            
            if buy_bot_group_id:
                logger.info(f"\n{'='*60}")
                logger.info(f"SETTING UP SAFEGUARD BUY BOT")
                logger.info(f"{'='*60}")
                logger.info(f"Group ID: {buy_bot_group_id}")
                logger.info(f"Token Address: {buy_bot_token_address}")
                logger.info(f"Chain: {buy_bot_chain}")
                logger.info(f"Safeguard Bot: {safeguard_bot_username}")
                
                try:
                    # Find the dev client (same as portal setup)
                    buy_bot_dev_client = None
                    
                    # First try to find by specific phone number (from config_data)
                    for client in clients:
                        if getattr(client, 'phone', None) == CREATOR_PHONE:
                            buy_bot_dev_client = client
                            logger.info(f"Found creator account for buy bot by phone: {CREATOR_PHONE}")
                            break
                    
                    # Fallback: find dev account (role='dev') in users config
                    if not buy_bot_dev_client:
                        for phone, user_config in config_data.get('users', {}).items():
                            if user_config.get('role') == 'dev' and user_config.get('enabled', False):
                                for client in clients:
                                    if getattr(client, 'phone', None) == phone:
                                        buy_bot_dev_client = client
                                        logger.info(f"Found creator account for buy bot by role='dev': {phone}")
                                        break
                                if buy_bot_dev_client:
                                    break
                    
                    # Final fallback: use first client if only one exists (group creator mode)
                    if not buy_bot_dev_client and len(clients) == 1:
                        buy_bot_dev_client = clients[0]
                        logger.info(f"Using single available client for buy bot: {getattr(buy_bot_dev_client, 'phone', 'unknown')}")
                    
                    if not buy_bot_dev_client:
                        logger.error("No creator account found for buy bot setup")
                        logger.error(f"Available clients: {[getattr(c, 'phone', 'unknown') for c in clients]}")
                    else:
                        # Call the buy bot setup function (same pattern as portal setup)
                        buy_bot_result = asyncio.run_coroutine_threadsafe(
                            buy_bot_dev_client.setup_safeguard_buy_bot_interactive_async(
                                group_chat_id=str(buy_bot_group_id),
                                token_address=buy_bot_token_address,
                                chain=buy_bot_chain,
                                safeguard_bot_username=safeguard_bot_username
                            ),
                            loop
                        ).result(timeout=120)  # 2 minute timeout for buy bot setup
                        
                        if buy_bot_result.get('success'):
                            logger.info(f"✅ Buy bot setup completed successfully")
                            logger.info(f"Safeguard bot response: {buy_bot_result.get('response', 'No response')}")
                        else:
                            error_msg = buy_bot_result.get('error', 'Unknown error')
                            logger.warning(f"⚠️ Failed to set up buy bot: {error_msg}")
                            logger.warning(f"   This usually means:")
                            logger.warning(f"   1. The account ({buy_bot_dev_client.phone}) is not a member/admin of the group")
                            logger.warning(f"   2. The Safeguard bot is not responding correctly")
                            logger.warning(f"   3. The token address or chain is incorrect")
                            
                except Exception as e:
                    logger.error(f"Error setting up buy bot: {e}")
                    import traceback
                    logger.error(traceback.format_exc())
            else:
                logger.warning(f"⚠️ Cannot set up buy bot: Missing existing group_chat_id")
                logger.warning(f"   Created Group ID: {created_group_chat_id}")
                logger.warning(f"   Existing Group ID: {existing_group_chat_id}")
                logger.warning(f"   Token address: {buy_bot_token_address}")
        
        logger.info(f"{'='*60}\n")
        
        # Output created chat IDs for group creator node (if no conversations)
        # IMPORTANT: If no conversations, return early - don't start conversations
        if len(scripted_conversations) == 0:
            # This is a group creator only run (no conversations)
            # Output the chat IDs and telegram link so frontend can use them
            import json
            
            # Get telegram link (prefer channel if both exist, otherwise use group)
            telegram_link = None
            if created_channel_chat_id:
                # Try to get channel username/link
                try:
                    async def get_channel_link():
                        entity = await dev_client.client.get_entity(created_channel_chat_id)
                        if hasattr(entity, 'username') and entity.username:
                            return f"https://t.me/{entity.username}"
                        # Try export invite link
                        try:
                            # Try channels module first
                            from telethon.tl.functions.channels import ExportInviteRequest
                            invite_link = await dev_client.client(ExportInviteRequest(entity))
                            return invite_link.link
                        except:
                            try:
                                # Fallback to messages module
                                from telethon.tl.functions.messages import ExportChatInviteLinkRequest
                                invite_link = await dev_client.client(ExportChatInviteLinkRequest(entity))
                                return invite_link.link
                            except:
                                return None
                    telegram_link = asyncio.run_coroutine_threadsafe(get_channel_link(), loop).result(timeout=10)
                except Exception as e:
                    logger.warning(f"Could not get channel link: {e}")
            
            if not telegram_link and created_group_chat_id:
                # Try to get group invite link
                try:
                    async def get_group_link():
                        entity = await dev_client.client.get_entity(created_group_chat_id)
                        try:
                            # Try channels module first
                            from telethon.tl.functions.channels import ExportInviteRequest
                            invite_link = await dev_client.client(ExportInviteRequest(entity))
                            return invite_link.link
                        except:
                            try:
                                # Fallback to messages module
                                from telethon.tl.functions.messages import ExportChatInviteLinkRequest
                                invite_link = await dev_client.client(ExportChatInviteLinkRequest(entity))
                                return invite_link.link
                            except:
                                return None
                    telegram_link = asyncio.run_coroutine_threadsafe(get_group_link(), loop).result(timeout=10)
                except Exception as e:
                    logger.warning(f"Could not get group link: {e}")
            
            # Send filter script commands after group/channel creation (if not already sent)
            if filter_script and (created_group_chat_id or created_channel_chat_id) and dev_client:
                logger.info(f"\n{'='*60}")
                logger.info(f"SENDING FILTER COMMANDS")
                logger.info(f"{'='*60}")
                
                try:
                    # Parse and replace placeholders in filter script
                    filter_commands = filter_script.strip().split('\n')
                    
                    # Replace placeholders with actual values
                    replacements = {
                        '{contract_address}': token_address or '',
                        '{CA}': token_address or '',
                        '{website}': config_data.get('website', '') or '',
                        '{twitter}': config_data.get('twitter', '') or '',
                        '{X}': config_data.get('twitter', '') or '',
                        '{token_name}': token_name or '',
                        '{token_symbol}': token_symbol or '',
                        '{telegram}': config_data.get('telegram', '') or '',
                        '{description}': config_data.get('description', '') or '',
                    }
                    
                    processed_commands = []
                    for cmd in filter_commands:
                        if cmd.strip():
                            processed_cmd = cmd
                            # Track if any placeholder was replaced with a non-empty value
                            has_required_value = False
                            
                            # Check if this command requires specific placeholders
                            # Extract placeholder names from the command
                            import re
                            placeholders_in_cmd = re.findall(r'\{([^}]+)\}', processed_cmd)
                            
                            # Replace placeholders
                            for placeholder, value in replacements.items():
                                placeholder_key = placeholder.replace('{', '').replace('}', '')
                                if placeholder in processed_cmd:
                                    if value and value.strip():
                                        processed_cmd = processed_cmd.replace(placeholder, value)
                                        has_required_value = True
                                    else:
                                        # Placeholder exists but value is empty - skip this command
                                        logger.info(f"⏭️ Skipping filter command (missing value for {placeholder}): {cmd.strip()}")
                                        processed_cmd = None
                                        break
                            
                            # Only add if command was processed and has required values
                            if processed_cmd and processed_cmd.strip():
                                # Double-check: if command still has unreplaced placeholders, skip it
                                if '{' in processed_cmd and '}' in processed_cmd:
                                    remaining_placeholders = re.findall(r'\{([^}]+)\}', processed_cmd)
                                    if remaining_placeholders:
                                        logger.info(f"⏭️ Skipping filter command (missing values for {remaining_placeholders}): {cmd.strip()}")
                                        continue
                                processed_commands.append(processed_cmd.strip())
                    
                    logger.info(f"Processed {len(processed_commands)} filter commands (skipped empty placeholders)")
                    
                    if not processed_commands:
                        logger.info("ℹ️ No filter commands to send (all were skipped due to missing values)")
                    else:
                        # Send commands ONLY to group (if created) - NOT to channel
                        if created_group_chat_id:
                            async def send_filter_commands():
                                await dev_client._ensure_connected()
                                for idx, cmd in enumerate(processed_commands, 1):
                                    if cmd:
                                        try:
                                            logger.info(f"📤 Sending filter command {idx}/{len(processed_commands)} to GROUP: {cmd[:50]}...")
                                            await dev_client.send_message_async(
                                                text=cmd,
                                                chat_id=str(created_group_chat_id)
                                            )
                                            logger.info(f"✅ Sent filter command {idx}/{len(processed_commands)} to GROUP: {cmd[:50]}...")
                                            # Wait 1 second between commands to ensure order and avoid rate limits
                                            if idx < len(processed_commands):
                                                await asyncio.sleep(1)
                                        except Exception as e:
                                            logger.warning(f"⚠️ Failed to send filter command {idx} '{cmd[:30]}...': {e}")
                            
                            try:
                                asyncio.run_coroutine_threadsafe(send_filter_commands(), loop).result(timeout=60)
                                logger.info(f"✅ All {len(processed_commands)} filter commands sent to GROUP successfully (in order)")
                            except Exception as e:
                                logger.warning(f"⚠️ Failed to send filter commands to group: {e}")
                        else:
                            logger.warning("⚠️ No group chat ID available - filter commands can only be sent to groups, not channels")
                    
                except Exception as e:
                    logger.error(f"❌ Error processing filter script: {e}")
                    import traceback
                    logger.error(traceback.format_exc())
                    logger.warning("⚠️ Filter commands failed, but group/channel creation succeeded")
            
            output_data = {
                'success': True,
                'group_chat_id': str(created_group_chat_id) if created_group_chat_id else None,
                'channel_chat_id': str(created_channel_chat_id) if created_channel_chat_id else None,
                'telegram_link': telegram_link,  # Set telegram link in RunConfig
                'portal_created': create_portal and (created_group_chat_id or created_channel_chat_id)
            }
            print(f"\n{'='*60}")
            print("GROUP_CREATOR_RESULT:")
            print(json.dumps(output_data))
            print(f"{'='*60}\n")
            return True
    
    # If we created/reused groups but have no conversations, don't start conversations
    # This check happens BEFORE creating TelegramCampaign to prevent conversations from starting
    if (create_group or reuse_existing) and (not scripted_conversations or len(scripted_conversations) == 0):
        logger.info("Group/channel created/reused successfully. No conversations to run.")
        return True
    
    # Auto-join participants to the GROUP (not channel) before starting conversations
    # This makes it look like they joined right after contract verification
    # Works for both created groups AND existing groups (from Telegram Chatter node)
    # CRITICAL: Only use GROUP chat ID, NOT channel chat ID
    # Priority: created_group_chat_id (from Telegram Group Creator) > first chat_id from chat_ids (existing group)
    # Filter out channel chat IDs - only use group chat IDs (group IDs are negative, channels can be positive or negative)
    
    logger.info(f"\n{'='*60}")
    logger.info(f"GROUP ID SELECTION FOR AUTO-JOIN")
    logger.info(f"{'='*60}")
    logger.info(f"created_group_chat_id: {created_group_chat_id}")
    logger.info(f"chat_ids from config: {chat_ids}")
    logger.info(f"chat_ids type: {type(chat_ids)}, length: {len(chat_ids) if chat_ids else 0}")
    
    # CRITICAL: For Telegram Chatter, chat_ids[0] should be the group ID from RunConfig
    # It should already be normalized with -100 prefix (e.g., -1003336913786)
    # Priority: created_group_chat_id (if group was just created) > chat_ids[0] (from Telegram Chatter)
    group_chat_id_for_autojoin = created_group_chat_id
    
    # If no created_group_chat_id, use first chat_id from chat_ids (this is from Telegram Chatter)
    if not group_chat_id_for_autojoin and chat_ids:
        # Telegram Chatter sends the normalized group ID as chat_ids[0]
        group_chat_id_for_autojoin = chat_ids[0]
        logger.info(f"  Using chat_ids[0] for auto-join: {group_chat_id_for_autojoin}")
    
    logger.info(f"Initial group_chat_id_for_autojoin: {group_chat_id_for_autojoin}")
    
    # Ensure we're using GROUP, not channel
    # Group chat IDs are typically negative (e.g., -1003314170950)
    # If we have both group and channel, prefer group
    if not group_chat_id_for_autojoin and chat_ids and len(chat_ids) > 0:
        logger.info(f"  No group_chat_id_for_autojoin yet, searching chat_ids for negative IDs...")
        # Find group chat ID (negative ID) if available
        for chat_id in chat_ids:
            try:
                chat_id_int = int(chat_id)
                logger.info(f"  Checking chat_id: {chat_id} (int: {chat_id_int})")
                # Group IDs are typically negative (supergroups start with -100)
                if chat_id_int < 0:
                    group_chat_id_for_autojoin = chat_id
                    logger.info(f"  ✅ Selected GROUP chat ID for auto-join: {group_chat_id_for_autojoin} (from chat_ids)")
                    break
            except (ValueError, TypeError) as e:
                logger.warning(f"  ⚠️ Could not parse chat_id {chat_id}: {e}")
    
    logger.info(f"Final group_chat_id_for_autojoin: {group_chat_id_for_autojoin}")
    logger.info(f"Has scripted_conversations: {bool(scripted_conversations)}, count: {len(scripted_conversations) if scripted_conversations else 0}")
    if scripted_conversations:
        logger.info(f"First conversation participants: {scripted_conversations[0].get('participants', []) if len(scripted_conversations) > 0 else 'N/A'}")
    logger.info(f"{'='*60}\n")
    
    # CRITICAL: Check for length > 0, not just truthiness (empty list [] is falsy but we still want to check)
    # Auto-join should run if we have a group ID AND conversations (even if conversations are loaded from file)
    has_conversations = scripted_conversations and len(scripted_conversations) > 0
    logger.info(f"🔍 Auto-join condition check:")
    logger.info(f"   group_chat_id_for_autojoin: {group_chat_id_for_autojoin}")
    logger.info(f"   has_conversations: {has_conversations}")
    logger.info(f"   Will run auto-join: {bool(group_chat_id_for_autojoin and has_conversations)}")
    
    if group_chat_id_for_autojoin and has_conversations:
        logger.info(f"\n{'='*60}")
        logger.info(f"AUTO-JOINING PARTICIPANTS TO GROUP")
        logger.info(f"{'='*60}")
        logger.info(f"Group ID: {group_chat_id_for_autojoin}")
        logger.info(f"Group source: {'Created by Telegram Group Creator' if created_group_chat_id else 'Existing group from Telegram Chatter'}")
        
        # Extract participant roles from scripted conversations
        # Only join users that are actually participants in the conversations (mod, user1, user2, etc.)
        participant_roles = set()
        for conv in scripted_conversations:
            participants = conv.get('participants', [])
            for participant in participants:
                if isinstance(participant, dict):
                    role = participant.get('role')
                    if role:
                        participant_roles.add(role)
                elif isinstance(participant, str):
                    participant_roles.add(participant)
        
        logger.info(f"Participant roles found in conversations: {sorted(participant_roles)}")
        
        # Find creator account phone to exclude from auto-join (they're already in the group)
        CREATOR_PHONE = '+13124733150'
        creator_phone = None
        for client in clients:
            if getattr(client, 'phone', None) == CREATOR_PHONE:
                creator_phone = CREATOR_PHONE
                break
        
        # Filter participants: Only join clients whose role matches conversation participants
        # AND exclude creator account (they're already in the group)
        # CRITICAL: Always include users with is_mod=True, even if their role isn't in conversations
        participants_to_join = []
        for client in clients:
            phone = getattr(client, 'phone', None)
            if phone == creator_phone:
                continue  # Skip creator
            
            # Get this client's role from user_roles dict
            client_role = user_roles.get(phone, '')
            is_mod_user = user_is_mod.get(phone, False)
            
            # Join if:
            # 1. Their role is in the conversation participants, OR
            # 2. They have is_mod=True (mods should always join, regardless of role)
            should_join = (client_role in participant_roles) or is_mod_user
            
            if should_join:
                participants_to_join.append(client)
                join_reason = "mod user" if is_mod_user else f"role: {client_role}"
                logger.info(f"  ✅ Will join: {phone} ({join_reason})")
            else:
                logger.info(f"  ⏭️ Skipping: {phone} (role: {client_role}, not in conversations and not mod)")
        
        logger.info(f"Participants to join: {len(participants_to_join)} accounts (roles: {sorted(participant_roles)}, excluding creator {creator_phone})")
        
        async def promote_mod_user_immediately(mod_client, mod_phone, group_entity, creator_client):
            """Promote a mod user to admin/moderator immediately after they join"""
            try:
                from telethon.tl.types import ChatAdminRights
                from telethon.errors import FloodWaitError
                
                # Create admin rights with ALL privileges EXCEPT anonymous
                # CRITICAL: Include all permissions needed for managing filters (/filters command)
                admin_rights = ChatAdminRights(
                    change_info=True,      # Can change group info
                    post_messages=True,     # Can post messages
                    edit_messages=True,     # Can edit messages
                    delete_messages=True,   # Can delete messages (needed for filters)
                    ban_users=True,         # Can ban users
                    invite_users=True,      # Can invite users
                    pin_messages=True,      # Can pin messages
                    add_admins=False,       # Mods can't add admins
                    anonymous=False,        # NOT anonymous (user will be visible as admin)
                    manage_call=True,       # Can manage calls
                    other=True,            # Other admin rights (includes filter management)
                )
                
                # Get mod user's entity
                mod_user_entity = await mod_client.client.get_me()
                
                # Promote to admin using EditAdminRequest (correct Telegram API)
                from telethon.tl.functions.channels import EditAdminRequest
                logger.info(f"  📤 Promoting {mod_phone} to admin/moderator immediately...")
                try:
                    await creator_client.client(EditAdminRequest(
                        channel=group_entity,
                        user_id=mod_user_entity,
                        admin_rights=admin_rights,
                        rank="Moderator"
                    ))
                    logger.info(f"  ✅ Successfully promoted {mod_phone} to admin/moderator")
                    return True
                except FloodWaitError as flood_error:
                    wait_time = flood_error.seconds
                    logger.warning(f"  ⚠️ RATE LIMITED: Waiting {wait_time} seconds...")
                    await asyncio.sleep(wait_time)
                    await creator_client.client(EditAdminRequest(
                        channel=group_entity,
                        user_id=mod_user_entity,
                        admin_rights=admin_rights,
                        rank="Moderator"
                    ))
                    logger.info(f"  ✅ Successfully promoted {mod_phone} after rate limit wait")
                    return True
            except Exception as e:
                error_str = str(e)
                logger.warning(f"  ⚠️ Failed to promote {mod_phone}: {error_str}")
                import traceback
                logger.warning(traceback.format_exc())
                return False
        
        async def join_participants_to_group():
            """Have all conversation participants join the created group"""
            joined_count = 0
            failed_count = 0
            already_member_count = 0
            
            logger.info(f"🔍 JOIN FUNCTION: Using group_chat_id_for_autojoin = {group_chat_id_for_autojoin}")
            logger.info(f"🔍 JOIN FUNCTION: Type = {type(group_chat_id_for_autojoin)}")
            logger.info(f"🔍 JOIN FUNCTION: Converting to int: {int(group_chat_id_for_autojoin)}")
            
            # CRITICAL: For private groups, we need to use InviteToChannelRequest from creator account
            # join_chat() doesn't work for private groups - users must be invited
            # Find creator account (the one that created the group)
            creator_client = None
            for client in clients:
                if getattr(client, 'phone', None) == creator_phone:
                    creator_client = client
                    break
            
            if not creator_client:
                logger.warning(f"⚠️ Creator account ({creator_phone}) not found in clients - cannot invite users to private group")
                logger.warning("   Users will need to join manually or use invite link")
                return {'joined': 0, 'already_member': 0, 'failed': len(participants_to_join)}
            
            # Get group entity using creator account (has admin rights)
            try:
                group_id_int = int(group_chat_id_for_autojoin)
                logger.info(f"🔍 Attempting to get entity for group ID: {group_id_int}")
                group_entity = await creator_client.client.get_entity(group_id_int)
                logger.info(f"✅ Successfully got group entity: {group_entity}")
                logger.info(f"   Entity ID: {group_entity.id}")
                logger.info(f"   Entity title: {getattr(group_entity, 'title', 'N/A')}")
            except Exception as e:
                logger.error(f"❌ Failed to get group entity for ID {group_chat_id_for_autojoin}: {e}")
                logger.error(f"   Error type: {type(e).__name__}")
                import traceback
                logger.error(traceback.format_exc())
                return {'joined': 0, 'already_member': 0, 'failed': len(participants_to_join)}
            
            # Check if group is private (no username)
            is_private = not hasattr(group_entity, 'username') or not group_entity.username
            
            # CRITICAL: For private groups, use invite links (most reliable method)
            # Direct adds via InviteToChannelRequest don't sync Telethon's entity cache
            # Using invite links ensures users join AND Telethon syncs dialogs properly
            if is_private:
                logger.info(f"🔒 Group is PRIVATE - using invite link method (most reliable for Telethon)")
                from telethon.tl.functions.messages import ExportChatInviteRequest
                try:
                    # Step 1: Export invite link from creator account
                    logger.info(f"  📤 Exporting invite link from creator account...")
                    try:
                        invite_result = await creator_client.client(ExportChatInviteRequest(
                            peer=int(group_chat_id_for_autojoin)
                        ))
                        invite_link = invite_result.link
                        logger.info(f"  ✅ Invite link generated: {invite_link}")
                    except Exception as e:
                        error_str = str(e)
                        logger.error(f"  ❌ Failed to export invite link: {error_str}")
                        logger.error(f"   Error type: {type(e).__name__}")
                        import traceback
                        logger.error(traceback.format_exc())
                        return {'joined': 0, 'already_member': 0, 'failed': len(participants_to_join)}
                    
                    # Step 2: Have each user join via invite link
                    # Extract hash from invite link (format: https://t.me/+HASH)
                    import re
                    invite_hash = None
                    if invite_link.startswith('https://t.me/+'):
                        invite_hash = invite_link.replace('https://t.me/+', '')
                    elif '/+' in invite_link:
                        invite_hash = invite_link.split('/+')[-1]
                    
                    if not invite_hash:
                        logger.error(f"  ❌ Could not extract hash from invite link: {invite_link}")
                        return {'joined': 0, 'already_member': 0, 'failed': len(participants_to_join)}
                    
                    logger.info(f"  📋 Extracted invite hash: {invite_hash}")
                    
                    added_count = 0
                    for client in participants_to_join:
                        phone = getattr(client, 'phone', 'unknown')
                        try:
                            logger.info(f"  📤 Having {phone} join via invite link...")
                            # Use ImportChatInviteRequest for invite links with hash
                            from telethon.tl.functions.messages import ImportChatInviteRequest
                            await client.client(ImportChatInviteRequest(hash=invite_hash))
                            logger.info(f"  ✅ {phone} joined via invite link")
                            
                            # CRITICAL: Force Telethon to sync dialogs so entity is cached
                            logger.info(f"  🔄 Syncing dialogs for {phone}...")
                            await client.client.get_dialogs()
                            await asyncio.sleep(0.5)  # Small delay for sync
                            
                            # Verify user can access the group entity
                            try:
                                entity = await client.client.get_entity(int(group_chat_id_for_autojoin))
                                logger.info(f"  ✅ Verified {phone} can access group (entity cached)")
                                added_count += 1
                                joined_count += 1
                                
                                # CRITICAL: If this user has role='mod' OR role='dev' OR is_mod=True, promote them immediately
                                client_role = user_roles.get(phone, '').lower() if user_roles.get(phone) else ''
                                is_mod_user = user_is_mod.get(phone, False)
                                should_promote = is_mod_user or client_role == 'mod' or client_role == 'dev'
                                if should_promote:
                                    logger.info(f"  🔑 User {phone} is a mod/dev (role: {user_roles.get(phone, 'unknown')}, is_mod: {is_mod_user}) - promoting to moderator immediately...")
                                    try:
                                        # Get group entity using creator account
                                        group_entity = await creator_client.client.get_entity(int(group_chat_id_for_autojoin))
                                        # Promote mod user immediately
                                        await promote_mod_user_immediately(client, phone, group_entity, creator_client)
                                    except Exception as promote_error:
                                        logger.warning(f"  ⚠️ Could not promote {phone} immediately: {promote_error}")
                                        logger.warning(f"     Will retry promotion later")
                                
                            except Exception as verify_error:
                                error_str = str(verify_error)
                                logger.warning(f"  ⚠️ {phone} joined but entity not cached yet: {error_str}")
                                logger.warning(f"     Retrying dialog sync...")
                                # Retry dialog sync
                                await client.client.get_dialogs()
                                await asyncio.sleep(1)
                                try:
                                    entity = await client.client.get_entity(int(group_chat_id_for_autojoin))
                                    logger.info(f"  ✅ Verified {phone} can access group (after retry)")
                                    added_count += 1
                                    joined_count += 1
                                    
                                    # CRITICAL: If this user has role='mod' OR role='dev' OR is_mod=True, promote them immediately
                                    client_role = user_roles.get(phone, '').lower() if user_roles.get(phone) else ''
                                    is_mod_user = user_is_mod.get(phone, False)
                                    should_promote = is_mod_user or client_role == 'mod' or client_role == 'dev'
                                    if should_promote:
                                        logger.info(f"  🔑 User {phone} is a mod/dev (role: {user_roles.get(phone, 'unknown')}, is_mod: {is_mod_user}) - promoting to moderator immediately...")
                                        try:
                                            group_entity = await creator_client.client.get_entity(int(group_chat_id_for_autojoin))
                                            await promote_mod_user_immediately(client, phone, group_entity, creator_client)
                                        except Exception as promote_error:
                                            logger.warning(f"  ⚠️ Could not promote {phone} immediately: {promote_error}")
                                            
                                except:
                                    logger.warning(f"  ⚠️ {phone} still cannot access group entity - may need manual check")
                                    failed_count += 1
                            
                            # Small delay between joins to avoid rate limits
                            await asyncio.sleep(1)
                            
                        except Exception as e:
                            error_str = str(e)
                            # Check if already a member
                            if any(keyword in error_str.lower() for keyword in ['already', 'member', 'participant', 'already a participant', 'already joined', 'already in']):
                                logger.info(f"  ✅ {phone} is already a member of the group")
                                # Still sync dialogs for already-member users
                                try:
                                    await client.client.get_dialogs()
                                    await client.client.get_entity(int(group_chat_id_for_autojoin))
                                    logger.info(f"  ✅ Verified {phone} can access group")
                                except:
                                    pass
                                already_member_count += 1
                                joined_count += 1
                            else:
                                logger.error(f"  ❌ FAILED TO JOIN {phone} to group: {error_str}")
                                logger.error(f"     Error type: {type(e).__name__}")
                                import traceback
                                logger.error(f"     Traceback:\n{traceback.format_exc()}")
                                failed_count += 1
                    
                    logger.info(f"  📊 Join complete: {added_count} added, {already_member_count} already members, {failed_count} failed")
                    
                    # Step 3: Whitelist/unmute accounts in safeguard bot (if safeguard is enabled)
                    if safeguard_bot_username and added_count > 0:
                        logger.info(f"\n{'='*60}")
                        logger.info(f"WHITELISTING ACCOUNTS IN SAFEGUARD BOT")
                        logger.info(f"{'='*60}")
                        
                        # Find creator account to send safeguard commands
                        safeguard_creator_client = None
                        for client in clients:
                            if getattr(client, 'phone', None) == creator_phone:
                                safeguard_creator_client = client
                                break
                        
                        if safeguard_creator_client:
                            # Get user entities for whitelisting
                            whitelisted_count = 0
                            for client in participants_to_join:
                                phone = getattr(client, 'phone', 'unknown')
                                try:
                                    # Get user entity
                                    me = await client.client.get_me()
                                    user_id = me.id
                                    username = getattr(me, 'username', None)
                                    
                                    # Send whitelist command to safeguard bot
                                    # Try multiple command formats (safeguard bot may use different syntax)
                                    whitelist_commands = []
                                    if username:
                                        whitelist_commands.append(f"/whitelist @{username}")
                                        whitelist_commands.append(f"/allowlist @{username}")
                                    whitelist_commands.append(f"/whitelist {user_id}")
                                    whitelist_commands.append(f"/allowlist {user_id}")
                                    
                                    # Also try with group ID context
                                    if group_chat_id_for_autojoin:
                                        if username:
                                            whitelist_commands.append(f"/whitelist {group_chat_id_for_autojoin} @{username}")
                                            whitelist_commands.append(f"/allowlist {group_chat_id_for_autojoin} @{username}")
                                        whitelist_commands.append(f"/whitelist {group_chat_id_for_autojoin} {user_id}")
                                        whitelist_commands.append(f"/allowlist {group_chat_id_for_autojoin} {user_id}")
                                    
                                    logger.info(f"  📤 Whitelisting {phone} (ID: {user_id}) in safeguard bot...")
                                    
                                    whitelisted = False
                                    for whitelist_command in whitelist_commands:
                                        try:
                                            result = await safeguard_creator_client.message_safeguard_bot_async(
                                                command=whitelist_command,
                                                safeguard_bot_username=safeguard_bot_username
                                            )
                                            
                                            if result.get('success'):
                                                logger.info(f"  ✅ Successfully whitelisted {phone} using: {whitelist_command}")
                                                whitelisted = True
                                                whitelisted_count += 1
                                                break
                                        except:
                                            continue  # Try next command format
                                    
                                    if not whitelisted:
                                        logger.warning(f"  ⚠️ Failed to whitelist {phone} - tried {len(whitelist_commands)} command formats")
                                    
                                    # Also try /unmute command as fallback
                                    unmute_commands = []
                                    if username:
                                        unmute_commands.append(f"/unmute @{username}")
                                    unmute_commands.append(f"/unmute {user_id}")
                                    if group_chat_id_for_autojoin:
                                        if username:
                                            unmute_commands.append(f"/unmute {group_chat_id_for_autojoin} @{username}")
                                        unmute_commands.append(f"/unmute {group_chat_id_for_autojoin} {user_id}")
                                    
                                    for unmute_command in unmute_commands[:2]:  # Try first 2 formats
                                        try:
                                            await safeguard_creator_client.message_safeguard_bot_async(
                                                command=unmute_command,
                                                safeguard_bot_username=safeguard_bot_username
                                            )
                                            break  # Stop if one works
                                        except:
                                            continue  # Try next format
                                    
                                    await asyncio.sleep(0.5)  # Small delay between commands
                                    
                                except Exception as e:
                                    logger.warning(f"  ⚠️ Could not whitelist {phone}: {e}")
                            
                            logger.info(f"  📊 Whitelist complete: {whitelisted_count}/{len(participants_to_join)} accounts whitelisted")
                        else:
                            logger.warning(f"  ⚠️ Creator account not found - cannot whitelist accounts in safeguard bot")
                    
                except Exception as e:
                    error_str = str(e)
                    logger.error(f"  ❌ Failed to add users via invite link: {error_str}")
                    logger.error(f"   Error type: {type(e).__name__}")
                    import traceback
                    logger.error(traceback.format_exc())
                    failed_count = len(participants_to_join)
            else:
                logger.info(f"🌐 Group is PUBLIC (has username) - using join_chat() with dialog sync")
                # For public groups: Use join_chat (works for public groups)
                for client in participants_to_join:
                    phone = getattr(client, 'phone', 'unknown')
                    try:
                        # Get the group entity
                        entity = await client.client.get_entity(int(group_chat_id_for_autojoin))

                        # Check if already a member by trying to get full channel info
                        try:
                            from telethon.tl.functions.channels import GetFullChannelRequest
                            if hasattr(entity, 'broadcast') or hasattr(entity, 'megagroup'):
                                # Try to get full channel info - if successful, we're already a member
                                await client.client(GetFullChannelRequest(entity))
                                logger.info(f"  ✅ {phone} is already a member of group {group_chat_id_for_autojoin}")
                                # Sync dialogs to ensure entity is cached
                                await client.client.get_dialogs()
                                already_member_count += 1
                                joined_count += 1
                                continue
                        except Exception:
                            # Not a member or not a channel - try to join
                            pass

                        # Join the group/channel using join_chat (works for public groups)
                        logger.info(f"  Joining {phone} to public group {group_chat_id_for_autojoin}...")
                        await client.client.join_chat(entity)
                        logger.info(f"  ✅ {phone} successfully joined group")
                        
                        # CRITICAL: Force Telethon to sync dialogs so entity is cached
                        await client.client.get_dialogs()
                        await asyncio.sleep(0.5)
                        
                        # CRITICAL: If this user has role='mod' OR role='dev' OR is_mod=True, promote them immediately
                        client_role = user_roles.get(phone, '').lower() if user_roles.get(phone) else ''
                        is_mod_user = user_is_mod.get(phone, False)
                        should_promote = is_mod_user or client_role == 'mod' or client_role == 'dev'
                        if should_promote:
                            logger.info(f"  🔑 User {phone} is a mod/dev (role: {user_roles.get(phone, 'unknown')}, is_mod: {is_mod_user}) - promoting to moderator immediately...")
                            try:
                                # Get group entity using creator account
                                group_entity = await creator_client.client.get_entity(int(group_chat_id_for_autojoin))
                                # Promote mod user immediately
                                await promote_mod_user_immediately(client, phone, group_entity, creator_client)
                            except Exception as promote_error:
                                logger.warning(f"  ⚠️ Could not promote {phone} immediately: {promote_error}")
                                logger.warning(f"     Will retry promotion later")
                        
                        joined_count += 1

                        # Small delay to avoid rate limits
                        await asyncio.sleep(1)

                    except Exception as e:
                        error_str = str(e)
                        # Check if already a member (common error)
                        if any(keyword in error_str.lower() for keyword in ['already', 'member', 'participant', 'joined', 'already a participant']):
                            logger.info(f"  ✅ {phone} is already a member of group {group_chat_id_for_autojoin}")
                            # Sync dialogs for already-member users
                            try:
                                await client.client.get_dialogs()
                            except:
                                pass
                            already_member_count += 1
                            joined_count += 1
                        else:
                            logger.error(f"  ❌ FAILED TO JOIN {phone} to group: {error_str}")
                            logger.error(f"     Error type: {type(e).__name__}")
                            import traceback
                            logger.error(f"     Traceback:\n{traceback.format_exc()}")
                            failed_count += 1
            
            logger.info(f"\n✅ Auto-join complete: {joined_count} total ({already_member_count} already members, {joined_count - already_member_count} newly joined/invited), {failed_count} failed")
            return {'joined': joined_count, 'already_member': already_member_count, 'failed': failed_count}
        
        try:
            join_result = asyncio.run_coroutine_threadsafe(join_participants_to_group(), loop).result(timeout=60)
            logger.info(f"Auto-join result: {join_result}")
        except Exception as e:
            logger.warning(f"⚠️ Error during auto-join: {e}")
            logger.warning("Continuing with conversation anyway - participants may need to join manually")
            import traceback
            logger.warning(traceback.format_exc())
        
        # STEP 1: Make creator anonymous FIRST (after all users have joined)
        # This MUST happen before promoting mods
        if group_chat_id_for_autojoin:
            logger.info(f"\n{'='*60}")
            logger.info(f"STEP 1: MAKING CREATOR ANONYMOUS (AFTER ALL USERS JOINED)")
            logger.info(f"{'='*60}")
            logger.info(f"Group ID: {group_chat_id_for_autojoin}")
            
            async def make_creator_anonymous():
                """Make creator anonymous after all users have joined"""
                CREATOR_PHONE = '+13124733150'
                creator_client = None
                for client in clients:
                    if getattr(client, 'phone', None) == CREATOR_PHONE:
                        creator_client = client
                        break
                
                if not creator_client:
                    logger.warning(f"⚠️ Creator account ({CREATOR_PHONE}) not found - cannot make anonymous")
                    return {'success': False, 'error': 'Creator account not found'}
                
                try:
                    from telethon.tl.functions.channels import EditAdminRequest, GetFullChannelRequest
                    from telethon.tl.types import ChatAdminRights, InputUserSelf
                    
                    group_entity = await creator_client.client.get_entity(int(group_chat_id_for_autojoin))
                    me = await creator_client.client.get_me()
                    full_channel = await creator_client.client(GetFullChannelRequest(group_entity))
                    
                    current_rights = None
                    if hasattr(full_channel, 'full_chat') and hasattr(full_channel.full_chat, 'admins'):
                        for admin in full_channel.full_chat.admins:
                            if admin.user_id == me.id and hasattr(admin, 'admin_rights'):
                                current_rights = admin.admin_rights
                                break
                    
                    if current_rights:
                        anonymous_rights = ChatAdminRights(
                            change_info=getattr(current_rights, 'change_info', True),
                            post_messages=getattr(current_rights, 'post_messages', True),
                            edit_messages=getattr(current_rights, 'edit_messages', True),
                            delete_messages=getattr(current_rights, 'delete_messages', True),
                            ban_users=getattr(current_rights, 'ban_users', True),
                            invite_users=getattr(current_rights, 'invite_users', True),
                            pin_messages=getattr(current_rights, 'pin_messages', True),
                            add_admins=getattr(current_rights, 'add_admins', True),
                            anonymous=True,  # CRITICAL: Enable "Remain Anonymous"
                            manage_call=getattr(current_rights, 'manage_call', False),
                            other=getattr(current_rights, 'other', False)
                        )
                    else:
                        anonymous_rights = ChatAdminRights(
                            change_info=True, post_messages=True, edit_messages=True,
                            delete_messages=True, ban_users=True, invite_users=True,
                            pin_messages=True, add_admins=True, anonymous=True,
                            manage_call=False, other=False
                        )
                    
                    await creator_client.client(EditAdminRequest(
                        channel=group_entity,
                        user_id=InputUserSelf(),
                        admin_rights=anonymous_rights,
                        rank="Admin"
                    ))
                    logger.info(f"✅ Creator 'Remain Anonymous' enabled (anonymous=True)")
                    return {'success': True}
                except Exception as e:
                    error_str = str(e)
                    logger.error(f"❌ Could not enable 'Remain Anonymous' for creator: {error_str}")
                    import traceback
                    logger.error(traceback.format_exc())
                    return {'success': False, 'error': error_str}
            
            try:
                anonymous_result = asyncio.run_coroutine_threadsafe(make_creator_anonymous(), loop).result(timeout=30)
                if anonymous_result.get('success'):
                    logger.info(f"✅ Creator anonymous enabled successfully")
                else:
                    error_msg = anonymous_result.get('error', 'Unknown error')
                    logger.error(f"❌ FAILED TO MAKE CREATOR ANONYMOUS: {error_msg}")
                    logger.error(f"   This is CRITICAL - creator will be visible!")
            except Exception as e:
                logger.error(f"❌ EXCEPTION while enabling creator anonymous: {e}")
                import traceback
                logger.error(f"   Full traceback:\n{traceback.format_exc()}")
            
            # Small delay before promoting mods
            logger.info(f"⏳ Waiting 2 seconds before promoting mods...")
            time.sleep(2)
        
        # STEP 2: Auto-promote mod users to admin/moderator with all privileges (but not anonymous)
        # This happens AFTER creator is made anonymous
        has_mods_or_devs = any(user_is_mod.get(phone, False) or (user_roles.get(phone, '').lower() in ['mod', 'dev']) for phone in user_roles.keys())
        if group_chat_id_for_autojoin and has_mods_or_devs:
            logger.info(f"\n{'='*60}")
            logger.info(f"AUTO-PROMOTING MOD USERS TO ADMIN/MODERATOR")
            logger.info(f"{'='*60}")
            logger.info(f"Group ID: {group_chat_id_for_autojoin}")
            
            async def promote_mod_users():
                """Promote users tagged as 'mod' to admin/moderator with all privileges"""
                promoted_count = 0
                failed_count = 0
                
                # Find creator account (has admin rights to promote others)
                CREATOR_PHONE = '+13124733150'
                creator_client = None
                for client in clients:
                    if getattr(client, 'phone', None) == CREATOR_PHONE:
                        creator_client = client
                        break
                
                if not creator_client:
                    logger.warning(f"⚠️ Creator account ({CREATOR_PHONE}) not found - cannot promote mod users")
                    return {'promoted': 0, 'failed': len([p for p, is_mod in user_is_mod.items() if is_mod])}
                
                # Get group entity
                try:
                    group_entity = await creator_client.client.get_entity(int(group_chat_id_for_autojoin))
                except Exception as e:
                    logger.error(f"❌ Failed to get group entity: {e}")
                    return {'promoted': 0, 'failed': len([p for p, is_mod in user_is_mod.items() if is_mod])}
                
                # Find all mod users and promote them
                from telethon.tl.functions.channels import EditAdminRequest
                from telethon.tl.types import ChatAdminRights
                
                # Create admin rights with ALL privileges EXCEPT anonymous
                # CRITICAL: Include all permissions needed for managing filters (/filters command)
                admin_rights = ChatAdminRights(
                    change_info=True,      # Can change group info
                    post_messages=True,     # Can post messages
                    edit_messages=True,     # Can edit messages
                    delete_messages=True,   # Can delete messages (needed for filters)
                    ban_users=True,         # Can ban users
                    invite_users=True,      # Can invite users
                    pin_messages=True,      # Can pin messages
                    add_admins=True,        # Can add admins
                    anonymous=False,        # NOT anonymous (user will be visible as admin)
                    manage_call=True,       # Can manage calls
                    other=True,            # Other admin rights (includes filter management)
                )
                
                # CRITICAL: Load participants first to ensure Telegram has synced user status
                logger.info("  🔍 Loading participants to sync user status...")
                try:
                    await creator_client.client.get_participants(group_entity, limit=100)
                    logger.info("  ✅ Participants loaded")
                    await asyncio.sleep(2)  # Wait for Telegram to fully sync
                except Exception as e:
                    logger.warning(f"  ⚠️ Could not load participants: {e}")
                    await asyncio.sleep(2)  # Still wait even if load fails
                
                # Promote users with role="Mod", role="Dev", or is_mod=True
                # User clarified: role="dev" is creator (skip), role="mod" should be promoted
                for phone in user_roles.keys():
                    # Skip creator account (role="dev" is creator, should stay anonymous)
                    if phone == CREATOR_PHONE:
                        logger.info(f"  ⏭️ Skipping creator account {phone} (role: dev, stays anonymous)")
                        continue
                    
                    # Check if this user should be promoted:
                    # 1. Has is_mod flag set to True
                    # 2. Has role="Mod" (case-insensitive) - THIS IS THE MODERATOR
                    # 3. Has role="Dev" (case-insensitive) - but skip creator (already handled above)
                    is_mod_flag = user_is_mod.get(phone, False)
                    user_role = user_roles.get(phone, '').lower() if user_roles.get(phone) else ''
                    should_promote = is_mod_flag or user_role == 'mod' or user_role == 'dev'
                    
                    logger.info(f"  🔍 Checking {phone}: role='{user_roles.get(phone, 'unknown')}', is_mod={is_mod_flag}, should_promote={should_promote}")
                    
                    if not should_promote:
                        logger.info(f"  ⏭️ Skipping {phone} (not a mod/dev)")
                        continue  # Skip non-mod/dev users
                    
                    # Find client for this mod/dev user
                    mod_client = None
                    for client in clients:
                        if getattr(client, 'phone', None) == phone:
                            mod_client = client
                            break
                    
                    if not mod_client:
                        logger.warning(f"  ⚠️ Mod/Dev user {phone} not found in clients")
                        failed_count += 1
                        continue
                    
                    # Skip creator account (they're already admin and should stay anonymous)
                    if phone == CREATOR_PHONE:
                        logger.info(f"  ⏭️ Skipping creator account {phone} (already admin, stays anonymous)")
                        continue
                    
                    try:
                        # Get mod user's entity
                        mod_user_entity = await mod_client.client.get_me()
                        
                        # Promote to admin using EditAdminRequest (correct Telegram API)
                        from telethon.tl.functions.channels import EditAdminRequest
                        logger.info(f"  📤 Promoting {phone} to admin/moderator...")
                        try:
                            await creator_client.client(EditAdminRequest(
                                channel=group_entity,
                                user_id=mod_user_entity,
                                admin_rights=admin_rights,
                                rank="Moderator"  # Admin rank/title
                            ))
                            logger.info(f"  ✅ Successfully promoted {phone} to admin/moderator")
                            promoted_count += 1
                        except FloodWaitError as flood_error:
                            wait_time = flood_error.seconds
                            logger.warning(f"  ⚠️ RATE LIMITED: Waiting {wait_time} seconds...")
                            await asyncio.sleep(wait_time)
                            await creator_client.client(EditAdminRequest(
                                channel=group_entity,
                                user_id=mod_user_entity,
                                admin_rights=admin_rights,
                                rank="Moderator"
                            ))
                            logger.info(f"  ✅ Successfully promoted {phone} after rate limit wait")
                            promoted_count += 1
                        
                        # Small delay to avoid rate limits
                        await asyncio.sleep(1)
                        
                    except Exception as e:
                        error_str = str(e)
                        logger.error(f"  ❌ FAILED TO PROMOTE {phone} to admin: {error_str}")
                        logger.error(f"     Error type: {type(e).__name__}")
                        logger.error(f"     User role: {user_roles.get(phone, 'unknown')}, is_mod: {is_mod_flag}")
                        logger.error(f"     Should promote: {should_promote}")
                        import traceback
                        logger.error(f"     Traceback:\n{traceback.format_exc()}")
                        failed_count += 1
                
                logger.info(f"\n✅ Mod promotion complete: {promoted_count} promoted, {failed_count} failed")
                return {'promoted': promoted_count, 'failed': failed_count}
            
            try:
                promote_result = asyncio.run_coroutine_threadsafe(promote_mod_users(), loop).result(timeout=60)
                logger.info(f"Mod promotion result: {promote_result}")
            except Exception as e:
                logger.warning(f"⚠️ Error during mod promotion: {e}")
                logger.warning("Continuing anyway - mod users may need to be promoted manually")
                import traceback
                logger.warning(traceback.format_exc())
        
        # Update chat_ids to include the group if not already present
        group_chat_id_str = str(group_chat_id_for_autojoin)
        if group_chat_id_str not in chat_ids:
            chat_ids.insert(0, group_chat_id_str)  # Add at the beginning
            logger.info(f"Updated chat_ids to include created group: {chat_ids}")
    
    # Create Telegram campaign with scripted conversations
    # Initialize bot token from config
    bot_token = config_data.get('bot_token') or Config.TELEGRAM_BOT_TOKEN
    telegram_campaign = TelegramCampaign(clients, scripted_conversations=scripted_conversations, bot_token=bot_token)
    
    # CRITICAL: Re-apply creator anonymous status RIGHT BEFORE conversations start
    # Telegram sometimes resets anonymous status, so we need to re-apply it
    # Also ensure mods are promoted before conversations start
    if group_chat_id_for_autojoin and scripted_conversations and len(scripted_conversations) > 0:
        logger.info(f"\n{'='*60}")
        logger.info(f"FINAL SETUP BEFORE CONVERSATIONS START")
        logger.info(f"{'='*60}")
        
        async def final_setup_before_conversations():
            """Final setup: Re-apply creator anonymous AND ensure mods are promoted"""
            CREATOR_PHONE = '+13124733150'
            creator_client = None
            for client in clients:
                if getattr(client, 'phone', None) == CREATOR_PHONE:
                    creator_client = client
                    break
            
            if not creator_client:
                logger.warning(f"⚠️ Creator account ({CREATOR_PHONE}) not found")
                return {'anonymous': False, 'mods_promoted': False}
            
            try:
                entity = await creator_client.client.get_entity(int(group_chat_id_for_autojoin))
                
                # STEP 1: Re-apply creator anonymous status
                logger.info("  🔍 STEP 1: Re-applying creator anonymous status...")
                try:
                    me = await creator_client.client.get_me()
                    from telethon.tl.functions.channels import EditAdminRequest, GetFullChannelRequest
                    from telethon.tl.types import ChatAdminRights, InputUserSelf
                    from telethon.errors import FloodWaitError
                    
                    # Load participants first
                    await creator_client.client.get_participants(entity, limit=100)
                    await asyncio.sleep(1)
                    
                    # Get current admin info to preserve existing rights
                    full_channel = await creator_client.client(GetFullChannelRequest(entity))
                    
                    # Get current admin rights if available
                    current_rights = None
                    if hasattr(full_channel, 'full_chat') and hasattr(full_channel.full_chat, 'admins'):
                        for admin in full_channel.full_chat.admins:
                            if admin.user_id == me.id and hasattr(admin, 'admin_rights'):
                                current_rights = admin.admin_rights
                                break
                    
                    # Create admin rights with anonymous=True
                    if current_rights:
                        anonymous_rights = ChatAdminRights(
                            change_info=getattr(current_rights, 'change_info', True),
                            post_messages=getattr(current_rights, 'post_messages', True),
                            edit_messages=getattr(current_rights, 'edit_messages', True),
                            delete_messages=getattr(current_rights, 'delete_messages', True),
                            ban_users=getattr(current_rights, 'ban_users', True),
                            invite_users=getattr(current_rights, 'invite_users', True),
                            pin_messages=getattr(current_rights, 'pin_messages', True),
                            add_admins=getattr(current_rights, 'add_admins', True),
                            anonymous=True,  # CRITICAL: Re-enable anonymous
                            manage_call=getattr(current_rights, 'manage_call', False),
                            other=getattr(current_rights, 'other', False)
                        )
                    else:
                        # Use full admin rights with anonymous=True
                        anonymous_rights = ChatAdminRights(
                            change_info=True,
                            post_messages=True,
                            edit_messages=True,
                            delete_messages=True,
                            ban_users=True,
                            invite_users=True,
                            pin_messages=True,
                            add_admins=True,
                            anonymous=True,  # CRITICAL: Re-enable anonymous
                            manage_call=False,
                            other=False
                        )
                    
                    try:
                        # Re-apply anonymous status
                        await creator_client.client(EditAdminRequest(
                            channel=entity,
                            user_id=InputUserSelf(),
                            admin_rights=anonymous_rights,
                            rank="Admin"
                        ))
                        logger.info("  ✅ Creator anonymous status re-applied successfully (anonymous=True)")
                        await asyncio.sleep(2)  # Wait for Telegram to process
                        anonymous_success = True
                    except FloodWaitError as flood_error:
                        wait_time = flood_error.seconds
                        logger.warning(f"  ⚠️ RATE LIMITED: Waiting {wait_time} seconds...")
                        await asyncio.sleep(wait_time)
                        await creator_client.client(EditAdminRequest(
                            channel=entity,
                            user_id=InputUserSelf(),
                            admin_rights=anonymous_rights,
                            rank="Admin"
                        ))
                        logger.info("  ✅ Creator anonymous status re-applied after rate limit wait")
                        anonymous_success = True
                except Exception as e:
                    error_str = str(e)
                    logger.error(f"  ❌ Could not re-apply anonymous status: {error_str}")
                    logger.error(f"     Error type: {type(e).__name__}")
                    import traceback
                    logger.error(traceback.format_exc())
                    anonymous_success = False
                
                # STEP 2: Ensure mods are promoted (promote again if needed)
                logger.info("  🔍 STEP 2: Ensuring mods are promoted...")
                mods_promoted_count = 0
                try:
                    from telethon.tl.functions.channels import EditAdminRequest, GetParticipantRequest
                    from telethon.tl.types import ChatAdminRights, ChannelParticipantAdmin, ChannelParticipantCreator
                    
                    # Load participants again
                    await creator_client.client.get_participants(entity, limit=100)
                    await asyncio.sleep(1)
                    
                    admin_rights = ChatAdminRights(
                        change_info=True, post_messages=True, edit_messages=True,
                        delete_messages=True, ban_users=True, invite_users=True,
                        pin_messages=True, add_admins=False, anonymous=False,
                        manage_call=True, other=True
                    )
                    
                    # Check each mod user and promote if not already admin
                    for phone in user_roles.keys():
                        if phone == CREATOR_PHONE:
                            continue  # Skip creator
                        
                        is_mod_flag = user_is_mod.get(phone, False)
                        user_role = user_roles.get(phone, '').lower() if user_roles.get(phone) else ''
                        should_promote = is_mod_flag or user_role == 'mod' or user_role == 'dev'
                        
                        if not should_promote:
                            continue
                        
                        # Find client
                        mod_client = None
                        for client in clients:
                            if getattr(client, 'phone', None) == phone:
                                mod_client = client
                                break
                        
                        if not mod_client:
                            continue
                        
                        try:
                            mod_user_entity = await mod_client.client.get_me()
                            
                            # Check if already admin (with retry for database locks)
                            is_already_admin = False
                            for retry in range(3):
                                try:
                                    participant = await creator_client.client(GetParticipantRequest(
                                        channel=entity,
                                        participant=mod_user_entity
                                    ))
                                    if isinstance(participant.participant, (ChannelParticipantAdmin, ChannelParticipantCreator)):
                                        logger.info(f"  ✅ {phone} is already admin - skipping")
                                        mods_promoted_count += 1
                                        is_already_admin = True
                                        break
                                    break  # Got result, not admin
                                except Exception as check_error:
                                    error_str = str(check_error).lower()
                                    if 'database is locked' in error_str or 'locked' in error_str:
                                        if retry < 2:
                                            wait_time = (retry + 1) * 2  # 2s, 4s
                                            logger.warning(f"  ⚠️ Database locked (check), waiting {wait_time}s and retrying...")
                                            await asyncio.sleep(wait_time)
                                            continue
                                    # Not a lock error or max retries - break
                                    break
                            
                            if is_already_admin:
                                continue
                            
                            # Promote to admin (with retry for database locks)
                            logger.info(f"  📤 Promoting {phone} (role: {user_roles.get(phone, 'unknown')}) to moderator...")
                            promotion_success = False
                            for retry in range(3):
                                try:
                                    await creator_client.client(EditAdminRequest(
                                        channel=entity,
                                        user_id=mod_user_entity,
                                        admin_rights=admin_rights,
                                        rank="Moderator"
                                    ))
                                    logger.info(f"  ✅ Successfully promoted {phone} to moderator")
                                    mods_promoted_count += 1
                                    promotion_success = True
                                    break
                                except Exception as promote_error:
                                    error_str = str(promote_error).lower()
                                    if 'database is locked' in error_str or 'locked' in error_str:
                                        if retry < 2:
                                            wait_time = (retry + 1) * 2  # 2s, 4s
                                            logger.warning(f"  ⚠️ Database locked (promote), waiting {wait_time}s and retrying...")
                                            await asyncio.sleep(wait_time)
                                            continue
                                        else:
                                            logger.error(f"  ❌ Database locked after {retry + 1} retries - giving up")
                                    else:
                                        # Not a lock error - break immediately
                                        raise promote_error
                            
                            if not promotion_success:
                                logger.error(f"  ❌ Failed to promote {phone} after retries")
                            
                            await asyncio.sleep(2)  # Delay between promotions
                        except Exception as e:
                            error_str = str(e)
                            logger.warning(f"  ⚠️ Could not promote {phone}: {error_str}")
                            import traceback
                            logger.warning(traceback.format_exc())
                    
                    logger.info(f"  ✅ Mod promotion check complete: {mods_promoted_count} mod(s) confirmed as admin")
                    mods_success = mods_promoted_count > 0
                except Exception as e:
                    logger.warning(f"  ⚠️ Error checking/promoting mods: {e}")
                    mods_success = False
                
                return {'anonymous': anonymous_success, 'mods_promoted': mods_success}
            except Exception as e:
                logger.error(f"❌ Error in final setup: {e}")
                import traceback
                logger.error(traceback.format_exc())
                return {'anonymous': False, 'mods_promoted': False}
        
        try:
            # Use existing loop, not create new one
            final_result = asyncio.run_coroutine_threadsafe(final_setup_before_conversations(), loop).result(timeout=60)
            if final_result.get('anonymous'):
                logger.info(f"✅ Creator anonymous status confirmed before conversations")
            else:
                logger.error(f"❌ FAILED TO RE-APPLY CREATOR ANONYMOUS STATUS!")
            if final_result.get('mods_promoted'):
                logger.info(f"✅ Mods confirmed as admin before conversations")
            else:
                logger.warning(f"⚠️ Mod promotion check failed or no mods found")
        except Exception as e:
            logger.error(f"❌ Error in final setup before conversations: {e}")
            import traceback
            logger.error(traceback.format_exc())
    
    # Log user roles for debugging
    logger.info(f"\n{'='*60}")
    logger.info(f"USER ROLES CONFIGURATION")
    logger.info(f"{'='*60}")
    for phone, role in user_roles.items():
        logger.info(f"  {phone}: role='{role}'")
    logger.info(f"{'='*60}\n")
    
    # Start conversation and wait for it to complete
    logger.info(f"Starting conversation...\n")
    
    try:
        conversation_thread = telegram_campaign.start_conversation_thread(
            campaign_id=campaign_id,
            direction=direction,
            chat_ids=chat_ids,
            user_roles=user_roles,
            user_is_mod=user_is_mod,
            token_name=token_name,
            token_symbol=token_symbol,
            token_address=token_address,
            website=website,
            telegram=telegram,
            twitter=twitter,
            docs=docs,
            description=description,
            chain=chain
        )
        
        # Calculate timeout based on conversation duration
        # Get max duration from scripted conversations
        max_duration = 300  # Default 5 minutes
        if scripted_conversations:
            for conv in scripted_conversations:
                total_delay = sum(
                    (msg.get('typing_delay', 0) + msg.get('delay_after', 0))
                    for msg in conv.get('messages', [])
                )
                max_duration = max(max_duration, total_delay)
        
        # Add 2 minute buffer for connection and processing
        timeout_seconds = int(max_duration) + 120
        logger.info(f"Waiting for conversation to complete (timeout: {timeout_seconds}s / {timeout_seconds/60:.1f} min)")
        
        # Wait for conversation thread to complete
        conversation_thread.join(timeout=timeout_seconds)
        
        logger.info(f"\n{'='*60}")
        logger.info(f"Conversation completed!")
        logger.info(f"{'='*60}")
        return True
        
    except Exception as e:
        logger.error(f"Error starting conversation: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return False

def main():
    """Main entry point - reads JSON config from stdin"""
    try:
        # Read JSON config from stdin with UTF-8 encoding for proper emoji handling
        # Ensure stdin is UTF-8 encoded (already set at top of file for Windows)
        input_data = sys.stdin.read()
        if not input_data:
            logger.error("No input data provided")
            sys.exit(1)
        
        # Parse JSON - Python's json.loads handles UTF-8 correctly by default
        data = json.loads(input_data)
        
        config_data = data.get('config', {})
        scripted_conversations = data.get('scripted_conversations', [])
        action = config_data.get('action')  # Check for manual action
        
        # Handle verify action (account verification)
        if action == 'verify':
            import asyncio
            from telegram_user_client import TelegramUserClient
            
            api_id = config_data.get('api_id')
            api_hash = config_data.get('api_hash')
            phone = config_data.get('phone')
            code = config_data.get('code')
            password = config_data.get('password')
            phone_code_hash = config_data.get('phone_code_hash')
            
            if not api_id or not api_hash or not phone:
                logger.error("Missing api_id, api_hash, or phone for verify action")
                print("TELEGRAM_VERIFY_RESULT:")
                print(json.dumps({"success": False, "error": "Missing api_id, api_hash, or phone"}))
                sys.exit(1)
            
            # Create session name from phone
            phone_clean = phone.replace('+', '').replace('-', '').replace(' ', '')
            session_name = phone_clean
            
            try:
                # Create client
                client = TelegramUserClient(
                    api_id=int(api_id),
                    api_hash=api_hash,
                    phone=phone,
                    session_name=session_name,
                )
                
                # Get event loop
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                
                async def verify_account():
                    try:
                        # Try to connect
                        await client.client.connect()
                        
                        # Check if authorized
                        if await client.client.is_user_authorized():
                            # Already authorized - get user info
                            me = await client.client.get_me()
                            logger.info(f"✅ Account verified: {phone}")
                            print("TELEGRAM_VERIFY_RESULT:")
                            print(json.dumps({
                                "success": True,
                                "verified": True,
                                "user": {
                                    "id": me.id,
                                    "username": me.username,
                                    "first_name": me.first_name,
                                    "last_name": me.last_name,
                                    "phone": phone,
                                },
                                "message": "Account verified successfully"
                            }))
                            await client.client.disconnect()
                            return
                        
                        # Not authorized - need to sign in
                        if code:
                            # Sign in with code
                            if password:
                                await client.client.sign_in(phone=phone, code=code, password=password)
                            else:
                                await client.client.sign_in(phone=phone, code=code, phone_code_hash=phone_code_hash)
                            
                            # Get user info
                            me = await client.client.get_me()
                            logger.info(f"✅ Account verified with code: {phone}")
                            print("TELEGRAM_VERIFY_RESULT:")
                            print(json.dumps({
                                "success": True,
                                "verified": True,
                                "user": {
                                    "id": me.id,
                                    "username": me.username,
                                    "first_name": me.first_name,
                                    "last_name": me.last_name,
                                    "phone": phone,
                                },
                                "message": "Account verified successfully"
                            }))
                            await client.client.disconnect()
                        else:
                            # Need code
                            sent_code = await client.client.send_code_request(phone)
                            logger.info(f"📱 Verification code sent to {phone}")
                            print("TELEGRAM_VERIFY_RESULT:")
                            print(json.dumps({
                                "success": True,
                                "verified": False,
                                "requires_code": True,
                                "phone_code_hash": sent_code.phone_code_hash,
                                "message": "Verification code sent to Telegram"
                            }))
                            await client.client.disconnect()
                    except Exception as e:
                        logger.error(f"Verification error: {e}")
                        import traceback
                        logger.error(traceback.format_exc())
                        print("TELEGRAM_VERIFY_RESULT:")
                        print(json.dumps({
                            "success": False,
                            "verified": False,
                            "error": str(e),
                            "message": f"Verification failed: {str(e)}"
                        }))
                
                loop.run_until_complete(verify_account())
                sys.exit(0)
            except Exception as e:
                logger.error(f"Verify action error: {e}")
                import traceback
                logger.error(traceback.format_exc())
                print("TELEGRAM_VERIFY_RESULT:")
                print(json.dumps({
                    "success": False,
                    "verified": False,
                    "error": str(e),
                    "message": f"Verification failed: {str(e)}"
                }))
                sys.exit(1)
        
        # Handle manual actions (make_creator_anonymous, promote_mods, etc.)
        if action:
            logger.info(f"\n{'='*60}")
            logger.info(f"MANUAL ACTION: {action}")
            logger.info(f"{'='*60}")
            
            group_chat_id = config_data.get('group_chat_id')
            if not group_chat_id:
                logger.error("❌ Missing group_chat_id for action")
                print("GROUP_ACTION_RESULT:")
                print(json.dumps({"success": False, "error": "Missing group_chat_id"}))
                sys.exit(1)
            
            # Initialize clients
            clients, user_roles, user_is_mod = initialize_clients(config_data)
            if not clients:
                logger.error("❌ No clients initialized")
                print("GROUP_ACTION_RESULT:")
                print(json.dumps({"success": False, "error": "No clients initialized"}))
                sys.exit(1)
            
            # Get event loop
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
            async def run_action():
                try:
                    # Connect all clients
                    for client in clients:
                        await client.client.connect()
                        if not await client.client.is_user_authorized():
                            logger.warning(f"⚠️ Client {client.phone} not authorized - skipping")
                            continue
                    
                    # Find creator account
                    CREATOR_PHONE = '+13124733150'
                    creator_client = None
                    for client in clients:
                        if getattr(client, 'phone', None) == CREATOR_PHONE:
                            creator_client = client
                            break
                    
                    if not creator_client:
                        logger.error(f"❌ Creator account ({CREATOR_PHONE}) not found")
                        print("GROUP_ACTION_RESULT:")
                        print(json.dumps({"success": False, "error": f"Creator account ({CREATOR_PHONE}) not found"}))
                        return
                    
                    # Get group entity
                    group_entity = await creator_client.client.get_entity(int(group_chat_id))
                    
                    # CRITICAL: Verify this is a GROUP, not a CHANNEL
                    logger.info(f"🔍 Verifying entity type...")
                    logger.info(f"   Entity ID: {group_entity.id}")
                    logger.info(f"   Entity title: {getattr(group_entity, 'title', 'N/A')}")
                    logger.info(f"   Entity type - broadcast: {getattr(group_entity, 'broadcast', None)}")
                    logger.info(f"   Entity type - megagroup: {getattr(group_entity, 'megagroup', None)}")
                    
                    # Ensure we're working with a GROUP (megagroup=True, broadcast=False)
                    # NOT a CHANNEL (broadcast=True)
                    is_channel = getattr(group_entity, 'broadcast', False)
                    is_megagroup = getattr(group_entity, 'megagroup', False)
                    
                    if is_channel and not is_megagroup:
                        logger.error(f"❌ ERROR: This is a CHANNEL, not a GROUP!")
                        logger.error(f"   Channels and Groups have different admin management!")
                        logger.error(f"   Promotion should be done in the GROUP, not the CHANNEL")
                        print("GROUP_ACTION_RESULT:")
                        print(json.dumps({"success": False, "error": "Entity is a channel, not a group. Promotion must be done in the group."}))
                        return
                    
                    if not is_megagroup:
                        logger.warning(f"⚠️ WARNING: This might be a small group (not a supergroup)")
                        logger.warning(f"   Small groups use different admin management")
                    
                    logger.info(f"✅ Confirmed: This is a {'MEGAGROUP' if is_megagroup else 'SMALL GROUP'} (not a channel)")
                    
                    # Verify creator is admin and has permission to add admins
                    logger.info(f"🔍 Verifying creator account permissions...")
                    try:
                        from telethon.tl.functions.channels import GetParticipantRequest
                        creator_participant = await creator_client.client(GetParticipantRequest(
                            channel=group_entity,
                            participant=await creator_client.client.get_me()
                        ))
                        logger.info(f"     Creator participant type: {type(creator_participant.participant)}")
                        
                        from telethon.tl.types import ChannelParticipantAdmin, ChannelParticipantCreator
                        if isinstance(creator_participant.participant, (ChannelParticipantAdmin, ChannelParticipantCreator)):
                            if isinstance(creator_participant.participant, ChannelParticipantAdmin):
                                admin_rights = creator_participant.participant.admin_rights
                                if admin_rights:
                                    can_add_admins = getattr(admin_rights, 'add_admins', False)
                                    logger.info(f"     Creator has 'add_admins' permission: {can_add_admins}")
                                    if not can_add_admins:
                                        logger.error(f"❌ CREATOR DOES NOT HAVE 'ADD ADMINS' PERMISSION!")
                                        logger.error(f"   The creator account needs 'Add new admins' permission to promote others")
                                        print("GROUP_ACTION_RESULT:")
                                        print(json.dumps({"success": False, "error": "Creator account does not have 'Add new admins' permission"}))
                                        return
                            else:
                                logger.info(f"     Creator is the group creator (has all permissions)")
                        else:
                            logger.error(f"❌ CREATOR IS NOT AN ADMIN!")
                            logger.error(f"   The creator account must be an admin to promote others")
                            print("GROUP_ACTION_RESULT:")
                            print(json.dumps({"success": False, "error": "Creator account is not an admin"}))
                            return
                    except Exception as perm_error:
                        logger.warning(f"⚠️ Could not verify creator permissions: {perm_error}")
                        logger.warning(f"   Continuing anyway, but promotion may fail...")
                    
                    if action == 'make_creator_anonymous':
                        # Make creator anonymous - using same approach as group creator
                        logger.info("🔍 Making creator anonymous...")
                        
                        # CRITICAL: Load participants first to ensure Telegram has synced user status
                        logger.info("  Loading participants to sync user status...")
                        try:
                            await creator_client.client.get_participants(group_entity, limit=100)
                            logger.info("  ✅ Participants loaded")
                            await asyncio.sleep(2)  # Wait for Telegram to fully sync
                        except Exception as e:
                            logger.warning(f"  ⚠️ Could not load participants: {e}")
                            await asyncio.sleep(2)  # Still wait even if load fails
                        
                        from telethon.tl.functions.channels import EditAdminRequest, GetFullChannelRequest
                        from telethon.tl.types import ChatAdminRights, InputUserSelf
                        from telethon.errors import FloodWaitError
                        
                        me = await creator_client.client.get_me()
                        logger.info(f"  Creator user ID: {me.id}")
                        
                        try:
                            # Get current admin info to preserve existing rights (same as group creator)
                            full_channel = await creator_client.client(GetFullChannelRequest(group_entity))
                            logger.info("  ✅ Got full channel info")
                            
                            # Get current admin rights if available
                            current_rights = None
                            if hasattr(full_channel, 'full_chat') and hasattr(full_channel.full_chat, 'admins'):
                                for admin in full_channel.full_chat.admins:
                                    if admin.user_id == me.id and hasattr(admin, 'admin_rights'):
                                        current_rights = admin.admin_rights
                                        logger.info(f"  ✅ Found current admin rights for creator")
                                        break
                            
                            # Create admin rights with anonymous=True
                            # Preserve existing rights if available, otherwise use full admin rights
                            if current_rights:
                                logger.info("  📋 Preserving existing admin rights and setting anonymous=True")
                                anonymous_rights = ChatAdminRights(
                                    change_info=getattr(current_rights, 'change_info', True),
                                    post_messages=getattr(current_rights, 'post_messages', True),
                                    edit_messages=getattr(current_rights, 'edit_messages', True),
                                    delete_messages=getattr(current_rights, 'delete_messages', True),
                                    ban_users=getattr(current_rights, 'ban_users', True),
                                    invite_users=getattr(current_rights, 'invite_users', True),
                                    pin_messages=getattr(current_rights, 'pin_messages', True),
                                    add_admins=getattr(current_rights, 'add_admins', True),
                                    anonymous=True,  # Enable "Remain Anonymous" - THIS IS THE KEY
                                    manage_call=getattr(current_rights, 'manage_call', False),
                                    other=getattr(current_rights, 'other', False)
                                )
                            else:
                                logger.info("  📋 Using full admin rights with anonymous=True")
                                # Use full admin rights with anonymous=True
                                anonymous_rights = ChatAdminRights(
                                    change_info=True,
                                    post_messages=True,
                                    edit_messages=True,
                                    delete_messages=True,
                                    ban_users=True,
                                    invite_users=True,
                                    pin_messages=True,
                                    add_admins=True,
                                    anonymous=True,  # Enable "Remain Anonymous"
                                    manage_call=False,
                                    other=False
                                )
                            
                            logger.info(f"  📋 Admin rights being set:")
                            logger.info(f"     - anonymous: {anonymous_rights.anonymous}")
                            logger.info(f"     - add_admins: {anonymous_rights.add_admins}")
                            
                            # Update admin rights with anonymous=True
                            # Use InputUserSelf() to reference the current user (same as group creator)
                            try:
                                result = await creator_client.client(EditAdminRequest(
                                    channel=group_entity,
                                    user_id=InputUserSelf(),  # Use InputUserSelf() instead of me
                                    admin_rights=anonymous_rights,
                                    rank="Admin"
                                ))
                                logger.info("  ✅ EditAdminRequest completed successfully")
                                
                                # Wait for Telegram to process
                                await asyncio.sleep(2)
                                
                                logger.info("✅ Creator 'Remain Anonymous' enabled (anonymous=True)")
                                print("GROUP_ACTION_RESULT:")
                                print(json.dumps({"success": True}))
                            except FloodWaitError as flood_error:
                                wait_time = flood_error.seconds
                                logger.warning(f"  ⚠️ RATE LIMITED: Telegram requires {wait_time} seconds wait")
                                logger.warning(f"  ⏳ Waiting {wait_time} seconds before retrying...")
                                await asyncio.sleep(wait_time)
                                
                                # Retry after waiting
                                logger.info(f"  🔄 Retrying make anonymous after rate limit wait...")
                                result = await creator_client.client(EditAdminRequest(
                                    channel=group_entity,
                                    user_id=InputUserSelf(),
                                    admin_rights=anonymous_rights,
                                    rank="Admin"
                                ))
                                logger.info("  ✅ EditAdminRequest completed successfully after retry")
                                await asyncio.sleep(2)
                                logger.info("✅ Creator 'Remain Anonymous' enabled (anonymous=True)")
                                print("GROUP_ACTION_RESULT:")
                                print(json.dumps({"success": True}))
                        except Exception as e:
                            error_str = str(e)
                            error_type = type(e).__name__
                            logger.error(f"❌ Could not enable 'Remain Anonymous' for creator: {error_str}")
                            logger.error(f"   Error type: {error_type}")
                            import traceback
                            logger.error(traceback.format_exc())
                            print("GROUP_ACTION_RESULT:")
                            print(json.dumps({"success": False, "error": error_str}))
                    
                    elif action == 'promote_mods':
                        # Promote all mod users
                        # Use Telethon's convenience method edit_admin() instead of raw EditAdminRequest
                        from telethon.tl.types import ChatAdminRights
                        
                        # Create admin rights with ALL required permissions
                        # According to Telethon docs: https://docs.telethon.dev/en/stable/modules/client.html
                        admin_rights = ChatAdminRights(
                            change_info=True,      # Can change group info
                            post_messages=True,     # Can post messages
                            edit_messages=True,     # Can edit messages
                            delete_messages=True,   # Can delete messages (CRITICAL for filters)
                            ban_users=True,         # Can ban users
                            invite_users=True,      # Can invite users
                            pin_messages=True,      # Can pin messages
                            add_admins=False,       # Mods can't add admins (only creator can)
                            anonymous=False,        # Mods are visible (not anonymous)
                            manage_call=True,       # Can manage calls
                            other=True              # Other admin rights (CRITICAL for filter management)
                        )
                        
                        promoted_count = 0
                        failed_count = 0
                        
                        logger.info(f"\n{'='*60}")
                        logger.info(f"PROMOTE_MODS ACTION - DETAILED DEBUG")
                        logger.info(f"{'='*60}")
                        logger.info(f"🔍 Total clients: {len(clients)}")
                        logger.info(f"🔍 Creator phone: {CREATOR_PHONE}")
                        logger.info(f"🔍 User roles from config:")
                        for phone, role in user_roles.items():
                            is_mod = user_is_mod.get(phone, False)
                            logger.info(f"     {phone}: role='{role}', is_mod={is_mod}")
                        logger.info(f"🔍 User is_mod flags:")
                        for phone, is_mod in user_is_mod.items():
                            logger.info(f"     {phone}: is_mod={is_mod}")
                        logger.info(f"{'='*60}\n")
                        
                        for client in clients:
                            phone = getattr(client, 'phone', None)
                            if not phone:
                                logger.warning(f"  ⚠️ Client has no phone attribute, skipping")
                                continue
                            
                            # CRITICAL: Skip creator account - NEVER promote creator
                            if phone == CREATOR_PHONE:
                                logger.info(f"  ⏭️ SKIPPING CREATOR ACCOUNT {phone} (must stay anonymous)")
                                continue
                            
                            # Get user entity to verify it's not the creator
                            try:
                                user_entity = await client.client.get_me()
                                user_id = user_entity.id
                                creator_entity = await creator_client.client.get_me()
                                creator_id = creator_entity.id
                                
                                # Double-check: Skip if this is the creator by user ID
                                if user_id == creator_id:
                                    logger.warning(f"  ⚠️ SKIPPING CREATOR (matched by user ID {user_id})")
                                    continue
                            except Exception as e:
                                logger.warning(f"  ⚠️ Could not verify user entity for {phone}: {e}")
                                continue
                            
                            # Normalize phone for lookup (remove spaces, dashes, parentheses)
                            normalized_phone = phone.replace(' ', '').replace('-', '').replace('(', '').replace(')', '')
                            
                            # Try to find user config with normalized phone
                            matching_phone = None
                            for config_phone in user_roles.keys():
                                normalized_config_phone = config_phone.replace(' ', '').replace('-', '').replace('(', '').replace(')', '')
                                if normalized_config_phone == normalized_phone:
                                    matching_phone = config_phone
                                    break
                            
                            if not matching_phone:
                                # Fallback: try exact match
                                matching_phone = phone if phone in user_roles else None
                            
                            # Check if this user should be promoted:
                            # 1. Has is_mod flag set to True
                            # 2. Has role="Mod" (case-insensitive)
                            # 3. Has role="Dev" (case-insensitive)
                            is_mod_flag = user_is_mod.get(matching_phone, False) if matching_phone else False
                            user_role = user_roles.get(matching_phone, '').lower() if matching_phone and user_roles.get(matching_phone) else ''
                            should_promote = is_mod_flag or user_role == 'mod' or user_role == 'dev'
                            
                            logger.info(f"  🔍 Checking {phone} (normalized: {normalized_phone})")
                            logger.info(f"     Matching config phone: {matching_phone}")
                            logger.info(f"     Role from config: {user_roles.get(matching_phone, 'NOT FOUND') if matching_phone else 'NO MATCH'}")
                            logger.info(f"     is_mod flag: {is_mod_flag}")
                            logger.info(f"     Should promote: {should_promote}")
                            
                            if not should_promote:
                                logger.info(f"  ⏭️ Skipping {phone} (role: {user_roles.get(matching_phone, 'unknown') if matching_phone else 'NO MATCH'}, is_mod: {is_mod_flag}) - not a mod/dev")
                                continue
                            
                            logger.info(f"  📤 Promoting {phone} (role: {user_roles.get(matching_phone, 'unknown') if matching_phone else 'NO MATCH'}, is_mod: {is_mod_flag})")
                            
                            try:
                                mod_user_entity = await client.client.get_me()
                                logger.info(f"     User ID: {mod_user_entity.id}, Username: {getattr(mod_user_entity, 'username', 'N/A')}")
                                
                                logger.info(f"     Attempting EditAdminRequest for user {mod_user_entity.id}...")
                                logger.info(f"     Group entity ID: {group_entity.id}, Title: {getattr(group_entity, 'title', 'N/A')}")
                                logger.info(f"     Group type: broadcast={getattr(group_entity, 'broadcast', None)}, megagroup={getattr(group_entity, 'megagroup', None)}")
                                
                                # Log admin rights being set - MUST specify ALL fields explicitly
                                logger.info(f"     Admin rights being set (ALL fields required by Telegram):")
                                logger.info(f"       - change_info: {admin_rights.change_info}")
                                logger.info(f"       - post_messages: {admin_rights.post_messages}")
                                logger.info(f"       - edit_messages: {admin_rights.edit_messages}")
                                logger.info(f"       - delete_messages: {admin_rights.delete_messages}")
                                logger.info(f"       - ban_users: {admin_rights.ban_users}")
                                logger.info(f"       - invite_users: {admin_rights.invite_users}")
                                logger.info(f"       - pin_messages: {admin_rights.pin_messages}")
                                logger.info(f"       - add_admins: {admin_rights.add_admins}")
                                logger.info(f"       - anonymous: {admin_rights.anonymous}")
                                logger.info(f"       - manage_call: {admin_rights.manage_call}")
                                logger.info(f"       - other: {admin_rights.other}")
                                
                                # CRITICAL: Load participants first to ensure Telegram has synced user status
                                logger.info(f"     Loading participants to sync user status...")
                                try:
                                    await creator_client.client.get_participants(group_entity, limit=100)
                                    logger.info(f"     ✅ Participants loaded")
                                    await asyncio.sleep(2)  # Wait for Telegram to fully sync
                                except Exception as e:
                                    logger.warning(f"     ⚠️ Could not load participants: {e}")
                                    await asyncio.sleep(2)  # Still wait even if load fails
                                
                                # Perform the promotion using Telethon's edit_admin() convenience method
                                # This is the recommended way according to Telethon docs
                                promotion_success = False
                                for retry in range(3):
                                    try:
                                        from telethon.errors import FloodWaitError
                                        
                                        # Use EditAdminRequest directly - this is the correct Telegram API call
                                        from telethon.tl.functions.channels import EditAdminRequest
                                        logger.info(f"     Using EditAdminRequest to promote user...")
                                        result = await creator_client.client(EditAdminRequest(
                                            channel=group_entity,
                                            user_id=mod_user_entity,
                                            admin_rights=admin_rights,
                                            rank="Moderator"
                                        ))
                                        logger.info(f"     edit_admin() completed. Result type: {type(result)}")
                                        
                                        # Check if result contains any errors
                                        updates_count = 0
                                        if hasattr(result, 'updates'):
                                            updates_count = len(result.updates)
                                            logger.info(f"     Updates count: {updates_count}")
                                            if updates_count == 0:
                                                logger.warning(f"     ⚠️ WARNING: EditAdminRequest returned 0 updates!")
                                                logger.warning(f"        This might mean:")
                                                logger.warning(f"        1. User is already admin (will verify)")
                                                logger.warning(f"        2. Telegram hasn't processed the change yet (will wait and verify)")
                                                logger.warning(f"        3. Promotion silently failed (will verify)")
                                            else:
                                                for update in result.updates:
                                                    logger.info(f"       Update type: {type(update).__name__}")
                                                    if hasattr(update, 'message'):
                                                        logger.info(f"         Message: {update.message}")
                                        
                                        # Check for RPC errors in the result
                                        if hasattr(result, 'rpc_error'):
                                            logger.error(f"     RPC Error: {result.rpc_error}")
                                        
                                        # CRITICAL: Wait longer for Telegram to process the promotion
                                        # If 0 updates, wait even longer
                                        wait_time = 8 if updates_count == 0 else 5
                                        logger.info(f"     ⏳ Waiting {wait_time} seconds for Telegram to process promotion...")
                                        await asyncio.sleep(wait_time)
                                        
                                        # Immediately verify after promotion to ensure it worked
                                        logger.info(f"     🔍 Immediate verification after promotion...")
                                        try:
                                            from telethon.tl.functions.channels import GetParticipantRequest
                                            from telethon.tl.types import ChannelParticipantAdmin, ChannelParticipantCreator
                                            
                                            verify_participant = await creator_client.client(GetParticipantRequest(
                                                channel=group_entity,
                                                participant=mod_user_entity
                                            ))
                                            
                                            if isinstance(verify_participant.participant, (ChannelParticipantAdmin, ChannelParticipantCreator)):
                                                rank = getattr(verify_participant.participant, 'rank', 'N/A')
                                                logger.info(f"     ✅ IMMEDIATE VERIFICATION: {phone} (ID: {mod_user_entity.id}) is admin with rank: {rank}")
                                                promotion_success = True
                                                break
                                            else:
                                                logger.warning(f"     ⚠️ IMMEDIATE VERIFICATION FAILED: User is NOT admin yet")
                                                logger.warning(f"        Participant type: {type(verify_participant.participant).__name__}")
                                                if retry < 2:
                                                    logger.info(f"        Will retry promotion...")
                                                    await asyncio.sleep(3)
                                                    continue
                                                else:
                                                    logger.error(f"        ❌ Promotion failed after {retry + 1} attempts")
                                                    promotion_success = False
                                                    break
                                        except Exception as immediate_verify_error:
                                            logger.warning(f"     ⚠️ Could not verify immediately: {immediate_verify_error}")
                                            # Continue anyway - will verify later
                                            promotion_success = True
                                            break
                                    except FloodWaitError as flood_error:
                                        wait_time = flood_error.seconds
                                        logger.warning(f"     ⚠️ RATE LIMITED: Telegram requires {wait_time} seconds wait")
                                        logger.warning(f"     ⏳ Waiting {wait_time} seconds before retrying...")
                                        await asyncio.sleep(wait_time)
                                        
                                        # Retry after waiting
                                        logger.info(f"     🔄 Retrying promotion after rate limit wait...")
                                        result = await creator_client.client(EditAdminRequest(
                                            channel=group_entity,
                                            user_id=mod_user_entity,
                                            admin_rights=admin_rights,
                                            rank="Moderator"
                                        ))
                                        logger.info(f"     ✅ edit_admin() completed successfully after retry")
                                        promotion_success = True
                                        break
                                    except Exception as promote_error:
                                        error_str = str(promote_error).lower()
                                        if 'database is locked' in error_str or 'locked' in error_str:
                                            if retry < 2:
                                                wait_time = (retry + 1) * 2  # 2s, 4s
                                                logger.warning(f"     ⚠️ DATABASE LOCKED: Waiting {wait_time}s and retrying...")
                                                await asyncio.sleep(wait_time)
                                                continue
                                            else:
                                                logger.error(f"     ❌ Database locked after {retry + 1} retries - giving up")
                                                raise promote_error
                                        else:
                                            # Not a lock error - raise immediately
                                            raise promote_error
                                
                                if not promotion_success:
                                    logger.error(f"  ❌ Failed to promote {phone} after retries")
                                    failed_count += 1
                                else:
                                    logger.info(f"  ✅ Successfully promoted {phone} to moderator")
                                    promoted_count += 1
                                    
                                    # CRITICAL: Wait longer for Telegram to fully process the promotion
                                    logger.info(f"     ⏳ Waiting 5 seconds for Telegram to fully process promotion...")
                                    await asyncio.sleep(5)
                                    
                                    # Verify promotion by checking admin list (only if promotion succeeded)
                                    logger.info(f"     Verifying promotion by checking admin list...")
                                    
                                    try:
                                        mod_user_entity = await client.client.get_me()
                                        
                                        # Method 1: Check participant status (most reliable)
                                        from telethon.tl.functions.channels import GetParticipantRequest
                                        from telethon.tl.types import ChannelParticipantAdmin, ChannelParticipantCreator
                                        
                                        participant = await creator_client.client(GetParticipantRequest(
                                            channel=group_entity,
                                            participant=mod_user_entity
                                        ))
                                        
                                        if isinstance(participant.participant, (ChannelParticipantAdmin, ChannelParticipantCreator)):
                                            rank = getattr(participant.participant, 'rank', 'N/A')
                                            logger.info(f"     ✅ VERIFIED (Method 1): {phone} (ID: {mod_user_entity.id}) is now admin with rank: {rank}")
                                        else:
                                            logger.warning(f"     ⚠️ VERIFICATION FAILED (Method 1): {phone} (ID: {mod_user_entity.id}) is NOT admin")
                                            logger.warning(f"        Participant type: {type(participant.participant).__name__}")
                                            
                                            # Method 2: Try checking admin list directly
                                            logger.info(f"     Trying Method 2: Checking admin list directly...")
                                            try:
                                                from telethon.tl.functions.channels import GetFullChannelRequest
                                                full_channel = await creator_client.client(GetFullChannelRequest(group_entity))
                                                
                                                admin_found = False
                                                if hasattr(full_channel, 'full_chat') and hasattr(full_channel.full_chat, 'admins'):
                                                    for admin in full_channel.full_chat.admins:
                                                        if hasattr(admin, 'user_id') and admin.user_id == mod_user_entity.id:
                                                            admin_found = True
                                                            rank = getattr(admin, 'rank', 'N/A')
                                                            logger.info(f"     ✅ VERIFIED (Method 2): {phone} (ID: {mod_user_entity.id}) found in admin list with rank: {rank}")
                                                            break
                                                
                                                if not admin_found:
                                                    logger.error(f"     ❌ VERIFICATION FAILED (Method 2): {phone} (ID: {mod_user_entity.id}) NOT found in admin list")
                                                    logger.error(f"        This means the promotion did NOT work!")
                                                    logger.error(f"        Please check manually in Telegram if the user is now an admin")
                                            except Exception as method2_error:
                                                logger.warning(f"     ⚠️ Method 2 verification failed: {method2_error}")
                                    
                                    except Exception as verify_error:
                                        logger.error(f"     ❌ Could not verify promotion: {verify_error}")
                                        import traceback
                                        logger.error(traceback.format_exc())
                                    
                            except Exception as edit_error:
                                error_str = str(edit_error)
                                logger.error(f"❌ EditAdminRequest FAILED: {error_str}")
                                logger.error(f"     Error type: {type(edit_error).__name__}")
                                import traceback
                                logger.error(f"     Traceback:\n{traceback.format_exc()}")
                                failed_count += 1
                        
                        print("GROUP_ACTION_RESULT:")
                        print(json.dumps({"success": True, "promoted": promoted_count, "failed": failed_count}))
                    
                    else:
                        logger.error(f"❌ Unknown action: {action}")
                        print("GROUP_ACTION_RESULT:")
                        print(json.dumps({"success": False, "error": f"Unknown action: {action}"}))
                    
                finally:
                    # Disconnect all clients
                    for client in clients:
                        try:
                            await client.client.disconnect()
                        except:
                            pass
            
            # Run the async action
            try:
                loop.run_until_complete(run_action())
            except Exception as e:
                logger.error(f"❌ Action failed: {e}")
                import traceback
                logger.error(traceback.format_exc())
                print("GROUP_ACTION_RESULT:")
                print(json.dumps({"success": False, "error": str(e)}))
            
            sys.exit(0)
        
        # Log what we received
        logger.info(f"\n{'='*60}")
        logger.info(f"PYTHON SCRIPT RECEIVED DATA")
        logger.info(f"{'='*60}")
        logger.info(f"scripted_conversations type: {type(scripted_conversations)}")
        logger.info(f"scripted_conversations length: {len(scripted_conversations) if scripted_conversations else 0}")
        if scripted_conversations and len(scripted_conversations) > 0:
            logger.info(f"First conversation ID: {scripted_conversations[0].get('id', 'N/A')}")
            logger.info(f"First conversation participants: {scripted_conversations[0].get('participants', [])}")
        logger.info(f"{'='*60}\n")
        
        if not config_data:
            logger.error("No config provided")
            sys.exit(1)
        
        success = run_campaign(config_data, scripted_conversations)
        sys.exit(0 if success else 1)
        
    except KeyboardInterrupt:
        logger.info("\nCampaign stopped by user")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()



"""
Telegram Campaign Runner - Accepts JSON config from Node.js
Runs a single Telegram conversation campaign
"""
import json
import sys
import asyncio
import logging
import threading
import io
import os
import time
from datetime import datetime
# Set UTF-8 encoding for Windows compatibility
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

from telegram_user_client import TelegramUserClient
from telegram_campaign import TelegramCampaign
from config import Config
from telethon.tl.functions.channels import InviteToChannelRequest

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def initialize_clients(config_data):
    """Initialize Telegram clients based on config"""
    clients = []
    user_roles = {}
    user_is_mod = {}
    
    users = config_data.get('users', {})
    
    # Handle case where users might be a JSON string (double-stringified)
    if isinstance(users, str):
        try:
            users = json.loads(users)
            # If it's still a string after parsing, parse again (double-stringified)
            if isinstance(users, str):
                users = json.loads(users)
        except (json.JSONDecodeError, TypeError) as e:
            logger.error(f"Failed to parse users JSON: {e}")
            logger.error(f"Users value (first 200 chars): {str(users)[:200]}")
            users = {}
    
    # Ensure users is a dict
    if not isinstance(users, dict):
        logger.error(f"Users is not a dict, got type: {type(users)}")
        logger.error(f"Users value: {users}")
        users = {}
    
    # Get phone from config_data first, then fallback to hardcoded value
    CREATOR_PHONE = config_data.get('telegram_phone') or '+13124733150'
    logger.info(f"🔍 Initializing ONLY creator account: {CREATOR_PHONE}")
    logger.info(f"🔍 Ignoring all other users for now")
    
    # ONLY initialize the creator account
    phone = CREATOR_PHONE
    user_config = users.get(phone, {})
    
    if not user_config:
        # Create a default config for the creator
        user_config = {'enabled': True, 'role': 'dev'}
        logger.info(f"   Creator account not in users config, using defaults")
    
    try:
        # Get credentials from config_data first, then fallback to Config (env vars)
        api_id = config_data.get('telegram_api_id') or Config.TELEGRAM_API_ID
        api_hash = config_data.get('telegram_api_hash') or Config.TELEGRAM_API_HASH
        
        # If not in config_data, try TELEGRAM_USER_CREDENTIALS
        if not api_id or not api_hash:
            credentials = Config.TELEGRAM_USER_CREDENTIALS.get(phone, {})
            api_id = api_id or credentials.get('api_id', Config.TELEGRAM_API_ID)
            api_hash = api_hash or credentials.get('api_hash', Config.TELEGRAM_API_HASH)
        
        # Convert api_id to int
        try:
            api_id = int(api_id) if api_id else None
        except (ValueError, TypeError):
            logger.warning(f"Invalid API ID for {phone}, using default")
            api_id = Config.TELEGRAM_API_ID
        
        # Final check - if still None, raise error
        if not api_id or not api_hash:
            raise ValueError("Telegram API ID and API Hash are required. Get them from https://my.telegram.org/apps")
        
        # Create session name - match the format used by verify_account (just phone number without +)
        # Prefer the simple format (13124733150.session) as that's what verify_account creates
        phone_clean = phone.replace('+', '').replace('-', '').replace(' ', '')
        import os
        # Check in telegram directory (where script runs from)
        # Get the directory where this script is located
        try:
            script_dir = os.path.dirname(os.path.abspath(__file__))
        except:
            script_dir = os.getcwd()
        session_file_simple = os.path.join(script_dir, f"{phone_clean}.session")
        session_file_full = os.path.join(script_dir, f"user_session_{phone_clean}.session")
        
        # Prefer simple format (what verify_account creates), fallback to user_session format
        if os.path.exists(session_file_simple):
            session_name = phone_clean
            logger.info(f"   ✓ Using session file: {os.path.basename(session_file_simple)}")
        elif os.path.exists(session_file_full):
            session_name = f"user_session_{phone_clean}"
            logger.info(f"   ✓ Using session file: {os.path.basename(session_file_full)}")
        else:
            logger.warning(f"   ⚠️  No session file found for {phone} (checked {os.path.basename(session_file_simple)} and {os.path.basename(session_file_full)})")
            logger.warning(f"   Please verify this account first using the Verify button")
        
        # Get user tag from config
        user_tag = Config.TELEGRAM_USER_NAMES.get(phone, 'creator')
        
        # Create client
        client = TelegramUserClient(
            api_id=api_id,
            api_hash=api_hash,
            phone=phone,
            session_name=session_name,
            user_tag=user_tag
        )
        clients.append(client)
        
        # Store role and mod status
        user_roles[phone] = user_config.get('role', 'dev')
        user_is_mod[phone] = user_config.get('is_mod', False)
        logger.info(f"   ✓ Initialized creator account: [{user_tag}] {phone} (role: {user_roles[phone]}, mod: {user_is_mod[phone]})")
    except Exception as e:
        logger.error(f"Failed to initialize {phone}: {e}")
        import traceback
        logger.error(traceback.format_exc())
    
    # Verify creator was initialized
    creator_found = any(getattr(client, 'phone', None) == CREATOR_PHONE or 
                       getattr(client, 'phone', '').replace(' ', '').replace('-', '') == CREATOR_PHONE.replace(' ', '').replace('-', '')
                       for client in clients)
    if not creator_found:
        logger.warning(f"⚠️ Creator account ({CREATOR_PHONE}) was NOT initialized!")
        logger.warning(f"   Initialized clients: {[getattr(c, 'phone', 'unknown') for c in clients]}")
    else:
        logger.info(f"✅ Creator account ({CREATOR_PHONE}) was successfully initialized")
    
    return clients, user_roles, user_is_mod

def run_campaign(config_data, scripted_conversations):
    """Run the campaign"""
    # Import datetime at function level to avoid shadowing issues
    from datetime import datetime as dt
    
    clients, user_roles, user_is_mod = initialize_clients(config_data)
    
    # Create a dictionary mapping phone numbers to clients for easy lookup
    clients_by_phone = {getattr(client, 'phone', None): client for client in clients if hasattr(client, 'phone')}
    
    # Check if we're creating groups/channels or running a campaign
    create_group = config_data.get('create_group', False) or False
    create_channel = config_data.get('create_channel', False) or False
    create_portal = config_data.get('create_portal', False) or False
    reuse_existing = config_data.get('reuse_existing', False) or False
    
    # For group/channel/portal creation, only need 1 user (the creator)
    # For campaigns with scripted conversations, need at least 2 users
    is_group_creation_mode = create_group or create_channel or create_portal or reuse_existing
    has_scripted_conversations = scripted_conversations and len(scripted_conversations) > 0
    
    if not is_group_creation_mode and has_scripted_conversations:
        # Only require 2+ users for campaigns with scripted conversations
        if len(clients) < 2:
            logger.error(f"Need at least 2 enabled users for campaigns with scripted conversations (have {len(clients)})")
            return False
    elif len(clients) < 1:
        # Need at least 1 user (the creator)
        logger.error(f"Need at least 1 enabled user (have {len(clients)})")
        return False
    else:
        logger.info(f"✓ Using {len(clients)} user(s) - {'group/channel creation mode' if is_group_creation_mode else 'campaign mode'}")
    
    campaign_id = config_data.get('campaign_id', f"campaign_{dt.now().strftime('%Y%m%d_%H%M%S')}")
    chat_ids = config_data.get('chat_ids', [])
    
    # Log chat_ids received from frontend
    logger.info(f"\n{'='*60}")
    logger.info(f"CHAT IDS RECEIVED FROM FRONTEND")
    logger.info(f"{'='*60}")
    logger.info(f"chat_ids: {chat_ids}")
    logger.info(f"chat_ids type: {type(chat_ids)}")
    logger.info(f"chat_ids length: {len(chat_ids) if chat_ids else 0}")
    if chat_ids:
        for i, chat_id in enumerate(chat_ids):
            logger.info(f"  [{i}] {chat_id} (type: {type(chat_id)})")
    logger.info(f"{'='*60}\n")
    
    token_name = config_data.get('token_name', 'TOKEN')
    token_symbol = config_data.get('token_symbol', '$TOKEN')
    contract_name = config_data.get('contract_name', '')  # Contract name for username generation
    token_address = config_data.get('token_address', '')
    website = config_data.get('website', '')
    telegram = config_data.get('telegram', '')
    twitter = config_data.get('twitter', '')
    docs = config_data.get('docs', '')
    description = config_data.get('description', '')
    chain = config_data.get('chain', '')
    direction = config_data.get('direction', 'Telegram launch chat conversation')
    
    logger.info(f"\n{'='*60}")
    logger.info(f"STARTING CAMPAIGN: {campaign_id}")
    logger.info(f"{'='*60}")
    logger.info(f"Direction: {direction}")
    logger.info(f"Chat IDs: {chat_ids}")
    logger.info(f"Users: {len(clients)}")
    logger.info(f"Token: {token_name} ({token_symbol})")
    if token_address:
        logger.info(f"Contract: {token_address}")
    if website:
        logger.info(f"Website: {website}")
    if telegram:
        logger.info(f"Telegram: {telegram}")
    logger.info(f"{'='*60}\n")
    
    # Create a persistent event loop in a background thread
    loop = asyncio.new_event_loop()
    
    def run_event_loop():
        asyncio.set_event_loop(loop)
        loop.run_forever()
    
    loop_thread = threading.Thread(target=run_event_loop, daemon=True)
    loop_thread.start()
    
    CREATOR_PHONE = '+13124733150'  # Define here for use in connect_all
    
    async def connect_all():
        # Connect clients sequentially with delays to avoid database locked errors
        # Skip clients that require interactive authentication (can't use input() from Node.js)
        # BUT never skip the creator account - it must work
        connected_clients = []
        for idx, client in enumerate(clients):
            try:
                # Add delay between connections to avoid SQLite database lock conflicts
                if idx > 0:
                    await asyncio.sleep(0.5)  # 500ms delay between connections
                
                # Check if session file exists before trying to connect
                phone = getattr(client, 'phone', 'unknown')
                session_name = getattr(client, '_session_name', None)
                if session_name:
                    import os
                    # Check both possible session file locations
                    session_file = f"{session_name}.session"
                    phone_clean = phone.replace('+', '').replace('-', '').replace(' ', '')
                    session_file_simple = f"{phone_clean}.session"
                    
                    # Check if either session file exists
                    if not os.path.exists(session_file) and not os.path.exists(session_file_simple):
                        logger.warning(f"Skipping {phone}: No session file found (checked {session_file} and {session_file_simple}). User needs to verify account first using the Verify button.")
                        continue
                    elif os.path.exists(session_file_simple):
                        # Update client to use the simple format session file (preferred)
                        logger.info(f"Found session file {session_file_simple} for {phone}, updating client session name")
                        # Update the session name - the client will use this when connecting
                        if hasattr(client, '_session_name'):
                            client._session_name = phone_clean
                        if hasattr(client, 'session_name'):
                            client.session_name = phone_clean
                
                await client.connect()
                logger.info(f"✓ Connected {phone}")
                connected_clients.append(client)
            except (ValueError, EOFError) as e:
                error_msg = str(e)
                # Skip clients that need interactive authentication UNLESS it's the creator account
                phone = getattr(client, 'phone', 'unknown')
                is_creator = phone == CREATOR_PHONE or phone.replace(' ', '').replace('-', '') == CREATOR_PHONE.replace(' ', '').replace('-', '')
                
                if "EOF" in error_msg or "read" in error_msg.lower() or "input" in error_msg.lower():
                    if is_creator:
                        # Creator account MUST work - fail if it can't authenticate
                        logger.error(f"❌ Creator account {phone} requires authentication but cannot authenticate interactively.")
                        logger.error(f"   Session file may be invalid or expired.")
                        logger.error(f"   Please verify this account first using the Verify button in the Telegram Group Creator node.")
                        raise ValueError(f"Creator account {phone} authentication failed: {error_msg}")
                    else:
                        logger.warning(f"Skipping {phone}: Requires interactive authentication. Session file may be missing or expired. Please verify this account first using the Verify button.")
                        continue
                else:
                    logger.error(f"Failed to connect client {getattr(client, 'phone', 'unknown')}: {error_msg}")
                    import traceback
                    logger.error(traceback.format_exc())
            except Exception as e:
                error_msg = str(e)
                logger.error(f"Failed to connect client {getattr(client, 'phone', 'unknown')}: {error_msg}")
                # If database locked, wait longer and retry once
                if "database is locked" in error_msg.lower() or "locked" in error_msg.lower():
                    logger.warning(f"Database locked, waiting 2 seconds and retrying...")
                    await asyncio.sleep(2)
                    try:
                        await client.connect()
                        phone = getattr(client, 'phone', 'unknown')
                        logger.info(f"✓ Connected {phone} on retry")
                        connected_clients.append(client)
                    except Exception as e2:
                        logger.error(f"Retry failed for {getattr(client, 'phone', 'unknown')}: {e2}")
                        import traceback
                        logger.error(traceback.format_exc())
                else:
                    import traceback
                    logger.error(traceback.format_exc())
        
        # Update clients list to only include successfully connected clients
        clients.clear()
        clients.extend(connected_clients)
        logger.info(f"Successfully connected {len(clients)} out of {len(connected_clients) + (len(clients) - len(connected_clients))} client(s)")
    
    # Run connection in the persistent loop
    try:
        asyncio.run_coroutine_threadsafe(connect_all(), loop).result(timeout=60)
    except Exception as e:
        logger.error(f"Connection failed: {e}")
        return False
    
    # Pre-check: Verify all accounts can access the chat_ids
    async def verify_chat_access():
        """Verify all clients can access all chat_ids before starting campaign"""
        errors = []
        for client in clients:
            phone = getattr(client, 'phone', 'unknown')
            for chat_id in chat_ids:
                try:
                    await client.client.get_entity(int(chat_id))
                    logger.info(f"✓ {phone} can access chat {chat_id}")
                except Exception as e:
                    error_msg = (
                        f"❌ {phone} cannot access chat/channel {chat_id}\n"
                        f"   Error: {str(e)}\n"
                        f"   To fix: Make sure the Telegram account {phone} has joined the channel/group before running the campaign."
                    )
                    logger.error(error_msg)
                    errors.append((phone, chat_id, str(e)))
        return errors
    
    logger.info(f"\n{'='*60}")
    logger.info(f"VERIFYING CHAT ACCESS")
    logger.info(f"{'='*60}")
    try:
        access_errors = asyncio.run_coroutine_threadsafe(verify_chat_access(), loop).result(timeout=30)
        if access_errors:
            logger.warning(f"\n⚠️ Found {len(access_errors)} access error(s). Campaign may fail.")
            logger.warning("Please ensure all accounts have joined the channels/groups before running the campaign.")
            logger.warning("Proceeding anyway - campaign will attempt to run but may fail.\n")
            # Don't return False - let it try anyway, errors will be caught during actual message sending
        else:
            logger.info(f"✅ All accounts can access all chats\n")
    except Exception as e:
        logger.warning(f"Could not verify chat access: {e}")
        logger.warning("Proceeding anyway, but campaign may fail if accounts haven't joined channels.\n")
    
    # Check if we need to create or reuse a group/channel
    reuse_existing = config_data.get('reuse_existing', False) or False
    existing_group_chat_id = config_data.get('existing_group_chat_id', None)
    existing_channel_chat_id = config_data.get('existing_channel_chat_id', None)
    
    create_group = config_data.get('create_group', False) or False
    create_channel = config_data.get('create_channel', False) or False
    
    logger.info(f"🔍 Group/Channel mode check:")
    logger.info(f"   - reuse_existing: {reuse_existing}")
    logger.info(f"   - existing_group_chat_id: {existing_group_chat_id}")
    logger.info(f"   - existing_channel_chat_id: {existing_channel_chat_id}")
    logger.info(f"   - create_group: {create_group}")
    logger.info(f"   - create_channel: {create_channel}")
    create_portal = config_data.get('create_portal', False) or False
    safeguard_bot_username = config_data.get('safeguard_bot_username', '@safeguard')  # Default to @safeguard
    group_title_template = config_data.get('group_title_template', '{token_name}')
    group_description = config_data.get('group_description', '')
    channel_username = config_data.get('channel_username', None)  # Channel username (optional)
    contract_name = config_data.get('contract_name', '')  # Contract name for username generation
    group_photo_path = config_data.get('group_photo_path', None)
    group_photo_base64 = config_data.get('group_photo_base64', None)
    group_photo_filename = config_data.get('group_photo_filename', 'group_photo.png')
    token_image_url = config_data.get('token_image_url', None)  # Fallback: download from URL if base64 missing
    filter_script = config_data.get('filter_script', None)  # Filter commands to send after group creation
    group_settings = config_data.get('group_settings', {})
    
    created_group_chat_id = None
    created_channel_chat_id = None
    
    # Skip reuse logic if we're only doing portal setup (create_group=False, create_portal=True)
    # Portal setup doesn't need to access/reuse groups, it just needs the IDs
    # Note: token_address is NOT required for portal setup
    portal_only_mode = not create_group and create_portal
    
    if reuse_existing and not portal_only_mode:
        logger.info(f"\n{'='*60}")
        logger.info(f"REUSING EXISTING GROUP/CHANNEL")
        logger.info(f"{'='*60}")
        
        # Find creator account (phone: +13124733150) to manage groups/channels
        CREATOR_PHONE = '+13124733150'
        dev_client = None
        dev_phone = None
        
        # First try to find by specific phone number
        if CREATOR_PHONE in clients_by_phone:
            dev_client = clients_by_phone.get(CREATOR_PHONE)
            dev_phone = CREATOR_PHONE
        else:
            # Fallback: find dev account (role='dev')
            for phone, user_config in config_data.get('users', {}).items():
                if user_config.get('role') == 'dev':
                    dev_client = clients_by_phone.get(phone)
                    dev_phone = phone
                    break
        
        if not dev_client:
            logger.error(f"❌ Creator account ({CREATOR_PHONE}) not found. Cannot reuse group/channel.")
            return False
        
        logger.info(f"Using creator account to manage group/channel: {dev_phone}")
        
        # Prepare token info for updates
        token_name = config_data.get('token_name', 'TOKEN')
        token_symbol = config_data.get('token_symbol', '$TOKEN')
        contract_name = config_data.get('contract_name', '')  # Contract name for username generation
        final_title = group_title_template.replace('{token_name}', token_name).replace('{token_symbol}', token_symbol)
        final_description = group_description.replace('{token_name}', token_name).replace('{token_symbol}', token_symbol) if group_description else ''
        
        # Handle photo: Try base64 first, then URL download, then path
        final_photo_path = None
        if group_photo_base64:
            try:
                import base64
                # Extract base64 data (remove data:image/...;base64, prefix if present)
                base64_data = group_photo_base64
                if ',' in base64_data:
                    base64_data = base64_data.split(',')[1]
                
                photo_data = base64.b64decode(base64_data)
                
                # CRITICAL: Validate and resize image if too small
                # Telegram requires minimum 160x160 pixels
                try:
                    from PIL import Image
                    import io
                    
                    # Open image from bytes
                    img = Image.open(io.BytesIO(photo_data))
                    width, height = img.size
                    
                    logger.info(f"📸 Image dimensions: {width}x{height} pixels, size: {len(photo_data)} bytes")
                    
                    # Telegram minimum is 160x160, but we'll use 200x200 to be safe
                    min_size = 200
                    if width < min_size or height < min_size:
                        logger.warning(f"⚠️ Image too small ({width}x{height}), resizing to minimum {min_size}x{min_size}...")
                        # Resize maintaining aspect ratio, then crop to square
                        if width < height:
                            new_width = min_size
                            new_height = int(height * (min_size / width))
                        else:
                            new_height = min_size
                            new_width = int(width * (min_size / height))
                        
                        img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
                        # Crop to square
                        left = (new_width - min_size) // 2
                        top = (new_height - min_size) // 2
                        img = img.crop((left, top, left + min_size, top + min_size))
                        
                        # Convert to RGB if needed (for JPEG compatibility)
                        if img.mode != 'RGB':
                            img = img.convert('RGB')
                        
                        # Save resized image
                        output = io.BytesIO()
                        img.save(output, format='PNG', quality=95)
                        photo_data = output.getvalue()
                        logger.info(f"✅ Resized image to {min_size}x{min_size}, new size: {len(photo_data)} bytes")
                    else:
                        logger.info(f"✅ Image size OK ({width}x{height})")
                except ImportError:
                    logger.warning(f"⚠️ PIL/Pillow not available - cannot validate/resize image. Install with: pip install Pillow")
                except Exception as e:
                    logger.warning(f"⚠️ Could not validate/resize image: {e}. Using original image.")
                
                temp_dir = os.path.join(os.path.dirname(__file__), '..', 'temp', 'group_photos')
                os.makedirs(temp_dir, exist_ok=True)
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                extension = group_photo_filename.split('.')[-1] if '.' in group_photo_filename else 'png'
                photo_filename = f"{timestamp}_{group_photo_filename}"
                final_photo_path = os.path.join(temp_dir, photo_filename)
                with open(final_photo_path, 'wb') as f:
                    f.write(photo_data)
                logger.info(f"✅ Saved base64 photo to: {final_photo_path} ({len(photo_data)} bytes)")
            except Exception as e:
                logger.warning(f"⚠️ Could not save base64 photo: {e}. Will try URL download or photo_path.")
                final_photo_path = None  # Reset so we can try URL download
        
        # If base64 failed or missing, try downloading from token_image_url
        if not final_photo_path and token_image_url:
            try:
                import requests
                import os
                from datetime import datetime as dt
                
                logger.info(f"📥 Downloading token image from URL: {token_image_url}")
                response = requests.get(token_image_url, timeout=30)
                response.raise_for_status()
                
                image_data = response.content
                
                # CRITICAL: Validate and resize downloaded image if too small
                # Telegram requires minimum 160x160 pixels
                try:
                    from PIL import Image
                    import io
                    
                    # Open image from bytes
                    img = Image.open(io.BytesIO(image_data))
                    width, height = img.size
                    
                    logger.info(f"📸 Downloaded image dimensions: {width}x{height} pixels, size: {len(image_data)} bytes")
                    
                    # Telegram minimum is 160x160, but we'll use 200x200 to be safe
                    min_size = 200
                    if width < min_size or height < min_size:
                        logger.warning(f"⚠️ Downloaded image too small ({width}x{height}), resizing to minimum {min_size}x{min_size}...")
                        # Resize maintaining aspect ratio, then crop to square
                        if width < height:
                            new_width = min_size
                            new_height = int(height * (min_size / width))
                        else:
                            new_height = min_size
                            new_width = int(width * (min_size / height))
                        
                        img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
                        # Crop to square
                        left = (new_width - min_size) // 2
                        top = (new_height - min_size) // 2
                        img = img.crop((left, top, left + min_size, top + min_size))
                        
                        # Convert to RGB if needed (for JPEG compatibility)
                        if img.mode != 'RGB':
                            img = img.convert('RGB')
                        
                        # Save resized image
                        output = io.BytesIO()
                        img.save(output, format='PNG', quality=95)
                        image_data = output.getvalue()
                        logger.info(f"✅ Resized downloaded image to {min_size}x{min_size}, new size: {len(image_data)} bytes")
                    else:
                        logger.info(f"✅ Downloaded image size OK ({width}x{height})")
                except ImportError:
                    logger.warning(f"⚠️ PIL/Pillow not available - cannot validate/resize image. Install with: pip install Pillow")
                except Exception as e:
                    logger.warning(f"⚠️ Could not validate/resize downloaded image: {e}. Using original image.")
                
                # Create temp directory if it doesn't exist
                temp_dir = os.path.join(os.path.dirname(__file__), '..', 'temp', 'group_photos')
                os.makedirs(temp_dir, exist_ok=True)
                
                # Generate filename from URL or use default
                timestamp = dt.now().strftime('%Y%m%d_%H%M%S')
                # Try to get extension from URL
                url_extension = token_image_url.split('.')[-1].split('?')[0] if '.' in token_image_url else 'png'
                if url_extension not in ['png', 'jpg', 'jpeg', 'webp', 'gif']:
                    url_extension = 'png'
                photo_filename = f"{timestamp}_token_image.{url_extension}"
                final_photo_path = os.path.join(temp_dir, photo_filename)
                
                # Save downloaded image
                with open(final_photo_path, 'wb') as f:
                    f.write(image_data)
                
                logger.info(f"✅ Downloaded and saved token image to: {final_photo_path} ({len(image_data)} bytes)")
            except Exception as e:
                logger.warning(f"⚠️ Failed to download token image from URL: {e}. Will use photo_path if provided.")
                final_photo_path = group_photo_path  # Fallback to path if provided
        
        # Reuse group
        if existing_group_chat_id:
            logger.info(f"\n{'='*60}")
            logger.info(f"REUSING GROUP: {existing_group_chat_id}")
            logger.info(f"{'='*60}")
            
            try:
                async def reuse_group():
                    # Handle chat ID format: -1001234567890
                    # Telethon needs the entity to be in cache, so we need to access it first
                    chat_id_int = int(existing_group_chat_id)
                    try:
                        # First try: use the full negative ID directly
                        entity = await dev_client.client.get_entity(chat_id_int)
                    except ValueError as e:
                        # If entity not in cache, try to get dialogs first to populate cache
                        logger.info(f"Entity not in cache, fetching dialogs to populate cache...")
                        await dev_client.client.get_dialogs(limit=100)
                        # Now try again
                        try:
                            entity = await dev_client.client.get_entity(chat_id_int)
                        except Exception as e2:
                            # Last resort: try extracting channel ID for supergroups
                            if str(chat_id_int).startswith('-100'):
                                channel_id = abs(chat_id_int) - 1000000000000
                                from telethon.tl.types import PeerChannel
                                # Try to get from dialogs
                                async for dialog in dev_client.client.iter_dialogs():
                                    if hasattr(dialog.entity, 'id') and abs(dialog.entity.id) == abs(chat_id_int):
                                        entity = dialog.entity
                                        break
                                else:
                                    raise ValueError(f"Could not find group/channel {chat_id_int}. Make sure the dev account has joined it.")
                            else:
                                raise e2
                    
                    # STEP 1: Kick all users except dev account
                    logger.info("STEP 1: Kicking all users from group...")
                    me = await dev_client.client.get_me()
                    kicked_count = 0
                    async for participant in dev_client.client.iter_participants(entity):
                        if participant.id != me.id:  # Don't kick ourselves
                            try:
                                await dev_client.client.kick_participant(entity, participant)
                                kicked_count += 1
                                if kicked_count % 10 == 0:  # Log every 10 kicks
                                    logger.info(f"   Kicked {kicked_count} users...")
                                await asyncio.sleep(0.5)  # Small delay to avoid rate limits
                            except Exception as e:
                                logger.warning(f"   Could not kick user {participant.id}: {e}")
                    logger.info(f"✅ Kicked {kicked_count} users from group")
                    
                    # STEP 2: Update group title
                    logger.info(f"STEP 2: Updating group title to: {final_title}")
                    from telethon.tl.functions.channels import EditTitleRequest
                    await dev_client.client(EditTitleRequest(channel=entity, title=final_title))
                    logger.info("✅ Group title updated")
                    
                    # STEP 3: Update group description
                    if final_description:
                        logger.info(f"STEP 3: Updating group description")
                        await dev_client.client.edit_channel(entity, about=final_description)
                        logger.info("✅ Group description updated")
                    
                    # STEP 4: Update group photo
                    if final_photo_path and os.path.exists(final_photo_path):
                        logger.info(f"STEP 4: Updating group photo")
                        from telethon.tl.functions.channels import EditPhotoRequest
                        from telethon.tl.types import InputChatUploadedPhoto
                        from telethon.errors import FloodWaitError
                        try:
                            photo = await dev_client.client.upload_file(final_photo_path)
                            await dev_client.client(EditPhotoRequest(
                                channel=entity,
                                photo=InputChatUploadedPhoto(file=photo)
                            ))
                            logger.info("✅ Group photo updated")
                        except FloodWaitError as e:
                            wait_time = e.seconds
                            logger.warning(f"⚠️ Rate limited: Waiting {wait_time} seconds...")
                            await asyncio.sleep(wait_time)
                            photo = await dev_client.client.upload_file(final_photo_path)
                            await dev_client.client(EditPhotoRequest(
                                channel=entity,
                                photo=InputChatUploadedPhoto(file=photo)
                            ))
                            logger.info("✅ Group photo updated after wait")
                    
                    return {'success': True, 'chat_id': int(existing_group_chat_id)}
                
                # Ensure dev_client uses the same event loop
                if hasattr(dev_client, '_event_loop'):
                    dev_client._event_loop = loop
                group_result = asyncio.run_coroutine_threadsafe(reuse_group(), loop).result(timeout=600)
                if group_result.get('success'):
                    created_group_chat_id = group_result.get('chat_id')
                    logger.info(f"✅ Group reused successfully: {created_group_chat_id}")
            except Exception as e:
                logger.error(f"❌ Error reusing group: {e}")
                import traceback
                logger.error(traceback.format_exc())
        
        # Reuse channel
        if existing_channel_chat_id:
            logger.info(f"\n{'='*60}")
            logger.info(f"REUSING CHANNEL: {existing_channel_chat_id}")
            logger.info(f"{'='*60}")
            
            try:
                async def reuse_channel():
                    # Handle chat ID format: -1001234567890
                    # Telethon needs the entity to be in cache, so we need to access it first
                    chat_id_int = int(existing_channel_chat_id)
                    try:
                        # First try: use the full negative ID directly
                        entity = await dev_client.client.get_entity(chat_id_int)
                    except ValueError as e:
                        # If entity not in cache, try to get dialogs first to populate cache
                        logger.info(f"Entity not in cache, fetching dialogs to populate cache...")
                        await dev_client.client.get_dialogs(limit=100)
                        # Now try again
                        try:
                            entity = await dev_client.client.get_entity(chat_id_int)
                        except Exception as e2:
                            # Last resort: try extracting channel ID for supergroups
                            if str(chat_id_int).startswith('-100'):
                                channel_id = abs(chat_id_int) - 1000000000000
                                from telethon.tl.types import PeerChannel
                                # Try to get from dialogs
                                async for dialog in dev_client.client.iter_dialogs():
                                    if hasattr(dialog.entity, 'id') and abs(dialog.entity.id) == abs(chat_id_int):
                                        entity = dialog.entity
                                        break
                                else:
                                    raise ValueError(f"Could not find channel {chat_id_int}. Make sure the dev account has joined it.")
                            else:
                                raise e2
                    
                    # STEP 1: Kick all users except dev account
                    logger.info("STEP 1: Kicking all users from channel...")
                    me = await dev_client.client.get_me()
                    kicked_count = 0
                    async for participant in dev_client.client.iter_participants(entity):
                        if participant.id != me.id:  # Don't kick ourselves
                            try:
                                await dev_client.client.kick_participant(entity, participant)
                                kicked_count += 1
                                if kicked_count % 10 == 0:
                                    logger.info(f"   Kicked {kicked_count} users...")
                                await asyncio.sleep(0.5)
                            except Exception as e:
                                logger.warning(f"   Could not kick user {participant.id}: {e}")
                    logger.info(f"✅ Kicked {kicked_count} users from channel")
                    
                    # STEP 2: Update channel title
                    logger.info(f"STEP 2: Updating channel title to: {final_title}")
                    from telethon.tl.functions.channels import EditTitleRequest
                    await dev_client.client(EditTitleRequest(channel=entity, title=final_title))
                    logger.info("✅ Channel title updated")
                    
                    # STEP 3: Update channel description
                    if final_description:
                        logger.info(f"STEP 3: Updating channel description")
                        await dev_client.client.edit_channel(entity, about=final_description)
                        logger.info("✅ Channel description updated")
                    
                    # STEP 4: Update channel photo
                    if final_photo_path and os.path.exists(final_photo_path):
                        logger.info(f"STEP 4: Updating channel photo")
                        from telethon.tl.functions.channels import EditPhotoRequest
                        from telethon.tl.types import InputChatUploadedPhoto
                        from telethon.errors import FloodWaitError
                        try:
                            photo = await dev_client.client.upload_file(final_photo_path)
                            await dev_client.client(EditPhotoRequest(
                                channel=entity,
                                photo=InputChatUploadedPhoto(file=photo)
                            ))
                            logger.info("✅ Channel photo updated")
                        except FloodWaitError as e:
                            wait_time = e.seconds
                            logger.warning(f"⚠️ Rate limited: Waiting {wait_time} seconds...")
                            await asyncio.sleep(wait_time)
                            photo = await dev_client.client.upload_file(final_photo_path)
                            await dev_client.client(EditPhotoRequest(
                                channel=entity,
                                photo=InputChatUploadedPhoto(file=photo)
                            ))
                            logger.info("✅ Channel photo updated after wait")
                    
                    # STEP 5: Update channel username
                    if channel_username or token_symbol:
                        logger.info(f"STEP 5: Updating channel username")
                        from telethon.tl.functions.channels import UpdateUsernameRequest, CheckUsernameRequest
                        
                        # Generate username variations
                        # Use contract_name if available, otherwise fallback to token_name
                        if not channel_username:
                            # Generate base username from contract name (preferred), then token name, then symbol
                            contract_name = config_data.get('contract_name', '')
                            if contract_name:
                                base_name = contract_name.lower().replace(' ', '').replace('-', '').replace('_', '')
                            else:
                                base_name = token_name.lower().replace(' ', '').replace('-', '').replace('_', '')
                            
                            if not base_name or len(base_name) < 3:
                                base_name = token_symbol.replace('$', '').lower()
                            
                            # Username variations: name, name_tg, name_chat, name_group
                            username_variations = [
                                base_name,  # Just contract name
                                f"{base_name}_tg",  # name_tg
                                f"{base_name}_chat",  # name_chat
                                f"{base_name}_group",  # name_group
                            ]
                        else:
                            username_variations = [channel_username.replace('@', '')]
                        
                        final_channel_username = None
                        for username_variant in username_variations:
                            username_variant = username_variant.replace('@', '').lower().strip()
                            if len(username_variant) < 5 or len(username_variant) > 32:
                                continue
                            
                            try:
                                # Check if available
                                check_result = await dev_client.client(CheckUsernameRequest(
                                    channel=entity,
                                    username=username_variant
                                ))
                                
                                if check_result:
                                    # Set username
                                    await dev_client.client(UpdateUsernameRequest(
                                        channel=entity,
                                        username=username_variant
                                    ))
                                    final_channel_username = username_variant
                                    logger.info(f"✅ Channel username set to: @{final_channel_username}")
                                    break
                            except Exception as e:
                                continue
                        
                        if not final_channel_username:
                            logger.warning("⚠️ Could not set channel username")
                    
                    return {'success': True, 'chat_id': int(existing_channel_chat_id), 'username': final_channel_username}
                
                channel_result = asyncio.run_coroutine_threadsafe(reuse_channel(), loop).result(timeout=600)
                if channel_result.get('success'):
                    created_channel_chat_id = channel_result.get('chat_id')
                    logger.info(f"✅ Channel reused successfully: {created_channel_chat_id}")
            except Exception as e:
                logger.error(f"❌ Error reusing channel: {e}")
                import traceback
                logger.error(traceback.format_exc())
        
        # Output result for reuse mode (same format as creation mode)
        if reuse_existing and (created_group_chat_id or created_channel_chat_id):
            logger.info(f"\n{'='*60}")
            logger.info(f"GROUP/CHANNEL REUSE COMPLETE")
            logger.info(f"{'='*60}")
            logger.info(f"Using created group and channel: {created_group_chat_id}, {created_channel_chat_id}")
            
            # Get telegram link for channel if it has username
            telegram_link = None
            if created_channel_chat_id:
                try:
                    async def get_channel_link():
                        entity = await dev_client.client.get_entity(int(created_channel_chat_id))
                        if hasattr(entity, 'username') and entity.username:
                            return f"https://t.me/{entity.username.replace('@', '')}"
                        return None
                    telegram_link = asyncio.run_coroutine_threadsafe(get_channel_link(), loop).result(timeout=10)
                except Exception as e:
                    logger.warning(f"Could not get channel link: {e}")
            
            # Output GROUP_CREATOR_RESULT JSON (same format as creation mode)
            output_data = {
                "success": True,
                "group_chat_id": str(created_group_chat_id) if created_group_chat_id else None,
                "channel_chat_id": str(created_channel_chat_id) if created_channel_chat_id else None,
                "telegram_link": telegram_link,
                "portal_created": False
            }
            print(f"\n{'='*60}")
            print("GROUP_CREATOR_RESULT:")
            print(json.dumps(output_data))
            print(f"{'='*60}\n")
            return True
    
    elif create_group or portal_only_mode:
        if portal_only_mode:
            logger.info(f"\n{'='*60}")
            logger.info(f"PORTAL-ONLY MODE: Skipping group/channel creation/reuse")
            logger.info(f"{'='*60}")
            logger.info(f"Will use existing IDs for portal setup:")
            logger.info(f"  - Group ID: {existing_group_chat_id}")
            logger.info(f"  - Channel ID: {existing_channel_chat_id}")
        else:
            logger.info(f"\n{'='*60}")
            logger.info(f"CREATING TELEGRAM GROUP/CHANNEL")
            logger.info(f"{'='*60}")
        
        # Skip group creation if portal-only mode
        if portal_only_mode:
            # In portal-only mode, skip all group/channel creation/reuse
            # Portal setup will happen at the end using existing IDs
            logger.info("Portal-only mode: Skipping group/channel operations, will proceed to portal setup")
        else:
            # Find creator account - use phone from config_data or fallback to hardcoded
            CREATOR_PHONE = config_data.get('telegram_phone') or '+13124733150'
            dev_client = None
            dev_phone = None
            
            # First try to find by specific phone number (from config_data)
            for client in clients:
                if getattr(client, 'phone', None) == CREATOR_PHONE:
                    # Use the client if found, even if not in users config (for group creator mode)
                    dev_client = client
                    dev_phone = CREATOR_PHONE
                    logger.info(f"Found creator account by phone: {CREATOR_PHONE}")
                    break
            
            # Fallback: find dev account (role='dev') in users config
            if not dev_client:
                for phone, user_config in config_data.get('users', {}).items():
                    if user_config.get('role') == 'dev' and user_config.get('enabled', False):
                        # Find corresponding client
                        for client in clients:
                            if getattr(client, 'phone', None) == phone:
                                dev_client = client
                                dev_phone = phone
                                logger.info(f"Found creator account by role='dev': {phone}")
                                break
                        if dev_client:
                            break
            
            # Final fallback: use first client if only one exists (group creator mode)
            if not dev_client and len(clients) == 1:
                dev_client = clients[0]
                dev_phone = getattr(dev_client, 'phone', None) or CREATOR_PHONE
                logger.info(f"Using single available client as creator: {dev_phone}")
            
            if not dev_client:
                logger.error(f"No creator account found ({CREATOR_PHONE} or role='dev'). Cannot create group.")
                logger.error(f"Available clients: {[getattr(c, 'phone', 'unknown') for c in clients]}")
                return False
            
            logger.info(f"Using creator account to create group/channel: {dev_phone}")
        
        # Replace placeholders in group title
        group_title = group_title_template.replace('{token_name}', token_name)
        group_title = group_title.replace('{token_symbol}', token_symbol)
        
        # Replace placeholders in description
        final_description = group_description.replace('{token_name}', token_name)
        final_description = final_description.replace('{token_symbol}', token_symbol)
        final_description = final_description.replace('{description}', description)
        final_description = final_description.replace('{website}', website)
        final_description = final_description.replace('{telegram}', telegram)
        final_description = final_description.replace('{twitter}', twitter)
        final_description = final_description.replace('{chain}', chain)
        
        logger.info(f"Group title: {group_title}")
        if final_description:
            logger.info(f"Group description: {final_description[:100]}...")
        
        # Handle photo: Save base64 to file if provided, otherwise use path
        final_photo_path = group_photo_path
        if group_photo_base64:
            try:
                import base64
                import os
                # datetime is already imported at module level
                
                # Create temp directory if it doesn't exist
                temp_dir = os.path.join(os.path.dirname(__file__), '..', 'temp', 'group_photos')
                os.makedirs(temp_dir, exist_ok=True)
                
                # Extract base64 data (remove data:image/...;base64, prefix if present)
                base64_data = group_photo_base64
                if ',' in base64_data:
                    base64_data = base64_data.split(',')[1]
                
                photo_data = base64.b64decode(base64_data)
                
                # CRITICAL: Validate and resize image if too small
                # Telegram requires minimum 160x160 pixels
                try:
                    from PIL import Image
                    import io
                    
                    # Open image from bytes
                    img = Image.open(io.BytesIO(photo_data))
                    width, height = img.size
                    
                    logger.info(f"📸 Image dimensions: {width}x{height} pixels, size: {len(photo_data)} bytes")
                    
                    # Telegram minimum is 160x160, but we'll use 200x200 to be safe
                    min_size = 200
                    if width < min_size or height < min_size:
                        logger.warning(f"⚠️ Image too small ({width}x{height}), resizing to minimum {min_size}x{min_size}...")
                        # Resize maintaining aspect ratio, then crop to square
                        if width < height:
                            new_width = min_size
                            new_height = int(height * (min_size / width))
                        else:
                            new_height = min_size
                            new_width = int(width * (min_size / height))
                        
                        img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
                        # Crop to square
                        left = (new_width - min_size) // 2
                        top = (new_height - min_size) // 2
                        img = img.crop((left, top, left + min_size, top + min_size))
                        
                        # Convert to RGB if needed (for JPEG compatibility)
                        if img.mode != 'RGB':
                            img = img.convert('RGB')
                        
                        # Save resized image
                        output = io.BytesIO()
                        img.save(output, format='PNG', quality=95)
                        photo_data = output.getvalue()
                        logger.info(f"✅ Resized image to {min_size}x{min_size}, new size: {len(photo_data)} bytes")
                    else:
                        logger.info(f"✅ Image size OK ({width}x{height})")
                except ImportError:
                    logger.warning(f"⚠️ PIL/Pillow not available - cannot validate/resize image. Install with: pip install Pillow")
                except Exception as e:
                    logger.warning(f"⚠️ Could not validate/resize image: {e}. Using original image.")
                
                # Generate filename
                from datetime import datetime as dt
                timestamp = dt.now().strftime('%Y%m%d_%H%M%S')
                extension = group_photo_filename.split('.')[-1] if '.' in group_photo_filename else 'png'
                photo_filename = f"{timestamp}_{group_photo_filename}"
                final_photo_path = os.path.join(temp_dir, photo_filename)
                
                # Save base64 to file
                with open(final_photo_path, 'wb') as f:
                    f.write(photo_data)
                
                logger.info(f"✅ Saved base64 photo to: {final_photo_path} ({len(photo_data)} bytes)")
            except Exception as e:
                logger.warning(f"⚠️ Failed to save base64 photo: {e}. Will try URL download or photo_path.")
                final_photo_path = None  # Reset so we can try URL download
        
        # If base64 failed or missing, try downloading from token_image_url
        if not final_photo_path and token_image_url:
            try:
                import requests
                import os
                from datetime import datetime as dt
                
                logger.info(f"📥 Downloading token image from URL: {token_image_url}")
                response = requests.get(token_image_url, timeout=30)
                response.raise_for_status()
                
                image_data = response.content
                
                # CRITICAL: Validate and resize downloaded image if too small
                # Telegram requires minimum 160x160 pixels
                try:
                    from PIL import Image
                    import io
                    
                    # Open image from bytes
                    img = Image.open(io.BytesIO(image_data))
                    width, height = img.size
                    
                    logger.info(f"📸 Downloaded image dimensions: {width}x{height} pixels, size: {len(image_data)} bytes")
                    
                    # Telegram minimum is 160x160, but we'll use 200x200 to be safe
                    min_size = 200
                    if width < min_size or height < min_size:
                        logger.warning(f"⚠️ Downloaded image too small ({width}x{height}), resizing to minimum {min_size}x{min_size}...")
                        # Resize maintaining aspect ratio, then crop to square
                        if width < height:
                            new_width = min_size
                            new_height = int(height * (min_size / width))
                        else:
                            new_height = min_size
                            new_width = int(width * (min_size / height))
                        
                        img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
                        # Crop to square
                        left = (new_width - min_size) // 2
                        top = (new_height - min_size) // 2
                        img = img.crop((left, top, left + min_size, top + min_size))
                        
                        # Convert to RGB if needed (for JPEG compatibility)
                        if img.mode != 'RGB':
                            img = img.convert('RGB')
                        
                        # Save resized image
                        output = io.BytesIO()
                        img.save(output, format='PNG', quality=95)
                        image_data = output.getvalue()
                        logger.info(f"✅ Resized downloaded image to {min_size}x{min_size}, new size: {len(image_data)} bytes")
                    else:
                        logger.info(f"✅ Downloaded image size OK ({width}x{height})")
                except ImportError:
                    logger.warning(f"⚠️ PIL/Pillow not available - cannot validate/resize image. Install with: pip install Pillow")
                except Exception as e:
                    logger.warning(f"⚠️ Could not validate/resize downloaded image: {e}. Using original image.")
                
                # Create temp directory if it doesn't exist
                temp_dir = os.path.join(os.path.dirname(__file__), '..', 'temp', 'group_photos')
                os.makedirs(temp_dir, exist_ok=True)
                
                # Generate filename from URL or use default
                timestamp = dt.now().strftime('%Y%m%d_%H%M%S')
                # Try to get extension from URL
                url_extension = token_image_url.split('.')[-1].split('?')[0] if '.' in token_image_url else 'png'
                if url_extension not in ['png', 'jpg', 'jpeg', 'webp', 'gif']:
                    url_extension = 'png'
                photo_filename = f"{timestamp}_token_image.{url_extension}"
                final_photo_path = os.path.join(temp_dir, photo_filename)
                
                # Save downloaded image
                with open(final_photo_path, 'wb') as f:
                    f.write(image_data)
                
                logger.info(f"✅ Downloaded and saved token image to: {final_photo_path} ({len(image_data)} bytes)")
            except Exception as e:
                logger.warning(f"⚠️ Failed to download token image from URL: {e}. Will use photo_path if provided.")
                final_photo_path = group_photo_path  # Fallback to path if provided
        
        # IMPORTANT: If create_channel is true, we want to create BOTH a group AND a channel
        # So the first block should ALWAYS create a GROUP (not a channel)
        # The channel will be created separately in the create_channel block
        # Only use is_channel=true if create_channel is false (meaning we only want one thing)
        is_channel_for_group = False  # Always create a group in the first block
        if not create_channel:
            # If we're not creating a separate channel, check if user wants a channel instead of group
            is_channel_for_group = config_data.get('group_is_channel', False)
        
        # Use Telethon directly for group/channel creation
        # Skip if portal-only mode (we'll handle portal setup separately)
        if not portal_only_mode:
            try:
                entity_type = 'channel' if is_channel_for_group else 'group'
                logger.info(f"🔵 STEP 1: Creating {entity_type} via Telethon (direct)")
                logger.info(f"   - is_channel parameter: {is_channel_for_group}")
                logger.info(f"   - create_channel flag: {create_channel}")
                logger.info(f"   - Will create {'CHANNEL' if is_channel_for_group else 'GROUP'}")
                # STEP 1: Create group WITHOUT photo first (we'll upload photo after)
                logger.info(f"\n{'='*60}")
                logger.info(f"STEP 1: CREATING GROUP")
                logger.info(f"{'='*60}")
                # Use async version directly with the persistent event loop to avoid event loop conflicts
                async def create_group_async():
                    await dev_client._ensure_connected()
                    return await dev_client.create_group_async(
                        title=group_title,
                        description=final_description if final_description else None,
                        photo_path=None,  # Upload photo after creation
                        is_channel=is_channel_for_group,  # False if creating group+channel, True if only channel
                        is_megagroup=config_data.get('group_is_megagroup', True)
                    )
                
                result = asyncio.run_coroutine_threadsafe(create_group_async(), loop).result(timeout=600)
                logger.info(f"   - Result: {result.get('success')}, chat_id: {result.get('chat_id')}")
                
                # Add delay to avoid rate limits
                logger.info(f"⏳ Waiting 2 seconds before next step...")
                time.sleep(2)
                
                if result.get('success'):
                    created_group_chat_id = result.get('chat_id')
                    group_username = result.get('username')  # Username if channel has one
                    
                    # STEP 2: Upload group photo
                    logger.info(f"\n{'='*60}")
                    logger.info(f"STEP 2: CHECKING GROUP PHOTO")
                    logger.info(f"{'='*60}")
                    logger.info(f"   - final_photo_path: {final_photo_path}")
                    logger.info(f"   - final_photo_path exists: {final_photo_path and os.path.exists(final_photo_path) if final_photo_path else False}")
                    if final_photo_path:
                        logger.info(f"   - Photo file size: {os.path.getsize(final_photo_path)} bytes" if os.path.exists(final_photo_path) else "   - Photo file does NOT exist")
                    
                    if final_photo_path and os.path.exists(final_photo_path):
                        logger.info(f"\n{'='*60}")
                        logger.info(f"STEP 2: UPLOADING GROUP PHOTO")
                        logger.info(f"{'='*60}")
                        try:
                            logger.info(f"Uploading group photo: {final_photo_path}")
                            async def upload_group_photo():
                                entity = await dev_client.client.get_entity(created_group_chat_id)
                                from telethon.tl.functions.channels import EditPhotoRequest
                                from telethon.tl.types import InputChatUploadedPhoto
                                from telethon.errors import FloodWaitError
                                
                                try:
                                    photo = await dev_client.client.upload_file(final_photo_path)
                                    await dev_client.client(EditPhotoRequest(
                                        channel=entity,
                                        photo=InputChatUploadedPhoto(file=photo)
                                    ))
                                    logger.info(f"✅ Group photo uploaded successfully")
                                    return {'success': True}
                                except FloodWaitError as e:
                                    wait_time = e.seconds
                                    logger.warning(f"⚠️ Rate limited: Need to wait {wait_time} seconds before uploading group photo")
                                    logger.info(f"⏳ Waiting {wait_time} seconds (Telegram rate limit)...")
                                    await asyncio.sleep(wait_time)
                                    # Retry after waiting
                                    logger.info(f"Retrying group photo upload...")
                                    photo = await dev_client.client.upload_file(final_photo_path)
                                    await dev_client.client(EditPhotoRequest(
                                        channel=entity,
                                        photo=InputChatUploadedPhoto(file=photo)
                                    ))
                                    logger.info(f"✅ Group photo uploaded successfully after wait")
                                    return {'success': True}
                            
                            photo_result = asyncio.run_coroutine_threadsafe(upload_group_photo(), loop).result(timeout=600)  # Increased timeout for flood wait
                            if photo_result.get('success'):
                                logger.info(f"✅ Group photo set successfully")
                            else:
                                logger.error(f"❌ Failed to set group photo: {photo_result.get('error')}")
                        except Exception as e:
                            logger.error(f"❌ Error setting group photo: {e}")
                            import traceback
                            logger.error(traceback.format_exc())
                    else:
                        logger.error(f"❌ CANNOT UPLOAD GROUP PHOTO: final_photo_path is {'None' if not final_photo_path else 'set but file does not exist'}")
                        logger.error(f"   - final_photo_path: {final_photo_path}")
                        logger.error(f"   - group_photo_base64 was provided: {bool(group_photo_base64)}")
                        logger.error(f"   - token_image_url was provided: {bool(token_image_url)}")
                        logger.error(f"   - group_photo_path was provided: {bool(group_photo_path)}")
                    
                    # Add delay to avoid rate limits
                    logger.info(f"⏳ Waiting 2 seconds before next step...")
                    time.sleep(2)
                
                # STEP 3: Skip anonymous for now - will enable AFTER users are invited (STEP 5)
                logger.info(f"\n{'='*60}")
                logger.info(f"STEP 3: SKIPPING 'REMAIN ANONYMOUS' - Will enable AFTER users are invited (STEP 5)")
                logger.info(f"{'='*60}")
                
                # Verify what type of entity was actually created
                try:
                    async def verify_entity_type():
                        entity = await dev_client.client.get_entity(created_group_chat_id)
                        is_channel_entity = hasattr(entity, 'broadcast') and entity.broadcast
                        entity_type = 'CHANNEL' if is_channel_entity else 'GROUP'
                        logger.info(f"✅ Verified entity type: {entity_type} (ID: {created_group_chat_id})")
                        return entity_type
                    entity_type = asyncio.run_coroutine_threadsafe(verify_entity_type(), loop).result(timeout=10)
                    if entity_type == 'CHANNEL' and not is_channel_for_group:
                        logger.error(f"❌ ERROR: Created a CHANNEL but we expected a GROUP!")
                    elif entity_type == 'GROUP' and is_channel_for_group:
                        logger.error(f"❌ ERROR: Created a GROUP but we expected a CHANNEL!")
                except Exception as e:
                    logger.warning(f"Could not verify entity type: {e}")
                
                logger.info(f"✅ Created {'channel' if is_channel_for_group else 'group'} via Telethon: (ID: {created_group_chat_id})")
                
                # NOTE: Group is private - we don't change its name/username
                # Only the CHANNEL gets updated with token branding (done in STEP 6 below)
                logger.info(f"✅ Created group: {group_title} (ID: {created_group_chat_id}) - Group is private, no name/username changes")
                
                # Try to get invite link or username for telegram link
                telegram_link = None
                try:
                    if group_username:
                        # Channel with username
                        telegram_link = f"https://t.me/{group_username.replace('@', '')}"
                    else:
                        # Group/channel without username - try to export invite link
                        async def get_invite_link():
                            entity = await dev_client.client.get_entity(created_group_chat_id)
                            try:
                                # Try channels module first
                                from telethon.tl.functions.channels import ExportInviteRequest
                                invite_link = await dev_client.client(ExportInviteRequest(entity))
                                return invite_link.link
                            except:
                                try:
                                    # Fallback to messages module
                                    from telethon.tl.functions.messages import ExportChatInviteLinkRequest
                                    invite_link = await dev_client.client(ExportChatInviteLinkRequest(entity))
                                    return invite_link.link
                                except Exception as e:
                                    logger.warning(f"Could not export invite link: {e}")
                                    return None
                        
                        invite_link = asyncio.run_coroutine_threadsafe(get_invite_link(), loop).result(timeout=10)
                        if invite_link:
                            telegram_link = invite_link
                except Exception as e:
                    logger.warning(f"Could not get Telegram link: {e}")
                
                if telegram_link:
                    logger.info(f"Telegram link: {telegram_link}")
                
                # Configure settings if provided
                if group_settings:
                    logger.info("Configuring group settings...")
                    settings_result = dev_client.configure_group_settings(created_group_chat_id, group_settings)
                    if settings_result.get('success'):
                        logger.info("✅ Group settings configured")
                    else:
                        logger.warning(f"Failed to configure settings: {settings_result.get('error')}")
                
                # Determine which users to invite
                # Check if we should invite user1/user2 (only after token launch)
                invite_user1_user2 = config_data.get('invite_user1_user2_after_launch', False)
                token_address = config_data.get('token_address', '')
                token_verified = config_data.get('token_verified', False)
                
                # If conditional joining is enabled, only invite user1/user2 if token is live
                should_invite_user1_user2 = True
                if invite_user1_user2:
                    should_invite_user1_user2 = bool(token_address and token_verified)
                    if not should_invite_user1_user2:
                        logger.info("Token not live yet - user1/user2 will join later (conditional joining enabled)")
                
                # Get users to invite from config, or default to all except dev
                users_to_invite_roles = config_data.get('invite_users', [])
                if not users_to_invite_roles:
                    # Default: invite all except dev
                    users_to_invite_roles = ['mod', 'user1', 'user2']
                
                # Filter user1/user2 if conditional joining
                if not should_invite_user1_user2:
                    users_to_invite_roles = [r for r in users_to_invite_roles if r not in ['user1', 'user2']]
                    logger.info(f"Conditional joining: Filtered out user1/user2. Inviting roles: {users_to_invite_roles}")
                
                # Get clients for users to invite
                other_clients = []
                for phone, user_config in config_data.get('users', {}).items():
                    user_role = user_config.get('role', '')
                    if user_role in users_to_invite_roles and user_config.get('enabled', False):
                        for client in clients:
                            if getattr(client, 'phone', None) == phone:
                                other_clients.append(client)
                                break
                
                if other_clients:
                    logger.info(f"Inviting {len(other_clients)} users to group...")
                    # Get user entities from clients
                    async def get_user_entities():
                        user_entities = []
                        for client in other_clients:
                            try:
                                # Get the user's own entity
                                me = await client.client.get_me()
                                user_entities.append(me)
                            except Exception as e:
                                logger.warning(f"Could not get entity for {getattr(client, 'phone', 'unknown')}: {e}")
                        return user_entities
                    
                    try:
                        user_entities = asyncio.run_coroutine_threadsafe(get_user_entities(), loop).result(timeout=30)
                        
                        if user_entities:
                            async def invite_users():
                                entity = await dev_client.client.get_entity(created_group_chat_id)
                                await dev_client.client(InviteToChannelRequest(
                                    channel=entity,
                                    users=user_entities
                                ))
                                return len(user_entities)
                            
                            invited_count = asyncio.run_coroutine_threadsafe(invite_users(), loop).result(timeout=30)
                            logger.info(f"✅ Invited {invited_count} users to group")
                            
                            # Wait for users to join AND load participants (CRITICAL for Telegram sync)
                            logger.info(f"⏳ Waiting 3 seconds for users to join...")
                            time.sleep(3)
                            
                            # STEP 3.5: Promote mod users to admin RIGHT AFTER they join
                            logger.info(f"\n{'='*60}")
                            logger.info(f"STEP 3.5: PROMOTING MOD USERS TO ADMIN (AFTER JOINING)")
                            logger.info(f"{'='*60}")
                            
                            async def promote_mods_after_join():
                                entity = await dev_client.client.get_entity(created_group_chat_id)
                                
                                # CRITICAL: Load participants first to ensure Telegram has synced user status
                                logger.info(f"  🔍 Loading participants to sync user status...")
                                try:
                                    await dev_client.client.get_participants(entity, limit=100)
                                    logger.info(f"  ✅ Participants loaded")
                                    await asyncio.sleep(2)  # Wait for Telegram to fully sync
                                except Exception as e:
                                    logger.warning(f"  ⚠️ Could not load participants: {e}")
                                    await asyncio.sleep(2)  # Still wait even if load fails
                                
                                # Verify creator is owner and has "Add Admins" permission
                                logger.info(f"  🔍 Verifying creator permissions...")
                                try:
                                    from telethon.tl.functions.channels import GetParticipantRequest
                                    creator_me = await dev_client.client.get_me()
                                    creator_participant = await dev_client.client(GetParticipantRequest(
                                        channel=entity,
                                        participant=creator_me
                                    ))
                                    
                                    from telethon.tl.types import ChannelParticipantCreator, ChannelParticipantAdmin
                                    is_owner = isinstance(creator_participant.participant, ChannelParticipantCreator)
                                    
                                    if is_owner:
                                        logger.info(f"  ✅ Creator is group owner (has full permissions)")
                                    elif isinstance(creator_participant.participant, ChannelParticipantAdmin):
                                        admin_rights_check = creator_participant.participant.admin_rights
                                        can_add_admins = getattr(admin_rights_check, 'add_admins', False)
                                        if can_add_admins:
                                            logger.info(f"  ✅ Creator has 'Add Admins' permission")
                                        else:
                                            logger.error(f"  ❌ Creator does NOT have 'Add Admins' permission!")
                                            logger.error(f"     Promotion will fail. Please enable 'Add Admins' in Telegram.")
                                            return {'promoted': 0, 'failed': 0, 'error': 'Creator lacks Add Admins permission'}
                                    else:
                                        logger.error(f"  ❌ Creator is not an admin!")
                                        return {'promoted': 0, 'failed': 0, 'error': 'Creator is not an admin'}
                                except Exception as e:
                                    logger.warning(f"  ⚠️ Could not verify creator permissions: {e}")
                                    logger.warning(f"     Continuing anyway, but promotion may fail...")
                                
                                # Get user roles and is_mod flags from config
                                user_roles = {}
                                user_is_mod = {}
                                for phone, user_config in config_data.get('users', {}).items():
                                    user_roles[phone] = user_config.get('role', '')
                                    user_is_mod[phone] = user_config.get('is_mod', False)
                                
                                promoted_count = 0
                                failed_count = 0
                                
                                # Create admin rights for mods - MUST specify ALL fields explicitly
                                # Based on tutorial: Telegram requires ALL admin rights to be specified
                                from telethon.tl.types import ChatAdminRights
                                admin_rights = ChatAdminRights(
                                    change_info=True,
                                    post_messages=True,
                                    edit_messages=True,
                                    delete_messages=True,
                                    ban_users=True,
                                    invite_users=True,
                                    pin_messages=True,
                                    add_admins=False,  # Mods can't add admins
                                    anonymous=False,  # Mods are not anonymous
                                    manage_call=True,
                                    other=True  # Full permissions for filter management
                                )
                                
                                logger.info(f"  📋 Admin rights being set:")
                                logger.info(f"     - change_info: {admin_rights.change_info}")
                                logger.info(f"     - post_messages: {admin_rights.post_messages}")
                                logger.info(f"     - edit_messages: {admin_rights.edit_messages}")
                                logger.info(f"     - delete_messages: {admin_rights.delete_messages}")
                                logger.info(f"     - ban_users: {admin_rights.ban_users}")
                                logger.info(f"     - invite_users: {admin_rights.invite_users}")
                                logger.info(f"     - pin_messages: {admin_rights.pin_messages}")
                                logger.info(f"     - add_admins: {admin_rights.add_admins}")
                                logger.info(f"     - anonymous: {admin_rights.anonymous}")
                                logger.info(f"     - manage_call: {admin_rights.manage_call}")
                                logger.info(f"     - other: {admin_rights.other}")
                                
                                # Promote each mod user
                                for client in other_clients:
                                    phone = getattr(client, 'phone', None)
                                    if not phone:
                                        continue
                                    
                                    # Skip creator (can't self-promote)
                                    CREATOR_PHONE = '+13124733150'
                                    if phone == CREATOR_PHONE:
                                        logger.info(f"  ⏭️ Skipping creator {phone} (cannot self-promote)")
                                        continue
                                    
                                    # Check if this user should be promoted
                                    is_mod_flag = user_is_mod.get(phone, False)
                                    user_role = user_roles.get(phone, '').lower() if user_roles.get(phone) else ''
                                    should_promote = is_mod_flag or user_role == 'mod' or user_role == 'dev'
                                    
                                    if not should_promote:
                                        logger.info(f"  ⏭️ Skipping {phone} (role: {user_roles.get(phone, 'unknown')}, is_mod: {is_mod_flag}) - not a mod/dev")
                                        continue
                                    
                                    try:
                                        mod_user_entity = await client.client.get_me()
                                        logger.info(f"  📤 Promoting {phone} (ID: {mod_user_entity.id}, Username: {getattr(mod_user_entity, 'username', 'N/A')}) to moderator...")
                                        
                                        # Verify user is actually in the group (with retry for database locks)
                                        for retry in range(3):
                                            try:
                                                from telethon.tl.functions.channels import GetParticipantRequest
                                                participant_check = await dev_client.client(GetParticipantRequest(
                                                    channel=entity,
                                                    participant=mod_user_entity
                                                ))
                                                logger.info(f"     ✅ User is confirmed member of group")
                                                break
                                            except Exception as check_error:
                                                error_str = str(check_error).lower()
                                                if 'database is locked' in error_str or 'locked' in error_str:
                                                    if retry < 2:
                                                        wait_time = (retry + 1) * 2
                                                        logger.warning(f"     ⚠️ Database locked (verify), waiting {wait_time}s and retrying...")
                                                        await asyncio.sleep(wait_time)
                                                        continue
                                                logger.warning(f"     ⚠️ Could not verify user is in group: {check_error}")
                                                logger.warning(f"     Continuing anyway...")
                                                break
                                        
                                        from telethon.errors import FloodWaitError
                                        
                                        # Promote with retry for both rate limits and database locks
                                        # Use EditAdminRequest directly (correct Telegram API)
                                        from telethon.tl.functions.channels import EditAdminRequest
                                        promotion_success = False
                                        for retry in range(3):
                                            try:
                                                result = await dev_client.client(EditAdminRequest(
                                                    channel=entity,
                                                    user_id=mod_user_entity,
                                                    admin_rights=admin_rights,
                                                    rank="Moderator"
                                                ))
                                                
                                                logger.info(f"     ✅ EditAdminRequest completed successfully")
                                                
                                                # Wait for Telegram to process
                                                await asyncio.sleep(3)  # Increased delay per tutorial
                                                promotion_success = True
                                                break
                                            except FloodWaitError as flood_error:
                                                wait_time = flood_error.seconds
                                                logger.warning(f"     ⚠️ RATE LIMITED: Telegram requires {wait_time} seconds wait")
                                                logger.warning(f"     ⏳ Waiting {wait_time} seconds before retrying...")
                                                await asyncio.sleep(wait_time)
                                                
                                                # Retry after waiting
                                                logger.info(f"     🔄 Retrying promotion after rate limit wait...")
                                                result = await dev_client.client(EditAdminRequest(
                                                    channel=entity,
                                                    user_id=mod_user_entity,
                                                    admin_rights=admin_rights,
                                                    rank="Moderator"
                                                ))
                                                logger.info(f"     ✅ edit_admin() completed successfully after retry")
                                                await asyncio.sleep(3)
                                                promotion_success = True
                                                break
                                            except Exception as promote_error:
                                                error_str = str(promote_error).lower()
                                                if 'database is locked' in error_str or 'locked' in error_str:
                                                    if retry < 2:
                                                        wait_time = (retry + 1) * 2  # 2s, 4s
                                                        logger.warning(f"     ⚠️ DATABASE LOCKED: Waiting {wait_time}s and retrying...")
                                                        await asyncio.sleep(wait_time)
                                                        continue
                                                    else:
                                                        logger.error(f"     ❌ Database locked after {retry + 1} retries - giving up")
                                                        raise promote_error
                                                else:
                                                    # Not a lock error - raise immediately
                                                    raise promote_error
                                        
                                        if not promotion_success:
                                            logger.error(f"  ❌ Failed to promote {phone} after retries")
                                            failed_count += 1
                                        else:
                                            logger.info(f"  ✅ Successfully promoted {phone} (ID: {mod_user_entity.id}) to moderator")
                                            promoted_count += 1
                                            await asyncio.sleep(2)  # Delay between promotions
                                    except Exception as e:
                                        error_str = str(e)
                                        error_type = type(e).__name__
                                        logger.error(f"  ❌ Failed to promote {phone}: {error_str}")
                                        logger.error(f"     Error type: {error_type}")
                                        import traceback
                                        logger.error(f"     Traceback:\n{traceback.format_exc()}")
                                        failed_count += 1
                                
                                return {'promoted': promoted_count, 'failed': failed_count}
                            
                            try:
                                promote_result = asyncio.run_coroutine_threadsafe(promote_mods_after_join(), loop).result(timeout=60)
                                logger.info(f"✅ Promoted {promote_result.get('promoted', 0)} mod(s) to admin")
                                if promote_result.get('failed', 0) > 0:
                                    logger.warning(f"⚠️ Failed to promote {promote_result.get('failed', 0)} mod(s)")
                            except Exception as e:
                                logger.warning(f"⚠️ Error promoting mods: {e}")
                                import traceback
                                logger.warning(traceback.format_exc())
                        else:
                            logger.warning("No user entities found to invite")
                    except Exception as e:
                        logger.warning(f"Failed to invite users: {e}")
                        import traceback
                        logger.warning(traceback.format_exc())
                
                # STEP 4: Enable "Remain Anonymous" for creator AFTER users are invited AND mods are promoted
                logger.info(f"\n{'='*60}")
                logger.info(f"STEP 4: ENABLING 'REMAIN ANONYMOUS' FOR CREATOR (AFTER USERS INVITED)")
                logger.info(f"{'='*60}")
                try:
                    async def enable_creator_anonymous():
                        entity = await dev_client.client.get_entity(created_group_chat_id)
                        # Get the creator (dev account) user entity
                        me = await dev_client.client.get_me()
                        from telethon.tl.functions.channels import EditAdminRequest
                        from telethon.tl.types import ChatAdminRights, InputUserSelf
                        
                        try:
                            # Get current admin info to preserve existing rights
                            from telethon.tl.functions.channels import GetFullChannelRequest
                            full_channel = await dev_client.client(GetFullChannelRequest(entity))
                            
                            # Get current admin rights if available
                            current_rights = None
                            if hasattr(full_channel, 'full_chat') and hasattr(full_channel.full_chat, 'admins'):
                                for admin in full_channel.full_chat.admins:
                                    if admin.user_id == me.id and hasattr(admin, 'admin_rights'):
                                        current_rights = admin.admin_rights
                                        break
                            
                            # Create admin rights with anonymous=True
                            # Preserve existing rights if available, otherwise use full admin rights
                            if current_rights:
                                anonymous_rights = ChatAdminRights(
                                    change_info=getattr(current_rights, 'change_info', True),
                                    post_messages=getattr(current_rights, 'post_messages', True),
                                    edit_messages=getattr(current_rights, 'edit_messages', True),
                                    delete_messages=getattr(current_rights, 'delete_messages', True),
                                    ban_users=getattr(current_rights, 'ban_users', True),
                                    invite_users=getattr(current_rights, 'invite_users', True),
                                    pin_messages=getattr(current_rights, 'pin_messages', True),
                                    add_admins=getattr(current_rights, 'add_admins', True),
                                    anonymous=True,  # Enable "Remain Anonymous" - THIS IS THE KEY
                                    manage_call=getattr(current_rights, 'manage_call', False),
                                    other=getattr(current_rights, 'other', False)
                                )
                            else:
                                # Use full admin rights with anonymous=True
                                anonymous_rights = ChatAdminRights(
                                    change_info=True,
                                    post_messages=True,
                                    edit_messages=True,
                                    delete_messages=True,
                                    ban_users=True,
                                    invite_users=True,
                                    pin_messages=True,
                                    add_admins=True,
                                    anonymous=True,  # Enable "Remain Anonymous"
                                    manage_call=False,
                                    other=False
                                )
                            
                            # Update admin rights with anonymous=True
                            # Use InputUserSelf() to reference the current user
                            await dev_client.client(EditAdminRequest(
                                channel=entity,
                                user_id=InputUserSelf(),  # Use InputUserSelf() instead of me
                                admin_rights=anonymous_rights,
                                rank="Admin"
                            ))
                            logger.info(f"✅ Creator 'Remain Anonymous' enabled (anonymous=True)")
                            return {'success': True}
                        except Exception as e:
                            error_str = str(e)
                            logger.error(f"❌ Could not enable 'Remain Anonymous' for creator: {error_str}")
                            import traceback
                            logger.error(traceback.format_exc())
                            return {'success': False, 'error': error_str}
                    
                    anonymous_result = asyncio.run_coroutine_threadsafe(enable_creator_anonymous(), loop).result(timeout=30)
                    if anonymous_result.get('success'):
                        logger.info(f"✅ Creator 'Remain Anonymous' enabled successfully")
                    else:
                        logger.warning(f"⚠️ Could not enable 'Remain Anonymous': {anonymous_result.get('error')}")
                except Exception as e:
                    logger.warning(f"⚠️ Error enabling 'Remain Anonymous': {e}")
                    import traceback
                    logger.warning(traceback.format_exc())
                
                # Add delay to avoid rate limits
                logger.info(f"⏳ Waiting 2 seconds after enabling anonymous...")
                time.sleep(2)
                
                # Store created group chat ID (already set above)
                # Update chat_ids to use the created group (if no channel will be created)
                # BUT ONLY if we're running conversations - otherwise skip this
                if not create_channel and len(scripted_conversations) > 0:
                    chat_ids = [str(created_group_chat_id)]
                    logger.info(f"Using created group for conversation: {created_group_chat_id}")
                
                # If we also need to create a channel, do it now
                logger.info(f"\n{'='*60}")
                logger.info(f"CHECKING IF CHANNEL SHOULD BE CREATED")
                logger.info(f"   - create_channel flag: {create_channel}")
                logger.info(f"   - create_group flag: {create_group}")
                logger.info(f"{'='*60}")
                
                if create_channel:
                    logger.info(f"\n{'='*60}")
                    logger.info(f"STEP 4: CREATING TELEGRAM CHANNEL")
                    logger.info(f"{'='*60}")
                    
                    try:
                        # Generate channel username variations if not provided
                        # Use contract_name if available, otherwise fallback to token_name
                        if not channel_username:
                            # Generate base username from contract name (preferred), then token name, then symbol
                            if contract_name:
                                base_name = contract_name.lower().replace(' ', '').replace('-', '').replace('_', '')
                            else:
                                base_name = token_name.lower().replace(' ', '').replace('-', '').replace('_', '')
                            
                            if not base_name or len(base_name) < 3:
                                base_name = token_symbol.replace('$', '').lower()
                            
                            # Username variations: name, name_tg, name_chat, name_group
                            username_variations = [
                                base_name,  # Just contract name
                                f"{base_name}_tg",  # name_tg
                                f"{base_name}_chat",  # name_chat
                                f"{base_name}_group",  # name_group
                            ]
                        else:
                            username_variations = [channel_username.replace('@', '')]
                        
                        # STEP 4: Create channel WITHOUT photo first (we'll upload photo after)
                        logger.info(f"Creating CHANNEL without photo (will upload after)")
                        logger.info(f"   - is_channel=True")
                        logger.info(f"   - is_megagroup=False (broadcast channel, not interactive)")
                        logger.info(f"   - title: {group_title}")
                        logger.info(f"   - Will try usernames: {username_variations[:3]}...")
                        
                        # Create channel WITHOUT photo (upload after)
                        # Use async version directly with the persistent event loop
                        async def create_channel_async():
                            await dev_client._ensure_connected()
                            return await dev_client.create_group_async(
                                title=group_title,
                                description=final_description if final_description else None,
                                photo_path=None,
                                is_channel=True,
                                is_megagroup=False  # Channel, not megagroup
                            )
                        
                        channel_result = asyncio.run_coroutine_threadsafe(create_channel_async(), loop).result(timeout=600)
                        
                        logger.info(f"Channel creation returned: success={channel_result.get('success')}, chat_id={channel_result.get('chat_id')}, error={channel_result.get('error')}")
                        
                        # Add delay to avoid rate limits
                        logger.info(f"⏳ Waiting 2 seconds before next step...")
                        time.sleep(2)
                        
                        if channel_result.get('success'):
                            created_channel_id = channel_result.get('chat_id')
                            
                            # STEP 5: Upload channel photo
                            logger.info(f"\n{'='*60}")
                            logger.info(f"STEP 5: CHECKING CHANNEL PHOTO")
                            logger.info(f"{'='*60}")
                            logger.info(f"   - final_photo_path: {final_photo_path}")
                            logger.info(f"   - final_photo_path exists: {final_photo_path and os.path.exists(final_photo_path) if final_photo_path else False}")
                            if final_photo_path:
                                logger.info(f"   - Photo file size: {os.path.getsize(final_photo_path)} bytes" if os.path.exists(final_photo_path) else "   - Photo file does NOT exist")
                            
                            if final_photo_path and os.path.exists(final_photo_path):
                                logger.info(f"\n{'='*60}")
                                logger.info(f"STEP 5: UPLOADING CHANNEL PHOTO")
                                logger.info(f"{'='*60}")
                                try:
                                    logger.info(f"Uploading channel photo: {final_photo_path}")
                                    logger.info(f"   - Photo file exists: {os.path.exists(final_photo_path)}")
                                    logger.info(f"   - Photo file size: {os.path.getsize(final_photo_path)} bytes")
                                    
                                    async def upload_channel_photo():
                                        entity = await dev_client.client.get_entity(created_channel_id)
                                        from telethon.tl.functions.channels import EditPhotoRequest
                                        from telethon.tl.types import InputChatUploadedPhoto
                                        from telethon.errors import FloodWaitError
                                        
                                        try:
                                            photo = await dev_client.client.upload_file(final_photo_path)
                                            await dev_client.client(EditPhotoRequest(
                                                channel=entity,
                                                photo=InputChatUploadedPhoto(file=photo)
                                            ))
                                            logger.info(f"✅ Channel photo uploaded successfully")
                                            return {'success': True}
                                        except FloodWaitError as e:
                                            wait_time = e.seconds
                                            logger.warning(f"⚠️ Rate limited: Need to wait {wait_time} seconds before uploading channel photo")
                                            logger.info(f"⏳ Waiting {wait_time} seconds (Telegram rate limit)...")
                                            await asyncio.sleep(wait_time)
                                            # Retry after waiting
                                            logger.info(f"Retrying channel photo upload...")
                                            photo = await dev_client.client.upload_file(final_photo_path)
                                            await dev_client.client(EditPhotoRequest(
                                                channel=entity,
                                                photo=InputChatUploadedPhoto(file=photo)
                                            ))
                                            logger.info(f"✅ Channel photo uploaded successfully after wait")
                                            return {'success': True}
                                    
                                    photo_result = asyncio.run_coroutine_threadsafe(upload_channel_photo(), loop).result(timeout=600)  # Increased timeout for flood wait
                                    
                                    if photo_result.get('success'):
                                        logger.info(f"✅ Channel photo set successfully")
                                    else:
                                        logger.error(f"❌ Failed to set channel photo: {photo_result.get('error')}")
                                except Exception as e:
                                    logger.error(f"❌ Error setting channel photo: {e}")
                                    import traceback
                                    logger.error(traceback.format_exc())
                            else:
                                logger.error(f"❌ CANNOT UPLOAD CHANNEL PHOTO: final_photo_path is {'None' if not final_photo_path else 'set but file does not exist'}")
                                logger.error(f"   - final_photo_path: {final_photo_path}")
                                logger.error(f"   - group_photo_base64 was provided: {bool(group_photo_base64)}")
                                logger.error(f"   - token_image_url was provided: {bool(token_image_url)}")
                                logger.error(f"   - group_photo_path was provided: {bool(group_photo_path)}")
                                
                                # Add delay to avoid rate limits
                                logger.info(f"⏳ Waiting 2 seconds before next step...")
                                time.sleep(2)
                            
                            # STEP 6: Update channel title and set username (make channel public)
                            logger.info(f"\n{'='*60}")
                            logger.info(f"STEP 6: UPDATING CHANNEL TITLE AND SETTING USERNAME (MAKING PUBLIC)")
                            logger.info(f"{'='*60}")
                            
                            # First, update channel title
                            try:
                                async def update_channel_title():
                                    entity = await dev_client.client.get_entity(created_channel_id)
                                    await dev_client.client.edit_title(entity, group_title)
                                    logger.info(f"✅ Channel title updated to: {group_title}")
                                    return {'success': True}
                                title_result = asyncio.run_coroutine_threadsafe(update_channel_title(), loop).result(timeout=30)
                                if title_result.get('success'):
                                    logger.info(f"✅ Channel title set successfully")
                            except Exception as e:
                                logger.warning(f"⚠️ Could not update channel title: {e}")
                            
                            # Add delay before username setting
                            logger.info(f"⏳ Waiting 2 seconds before setting username...")
                            time.sleep(2)
                            
                            logger.info(f"Will try {len(username_variations)} username variations:")
                            for idx, var in enumerate(username_variations, 1):
                                logger.info(f"  {idx}. @{var}")
                            
                            # According to Telethon docs: Channels are private by default, need to set username to make public
                            logger.info(f"\n{'='*60}")
                            logger.info(f"STARTING USERNAME SETTING PROCESS")
                            logger.info(f"   Channel ID: {created_channel_id}")
                            logger.info(f"   Account: {dev_phone}")
                            logger.info(f"   Variations to try: {len(username_variations)}")
                            logger.info(f"{'='*60}")
                            
                            final_channel_username = None
                            rate_limited = False
                            for attempt, username_variant in enumerate(username_variations):
                                # CRITICAL: Stop immediately if rate limited - don't try more variations
                                if rate_limited:
                                    logger.warning(f"⚠️ Rate limit detected - stopping username attempts to prevent further rate limiting")
                                    break
                                
                                # Add delay between attempts to avoid rate limits (except first attempt)
                                if attempt > 0:
                                    delay = 3  # 3 seconds between attempts
                                    logger.info(f"⏳ Waiting {delay} seconds before next username attempt (to avoid rate limits)...")
                                    time.sleep(delay)
                                
                                try:
                                    username_variant = username_variant.replace('@', '').lower().strip()
                                    
                                    # Telegram usernames must be 5-32 chars, alphanumeric + underscores only
                                    # Remove any invalid characters
                                    import re
                                    username_variant = re.sub(r'[^a-z0-9_]', '', username_variant)
                                    
                                    if len(username_variant) < 5:
                                        logger.warning(f"Username @{username_variant} too short (min 5 chars) after cleaning, skipping...")
                                        continue
                                    if len(username_variant) > 32:
                                        username_variant = username_variant[:32]
                                        logger.info(f"Truncated username to 32 chars: @{username_variant}")
                                    
                                    # Validate: must start with letter
                                    if not username_variant[0].isalpha():
                                        logger.warning(f"Username @{username_variant} must start with a letter, skipping...")
                                        continue
                                    
                                    logger.info(f"Making channel public and setting username (attempt {attempt + 1}/{len(username_variations)}): @{username_variant}")
                                    
                                    # Use UpdateChannelUsernameRequest directly to make channel public
                                    # First check if username is available, then set it
                                    async def set_channel_username():
                                        # IMPORTANT: Use created_channel_id (channel), NOT created_group_chat_id (group)
                                        entity = await dev_client.client.get_entity(created_channel_id)
                                        from telethon.tl.functions.channels import UpdateUsernameRequest
                                        from telethon.errors import UsernameOccupiedError, UsernameInvalidError, UsernameNotModifiedError, FloodWaitError
                                        
                                        try:
                                            # Use UpdateUsernameRequest to set username (makes channel public)
                                            # EditChannelRequest was removed from modern Telethon
                                            logger.info(f"Setting CHANNEL username to @{username_variant} (channel ID: {created_channel_id}, this will make channel public)...")
                                            
                                            try:
                                                # UpdateUsernameRequest makes channel public and sets username
                                                await dev_client.client(UpdateUsernameRequest(
                                                    channel=entity,
                                                    username=username_variant
                                                ))
                                                logger.info(f"✅ Channel made public with username: @{username_variant}")
                                                return {'success': True}
                                            except FloodWaitError as e:
                                                wait_time = e.seconds
                                                logger.error(f"❌ RATE LIMITED: Need to wait {wait_time} seconds ({wait_time/60:.1f} minutes) before setting username")
                                                logger.error(f"   This is a Telegram rate limit - username changes are limited to prevent abuse")
                                                logger.error(f"   STOPPING all further username attempts to prevent further rate limiting")
                                                logger.error(f"   Channel was created successfully, but username will need to be set manually later")
                                                logger.error(f"   Channel ID: {created_channel_id}")
                                                logger.error(f"   You can set the username manually via Telegram or wait {wait_time} seconds and try again")
                                                # CRITICAL: Return rate limit flag so we stop trying more variations
                                                return {'success': False, 'error': f'Rate limited: wait {wait_time} seconds', 'rate_limit': wait_time, 'stop_trying': True}
                                            except UsernameOccupiedError as e:
                                                logger.warning(f"Username @{username_variant} is occupied/taken: {e}")
                                                return {'success': False, 'error': f'Username @{username_variant} is occupied'}
                                            except UsernameInvalidError as e:
                                                logger.warning(f"Username @{username_variant} is invalid: {e}")
                                                return {'success': False, 'error': f'Username @{username_variant} is invalid: {e}'}
                                            except UsernameNotModifiedError:
                                                # Username is already set to this value (success!)
                                                logger.info(f"Username @{username_variant} is already set (channel is public)")
                                                return {'success': True}
                                            except Exception as e:
                                                error_str = str(e)
                                                error_type = type(e).__name__
                                                error_lower = error_str.lower()
                                                
                                                # Check for ChannelsAdminPublicTooMuchError
                                                from telethon.errors import ChannelsAdminPublicTooMuchError
                                                if isinstance(e, ChannelsAdminPublicTooMuchError) or 'ChannelsAdminPublicTooMuchError' in error_type or 'too many public channels' in error_lower:
                                                    logger.warning(f"⚠️ Channel limit reached: Account is admin of too many public channels")
                                                    logger.warning(f"   This is a Telegram limit - accounts can only be admin of a limited number of public channels")
                                                    logger.warning(f"   Channel was created successfully, but username cannot be set due to this limit")
                                                    logger.warning(f"   Channel ID: {created_channel_id}")
                                                    logger.warning(f"   Account: {dev_phone}")
                                                    logger.warning(f"   SOLUTION: Make some existing channels private, or use a different account")
                                                    logger.warning(f"   The channel is still usable - you can set the username manually later")
                                                    # This is a permanent limit, not a temporary rate limit
                                                    return {'success': False, 'error': 'Too many public channels (make some private)', 'channel_limit': True}
                                                
                                                # Check for common "not available" errors
                                                if any(keyword in error_lower for keyword in ['taken', 'occupied', 'unavailable', 'already', 'not available']):
                                                    logger.warning(f"Username @{username_variant} is not available: {error_str}")
                                                    return {'success': False, 'error': f'Username @{username_variant} is not available: {error_str}'}
                                                else:
                                                    # Other error (might be rate limit, permissions, etc.)
                                                    logger.error(f"Unexpected error setting username @{username_variant}: {error_str}")
                                                    import traceback
                                                    logger.error(traceback.format_exc())
                                                    return {'success': False, 'error': error_str}
                                        except Exception as e:
                                            error_str = str(e)
                                            logger.error(f"❌ Failed to set username @{username_variant}: {error_str}")
                                            import traceback
                                            logger.error(traceback.format_exc())
                                            return {'success': False, 'error': error_str}
                                    
                                    logger.info(f"Calling set_channel_username() for @{username_variant}...")
                                    username_result = asyncio.run_coroutine_threadsafe(set_channel_username(), loop).result(timeout=60)  # Increased timeout
                                    
                                    logger.info(f"Username result: {username_result}")
                                    
                                    if username_result.get('success'):
                                        logger.info(f"✅ Channel username set to: @{username_variant}")
                                        final_channel_username = username_variant
                                        channel_result['username'] = username_variant
                                        break  # Success, stop trying
                                    else:
                                        error_msg = username_result.get('error', 'Unknown error')
                                        rate_limit = username_result.get('rate_limit')
                                        stop_trying = username_result.get('stop_trying', False)
                                        
                                        logger.warning(f"❌ Username setting failed for @{username_variant}")
                                        logger.warning(f"   Error: {error_msg}")
                                        
                                        # CRITICAL: Stop immediately if rate limited
                                        if stop_trying or rate_limit:
                                            rate_limited = True
                                            logger.error(f"❌ RATE LIMITED - Stopping all username attempts immediately")
                                            logger.error(f"   Channel created successfully but username not set")
                                            logger.error(f"   Channel ID: {created_channel_id}")
                                            break  # Stop trying more variations
                                        
                                        # Check for channel limit (too many public channels)
                                        channel_limit = username_result.get('channel_limit')
                                        if channel_limit:
                                            logger.warning(f"⚠️ CHANNEL LIMIT: Account is admin of too many public channels")
                                            logger.warning(f"   Channel was created successfully, but username cannot be set")
                                            logger.warning(f"   Channel ID: {created_channel_id}")
                                            logger.warning(f"   Account: {dev_phone}")
                                            logger.warning(f"   SOLUTION: Make some existing channels private, or use a different account")
                                            logger.warning(f"   The channel is still usable - you can set the username manually later")
                                            break  # Stop trying - this is a permanent limit
                                        
                                        # Rate limit already handled above with break - continue to next variation if not rate limited
                                        
                                        logger.warning(f"Username @{username_variant} failed: {error_msg}")
                                        # Check if error indicates username is taken
                                        error_lower = error_msg.lower()
                                        if any(keyword in error_lower for keyword in ['taken', 'already', 'unavailable', 'occupied', 'not available']):
                                            logger.info(f"Username @{username_variant} is taken/unavailable, trying next variation...")
                                            continue  # Try next variation
                                        else:
                                            # Log the error but try next anyway (might be rate limit or other issue)
                                            logger.warning(f"Username error (not 'taken'): {error_msg} - will try next variation")
                                            continue
                                except Exception as e:
                                    error_str = str(e)
                                    logger.error(f"❌ Exception setting username @{username_variant}: {error_str}")
                                    import traceback
                                    logger.error(traceback.format_exc())
                                    # Continue to next variation unless this is the last one
                                    if attempt < len(username_variations) - 1:
                                        logger.info(f"Trying next username variation...")
                                        continue
                            
                            if not final_channel_username:
                                logger.warning(f"⚠️ Could not set username for channel (this is OK - channel was created successfully)")
                                logger.warning(f"   Channel ID: {created_channel_id}")
                                logger.warning(f"   Token: {token_name} ({token_symbol})")
                                logger.warning(f"   Tried variations: {', '.join([f'@{v}' for v in username_variations])}")
                                logger.warning(f"   Reason: Likely rate-limited by Telegram (username changes are limited)")
                                logger.warning(f"   You can set the username manually later via Telegram app")
                            else:
                                logger.info(f"✅ Successfully set channel username: @{final_channel_username}")
                                logger.info(f"   Channel is now public: https://t.me/{final_channel_username}")
                            
                            # Add delay after username setting
                            logger.info(f"⏳ Waiting 2 seconds before next step...")
                            time.sleep(2)
                        
                        logger.info(f"   - Channel creation result: {channel_result}")
                        
                        if channel_result.get('success'):
                            created_channel_chat_id = channel_result.get('chat_id')
                            channel_username_from_result = channel_result.get('username')
                            
                            # Verify what type of entity was actually created
                            try:
                                async def verify_channel_entity_type():
                                    entity = await dev_client.client.get_entity(created_channel_chat_id)
                                    is_channel_entity = hasattr(entity, 'broadcast') and entity.broadcast
                                    entity_type = 'CHANNEL' if is_channel_entity else 'GROUP'
                                    logger.info(f"✅ Verified channel entity type: {entity_type} (ID: {created_channel_chat_id})")
                                    if entity_type != 'CHANNEL':
                                        logger.error(f"❌ ERROR: Created a GROUP but we expected a CHANNEL!")
                                    return entity_type
                                entity_type = asyncio.run_coroutine_threadsafe(verify_channel_entity_type(), loop).result(timeout=10)
                            except Exception as e:
                                logger.warning(f"Could not verify channel entity type: {e}")
                            
                            logger.info(f"✅ Created channel via Telethon: (ID: {created_channel_chat_id})")
                            
                            # Photo and username are already set above, just log final status
                            logger.info(f"✅ Final channel: {group_title} (ID: {created_channel_chat_id})")
                            if channel_username_from_result:
                                logger.info(f"   - Channel username: @{channel_username_from_result}")
                            else:
                                logger.warning(f"   - Channel username: NOT SET")
                            
                            # Configure channel settings if provided (additional settings beyond branding)
                            if group_settings:
                                logger.info("Configuring additional channel settings...")
                                settings_result = dev_client.configure_group_settings(created_channel_chat_id, group_settings)
                                if settings_result.get('success'):
                                    logger.info("✅ Additional channel settings configured")
                            
                            # Update chat_ids to include channel
                            chat_ids = [str(created_group_chat_id), str(created_channel_chat_id)]
                            logger.info(f"Using created group and channel: {created_group_chat_id}, {created_channel_chat_id}")
                        else:
                            error_msg = channel_result.get('error', 'Unknown error')
                            logger.error(f"❌ Failed to create channel: {error_msg}")
                            logger.error(f"Channel creation result: {channel_result}")
                    except Exception as e:
                        logger.error(f"❌ Exception while creating channel: {e}")
                        import traceback
                        logger.error(traceback.format_exc())
                
                # Create portal if requested (using interactive flow)
                # Use created IDs if available, otherwise try existing IDs from config
                portal_group_id = created_group_chat_id or existing_group_chat_id
                portal_channel_id = created_channel_chat_id or existing_channel_chat_id
                
                # Track if portal was successfully created to prevent duplicate runs
                portal_created_successfully = False
                
                # Portal setup only requires group and channel IDs (token_address is optional)
                if create_portal and portal_group_id and portal_channel_id:
                    logger.info(f"\n{'='*60}")
                    logger.info(f"CREATING SAFEGUARD PORTAL (INTERACTIVE FLOW)")
                    logger.info(f"{'='*60}")
                    
                    try:
                        logger.info(f"Starting interactive portal setup flow...")
                        if token_address:
                            logger.info(f"  - Token address: {token_address}")
                        else:
                            logger.info(f"  - Token address: (not set - portal setup doesn't require it)")
                        logger.info(f"  - Group ID: {portal_group_id} {'(newly created)' if created_group_chat_id else '(existing)'}")
                        logger.info(f"  - Channel ID: {portal_channel_id} {'(newly created)' if created_channel_chat_id else '(existing)'}")
                        
                        # Find creator account for portal setup - use phone from config_data or fallback
                        CREATOR_PHONE = config_data.get('telegram_phone') or '+13124733150'
                        portal_dev_client = None
                        
                        # First try to find by specific phone number (from config_data)
                        for client in clients:
                            if getattr(client, 'phone', None) == CREATOR_PHONE:
                                # Use the client if found, even if not in users config (for group creator mode)
                                portal_dev_client = client
                                logger.info(f"Found creator account for portal by phone: {CREATOR_PHONE}")
                                break
                        
                        # Fallback: find dev account (role='dev') in users config
                        if not portal_dev_client:
                            for phone, user_config in config_data.get('users', {}).items():
                                if user_config.get('role') == 'dev' and user_config.get('enabled', False):
                                    for client in clients:
                                        if getattr(client, 'phone', None) == phone:
                                            portal_dev_client = client
                                            logger.info(f"Found creator account for portal by role='dev': {phone}")
                                            break
                                    if portal_dev_client:
                                        break
                        
                        # Final fallback: use first client if only one exists (group creator mode)
                        if not portal_dev_client and len(clients) == 1:
                            portal_dev_client = clients[0]
                            logger.info(f"Using single available client for portal: {getattr(portal_dev_client, 'phone', 'unknown')}")
                        
                        if not portal_dev_client:
                            logger.error("No creator account found for portal setup")
                            logger.warning("⚠️ Portal setup skipped - continuing without portal")
                        else:
                            portal_result = portal_dev_client.setup_safeguard_portal_interactive(
                                group_chat_id=str(portal_group_id),
                                channel_chat_id=str(portal_channel_id),
                                safeguard_bot_username=safeguard_bot_username
                            )
                            
                            if portal_result.get('success'):
                                logger.info(f"✅ Portal setup completed successfully")
                                logger.info(f"Safeguard bot response: {portal_result.get('response', 'No response')}")
                                portal_created_successfully = True
                            else:
                                error_msg = portal_result.get('error', 'Unknown error')
                                logger.warning(f"⚠️ Failed to create portal: {error_msg}")
                                logger.warning(f"   Group and channel were created successfully, but portal setup failed.")
                                logger.warning(f"   You can manually set up the portal later via @safeguard bot.")
                                logger.warning(f"   Group ID: {portal_group_id}, Channel ID: {portal_channel_id}")
                    except Exception as e:
                        logger.error(f"Error creating portal: {e}")
                        import traceback
                        logger.error(traceback.format_exc())
                        logger.warning("⚠️ Portal setup failed, but group/channel creation succeeded. Continuing...")
                elif create_portal:
                    logger.warning(f"⚠️ Cannot create portal: Missing group_chat_id or channel_chat_id")
                    logger.warning(f"   Created Group ID: {created_group_chat_id}")
                    logger.warning(f"   Created Channel ID: {created_channel_chat_id}")
                    logger.warning(f"   Existing Group ID: {existing_group_chat_id}")
                    logger.warning(f"   Existing Channel ID: {existing_channel_chat_id}")
                    logger.warning(f"   Token address: {token_address}")
                
                # Note: Group/channel creation already succeeded at this point
                # Filter script will be sent after portal setup (if any) or before final result
            except Exception as e:
                logger.error(f"Error creating group: {e}")
                import traceback
                logger.error(traceback.format_exc())
                return False
        
        # Handle portal setup (after group/channel creation OR with existing IDs)
        # Note: token_address is NOT required for portal setup (only needed for buy bot later)
        # Skip if portal was already created successfully above
        if create_portal and not portal_created_successfully:
            # Use created IDs if available, otherwise use existing IDs
            portal_group_id = created_group_chat_id or existing_group_chat_id
            portal_channel_id = created_channel_chat_id or existing_channel_chat_id
            
            if portal_group_id and portal_channel_id:
                logger.info(f"\n{'='*60}")
                logger.info(f"CREATING SAFEGUARD PORTAL")
                logger.info(f"{'='*60}")
                
                try:
                    logger.info(f"Starting interactive portal setup flow...")
                    if token_address:
                        logger.info(f"  - Token address: {token_address}")
                    else:
                        logger.info(f"  - Token address: (not set - portal setup doesn't require it)")
                    logger.info(f"  - Group ID: {portal_group_id}")
                    logger.info(f"  - Channel ID: {portal_channel_id}")
                    
                    # Find creator account for portal setup - use phone from config_data or fallback
                    CREATOR_PHONE = config_data.get('telegram_phone') or '+13124733150'
                    portal_dev_client = None
                    
                    # First try to find by specific phone number (from config_data)
                    for client in clients:
                        if getattr(client, 'phone', None) == CREATOR_PHONE:
                            # Use the client if found, even if not in users config (for group creator mode)
                            portal_dev_client = client
                            logger.info(f"Found creator account for portal by phone: {CREATOR_PHONE}")
                            break
                    
                    # Fallback: find dev account (role='dev') in users config
                    if not portal_dev_client:
                        for phone, user_config in config_data.get('users', {}).items():
                            if user_config.get('role') == 'dev' and user_config.get('enabled', False):
                                for client in clients:
                                    if getattr(client, 'phone', None) == phone:
                                        portal_dev_client = client
                                        logger.info(f"Found creator account for portal by role='dev': {phone}")
                                        break
                                if portal_dev_client:
                                    break
                    
                    # Final fallback: use first client if only one exists (group creator mode)
                    if not portal_dev_client and len(clients) == 1:
                        portal_dev_client = clients[0]
                        logger.info(f"Using single available client for portal: {getattr(portal_dev_client, 'phone', 'unknown')}")
                    
                    if not portal_dev_client:
                        logger.error("No creator account found for portal setup")
                        logger.error(f"Available clients: {[getattr(c, 'phone', 'unknown') for c in clients]}")
                        return False
                    
                    portal_result = portal_dev_client.setup_safeguard_portal_interactive(
                        group_chat_id=str(portal_group_id),
                        channel_chat_id=str(portal_channel_id),
                        safeguard_bot_username=safeguard_bot_username
                    )
                    
                    if portal_result.get('success'):
                        logger.info(f"✅ Portal setup completed successfully")
                        logger.info(f"Safeguard bot response: {portal_result.get('response', 'No response')}")
                    else:
                        error_msg = portal_result.get('error', 'Unknown error')
                        logger.warning(f"⚠️ Failed to create portal: {error_msg}")
                        logger.warning(f"   This usually means:")
                        logger.warning(f"   1. The account ({portal_dev_client.phone}) is not a member/admin of the group/channel")
                        logger.warning(f"   2. The group/channel is not visible in Safeguard bot's menu")
                        logger.warning(f"   SOLUTION: Create NEW groups/channels (they will automatically work)")
                except Exception as e:
                    logger.error(f"Error creating portal: {e}")
                    import traceback
                    logger.error(traceback.format_exc())
            else:
                logger.warning(f"⚠️ Cannot create portal: Missing existing group_chat_id or channel_chat_id")
                logger.warning(f"   Existing Group ID: {existing_group_chat_id}")
                logger.warning(f"   Existing Channel ID: {existing_channel_chat_id}")
                logger.warning(f"   Token address: {token_address}")
        
        # Setup Safeguard buy bot (if requested)
        setup_buy_bot = config_data.get('setup_buy_bot', False) or False
        buy_bot_token_address = config_data.get('buy_bot_token_address') or token_address
        buy_bot_chain = config_data.get('buy_bot_chain', 'base') or 'base'
        safeguard_bot_username = config_data.get('safeguard_bot_username', '@safeguard') or '@safeguard'
        
        if setup_buy_bot and buy_bot_token_address:
            # Use created group ID if available, otherwise use existing
            buy_bot_group_id = created_group_chat_id or existing_group_chat_id
            
            if buy_bot_group_id:
                logger.info(f"\n{'='*60}")
                logger.info(f"SETTING UP SAFEGUARD BUY BOT")
                logger.info(f"{'='*60}")
                logger.info(f"Group ID: {buy_bot_group_id}")
                logger.info(f"Token Address: {buy_bot_token_address}")
                logger.info(f"Chain: {buy_bot_chain}")
                logger.info(f"Safeguard Bot: {safeguard_bot_username}")
                
                try:
                    # Find the dev client (same as portal setup)
                    buy_bot_dev_client = None
                    
                    # First try to find by specific phone number (from config_data)
                    for client in clients:
                        if getattr(client, 'phone', None) == CREATOR_PHONE:
                            buy_bot_dev_client = client
                            logger.info(f"Found creator account for buy bot by phone: {CREATOR_PHONE}")
                            break
                    
                    # Fallback: find dev account (role='dev') in users config
                    if not buy_bot_dev_client:
                        for phone, user_config in config_data.get('users', {}).items():
                            if user_config.get('role') == 'dev' and user_config.get('enabled', False):
                                for client in clients:
                                    if getattr(client, 'phone', None) == phone:
                                        buy_bot_dev_client = client
                                        logger.info(f"Found creator account for buy bot by role='dev': {phone}")
                                        break
                                if buy_bot_dev_client:
                                    break
                    
                    # Final fallback: use first client if only one exists (group creator mode)
                    if not buy_bot_dev_client and len(clients) == 1:
                        buy_bot_dev_client = clients[0]
                        logger.info(f"Using single available client for buy bot: {getattr(buy_bot_dev_client, 'phone', 'unknown')}")
                    
                    if not buy_bot_dev_client:
                        logger.error("No creator account found for buy bot setup")
                        logger.error(f"Available clients: {[getattr(c, 'phone', 'unknown') for c in clients]}")
                    else:
                        # Call the buy bot setup function (same pattern as portal setup)
                        buy_bot_result = asyncio.run_coroutine_threadsafe(
                            buy_bot_dev_client.setup_safeguard_buy_bot_interactive_async(
                                group_chat_id=str(buy_bot_group_id),
                                token_address=buy_bot_token_address,
                                chain=buy_bot_chain,
                                safeguard_bot_username=safeguard_bot_username
                            ),
                            loop
                        ).result(timeout=120)  # 2 minute timeout for buy bot setup
                        
                        if buy_bot_result.get('success'):
                            logger.info(f"✅ Buy bot setup completed successfully")
                            logger.info(f"Safeguard bot response: {buy_bot_result.get('response', 'No response')}")
                        else:
                            error_msg = buy_bot_result.get('error', 'Unknown error')
                            logger.warning(f"⚠️ Failed to set up buy bot: {error_msg}")
                            logger.warning(f"   This usually means:")
                            logger.warning(f"   1. The account ({buy_bot_dev_client.phone}) is not a member/admin of the group")
                            logger.warning(f"   2. The Safeguard bot is not responding correctly")
                            logger.warning(f"   3. The token address or chain is incorrect")
                            
                except Exception as e:
                    logger.error(f"Error setting up buy bot: {e}")
                    import traceback
                    logger.error(traceback.format_exc())
            else:
                logger.warning(f"⚠️ Cannot set up buy bot: Missing existing group_chat_id")
                logger.warning(f"   Created Group ID: {created_group_chat_id}")
                logger.warning(f"   Existing Group ID: {existing_group_chat_id}")
                logger.warning(f"   Token address: {buy_bot_token_address}")
        
        logger.info(f"{'='*60}\n")
        
        # Output created chat IDs for group creator node (if no conversations)
        # IMPORTANT: If no conversations, return early - don't start conversations
        if len(scripted_conversations) == 0:
            # This is a group creator only run (no conversations)
            # Output the chat IDs and telegram link so frontend can use them
            import json
            
            # Get telegram link (prefer channel if both exist, otherwise use group)
            telegram_link = None
            if created_channel_chat_id:
                # Try to get channel username/link
                try:
                    async def get_channel_link():
                        entity = await dev_client.client.get_entity(created_channel_chat_id)
                        if hasattr(entity, 'username') and entity.username:
                            return f"https://t.me/{entity.username}"
                        # Try export invite link
                        try:
                            # Try channels module first
                            from telethon.tl.functions.channels import ExportInviteRequest
                            invite_link = await dev_client.client(ExportInviteRequest(entity))
                            return invite_link.link
                        except:
                            try:
                                # Fallback to messages module
                                from telethon.tl.functions.messages import ExportChatInviteLinkRequest
                                invite_link = await dev_client.client(ExportChatInviteLinkRequest(entity))
                                return invite_link.link
                            except:
                                return None
                    telegram_link = asyncio.run_coroutine_threadsafe(get_channel_link(), loop).result(timeout=10)
                except Exception as e:
                    logger.warning(f"Could not get channel link: {e}")
            
            if not telegram_link and created_group_chat_id:
                # Try to get group invite link
                try:
                    async def get_group_link():
                        entity = await dev_client.client.get_entity(created_group_chat_id)
                        try:
                            # Try channels module first
                            from telethon.tl.functions.channels import ExportInviteRequest
                            invite_link = await dev_client.client(ExportInviteRequest(entity))
                            return invite_link.link
                        except:
                            try:
                                # Fallback to messages module
                                from telethon.tl.functions.messages import ExportChatInviteLinkRequest
                                invite_link = await dev_client.client(ExportChatInviteLinkRequest(entity))
                                return invite_link.link
                            except:
                                return None
                    telegram_link = asyncio.run_coroutine_threadsafe(get_group_link(), loop).result(timeout=10)
                except Exception as e:
                    logger.warning(f"Could not get group link: {e}")
            
            # Send filter script commands after group/channel creation (if not already sent)
            if filter_script and (created_group_chat_id or created_channel_chat_id) and dev_client:
                logger.info(f"\n{'='*60}")
                logger.info(f"SENDING FILTER COMMANDS")
                logger.info(f"{'='*60}")
                
                try:
                    # Parse and replace placeholders in filter script
                    filter_commands = filter_script.strip().split('\n')
                    
                    # Replace placeholders with actual values
                    replacements = {
                        '{contract_address}': token_address or '',
                        '{CA}': token_address or '',
                        '{website}': config_data.get('website', '') or '',
                        '{twitter}': config_data.get('twitter', '') or '',
                        '{X}': config_data.get('twitter', '') or '',
                        '{token_name}': token_name or '',
                        '{token_symbol}': token_symbol or '',
                        '{telegram}': config_data.get('telegram', '') or '',
                        '{description}': config_data.get('description', '') or '',
                    }
                    
                    processed_commands = []
                    for cmd in filter_commands:
                        if cmd.strip():
                            processed_cmd = cmd
                            # Track if any placeholder was replaced with a non-empty value
                            has_required_value = False
                            
                            # Check if this command requires specific placeholders
                            # Extract placeholder names from the command
                            import re
                            placeholders_in_cmd = re.findall(r'\{([^}]+)\}', processed_cmd)
                            
                            # Replace placeholders
                            for placeholder, value in replacements.items():
                                placeholder_key = placeholder.replace('{', '').replace('}', '')
                                if placeholder in processed_cmd:
                                    if value and value.strip():
                                        processed_cmd = processed_cmd.replace(placeholder, value)
                                        has_required_value = True
                                    else:
                                        # Placeholder exists but value is empty - skip this command
                                        logger.info(f"⏭️ Skipping filter command (missing value for {placeholder}): {cmd.strip()}")
                                        processed_cmd = None
                                        break
                            
                            # Only add if command was processed and has required values
                            if processed_cmd and processed_cmd.strip():
                                # Double-check: if command still has unreplaced placeholders, skip it
                                if '{' in processed_cmd and '}' in processed_cmd:
                                    remaining_placeholders = re.findall(r'\{([^}]+)\}', processed_cmd)
                                    if remaining_placeholders:
                                        logger.info(f"⏭️ Skipping filter command (missing values for {remaining_placeholders}): {cmd.strip()}")
                                        continue
                                processed_commands.append(processed_cmd.strip())
                    
                    logger.info(f"Processed {len(processed_commands)} filter commands (skipped empty placeholders)")
                    
                    if not processed_commands:
                        logger.info("ℹ️ No filter commands to send (all were skipped due to missing values)")
                    else:
                        # Send commands ONLY to group (if created) - NOT to channel
                        if created_group_chat_id:
                            async def send_filter_commands():
                                await dev_client._ensure_connected()
                                for idx, cmd in enumerate(processed_commands, 1):
                                    if cmd:
                                        try:
                                            logger.info(f"📤 Sending filter command {idx}/{len(processed_commands)} to GROUP: {cmd[:50]}...")
                                            await dev_client.send_message_async(
                                                text=cmd,
                                                chat_id=str(created_group_chat_id)
                                            )
                                            logger.info(f"✅ Sent filter command {idx}/{len(processed_commands)} to GROUP: {cmd[:50]}...")
                                            # Wait 1 second between commands to ensure order and avoid rate limits
                                            if idx < len(processed_commands):
                                                await asyncio.sleep(1)
                                        except Exception as e:
                                            logger.warning(f"⚠️ Failed to send filter command {idx} '{cmd[:30]}...': {e}")
                            
                            try:
                                asyncio.run_coroutine_threadsafe(send_filter_commands(), loop).result(timeout=60)
                                logger.info(f"✅ All {len(processed_commands)} filter commands sent to GROUP successfully (in order)")
                            except Exception as e:
                                logger.warning(f"⚠️ Failed to send filter commands to group: {e}")
                        else:
                            logger.warning("⚠️ No group chat ID available - filter commands can only be sent to groups, not channels")
                    
                except Exception as e:
                    logger.error(f"❌ Error processing filter script: {e}")
                    import traceback
                    logger.error(traceback.format_exc())
                    logger.warning("⚠️ Filter commands failed, but group/channel creation succeeded")
            
            output_data = {
                'success': True,
                'group_chat_id': str(created_group_chat_id) if created_group_chat_id else None,
                'channel_chat_id': str(created_channel_chat_id) if created_channel_chat_id else None,
                'telegram_link': telegram_link,  # Set telegram link in RunConfig
                'portal_created': create_portal and (created_group_chat_id or created_channel_chat_id)
            }
            print(f"\n{'='*60}")
            print("GROUP_CREATOR_RESULT:")
            print(json.dumps(output_data))
            print(f"{'='*60}\n")
            return True
    
    # If we created/reused groups but have no conversations, don't start conversations
    # This check happens BEFORE creating TelegramCampaign to prevent conversations from starting
    if (create_group or reuse_existing) and (not scripted_conversations or len(scripted_conversations) == 0):
        logger.info("Group/channel created/reused successfully. No conversations to run.")
        return True
    
    # Auto-join participants to the GROUP (not channel) before starting conversations
    # This makes it look like they joined right after contract verification
    # Works for both created groups AND existing groups (from Telegram Chatter node)
    # CRITICAL: Only use GROUP chat ID, NOT channel chat ID
    # Priority: created_group_chat_id (from Telegram Group Creator) > first chat_id from chat_ids (existing group)
    # Filter out channel chat IDs - only use group chat IDs (group IDs are negative, channels can be positive or negative)
    
    logger.info(f"\n{'='*60}")
    logger.info(f"GROUP ID SELECTION FOR AUTO-JOIN")
    logger.info(f"{'='*60}")
    logger.info(f"created_group_chat_id: {created_group_chat_id}")
    logger.info(f"chat_ids from config: {chat_ids}")
    logger.info(f"chat_ids type: {type(chat_ids)}, length: {len(chat_ids) if chat_ids else 0}")
    
    # CRITICAL: For Telegram Chatter, chat_ids[0] should be the group ID from RunConfig
    # It should already be normalized with -100 prefix (e.g., -1003336913786)
    # Priority: created_group_chat_id (if group was just created) > chat_ids[0] (from Telegram Chatter)
    group_chat_id_for_autojoin = created_group_chat_id
    
    # If no created_group_chat_id, use first chat_id from chat_ids (this is from Telegram Chatter)
    if not group_chat_id_for_autojoin and chat_ids:
        # Telegram Chatter sends the normalized group ID as chat_ids[0]
        group_chat_id_for_autojoin = chat_ids[0]
        logger.info(f"  Using chat_ids[0] for auto-join: {group_chat_id_for_autojoin}")
    
    logger.info(f"Initial group_chat_id_for_autojoin: {group_chat_id_for_autojoin}")
    
    # Ensure we're using GROUP, not channel
    # Group chat IDs are typically negative (e.g., -1003314170950)
    # If we have both group and channel, prefer group
    if not group_chat_id_for_autojoin and chat_ids and len(chat_ids) > 0:
        logger.info(f"  No group_chat_id_for_autojoin yet, searching chat_ids for negative IDs...")
        # Find group chat ID (negative ID) if available
        for chat_id in chat_ids:
            try:
                chat_id_int = int(chat_id)
                logger.info(f"  Checking chat_id: {chat_id} (int: {chat_id_int})")
                # Group IDs are typically negative (supergroups start with -100)
                if chat_id_int < 0:
                    group_chat_id_for_autojoin = chat_id
                    logger.info(f"  ✅ Selected GROUP chat ID for auto-join: {group_chat_id_for_autojoin} (from chat_ids)")
                    break
            except (ValueError, TypeError) as e:
                logger.warning(f"  ⚠️ Could not parse chat_id {chat_id}: {e}")
    
    logger.info(f"Final group_chat_id_for_autojoin: {group_chat_id_for_autojoin}")
    logger.info(f"Has scripted_conversations: {bool(scripted_conversations)}, count: {len(scripted_conversations) if scripted_conversations else 0}")
    if scripted_conversations:
        logger.info(f"First conversation participants: {scripted_conversations[0].get('participants', []) if len(scripted_conversations) > 0 else 'N/A'}")
    logger.info(f"{'='*60}\n")
    
    # CRITICAL: Check for length > 0, not just truthiness (empty list [] is falsy but we still want to check)
    # Auto-join should run if we have a group ID AND conversations (even if conversations are loaded from file)
    has_conversations = scripted_conversations and len(scripted_conversations) > 0
    logger.info(f"🔍 Auto-join condition check:")
    logger.info(f"   group_chat_id_for_autojoin: {group_chat_id_for_autojoin}")
    logger.info(f"   has_conversations: {has_conversations}")
    logger.info(f"   Will run auto-join: {bool(group_chat_id_for_autojoin and has_conversations)}")
    
    if group_chat_id_for_autojoin and has_conversations:
        logger.info(f"\n{'='*60}")
        logger.info(f"AUTO-JOINING PARTICIPANTS TO GROUP")
        logger.info(f"{'='*60}")
        logger.info(f"Group ID: {group_chat_id_for_autojoin}")
        logger.info(f"Group source: {'Created by Telegram Group Creator' if created_group_chat_id else 'Existing group from Telegram Chatter'}")
        
        # Extract participant roles from scripted conversations
        # Only join users that are actually participants in the conversations (mod, user1, user2, etc.)
        participant_roles = set()
        for conv in scripted_conversations:
            participants = conv.get('participants', [])
            for participant in participants:
                if isinstance(participant, dict):
                    role = participant.get('role')
                    if role:
                        participant_roles.add(role)
                elif isinstance(participant, str):
                    participant_roles.add(participant)
        
        logger.info(f"Participant roles found in conversations: {sorted(participant_roles)}")
        
        # Find creator account phone to exclude from auto-join (they're already in the group)
        CREATOR_PHONE = '+13124733150'
        creator_phone = None
        for client in clients:
            if getattr(client, 'phone', None) == CREATOR_PHONE:
                creator_phone = CREATOR_PHONE
                break
        
        # Filter participants: Only join clients whose role matches conversation participants
        # AND exclude creator account (they're already in the group)
        # CRITICAL: Always include users with is_mod=True, even if their role isn't in conversations
        participants_to_join = []
        for client in clients:
            phone = getattr(client, 'phone', None)
            if phone == creator_phone:
                continue  # Skip creator
            
            # Get this client's role from user_roles dict
            client_role = user_roles.get(phone, '')
            is_mod_user = user_is_mod.get(phone, False)
            
            # Join if:
            # 1. Their role is in the conversation participants, OR
            # 2. They have is_mod=True (mods should always join, regardless of role)
            should_join = (client_role in participant_roles) or is_mod_user
            
            if should_join:
                participants_to_join.append(client)
                join_reason = "mod user" if is_mod_user else f"role: {client_role}"
                logger.info(f"  ✅ Will join: {phone} ({join_reason})")
            else:
                logger.info(f"  ⏭️ Skipping: {phone} (role: {client_role}, not in conversations and not mod)")
        
        logger.info(f"Participants to join: {len(participants_to_join)} accounts (roles: {sorted(participant_roles)}, excluding creator {creator_phone})")
        
        async def promote_mod_user_immediately(mod_client, mod_phone, group_entity, creator_client):
            """Promote a mod user to admin/moderator immediately after they join"""
            try:
                from telethon.tl.types import ChatAdminRights
                from telethon.errors import FloodWaitError
                
                # Create admin rights with ALL privileges EXCEPT anonymous
                # CRITICAL: Include all permissions needed for managing filters (/filters command)
                admin_rights = ChatAdminRights(
                    change_info=True,      # Can change group info
                    post_messages=True,     # Can post messages
                    edit_messages=True,     # Can edit messages
                    delete_messages=True,   # Can delete messages (needed for filters)
                    ban_users=True,         # Can ban users
                    invite_users=True,      # Can invite users
                    pin_messages=True,      # Can pin messages
                    add_admins=False,       # Mods can't add admins
                    anonymous=False,        # NOT anonymous (user will be visible as admin)
                    manage_call=True,       # Can manage calls
                    other=True,            # Other admin rights (includes filter management)
                )
                
                # Get mod user's entity
                mod_user_entity = await mod_client.client.get_me()
                
                # Promote to admin using EditAdminRequest (correct Telegram API)
                from telethon.tl.functions.channels import EditAdminRequest
                logger.info(f"  📤 Promoting {mod_phone} to admin/moderator immediately...")
                try:
                    await creator_client.client(EditAdminRequest(
                        channel=group_entity,
                        user_id=mod_user_entity,
                        admin_rights=admin_rights,
                        rank="Moderator"
                    ))
                    logger.info(f"  ✅ Successfully promoted {mod_phone} to admin/moderator")
                    return True
                except FloodWaitError as flood_error:
                    wait_time = flood_error.seconds
                    logger.warning(f"  ⚠️ RATE LIMITED: Waiting {wait_time} seconds...")
                    await asyncio.sleep(wait_time)
                    await creator_client.client(EditAdminRequest(
                        channel=group_entity,
                        user_id=mod_user_entity,
                        admin_rights=admin_rights,
                        rank="Moderator"
                    ))
                    logger.info(f"  ✅ Successfully promoted {mod_phone} after rate limit wait")
                    return True
            except Exception as e:
                error_str = str(e)
                logger.warning(f"  ⚠️ Failed to promote {mod_phone}: {error_str}")
                import traceback
                logger.warning(traceback.format_exc())
                return False
        
        async def join_participants_to_group():
            """Have all conversation participants join the created group"""
            joined_count = 0
            failed_count = 0
            already_member_count = 0
            
            logger.info(f"🔍 JOIN FUNCTION: Using group_chat_id_for_autojoin = {group_chat_id_for_autojoin}")
            logger.info(f"🔍 JOIN FUNCTION: Type = {type(group_chat_id_for_autojoin)}")
            logger.info(f"🔍 JOIN FUNCTION: Converting to int: {int(group_chat_id_for_autojoin)}")
            
            # CRITICAL: For private groups, we need to use InviteToChannelRequest from creator account
            # join_chat() doesn't work for private groups - users must be invited
            # Find creator account (the one that created the group)
            creator_client = None
            for client in clients:
                if getattr(client, 'phone', None) == creator_phone:
                    creator_client = client
                    break
            
            if not creator_client:
                logger.warning(f"⚠️ Creator account ({creator_phone}) not found in clients - cannot invite users to private group")
                logger.warning("   Users will need to join manually or use invite link")
                return {'joined': 0, 'already_member': 0, 'failed': len(participants_to_join)}
            
            # Get group entity using creator account (has admin rights)
            try:
                group_id_int = int(group_chat_id_for_autojoin)
                logger.info(f"🔍 Attempting to get entity for group ID: {group_id_int}")
                group_entity = await creator_client.client.get_entity(group_id_int)
                logger.info(f"✅ Successfully got group entity: {group_entity}")
                logger.info(f"   Entity ID: {group_entity.id}")
                logger.info(f"   Entity title: {getattr(group_entity, 'title', 'N/A')}")
            except Exception as e:
                logger.error(f"❌ Failed to get group entity for ID {group_chat_id_for_autojoin}: {e}")
                logger.error(f"   Error type: {type(e).__name__}")
                import traceback
                logger.error(traceback.format_exc())
                return {'joined': 0, 'already_member': 0, 'failed': len(participants_to_join)}
            
            # Check if group is private (no username)
            is_private = not hasattr(group_entity, 'username') or not group_entity.username
            
            # CRITICAL: For private groups, use invite links (most reliable method)
            # Direct adds via InviteToChannelRequest don't sync Telethon's entity cache
            # Using invite links ensures users join AND Telethon syncs dialogs properly
            if is_private:
                logger.info(f"🔒 Group is PRIVATE - using invite link method (most reliable for Telethon)")
                from telethon.tl.functions.messages import ExportChatInviteRequest
                try:
                    # Step 1: Export invite link from creator account
                    logger.info(f"  📤 Exporting invite link from creator account...")
                    try:
                        invite_result = await creator_client.client(ExportChatInviteRequest(
                            peer=int(group_chat_id_for_autojoin)
                        ))
                        invite_link = invite_result.link
                        logger.info(f"  ✅ Invite link generated: {invite_link}")
                    except Exception as e:
                        error_str = str(e)
                        logger.error(f"  ❌ Failed to export invite link: {error_str}")
                        logger.error(f"   Error type: {type(e).__name__}")
                        import traceback
                        logger.error(traceback.format_exc())
                        return {'joined': 0, 'already_member': 0, 'failed': len(participants_to_join)}
                    
                    # Step 2: Have each user join via invite link
                    # Extract hash from invite link (format: https://t.me/+HASH)
                    import re
                    invite_hash = None
                    if invite_link.startswith('https://t.me/+'):
                        invite_hash = invite_link.replace('https://t.me/+', '')
                    elif '/+' in invite_link:
                        invite_hash = invite_link.split('/+')[-1]
                    
                    if not invite_hash:
                        logger.error(f"  ❌ Could not extract hash from invite link: {invite_link}")
                        return {'joined': 0, 'already_member': 0, 'failed': len(participants_to_join)}
                    
                    logger.info(f"  📋 Extracted invite hash: {invite_hash}")
                    
                    added_count = 0
                    for client in participants_to_join:
                        phone = getattr(client, 'phone', 'unknown')
                        try:
                            logger.info(f"  📤 Having {phone} join via invite link...")
                            # Use ImportChatInviteRequest for invite links with hash
                            from telethon.tl.functions.messages import ImportChatInviteRequest
                            await client.client(ImportChatInviteRequest(hash=invite_hash))
                            logger.info(f"  ✅ {phone} joined via invite link")
                            
                            # CRITICAL: Force Telethon to sync dialogs so entity is cached
                            logger.info(f"  🔄 Syncing dialogs for {phone}...")
                            await client.client.get_dialogs()
                            await asyncio.sleep(0.5)  # Small delay for sync
                            
                            # Verify user can access the group entity
                            try:
                                entity = await client.client.get_entity(int(group_chat_id_for_autojoin))
                                logger.info(f"  ✅ Verified {phone} can access group (entity cached)")
                                added_count += 1
                                joined_count += 1
                                
                                # CRITICAL: If this user has role='mod' OR role='dev' OR is_mod=True, promote them immediately
                                client_role = user_roles.get(phone, '').lower() if user_roles.get(phone) else ''
                                is_mod_user = user_is_mod.get(phone, False)
                                should_promote = is_mod_user or client_role == 'mod' or client_role == 'dev'
                                if should_promote:
                                    logger.info(f"  🔑 User {phone} is a mod/dev (role: {user_roles.get(phone, 'unknown')}, is_mod: {is_mod_user}) - promoting to moderator immediately...")
                                    try:
                                        # Get group entity using creator account
                                        group_entity = await creator_client.client.get_entity(int(group_chat_id_for_autojoin))
                                        # Promote mod user immediately
                                        await promote_mod_user_immediately(client, phone, group_entity, creator_client)
                                    except Exception as promote_error:
                                        logger.warning(f"  ⚠️ Could not promote {phone} immediately: {promote_error}")
                                        logger.warning(f"     Will retry promotion later")
                                
                            except Exception as verify_error:
                                error_str = str(verify_error)
                                logger.warning(f"  ⚠️ {phone} joined but entity not cached yet: {error_str}")
                                logger.warning(f"     Retrying dialog sync...")
                                # Retry dialog sync
                                await client.client.get_dialogs()
                                await asyncio.sleep(1)
                                try:
                                    entity = await client.client.get_entity(int(group_chat_id_for_autojoin))
                                    logger.info(f"  ✅ Verified {phone} can access group (after retry)")
                                    added_count += 1
                                    joined_count += 1
                                    
                                    # CRITICAL: If this user has role='mod' OR role='dev' OR is_mod=True, promote them immediately
                                    client_role = user_roles.get(phone, '').lower() if user_roles.get(phone) else ''
                                    is_mod_user = user_is_mod.get(phone, False)
                                    should_promote = is_mod_user or client_role == 'mod' or client_role == 'dev'
                                    if should_promote:
                                        logger.info(f"  🔑 User {phone} is a mod/dev (role: {user_roles.get(phone, 'unknown')}, is_mod: {is_mod_user}) - promoting to moderator immediately...")
                                        try:
                                            group_entity = await creator_client.client.get_entity(int(group_chat_id_for_autojoin))
                                            await promote_mod_user_immediately(client, phone, group_entity, creator_client)
                                        except Exception as promote_error:
                                            logger.warning(f"  ⚠️ Could not promote {phone} immediately: {promote_error}")
                                            
                                except:
                                    logger.warning(f"  ⚠️ {phone} still cannot access group entity - may need manual check")
                                    failed_count += 1
                            
                            # Small delay between joins to avoid rate limits
                            await asyncio.sleep(1)
                            
                        except Exception as e:
                            error_str = str(e)
                            # Check if already a member
                            if any(keyword in error_str.lower() for keyword in ['already', 'member', 'participant', 'already a participant', 'already joined', 'already in']):
                                logger.info(f"  ✅ {phone} is already a member of the group")
                                # Still sync dialogs for already-member users
                                try:
                                    await client.client.get_dialogs()
                                    await client.client.get_entity(int(group_chat_id_for_autojoin))
                                    logger.info(f"  ✅ Verified {phone} can access group")
                                except:
                                    pass
                                already_member_count += 1
                                joined_count += 1
                            else:
                                logger.error(f"  ❌ FAILED TO JOIN {phone} to group: {error_str}")
                                logger.error(f"     Error type: {type(e).__name__}")
                                import traceback
                                logger.error(f"     Traceback:\n{traceback.format_exc()}")
                                failed_count += 1
                    
                    logger.info(f"  📊 Join complete: {added_count} added, {already_member_count} already members, {failed_count} failed")
                    
                    # Step 3: Whitelist/unmute accounts in safeguard bot (if safeguard is enabled)
                    if safeguard_bot_username and added_count > 0:
                        logger.info(f"\n{'='*60}")
                        logger.info(f"WHITELISTING ACCOUNTS IN SAFEGUARD BOT")
                        logger.info(f"{'='*60}")
                        
                        # Find creator account to send safeguard commands
                        safeguard_creator_client = None
                        for client in clients:
                            if getattr(client, 'phone', None) == creator_phone:
                                safeguard_creator_client = client
                                break
                        
                        if safeguard_creator_client:
                            # Get user entities for whitelisting
                            whitelisted_count = 0
                            for client in participants_to_join:
                                phone = getattr(client, 'phone', 'unknown')
                                try:
                                    # Get user entity
                                    me = await client.client.get_me()
                                    user_id = me.id
                                    username = getattr(me, 'username', None)
                                    
                                    # Send whitelist command to safeguard bot
                                    # Try multiple command formats (safeguard bot may use different syntax)
                                    whitelist_commands = []
                                    if username:
                                        whitelist_commands.append(f"/whitelist @{username}")
                                        whitelist_commands.append(f"/allowlist @{username}")
                                    whitelist_commands.append(f"/whitelist {user_id}")
                                    whitelist_commands.append(f"/allowlist {user_id}")
                                    
                                    # Also try with group ID context
                                    if group_chat_id_for_autojoin:
                                        if username:
                                            whitelist_commands.append(f"/whitelist {group_chat_id_for_autojoin} @{username}")
                                            whitelist_commands.append(f"/allowlist {group_chat_id_for_autojoin} @{username}")
                                        whitelist_commands.append(f"/whitelist {group_chat_id_for_autojoin} {user_id}")
                                        whitelist_commands.append(f"/allowlist {group_chat_id_for_autojoin} {user_id}")
                                    
                                    logger.info(f"  📤 Whitelisting {phone} (ID: {user_id}) in safeguard bot...")
                                    
                                    whitelisted = False
                                    for whitelist_command in whitelist_commands:
                                        try:
                                            result = await safeguard_creator_client.message_safeguard_bot_async(
                                                command=whitelist_command,
                                                safeguard_bot_username=safeguard_bot_username
                                            )
                                            
                                            if result.get('success'):
                                                logger.info(f"  ✅ Successfully whitelisted {phone} using: {whitelist_command}")
                                                whitelisted = True
                                                whitelisted_count += 1
                                                break
                                        except:
                                            continue  # Try next command format
                                    
                                    if not whitelisted:
                                        logger.warning(f"  ⚠️ Failed to whitelist {phone} - tried {len(whitelist_commands)} command formats")
                                    
                                    # Also try /unmute command as fallback
                                    unmute_commands = []
                                    if username:
                                        unmute_commands.append(f"/unmute @{username}")
                                    unmute_commands.append(f"/unmute {user_id}")
                                    if group_chat_id_for_autojoin:
                                        if username:
                                            unmute_commands.append(f"/unmute {group_chat_id_for_autojoin} @{username}")
                                        unmute_commands.append(f"/unmute {group_chat_id_for_autojoin} {user_id}")
                                    
                                    for unmute_command in unmute_commands[:2]:  # Try first 2 formats
                                        try:
                                            await safeguard_creator_client.message_safeguard_bot_async(
                                                command=unmute_command,
                                                safeguard_bot_username=safeguard_bot_username
                                            )
                                            break  # Stop if one works
                                        except:
                                            continue  # Try next format
                                    
                                    await asyncio.sleep(0.5)  # Small delay between commands
                                    
                                except Exception as e:
                                    logger.warning(f"  ⚠️ Could not whitelist {phone}: {e}")
                            
                            logger.info(f"  📊 Whitelist complete: {whitelisted_count}/{len(participants_to_join)} accounts whitelisted")
                        else:
                            logger.warning(f"  ⚠️ Creator account not found - cannot whitelist accounts in safeguard bot")
                    
                except Exception as e:
                    error_str = str(e)
                    logger.error(f"  ❌ Failed to add users via invite link: {error_str}")
                    logger.error(f"   Error type: {type(e).__name__}")
                    import traceback
                    logger.error(traceback.format_exc())
                    failed_count = len(participants_to_join)
            else:
                logger.info(f"🌐 Group is PUBLIC (has username) - using join_chat() with dialog sync")
                # For public groups: Use join_chat (works for public groups)
                for client in participants_to_join:
                    phone = getattr(client, 'phone', 'unknown')
                    try:
                        # Get the group entity
                        entity = await client.client.get_entity(int(group_chat_id_for_autojoin))

                        # Check if already a member by trying to get full channel info
                        try:
                            from telethon.tl.functions.channels import GetFullChannelRequest
                            if hasattr(entity, 'broadcast') or hasattr(entity, 'megagroup'):
                                # Try to get full channel info - if successful, we're already a member
                                await client.client(GetFullChannelRequest(entity))
                                logger.info(f"  ✅ {phone} is already a member of group {group_chat_id_for_autojoin}")
                                # Sync dialogs to ensure entity is cached
                                await client.client.get_dialogs()
                                already_member_count += 1
                                joined_count += 1
                                continue
                        except Exception:
                            # Not a member or not a channel - try to join
                            pass

                        # Join the group/channel using join_chat (works for public groups)
                        logger.info(f"  Joining {phone} to public group {group_chat_id_for_autojoin}...")
                        await client.client.join_chat(entity)
                        logger.info(f"  ✅ {phone} successfully joined group")
                        
                        # CRITICAL: Force Telethon to sync dialogs so entity is cached
                        await client.client.get_dialogs()
                        await asyncio.sleep(0.5)
                        
                        # CRITICAL: If this user has role='mod' OR role='dev' OR is_mod=True, promote them immediately
                        client_role = user_roles.get(phone, '').lower() if user_roles.get(phone) else ''
                        is_mod_user = user_is_mod.get(phone, False)
                        should_promote = is_mod_user or client_role == 'mod' or client_role == 'dev'
                        if should_promote:
                            logger.info(f"  🔑 User {phone} is a mod/dev (role: {user_roles.get(phone, 'unknown')}, is_mod: {is_mod_user}) - promoting to moderator immediately...")
                            try:
                                # Get group entity using creator account
                                group_entity = await creator_client.client.get_entity(int(group_chat_id_for_autojoin))
                                # Promote mod user immediately
                                await promote_mod_user_immediately(client, phone, group_entity, creator_client)
                            except Exception as promote_error:
                                logger.warning(f"  ⚠️ Could not promote {phone} immediately: {promote_error}")
                                logger.warning(f"     Will retry promotion later")
                        
                        joined_count += 1

                        # Small delay to avoid rate limits
                        await asyncio.sleep(1)

                    except Exception as e:
                        error_str = str(e)
                        # Check if already a member (common error)
                        if any(keyword in error_str.lower() for keyword in ['already', 'member', 'participant', 'joined', 'already a participant']):
                            logger.info(f"  ✅ {phone} is already a member of group {group_chat_id_for_autojoin}")
                            # Sync dialogs for already-member users
                            try:
                                await client.client.get_dialogs()
                            except:
                                pass
                            already_member_count += 1
                            joined_count += 1
                        else:
                            logger.error(f"  ❌ FAILED TO JOIN {phone} to group: {error_str}")
                            logger.error(f"     Error type: {type(e).__name__}")
                            import traceback
                            logger.error(f"     Traceback:\n{traceback.format_exc()}")
                            failed_count += 1
            
            logger.info(f"\n✅ Auto-join complete: {joined_count} total ({already_member_count} already members, {joined_count - already_member_count} newly joined/invited), {failed_count} failed")
            return {'joined': joined_count, 'already_member': already_member_count, 'failed': failed_count}
        
        try:
            join_result = asyncio.run_coroutine_threadsafe(join_participants_to_group(), loop).result(timeout=60)
            logger.info(f"Auto-join result: {join_result}")
        except Exception as e:
            logger.warning(f"⚠️ Error during auto-join: {e}")
            logger.warning("Continuing with conversation anyway - participants may need to join manually")
            import traceback
            logger.warning(traceback.format_exc())
        
        # STEP 1: Make creator anonymous FIRST (after all users have joined)
        # This MUST happen before promoting mods
        if group_chat_id_for_autojoin:
            logger.info(f"\n{'='*60}")
            logger.info(f"STEP 1: MAKING CREATOR ANONYMOUS (AFTER ALL USERS JOINED)")
            logger.info(f"{'='*60}")
            logger.info(f"Group ID: {group_chat_id_for_autojoin}")
            
            async def make_creator_anonymous():
                """Make creator anonymous after all users have joined"""
                CREATOR_PHONE = '+13124733150'
                creator_client = None
                for client in clients:
                    if getattr(client, 'phone', None) == CREATOR_PHONE:
                        creator_client = client
                        break
                
                if not creator_client:
                    logger.warning(f"⚠️ Creator account ({CREATOR_PHONE}) not found - cannot make anonymous")
                    return {'success': False, 'error': 'Creator account not found'}
                
                try:
                    from telethon.tl.functions.channels import EditAdminRequest, GetFullChannelRequest
                    from telethon.tl.types import ChatAdminRights, InputUserSelf
                    
                    group_entity = await creator_client.client.get_entity(int(group_chat_id_for_autojoin))
                    me = await creator_client.client.get_me()
                    full_channel = await creator_client.client(GetFullChannelRequest(group_entity))
                    
                    current_rights = None
                    if hasattr(full_channel, 'full_chat') and hasattr(full_channel.full_chat, 'admins'):
                        for admin in full_channel.full_chat.admins:
                            if admin.user_id == me.id and hasattr(admin, 'admin_rights'):
                                current_rights = admin.admin_rights
                                break
                    
                    if current_rights:
                        anonymous_rights = ChatAdminRights(
                            change_info=getattr(current_rights, 'change_info', True),
                            post_messages=getattr(current_rights, 'post_messages', True),
                            edit_messages=getattr(current_rights, 'edit_messages', True),
                            delete_messages=getattr(current_rights, 'delete_messages', True),
                            ban_users=getattr(current_rights, 'ban_users', True),
                            invite_users=getattr(current_rights, 'invite_users', True),
                            pin_messages=getattr(current_rights, 'pin_messages', True),
                            add_admins=getattr(current_rights, 'add_admins', True),
                            anonymous=True,  # CRITICAL: Enable "Remain Anonymous"
                            manage_call=getattr(current_rights, 'manage_call', False),
                            other=getattr(current_rights, 'other', False)
                        )
                    else:
                        anonymous_rights = ChatAdminRights(
                            change_info=True, post_messages=True, edit_messages=True,
                            delete_messages=True, ban_users=True, invite_users=True,
                            pin_messages=True, add_admins=True, anonymous=True,
                            manage_call=False, other=False
                        )
                    
                    await creator_client.client(EditAdminRequest(
                        channel=group_entity,
                        user_id=InputUserSelf(),
                        admin_rights=anonymous_rights,
                        rank="Admin"
                    ))
                    logger.info(f"✅ Creator 'Remain Anonymous' enabled (anonymous=True)")
                    return {'success': True}
                except Exception as e:
                    error_str = str(e)
                    logger.error(f"❌ Could not enable 'Remain Anonymous' for creator: {error_str}")
                    import traceback
                    logger.error(traceback.format_exc())
                    return {'success': False, 'error': error_str}
            
            try:
                anonymous_result = asyncio.run_coroutine_threadsafe(make_creator_anonymous(), loop).result(timeout=30)
                if anonymous_result.get('success'):
                    logger.info(f"✅ Creator anonymous enabled successfully")
                else:
                    error_msg = anonymous_result.get('error', 'Unknown error')
                    logger.error(f"❌ FAILED TO MAKE CREATOR ANONYMOUS: {error_msg}")
                    logger.error(f"   This is CRITICAL - creator will be visible!")
            except Exception as e:
                logger.error(f"❌ EXCEPTION while enabling creator anonymous: {e}")
                import traceback
                logger.error(f"   Full traceback:\n{traceback.format_exc()}")
            
            # Small delay before promoting mods
            logger.info(f"⏳ Waiting 2 seconds before promoting mods...")
            time.sleep(2)
        
        # STEP 2: Auto-promote mod users to admin/moderator with all privileges (but not anonymous)
        # This happens AFTER creator is made anonymous
        has_mods_or_devs = any(user_is_mod.get(phone, False) or (user_roles.get(phone, '').lower() in ['mod', 'dev']) for phone in user_roles.keys())
        if group_chat_id_for_autojoin and has_mods_or_devs:
            logger.info(f"\n{'='*60}")
            logger.info(f"AUTO-PROMOTING MOD USERS TO ADMIN/MODERATOR")
            logger.info(f"{'='*60}")
            logger.info(f"Group ID: {group_chat_id_for_autojoin}")
            
            async def promote_mod_users():
                """Promote users tagged as 'mod' to admin/moderator with all privileges"""
                promoted_count = 0
                failed_count = 0
                
                # Find creator account (has admin rights to promote others)
                CREATOR_PHONE = '+13124733150'
                creator_client = None
                for client in clients:
                    if getattr(client, 'phone', None) == CREATOR_PHONE:
                        creator_client = client
                        break
                
                if not creator_client:
                    logger.warning(f"⚠️ Creator account ({CREATOR_PHONE}) not found - cannot promote mod users")
                    return {'promoted': 0, 'failed': len([p for p, is_mod in user_is_mod.items() if is_mod])}
                
                # Get group entity
                try:
                    group_entity = await creator_client.client.get_entity(int(group_chat_id_for_autojoin))
                except Exception as e:
                    logger.error(f"❌ Failed to get group entity: {e}")
                    return {'promoted': 0, 'failed': len([p for p, is_mod in user_is_mod.items() if is_mod])}
                
                # Find all mod users and promote them
                from telethon.tl.functions.channels import EditAdminRequest
                from telethon.tl.types import ChatAdminRights
                
                # Create admin rights with ALL privileges EXCEPT anonymous
                # CRITICAL: Include all permissions needed for managing filters (/filters command)
                admin_rights = ChatAdminRights(
                    change_info=True,      # Can change group info
                    post_messages=True,     # Can post messages
                    edit_messages=True,     # Can edit messages
                    delete_messages=True,   # Can delete messages (needed for filters)
                    ban_users=True,         # Can ban users
                    invite_users=True,      # Can invite users
                    pin_messages=True,      # Can pin messages
                    add_admins=True,        # Can add admins
                    anonymous=False,        # NOT anonymous (user will be visible as admin)
                    manage_call=True,       # Can manage calls
                    other=True,            # Other admin rights (includes filter management)
                )
                
                # CRITICAL: Load participants first to ensure Telegram has synced user status
                logger.info("  🔍 Loading participants to sync user status...")
                try:
                    await creator_client.client.get_participants(group_entity, limit=100)
                    logger.info("  ✅ Participants loaded")
                    await asyncio.sleep(2)  # Wait for Telegram to fully sync
                except Exception as e:
                    logger.warning(f"  ⚠️ Could not load participants: {e}")
                    await asyncio.sleep(2)  # Still wait even if load fails
                
                # Promote users with role="Mod", role="Dev", or is_mod=True
                # User clarified: role="dev" is creator (skip), role="mod" should be promoted
                for phone in user_roles.keys():
                    # Skip creator account (role="dev" is creator, should stay anonymous)
                    if phone == CREATOR_PHONE:
                        logger.info(f"  ⏭️ Skipping creator account {phone} (role: dev, stays anonymous)")
                        continue
                    
                    # Check if this user should be promoted:
                    # 1. Has is_mod flag set to True
                    # 2. Has role="Mod" (case-insensitive) - THIS IS THE MODERATOR
                    # 3. Has role="Dev" (case-insensitive) - but skip creator (already handled above)
                    is_mod_flag = user_is_mod.get(phone, False)
                    user_role = user_roles.get(phone, '').lower() if user_roles.get(phone) else ''
                    should_promote = is_mod_flag or user_role == 'mod' or user_role == 'dev'
                    
                    logger.info(f"  🔍 Checking {phone}: role='{user_roles.get(phone, 'unknown')}', is_mod={is_mod_flag}, should_promote={should_promote}")
                    
                    if not should_promote:
                        logger.info(f"  ⏭️ Skipping {phone} (not a mod/dev)")
                        continue  # Skip non-mod/dev users
                    
                    # Find client for this mod/dev user
                    mod_client = None
                    for client in clients:
                        if getattr(client, 'phone', None) == phone:
                            mod_client = client
                            break
                    
                    if not mod_client:
                        logger.warning(f"  ⚠️ Mod/Dev user {phone} not found in clients")
                        failed_count += 1
                        continue
                    
                    # Skip creator account (they're already admin and should stay anonymous)
                    if phone == CREATOR_PHONE:
                        logger.info(f"  ⏭️ Skipping creator account {phone} (already admin, stays anonymous)")
                        continue
                    
                    try:
                        # Get mod user's entity
                        mod_user_entity = await mod_client.client.get_me()
                        
                        # Promote to admin using EditAdminRequest (correct Telegram API)
                        from telethon.tl.functions.channels import EditAdminRequest
                        logger.info(f"  📤 Promoting {phone} to admin/moderator...")
                        try:
                            await creator_client.client(EditAdminRequest(
                                channel=group_entity,
                                user_id=mod_user_entity,
                                admin_rights=admin_rights,
                                rank="Moderator"  # Admin rank/title
                            ))
                            logger.info(f"  ✅ Successfully promoted {phone} to admin/moderator")
                            promoted_count += 1
                        except FloodWaitError as flood_error:
                            wait_time = flood_error.seconds
                            logger.warning(f"  ⚠️ RATE LIMITED: Waiting {wait_time} seconds...")
                            await asyncio.sleep(wait_time)
                            await creator_client.client(EditAdminRequest(
                                channel=group_entity,
                                user_id=mod_user_entity,
                                admin_rights=admin_rights,
                                rank="Moderator"
                            ))
                            logger.info(f"  ✅ Successfully promoted {phone} after rate limit wait")
                            promoted_count += 1
                        
                        # Small delay to avoid rate limits
                        await asyncio.sleep(1)
                        
                    except Exception as e:
                        error_str = str(e)
                        logger.error(f"  ❌ FAILED TO PROMOTE {phone} to admin: {error_str}")
                        logger.error(f"     Error type: {type(e).__name__}")
                        logger.error(f"     User role: {user_roles.get(phone, 'unknown')}, is_mod: {is_mod_flag}")
                        logger.error(f"     Should promote: {should_promote}")
                        import traceback
                        logger.error(f"     Traceback:\n{traceback.format_exc()}")
                        failed_count += 1
                
                logger.info(f"\n✅ Mod promotion complete: {promoted_count} promoted, {failed_count} failed")
                return {'promoted': promoted_count, 'failed': failed_count}
            
            try:
                promote_result = asyncio.run_coroutine_threadsafe(promote_mod_users(), loop).result(timeout=60)
                logger.info(f"Mod promotion result: {promote_result}")
            except Exception as e:
                logger.warning(f"⚠️ Error during mod promotion: {e}")
                logger.warning("Continuing anyway - mod users may need to be promoted manually")
                import traceback
                logger.warning(traceback.format_exc())
        
        # Update chat_ids to include the group if not already present
        group_chat_id_str = str(group_chat_id_for_autojoin)
        if group_chat_id_str not in chat_ids:
            chat_ids.insert(0, group_chat_id_str)  # Add at the beginning
            logger.info(f"Updated chat_ids to include created group: {chat_ids}")
    
    # Create Telegram campaign with scripted conversations
    # Initialize bot token from config
    bot_token = config_data.get('bot_token') or Config.TELEGRAM_BOT_TOKEN
    telegram_campaign = TelegramCampaign(clients, scripted_conversations=scripted_conversations, bot_token=bot_token)
    
    # CRITICAL: Re-apply creator anonymous status RIGHT BEFORE conversations start
    # Telegram sometimes resets anonymous status, so we need to re-apply it
    # Also ensure mods are promoted before conversations start
    if group_chat_id_for_autojoin and scripted_conversations and len(scripted_conversations) > 0:
        logger.info(f"\n{'='*60}")
        logger.info(f"FINAL SETUP BEFORE CONVERSATIONS START")
        logger.info(f"{'='*60}")
        
        async def final_setup_before_conversations():
            """Final setup: Re-apply creator anonymous AND ensure mods are promoted"""
            CREATOR_PHONE = '+13124733150'
            creator_client = None
            for client in clients:
                if getattr(client, 'phone', None) == CREATOR_PHONE:
                    creator_client = client
                    break
            
            if not creator_client:
                logger.warning(f"⚠️ Creator account ({CREATOR_PHONE}) not found")
                return {'anonymous': False, 'mods_promoted': False}
            
            try:
                entity = await creator_client.client.get_entity(int(group_chat_id_for_autojoin))
                
                # STEP 1: Re-apply creator anonymous status
                logger.info("  🔍 STEP 1: Re-applying creator anonymous status...")
                try:
                    me = await creator_client.client.get_me()
                    from telethon.tl.functions.channels import EditAdminRequest, GetFullChannelRequest
                    from telethon.tl.types import ChatAdminRights, InputUserSelf
                    from telethon.errors import FloodWaitError
                    
                    # Load participants first
                    await creator_client.client.get_participants(entity, limit=100)
                    await asyncio.sleep(1)
                    
                    # Get current admin info to preserve existing rights
                    full_channel = await creator_client.client(GetFullChannelRequest(entity))
                    
                    # Get current admin rights if available
                    current_rights = None
                    if hasattr(full_channel, 'full_chat') and hasattr(full_channel.full_chat, 'admins'):
                        for admin in full_channel.full_chat.admins:
                            if admin.user_id == me.id and hasattr(admin, 'admin_rights'):
                                current_rights = admin.admin_rights
                                break
                    
                    # Create admin rights with anonymous=True
                    if current_rights:
                        anonymous_rights = ChatAdminRights(
                            change_info=getattr(current_rights, 'change_info', True),
                            post_messages=getattr(current_rights, 'post_messages', True),
                            edit_messages=getattr(current_rights, 'edit_messages', True),
                            delete_messages=getattr(current_rights, 'delete_messages', True),
                            ban_users=getattr(current_rights, 'ban_users', True),
                            invite_users=getattr(current_rights, 'invite_users', True),
                            pin_messages=getattr(current_rights, 'pin_messages', True),
                            add_admins=getattr(current_rights, 'add_admins', True),
                            anonymous=True,  # CRITICAL: Re-enable anonymous
                            manage_call=getattr(current_rights, 'manage_call', False),
                            other=getattr(current_rights, 'other', False)
                        )
                    else:
                        # Use full admin rights with anonymous=True
                        anonymous_rights = ChatAdminRights(
                            change_info=True,
                            post_messages=True,
                            edit_messages=True,
                            delete_messages=True,
                            ban_users=True,
                            invite_users=True,
                            pin_messages=True,
                            add_admins=True,
                            anonymous=True,  # CRITICAL: Re-enable anonymous
                            manage_call=False,
                            other=False
                        )
                    
                    try:
                        # Re-apply anonymous status
                        await creator_client.client(EditAdminRequest(
                            channel=entity,
                            user_id=InputUserSelf(),
                            admin_rights=anonymous_rights,
                            rank="Admin"
                        ))
                        logger.info("  ✅ Creator anonymous status re-applied successfully (anonymous=True)")
                        await asyncio.sleep(2)  # Wait for Telegram to process
                        anonymous_success = True
                    except FloodWaitError as flood_error:
                        wait_time = flood_error.seconds
                        logger.warning(f"  ⚠️ RATE LIMITED: Waiting {wait_time} seconds...")
                        await asyncio.sleep(wait_time)
                        await creator_client.client(EditAdminRequest(
                            channel=entity,
                            user_id=InputUserSelf(),
                            admin_rights=anonymous_rights,
                            rank="Admin"
                        ))
                        logger.info("  ✅ Creator anonymous status re-applied after rate limit wait")
                        anonymous_success = True
                except Exception as e:
                    error_str = str(e)
                    logger.error(f"  ❌ Could not re-apply anonymous status: {error_str}")
                    logger.error(f"     Error type: {type(e).__name__}")
                    import traceback
                    logger.error(traceback.format_exc())
                    anonymous_success = False
                
                # STEP 2: Ensure mods are promoted (promote again if needed)
                logger.info("  🔍 STEP 2: Ensuring mods are promoted...")
                mods_promoted_count = 0
                try:
                    from telethon.tl.functions.channels import EditAdminRequest, GetParticipantRequest
                    from telethon.tl.types import ChatAdminRights, ChannelParticipantAdmin, ChannelParticipantCreator
                    
                    # Load participants again
                    await creator_client.client.get_participants(entity, limit=100)
                    await asyncio.sleep(1)
                    
                    admin_rights = ChatAdminRights(
                        change_info=True, post_messages=True, edit_messages=True,
                        delete_messages=True, ban_users=True, invite_users=True,
                        pin_messages=True, add_admins=False, anonymous=False,
                        manage_call=True, other=True
                    )
                    
                    # Check each mod user and promote if not already admin
                    for phone in user_roles.keys():
                        if phone == CREATOR_PHONE:
                            continue  # Skip creator
                        
                        is_mod_flag = user_is_mod.get(phone, False)
                        user_role = user_roles.get(phone, '').lower() if user_roles.get(phone) else ''
                        should_promote = is_mod_flag or user_role == 'mod' or user_role == 'dev'
                        
                        if not should_promote:
                            continue
                        
                        # Find client
                        mod_client = None
                        for client in clients:
                            if getattr(client, 'phone', None) == phone:
                                mod_client = client
                                break
                        
                        if not mod_client:
                            continue
                        
                        try:
                            mod_user_entity = await mod_client.client.get_me()
                            
                            # Check if already admin (with retry for database locks)
                            is_already_admin = False
                            for retry in range(3):
                                try:
                                    participant = await creator_client.client(GetParticipantRequest(
                                        channel=entity,
                                        participant=mod_user_entity
                                    ))
                                    if isinstance(participant.participant, (ChannelParticipantAdmin, ChannelParticipantCreator)):
                                        logger.info(f"  ✅ {phone} is already admin - skipping")
                                        mods_promoted_count += 1
                                        is_already_admin = True
                                        break
                                    break  # Got result, not admin
                                except Exception as check_error:
                                    error_str = str(check_error).lower()
                                    if 'database is locked' in error_str or 'locked' in error_str:
                                        if retry < 2:
                                            wait_time = (retry + 1) * 2  # 2s, 4s
                                            logger.warning(f"  ⚠️ Database locked (check), waiting {wait_time}s and retrying...")
                                            await asyncio.sleep(wait_time)
                                            continue
                                    # Not a lock error or max retries - break
                                    break
                            
                            if is_already_admin:
                                continue
                            
                            # Promote to admin (with retry for database locks)
                            logger.info(f"  📤 Promoting {phone} (role: {user_roles.get(phone, 'unknown')}) to moderator...")
                            promotion_success = False
                            for retry in range(3):
                                try:
                                    await creator_client.client(EditAdminRequest(
                                        channel=entity,
                                        user_id=mod_user_entity,
                                        admin_rights=admin_rights,
                                        rank="Moderator"
                                    ))
                                    logger.info(f"  ✅ Successfully promoted {phone} to moderator")
                                    mods_promoted_count += 1
                                    promotion_success = True
                                    break
                                except Exception as promote_error:
                                    error_str = str(promote_error).lower()
                                    if 'database is locked' in error_str or 'locked' in error_str:
                                        if retry < 2:
                                            wait_time = (retry + 1) * 2  # 2s, 4s
                                            logger.warning(f"  ⚠️ Database locked (promote), waiting {wait_time}s and retrying...")
                                            await asyncio.sleep(wait_time)
                                            continue
                                        else:
                                            logger.error(f"  ❌ Database locked after {retry + 1} retries - giving up")
                                    else:
                                        # Not a lock error - break immediately
                                        raise promote_error
                            
                            if not promotion_success:
                                logger.error(f"  ❌ Failed to promote {phone} after retries")
                            
                            await asyncio.sleep(2)  # Delay between promotions
                        except Exception as e:
                            error_str = str(e)
                            logger.warning(f"  ⚠️ Could not promote {phone}: {error_str}")
                            import traceback
                            logger.warning(traceback.format_exc())
                    
                    logger.info(f"  ✅ Mod promotion check complete: {mods_promoted_count} mod(s) confirmed as admin")
                    mods_success = mods_promoted_count > 0
                except Exception as e:
                    logger.warning(f"  ⚠️ Error checking/promoting mods: {e}")
                    mods_success = False
                
                return {'anonymous': anonymous_success, 'mods_promoted': mods_success}
            except Exception as e:
                logger.error(f"❌ Error in final setup: {e}")
                import traceback
                logger.error(traceback.format_exc())
                return {'anonymous': False, 'mods_promoted': False}
        
        try:
            # Use existing loop, not create new one
            final_result = asyncio.run_coroutine_threadsafe(final_setup_before_conversations(), loop).result(timeout=60)
            if final_result.get('anonymous'):
                logger.info(f"✅ Creator anonymous status confirmed before conversations")
            else:
                logger.error(f"❌ FAILED TO RE-APPLY CREATOR ANONYMOUS STATUS!")
            if final_result.get('mods_promoted'):
                logger.info(f"✅ Mods confirmed as admin before conversations")
            else:
                logger.warning(f"⚠️ Mod promotion check failed or no mods found")
        except Exception as e:
            logger.error(f"❌ Error in final setup before conversations: {e}")
            import traceback
            logger.error(traceback.format_exc())
    
    # Log user roles for debugging
    logger.info(f"\n{'='*60}")
    logger.info(f"USER ROLES CONFIGURATION")
    logger.info(f"{'='*60}")
    for phone, role in user_roles.items():
        logger.info(f"  {phone}: role='{role}'")
    logger.info(f"{'='*60}\n")
    
    # Start conversation and wait for it to complete
    logger.info(f"Starting conversation...\n")
    
    try:
        conversation_thread = telegram_campaign.start_conversation_thread(
            campaign_id=campaign_id,
            direction=direction,
            chat_ids=chat_ids,
            user_roles=user_roles,
            user_is_mod=user_is_mod,
            token_name=token_name,
            token_symbol=token_symbol,
            token_address=token_address,
            website=website,
            telegram=telegram,
            twitter=twitter,
            docs=docs,
            description=description,
            chain=chain
        )
        
        # Calculate timeout based on conversation duration
        # Get max duration from scripted conversations
        max_duration = 300  # Default 5 minutes
        if scripted_conversations:
            for conv in scripted_conversations:
                total_delay = sum(
                    (msg.get('typing_delay', 0) + msg.get('delay_after', 0))
                    for msg in conv.get('messages', [])
                )
                max_duration = max(max_duration, total_delay)
        
        # Add 2 minute buffer for connection and processing
        timeout_seconds = int(max_duration) + 120
        logger.info(f"Waiting for conversation to complete (timeout: {timeout_seconds}s / {timeout_seconds/60:.1f} min)")
        
        # Wait for conversation thread to complete
        conversation_thread.join(timeout=timeout_seconds)
        
        logger.info(f"\n{'='*60}")
        logger.info(f"Conversation completed!")
        logger.info(f"{'='*60}")
        return True
        
    except Exception as e:
        logger.error(f"Error starting conversation: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return False

def main():
    """Main entry point - reads JSON config from stdin"""
    try:
        # Read JSON config from stdin with UTF-8 encoding for proper emoji handling
        # Ensure stdin is UTF-8 encoded (already set at top of file for Windows)
        input_data = sys.stdin.read()
        if not input_data:
            logger.error("No input data provided")
            sys.exit(1)
        
        # Parse JSON - Python's json.loads handles UTF-8 correctly by default
        data = json.loads(input_data)
        
        config_data = data.get('config', {})
        scripted_conversations = data.get('scripted_conversations', [])
        action = config_data.get('action')  # Check for manual action
        
        # Handle verify action (account verification)
        if action == 'verify':
            import asyncio
            from telegram_user_client import TelegramUserClient
            
            api_id = config_data.get('api_id')
            api_hash = config_data.get('api_hash')
            phone = config_data.get('phone')
            code = config_data.get('code')
            password = config_data.get('password')
            phone_code_hash = config_data.get('phone_code_hash')
            
            if not api_id or not api_hash or not phone:
                logger.error("Missing api_id, api_hash, or phone for verify action")
                print("TELEGRAM_VERIFY_RESULT:")
                print(json.dumps({"success": False, "error": "Missing api_id, api_hash, or phone"}))
                sys.exit(1)
            
            # Create session name from phone
            phone_clean = phone.replace('+', '').replace('-', '').replace(' ', '')
            session_name = phone_clean
            
            try:
                # Create client
                client = TelegramUserClient(
                    api_id=int(api_id),
                    api_hash=api_hash,
                    phone=phone,
                    session_name=session_name,
                )
                
                # Get event loop
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                
                async def verify_account():
                    try:
                        # Try to connect
                        await client.client.connect()
                        
                        # Check if authorized
                        if await client.client.is_user_authorized():
                            # Already authorized - get user info
                            me = await client.client.get_me()
                            logger.info(f"✅ Account verified: {phone}")
                            print("TELEGRAM_VERIFY_RESULT:")
                            print(json.dumps({
                                "success": True,
                                "verified": True,
                                "user": {
                                    "id": me.id,
                                    "username": me.username,
                                    "first_name": me.first_name,
                                    "last_name": me.last_name,
                                    "phone": phone,
                                },
                                "message": "Account verified successfully"
                            }))
                            await client.client.disconnect()
                            return
                        
                        # Not authorized - need to sign in
                        if code:
                            # Sign in with code
                            if password:
                                await client.client.sign_in(phone=phone, code=code, password=password)
                            else:
                                await client.client.sign_in(phone=phone, code=code, phone_code_hash=phone_code_hash)
                            
                            # Get user info
                            me = await client.client.get_me()
                            logger.info(f"✅ Account verified with code: {phone}")
                            print("TELEGRAM_VERIFY_RESULT:")
                            print(json.dumps({
                                "success": True,
                                "verified": True,
                                "user": {
                                    "id": me.id,
                                    "username": me.username,
                                    "first_name": me.first_name,
                                    "last_name": me.last_name,
                                    "phone": phone,
                                },
                                "message": "Account verified successfully"
                            }))
                            await client.client.disconnect()
                        else:
                            # Need code
                            sent_code = await client.client.send_code_request(phone)
                            logger.info(f"📱 Verification code sent to {phone}")
                            print("TELEGRAM_VERIFY_RESULT:")
                            print(json.dumps({
                                "success": True,
                                "verified": False,
                                "requires_code": True,
                                "phone_code_hash": sent_code.phone_code_hash,
                                "message": "Verification code sent to Telegram"
                            }))
                            await client.client.disconnect()
                    except Exception as e:
                        logger.error(f"Verification error: {e}")
                        import traceback
                        logger.error(traceback.format_exc())
                        print("TELEGRAM_VERIFY_RESULT:")
                        print(json.dumps({
                            "success": False,
                            "verified": False,
                            "error": str(e),
                            "message": f"Verification failed: {str(e)}"
                        }))
                
                loop.run_until_complete(verify_account())
                sys.exit(0)
            except Exception as e:
                logger.error(f"Verify action error: {e}")
                import traceback
                logger.error(traceback.format_exc())
                print("TELEGRAM_VERIFY_RESULT:")
                print(json.dumps({
                    "success": False,
                    "verified": False,
                    "error": str(e),
                    "message": f"Verification failed: {str(e)}"
                }))
                sys.exit(1)
        
        # Handle manual actions (make_creator_anonymous, promote_mods, etc.)
        if action:
            logger.info(f"\n{'='*60}")
            logger.info(f"MANUAL ACTION: {action}")
            logger.info(f"{'='*60}")
            
            group_chat_id = config_data.get('group_chat_id')
            if not group_chat_id:
                logger.error("❌ Missing group_chat_id for action")
                print("GROUP_ACTION_RESULT:")
                print(json.dumps({"success": False, "error": "Missing group_chat_id"}))
                sys.exit(1)
            
            # Initialize clients
            clients, user_roles, user_is_mod = initialize_clients(config_data)
            if not clients:
                logger.error("❌ No clients initialized")
                print("GROUP_ACTION_RESULT:")
                print(json.dumps({"success": False, "error": "No clients initialized"}))
                sys.exit(1)
            
            # Get event loop
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
            async def run_action():
                try:
                    # Connect all clients
                    for client in clients:
                        await client.client.connect()
                        if not await client.client.is_user_authorized():
                            logger.warning(f"⚠️ Client {client.phone} not authorized - skipping")
                            continue
                    
                    # Find creator account
                    CREATOR_PHONE = '+13124733150'
                    creator_client = None
                    for client in clients:
                        if getattr(client, 'phone', None) == CREATOR_PHONE:
                            creator_client = client
                            break
                    
                    if not creator_client:
                        logger.error(f"❌ Creator account ({CREATOR_PHONE}) not found")
                        print("GROUP_ACTION_RESULT:")
                        print(json.dumps({"success": False, "error": f"Creator account ({CREATOR_PHONE}) not found"}))
                        return
                    
                    # Get group entity
                    group_entity = await creator_client.client.get_entity(int(group_chat_id))
                    
                    # CRITICAL: Verify this is a GROUP, not a CHANNEL
                    logger.info(f"🔍 Verifying entity type...")
                    logger.info(f"   Entity ID: {group_entity.id}")
                    logger.info(f"   Entity title: {getattr(group_entity, 'title', 'N/A')}")
                    logger.info(f"   Entity type - broadcast: {getattr(group_entity, 'broadcast', None)}")
                    logger.info(f"   Entity type - megagroup: {getattr(group_entity, 'megagroup', None)}")
                    
                    # Ensure we're working with a GROUP (megagroup=True, broadcast=False)
                    # NOT a CHANNEL (broadcast=True)
                    is_channel = getattr(group_entity, 'broadcast', False)
                    is_megagroup = getattr(group_entity, 'megagroup', False)
                    
                    if is_channel and not is_megagroup:
                        logger.error(f"❌ ERROR: This is a CHANNEL, not a GROUP!")
                        logger.error(f"   Channels and Groups have different admin management!")
                        logger.error(f"   Promotion should be done in the GROUP, not the CHANNEL")
                        print("GROUP_ACTION_RESULT:")
                        print(json.dumps({"success": False, "error": "Entity is a channel, not a group. Promotion must be done in the group."}))
                        return
                    
                    if not is_megagroup:
                        logger.warning(f"⚠️ WARNING: This might be a small group (not a supergroup)")
                        logger.warning(f"   Small groups use different admin management")
                    
                    logger.info(f"✅ Confirmed: This is a {'MEGAGROUP' if is_megagroup else 'SMALL GROUP'} (not a channel)")
                    
                    # Verify creator is admin and has permission to add admins
                    logger.info(f"🔍 Verifying creator account permissions...")
                    try:
                        from telethon.tl.functions.channels import GetParticipantRequest
                        creator_participant = await creator_client.client(GetParticipantRequest(
                            channel=group_entity,
                            participant=await creator_client.client.get_me()
                        ))
                        logger.info(f"     Creator participant type: {type(creator_participant.participant)}")
                        
                        from telethon.tl.types import ChannelParticipantAdmin, ChannelParticipantCreator
                        if isinstance(creator_participant.participant, (ChannelParticipantAdmin, ChannelParticipantCreator)):
                            if isinstance(creator_participant.participant, ChannelParticipantAdmin):
                                admin_rights = creator_participant.participant.admin_rights
                                if admin_rights:
                                    can_add_admins = getattr(admin_rights, 'add_admins', False)
                                    logger.info(f"     Creator has 'add_admins' permission: {can_add_admins}")
                                    if not can_add_admins:
                                        logger.error(f"❌ CREATOR DOES NOT HAVE 'ADD ADMINS' PERMISSION!")
                                        logger.error(f"   The creator account needs 'Add new admins' permission to promote others")
                                        print("GROUP_ACTION_RESULT:")
                                        print(json.dumps({"success": False, "error": "Creator account does not have 'Add new admins' permission"}))
                                        return
                            else:
                                logger.info(f"     Creator is the group creator (has all permissions)")
                        else:
                            logger.error(f"❌ CREATOR IS NOT AN ADMIN!")
                            logger.error(f"   The creator account must be an admin to promote others")
                            print("GROUP_ACTION_RESULT:")
                            print(json.dumps({"success": False, "error": "Creator account is not an admin"}))
                            return
                    except Exception as perm_error:
                        logger.warning(f"⚠️ Could not verify creator permissions: {perm_error}")
                        logger.warning(f"   Continuing anyway, but promotion may fail...")
                    
                    if action == 'make_creator_anonymous':
                        # Make creator anonymous - using same approach as group creator
                        logger.info("🔍 Making creator anonymous...")
                        
                        # CRITICAL: Load participants first to ensure Telegram has synced user status
                        logger.info("  Loading participants to sync user status...")
                        try:
                            await creator_client.client.get_participants(group_entity, limit=100)
                            logger.info("  ✅ Participants loaded")
                            await asyncio.sleep(2)  # Wait for Telegram to fully sync
                        except Exception as e:
                            logger.warning(f"  ⚠️ Could not load participants: {e}")
                            await asyncio.sleep(2)  # Still wait even if load fails
                        
                        from telethon.tl.functions.channels import EditAdminRequest, GetFullChannelRequest
                        from telethon.tl.types import ChatAdminRights, InputUserSelf
                        from telethon.errors import FloodWaitError
                        
                        me = await creator_client.client.get_me()
                        logger.info(f"  Creator user ID: {me.id}")
                        
                        try:
                            # Get current admin info to preserve existing rights (same as group creator)
                            full_channel = await creator_client.client(GetFullChannelRequest(group_entity))
                            logger.info("  ✅ Got full channel info")
                            
                            # Get current admin rights if available
                            current_rights = None
                            if hasattr(full_channel, 'full_chat') and hasattr(full_channel.full_chat, 'admins'):
                                for admin in full_channel.full_chat.admins:
                                    if admin.user_id == me.id and hasattr(admin, 'admin_rights'):
                                        current_rights = admin.admin_rights
                                        logger.info(f"  ✅ Found current admin rights for creator")
                                        break
                            
                            # Create admin rights with anonymous=True
                            # Preserve existing rights if available, otherwise use full admin rights
                            if current_rights:
                                logger.info("  📋 Preserving existing admin rights and setting anonymous=True")
                                anonymous_rights = ChatAdminRights(
                                    change_info=getattr(current_rights, 'change_info', True),
                                    post_messages=getattr(current_rights, 'post_messages', True),
                                    edit_messages=getattr(current_rights, 'edit_messages', True),
                                    delete_messages=getattr(current_rights, 'delete_messages', True),
                                    ban_users=getattr(current_rights, 'ban_users', True),
                                    invite_users=getattr(current_rights, 'invite_users', True),
                                    pin_messages=getattr(current_rights, 'pin_messages', True),
                                    add_admins=getattr(current_rights, 'add_admins', True),
                                    anonymous=True,  # Enable "Remain Anonymous" - THIS IS THE KEY
                                    manage_call=getattr(current_rights, 'manage_call', False),
                                    other=getattr(current_rights, 'other', False)
                                )
                            else:
                                logger.info("  📋 Using full admin rights with anonymous=True")
                                # Use full admin rights with anonymous=True
                                anonymous_rights = ChatAdminRights(
                                    change_info=True,
                                    post_messages=True,
                                    edit_messages=True,
                                    delete_messages=True,
                                    ban_users=True,
                                    invite_users=True,
                                    pin_messages=True,
                                    add_admins=True,
                                    anonymous=True,  # Enable "Remain Anonymous"
                                    manage_call=False,
                                    other=False
                                )
                            
                            logger.info(f"  📋 Admin rights being set:")
                            logger.info(f"     - anonymous: {anonymous_rights.anonymous}")
                            logger.info(f"     - add_admins: {anonymous_rights.add_admins}")
                            
                            # Update admin rights with anonymous=True
                            # Use InputUserSelf() to reference the current user (same as group creator)
                            try:
                                result = await creator_client.client(EditAdminRequest(
                                    channel=group_entity,
                                    user_id=InputUserSelf(),  # Use InputUserSelf() instead of me
                                    admin_rights=anonymous_rights,
                                    rank="Admin"
                                ))
                                logger.info("  ✅ EditAdminRequest completed successfully")
                                
                                # Wait for Telegram to process
                                await asyncio.sleep(2)
                                
                                logger.info("✅ Creator 'Remain Anonymous' enabled (anonymous=True)")
                                print("GROUP_ACTION_RESULT:")
                                print(json.dumps({"success": True}))
                            except FloodWaitError as flood_error:
                                wait_time = flood_error.seconds
                                logger.warning(f"  ⚠️ RATE LIMITED: Telegram requires {wait_time} seconds wait")
                                logger.warning(f"  ⏳ Waiting {wait_time} seconds before retrying...")
                                await asyncio.sleep(wait_time)
                                
                                # Retry after waiting
                                logger.info(f"  🔄 Retrying make anonymous after rate limit wait...")
                                result = await creator_client.client(EditAdminRequest(
                                    channel=group_entity,
                                    user_id=InputUserSelf(),
                                    admin_rights=anonymous_rights,
                                    rank="Admin"
                                ))
                                logger.info("  ✅ EditAdminRequest completed successfully after retry")
                                await asyncio.sleep(2)
                                logger.info("✅ Creator 'Remain Anonymous' enabled (anonymous=True)")
                                print("GROUP_ACTION_RESULT:")
                                print(json.dumps({"success": True}))
                        except Exception as e:
                            error_str = str(e)
                            error_type = type(e).__name__
                            logger.error(f"❌ Could not enable 'Remain Anonymous' for creator: {error_str}")
                            logger.error(f"   Error type: {error_type}")
                            import traceback
                            logger.error(traceback.format_exc())
                            print("GROUP_ACTION_RESULT:")
                            print(json.dumps({"success": False, "error": error_str}))
                    
                    elif action == 'promote_mods':
                        # Promote all mod users
                        # Use Telethon's convenience method edit_admin() instead of raw EditAdminRequest
                        from telethon.tl.types import ChatAdminRights
                        
                        # Create admin rights with ALL required permissions
                        # According to Telethon docs: https://docs.telethon.dev/en/stable/modules/client.html
                        admin_rights = ChatAdminRights(
                            change_info=True,      # Can change group info
                            post_messages=True,     # Can post messages
                            edit_messages=True,     # Can edit messages
                            delete_messages=True,   # Can delete messages (CRITICAL for filters)
                            ban_users=True,         # Can ban users
                            invite_users=True,      # Can invite users
                            pin_messages=True,      # Can pin messages
                            add_admins=False,       # Mods can't add admins (only creator can)
                            anonymous=False,        # Mods are visible (not anonymous)
                            manage_call=True,       # Can manage calls
                            other=True              # Other admin rights (CRITICAL for filter management)
                        )
                        
                        promoted_count = 0
                        failed_count = 0
                        
                        logger.info(f"\n{'='*60}")
                        logger.info(f"PROMOTE_MODS ACTION - DETAILED DEBUG")
                        logger.info(f"{'='*60}")
                        logger.info(f"🔍 Total clients: {len(clients)}")
                        logger.info(f"🔍 Creator phone: {CREATOR_PHONE}")
                        logger.info(f"🔍 User roles from config:")
                        for phone, role in user_roles.items():
                            is_mod = user_is_mod.get(phone, False)
                            logger.info(f"     {phone}: role='{role}', is_mod={is_mod}")
                        logger.info(f"🔍 User is_mod flags:")
                        for phone, is_mod in user_is_mod.items():
                            logger.info(f"     {phone}: is_mod={is_mod}")
                        logger.info(f"{'='*60}\n")
                        
                        for client in clients:
                            phone = getattr(client, 'phone', None)
                            if not phone:
                                logger.warning(f"  ⚠️ Client has no phone attribute, skipping")
                                continue
                            
                            # CRITICAL: Skip creator account - NEVER promote creator
                            if phone == CREATOR_PHONE:
                                logger.info(f"  ⏭️ SKIPPING CREATOR ACCOUNT {phone} (must stay anonymous)")
                                continue
                            
                            # Get user entity to verify it's not the creator
                            try:
                                user_entity = await client.client.get_me()
                                user_id = user_entity.id
                                creator_entity = await creator_client.client.get_me()
                                creator_id = creator_entity.id
                                
                                # Double-check: Skip if this is the creator by user ID
                                if user_id == creator_id:
                                    logger.warning(f"  ⚠️ SKIPPING CREATOR (matched by user ID {user_id})")
                                    continue
                            except Exception as e:
                                logger.warning(f"  ⚠️ Could not verify user entity for {phone}: {e}")
                                continue
                            
                            # Normalize phone for lookup (remove spaces, dashes, parentheses)
                            normalized_phone = phone.replace(' ', '').replace('-', '').replace('(', '').replace(')', '')
                            
                            # Try to find user config with normalized phone
                            matching_phone = None
                            for config_phone in user_roles.keys():
                                normalized_config_phone = config_phone.replace(' ', '').replace('-', '').replace('(', '').replace(')', '')
                                if normalized_config_phone == normalized_phone:
                                    matching_phone = config_phone
                                    break
                            
                            if not matching_phone:
                                # Fallback: try exact match
                                matching_phone = phone if phone in user_roles else None
                            
                            # Check if this user should be promoted:
                            # 1. Has is_mod flag set to True
                            # 2. Has role="Mod" (case-insensitive)
                            # 3. Has role="Dev" (case-insensitive)
                            is_mod_flag = user_is_mod.get(matching_phone, False) if matching_phone else False
                            user_role = user_roles.get(matching_phone, '').lower() if matching_phone and user_roles.get(matching_phone) else ''
                            should_promote = is_mod_flag or user_role == 'mod' or user_role == 'dev'
                            
                            logger.info(f"  🔍 Checking {phone} (normalized: {normalized_phone})")
                            logger.info(f"     Matching config phone: {matching_phone}")
                            logger.info(f"     Role from config: {user_roles.get(matching_phone, 'NOT FOUND') if matching_phone else 'NO MATCH'}")
                            logger.info(f"     is_mod flag: {is_mod_flag}")
                            logger.info(f"     Should promote: {should_promote}")
                            
                            if not should_promote:
                                logger.info(f"  ⏭️ Skipping {phone} (role: {user_roles.get(matching_phone, 'unknown') if matching_phone else 'NO MATCH'}, is_mod: {is_mod_flag}) - not a mod/dev")
                                continue
                            
                            logger.info(f"  📤 Promoting {phone} (role: {user_roles.get(matching_phone, 'unknown') if matching_phone else 'NO MATCH'}, is_mod: {is_mod_flag})")
                            
                            try:
                                mod_user_entity = await client.client.get_me()
                                logger.info(f"     User ID: {mod_user_entity.id}, Username: {getattr(mod_user_entity, 'username', 'N/A')}")
                                
                                logger.info(f"     Attempting EditAdminRequest for user {mod_user_entity.id}...")
                                logger.info(f"     Group entity ID: {group_entity.id}, Title: {getattr(group_entity, 'title', 'N/A')}")
                                logger.info(f"     Group type: broadcast={getattr(group_entity, 'broadcast', None)}, megagroup={getattr(group_entity, 'megagroup', None)}")
                                
                                # Log admin rights being set - MUST specify ALL fields explicitly
                                logger.info(f"     Admin rights being set (ALL fields required by Telegram):")
                                logger.info(f"       - change_info: {admin_rights.change_info}")
                                logger.info(f"       - post_messages: {admin_rights.post_messages}")
                                logger.info(f"       - edit_messages: {admin_rights.edit_messages}")
                                logger.info(f"       - delete_messages: {admin_rights.delete_messages}")
                                logger.info(f"       - ban_users: {admin_rights.ban_users}")
                                logger.info(f"       - invite_users: {admin_rights.invite_users}")
                                logger.info(f"       - pin_messages: {admin_rights.pin_messages}")
                                logger.info(f"       - add_admins: {admin_rights.add_admins}")
                                logger.info(f"       - anonymous: {admin_rights.anonymous}")
                                logger.info(f"       - manage_call: {admin_rights.manage_call}")
                                logger.info(f"       - other: {admin_rights.other}")
                                
                                # CRITICAL: Load participants first to ensure Telegram has synced user status
                                logger.info(f"     Loading participants to sync user status...")
                                try:
                                    await creator_client.client.get_participants(group_entity, limit=100)
                                    logger.info(f"     ✅ Participants loaded")
                                    await asyncio.sleep(2)  # Wait for Telegram to fully sync
                                except Exception as e:
                                    logger.warning(f"     ⚠️ Could not load participants: {e}")
                                    await asyncio.sleep(2)  # Still wait even if load fails
                                
                                # Perform the promotion using Telethon's edit_admin() convenience method
                                # This is the recommended way according to Telethon docs
                                promotion_success = False
                                for retry in range(3):
                                    try:
                                        from telethon.errors import FloodWaitError
                                        
                                        # Use EditAdminRequest directly - this is the correct Telegram API call
                                        from telethon.tl.functions.channels import EditAdminRequest
                                        logger.info(f"     Using EditAdminRequest to promote user...")
                                        result = await creator_client.client(EditAdminRequest(
                                            channel=group_entity,
                                            user_id=mod_user_entity,
                                            admin_rights=admin_rights,
                                            rank="Moderator"
                                        ))
                                        logger.info(f"     edit_admin() completed. Result type: {type(result)}")
                                        
                                        # Check if result contains any errors
                                        updates_count = 0
                                        if hasattr(result, 'updates'):
                                            updates_count = len(result.updates)
                                            logger.info(f"     Updates count: {updates_count}")
                                            if updates_count == 0:
                                                logger.warning(f"     ⚠️ WARNING: EditAdminRequest returned 0 updates!")
                                                logger.warning(f"        This might mean:")
                                                logger.warning(f"        1. User is already admin (will verify)")
                                                logger.warning(f"        2. Telegram hasn't processed the change yet (will wait and verify)")
                                                logger.warning(f"        3. Promotion silently failed (will verify)")
                                            else:
                                                for update in result.updates:
                                                    logger.info(f"       Update type: {type(update).__name__}")
                                                    if hasattr(update, 'message'):
                                                        logger.info(f"         Message: {update.message}")
                                        
                                        # Check for RPC errors in the result
                                        if hasattr(result, 'rpc_error'):
                                            logger.error(f"     RPC Error: {result.rpc_error}")
                                        
                                        # CRITICAL: Wait longer for Telegram to process the promotion
                                        # If 0 updates, wait even longer
                                        wait_time = 8 if updates_count == 0 else 5
                                        logger.info(f"     ⏳ Waiting {wait_time} seconds for Telegram to process promotion...")
                                        await asyncio.sleep(wait_time)
                                        
                                        # Immediately verify after promotion to ensure it worked
                                        logger.info(f"     🔍 Immediate verification after promotion...")
                                        try:
                                            from telethon.tl.functions.channels import GetParticipantRequest
                                            from telethon.tl.types import ChannelParticipantAdmin, ChannelParticipantCreator
                                            
                                            verify_participant = await creator_client.client(GetParticipantRequest(
                                                channel=group_entity,
                                                participant=mod_user_entity
                                            ))
                                            
                                            if isinstance(verify_participant.participant, (ChannelParticipantAdmin, ChannelParticipantCreator)):
                                                rank = getattr(verify_participant.participant, 'rank', 'N/A')
                                                logger.info(f"     ✅ IMMEDIATE VERIFICATION: {phone} (ID: {mod_user_entity.id}) is admin with rank: {rank}")
                                                promotion_success = True
                                                break
                                            else:
                                                logger.warning(f"     ⚠️ IMMEDIATE VERIFICATION FAILED: User is NOT admin yet")
                                                logger.warning(f"        Participant type: {type(verify_participant.participant).__name__}")
                                                if retry < 2:
                                                    logger.info(f"        Will retry promotion...")
                                                    await asyncio.sleep(3)
                                                    continue
                                                else:
                                                    logger.error(f"        ❌ Promotion failed after {retry + 1} attempts")
                                                    promotion_success = False
                                                    break
                                        except Exception as immediate_verify_error:
                                            logger.warning(f"     ⚠️ Could not verify immediately: {immediate_verify_error}")
                                            # Continue anyway - will verify later
                                            promotion_success = True
                                            break
                                    except FloodWaitError as flood_error:
                                        wait_time = flood_error.seconds
                                        logger.warning(f"     ⚠️ RATE LIMITED: Telegram requires {wait_time} seconds wait")
                                        logger.warning(f"     ⏳ Waiting {wait_time} seconds before retrying...")
                                        await asyncio.sleep(wait_time)
                                        
                                        # Retry after waiting
                                        logger.info(f"     🔄 Retrying promotion after rate limit wait...")
                                        result = await creator_client.client(EditAdminRequest(
                                            channel=group_entity,
                                            user_id=mod_user_entity,
                                            admin_rights=admin_rights,
                                            rank="Moderator"
                                        ))
                                        logger.info(f"     ✅ edit_admin() completed successfully after retry")
                                        promotion_success = True
                                        break
                                    except Exception as promote_error:
                                        error_str = str(promote_error).lower()
                                        if 'database is locked' in error_str or 'locked' in error_str:
                                            if retry < 2:
                                                wait_time = (retry + 1) * 2  # 2s, 4s
                                                logger.warning(f"     ⚠️ DATABASE LOCKED: Waiting {wait_time}s and retrying...")
                                                await asyncio.sleep(wait_time)
                                                continue
                                            else:
                                                logger.error(f"     ❌ Database locked after {retry + 1} retries - giving up")
                                                raise promote_error
                                        else:
                                            # Not a lock error - raise immediately
                                            raise promote_error
                                
                                if not promotion_success:
                                    logger.error(f"  ❌ Failed to promote {phone} after retries")
                                    failed_count += 1
                                else:
                                    logger.info(f"  ✅ Successfully promoted {phone} to moderator")
                                    promoted_count += 1
                                    
                                    # CRITICAL: Wait longer for Telegram to fully process the promotion
                                    logger.info(f"     ⏳ Waiting 5 seconds for Telegram to fully process promotion...")
                                    await asyncio.sleep(5)
                                    
                                    # Verify promotion by checking admin list (only if promotion succeeded)
                                    logger.info(f"     Verifying promotion by checking admin list...")
                                    
                                    try:
                                        mod_user_entity = await client.client.get_me()
                                        
                                        # Method 1: Check participant status (most reliable)
                                        from telethon.tl.functions.channels import GetParticipantRequest
                                        from telethon.tl.types import ChannelParticipantAdmin, ChannelParticipantCreator
                                        
                                        participant = await creator_client.client(GetParticipantRequest(
                                            channel=group_entity,
                                            participant=mod_user_entity
                                        ))
                                        
                                        if isinstance(participant.participant, (ChannelParticipantAdmin, ChannelParticipantCreator)):
                                            rank = getattr(participant.participant, 'rank', 'N/A')
                                            logger.info(f"     ✅ VERIFIED (Method 1): {phone} (ID: {mod_user_entity.id}) is now admin with rank: {rank}")
                                        else:
                                            logger.warning(f"     ⚠️ VERIFICATION FAILED (Method 1): {phone} (ID: {mod_user_entity.id}) is NOT admin")
                                            logger.warning(f"        Participant type: {type(participant.participant).__name__}")
                                            
                                            # Method 2: Try checking admin list directly
                                            logger.info(f"     Trying Method 2: Checking admin list directly...")
                                            try:
                                                from telethon.tl.functions.channels import GetFullChannelRequest
                                                full_channel = await creator_client.client(GetFullChannelRequest(group_entity))
                                                
                                                admin_found = False
                                                if hasattr(full_channel, 'full_chat') and hasattr(full_channel.full_chat, 'admins'):
                                                    for admin in full_channel.full_chat.admins:
                                                        if hasattr(admin, 'user_id') and admin.user_id == mod_user_entity.id:
                                                            admin_found = True
                                                            rank = getattr(admin, 'rank', 'N/A')
                                                            logger.info(f"     ✅ VERIFIED (Method 2): {phone} (ID: {mod_user_entity.id}) found in admin list with rank: {rank}")
                                                            break
                                                
                                                if not admin_found:
                                                    logger.error(f"     ❌ VERIFICATION FAILED (Method 2): {phone} (ID: {mod_user_entity.id}) NOT found in admin list")
                                                    logger.error(f"        This means the promotion did NOT work!")
                                                    logger.error(f"        Please check manually in Telegram if the user is now an admin")
                                            except Exception as method2_error:
                                                logger.warning(f"     ⚠️ Method 2 verification failed: {method2_error}")
                                    
                                    except Exception as verify_error:
                                        logger.error(f"     ❌ Could not verify promotion: {verify_error}")
                                        import traceback
                                        logger.error(traceback.format_exc())
                                    
                            except Exception as edit_error:
                                error_str = str(edit_error)
                                logger.error(f"❌ EditAdminRequest FAILED: {error_str}")
                                logger.error(f"     Error type: {type(edit_error).__name__}")
                                import traceback
                                logger.error(f"     Traceback:\n{traceback.format_exc()}")
                                failed_count += 1
                        
                        print("GROUP_ACTION_RESULT:")
                        print(json.dumps({"success": True, "promoted": promoted_count, "failed": failed_count}))
                    
                    else:
                        logger.error(f"❌ Unknown action: {action}")
                        print("GROUP_ACTION_RESULT:")
                        print(json.dumps({"success": False, "error": f"Unknown action: {action}"}))
                    
                finally:
                    # Disconnect all clients
                    for client in clients:
                        try:
                            await client.client.disconnect()
                        except:
                            pass
            
            # Run the async action
            try:
                loop.run_until_complete(run_action())
            except Exception as e:
                logger.error(f"❌ Action failed: {e}")
                import traceback
                logger.error(traceback.format_exc())
                print("GROUP_ACTION_RESULT:")
                print(json.dumps({"success": False, "error": str(e)}))
            
            sys.exit(0)
        
        # Log what we received
        logger.info(f"\n{'='*60}")
        logger.info(f"PYTHON SCRIPT RECEIVED DATA")
        logger.info(f"{'='*60}")
        logger.info(f"scripted_conversations type: {type(scripted_conversations)}")
        logger.info(f"scripted_conversations length: {len(scripted_conversations) if scripted_conversations else 0}")
        if scripted_conversations and len(scripted_conversations) > 0:
            logger.info(f"First conversation ID: {scripted_conversations[0].get('id', 'N/A')}")
            logger.info(f"First conversation participants: {scripted_conversations[0].get('participants', [])}")
        logger.info(f"{'='*60}\n")
        
        if not config_data:
            logger.error("No config provided")
            sys.exit(1)
        
        success = run_campaign(config_data, scripted_conversations)
        sys.exit(0 if success else 1)
        
    except KeyboardInterrupt:
        logger.info("\nCampaign stopped by user")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()



"""
Telegram Campaign Runner - Accepts JSON config from Node.js
Runs a single Telegram conversation campaign
"""
import json
import sys
import asyncio
import logging
import threading
import io
import os
import time
from datetime import datetime
# Set UTF-8 encoding for Windows compatibility
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

from telegram_user_client import TelegramUserClient
from telegram_campaign import TelegramCampaign
from config import Config
from telethon.tl.functions.channels import InviteToChannelRequest

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def initialize_clients(config_data):
    """Initialize Telegram clients based on config"""
    clients = []
    user_roles = {}
    user_is_mod = {}
    
    users = config_data.get('users', {})
    
    # Handle case where users might be a JSON string (double-stringified)
    if isinstance(users, str):
        try:
            users = json.loads(users)
            # If it's still a string after parsing, parse again (double-stringified)
            if isinstance(users, str):
                users = json.loads(users)
        except (json.JSONDecodeError, TypeError) as e:
            logger.error(f"Failed to parse users JSON: {e}")
            logger.error(f"Users value (first 200 chars): {str(users)[:200]}")
            users = {}
    
    # Ensure users is a dict
    if not isinstance(users, dict):
        logger.error(f"Users is not a dict, got type: {type(users)}")
        logger.error(f"Users value: {users}")
        users = {}
    
    # Get phone from config_data first, then fallback to hardcoded value
    CREATOR_PHONE = config_data.get('telegram_phone') or '+13124733150'
    logger.info(f"🔍 Initializing ONLY creator account: {CREATOR_PHONE}")
    logger.info(f"🔍 Ignoring all other users for now")
    
    # ONLY initialize the creator account
    phone = CREATOR_PHONE
    user_config = users.get(phone, {})
    
    if not user_config:
        # Create a default config for the creator
        user_config = {'enabled': True, 'role': 'dev'}
        logger.info(f"   Creator account not in users config, using defaults")
    
    try:
        # Get credentials from config_data first, then fallback to Config (env vars)
        api_id = config_data.get('telegram_api_id') or Config.TELEGRAM_API_ID
        api_hash = config_data.get('telegram_api_hash') or Config.TELEGRAM_API_HASH
        
        # If not in config_data, try TELEGRAM_USER_CREDENTIALS
        if not api_id or not api_hash:
            credentials = Config.TELEGRAM_USER_CREDENTIALS.get(phone, {})
            api_id = api_id or credentials.get('api_id', Config.TELEGRAM_API_ID)
            api_hash = api_hash or credentials.get('api_hash', Config.TELEGRAM_API_HASH)
        
        # Convert api_id to int
        try:
            api_id = int(api_id) if api_id else None
        except (ValueError, TypeError):
            logger.warning(f"Invalid API ID for {phone}, using default")
            api_id = Config.TELEGRAM_API_ID
        
        # Final check - if still None, raise error
        if not api_id or not api_hash:
            raise ValueError("Telegram API ID and API Hash are required. Get them from https://my.telegram.org/apps")
        
        # Create session name - match the format used by verify_account (just phone number without +)
        # Prefer the simple format (13124733150.session) as that's what verify_account creates
        phone_clean = phone.replace('+', '').replace('-', '').replace(' ', '')
        import os
        # Check in telegram directory (where script runs from)
        # Get the directory where this script is located
        try:
            script_dir = os.path.dirname(os.path.abspath(__file__))
        except:
            script_dir = os.getcwd()
        session_file_simple = os.path.join(script_dir, f"{phone_clean}.session")
        session_file_full = os.path.join(script_dir, f"user_session_{phone_clean}.session")
        
        # Prefer simple format (what verify_account creates), fallback to user_session format
        if os.path.exists(session_file_simple):
            session_name = phone_clean
            logger.info(f"   ✓ Using session file: {os.path.basename(session_file_simple)}")
        elif os.path.exists(session_file_full):
            session_name = f"user_session_{phone_clean}"
            logger.info(f"   ✓ Using session file: {os.path.basename(session_file_full)}")
        else:
            logger.warning(f"   ⚠️  No session file found for {phone} (checked {os.path.basename(session_file_simple)} and {os.path.basename(session_file_full)})")
            logger.warning(f"   Please verify this account first using the Verify button")
        
        # Get user tag from config
        user_tag = Config.TELEGRAM_USER_NAMES.get(phone, 'creator')
        
        # Create client
        client = TelegramUserClient(
            api_id=api_id,
            api_hash=api_hash,
            phone=phone,
            session_name=session_name,
            user_tag=user_tag
        )
        clients.append(client)
        
        # Store role and mod status
        user_roles[phone] = user_config.get('role', 'dev')
        user_is_mod[phone] = user_config.get('is_mod', False)
        logger.info(f"   ✓ Initialized creator account: [{user_tag}] {phone} (role: {user_roles[phone]}, mod: {user_is_mod[phone]})")
    except Exception as e:
        logger.error(f"Failed to initialize {phone}: {e}")
        import traceback
        logger.error(traceback.format_exc())
    
    # Verify creator was initialized
    creator_found = any(getattr(client, 'phone', None) == CREATOR_PHONE or 
                       getattr(client, 'phone', '').replace(' ', '').replace('-', '') == CREATOR_PHONE.replace(' ', '').replace('-', '')
                       for client in clients)
    if not creator_found:
        logger.warning(f"⚠️ Creator account ({CREATOR_PHONE}) was NOT initialized!")
        logger.warning(f"   Initialized clients: {[getattr(c, 'phone', 'unknown') for c in clients]}")
    else:
        logger.info(f"✅ Creator account ({CREATOR_PHONE}) was successfully initialized")
    
    return clients, user_roles, user_is_mod

def run_campaign(config_data, scripted_conversations):
    """Run the campaign"""
    # Import datetime at function level to avoid shadowing issues
    from datetime import datetime as dt
    
    clients, user_roles, user_is_mod = initialize_clients(config_data)
    
    # Create a dictionary mapping phone numbers to clients for easy lookup
    clients_by_phone = {getattr(client, 'phone', None): client for client in clients if hasattr(client, 'phone')}
    
    # Check if we're creating groups/channels or running a campaign
    create_group = config_data.get('create_group', False) or False
    create_channel = config_data.get('create_channel', False) or False
    create_portal = config_data.get('create_portal', False) or False
    reuse_existing = config_data.get('reuse_existing', False) or False
    
    # For group/channel/portal creation, only need 1 user (the creator)
    # For campaigns with scripted conversations, need at least 2 users
    is_group_creation_mode = create_group or create_channel or create_portal or reuse_existing
    has_scripted_conversations = scripted_conversations and len(scripted_conversations) > 0
    
    if not is_group_creation_mode and has_scripted_conversations:
        # Only require 2+ users for campaigns with scripted conversations
        if len(clients) < 2:
            logger.error(f"Need at least 2 enabled users for campaigns with scripted conversations (have {len(clients)})")
            return False
    elif len(clients) < 1:
        # Need at least 1 user (the creator)
        logger.error(f"Need at least 1 enabled user (have {len(clients)})")
        return False
    else:
        logger.info(f"✓ Using {len(clients)} user(s) - {'group/channel creation mode' if is_group_creation_mode else 'campaign mode'}")
    
    campaign_id = config_data.get('campaign_id', f"campaign_{dt.now().strftime('%Y%m%d_%H%M%S')}")
    chat_ids = config_data.get('chat_ids', [])
    
    # Log chat_ids received from frontend
    logger.info(f"\n{'='*60}")
    logger.info(f"CHAT IDS RECEIVED FROM FRONTEND")
    logger.info(f"{'='*60}")
    logger.info(f"chat_ids: {chat_ids}")
    logger.info(f"chat_ids type: {type(chat_ids)}")
    logger.info(f"chat_ids length: {len(chat_ids) if chat_ids else 0}")
    if chat_ids:
        for i, chat_id in enumerate(chat_ids):
            logger.info(f"  [{i}] {chat_id} (type: {type(chat_id)})")
    logger.info(f"{'='*60}\n")
    
    token_name = config_data.get('token_name', 'TOKEN')
    token_symbol = config_data.get('token_symbol', '$TOKEN')
    contract_name = config_data.get('contract_name', '')  # Contract name for username generation
    token_address = config_data.get('token_address', '')
    website = config_data.get('website', '')
    telegram = config_data.get('telegram', '')
    twitter = config_data.get('twitter', '')
    docs = config_data.get('docs', '')
    description = config_data.get('description', '')
    chain = config_data.get('chain', '')
    direction = config_data.get('direction', 'Telegram launch chat conversation')
    
    logger.info(f"\n{'='*60}")
    logger.info(f"STARTING CAMPAIGN: {campaign_id}")
    logger.info(f"{'='*60}")
    logger.info(f"Direction: {direction}")
    logger.info(f"Chat IDs: {chat_ids}")
    logger.info(f"Users: {len(clients)}")
    logger.info(f"Token: {token_name} ({token_symbol})")
    if token_address:
        logger.info(f"Contract: {token_address}")
    if website:
        logger.info(f"Website: {website}")
    if telegram:
        logger.info(f"Telegram: {telegram}")
    logger.info(f"{'='*60}\n")
    
    # Create a persistent event loop in a background thread
    loop = asyncio.new_event_loop()
    
    def run_event_loop():
        asyncio.set_event_loop(loop)
        loop.run_forever()
    
    loop_thread = threading.Thread(target=run_event_loop, daemon=True)
    loop_thread.start()
    
    CREATOR_PHONE = '+13124733150'  # Define here for use in connect_all
    
    async def connect_all():
        # Connect clients sequentially with delays to avoid database locked errors
        # Skip clients that require interactive authentication (can't use input() from Node.js)
        # BUT never skip the creator account - it must work
        connected_clients = []
        for idx, client in enumerate(clients):
            try:
                # Add delay between connections to avoid SQLite database lock conflicts
                if idx > 0:
                    await asyncio.sleep(0.5)  # 500ms delay between connections
                
                # Check if session file exists before trying to connect
                phone = getattr(client, 'phone', 'unknown')
                session_name = getattr(client, '_session_name', None)
                if session_name:
                    import os
                    # Check both possible session file locations
                    session_file = f"{session_name}.session"
                    phone_clean = phone.replace('+', '').replace('-', '').replace(' ', '')
                    session_file_simple = f"{phone_clean}.session"
                    
                    # Check if either session file exists
                    if not os.path.exists(session_file) and not os.path.exists(session_file_simple):
                        logger.warning(f"Skipping {phone}: No session file found (checked {session_file} and {session_file_simple}). User needs to verify account first using the Verify button.")
                        continue
                    elif os.path.exists(session_file_simple):
                        # Update client to use the simple format session file (preferred)
                        logger.info(f"Found session file {session_file_simple} for {phone}, updating client session name")
                        # Update the session name - the client will use this when connecting
                        if hasattr(client, '_session_name'):
                            client._session_name = phone_clean
                        if hasattr(client, 'session_name'):
                            client.session_name = phone_clean
                
                await client.connect()
                logger.info(f"✓ Connected {phone}")
                connected_clients.append(client)
            except (ValueError, EOFError) as e:
                error_msg = str(e)
                # Skip clients that need interactive authentication UNLESS it's the creator account
                phone = getattr(client, 'phone', 'unknown')
                is_creator = phone == CREATOR_PHONE or phone.replace(' ', '').replace('-', '') == CREATOR_PHONE.replace(' ', '').replace('-', '')
                
                if "EOF" in error_msg or "read" in error_msg.lower() or "input" in error_msg.lower():
                    if is_creator:
                        # Creator account MUST work - fail if it can't authenticate
                        logger.error(f"❌ Creator account {phone} requires authentication but cannot authenticate interactively.")
                        logger.error(f"   Session file may be invalid or expired.")
                        logger.error(f"   Please verify this account first using the Verify button in the Telegram Group Creator node.")
                        raise ValueError(f"Creator account {phone} authentication failed: {error_msg}")
                    else:
                        logger.warning(f"Skipping {phone}: Requires interactive authentication. Session file may be missing or expired. Please verify this account first using the Verify button.")
                        continue
                else:
                    logger.error(f"Failed to connect client {getattr(client, 'phone', 'unknown')}: {error_msg}")
                    import traceback
                    logger.error(traceback.format_exc())
            except Exception as e:
                error_msg = str(e)
                logger.error(f"Failed to connect client {getattr(client, 'phone', 'unknown')}: {error_msg}")
                # If database locked, wait longer and retry once
                if "database is locked" in error_msg.lower() or "locked" in error_msg.lower():
                    logger.warning(f"Database locked, waiting 2 seconds and retrying...")
                    await asyncio.sleep(2)
                    try:
                        await client.connect()
                        phone = getattr(client, 'phone', 'unknown')
                        logger.info(f"✓ Connected {phone} on retry")
                        connected_clients.append(client)
                    except Exception as e2:
                        logger.error(f"Retry failed for {getattr(client, 'phone', 'unknown')}: {e2}")
                        import traceback
                        logger.error(traceback.format_exc())
                else:
                    import traceback
                    logger.error(traceback.format_exc())
        
        # Update clients list to only include successfully connected clients
        clients.clear()
        clients.extend(connected_clients)
        logger.info(f"Successfully connected {len(clients)} out of {len(connected_clients) + (len(clients) - len(connected_clients))} client(s)")
    
    # Run connection in the persistent loop
    try:
        asyncio.run_coroutine_threadsafe(connect_all(), loop).result(timeout=60)
    except Exception as e:
        logger.error(f"Connection failed: {e}")
        return False
    
    # Pre-check: Verify all accounts can access the chat_ids
    async def verify_chat_access():
        """Verify all clients can access all chat_ids before starting campaign"""
        errors = []
        for client in clients:
            phone = getattr(client, 'phone', 'unknown')
            for chat_id in chat_ids:
                try:
                    await client.client.get_entity(int(chat_id))
                    logger.info(f"✓ {phone} can access chat {chat_id}")
                except Exception as e:
                    error_msg = (
                        f"❌ {phone} cannot access chat/channel {chat_id}\n"
                        f"   Error: {str(e)}\n"
                        f"   To fix: Make sure the Telegram account {phone} has joined the channel/group before running the campaign."
                    )
                    logger.error(error_msg)
                    errors.append((phone, chat_id, str(e)))
        return errors
    
    logger.info(f"\n{'='*60}")
    logger.info(f"VERIFYING CHAT ACCESS")
    logger.info(f"{'='*60}")
    try:
        access_errors = asyncio.run_coroutine_threadsafe(verify_chat_access(), loop).result(timeout=30)
        if access_errors:
            logger.warning(f"\n⚠️ Found {len(access_errors)} access error(s). Campaign may fail.")
            logger.warning("Please ensure all accounts have joined the channels/groups before running the campaign.")
            logger.warning("Proceeding anyway - campaign will attempt to run but may fail.\n")
            # Don't return False - let it try anyway, errors will be caught during actual message sending
        else:
            logger.info(f"✅ All accounts can access all chats\n")
    except Exception as e:
        logger.warning(f"Could not verify chat access: {e}")
        logger.warning("Proceeding anyway, but campaign may fail if accounts haven't joined channels.\n")
    
    # Check if we need to create or reuse a group/channel
    reuse_existing = config_data.get('reuse_existing', False) or False
    existing_group_chat_id = config_data.get('existing_group_chat_id', None)
    existing_channel_chat_id = config_data.get('existing_channel_chat_id', None)
    
    create_group = config_data.get('create_group', False) or False
    create_channel = config_data.get('create_channel', False) or False
    
    logger.info(f"🔍 Group/Channel mode check:")
    logger.info(f"   - reuse_existing: {reuse_existing}")
    logger.info(f"   - existing_group_chat_id: {existing_group_chat_id}")
    logger.info(f"   - existing_channel_chat_id: {existing_channel_chat_id}")
    logger.info(f"   - create_group: {create_group}")
    logger.info(f"   - create_channel: {create_channel}")
    create_portal = config_data.get('create_portal', False) or False
    safeguard_bot_username = config_data.get('safeguard_bot_username', '@safeguard')  # Default to @safeguard
    group_title_template = config_data.get('group_title_template', '{token_name}')
    group_description = config_data.get('group_description', '')
    channel_username = config_data.get('channel_username', None)  # Channel username (optional)
    contract_name = config_data.get('contract_name', '')  # Contract name for username generation
    group_photo_path = config_data.get('group_photo_path', None)
    group_photo_base64 = config_data.get('group_photo_base64', None)
    group_photo_filename = config_data.get('group_photo_filename', 'group_photo.png')
    token_image_url = config_data.get('token_image_url', None)  # Fallback: download from URL if base64 missing
    filter_script = config_data.get('filter_script', None)  # Filter commands to send after group creation
    group_settings = config_data.get('group_settings', {})
    
    created_group_chat_id = None
    created_channel_chat_id = None
    
    # Skip reuse logic if we're only doing portal setup (create_group=False, create_portal=True)
    # Portal setup doesn't need to access/reuse groups, it just needs the IDs
    # Note: token_address is NOT required for portal setup
    portal_only_mode = not create_group and create_portal
    
    if reuse_existing and not portal_only_mode:
        logger.info(f"\n{'='*60}")
        logger.info(f"REUSING EXISTING GROUP/CHANNEL")
        logger.info(f"{'='*60}")
        
        # Find creator account (phone: +13124733150) to manage groups/channels
        CREATOR_PHONE = '+13124733150'
        dev_client = None
        dev_phone = None
        
        # First try to find by specific phone number
        if CREATOR_PHONE in clients_by_phone:
            dev_client = clients_by_phone.get(CREATOR_PHONE)
            dev_phone = CREATOR_PHONE
        else:
            # Fallback: find dev account (role='dev')
            for phone, user_config in config_data.get('users', {}).items():
                if user_config.get('role') == 'dev':
                    dev_client = clients_by_phone.get(phone)
                    dev_phone = phone
                    break
        
        if not dev_client:
            logger.error(f"❌ Creator account ({CREATOR_PHONE}) not found. Cannot reuse group/channel.")
            return False
        
        logger.info(f"Using creator account to manage group/channel: {dev_phone}")
        
        # Prepare token info for updates
        token_name = config_data.get('token_name', 'TOKEN')
        token_symbol = config_data.get('token_symbol', '$TOKEN')
        contract_name = config_data.get('contract_name', '')  # Contract name for username generation
        final_title = group_title_template.replace('{token_name}', token_name).replace('{token_symbol}', token_symbol)
        final_description = group_description.replace('{token_name}', token_name).replace('{token_symbol}', token_symbol) if group_description else ''
        
        # Handle photo: Try base64 first, then URL download, then path
        final_photo_path = None
        if group_photo_base64:
            try:
                import base64
                # Extract base64 data (remove data:image/...;base64, prefix if present)
                base64_data = group_photo_base64
                if ',' in base64_data:
                    base64_data = base64_data.split(',')[1]
                
                photo_data = base64.b64decode(base64_data)
                
                # CRITICAL: Validate and resize image if too small
                # Telegram requires minimum 160x160 pixels
                try:
                    from PIL import Image
                    import io
                    
                    # Open image from bytes
                    img = Image.open(io.BytesIO(photo_data))
                    width, height = img.size
                    
                    logger.info(f"📸 Image dimensions: {width}x{height} pixels, size: {len(photo_data)} bytes")
                    
                    # Telegram minimum is 160x160, but we'll use 200x200 to be safe
                    min_size = 200
                    if width < min_size or height < min_size:
                        logger.warning(f"⚠️ Image too small ({width}x{height}), resizing to minimum {min_size}x{min_size}...")
                        # Resize maintaining aspect ratio, then crop to square
                        if width < height:
                            new_width = min_size
                            new_height = int(height * (min_size / width))
                        else:
                            new_height = min_size
                            new_width = int(width * (min_size / height))
                        
                        img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
                        # Crop to square
                        left = (new_width - min_size) // 2
                        top = (new_height - min_size) // 2
                        img = img.crop((left, top, left + min_size, top + min_size))
                        
                        # Convert to RGB if needed (for JPEG compatibility)
                        if img.mode != 'RGB':
                            img = img.convert('RGB')
                        
                        # Save resized image
                        output = io.BytesIO()
                        img.save(output, format='PNG', quality=95)
                        photo_data = output.getvalue()
                        logger.info(f"✅ Resized image to {min_size}x{min_size}, new size: {len(photo_data)} bytes")
                    else:
                        logger.info(f"✅ Image size OK ({width}x{height})")
                except ImportError:
                    logger.warning(f"⚠️ PIL/Pillow not available - cannot validate/resize image. Install with: pip install Pillow")
                except Exception as e:
                    logger.warning(f"⚠️ Could not validate/resize image: {e}. Using original image.")
                
                temp_dir = os.path.join(os.path.dirname(__file__), '..', 'temp', 'group_photos')
                os.makedirs(temp_dir, exist_ok=True)
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                extension = group_photo_filename.split('.')[-1] if '.' in group_photo_filename else 'png'
                photo_filename = f"{timestamp}_{group_photo_filename}"
                final_photo_path = os.path.join(temp_dir, photo_filename)
                with open(final_photo_path, 'wb') as f:
                    f.write(photo_data)
                logger.info(f"✅ Saved base64 photo to: {final_photo_path} ({len(photo_data)} bytes)")
            except Exception as e:
                logger.warning(f"⚠️ Could not save base64 photo: {e}. Will try URL download or photo_path.")
                final_photo_path = None  # Reset so we can try URL download
        
        # If base64 failed or missing, try downloading from token_image_url
        if not final_photo_path and token_image_url:
            try:
                import requests
                import os
                from datetime import datetime as dt
                
                logger.info(f"📥 Downloading token image from URL: {token_image_url}")
                response = requests.get(token_image_url, timeout=30)
                response.raise_for_status()
                
                image_data = response.content
                
                # CRITICAL: Validate and resize downloaded image if too small
                # Telegram requires minimum 160x160 pixels
                try:
                    from PIL import Image
                    import io
                    
                    # Open image from bytes
                    img = Image.open(io.BytesIO(image_data))
                    width, height = img.size
                    
                    logger.info(f"📸 Downloaded image dimensions: {width}x{height} pixels, size: {len(image_data)} bytes")
                    
                    # Telegram minimum is 160x160, but we'll use 200x200 to be safe
                    min_size = 200
                    if width < min_size or height < min_size:
                        logger.warning(f"⚠️ Downloaded image too small ({width}x{height}), resizing to minimum {min_size}x{min_size}...")
                        # Resize maintaining aspect ratio, then crop to square
                        if width < height:
                            new_width = min_size
                            new_height = int(height * (min_size / width))
                        else:
                            new_height = min_size
                            new_width = int(width * (min_size / height))
                        
                        img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
                        # Crop to square
                        left = (new_width - min_size) // 2
                        top = (new_height - min_size) // 2
                        img = img.crop((left, top, left + min_size, top + min_size))
                        
                        # Convert to RGB if needed (for JPEG compatibility)
                        if img.mode != 'RGB':
                            img = img.convert('RGB')
                        
                        # Save resized image
                        output = io.BytesIO()
                        img.save(output, format='PNG', quality=95)
                        image_data = output.getvalue()
                        logger.info(f"✅ Resized downloaded image to {min_size}x{min_size}, new size: {len(image_data)} bytes")
                    else:
                        logger.info(f"✅ Downloaded image size OK ({width}x{height})")
                except ImportError:
                    logger.warning(f"⚠️ PIL/Pillow not available - cannot validate/resize image. Install with: pip install Pillow")
                except Exception as e:
                    logger.warning(f"⚠️ Could not validate/resize downloaded image: {e}. Using original image.")
                
                # Create temp directory if it doesn't exist
                temp_dir = os.path.join(os.path.dirname(__file__), '..', 'temp', 'group_photos')
                os.makedirs(temp_dir, exist_ok=True)
                
                # Generate filename from URL or use default
                timestamp = dt.now().strftime('%Y%m%d_%H%M%S')
                # Try to get extension from URL
                url_extension = token_image_url.split('.')[-1].split('?')[0] if '.' in token_image_url else 'png'
                if url_extension not in ['png', 'jpg', 'jpeg', 'webp', 'gif']:
                    url_extension = 'png'
                photo_filename = f"{timestamp}_token_image.{url_extension}"
                final_photo_path = os.path.join(temp_dir, photo_filename)
                
                # Save downloaded image
                with open(final_photo_path, 'wb') as f:
                    f.write(image_data)
                
                logger.info(f"✅ Downloaded and saved token image to: {final_photo_path} ({len(image_data)} bytes)")
            except Exception as e:
                logger.warning(f"⚠️ Failed to download token image from URL: {e}. Will use photo_path if provided.")
                final_photo_path = group_photo_path  # Fallback to path if provided
        
        # Reuse group
        if existing_group_chat_id:
            logger.info(f"\n{'='*60}")
            logger.info(f"REUSING GROUP: {existing_group_chat_id}")
            logger.info(f"{'='*60}")
            
            try:
                async def reuse_group():
                    # Handle chat ID format: -1001234567890
                    # Telethon needs the entity to be in cache, so we need to access it first
                    chat_id_int = int(existing_group_chat_id)
                    try:
                        # First try: use the full negative ID directly
                        entity = await dev_client.client.get_entity(chat_id_int)
                    except ValueError as e:
                        # If entity not in cache, try to get dialogs first to populate cache
                        logger.info(f"Entity not in cache, fetching dialogs to populate cache...")
                        await dev_client.client.get_dialogs(limit=100)
                        # Now try again
                        try:
                            entity = await dev_client.client.get_entity(chat_id_int)
                        except Exception as e2:
                            # Last resort: try extracting channel ID for supergroups
                            if str(chat_id_int).startswith('-100'):
                                channel_id = abs(chat_id_int) - 1000000000000
                                from telethon.tl.types import PeerChannel
                                # Try to get from dialogs
                                async for dialog in dev_client.client.iter_dialogs():
                                    if hasattr(dialog.entity, 'id') and abs(dialog.entity.id) == abs(chat_id_int):
                                        entity = dialog.entity
                                        break
                                else:
                                    raise ValueError(f"Could not find group/channel {chat_id_int}. Make sure the dev account has joined it.")
                            else:
                                raise e2
                    
                    # STEP 1: Kick all users except dev account
                    logger.info("STEP 1: Kicking all users from group...")
                    me = await dev_client.client.get_me()
                    kicked_count = 0
                    async for participant in dev_client.client.iter_participants(entity):
                        if participant.id != me.id:  # Don't kick ourselves
                            try:
                                await dev_client.client.kick_participant(entity, participant)
                                kicked_count += 1
                                if kicked_count % 10 == 0:  # Log every 10 kicks
                                    logger.info(f"   Kicked {kicked_count} users...")
                                await asyncio.sleep(0.5)  # Small delay to avoid rate limits
                            except Exception as e:
                                logger.warning(f"   Could not kick user {participant.id}: {e}")
                    logger.info(f"✅ Kicked {kicked_count} users from group")
                    
                    # STEP 2: Update group title
                    logger.info(f"STEP 2: Updating group title to: {final_title}")
                    from telethon.tl.functions.channels import EditTitleRequest
                    await dev_client.client(EditTitleRequest(channel=entity, title=final_title))
                    logger.info("✅ Group title updated")
                    
                    # STEP 3: Update group description
                    if final_description:
                        logger.info(f"STEP 3: Updating group description")
                        await dev_client.client.edit_channel(entity, about=final_description)
                        logger.info("✅ Group description updated")
                    
                    # STEP 4: Update group photo
                    if final_photo_path and os.path.exists(final_photo_path):
                        logger.info(f"STEP 4: Updating group photo")
                        from telethon.tl.functions.channels import EditPhotoRequest
                        from telethon.tl.types import InputChatUploadedPhoto
                        from telethon.errors import FloodWaitError
                        try:
                            photo = await dev_client.client.upload_file(final_photo_path)
                            await dev_client.client(EditPhotoRequest(
                                channel=entity,
                                photo=InputChatUploadedPhoto(file=photo)
                            ))
                            logger.info("✅ Group photo updated")
                        except FloodWaitError as e:
                            wait_time = e.seconds
                            logger.warning(f"⚠️ Rate limited: Waiting {wait_time} seconds...")
                            await asyncio.sleep(wait_time)
                            photo = await dev_client.client.upload_file(final_photo_path)
                            await dev_client.client(EditPhotoRequest(
                                channel=entity,
                                photo=InputChatUploadedPhoto(file=photo)
                            ))
                            logger.info("✅ Group photo updated after wait")
                    
                    return {'success': True, 'chat_id': int(existing_group_chat_id)}
                
                # Ensure dev_client uses the same event loop
                if hasattr(dev_client, '_event_loop'):
                    dev_client._event_loop = loop
                group_result = asyncio.run_coroutine_threadsafe(reuse_group(), loop).result(timeout=600)
                if group_result.get('success'):
                    created_group_chat_id = group_result.get('chat_id')
                    logger.info(f"✅ Group reused successfully: {created_group_chat_id}")
            except Exception as e:
                logger.error(f"❌ Error reusing group: {e}")
                import traceback
                logger.error(traceback.format_exc())
        
        # Reuse channel
        if existing_channel_chat_id:
            logger.info(f"\n{'='*60}")
            logger.info(f"REUSING CHANNEL: {existing_channel_chat_id}")
            logger.info(f"{'='*60}")
            
            try:
                async def reuse_channel():
                    # Handle chat ID format: -1001234567890
                    # Telethon needs the entity to be in cache, so we need to access it first
                    chat_id_int = int(existing_channel_chat_id)
                    try:
                        # First try: use the full negative ID directly
                        entity = await dev_client.client.get_entity(chat_id_int)
                    except ValueError as e:
                        # If entity not in cache, try to get dialogs first to populate cache
                        logger.info(f"Entity not in cache, fetching dialogs to populate cache...")
                        await dev_client.client.get_dialogs(limit=100)
                        # Now try again
                        try:
                            entity = await dev_client.client.get_entity(chat_id_int)
                        except Exception as e2:
                            # Last resort: try extracting channel ID for supergroups
                            if str(chat_id_int).startswith('-100'):
                                channel_id = abs(chat_id_int) - 1000000000000
                                from telethon.tl.types import PeerChannel
                                # Try to get from dialogs
                                async for dialog in dev_client.client.iter_dialogs():
                                    if hasattr(dialog.entity, 'id') and abs(dialog.entity.id) == abs(chat_id_int):
                                        entity = dialog.entity
                                        break
                                else:
                                    raise ValueError(f"Could not find channel {chat_id_int}. Make sure the dev account has joined it.")
                            else:
                                raise e2
                    
                    # STEP 1: Kick all users except dev account
                    logger.info("STEP 1: Kicking all users from channel...")
                    me = await dev_client.client.get_me()
                    kicked_count = 0
                    async for participant in dev_client.client.iter_participants(entity):
                        if participant.id != me.id:  # Don't kick ourselves
                            try:
                                await dev_client.client.kick_participant(entity, participant)
                                kicked_count += 1
                                if kicked_count % 10 == 0:
                                    logger.info(f"   Kicked {kicked_count} users...")
                                await asyncio.sleep(0.5)
                            except Exception as e:
                                logger.warning(f"   Could not kick user {participant.id}: {e}")
                    logger.info(f"✅ Kicked {kicked_count} users from channel")
                    
                    # STEP 2: Update channel title
                    logger.info(f"STEP 2: Updating channel title to: {final_title}")
                    from telethon.tl.functions.channels import EditTitleRequest
                    await dev_client.client(EditTitleRequest(channel=entity, title=final_title))
                    logger.info("✅ Channel title updated")
                    
                    # STEP 3: Update channel description
                    if final_description:
                        logger.info(f"STEP 3: Updating channel description")
                        await dev_client.client.edit_channel(entity, about=final_description)
                        logger.info("✅ Channel description updated")
                    
                    # STEP 4: Update channel photo
                    if final_photo_path and os.path.exists(final_photo_path):
                        logger.info(f"STEP 4: Updating channel photo")
                        from telethon.tl.functions.channels import EditPhotoRequest
                        from telethon.tl.types import InputChatUploadedPhoto
                        from telethon.errors import FloodWaitError
                        try:
                            photo = await dev_client.client.upload_file(final_photo_path)
                            await dev_client.client(EditPhotoRequest(
                                channel=entity,
                                photo=InputChatUploadedPhoto(file=photo)
                            ))
                            logger.info("✅ Channel photo updated")
                        except FloodWaitError as e:
                            wait_time = e.seconds
                            logger.warning(f"⚠️ Rate limited: Waiting {wait_time} seconds...")
                            await asyncio.sleep(wait_time)
                            photo = await dev_client.client.upload_file(final_photo_path)
                            await dev_client.client(EditPhotoRequest(
                                channel=entity,
                                photo=InputChatUploadedPhoto(file=photo)
                            ))
                            logger.info("✅ Channel photo updated after wait")
                    
                    # STEP 5: Update channel username
                    if channel_username or token_symbol:
                        logger.info(f"STEP 5: Updating channel username")
                        from telethon.tl.functions.channels import UpdateUsernameRequest, CheckUsernameRequest
                        
                        # Generate username variations
                        # Use contract_name if available, otherwise fallback to token_name
                        if not channel_username:
                            # Generate base username from contract name (preferred), then token name, then symbol
                            contract_name = config_data.get('contract_name', '')
                            if contract_name:
                                base_name = contract_name.lower().replace(' ', '').replace('-', '').replace('_', '')
                            else:
                                base_name = token_name.lower().replace(' ', '').replace('-', '').replace('_', '')
                            
                            if not base_name or len(base_name) < 3:
                                base_name = token_symbol.replace('$', '').lower()
                            
                            # Username variations: name, name_tg, name_chat, name_group
                            username_variations = [
                                base_name,  # Just contract name
                                f"{base_name}_tg",  # name_tg
                                f"{base_name}_chat",  # name_chat
                                f"{base_name}_group",  # name_group
                            ]
                        else:
                            username_variations = [channel_username.replace('@', '')]
                        
                        final_channel_username = None
                        for username_variant in username_variations:
                            username_variant = username_variant.replace('@', '').lower().strip()
                            if len(username_variant) < 5 or len(username_variant) > 32:
                                continue
                            
                            try:
                                # Check if available
                                check_result = await dev_client.client(CheckUsernameRequest(
                                    channel=entity,
                                    username=username_variant
                                ))
                                
                                if check_result:
                                    # Set username
                                    await dev_client.client(UpdateUsernameRequest(
                                        channel=entity,
                                        username=username_variant
                                    ))
                                    final_channel_username = username_variant
                                    logger.info(f"✅ Channel username set to: @{final_channel_username}")
                                    break
                            except Exception as e:
                                continue
                        
                        if not final_channel_username:
                            logger.warning("⚠️ Could not set channel username")
                    
                    return {'success': True, 'chat_id': int(existing_channel_chat_id), 'username': final_channel_username}
                
                channel_result = asyncio.run_coroutine_threadsafe(reuse_channel(), loop).result(timeout=600)
                if channel_result.get('success'):
                    created_channel_chat_id = channel_result.get('chat_id')
                    logger.info(f"✅ Channel reused successfully: {created_channel_chat_id}")
            except Exception as e:
                logger.error(f"❌ Error reusing channel: {e}")
                import traceback
                logger.error(traceback.format_exc())
        
        # Output result for reuse mode (same format as creation mode)
        if reuse_existing and (created_group_chat_id or created_channel_chat_id):
            logger.info(f"\n{'='*60}")
            logger.info(f"GROUP/CHANNEL REUSE COMPLETE")
            logger.info(f"{'='*60}")
            logger.info(f"Using created group and channel: {created_group_chat_id}, {created_channel_chat_id}")
            
            # Get telegram link for channel if it has username
            telegram_link = None
            if created_channel_chat_id:
                try:
                    async def get_channel_link():
                        entity = await dev_client.client.get_entity(int(created_channel_chat_id))
                        if hasattr(entity, 'username') and entity.username:
                            return f"https://t.me/{entity.username.replace('@', '')}"
                        return None
                    telegram_link = asyncio.run_coroutine_threadsafe(get_channel_link(), loop).result(timeout=10)
                except Exception as e:
                    logger.warning(f"Could not get channel link: {e}")
            
            # Output GROUP_CREATOR_RESULT JSON (same format as creation mode)
            output_data = {
                "success": True,
                "group_chat_id": str(created_group_chat_id) if created_group_chat_id else None,
                "channel_chat_id": str(created_channel_chat_id) if created_channel_chat_id else None,
                "telegram_link": telegram_link,
                "portal_created": False
            }
            print(f"\n{'='*60}")
            print("GROUP_CREATOR_RESULT:")
            print(json.dumps(output_data))
            print(f"{'='*60}\n")
            return True
    
    elif create_group or portal_only_mode:
        if portal_only_mode:
            logger.info(f"\n{'='*60}")
            logger.info(f"PORTAL-ONLY MODE: Skipping group/channel creation/reuse")
            logger.info(f"{'='*60}")
            logger.info(f"Will use existing IDs for portal setup:")
            logger.info(f"  - Group ID: {existing_group_chat_id}")
            logger.info(f"  - Channel ID: {existing_channel_chat_id}")
        else:
            logger.info(f"\n{'='*60}")
            logger.info(f"CREATING TELEGRAM GROUP/CHANNEL")
            logger.info(f"{'='*60}")
        
        # Skip group creation if portal-only mode
        if portal_only_mode:
            # In portal-only mode, skip all group/channel creation/reuse
            # Portal setup will happen at the end using existing IDs
            logger.info("Portal-only mode: Skipping group/channel operations, will proceed to portal setup")
        else:
            # Find creator account - use phone from config_data or fallback to hardcoded
            CREATOR_PHONE = config_data.get('telegram_phone') or '+13124733150'
            dev_client = None
            dev_phone = None
            
            # First try to find by specific phone number (from config_data)
            for client in clients:
                if getattr(client, 'phone', None) == CREATOR_PHONE:
                    # Use the client if found, even if not in users config (for group creator mode)
                    dev_client = client
                    dev_phone = CREATOR_PHONE
                    logger.info(f"Found creator account by phone: {CREATOR_PHONE}")
                    break
            
            # Fallback: find dev account (role='dev') in users config
            if not dev_client:
                for phone, user_config in config_data.get('users', {}).items():
                    if user_config.get('role') == 'dev' and user_config.get('enabled', False):
                        # Find corresponding client
                        for client in clients:
                            if getattr(client, 'phone', None) == phone:
                                dev_client = client
                                dev_phone = phone
                                logger.info(f"Found creator account by role='dev': {phone}")
                                break
                        if dev_client:
                            break
            
            # Final fallback: use first client if only one exists (group creator mode)
            if not dev_client and len(clients) == 1:
                dev_client = clients[0]
                dev_phone = getattr(dev_client, 'phone', None) or CREATOR_PHONE
                logger.info(f"Using single available client as creator: {dev_phone}")
            
            if not dev_client:
                logger.error(f"No creator account found ({CREATOR_PHONE} or role='dev'). Cannot create group.")
                logger.error(f"Available clients: {[getattr(c, 'phone', 'unknown') for c in clients]}")
                return False
            
            logger.info(f"Using creator account to create group/channel: {dev_phone}")
        
        # Replace placeholders in group title
        group_title = group_title_template.replace('{token_name}', token_name)
        group_title = group_title.replace('{token_symbol}', token_symbol)
        
        # Replace placeholders in description
        final_description = group_description.replace('{token_name}', token_name)
        final_description = final_description.replace('{token_symbol}', token_symbol)
        final_description = final_description.replace('{description}', description)
        final_description = final_description.replace('{website}', website)
        final_description = final_description.replace('{telegram}', telegram)
        final_description = final_description.replace('{twitter}', twitter)
        final_description = final_description.replace('{chain}', chain)
        
        logger.info(f"Group title: {group_title}")
        if final_description:
            logger.info(f"Group description: {final_description[:100]}...")
        
        # Handle photo: Save base64 to file if provided, otherwise use path
        final_photo_path = group_photo_path
        if group_photo_base64:
            try:
                import base64
                import os
                # datetime is already imported at module level
                
                # Create temp directory if it doesn't exist
                temp_dir = os.path.join(os.path.dirname(__file__), '..', 'temp', 'group_photos')
                os.makedirs(temp_dir, exist_ok=True)
                
                # Extract base64 data (remove data:image/...;base64, prefix if present)
                base64_data = group_photo_base64
                if ',' in base64_data:
                    base64_data = base64_data.split(',')[1]
                
                photo_data = base64.b64decode(base64_data)
                
                # CRITICAL: Validate and resize image if too small
                # Telegram requires minimum 160x160 pixels
                try:
                    from PIL import Image
                    import io
                    
                    # Open image from bytes
                    img = Image.open(io.BytesIO(photo_data))
                    width, height = img.size
                    
                    logger.info(f"📸 Image dimensions: {width}x{height} pixels, size: {len(photo_data)} bytes")
                    
                    # Telegram minimum is 160x160, but we'll use 200x200 to be safe
                    min_size = 200
                    if width < min_size or height < min_size:
                        logger.warning(f"⚠️ Image too small ({width}x{height}), resizing to minimum {min_size}x{min_size}...")
                        # Resize maintaining aspect ratio, then crop to square
                        if width < height:
                            new_width = min_size
                            new_height = int(height * (min_size / width))
                        else:
                            new_height = min_size
                            new_width = int(width * (min_size / height))
                        
                        img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
                        # Crop to square
                        left = (new_width - min_size) // 2
                        top = (new_height - min_size) // 2
                        img = img.crop((left, top, left + min_size, top + min_size))
                        
                        # Convert to RGB if needed (for JPEG compatibility)
                        if img.mode != 'RGB':
                            img = img.convert('RGB')
                        
                        # Save resized image
                        output = io.BytesIO()
                        img.save(output, format='PNG', quality=95)
                        photo_data = output.getvalue()
                        logger.info(f"✅ Resized image to {min_size}x{min_size}, new size: {len(photo_data)} bytes")
                    else:
                        logger.info(f"✅ Image size OK ({width}x{height})")
                except ImportError:
                    logger.warning(f"⚠️ PIL/Pillow not available - cannot validate/resize image. Install with: pip install Pillow")
                except Exception as e:
                    logger.warning(f"⚠️ Could not validate/resize image: {e}. Using original image.")
                
                # Generate filename
                from datetime import datetime as dt
                timestamp = dt.now().strftime('%Y%m%d_%H%M%S')
                extension = group_photo_filename.split('.')[-1] if '.' in group_photo_filename else 'png'
                photo_filename = f"{timestamp}_{group_photo_filename}"
                final_photo_path = os.path.join(temp_dir, photo_filename)
                
                # Save base64 to file
                with open(final_photo_path, 'wb') as f:
                    f.write(photo_data)
                
                logger.info(f"✅ Saved base64 photo to: {final_photo_path} ({len(photo_data)} bytes)")
            except Exception as e:
                logger.warning(f"⚠️ Failed to save base64 photo: {e}. Will try URL download or photo_path.")
                final_photo_path = None  # Reset so we can try URL download
        
        # If base64 failed or missing, try downloading from token_image_url
        if not final_photo_path and token_image_url:
            try:
                import requests
                import os
                from datetime import datetime as dt
                
                logger.info(f"📥 Downloading token image from URL: {token_image_url}")
                response = requests.get(token_image_url, timeout=30)
                response.raise_for_status()
                
                image_data = response.content
                
                # CRITICAL: Validate and resize downloaded image if too small
                # Telegram requires minimum 160x160 pixels
                try:
                    from PIL import Image
                    import io
                    
                    # Open image from bytes
                    img = Image.open(io.BytesIO(image_data))
                    width, height = img.size
                    
                    logger.info(f"📸 Downloaded image dimensions: {width}x{height} pixels, size: {len(image_data)} bytes")
                    
                    # Telegram minimum is 160x160, but we'll use 200x200 to be safe
                    min_size = 200
                    if width < min_size or height < min_size:
                        logger.warning(f"⚠️ Downloaded image too small ({width}x{height}), resizing to minimum {min_size}x{min_size}...")
                        # Resize maintaining aspect ratio, then crop to square
                        if width < height:
                            new_width = min_size
                            new_height = int(height * (min_size / width))
                        else:
                            new_height = min_size
                            new_width = int(width * (min_size / height))
                        
                        img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
                        # Crop to square
                        left = (new_width - min_size) // 2
                        top = (new_height - min_size) // 2
                        img = img.crop((left, top, left + min_size, top + min_size))
                        
                        # Convert to RGB if needed (for JPEG compatibility)
                        if img.mode != 'RGB':
                            img = img.convert('RGB')
                        
                        # Save resized image
                        output = io.BytesIO()
                        img.save(output, format='PNG', quality=95)
                        image_data = output.getvalue()
                        logger.info(f"✅ Resized downloaded image to {min_size}x{min_size}, new size: {len(image_data)} bytes")
                    else:
                        logger.info(f"✅ Downloaded image size OK ({width}x{height})")
                except ImportError:
                    logger.warning(f"⚠️ PIL/Pillow not available - cannot validate/resize image. Install with: pip install Pillow")
                except Exception as e:
                    logger.warning(f"⚠️ Could not validate/resize downloaded image: {e}. Using original image.")
                
                # Create temp directory if it doesn't exist
                temp_dir = os.path.join(os.path.dirname(__file__), '..', 'temp', 'group_photos')
                os.makedirs(temp_dir, exist_ok=True)
                
                # Generate filename from URL or use default
                timestamp = dt.now().strftime('%Y%m%d_%H%M%S')
                # Try to get extension from URL
                url_extension = token_image_url.split('.')[-1].split('?')[0] if '.' in token_image_url else 'png'
                if url_extension not in ['png', 'jpg', 'jpeg', 'webp', 'gif']:
                    url_extension = 'png'
                photo_filename = f"{timestamp}_token_image.{url_extension}"
                final_photo_path = os.path.join(temp_dir, photo_filename)
                
                # Save downloaded image
                with open(final_photo_path, 'wb') as f:
                    f.write(image_data)
                
                logger.info(f"✅ Downloaded and saved token image to: {final_photo_path} ({len(image_data)} bytes)")
            except Exception as e:
                logger.warning(f"⚠️ Failed to download token image from URL: {e}. Will use photo_path if provided.")
                final_photo_path = group_photo_path  # Fallback to path if provided
        
        # IMPORTANT: If create_channel is true, we want to create BOTH a group AND a channel
        # So the first block should ALWAYS create a GROUP (not a channel)
        # The channel will be created separately in the create_channel block
        # Only use is_channel=true if create_channel is false (meaning we only want one thing)
        is_channel_for_group = False  # Always create a group in the first block
        if not create_channel:
            # If we're not creating a separate channel, check if user wants a channel instead of group
            is_channel_for_group = config_data.get('group_is_channel', False)
        
        # Use Telethon directly for group/channel creation
        # Skip if portal-only mode (we'll handle portal setup separately)
        if not portal_only_mode:
            try:
                entity_type = 'channel' if is_channel_for_group else 'group'
                logger.info(f"🔵 STEP 1: Creating {entity_type} via Telethon (direct)")
                logger.info(f"   - is_channel parameter: {is_channel_for_group}")
                logger.info(f"   - create_channel flag: {create_channel}")
                logger.info(f"   - Will create {'CHANNEL' if is_channel_for_group else 'GROUP'}")
                # STEP 1: Create group WITHOUT photo first (we'll upload photo after)
                logger.info(f"\n{'='*60}")
                logger.info(f"STEP 1: CREATING GROUP")
                logger.info(f"{'='*60}")
                # Use async version directly with the persistent event loop to avoid event loop conflicts
                async def create_group_async():
                    await dev_client._ensure_connected()
                    return await dev_client.create_group_async(
                        title=group_title,
                        description=final_description if final_description else None,
                        photo_path=None,  # Upload photo after creation
                        is_channel=is_channel_for_group,  # False if creating group+channel, True if only channel
                        is_megagroup=config_data.get('group_is_megagroup', True)
                    )
                
                result = asyncio.run_coroutine_threadsafe(create_group_async(), loop).result(timeout=600)
                logger.info(f"   - Result: {result.get('success')}, chat_id: {result.get('chat_id')}")
                
                # Add delay to avoid rate limits
                logger.info(f"⏳ Waiting 2 seconds before next step...")
                time.sleep(2)
                
                if result.get('success'):
                    created_group_chat_id = result.get('chat_id')
                    group_username = result.get('username')  # Username if channel has one
                    
                    # STEP 2: Upload group photo
                    logger.info(f"\n{'='*60}")
                    logger.info(f"STEP 2: CHECKING GROUP PHOTO")
                    logger.info(f"{'='*60}")
                    logger.info(f"   - final_photo_path: {final_photo_path}")
                    logger.info(f"   - final_photo_path exists: {final_photo_path and os.path.exists(final_photo_path) if final_photo_path else False}")
                    if final_photo_path:
                        logger.info(f"   - Photo file size: {os.path.getsize(final_photo_path)} bytes" if os.path.exists(final_photo_path) else "   - Photo file does NOT exist")
                    
                    if final_photo_path and os.path.exists(final_photo_path):
                        logger.info(f"\n{'='*60}")
                        logger.info(f"STEP 2: UPLOADING GROUP PHOTO")
                        logger.info(f"{'='*60}")
                        try:
                            logger.info(f"Uploading group photo: {final_photo_path}")
                            async def upload_group_photo():
                                entity = await dev_client.client.get_entity(created_group_chat_id)
                                from telethon.tl.functions.channels import EditPhotoRequest
                                from telethon.tl.types import InputChatUploadedPhoto
                                from telethon.errors import FloodWaitError
                                
                                try:
                                    photo = await dev_client.client.upload_file(final_photo_path)
                                    await dev_client.client(EditPhotoRequest(
                                        channel=entity,
                                        photo=InputChatUploadedPhoto(file=photo)
                                    ))
                                    logger.info(f"✅ Group photo uploaded successfully")
                                    return {'success': True}
                                except FloodWaitError as e:
                                    wait_time = e.seconds
                                    logger.warning(f"⚠️ Rate limited: Need to wait {wait_time} seconds before uploading group photo")
                                    logger.info(f"⏳ Waiting {wait_time} seconds (Telegram rate limit)...")
                                    await asyncio.sleep(wait_time)
                                    # Retry after waiting
                                    logger.info(f"Retrying group photo upload...")
                                    photo = await dev_client.client.upload_file(final_photo_path)
                                    await dev_client.client(EditPhotoRequest(
                                        channel=entity,
                                        photo=InputChatUploadedPhoto(file=photo)
                                    ))
                                    logger.info(f"✅ Group photo uploaded successfully after wait")
                                    return {'success': True}
                            
                            photo_result = asyncio.run_coroutine_threadsafe(upload_group_photo(), loop).result(timeout=600)  # Increased timeout for flood wait
                            if photo_result.get('success'):
                                logger.info(f"✅ Group photo set successfully")
                            else:
                                logger.error(f"❌ Failed to set group photo: {photo_result.get('error')}")
                        except Exception as e:
                            logger.error(f"❌ Error setting group photo: {e}")
                            import traceback
                            logger.error(traceback.format_exc())
                    else:
                        logger.error(f"❌ CANNOT UPLOAD GROUP PHOTO: final_photo_path is {'None' if not final_photo_path else 'set but file does not exist'}")
                        logger.error(f"   - final_photo_path: {final_photo_path}")
                        logger.error(f"   - group_photo_base64 was provided: {bool(group_photo_base64)}")
                        logger.error(f"   - token_image_url was provided: {bool(token_image_url)}")
                        logger.error(f"   - group_photo_path was provided: {bool(group_photo_path)}")
                    
                    # Add delay to avoid rate limits
                    logger.info(f"⏳ Waiting 2 seconds before next step...")
                    time.sleep(2)
                
                # STEP 3: Skip anonymous for now - will enable AFTER users are invited (STEP 5)
                logger.info(f"\n{'='*60}")
                logger.info(f"STEP 3: SKIPPING 'REMAIN ANONYMOUS' - Will enable AFTER users are invited (STEP 5)")
                logger.info(f"{'='*60}")
                
                # Verify what type of entity was actually created
                try:
                    async def verify_entity_type():
                        entity = await dev_client.client.get_entity(created_group_chat_id)
                        is_channel_entity = hasattr(entity, 'broadcast') and entity.broadcast
                        entity_type = 'CHANNEL' if is_channel_entity else 'GROUP'
                        logger.info(f"✅ Verified entity type: {entity_type} (ID: {created_group_chat_id})")
                        return entity_type
                    entity_type = asyncio.run_coroutine_threadsafe(verify_entity_type(), loop).result(timeout=10)
                    if entity_type == 'CHANNEL' and not is_channel_for_group:
                        logger.error(f"❌ ERROR: Created a CHANNEL but we expected a GROUP!")
                    elif entity_type == 'GROUP' and is_channel_for_group:
                        logger.error(f"❌ ERROR: Created a GROUP but we expected a CHANNEL!")
                except Exception as e:
                    logger.warning(f"Could not verify entity type: {e}")
                
                logger.info(f"✅ Created {'channel' if is_channel_for_group else 'group'} via Telethon: (ID: {created_group_chat_id})")
                
                # NOTE: Group is private - we don't change its name/username
                # Only the CHANNEL gets updated with token branding (done in STEP 6 below)
                logger.info(f"✅ Created group: {group_title} (ID: {created_group_chat_id}) - Group is private, no name/username changes")
                
                # Try to get invite link or username for telegram link
                telegram_link = None
                try:
                    if group_username:
                        # Channel with username
                        telegram_link = f"https://t.me/{group_username.replace('@', '')}"
                    else:
                        # Group/channel without username - try to export invite link
                        async def get_invite_link():
                            entity = await dev_client.client.get_entity(created_group_chat_id)
                            try:
                                # Try channels module first
                                from telethon.tl.functions.channels import ExportInviteRequest
                                invite_link = await dev_client.client(ExportInviteRequest(entity))
                                return invite_link.link
                            except:
                                try:
                                    # Fallback to messages module
                                    from telethon.tl.functions.messages import ExportChatInviteLinkRequest
                                    invite_link = await dev_client.client(ExportChatInviteLinkRequest(entity))
                                    return invite_link.link
                                except Exception as e:
                                    logger.warning(f"Could not export invite link: {e}")
                                    return None
                        
                        invite_link = asyncio.run_coroutine_threadsafe(get_invite_link(), loop).result(timeout=10)
                        if invite_link:
                            telegram_link = invite_link
                except Exception as e:
                    logger.warning(f"Could not get Telegram link: {e}")
                
                if telegram_link:
                    logger.info(f"Telegram link: {telegram_link}")
                
                # Configure settings if provided
                if group_settings:
                    logger.info("Configuring group settings...")
                    settings_result = dev_client.configure_group_settings(created_group_chat_id, group_settings)
                    if settings_result.get('success'):
                        logger.info("✅ Group settings configured")
                    else:
                        logger.warning(f"Failed to configure settings: {settings_result.get('error')}")
                
                # Determine which users to invite
                # Check if we should invite user1/user2 (only after token launch)
                invite_user1_user2 = config_data.get('invite_user1_user2_after_launch', False)
                token_address = config_data.get('token_address', '')
                token_verified = config_data.get('token_verified', False)
                
                # If conditional joining is enabled, only invite user1/user2 if token is live
                should_invite_user1_user2 = True
                if invite_user1_user2:
                    should_invite_user1_user2 = bool(token_address and token_verified)
                    if not should_invite_user1_user2:
                        logger.info("Token not live yet - user1/user2 will join later (conditional joining enabled)")
                
                # Get users to invite from config, or default to all except dev
                users_to_invite_roles = config_data.get('invite_users', [])
                if not users_to_invite_roles:
                    # Default: invite all except dev
                    users_to_invite_roles = ['mod', 'user1', 'user2']
                
                # Filter user1/user2 if conditional joining
                if not should_invite_user1_user2:
                    users_to_invite_roles = [r for r in users_to_invite_roles if r not in ['user1', 'user2']]
                    logger.info(f"Conditional joining: Filtered out user1/user2. Inviting roles: {users_to_invite_roles}")
                
                # Get clients for users to invite
                other_clients = []
                for phone, user_config in config_data.get('users', {}).items():
                    user_role = user_config.get('role', '')
                    if user_role in users_to_invite_roles and user_config.get('enabled', False):
                        for client in clients:
                            if getattr(client, 'phone', None) == phone:
                                other_clients.append(client)
                                break
                
                if other_clients:
                    logger.info(f"Inviting {len(other_clients)} users to group...")
                    # Get user entities from clients
                    async def get_user_entities():
                        user_entities = []
                        for client in other_clients:
                            try:
                                # Get the user's own entity
                                me = await client.client.get_me()
                                user_entities.append(me)
                            except Exception as e:
                                logger.warning(f"Could not get entity for {getattr(client, 'phone', 'unknown')}: {e}")
                        return user_entities
                    
                    try:
                        user_entities = asyncio.run_coroutine_threadsafe(get_user_entities(), loop).result(timeout=30)
                        
                        if user_entities:
                            async def invite_users():
                                entity = await dev_client.client.get_entity(created_group_chat_id)
                                await dev_client.client(InviteToChannelRequest(
                                    channel=entity,
                                    users=user_entities
                                ))
                                return len(user_entities)
                            
                            invited_count = asyncio.run_coroutine_threadsafe(invite_users(), loop).result(timeout=30)
                            logger.info(f"✅ Invited {invited_count} users to group")
                            
                            # Wait for users to join AND load participants (CRITICAL for Telegram sync)
                            logger.info(f"⏳ Waiting 3 seconds for users to join...")
                            time.sleep(3)
                            
                            # STEP 3.5: Promote mod users to admin RIGHT AFTER they join
                            logger.info(f"\n{'='*60}")
                            logger.info(f"STEP 3.5: PROMOTING MOD USERS TO ADMIN (AFTER JOINING)")
                            logger.info(f"{'='*60}")
                            
                            async def promote_mods_after_join():
                                entity = await dev_client.client.get_entity(created_group_chat_id)
                                
                                # CRITICAL: Load participants first to ensure Telegram has synced user status
                                logger.info(f"  🔍 Loading participants to sync user status...")
                                try:
                                    await dev_client.client.get_participants(entity, limit=100)
                                    logger.info(f"  ✅ Participants loaded")
                                    await asyncio.sleep(2)  # Wait for Telegram to fully sync
                                except Exception as e:
                                    logger.warning(f"  ⚠️ Could not load participants: {e}")
                                    await asyncio.sleep(2)  # Still wait even if load fails
                                
                                # Verify creator is owner and has "Add Admins" permission
                                logger.info(f"  🔍 Verifying creator permissions...")
                                try:
                                    from telethon.tl.functions.channels import GetParticipantRequest
                                    creator_me = await dev_client.client.get_me()
                                    creator_participant = await dev_client.client(GetParticipantRequest(
                                        channel=entity,
                                        participant=creator_me
                                    ))
                                    
                                    from telethon.tl.types import ChannelParticipantCreator, ChannelParticipantAdmin
                                    is_owner = isinstance(creator_participant.participant, ChannelParticipantCreator)
                                    
                                    if is_owner:
                                        logger.info(f"  ✅ Creator is group owner (has full permissions)")
                                    elif isinstance(creator_participant.participant, ChannelParticipantAdmin):
                                        admin_rights_check = creator_participant.participant.admin_rights
                                        can_add_admins = getattr(admin_rights_check, 'add_admins', False)
                                        if can_add_admins:
                                            logger.info(f"  ✅ Creator has 'Add Admins' permission")
                                        else:
                                            logger.error(f"  ❌ Creator does NOT have 'Add Admins' permission!")
                                            logger.error(f"     Promotion will fail. Please enable 'Add Admins' in Telegram.")
                                            return {'promoted': 0, 'failed': 0, 'error': 'Creator lacks Add Admins permission'}
                                    else:
                                        logger.error(f"  ❌ Creator is not an admin!")
                                        return {'promoted': 0, 'failed': 0, 'error': 'Creator is not an admin'}
                                except Exception as e:
                                    logger.warning(f"  ⚠️ Could not verify creator permissions: {e}")
                                    logger.warning(f"     Continuing anyway, but promotion may fail...")
                                
                                # Get user roles and is_mod flags from config
                                user_roles = {}
                                user_is_mod = {}
                                for phone, user_config in config_data.get('users', {}).items():
                                    user_roles[phone] = user_config.get('role', '')
                                    user_is_mod[phone] = user_config.get('is_mod', False)
                                
                                promoted_count = 0
                                failed_count = 0
                                
                                # Create admin rights for mods - MUST specify ALL fields explicitly
                                # Based on tutorial: Telegram requires ALL admin rights to be specified
                                from telethon.tl.types import ChatAdminRights
                                admin_rights = ChatAdminRights(
                                    change_info=True,
                                    post_messages=True,
                                    edit_messages=True,
                                    delete_messages=True,
                                    ban_users=True,
                                    invite_users=True,
                                    pin_messages=True,
                                    add_admins=False,  # Mods can't add admins
                                    anonymous=False,  # Mods are not anonymous
                                    manage_call=True,
                                    other=True  # Full permissions for filter management
                                )
                                
                                logger.info(f"  📋 Admin rights being set:")
                                logger.info(f"     - change_info: {admin_rights.change_info}")
                                logger.info(f"     - post_messages: {admin_rights.post_messages}")
                                logger.info(f"     - edit_messages: {admin_rights.edit_messages}")
                                logger.info(f"     - delete_messages: {admin_rights.delete_messages}")
                                logger.info(f"     - ban_users: {admin_rights.ban_users}")
                                logger.info(f"     - invite_users: {admin_rights.invite_users}")
                                logger.info(f"     - pin_messages: {admin_rights.pin_messages}")
                                logger.info(f"     - add_admins: {admin_rights.add_admins}")
                                logger.info(f"     - anonymous: {admin_rights.anonymous}")
                                logger.info(f"     - manage_call: {admin_rights.manage_call}")
                                logger.info(f"     - other: {admin_rights.other}")
                                
                                # Promote each mod user
                                for client in other_clients:
                                    phone = getattr(client, 'phone', None)
                                    if not phone:
                                        continue
                                    
                                    # Skip creator (can't self-promote)
                                    CREATOR_PHONE = '+13124733150'
                                    if phone == CREATOR_PHONE:
                                        logger.info(f"  ⏭️ Skipping creator {phone} (cannot self-promote)")
                                        continue
                                    
                                    # Check if this user should be promoted
                                    is_mod_flag = user_is_mod.get(phone, False)
                                    user_role = user_roles.get(phone, '').lower() if user_roles.get(phone) else ''
                                    should_promote = is_mod_flag or user_role == 'mod' or user_role == 'dev'
                                    
                                    if not should_promote:
                                        logger.info(f"  ⏭️ Skipping {phone} (role: {user_roles.get(phone, 'unknown')}, is_mod: {is_mod_flag}) - not a mod/dev")
                                        continue
                                    
                                    try:
                                        mod_user_entity = await client.client.get_me()
                                        logger.info(f"  📤 Promoting {phone} (ID: {mod_user_entity.id}, Username: {getattr(mod_user_entity, 'username', 'N/A')}) to moderator...")
                                        
                                        # Verify user is actually in the group (with retry for database locks)
                                        for retry in range(3):
                                            try:
                                                from telethon.tl.functions.channels import GetParticipantRequest
                                                participant_check = await dev_client.client(GetParticipantRequest(
                                                    channel=entity,
                                                    participant=mod_user_entity
                                                ))
                                                logger.info(f"     ✅ User is confirmed member of group")
                                                break
                                            except Exception as check_error:
                                                error_str = str(check_error).lower()
                                                if 'database is locked' in error_str or 'locked' in error_str:
                                                    if retry < 2:
                                                        wait_time = (retry + 1) * 2
                                                        logger.warning(f"     ⚠️ Database locked (verify), waiting {wait_time}s and retrying...")
                                                        await asyncio.sleep(wait_time)
                                                        continue
                                                logger.warning(f"     ⚠️ Could not verify user is in group: {check_error}")
                                                logger.warning(f"     Continuing anyway...")
                                                break
                                        
                                        from telethon.errors import FloodWaitError
                                        
                                        # Promote with retry for both rate limits and database locks
                                        # Use EditAdminRequest directly (correct Telegram API)
                                        from telethon.tl.functions.channels import EditAdminRequest
                                        promotion_success = False
                                        for retry in range(3):
                                            try:
                                                result = await dev_client.client(EditAdminRequest(
                                                    channel=entity,
                                                    user_id=mod_user_entity,
                                                    admin_rights=admin_rights,
                                                    rank="Moderator"
                                                ))
                                                
                                                logger.info(f"     ✅ EditAdminRequest completed successfully")
                                                
                                                # Wait for Telegram to process
                                                await asyncio.sleep(3)  # Increased delay per tutorial
                                                promotion_success = True
                                                break
                                            except FloodWaitError as flood_error:
                                                wait_time = flood_error.seconds
                                                logger.warning(f"     ⚠️ RATE LIMITED: Telegram requires {wait_time} seconds wait")
                                                logger.warning(f"     ⏳ Waiting {wait_time} seconds before retrying...")
                                                await asyncio.sleep(wait_time)
                                                
                                                # Retry after waiting
                                                logger.info(f"     🔄 Retrying promotion after rate limit wait...")
                                                result = await dev_client.client(EditAdminRequest(
                                                    channel=entity,
                                                    user_id=mod_user_entity,
                                                    admin_rights=admin_rights,
                                                    rank="Moderator"
                                                ))
                                                logger.info(f"     ✅ edit_admin() completed successfully after retry")
                                                await asyncio.sleep(3)
                                                promotion_success = True
                                                break
                                            except Exception as promote_error:
                                                error_str = str(promote_error).lower()
                                                if 'database is locked' in error_str or 'locked' in error_str:
                                                    if retry < 2:
                                                        wait_time = (retry + 1) * 2  # 2s, 4s
                                                        logger.warning(f"     ⚠️ DATABASE LOCKED: Waiting {wait_time}s and retrying...")
                                                        await asyncio.sleep(wait_time)
                                                        continue
                                                    else:
                                                        logger.error(f"     ❌ Database locked after {retry + 1} retries - giving up")
                                                        raise promote_error
                                                else:
                                                    # Not a lock error - raise immediately
                                                    raise promote_error
                                        
                                        if not promotion_success:
                                            logger.error(f"  ❌ Failed to promote {phone} after retries")
                                            failed_count += 1
                                        else:
                                            logger.info(f"  ✅ Successfully promoted {phone} (ID: {mod_user_entity.id}) to moderator")
                                            promoted_count += 1
                                            await asyncio.sleep(2)  # Delay between promotions
                                    except Exception as e:
                                        error_str = str(e)
                                        error_type = type(e).__name__
                                        logger.error(f"  ❌ Failed to promote {phone}: {error_str}")
                                        logger.error(f"     Error type: {error_type}")
                                        import traceback
                                        logger.error(f"     Traceback:\n{traceback.format_exc()}")
                                        failed_count += 1
                                
                                return {'promoted': promoted_count, 'failed': failed_count}
                            
                            try:
                                promote_result = asyncio.run_coroutine_threadsafe(promote_mods_after_join(), loop).result(timeout=60)
                                logger.info(f"✅ Promoted {promote_result.get('promoted', 0)} mod(s) to admin")
                                if promote_result.get('failed', 0) > 0:
                                    logger.warning(f"⚠️ Failed to promote {promote_result.get('failed', 0)} mod(s)")
                            except Exception as e:
                                logger.warning(f"⚠️ Error promoting mods: {e}")
                                import traceback
                                logger.warning(traceback.format_exc())
                        else:
                            logger.warning("No user entities found to invite")
                    except Exception as e:
                        logger.warning(f"Failed to invite users: {e}")
                        import traceback
                        logger.warning(traceback.format_exc())
                
                # STEP 4: Enable "Remain Anonymous" for creator AFTER users are invited AND mods are promoted
                logger.info(f"\n{'='*60}")
                logger.info(f"STEP 4: ENABLING 'REMAIN ANONYMOUS' FOR CREATOR (AFTER USERS INVITED)")
                logger.info(f"{'='*60}")
                try:
                    async def enable_creator_anonymous():
                        entity = await dev_client.client.get_entity(created_group_chat_id)
                        # Get the creator (dev account) user entity
                        me = await dev_client.client.get_me()
                        from telethon.tl.functions.channels import EditAdminRequest
                        from telethon.tl.types import ChatAdminRights, InputUserSelf
                        
                        try:
                            # Get current admin info to preserve existing rights
                            from telethon.tl.functions.channels import GetFullChannelRequest
                            full_channel = await dev_client.client(GetFullChannelRequest(entity))
                            
                            # Get current admin rights if available
                            current_rights = None
                            if hasattr(full_channel, 'full_chat') and hasattr(full_channel.full_chat, 'admins'):
                                for admin in full_channel.full_chat.admins:
                                    if admin.user_id == me.id and hasattr(admin, 'admin_rights'):
                                        current_rights = admin.admin_rights
                                        break
                            
                            # Create admin rights with anonymous=True
                            # Preserve existing rights if available, otherwise use full admin rights
                            if current_rights:
                                anonymous_rights = ChatAdminRights(
                                    change_info=getattr(current_rights, 'change_info', True),
                                    post_messages=getattr(current_rights, 'post_messages', True),
                                    edit_messages=getattr(current_rights, 'edit_messages', True),
                                    delete_messages=getattr(current_rights, 'delete_messages', True),
                                    ban_users=getattr(current_rights, 'ban_users', True),
                                    invite_users=getattr(current_rights, 'invite_users', True),
                                    pin_messages=getattr(current_rights, 'pin_messages', True),
                                    add_admins=getattr(current_rights, 'add_admins', True),
                                    anonymous=True,  # Enable "Remain Anonymous" - THIS IS THE KEY
                                    manage_call=getattr(current_rights, 'manage_call', False),
                                    other=getattr(current_rights, 'other', False)
                                )
                            else:
                                # Use full admin rights with anonymous=True
                                anonymous_rights = ChatAdminRights(
                                    change_info=True,
                                    post_messages=True,
                                    edit_messages=True,
                                    delete_messages=True,
                                    ban_users=True,
                                    invite_users=True,
                                    pin_messages=True,
                                    add_admins=True,
                                    anonymous=True,  # Enable "Remain Anonymous"
                                    manage_call=False,
                                    other=False
                                )
                            
                            # Update admin rights with anonymous=True
                            # Use InputUserSelf() to reference the current user
                            await dev_client.client(EditAdminRequest(
                                channel=entity,
                                user_id=InputUserSelf(),  # Use InputUserSelf() instead of me
                                admin_rights=anonymous_rights,
                                rank="Admin"
                            ))
                            logger.info(f"✅ Creator 'Remain Anonymous' enabled (anonymous=True)")
                            return {'success': True}
                        except Exception as e:
                            error_str = str(e)
                            logger.error(f"❌ Could not enable 'Remain Anonymous' for creator: {error_str}")
                            import traceback
                            logger.error(traceback.format_exc())
                            return {'success': False, 'error': error_str}
                    
                    anonymous_result = asyncio.run_coroutine_threadsafe(enable_creator_anonymous(), loop).result(timeout=30)
                    if anonymous_result.get('success'):
                        logger.info(f"✅ Creator 'Remain Anonymous' enabled successfully")
                    else:
                        logger.warning(f"⚠️ Could not enable 'Remain Anonymous': {anonymous_result.get('error')}")
                except Exception as e:
                    logger.warning(f"⚠️ Error enabling 'Remain Anonymous': {e}")
                    import traceback
                    logger.warning(traceback.format_exc())
                
                # Add delay to avoid rate limits
                logger.info(f"⏳ Waiting 2 seconds after enabling anonymous...")
                time.sleep(2)
                
                # Store created group chat ID (already set above)
                # Update chat_ids to use the created group (if no channel will be created)
                # BUT ONLY if we're running conversations - otherwise skip this
                if not create_channel and len(scripted_conversations) > 0:
                    chat_ids = [str(created_group_chat_id)]
                    logger.info(f"Using created group for conversation: {created_group_chat_id}")
                
                # If we also need to create a channel, do it now
                logger.info(f"\n{'='*60}")
                logger.info(f"CHECKING IF CHANNEL SHOULD BE CREATED")
                logger.info(f"   - create_channel flag: {create_channel}")
                logger.info(f"   - create_group flag: {create_group}")
                logger.info(f"{'='*60}")
                
                if create_channel:
                    logger.info(f"\n{'='*60}")
                    logger.info(f"STEP 4: CREATING TELEGRAM CHANNEL")
                    logger.info(f"{'='*60}")
                    
                    try:
                        # Generate channel username variations if not provided
                        # Use contract_name if available, otherwise fallback to token_name
                        if not channel_username:
                            # Generate base username from contract name (preferred), then token name, then symbol
                            if contract_name:
                                base_name = contract_name.lower().replace(' ', '').replace('-', '').replace('_', '')
                            else:
                                base_name = token_name.lower().replace(' ', '').replace('-', '').replace('_', '')
                            
                            if not base_name or len(base_name) < 3:
                                base_name = token_symbol.replace('$', '').lower()
                            
                            # Username variations: name, name_tg, name_chat, name_group
                            username_variations = [
                                base_name,  # Just contract name
                                f"{base_name}_tg",  # name_tg
                                f"{base_name}_chat",  # name_chat
                                f"{base_name}_group",  # name_group
                            ]
                        else:
                            username_variations = [channel_username.replace('@', '')]
                        
                        # STEP 4: Create channel WITHOUT photo first (we'll upload photo after)
                        logger.info(f"Creating CHANNEL without photo (will upload after)")
                        logger.info(f"   - is_channel=True")
                        logger.info(f"   - is_megagroup=False (broadcast channel, not interactive)")
                        logger.info(f"   - title: {group_title}")
                        logger.info(f"   - Will try usernames: {username_variations[:3]}...")
                        
                        # Create channel WITHOUT photo (upload after)
                        # Use async version directly with the persistent event loop
                        async def create_channel_async():
                            await dev_client._ensure_connected()
                            return await dev_client.create_group_async(
                                title=group_title,
                                description=final_description if final_description else None,
                                photo_path=None,
                                is_channel=True,
                                is_megagroup=False  # Channel, not megagroup
                            )
                        
                        channel_result = asyncio.run_coroutine_threadsafe(create_channel_async(), loop).result(timeout=600)
                        
                        logger.info(f"Channel creation returned: success={channel_result.get('success')}, chat_id={channel_result.get('chat_id')}, error={channel_result.get('error')}")
                        
                        # Add delay to avoid rate limits
                        logger.info(f"⏳ Waiting 2 seconds before next step...")
                        time.sleep(2)
                        
                        if channel_result.get('success'):
                            created_channel_id = channel_result.get('chat_id')
                            
                            # STEP 5: Upload channel photo
                            logger.info(f"\n{'='*60}")
                            logger.info(f"STEP 5: CHECKING CHANNEL PHOTO")
                            logger.info(f"{'='*60}")
                            logger.info(f"   - final_photo_path: {final_photo_path}")
                            logger.info(f"   - final_photo_path exists: {final_photo_path and os.path.exists(final_photo_path) if final_photo_path else False}")
                            if final_photo_path:
                                logger.info(f"   - Photo file size: {os.path.getsize(final_photo_path)} bytes" if os.path.exists(final_photo_path) else "   - Photo file does NOT exist")
                            
                            if final_photo_path and os.path.exists(final_photo_path):
                                logger.info(f"\n{'='*60}")
                                logger.info(f"STEP 5: UPLOADING CHANNEL PHOTO")
                                logger.info(f"{'='*60}")
                                try:
                                    logger.info(f"Uploading channel photo: {final_photo_path}")
                                    logger.info(f"   - Photo file exists: {os.path.exists(final_photo_path)}")
                                    logger.info(f"   - Photo file size: {os.path.getsize(final_photo_path)} bytes")
                                    
                                    async def upload_channel_photo():
                                        entity = await dev_client.client.get_entity(created_channel_id)
                                        from telethon.tl.functions.channels import EditPhotoRequest
                                        from telethon.tl.types import InputChatUploadedPhoto
                                        from telethon.errors import FloodWaitError
                                        
                                        try:
                                            photo = await dev_client.client.upload_file(final_photo_path)
                                            await dev_client.client(EditPhotoRequest(
                                                channel=entity,
                                                photo=InputChatUploadedPhoto(file=photo)
                                            ))
                                            logger.info(f"✅ Channel photo uploaded successfully")
                                            return {'success': True}
                                        except FloodWaitError as e:
                                            wait_time = e.seconds
                                            logger.warning(f"⚠️ Rate limited: Need to wait {wait_time} seconds before uploading channel photo")
                                            logger.info(f"⏳ Waiting {wait_time} seconds (Telegram rate limit)...")
                                            await asyncio.sleep(wait_time)
                                            # Retry after waiting
                                            logger.info(f"Retrying channel photo upload...")
                                            photo = await dev_client.client.upload_file(final_photo_path)
                                            await dev_client.client(EditPhotoRequest(
                                                channel=entity,
                                                photo=InputChatUploadedPhoto(file=photo)
                                            ))
                                            logger.info(f"✅ Channel photo uploaded successfully after wait")
                                            return {'success': True}
                                    
                                    photo_result = asyncio.run_coroutine_threadsafe(upload_channel_photo(), loop).result(timeout=600)  # Increased timeout for flood wait
                                    
                                    if photo_result.get('success'):
                                        logger.info(f"✅ Channel photo set successfully")
                                    else:
                                        logger.error(f"❌ Failed to set channel photo: {photo_result.get('error')}")
                                except Exception as e:
                                    logger.error(f"❌ Error setting channel photo: {e}")
                                    import traceback
                                    logger.error(traceback.format_exc())
                            else:
                                logger.error(f"❌ CANNOT UPLOAD CHANNEL PHOTO: final_photo_path is {'None' if not final_photo_path else 'set but file does not exist'}")
                                logger.error(f"   - final_photo_path: {final_photo_path}")
                                logger.error(f"   - group_photo_base64 was provided: {bool(group_photo_base64)}")
                                logger.error(f"   - token_image_url was provided: {bool(token_image_url)}")
                                logger.error(f"   - group_photo_path was provided: {bool(group_photo_path)}")
                                
                                # Add delay to avoid rate limits
                                logger.info(f"⏳ Waiting 2 seconds before next step...")
                                time.sleep(2)
                            
                            # STEP 6: Update channel title and set username (make channel public)
                            logger.info(f"\n{'='*60}")
                            logger.info(f"STEP 6: UPDATING CHANNEL TITLE AND SETTING USERNAME (MAKING PUBLIC)")
                            logger.info(f"{'='*60}")
                            
                            # First, update channel title
                            try:
                                async def update_channel_title():
                                    entity = await dev_client.client.get_entity(created_channel_id)
                                    await dev_client.client.edit_title(entity, group_title)
                                    logger.info(f"✅ Channel title updated to: {group_title}")
                                    return {'success': True}
                                title_result = asyncio.run_coroutine_threadsafe(update_channel_title(), loop).result(timeout=30)
                                if title_result.get('success'):
                                    logger.info(f"✅ Channel title set successfully")
                            except Exception as e:
                                logger.warning(f"⚠️ Could not update channel title: {e}")
                            
                            # Add delay before username setting
                            logger.info(f"⏳ Waiting 2 seconds before setting username...")
                            time.sleep(2)
                            
                            logger.info(f"Will try {len(username_variations)} username variations:")
                            for idx, var in enumerate(username_variations, 1):
                                logger.info(f"  {idx}. @{var}")
                            
                            # According to Telethon docs: Channels are private by default, need to set username to make public
                            logger.info(f"\n{'='*60}")
                            logger.info(f"STARTING USERNAME SETTING PROCESS")
                            logger.info(f"   Channel ID: {created_channel_id}")
                            logger.info(f"   Account: {dev_phone}")
                            logger.info(f"   Variations to try: {len(username_variations)}")
                            logger.info(f"{'='*60}")
                            
                            final_channel_username = None
                            rate_limited = False
                            for attempt, username_variant in enumerate(username_variations):
                                # CRITICAL: Stop immediately if rate limited - don't try more variations
                                if rate_limited:
                                    logger.warning(f"⚠️ Rate limit detected - stopping username attempts to prevent further rate limiting")
                                    break
                                
                                # Add delay between attempts to avoid rate limits (except first attempt)
                                if attempt > 0:
                                    delay = 3  # 3 seconds between attempts
                                    logger.info(f"⏳ Waiting {delay} seconds before next username attempt (to avoid rate limits)...")
                                    time.sleep(delay)
                                
                                try:
                                    username_variant = username_variant.replace('@', '').lower().strip()
                                    
                                    # Telegram usernames must be 5-32 chars, alphanumeric + underscores only
                                    # Remove any invalid characters
                                    import re
                                    username_variant = re.sub(r'[^a-z0-9_]', '', username_variant)
                                    
                                    if len(username_variant) < 5:
                                        logger.warning(f"Username @{username_variant} too short (min 5 chars) after cleaning, skipping...")
                                        continue
                                    if len(username_variant) > 32:
                                        username_variant = username_variant[:32]
                                        logger.info(f"Truncated username to 32 chars: @{username_variant}")
                                    
                                    # Validate: must start with letter
                                    if not username_variant[0].isalpha():
                                        logger.warning(f"Username @{username_variant} must start with a letter, skipping...")
                                        continue
                                    
                                    logger.info(f"Making channel public and setting username (attempt {attempt + 1}/{len(username_variations)}): @{username_variant}")
                                    
                                    # Use UpdateChannelUsernameRequest directly to make channel public
                                    # First check if username is available, then set it
                                    async def set_channel_username():
                                        # IMPORTANT: Use created_channel_id (channel), NOT created_group_chat_id (group)
                                        entity = await dev_client.client.get_entity(created_channel_id)
                                        from telethon.tl.functions.channels import UpdateUsernameRequest
                                        from telethon.errors import UsernameOccupiedError, UsernameInvalidError, UsernameNotModifiedError, FloodWaitError
                                        
                                        try:
                                            # Use UpdateUsernameRequest to set username (makes channel public)
                                            # EditChannelRequest was removed from modern Telethon
                                            logger.info(f"Setting CHANNEL username to @{username_variant} (channel ID: {created_channel_id}, this will make channel public)...")
                                            
                                            try:
                                                # UpdateUsernameRequest makes channel public and sets username
                                                await dev_client.client(UpdateUsernameRequest(
                                                    channel=entity,
                                                    username=username_variant
                                                ))
                                                logger.info(f"✅ Channel made public with username: @{username_variant}")
                                                return {'success': True}
                                            except FloodWaitError as e:
                                                wait_time = e.seconds
                                                logger.error(f"❌ RATE LIMITED: Need to wait {wait_time} seconds ({wait_time/60:.1f} minutes) before setting username")
                                                logger.error(f"   This is a Telegram rate limit - username changes are limited to prevent abuse")
                                                logger.error(f"   STOPPING all further username attempts to prevent further rate limiting")
                                                logger.error(f"   Channel was created successfully, but username will need to be set manually later")
                                                logger.error(f"   Channel ID: {created_channel_id}")
                                                logger.error(f"   You can set the username manually via Telegram or wait {wait_time} seconds and try again")
                                                # CRITICAL: Return rate limit flag so we stop trying more variations
                                                return {'success': False, 'error': f'Rate limited: wait {wait_time} seconds', 'rate_limit': wait_time, 'stop_trying': True}
                                            except UsernameOccupiedError as e:
                                                logger.warning(f"Username @{username_variant} is occupied/taken: {e}")
                                                return {'success': False, 'error': f'Username @{username_variant} is occupied'}
                                            except UsernameInvalidError as e:
                                                logger.warning(f"Username @{username_variant} is invalid: {e}")
                                                return {'success': False, 'error': f'Username @{username_variant} is invalid: {e}'}
                                            except UsernameNotModifiedError:
                                                # Username is already set to this value (success!)
                                                logger.info(f"Username @{username_variant} is already set (channel is public)")
                                                return {'success': True}
                                            except Exception as e:
                                                error_str = str(e)
                                                error_type = type(e).__name__
                                                error_lower = error_str.lower()
                                                
                                                # Check for ChannelsAdminPublicTooMuchError
                                                from telethon.errors import ChannelsAdminPublicTooMuchError
                                                if isinstance(e, ChannelsAdminPublicTooMuchError) or 'ChannelsAdminPublicTooMuchError' in error_type or 'too many public channels' in error_lower:
                                                    logger.warning(f"⚠️ Channel limit reached: Account is admin of too many public channels")
                                                    logger.warning(f"   This is a Telegram limit - accounts can only be admin of a limited number of public channels")
                                                    logger.warning(f"   Channel was created successfully, but username cannot be set due to this limit")
                                                    logger.warning(f"   Channel ID: {created_channel_id}")
                                                    logger.warning(f"   Account: {dev_phone}")
                                                    logger.warning(f"   SOLUTION: Make some existing channels private, or use a different account")
                                                    logger.warning(f"   The channel is still usable - you can set the username manually later")
                                                    # This is a permanent limit, not a temporary rate limit
                                                    return {'success': False, 'error': 'Too many public channels (make some private)', 'channel_limit': True}
                                                
                                                # Check for common "not available" errors
                                                if any(keyword in error_lower for keyword in ['taken', 'occupied', 'unavailable', 'already', 'not available']):
                                                    logger.warning(f"Username @{username_variant} is not available: {error_str}")
                                                    return {'success': False, 'error': f'Username @{username_variant} is not available: {error_str}'}
                                                else:
                                                    # Other error (might be rate limit, permissions, etc.)
                                                    logger.error(f"Unexpected error setting username @{username_variant}: {error_str}")
                                                    import traceback
                                                    logger.error(traceback.format_exc())
                                                    return {'success': False, 'error': error_str}
                                        except Exception as e:
                                            error_str = str(e)
                                            logger.error(f"❌ Failed to set username @{username_variant}: {error_str}")
                                            import traceback
                                            logger.error(traceback.format_exc())
                                            return {'success': False, 'error': error_str}
                                    
                                    logger.info(f"Calling set_channel_username() for @{username_variant}...")
                                    username_result = asyncio.run_coroutine_threadsafe(set_channel_username(), loop).result(timeout=60)  # Increased timeout
                                    
                                    logger.info(f"Username result: {username_result}")
                                    
                                    if username_result.get('success'):
                                        logger.info(f"✅ Channel username set to: @{username_variant}")
                                        final_channel_username = username_variant
                                        channel_result['username'] = username_variant
                                        break  # Success, stop trying
                                    else:
                                        error_msg = username_result.get('error', 'Unknown error')
                                        rate_limit = username_result.get('rate_limit')
                                        stop_trying = username_result.get('stop_trying', False)
                                        
                                        logger.warning(f"❌ Username setting failed for @{username_variant}")
                                        logger.warning(f"   Error: {error_msg}")
                                        
                                        # CRITICAL: Stop immediately if rate limited
                                        if stop_trying or rate_limit:
                                            rate_limited = True
                                            logger.error(f"❌ RATE LIMITED - Stopping all username attempts immediately")
                                            logger.error(f"   Channel created successfully but username not set")
                                            logger.error(f"   Channel ID: {created_channel_id}")
                                            break  # Stop trying more variations
                                        
                                        # Check for channel limit (too many public channels)
                                        channel_limit = username_result.get('channel_limit')
                                        if channel_limit:
                                            logger.warning(f"⚠️ CHANNEL LIMIT: Account is admin of too many public channels")
                                            logger.warning(f"   Channel was created successfully, but username cannot be set")
                                            logger.warning(f"   Channel ID: {created_channel_id}")
                                            logger.warning(f"   Account: {dev_phone}")
                                            logger.warning(f"   SOLUTION: Make some existing channels private, or use a different account")
                                            logger.warning(f"   The channel is still usable - you can set the username manually later")
                                            break  # Stop trying - this is a permanent limit
                                        
                                        # Rate limit already handled above with break - continue to next variation if not rate limited
                                        
                                        logger.warning(f"Username @{username_variant} failed: {error_msg}")
                                        # Check if error indicates username is taken
                                        error_lower = error_msg.lower()
                                        if any(keyword in error_lower for keyword in ['taken', 'already', 'unavailable', 'occupied', 'not available']):
                                            logger.info(f"Username @{username_variant} is taken/unavailable, trying next variation...")
                                            continue  # Try next variation
                                        else:
                                            # Log the error but try next anyway (might be rate limit or other issue)
                                            logger.warning(f"Username error (not 'taken'): {error_msg} - will try next variation")
                                            continue
                                except Exception as e:
                                    error_str = str(e)
                                    logger.error(f"❌ Exception setting username @{username_variant}: {error_str}")
                                    import traceback
                                    logger.error(traceback.format_exc())
                                    # Continue to next variation unless this is the last one
                                    if attempt < len(username_variations) - 1:
                                        logger.info(f"Trying next username variation...")
                                        continue
                            
                            if not final_channel_username:
                                logger.warning(f"⚠️ Could not set username for channel (this is OK - channel was created successfully)")
                                logger.warning(f"   Channel ID: {created_channel_id}")
                                logger.warning(f"   Token: {token_name} ({token_symbol})")
                                logger.warning(f"   Tried variations: {', '.join([f'@{v}' for v in username_variations])}")
                                logger.warning(f"   Reason: Likely rate-limited by Telegram (username changes are limited)")
                                logger.warning(f"   You can set the username manually later via Telegram app")
                            else:
                                logger.info(f"✅ Successfully set channel username: @{final_channel_username}")
                                logger.info(f"   Channel is now public: https://t.me/{final_channel_username}")
                            
                            # Add delay after username setting
                            logger.info(f"⏳ Waiting 2 seconds before next step...")
                            time.sleep(2)
                        
                        logger.info(f"   - Channel creation result: {channel_result}")
                        
                        if channel_result.get('success'):
                            created_channel_chat_id = channel_result.get('chat_id')
                            channel_username_from_result = channel_result.get('username')
                            
                            # Verify what type of entity was actually created
                            try:
                                async def verify_channel_entity_type():
                                    entity = await dev_client.client.get_entity(created_channel_chat_id)
                                    is_channel_entity = hasattr(entity, 'broadcast') and entity.broadcast
                                    entity_type = 'CHANNEL' if is_channel_entity else 'GROUP'
                                    logger.info(f"✅ Verified channel entity type: {entity_type} (ID: {created_channel_chat_id})")
                                    if entity_type != 'CHANNEL':
                                        logger.error(f"❌ ERROR: Created a GROUP but we expected a CHANNEL!")
                                    return entity_type
                                entity_type = asyncio.run_coroutine_threadsafe(verify_channel_entity_type(), loop).result(timeout=10)
                            except Exception as e:
                                logger.warning(f"Could not verify channel entity type: {e}")
                            
                            logger.info(f"✅ Created channel via Telethon: (ID: {created_channel_chat_id})")
                            
                            # Photo and username are already set above, just log final status
                            logger.info(f"✅ Final channel: {group_title} (ID: {created_channel_chat_id})")
                            if channel_username_from_result:
                                logger.info(f"   - Channel username: @{channel_username_from_result}")
                            else:
                                logger.warning(f"   - Channel username: NOT SET")
                            
                            # Configure channel settings if provided (additional settings beyond branding)
                            if group_settings:
                                logger.info("Configuring additional channel settings...")
                                settings_result = dev_client.configure_group_settings(created_channel_chat_id, group_settings)
                                if settings_result.get('success'):
                                    logger.info("✅ Additional channel settings configured")
                            
                            # Update chat_ids to include channel
                            chat_ids = [str(created_group_chat_id), str(created_channel_chat_id)]
                            logger.info(f"Using created group and channel: {created_group_chat_id}, {created_channel_chat_id}")
                        else:
                            error_msg = channel_result.get('error', 'Unknown error')
                            logger.error(f"❌ Failed to create channel: {error_msg}")
                            logger.error(f"Channel creation result: {channel_result}")
                    except Exception as e:
                        logger.error(f"❌ Exception while creating channel: {e}")
                        import traceback
                        logger.error(traceback.format_exc())
                
                # Create portal if requested (using interactive flow)
                # Use created IDs if available, otherwise try existing IDs from config
                portal_group_id = created_group_chat_id or existing_group_chat_id
                portal_channel_id = created_channel_chat_id or existing_channel_chat_id
                
                # Track if portal was successfully created to prevent duplicate runs
                portal_created_successfully = False
                
                # Portal setup only requires group and channel IDs (token_address is optional)
                if create_portal and portal_group_id and portal_channel_id:
                    logger.info(f"\n{'='*60}")
                    logger.info(f"CREATING SAFEGUARD PORTAL (INTERACTIVE FLOW)")
                    logger.info(f"{'='*60}")
                    
                    try:
                        logger.info(f"Starting interactive portal setup flow...")
                        if token_address:
                            logger.info(f"  - Token address: {token_address}")
                        else:
                            logger.info(f"  - Token address: (not set - portal setup doesn't require it)")
                        logger.info(f"  - Group ID: {portal_group_id} {'(newly created)' if created_group_chat_id else '(existing)'}")
                        logger.info(f"  - Channel ID: {portal_channel_id} {'(newly created)' if created_channel_chat_id else '(existing)'}")
                        
                        # Find creator account for portal setup - use phone from config_data or fallback
                        CREATOR_PHONE = config_data.get('telegram_phone') or '+13124733150'
                        portal_dev_client = None
                        
                        # First try to find by specific phone number (from config_data)
                        for client in clients:
                            if getattr(client, 'phone', None) == CREATOR_PHONE:
                                # Use the client if found, even if not in users config (for group creator mode)
                                portal_dev_client = client
                                logger.info(f"Found creator account for portal by phone: {CREATOR_PHONE}")
                                break
                        
                        # Fallback: find dev account (role='dev') in users config
                        if not portal_dev_client:
                            for phone, user_config in config_data.get('users', {}).items():
                                if user_config.get('role') == 'dev' and user_config.get('enabled', False):
                                    for client in clients:
                                        if getattr(client, 'phone', None) == phone:
                                            portal_dev_client = client
                                            logger.info(f"Found creator account for portal by role='dev': {phone}")
                                            break
                                    if portal_dev_client:
                                        break
                        
                        # Final fallback: use first client if only one exists (group creator mode)
                        if not portal_dev_client and len(clients) == 1:
                            portal_dev_client = clients[0]
                            logger.info(f"Using single available client for portal: {getattr(portal_dev_client, 'phone', 'unknown')}")
                        
                        if not portal_dev_client:
                            logger.error("No creator account found for portal setup")
                            logger.warning("⚠️ Portal setup skipped - continuing without portal")
                        else:
                            portal_result = portal_dev_client.setup_safeguard_portal_interactive(
                                group_chat_id=str(portal_group_id),
                                channel_chat_id=str(portal_channel_id),
                                safeguard_bot_username=safeguard_bot_username
                            )
                            
                            if portal_result.get('success'):
                                logger.info(f"✅ Portal setup completed successfully")
                                logger.info(f"Safeguard bot response: {portal_result.get('response', 'No response')}")
                                portal_created_successfully = True
                            else:
                                error_msg = portal_result.get('error', 'Unknown error')
                                logger.warning(f"⚠️ Failed to create portal: {error_msg}")
                                logger.warning(f"   Group and channel were created successfully, but portal setup failed.")
                                logger.warning(f"   You can manually set up the portal later via @safeguard bot.")
                                logger.warning(f"   Group ID: {portal_group_id}, Channel ID: {portal_channel_id}")
                    except Exception as e:
                        logger.error(f"Error creating portal: {e}")
                        import traceback
                        logger.error(traceback.format_exc())
                        logger.warning("⚠️ Portal setup failed, but group/channel creation succeeded. Continuing...")
                elif create_portal:
                    logger.warning(f"⚠️ Cannot create portal: Missing group_chat_id or channel_chat_id")
                    logger.warning(f"   Created Group ID: {created_group_chat_id}")
                    logger.warning(f"   Created Channel ID: {created_channel_chat_id}")
                    logger.warning(f"   Existing Group ID: {existing_group_chat_id}")
                    logger.warning(f"   Existing Channel ID: {existing_channel_chat_id}")
                    logger.warning(f"   Token address: {token_address}")
                
                # Note: Group/channel creation already succeeded at this point
                # Filter script will be sent after portal setup (if any) or before final result
            except Exception as e:
                logger.error(f"Error creating group: {e}")
                import traceback
                logger.error(traceback.format_exc())
                return False
        
        # Handle portal setup (after group/channel creation OR with existing IDs)
        # Note: token_address is NOT required for portal setup (only needed for buy bot later)
        # Skip if portal was already created successfully above
        if create_portal and not portal_created_successfully:
            # Use created IDs if available, otherwise use existing IDs
            portal_group_id = created_group_chat_id or existing_group_chat_id
            portal_channel_id = created_channel_chat_id or existing_channel_chat_id
            
            if portal_group_id and portal_channel_id:
                logger.info(f"\n{'='*60}")
                logger.info(f"CREATING SAFEGUARD PORTAL")
                logger.info(f"{'='*60}")
                
                try:
                    logger.info(f"Starting interactive portal setup flow...")
                    if token_address:
                        logger.info(f"  - Token address: {token_address}")
                    else:
                        logger.info(f"  - Token address: (not set - portal setup doesn't require it)")
                    logger.info(f"  - Group ID: {portal_group_id}")
                    logger.info(f"  - Channel ID: {portal_channel_id}")
                    
                    # Find creator account for portal setup - use phone from config_data or fallback
                    CREATOR_PHONE = config_data.get('telegram_phone') or '+13124733150'
                    portal_dev_client = None
                    
                    # First try to find by specific phone number (from config_data)
                    for client in clients:
                        if getattr(client, 'phone', None) == CREATOR_PHONE:
                            # Use the client if found, even if not in users config (for group creator mode)
                            portal_dev_client = client
                            logger.info(f"Found creator account for portal by phone: {CREATOR_PHONE}")
                            break
                    
                    # Fallback: find dev account (role='dev') in users config
                    if not portal_dev_client:
                        for phone, user_config in config_data.get('users', {}).items():
                            if user_config.get('role') == 'dev' and user_config.get('enabled', False):
                                for client in clients:
                                    if getattr(client, 'phone', None) == phone:
                                        portal_dev_client = client
                                        logger.info(f"Found creator account for portal by role='dev': {phone}")
                                        break
                                if portal_dev_client:
                                    break
                    
                    # Final fallback: use first client if only one exists (group creator mode)
                    if not portal_dev_client and len(clients) == 1:
                        portal_dev_client = clients[0]
                        logger.info(f"Using single available client for portal: {getattr(portal_dev_client, 'phone', 'unknown')}")
                    
                    if not portal_dev_client:
                        logger.error("No creator account found for portal setup")
                        logger.error(f"Available clients: {[getattr(c, 'phone', 'unknown') for c in clients]}")
                        return False
                    
                    portal_result = portal_dev_client.setup_safeguard_portal_interactive(
                        group_chat_id=str(portal_group_id),
                        channel_chat_id=str(portal_channel_id),
                        safeguard_bot_username=safeguard_bot_username
                    )
                    
                    if portal_result.get('success'):
                        logger.info(f"✅ Portal setup completed successfully")
                        logger.info(f"Safeguard bot response: {portal_result.get('response', 'No response')}")
                    else:
                        error_msg = portal_result.get('error', 'Unknown error')
                        logger.warning(f"⚠️ Failed to create portal: {error_msg}")
                        logger.warning(f"   This usually means:")
                        logger.warning(f"   1. The account ({portal_dev_client.phone}) is not a member/admin of the group/channel")
                        logger.warning(f"   2. The group/channel is not visible in Safeguard bot's menu")
                        logger.warning(f"   SOLUTION: Create NEW groups/channels (they will automatically work)")
                except Exception as e:
                    logger.error(f"Error creating portal: {e}")
                    import traceback
                    logger.error(traceback.format_exc())
            else:
                logger.warning(f"⚠️ Cannot create portal: Missing existing group_chat_id or channel_chat_id")
                logger.warning(f"   Existing Group ID: {existing_group_chat_id}")
                logger.warning(f"   Existing Channel ID: {existing_channel_chat_id}")
                logger.warning(f"   Token address: {token_address}")
        
        # Setup Safeguard buy bot (if requested)
        setup_buy_bot = config_data.get('setup_buy_bot', False) or False
        buy_bot_token_address = config_data.get('buy_bot_token_address') or token_address
        buy_bot_chain = config_data.get('buy_bot_chain', 'base') or 'base'
        safeguard_bot_username = config_data.get('safeguard_bot_username', '@safeguard') or '@safeguard'
        
        if setup_buy_bot and buy_bot_token_address:
            # Use created group ID if available, otherwise use existing
            buy_bot_group_id = created_group_chat_id or existing_group_chat_id
            
            if buy_bot_group_id:
                logger.info(f"\n{'='*60}")
                logger.info(f"SETTING UP SAFEGUARD BUY BOT")
                logger.info(f"{'='*60}")
                logger.info(f"Group ID: {buy_bot_group_id}")
                logger.info(f"Token Address: {buy_bot_token_address}")
                logger.info(f"Chain: {buy_bot_chain}")
                logger.info(f"Safeguard Bot: {safeguard_bot_username}")
                
                try:
                    # Find the dev client (same as portal setup)
                    buy_bot_dev_client = None
                    
                    # First try to find by specific phone number (from config_data)
                    for client in clients:
                        if getattr(client, 'phone', None) == CREATOR_PHONE:
                            buy_bot_dev_client = client
                            logger.info(f"Found creator account for buy bot by phone: {CREATOR_PHONE}")
                            break
                    
                    # Fallback: find dev account (role='dev') in users config
                    if not buy_bot_dev_client:
                        for phone, user_config in config_data.get('users', {}).items():
                            if user_config.get('role') == 'dev' and user_config.get('enabled', False):
                                for client in clients:
                                    if getattr(client, 'phone', None) == phone:
                                        buy_bot_dev_client = client
                                        logger.info(f"Found creator account for buy bot by role='dev': {phone}")
                                        break
                                if buy_bot_dev_client:
                                    break
                    
                    # Final fallback: use first client if only one exists (group creator mode)
                    if not buy_bot_dev_client and len(clients) == 1:
                        buy_bot_dev_client = clients[0]
                        logger.info(f"Using single available client for buy bot: {getattr(buy_bot_dev_client, 'phone', 'unknown')}")
                    
                    if not buy_bot_dev_client:
                        logger.error("No creator account found for buy bot setup")
                        logger.error(f"Available clients: {[getattr(c, 'phone', 'unknown') for c in clients]}")
                    else:
                        # Call the buy bot setup function (same pattern as portal setup)
                        buy_bot_result = asyncio.run_coroutine_threadsafe(
                            buy_bot_dev_client.setup_safeguard_buy_bot_interactive_async(
                                group_chat_id=str(buy_bot_group_id),
                                token_address=buy_bot_token_address,
                                chain=buy_bot_chain,
                                safeguard_bot_username=safeguard_bot_username
                            ),
                            loop
                        ).result(timeout=120)  # 2 minute timeout for buy bot setup
                        
                        if buy_bot_result.get('success'):
                            logger.info(f"✅ Buy bot setup completed successfully")
                            logger.info(f"Safeguard bot response: {buy_bot_result.get('response', 'No response')}")
                        else:
                            error_msg = buy_bot_result.get('error', 'Unknown error')
                            logger.warning(f"⚠️ Failed to set up buy bot: {error_msg}")
                            logger.warning(f"   This usually means:")
                            logger.warning(f"   1. The account ({buy_bot_dev_client.phone}) is not a member/admin of the group")
                            logger.warning(f"   2. The Safeguard bot is not responding correctly")
                            logger.warning(f"   3. The token address or chain is incorrect")
                            
                except Exception as e:
                    logger.error(f"Error setting up buy bot: {e}")
                    import traceback
                    logger.error(traceback.format_exc())
            else:
                logger.warning(f"⚠️ Cannot set up buy bot: Missing existing group_chat_id")
                logger.warning(f"   Created Group ID: {created_group_chat_id}")
                logger.warning(f"   Existing Group ID: {existing_group_chat_id}")
                logger.warning(f"   Token address: {buy_bot_token_address}")
        
        logger.info(f"{'='*60}\n")
        
        # Output created chat IDs for group creator node (if no conversations)
        # IMPORTANT: If no conversations, return early - don't start conversations
        if len(scripted_conversations) == 0:
            # This is a group creator only run (no conversations)
            # Output the chat IDs and telegram link so frontend can use them
            import json
            
            # Get telegram link (prefer channel if both exist, otherwise use group)
            telegram_link = None
            if created_channel_chat_id:
                # Try to get channel username/link
                try:
                    async def get_channel_link():
                        entity = await dev_client.client.get_entity(created_channel_chat_id)
                        if hasattr(entity, 'username') and entity.username:
                            return f"https://t.me/{entity.username}"
                        # Try export invite link
                        try:
                            # Try channels module first
                            from telethon.tl.functions.channels import ExportInviteRequest
                            invite_link = await dev_client.client(ExportInviteRequest(entity))
                            return invite_link.link
                        except:
                            try:
                                # Fallback to messages module
                                from telethon.tl.functions.messages import ExportChatInviteLinkRequest
                                invite_link = await dev_client.client(ExportChatInviteLinkRequest(entity))
                                return invite_link.link
                            except:
                                return None
                    telegram_link = asyncio.run_coroutine_threadsafe(get_channel_link(), loop).result(timeout=10)
                except Exception as e:
                    logger.warning(f"Could not get channel link: {e}")
            
            if not telegram_link and created_group_chat_id:
                # Try to get group invite link
                try:
                    async def get_group_link():
                        entity = await dev_client.client.get_entity(created_group_chat_id)
                        try:
                            # Try channels module first
                            from telethon.tl.functions.channels import ExportInviteRequest
                            invite_link = await dev_client.client(ExportInviteRequest(entity))
                            return invite_link.link
                        except:
                            try:
                                # Fallback to messages module
                                from telethon.tl.functions.messages import ExportChatInviteLinkRequest
                                invite_link = await dev_client.client(ExportChatInviteLinkRequest(entity))
                                return invite_link.link
                            except:
                                return None
                    telegram_link = asyncio.run_coroutine_threadsafe(get_group_link(), loop).result(timeout=10)
                except Exception as e:
                    logger.warning(f"Could not get group link: {e}")
            
            # Send filter script commands after group/channel creation (if not already sent)
            if filter_script and (created_group_chat_id or created_channel_chat_id) and dev_client:
                logger.info(f"\n{'='*60}")
                logger.info(f"SENDING FILTER COMMANDS")
                logger.info(f"{'='*60}")
                
                try:
                    # Parse and replace placeholders in filter script
                    filter_commands = filter_script.strip().split('\n')
                    
                    # Replace placeholders with actual values
                    replacements = {
                        '{contract_address}': token_address or '',
                        '{CA}': token_address or '',
                        '{website}': config_data.get('website', '') or '',
                        '{twitter}': config_data.get('twitter', '') or '',
                        '{X}': config_data.get('twitter', '') or '',
                        '{token_name}': token_name or '',
                        '{token_symbol}': token_symbol or '',
                        '{telegram}': config_data.get('telegram', '') or '',
                        '{description}': config_data.get('description', '') or '',
                    }
                    
                    processed_commands = []
                    for cmd in filter_commands:
                        if cmd.strip():
                            processed_cmd = cmd
                            # Track if any placeholder was replaced with a non-empty value
                            has_required_value = False
                            
                            # Check if this command requires specific placeholders
                            # Extract placeholder names from the command
                            import re
                            placeholders_in_cmd = re.findall(r'\{([^}]+)\}', processed_cmd)
                            
                            # Replace placeholders
                            for placeholder, value in replacements.items():
                                placeholder_key = placeholder.replace('{', '').replace('}', '')
                                if placeholder in processed_cmd:
                                    if value and value.strip():
                                        processed_cmd = processed_cmd.replace(placeholder, value)
                                        has_required_value = True
                                    else:
                                        # Placeholder exists but value is empty - skip this command
                                        logger.info(f"⏭️ Skipping filter command (missing value for {placeholder}): {cmd.strip()}")
                                        processed_cmd = None
                                        break
                            
                            # Only add if command was processed and has required values
                            if processed_cmd and processed_cmd.strip():
                                # Double-check: if command still has unreplaced placeholders, skip it
                                if '{' in processed_cmd and '}' in processed_cmd:
                                    remaining_placeholders = re.findall(r'\{([^}]+)\}', processed_cmd)
                                    if remaining_placeholders:
                                        logger.info(f"⏭️ Skipping filter command (missing values for {remaining_placeholders}): {cmd.strip()}")
                                        continue
                                processed_commands.append(processed_cmd.strip())
                    
                    logger.info(f"Processed {len(processed_commands)} filter commands (skipped empty placeholders)")
                    
                    if not processed_commands:
                        logger.info("ℹ️ No filter commands to send (all were skipped due to missing values)")
                    else:
                        # Send commands ONLY to group (if created) - NOT to channel
                        if created_group_chat_id:
                            async def send_filter_commands():
                                await dev_client._ensure_connected()
                                for idx, cmd in enumerate(processed_commands, 1):
                                    if cmd:
                                        try:
                                            logger.info(f"📤 Sending filter command {idx}/{len(processed_commands)} to GROUP: {cmd[:50]}...")
                                            await dev_client.send_message_async(
                                                text=cmd,
                                                chat_id=str(created_group_chat_id)
                                            )
                                            logger.info(f"✅ Sent filter command {idx}/{len(processed_commands)} to GROUP: {cmd[:50]}...")
                                            # Wait 1 second between commands to ensure order and avoid rate limits
                                            if idx < len(processed_commands):
                                                await asyncio.sleep(1)
                                        except Exception as e:
                                            logger.warning(f"⚠️ Failed to send filter command {idx} '{cmd[:30]}...': {e}")
                            
                            try:
                                asyncio.run_coroutine_threadsafe(send_filter_commands(), loop).result(timeout=60)
                                logger.info(f"✅ All {len(processed_commands)} filter commands sent to GROUP successfully (in order)")
                            except Exception as e:
                                logger.warning(f"⚠️ Failed to send filter commands to group: {e}")
                        else:
                            logger.warning("⚠️ No group chat ID available - filter commands can only be sent to groups, not channels")
                    
                except Exception as e:
                    logger.error(f"❌ Error processing filter script: {e}")
                    import traceback
                    logger.error(traceback.format_exc())
                    logger.warning("⚠️ Filter commands failed, but group/channel creation succeeded")
            
            output_data = {
                'success': True,
                'group_chat_id': str(created_group_chat_id) if created_group_chat_id else None,
                'channel_chat_id': str(created_channel_chat_id) if created_channel_chat_id else None,
                'telegram_link': telegram_link,  # Set telegram link in RunConfig
                'portal_created': create_portal and (created_group_chat_id or created_channel_chat_id)
            }
            print(f"\n{'='*60}")
            print("GROUP_CREATOR_RESULT:")
            print(json.dumps(output_data))
            print(f"{'='*60}\n")
            return True
    
    # If we created/reused groups but have no conversations, don't start conversations
    # This check happens BEFORE creating TelegramCampaign to prevent conversations from starting
    if (create_group or reuse_existing) and (not scripted_conversations or len(scripted_conversations) == 0):
        logger.info("Group/channel created/reused successfully. No conversations to run.")
        return True
    
    # Auto-join participants to the GROUP (not channel) before starting conversations
    # This makes it look like they joined right after contract verification
    # Works for both created groups AND existing groups (from Telegram Chatter node)
    # CRITICAL: Only use GROUP chat ID, NOT channel chat ID
    # Priority: created_group_chat_id (from Telegram Group Creator) > first chat_id from chat_ids (existing group)
    # Filter out channel chat IDs - only use group chat IDs (group IDs are negative, channels can be positive or negative)
    
    logger.info(f"\n{'='*60}")
    logger.info(f"GROUP ID SELECTION FOR AUTO-JOIN")
    logger.info(f"{'='*60}")
    logger.info(f"created_group_chat_id: {created_group_chat_id}")
    logger.info(f"chat_ids from config: {chat_ids}")
    logger.info(f"chat_ids type: {type(chat_ids)}, length: {len(chat_ids) if chat_ids else 0}")
    
    # CRITICAL: For Telegram Chatter, chat_ids[0] should be the group ID from RunConfig
    # It should already be normalized with -100 prefix (e.g., -1003336913786)
    # Priority: created_group_chat_id (if group was just created) > chat_ids[0] (from Telegram Chatter)
    group_chat_id_for_autojoin = created_group_chat_id
    
    # If no created_group_chat_id, use first chat_id from chat_ids (this is from Telegram Chatter)
    if not group_chat_id_for_autojoin and chat_ids:
        # Telegram Chatter sends the normalized group ID as chat_ids[0]
        group_chat_id_for_autojoin = chat_ids[0]
        logger.info(f"  Using chat_ids[0] for auto-join: {group_chat_id_for_autojoin}")
    
    logger.info(f"Initial group_chat_id_for_autojoin: {group_chat_id_for_autojoin}")
    
    # Ensure we're using GROUP, not channel
    # Group chat IDs are typically negative (e.g., -1003314170950)
    # If we have both group and channel, prefer group
    if not group_chat_id_for_autojoin and chat_ids and len(chat_ids) > 0:
        logger.info(f"  No group_chat_id_for_autojoin yet, searching chat_ids for negative IDs...")
        # Find group chat ID (negative ID) if available
        for chat_id in chat_ids:
            try:
                chat_id_int = int(chat_id)
                logger.info(f"  Checking chat_id: {chat_id} (int: {chat_id_int})")
                # Group IDs are typically negative (supergroups start with -100)
                if chat_id_int < 0:
                    group_chat_id_for_autojoin = chat_id
                    logger.info(f"  ✅ Selected GROUP chat ID for auto-join: {group_chat_id_for_autojoin} (from chat_ids)")
                    break
            except (ValueError, TypeError) as e:
                logger.warning(f"  ⚠️ Could not parse chat_id {chat_id}: {e}")
    
    logger.info(f"Final group_chat_id_for_autojoin: {group_chat_id_for_autojoin}")
    logger.info(f"Has scripted_conversations: {bool(scripted_conversations)}, count: {len(scripted_conversations) if scripted_conversations else 0}")
    if scripted_conversations:
        logger.info(f"First conversation participants: {scripted_conversations[0].get('participants', []) if len(scripted_conversations) > 0 else 'N/A'}")
    logger.info(f"{'='*60}\n")
    
    # CRITICAL: Check for length > 0, not just truthiness (empty list [] is falsy but we still want to check)
    # Auto-join should run if we have a group ID AND conversations (even if conversations are loaded from file)
    has_conversations = scripted_conversations and len(scripted_conversations) > 0
    logger.info(f"🔍 Auto-join condition check:")
    logger.info(f"   group_chat_id_for_autojoin: {group_chat_id_for_autojoin}")
    logger.info(f"   has_conversations: {has_conversations}")
    logger.info(f"   Will run auto-join: {bool(group_chat_id_for_autojoin and has_conversations)}")
    
    if group_chat_id_for_autojoin and has_conversations:
        logger.info(f"\n{'='*60}")
        logger.info(f"AUTO-JOINING PARTICIPANTS TO GROUP")
        logger.info(f"{'='*60}")
        logger.info(f"Group ID: {group_chat_id_for_autojoin}")
        logger.info(f"Group source: {'Created by Telegram Group Creator' if created_group_chat_id else 'Existing group from Telegram Chatter'}")
        
        # Extract participant roles from scripted conversations
        # Only join users that are actually participants in the conversations (mod, user1, user2, etc.)
        participant_roles = set()
        for conv in scripted_conversations:
            participants = conv.get('participants', [])
            for participant in participants:
                if isinstance(participant, dict):
                    role = participant.get('role')
                    if role:
                        participant_roles.add(role)
                elif isinstance(participant, str):
                    participant_roles.add(participant)
        
        logger.info(f"Participant roles found in conversations: {sorted(participant_roles)}")
        
        # Find creator account phone to exclude from auto-join (they're already in the group)
        CREATOR_PHONE = '+13124733150'
        creator_phone = None
        for client in clients:
            if getattr(client, 'phone', None) == CREATOR_PHONE:
                creator_phone = CREATOR_PHONE
                break
        
        # Filter participants: Only join clients whose role matches conversation participants
        # AND exclude creator account (they're already in the group)
        # CRITICAL: Always include users with is_mod=True, even if their role isn't in conversations
        participants_to_join = []
        for client in clients:
            phone = getattr(client, 'phone', None)
            if phone == creator_phone:
                continue  # Skip creator
            
            # Get this client's role from user_roles dict
            client_role = user_roles.get(phone, '')
            is_mod_user = user_is_mod.get(phone, False)
            
            # Join if:
            # 1. Their role is in the conversation participants, OR
            # 2. They have is_mod=True (mods should always join, regardless of role)
            should_join = (client_role in participant_roles) or is_mod_user
            
            if should_join:
                participants_to_join.append(client)
                join_reason = "mod user" if is_mod_user else f"role: {client_role}"
                logger.info(f"  ✅ Will join: {phone} ({join_reason})")
            else:
                logger.info(f"  ⏭️ Skipping: {phone} (role: {client_role}, not in conversations and not mod)")
        
        logger.info(f"Participants to join: {len(participants_to_join)} accounts (roles: {sorted(participant_roles)}, excluding creator {creator_phone})")
        
        async def promote_mod_user_immediately(mod_client, mod_phone, group_entity, creator_client):
            """Promote a mod user to admin/moderator immediately after they join"""
            try:
                from telethon.tl.types import ChatAdminRights
                from telethon.errors import FloodWaitError
                
                # Create admin rights with ALL privileges EXCEPT anonymous
                # CRITICAL: Include all permissions needed for managing filters (/filters command)
                admin_rights = ChatAdminRights(
                    change_info=True,      # Can change group info
                    post_messages=True,     # Can post messages
                    edit_messages=True,     # Can edit messages
                    delete_messages=True,   # Can delete messages (needed for filters)
                    ban_users=True,         # Can ban users
                    invite_users=True,      # Can invite users
                    pin_messages=True,      # Can pin messages
                    add_admins=False,       # Mods can't add admins
                    anonymous=False,        # NOT anonymous (user will be visible as admin)
                    manage_call=True,       # Can manage calls
                    other=True,            # Other admin rights (includes filter management)
                )
                
                # Get mod user's entity
                mod_user_entity = await mod_client.client.get_me()
                
                # Promote to admin using EditAdminRequest (correct Telegram API)
                from telethon.tl.functions.channels import EditAdminRequest
                logger.info(f"  📤 Promoting {mod_phone} to admin/moderator immediately...")
                try:
                    await creator_client.client(EditAdminRequest(
                        channel=group_entity,
                        user_id=mod_user_entity,
                        admin_rights=admin_rights,
                        rank="Moderator"
                    ))
                    logger.info(f"  ✅ Successfully promoted {mod_phone} to admin/moderator")
                    return True
                except FloodWaitError as flood_error:
                    wait_time = flood_error.seconds
                    logger.warning(f"  ⚠️ RATE LIMITED: Waiting {wait_time} seconds...")
                    await asyncio.sleep(wait_time)
                    await creator_client.client(EditAdminRequest(
                        channel=group_entity,
                        user_id=mod_user_entity,
                        admin_rights=admin_rights,
                        rank="Moderator"
                    ))
                    logger.info(f"  ✅ Successfully promoted {mod_phone} after rate limit wait")
                    return True
            except Exception as e:
                error_str = str(e)
                logger.warning(f"  ⚠️ Failed to promote {mod_phone}: {error_str}")
                import traceback
                logger.warning(traceback.format_exc())
                return False
        
        async def join_participants_to_group():
            """Have all conversation participants join the created group"""
            joined_count = 0
            failed_count = 0
            already_member_count = 0
            
            logger.info(f"🔍 JOIN FUNCTION: Using group_chat_id_for_autojoin = {group_chat_id_for_autojoin}")
            logger.info(f"🔍 JOIN FUNCTION: Type = {type(group_chat_id_for_autojoin)}")
            logger.info(f"🔍 JOIN FUNCTION: Converting to int: {int(group_chat_id_for_autojoin)}")
            
            # CRITICAL: For private groups, we need to use InviteToChannelRequest from creator account
            # join_chat() doesn't work for private groups - users must be invited
            # Find creator account (the one that created the group)
            creator_client = None
            for client in clients:
                if getattr(client, 'phone', None) == creator_phone:
                    creator_client = client
                    break
            
            if not creator_client:
                logger.warning(f"⚠️ Creator account ({creator_phone}) not found in clients - cannot invite users to private group")
                logger.warning("   Users will need to join manually or use invite link")
                return {'joined': 0, 'already_member': 0, 'failed': len(participants_to_join)}
            
            # Get group entity using creator account (has admin rights)
            try:
                group_id_int = int(group_chat_id_for_autojoin)
                logger.info(f"🔍 Attempting to get entity for group ID: {group_id_int}")
                group_entity = await creator_client.client.get_entity(group_id_int)
                logger.info(f"✅ Successfully got group entity: {group_entity}")
                logger.info(f"   Entity ID: {group_entity.id}")
                logger.info(f"   Entity title: {getattr(group_entity, 'title', 'N/A')}")
            except Exception as e:
                logger.error(f"❌ Failed to get group entity for ID {group_chat_id_for_autojoin}: {e}")
                logger.error(f"   Error type: {type(e).__name__}")
                import traceback
                logger.error(traceback.format_exc())
                return {'joined': 0, 'already_member': 0, 'failed': len(participants_to_join)}
            
            # Check if group is private (no username)
            is_private = not hasattr(group_entity, 'username') or not group_entity.username
            
            # CRITICAL: For private groups, use invite links (most reliable method)
            # Direct adds via InviteToChannelRequest don't sync Telethon's entity cache
            # Using invite links ensures users join AND Telethon syncs dialogs properly
            if is_private:
                logger.info(f"🔒 Group is PRIVATE - using invite link method (most reliable for Telethon)")
                from telethon.tl.functions.messages import ExportChatInviteRequest
                try:
                    # Step 1: Export invite link from creator account
                    logger.info(f"  📤 Exporting invite link from creator account...")
                    try:
                        invite_result = await creator_client.client(ExportChatInviteRequest(
                            peer=int(group_chat_id_for_autojoin)
                        ))
                        invite_link = invite_result.link
                        logger.info(f"  ✅ Invite link generated: {invite_link}")
                    except Exception as e:
                        error_str = str(e)
                        logger.error(f"  ❌ Failed to export invite link: {error_str}")
                        logger.error(f"   Error type: {type(e).__name__}")
                        import traceback
                        logger.error(traceback.format_exc())
                        return {'joined': 0, 'already_member': 0, 'failed': len(participants_to_join)}
                    
                    # Step 2: Have each user join via invite link
                    # Extract hash from invite link (format: https://t.me/+HASH)
                    import re
                    invite_hash = None
                    if invite_link.startswith('https://t.me/+'):
                        invite_hash = invite_link.replace('https://t.me/+', '')
                    elif '/+' in invite_link:
                        invite_hash = invite_link.split('/+')[-1]
                    
                    if not invite_hash:
                        logger.error(f"  ❌ Could not extract hash from invite link: {invite_link}")
                        return {'joined': 0, 'already_member': 0, 'failed': len(participants_to_join)}
                    
                    logger.info(f"  📋 Extracted invite hash: {invite_hash}")
                    
                    added_count = 0
                    for client in participants_to_join:
                        phone = getattr(client, 'phone', 'unknown')
                        try:
                            logger.info(f"  📤 Having {phone} join via invite link...")
                            # Use ImportChatInviteRequest for invite links with hash
                            from telethon.tl.functions.messages import ImportChatInviteRequest
                            await client.client(ImportChatInviteRequest(hash=invite_hash))
                            logger.info(f"  ✅ {phone} joined via invite link")
                            
                            # CRITICAL: Force Telethon to sync dialogs so entity is cached
                            logger.info(f"  🔄 Syncing dialogs for {phone}...")
                            await client.client.get_dialogs()
                            await asyncio.sleep(0.5)  # Small delay for sync
                            
                            # Verify user can access the group entity
                            try:
                                entity = await client.client.get_entity(int(group_chat_id_for_autojoin))
                                logger.info(f"  ✅ Verified {phone} can access group (entity cached)")
                                added_count += 1
                                joined_count += 1
                                
                                # CRITICAL: If this user has role='mod' OR role='dev' OR is_mod=True, promote them immediately
                                client_role = user_roles.get(phone, '').lower() if user_roles.get(phone) else ''
                                is_mod_user = user_is_mod.get(phone, False)
                                should_promote = is_mod_user or client_role == 'mod' or client_role == 'dev'
                                if should_promote:
                                    logger.info(f"  🔑 User {phone} is a mod/dev (role: {user_roles.get(phone, 'unknown')}, is_mod: {is_mod_user}) - promoting to moderator immediately...")
                                    try:
                                        # Get group entity using creator account
                                        group_entity = await creator_client.client.get_entity(int(group_chat_id_for_autojoin))
                                        # Promote mod user immediately
                                        await promote_mod_user_immediately(client, phone, group_entity, creator_client)
                                    except Exception as promote_error:
                                        logger.warning(f"  ⚠️ Could not promote {phone} immediately: {promote_error}")
                                        logger.warning(f"     Will retry promotion later")
                                
                            except Exception as verify_error:
                                error_str = str(verify_error)
                                logger.warning(f"  ⚠️ {phone} joined but entity not cached yet: {error_str}")
                                logger.warning(f"     Retrying dialog sync...")
                                # Retry dialog sync
                                await client.client.get_dialogs()
                                await asyncio.sleep(1)
                                try:
                                    entity = await client.client.get_entity(int(group_chat_id_for_autojoin))
                                    logger.info(f"  ✅ Verified {phone} can access group (after retry)")
                                    added_count += 1
                                    joined_count += 1
                                    
                                    # CRITICAL: If this user has role='mod' OR role='dev' OR is_mod=True, promote them immediately
                                    client_role = user_roles.get(phone, '').lower() if user_roles.get(phone) else ''
                                    is_mod_user = user_is_mod.get(phone, False)
                                    should_promote = is_mod_user or client_role == 'mod' or client_role == 'dev'
                                    if should_promote:
                                        logger.info(f"  🔑 User {phone} is a mod/dev (role: {user_roles.get(phone, 'unknown')}, is_mod: {is_mod_user}) - promoting to moderator immediately...")
                                        try:
                                            group_entity = await creator_client.client.get_entity(int(group_chat_id_for_autojoin))
                                            await promote_mod_user_immediately(client, phone, group_entity, creator_client)
                                        except Exception as promote_error:
                                            logger.warning(f"  ⚠️ Could not promote {phone} immediately: {promote_error}")
                                            
                                except:
                                    logger.warning(f"  ⚠️ {phone} still cannot access group entity - may need manual check")
                                    failed_count += 1
                            
                            # Small delay between joins to avoid rate limits
                            await asyncio.sleep(1)
                            
                        except Exception as e:
                            error_str = str(e)
                            # Check if already a member
                            if any(keyword in error_str.lower() for keyword in ['already', 'member', 'participant', 'already a participant', 'already joined', 'already in']):
                                logger.info(f"  ✅ {phone} is already a member of the group")
                                # Still sync dialogs for already-member users
                                try:
                                    await client.client.get_dialogs()
                                    await client.client.get_entity(int(group_chat_id_for_autojoin))
                                    logger.info(f"  ✅ Verified {phone} can access group")
                                except:
                                    pass
                                already_member_count += 1
                                joined_count += 1
                            else:
                                logger.error(f"  ❌ FAILED TO JOIN {phone} to group: {error_str}")
                                logger.error(f"     Error type: {type(e).__name__}")
                                import traceback
                                logger.error(f"     Traceback:\n{traceback.format_exc()}")
                                failed_count += 1
                    
                    logger.info(f"  📊 Join complete: {added_count} added, {already_member_count} already members, {failed_count} failed")
                    
                    # Step 3: Whitelist/unmute accounts in safeguard bot (if safeguard is enabled)
                    if safeguard_bot_username and added_count > 0:
                        logger.info(f"\n{'='*60}")
                        logger.info(f"WHITELISTING ACCOUNTS IN SAFEGUARD BOT")
                        logger.info(f"{'='*60}")
                        
                        # Find creator account to send safeguard commands
                        safeguard_creator_client = None
                        for client in clients:
                            if getattr(client, 'phone', None) == creator_phone:
                                safeguard_creator_client = client
                                break
                        
                        if safeguard_creator_client:
                            # Get user entities for whitelisting
                            whitelisted_count = 0
                            for client in participants_to_join:
                                phone = getattr(client, 'phone', 'unknown')
                                try:
                                    # Get user entity
                                    me = await client.client.get_me()
                                    user_id = me.id
                                    username = getattr(me, 'username', None)
                                    
                                    # Send whitelist command to safeguard bot
                                    # Try multiple command formats (safeguard bot may use different syntax)
                                    whitelist_commands = []
                                    if username:
                                        whitelist_commands.append(f"/whitelist @{username}")
                                        whitelist_commands.append(f"/allowlist @{username}")
                                    whitelist_commands.append(f"/whitelist {user_id}")
                                    whitelist_commands.append(f"/allowlist {user_id}")
                                    
                                    # Also try with group ID context
                                    if group_chat_id_for_autojoin:
                                        if username:
                                            whitelist_commands.append(f"/whitelist {group_chat_id_for_autojoin} @{username}")
                                            whitelist_commands.append(f"/allowlist {group_chat_id_for_autojoin} @{username}")
                                        whitelist_commands.append(f"/whitelist {group_chat_id_for_autojoin} {user_id}")
                                        whitelist_commands.append(f"/allowlist {group_chat_id_for_autojoin} {user_id}")
                                    
                                    logger.info(f"  📤 Whitelisting {phone} (ID: {user_id}) in safeguard bot...")
                                    
                                    whitelisted = False
                                    for whitelist_command in whitelist_commands:
                                        try:
                                            result = await safeguard_creator_client.message_safeguard_bot_async(
                                                command=whitelist_command,
                                                safeguard_bot_username=safeguard_bot_username
                                            )
                                            
                                            if result.get('success'):
                                                logger.info(f"  ✅ Successfully whitelisted {phone} using: {whitelist_command}")
                                                whitelisted = True
                                                whitelisted_count += 1
                                                break
                                        except:
                                            continue  # Try next command format
                                    
                                    if not whitelisted:
                                        logger.warning(f"  ⚠️ Failed to whitelist {phone} - tried {len(whitelist_commands)} command formats")
                                    
                                    # Also try /unmute command as fallback
                                    unmute_commands = []
                                    if username:
                                        unmute_commands.append(f"/unmute @{username}")
                                    unmute_commands.append(f"/unmute {user_id}")
                                    if group_chat_id_for_autojoin:
                                        if username:
                                            unmute_commands.append(f"/unmute {group_chat_id_for_autojoin} @{username}")
                                        unmute_commands.append(f"/unmute {group_chat_id_for_autojoin} {user_id}")
                                    
                                    for unmute_command in unmute_commands[:2]:  # Try first 2 formats
                                        try:
                                            await safeguard_creator_client.message_safeguard_bot_async(
                                                command=unmute_command,
                                                safeguard_bot_username=safeguard_bot_username
                                            )
                                            break  # Stop if one works
                                        except:
                                            continue  # Try next format
                                    
                                    await asyncio.sleep(0.5)  # Small delay between commands
                                    
                                except Exception as e:
                                    logger.warning(f"  ⚠️ Could not whitelist {phone}: {e}")
                            
                            logger.info(f"  📊 Whitelist complete: {whitelisted_count}/{len(participants_to_join)} accounts whitelisted")
                        else:
                            logger.warning(f"  ⚠️ Creator account not found - cannot whitelist accounts in safeguard bot")
                    
                except Exception as e:
                    error_str = str(e)
                    logger.error(f"  ❌ Failed to add users via invite link: {error_str}")
                    logger.error(f"   Error type: {type(e).__name__}")
                    import traceback
                    logger.error(traceback.format_exc())
                    failed_count = len(participants_to_join)
            else:
                logger.info(f"🌐 Group is PUBLIC (has username) - using join_chat() with dialog sync")
                # For public groups: Use join_chat (works for public groups)
                for client in participants_to_join:
                    phone = getattr(client, 'phone', 'unknown')
                    try:
                        # Get the group entity
                        entity = await client.client.get_entity(int(group_chat_id_for_autojoin))

                        # Check if already a member by trying to get full channel info
                        try:
                            from telethon.tl.functions.channels import GetFullChannelRequest
                            if hasattr(entity, 'broadcast') or hasattr(entity, 'megagroup'):
                                # Try to get full channel info - if successful, we're already a member
                                await client.client(GetFullChannelRequest(entity))
                                logger.info(f"  ✅ {phone} is already a member of group {group_chat_id_for_autojoin}")
                                # Sync dialogs to ensure entity is cached
                                await client.client.get_dialogs()
                                already_member_count += 1
                                joined_count += 1
                                continue
                        except Exception:
                            # Not a member or not a channel - try to join
                            pass

                        # Join the group/channel using join_chat (works for public groups)
                        logger.info(f"  Joining {phone} to public group {group_chat_id_for_autojoin}...")
                        await client.client.join_chat(entity)
                        logger.info(f"  ✅ {phone} successfully joined group")
                        
                        # CRITICAL: Force Telethon to sync dialogs so entity is cached
                        await client.client.get_dialogs()
                        await asyncio.sleep(0.5)
                        
                        # CRITICAL: If this user has role='mod' OR role='dev' OR is_mod=True, promote them immediately
                        client_role = user_roles.get(phone, '').lower() if user_roles.get(phone) else ''
                        is_mod_user = user_is_mod.get(phone, False)
                        should_promote = is_mod_user or client_role == 'mod' or client_role == 'dev'
                        if should_promote:
                            logger.info(f"  🔑 User {phone} is a mod/dev (role: {user_roles.get(phone, 'unknown')}, is_mod: {is_mod_user}) - promoting to moderator immediately...")
                            try:
                                # Get group entity using creator account
                                group_entity = await creator_client.client.get_entity(int(group_chat_id_for_autojoin))
                                # Promote mod user immediately
                                await promote_mod_user_immediately(client, phone, group_entity, creator_client)
                            except Exception as promote_error:
                                logger.warning(f"  ⚠️ Could not promote {phone} immediately: {promote_error}")
                                logger.warning(f"     Will retry promotion later")
                        
                        joined_count += 1

                        # Small delay to avoid rate limits
                        await asyncio.sleep(1)

                    except Exception as e:
                        error_str = str(e)
                        # Check if already a member (common error)
                        if any(keyword in error_str.lower() for keyword in ['already', 'member', 'participant', 'joined', 'already a participant']):
                            logger.info(f"  ✅ {phone} is already a member of group {group_chat_id_for_autojoin}")
                            # Sync dialogs for already-member users
                            try:
                                await client.client.get_dialogs()
                            except:
                                pass
                            already_member_count += 1
                            joined_count += 1
                        else:
                            logger.error(f"  ❌ FAILED TO JOIN {phone} to group: {error_str}")
                            logger.error(f"     Error type: {type(e).__name__}")
                            import traceback
                            logger.error(f"     Traceback:\n{traceback.format_exc()}")
                            failed_count += 1
            
            logger.info(f"\n✅ Auto-join complete: {joined_count} total ({already_member_count} already members, {joined_count - already_member_count} newly joined/invited), {failed_count} failed")
            return {'joined': joined_count, 'already_member': already_member_count, 'failed': failed_count}
        
        try:
            join_result = asyncio.run_coroutine_threadsafe(join_participants_to_group(), loop).result(timeout=60)
            logger.info(f"Auto-join result: {join_result}")
        except Exception as e:
            logger.warning(f"⚠️ Error during auto-join: {e}")
            logger.warning("Continuing with conversation anyway - participants may need to join manually")
            import traceback
            logger.warning(traceback.format_exc())
        
        # STEP 1: Make creator anonymous FIRST (after all users have joined)
        # This MUST happen before promoting mods
        if group_chat_id_for_autojoin:
            logger.info(f"\n{'='*60}")
            logger.info(f"STEP 1: MAKING CREATOR ANONYMOUS (AFTER ALL USERS JOINED)")
            logger.info(f"{'='*60}")
            logger.info(f"Group ID: {group_chat_id_for_autojoin}")
            
            async def make_creator_anonymous():
                """Make creator anonymous after all users have joined"""
                CREATOR_PHONE = '+13124733150'
                creator_client = None
                for client in clients:
                    if getattr(client, 'phone', None) == CREATOR_PHONE:
                        creator_client = client
                        break
                
                if not creator_client:
                    logger.warning(f"⚠️ Creator account ({CREATOR_PHONE}) not found - cannot make anonymous")
                    return {'success': False, 'error': 'Creator account not found'}
                
                try:
                    from telethon.tl.functions.channels import EditAdminRequest, GetFullChannelRequest
                    from telethon.tl.types import ChatAdminRights, InputUserSelf
                    
                    group_entity = await creator_client.client.get_entity(int(group_chat_id_for_autojoin))
                    me = await creator_client.client.get_me()
                    full_channel = await creator_client.client(GetFullChannelRequest(group_entity))
                    
                    current_rights = None
                    if hasattr(full_channel, 'full_chat') and hasattr(full_channel.full_chat, 'admins'):
                        for admin in full_channel.full_chat.admins:
                            if admin.user_id == me.id and hasattr(admin, 'admin_rights'):
                                current_rights = admin.admin_rights
                                break
                    
                    if current_rights:
                        anonymous_rights = ChatAdminRights(
                            change_info=getattr(current_rights, 'change_info', True),
                            post_messages=getattr(current_rights, 'post_messages', True),
                            edit_messages=getattr(current_rights, 'edit_messages', True),
                            delete_messages=getattr(current_rights, 'delete_messages', True),
                            ban_users=getattr(current_rights, 'ban_users', True),
                            invite_users=getattr(current_rights, 'invite_users', True),
                            pin_messages=getattr(current_rights, 'pin_messages', True),
                            add_admins=getattr(current_rights, 'add_admins', True),
                            anonymous=True,  # CRITICAL: Enable "Remain Anonymous"
                            manage_call=getattr(current_rights, 'manage_call', False),
                            other=getattr(current_rights, 'other', False)
                        )
                    else:
                        anonymous_rights = ChatAdminRights(
                            change_info=True, post_messages=True, edit_messages=True,
                            delete_messages=True, ban_users=True, invite_users=True,
                            pin_messages=True, add_admins=True, anonymous=True,
                            manage_call=False, other=False
                        )
                    
                    await creator_client.client(EditAdminRequest(
                        channel=group_entity,
                        user_id=InputUserSelf(),
                        admin_rights=anonymous_rights,
                        rank="Admin"
                    ))
                    logger.info(f"✅ Creator 'Remain Anonymous' enabled (anonymous=True)")
                    return {'success': True}
                except Exception as e:
                    error_str = str(e)
                    logger.error(f"❌ Could not enable 'Remain Anonymous' for creator: {error_str}")
                    import traceback
                    logger.error(traceback.format_exc())
                    return {'success': False, 'error': error_str}
            
            try:
                anonymous_result = asyncio.run_coroutine_threadsafe(make_creator_anonymous(), loop).result(timeout=30)
                if anonymous_result.get('success'):
                    logger.info(f"✅ Creator anonymous enabled successfully")
                else:
                    error_msg = anonymous_result.get('error', 'Unknown error')
                    logger.error(f"❌ FAILED TO MAKE CREATOR ANONYMOUS: {error_msg}")
                    logger.error(f"   This is CRITICAL - creator will be visible!")
            except Exception as e:
                logger.error(f"❌ EXCEPTION while enabling creator anonymous: {e}")
                import traceback
                logger.error(f"   Full traceback:\n{traceback.format_exc()}")
            
            # Small delay before promoting mods
            logger.info(f"⏳ Waiting 2 seconds before promoting mods...")
            time.sleep(2)
        
        # STEP 2: Auto-promote mod users to admin/moderator with all privileges (but not anonymous)
        # This happens AFTER creator is made anonymous
        has_mods_or_devs = any(user_is_mod.get(phone, False) or (user_roles.get(phone, '').lower() in ['mod', 'dev']) for phone in user_roles.keys())
        if group_chat_id_for_autojoin and has_mods_or_devs:
            logger.info(f"\n{'='*60}")
            logger.info(f"AUTO-PROMOTING MOD USERS TO ADMIN/MODERATOR")
            logger.info(f"{'='*60}")
            logger.info(f"Group ID: {group_chat_id_for_autojoin}")
            
            async def promote_mod_users():
                """Promote users tagged as 'mod' to admin/moderator with all privileges"""
                promoted_count = 0
                failed_count = 0
                
                # Find creator account (has admin rights to promote others)
                CREATOR_PHONE = '+13124733150'
                creator_client = None
                for client in clients:
                    if getattr(client, 'phone', None) == CREATOR_PHONE:
                        creator_client = client
                        break
                
                if not creator_client:
                    logger.warning(f"⚠️ Creator account ({CREATOR_PHONE}) not found - cannot promote mod users")
                    return {'promoted': 0, 'failed': len([p for p, is_mod in user_is_mod.items() if is_mod])}
                
                # Get group entity
                try:
                    group_entity = await creator_client.client.get_entity(int(group_chat_id_for_autojoin))
                except Exception as e:
                    logger.error(f"❌ Failed to get group entity: {e}")
                    return {'promoted': 0, 'failed': len([p for p, is_mod in user_is_mod.items() if is_mod])}
                
                # Find all mod users and promote them
                from telethon.tl.functions.channels import EditAdminRequest
                from telethon.tl.types import ChatAdminRights
                
                # Create admin rights with ALL privileges EXCEPT anonymous
                # CRITICAL: Include all permissions needed for managing filters (/filters command)
                admin_rights = ChatAdminRights(
                    change_info=True,      # Can change group info
                    post_messages=True,     # Can post messages
                    edit_messages=True,     # Can edit messages
                    delete_messages=True,   # Can delete messages (needed for filters)
                    ban_users=True,         # Can ban users
                    invite_users=True,      # Can invite users
                    pin_messages=True,      # Can pin messages
                    add_admins=True,        # Can add admins
                    anonymous=False,        # NOT anonymous (user will be visible as admin)
                    manage_call=True,       # Can manage calls
                    other=True,            # Other admin rights (includes filter management)
                )
                
                # CRITICAL: Load participants first to ensure Telegram has synced user status
                logger.info("  🔍 Loading participants to sync user status...")
                try:
                    await creator_client.client.get_participants(group_entity, limit=100)
                    logger.info("  ✅ Participants loaded")
                    await asyncio.sleep(2)  # Wait for Telegram to fully sync
                except Exception as e:
                    logger.warning(f"  ⚠️ Could not load participants: {e}")
                    await asyncio.sleep(2)  # Still wait even if load fails
                
                # Promote users with role="Mod", role="Dev", or is_mod=True
                # User clarified: role="dev" is creator (skip), role="mod" should be promoted
                for phone in user_roles.keys():
                    # Skip creator account (role="dev" is creator, should stay anonymous)
                    if phone == CREATOR_PHONE:
                        logger.info(f"  ⏭️ Skipping creator account {phone} (role: dev, stays anonymous)")
                        continue
                    
                    # Check if this user should be promoted:
                    # 1. Has is_mod flag set to True
                    # 2. Has role="Mod" (case-insensitive) - THIS IS THE MODERATOR
                    # 3. Has role="Dev" (case-insensitive) - but skip creator (already handled above)
                    is_mod_flag = user_is_mod.get(phone, False)
                    user_role = user_roles.get(phone, '').lower() if user_roles.get(phone) else ''
                    should_promote = is_mod_flag or user_role == 'mod' or user_role == 'dev'
                    
                    logger.info(f"  🔍 Checking {phone}: role='{user_roles.get(phone, 'unknown')}', is_mod={is_mod_flag}, should_promote={should_promote}")
                    
                    if not should_promote:
                        logger.info(f"  ⏭️ Skipping {phone} (not a mod/dev)")
                        continue  # Skip non-mod/dev users
                    
                    # Find client for this mod/dev user
                    mod_client = None
                    for client in clients:
                        if getattr(client, 'phone', None) == phone:
                            mod_client = client
                            break
                    
                    if not mod_client:
                        logger.warning(f"  ⚠️ Mod/Dev user {phone} not found in clients")
                        failed_count += 1
                        continue
                    
                    # Skip creator account (they're already admin and should stay anonymous)
                    if phone == CREATOR_PHONE:
                        logger.info(f"  ⏭️ Skipping creator account {phone} (already admin, stays anonymous)")
                        continue
                    
                    try:
                        # Get mod user's entity
                        mod_user_entity = await mod_client.client.get_me()
                        
                        # Promote to admin using EditAdminRequest (correct Telegram API)
                        from telethon.tl.functions.channels import EditAdminRequest
                        logger.info(f"  📤 Promoting {phone} to admin/moderator...")
                        try:
                            await creator_client.client(EditAdminRequest(
                                channel=group_entity,
                                user_id=mod_user_entity,
                                admin_rights=admin_rights,
                                rank="Moderator"  # Admin rank/title
                            ))
                            logger.info(f"  ✅ Successfully promoted {phone} to admin/moderator")
                            promoted_count += 1
                        except FloodWaitError as flood_error:
                            wait_time = flood_error.seconds
                            logger.warning(f"  ⚠️ RATE LIMITED: Waiting {wait_time} seconds...")
                            await asyncio.sleep(wait_time)
                            await creator_client.client(EditAdminRequest(
                                channel=group_entity,
                                user_id=mod_user_entity,
                                admin_rights=admin_rights,
                                rank="Moderator"
                            ))
                            logger.info(f"  ✅ Successfully promoted {phone} after rate limit wait")
                            promoted_count += 1
                        
                        # Small delay to avoid rate limits
                        await asyncio.sleep(1)
                        
                    except Exception as e:
                        error_str = str(e)
                        logger.error(f"  ❌ FAILED TO PROMOTE {phone} to admin: {error_str}")
                        logger.error(f"     Error type: {type(e).__name__}")
                        logger.error(f"     User role: {user_roles.get(phone, 'unknown')}, is_mod: {is_mod_flag}")
                        logger.error(f"     Should promote: {should_promote}")
                        import traceback
                        logger.error(f"     Traceback:\n{traceback.format_exc()}")
                        failed_count += 1
                
                logger.info(f"\n✅ Mod promotion complete: {promoted_count} promoted, {failed_count} failed")
                return {'promoted': promoted_count, 'failed': failed_count}
            
            try:
                promote_result = asyncio.run_coroutine_threadsafe(promote_mod_users(), loop).result(timeout=60)
                logger.info(f"Mod promotion result: {promote_result}")
            except Exception as e:
                logger.warning(f"⚠️ Error during mod promotion: {e}")
                logger.warning("Continuing anyway - mod users may need to be promoted manually")
                import traceback
                logger.warning(traceback.format_exc())
        
        # Update chat_ids to include the group if not already present
        group_chat_id_str = str(group_chat_id_for_autojoin)
        if group_chat_id_str not in chat_ids:
            chat_ids.insert(0, group_chat_id_str)  # Add at the beginning
            logger.info(f"Updated chat_ids to include created group: {chat_ids}")
    
    # Create Telegram campaign with scripted conversations
    # Initialize bot token from config
    bot_token = config_data.get('bot_token') or Config.TELEGRAM_BOT_TOKEN
    telegram_campaign = TelegramCampaign(clients, scripted_conversations=scripted_conversations, bot_token=bot_token)
    
    # CRITICAL: Re-apply creator anonymous status RIGHT BEFORE conversations start
    # Telegram sometimes resets anonymous status, so we need to re-apply it
    # Also ensure mods are promoted before conversations start
    if group_chat_id_for_autojoin and scripted_conversations and len(scripted_conversations) > 0:
        logger.info(f"\n{'='*60}")
        logger.info(f"FINAL SETUP BEFORE CONVERSATIONS START")
        logger.info(f"{'='*60}")
        
        async def final_setup_before_conversations():
            """Final setup: Re-apply creator anonymous AND ensure mods are promoted"""
            CREATOR_PHONE = '+13124733150'
            creator_client = None
            for client in clients:
                if getattr(client, 'phone', None) == CREATOR_PHONE:
                    creator_client = client
                    break
            
            if not creator_client:
                logger.warning(f"⚠️ Creator account ({CREATOR_PHONE}) not found")
                return {'anonymous': False, 'mods_promoted': False}
            
            try:
                entity = await creator_client.client.get_entity(int(group_chat_id_for_autojoin))
                
                # STEP 1: Re-apply creator anonymous status
                logger.info("  🔍 STEP 1: Re-applying creator anonymous status...")
                try:
                    me = await creator_client.client.get_me()
                    from telethon.tl.functions.channels import EditAdminRequest, GetFullChannelRequest
                    from telethon.tl.types import ChatAdminRights, InputUserSelf
                    from telethon.errors import FloodWaitError
                    
                    # Load participants first
                    await creator_client.client.get_participants(entity, limit=100)
                    await asyncio.sleep(1)
                    
                    # Get current admin info to preserve existing rights
                    full_channel = await creator_client.client(GetFullChannelRequest(entity))
                    
                    # Get current admin rights if available
                    current_rights = None
                    if hasattr(full_channel, 'full_chat') and hasattr(full_channel.full_chat, 'admins'):
                        for admin in full_channel.full_chat.admins:
                            if admin.user_id == me.id and hasattr(admin, 'admin_rights'):
                                current_rights = admin.admin_rights
                                break
                    
                    # Create admin rights with anonymous=True
                    if current_rights:
                        anonymous_rights = ChatAdminRights(
                            change_info=getattr(current_rights, 'change_info', True),
                            post_messages=getattr(current_rights, 'post_messages', True),
                            edit_messages=getattr(current_rights, 'edit_messages', True),
                            delete_messages=getattr(current_rights, 'delete_messages', True),
                            ban_users=getattr(current_rights, 'ban_users', True),
                            invite_users=getattr(current_rights, 'invite_users', True),
                            pin_messages=getattr(current_rights, 'pin_messages', True),
                            add_admins=getattr(current_rights, 'add_admins', True),
                            anonymous=True,  # CRITICAL: Re-enable anonymous
                            manage_call=getattr(current_rights, 'manage_call', False),
                            other=getattr(current_rights, 'other', False)
                        )
                    else:
                        # Use full admin rights with anonymous=True
                        anonymous_rights = ChatAdminRights(
                            change_info=True,
                            post_messages=True,
                            edit_messages=True,
                            delete_messages=True,
                            ban_users=True,
                            invite_users=True,
                            pin_messages=True,
                            add_admins=True,
                            anonymous=True,  # CRITICAL: Re-enable anonymous
                            manage_call=False,
                            other=False
                        )
                    
                    try:
                        # Re-apply anonymous status
                        await creator_client.client(EditAdminRequest(
                            channel=entity,
                            user_id=InputUserSelf(),
                            admin_rights=anonymous_rights,
                            rank="Admin"
                        ))
                        logger.info("  ✅ Creator anonymous status re-applied successfully (anonymous=True)")
                        await asyncio.sleep(2)  # Wait for Telegram to process
                        anonymous_success = True
                    except FloodWaitError as flood_error:
                        wait_time = flood_error.seconds
                        logger.warning(f"  ⚠️ RATE LIMITED: Waiting {wait_time} seconds...")
                        await asyncio.sleep(wait_time)
                        await creator_client.client(EditAdminRequest(
                            channel=entity,
                            user_id=InputUserSelf(),
                            admin_rights=anonymous_rights,
                            rank="Admin"
                        ))
                        logger.info("  ✅ Creator anonymous status re-applied after rate limit wait")
                        anonymous_success = True
                except Exception as e:
                    error_str = str(e)
                    logger.error(f"  ❌ Could not re-apply anonymous status: {error_str}")
                    logger.error(f"     Error type: {type(e).__name__}")
                    import traceback
                    logger.error(traceback.format_exc())
                    anonymous_success = False
                
                # STEP 2: Ensure mods are promoted (promote again if needed)
                logger.info("  🔍 STEP 2: Ensuring mods are promoted...")
                mods_promoted_count = 0
                try:
                    from telethon.tl.functions.channels import EditAdminRequest, GetParticipantRequest
                    from telethon.tl.types import ChatAdminRights, ChannelParticipantAdmin, ChannelParticipantCreator
                    
                    # Load participants again
                    await creator_client.client.get_participants(entity, limit=100)
                    await asyncio.sleep(1)
                    
                    admin_rights = ChatAdminRights(
                        change_info=True, post_messages=True, edit_messages=True,
                        delete_messages=True, ban_users=True, invite_users=True,
                        pin_messages=True, add_admins=False, anonymous=False,
                        manage_call=True, other=True
                    )
                    
                    # Check each mod user and promote if not already admin
                    for phone in user_roles.keys():
                        if phone == CREATOR_PHONE:
                            continue  # Skip creator
                        
                        is_mod_flag = user_is_mod.get(phone, False)
                        user_role = user_roles.get(phone, '').lower() if user_roles.get(phone) else ''
                        should_promote = is_mod_flag or user_role == 'mod' or user_role == 'dev'
                        
                        if not should_promote:
                            continue
                        
                        # Find client
                        mod_client = None
                        for client in clients:
                            if getattr(client, 'phone', None) == phone:
                                mod_client = client
                                break
                        
                        if not mod_client:
                            continue
                        
                        try:
                            mod_user_entity = await mod_client.client.get_me()
                            
                            # Check if already admin (with retry for database locks)
                            is_already_admin = False
                            for retry in range(3):
                                try:
                                    participant = await creator_client.client(GetParticipantRequest(
                                        channel=entity,
                                        participant=mod_user_entity
                                    ))
                                    if isinstance(participant.participant, (ChannelParticipantAdmin, ChannelParticipantCreator)):
                                        logger.info(f"  ✅ {phone} is already admin - skipping")
                                        mods_promoted_count += 1
                                        is_already_admin = True
                                        break
                                    break  # Got result, not admin
                                except Exception as check_error:
                                    error_str = str(check_error).lower()
                                    if 'database is locked' in error_str or 'locked' in error_str:
                                        if retry < 2:
                                            wait_time = (retry + 1) * 2  # 2s, 4s
                                            logger.warning(f"  ⚠️ Database locked (check), waiting {wait_time}s and retrying...")
                                            await asyncio.sleep(wait_time)
                                            continue
                                    # Not a lock error or max retries - break
                                    break
                            
                            if is_already_admin:
                                continue
                            
                            # Promote to admin (with retry for database locks)
                            logger.info(f"  📤 Promoting {phone} (role: {user_roles.get(phone, 'unknown')}) to moderator...")
                            promotion_success = False
                            for retry in range(3):
                                try:
                                    await creator_client.client(EditAdminRequest(
                                        channel=entity,
                                        user_id=mod_user_entity,
                                        admin_rights=admin_rights,
                                        rank="Moderator"
                                    ))
                                    logger.info(f"  ✅ Successfully promoted {phone} to moderator")
                                    mods_promoted_count += 1
                                    promotion_success = True
                                    break
                                except Exception as promote_error:
                                    error_str = str(promote_error).lower()
                                    if 'database is locked' in error_str or 'locked' in error_str:
                                        if retry < 2:
                                            wait_time = (retry + 1) * 2  # 2s, 4s
                                            logger.warning(f"  ⚠️ Database locked (promote), waiting {wait_time}s and retrying...")
                                            await asyncio.sleep(wait_time)
                                            continue
                                        else:
                                            logger.error(f"  ❌ Database locked after {retry + 1} retries - giving up")
                                    else:
                                        # Not a lock error - break immediately
                                        raise promote_error
                            
                            if not promotion_success:
                                logger.error(f"  ❌ Failed to promote {phone} after retries")
                            
                            await asyncio.sleep(2)  # Delay between promotions
                        except Exception as e:
                            error_str = str(e)
                            logger.warning(f"  ⚠️ Could not promote {phone}: {error_str}")
                            import traceback
                            logger.warning(traceback.format_exc())
                    
                    logger.info(f"  ✅ Mod promotion check complete: {mods_promoted_count} mod(s) confirmed as admin")
                    mods_success = mods_promoted_count > 0
                except Exception as e:
                    logger.warning(f"  ⚠️ Error checking/promoting mods: {e}")
                    mods_success = False
                
                return {'anonymous': anonymous_success, 'mods_promoted': mods_success}
            except Exception as e:
                logger.error(f"❌ Error in final setup: {e}")
                import traceback
                logger.error(traceback.format_exc())
                return {'anonymous': False, 'mods_promoted': False}
        
        try:
            # Use existing loop, not create new one
            final_result = asyncio.run_coroutine_threadsafe(final_setup_before_conversations(), loop).result(timeout=60)
            if final_result.get('anonymous'):
                logger.info(f"✅ Creator anonymous status confirmed before conversations")
            else:
                logger.error(f"❌ FAILED TO RE-APPLY CREATOR ANONYMOUS STATUS!")
            if final_result.get('mods_promoted'):
                logger.info(f"✅ Mods confirmed as admin before conversations")
            else:
                logger.warning(f"⚠️ Mod promotion check failed or no mods found")
        except Exception as e:
            logger.error(f"❌ Error in final setup before conversations: {e}")
            import traceback
            logger.error(traceback.format_exc())
    
    # Log user roles for debugging
    logger.info(f"\n{'='*60}")
    logger.info(f"USER ROLES CONFIGURATION")
    logger.info(f"{'='*60}")
    for phone, role in user_roles.items():
        logger.info(f"  {phone}: role='{role}'")
    logger.info(f"{'='*60}\n")
    
    # Start conversation and wait for it to complete
    logger.info(f"Starting conversation...\n")
    
    try:
        conversation_thread = telegram_campaign.start_conversation_thread(
            campaign_id=campaign_id,
            direction=direction,
            chat_ids=chat_ids,
            user_roles=user_roles,
            user_is_mod=user_is_mod,
            token_name=token_name,
            token_symbol=token_symbol,
            token_address=token_address,
            website=website,
            telegram=telegram,
            twitter=twitter,
            docs=docs,
            description=description,
            chain=chain
        )
        
        # Calculate timeout based on conversation duration
        # Get max duration from scripted conversations
        max_duration = 300  # Default 5 minutes
        if scripted_conversations:
            for conv in scripted_conversations:
                total_delay = sum(
                    (msg.get('typing_delay', 0) + msg.get('delay_after', 0))
                    for msg in conv.get('messages', [])
                )
                max_duration = max(max_duration, total_delay)
        
        # Add 2 minute buffer for connection and processing
        timeout_seconds = int(max_duration) + 120
        logger.info(f"Waiting for conversation to complete (timeout: {timeout_seconds}s / {timeout_seconds/60:.1f} min)")
        
        # Wait for conversation thread to complete
        conversation_thread.join(timeout=timeout_seconds)
        
        logger.info(f"\n{'='*60}")
        logger.info(f"Conversation completed!")
        logger.info(f"{'='*60}")
        return True
        
    except Exception as e:
        logger.error(f"Error starting conversation: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return False

def main():
    """Main entry point - reads JSON config from stdin"""
    try:
        # Read JSON config from stdin with UTF-8 encoding for proper emoji handling
        # Ensure stdin is UTF-8 encoded (already set at top of file for Windows)
        input_data = sys.stdin.read()
        if not input_data:
            logger.error("No input data provided")
            sys.exit(1)
        
        # Parse JSON - Python's json.loads handles UTF-8 correctly by default
        data = json.loads(input_data)
        
        config_data = data.get('config', {})
        scripted_conversations = data.get('scripted_conversations', [])
        action = config_data.get('action')  # Check for manual action
        
        # Handle verify action (account verification)
        if action == 'verify':
            import asyncio
            from telegram_user_client import TelegramUserClient
            
            api_id = config_data.get('api_id')
            api_hash = config_data.get('api_hash')
            phone = config_data.get('phone')
            code = config_data.get('code')
            password = config_data.get('password')
            phone_code_hash = config_data.get('phone_code_hash')
            
            if not api_id or not api_hash or not phone:
                logger.error("Missing api_id, api_hash, or phone for verify action")
                print("TELEGRAM_VERIFY_RESULT:")
                print(json.dumps({"success": False, "error": "Missing api_id, api_hash, or phone"}))
                sys.exit(1)
            
            # Create session name from phone
            phone_clean = phone.replace('+', '').replace('-', '').replace(' ', '')
            session_name = phone_clean
            
            try:
                # Create client
                client = TelegramUserClient(
                    api_id=int(api_id),
                    api_hash=api_hash,
                    phone=phone,
                    session_name=session_name,
                )
                
                # Get event loop
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                
                async def verify_account():
                    try:
                        # Try to connect
                        await client.client.connect()
                        
                        # Check if authorized
                        if await client.client.is_user_authorized():
                            # Already authorized - get user info
                            me = await client.client.get_me()
                            logger.info(f"✅ Account verified: {phone}")
                            print("TELEGRAM_VERIFY_RESULT:")
                            print(json.dumps({
                                "success": True,
                                "verified": True,
                                "user": {
                                    "id": me.id,
                                    "username": me.username,
                                    "first_name": me.first_name,
                                    "last_name": me.last_name,
                                    "phone": phone,
                                },
                                "message": "Account verified successfully"
                            }))
                            await client.client.disconnect()
                            return
                        
                        # Not authorized - need to sign in
                        if code:
                            # Sign in with code
                            if password:
                                await client.client.sign_in(phone=phone, code=code, password=password)
                            else:
                                await client.client.sign_in(phone=phone, code=code, phone_code_hash=phone_code_hash)
                            
                            # Get user info
                            me = await client.client.get_me()
                            logger.info(f"✅ Account verified with code: {phone}")
                            print("TELEGRAM_VERIFY_RESULT:")
                            print(json.dumps({
                                "success": True,
                                "verified": True,
                                "user": {
                                    "id": me.id,
                                    "username": me.username,
                                    "first_name": me.first_name,
                                    "last_name": me.last_name,
                                    "phone": phone,
                                },
                                "message": "Account verified successfully"
                            }))
                            await client.client.disconnect()
                        else:
                            # Need code
                            sent_code = await client.client.send_code_request(phone)
                            logger.info(f"📱 Verification code sent to {phone}")
                            print("TELEGRAM_VERIFY_RESULT:")
                            print(json.dumps({
                                "success": True,
                                "verified": False,
                                "requires_code": True,
                                "phone_code_hash": sent_code.phone_code_hash,
                                "message": "Verification code sent to Telegram"
                            }))
                            await client.client.disconnect()
                    except Exception as e:
                        logger.error(f"Verification error: {e}")
                        import traceback
                        logger.error(traceback.format_exc())
                        print("TELEGRAM_VERIFY_RESULT:")
                        print(json.dumps({
                            "success": False,
                            "verified": False,
                            "error": str(e),
                            "message": f"Verification failed: {str(e)}"
                        }))
                
                loop.run_until_complete(verify_account())
                sys.exit(0)
            except Exception as e:
                logger.error(f"Verify action error: {e}")
                import traceback
                logger.error(traceback.format_exc())
                print("TELEGRAM_VERIFY_RESULT:")
                print(json.dumps({
                    "success": False,
                    "verified": False,
                    "error": str(e),
                    "message": f"Verification failed: {str(e)}"
                }))
                sys.exit(1)
        
        # Handle manual actions (make_creator_anonymous, promote_mods, etc.)
        if action:
            logger.info(f"\n{'='*60}")
            logger.info(f"MANUAL ACTION: {action}")
            logger.info(f"{'='*60}")
            
            group_chat_id = config_data.get('group_chat_id')
            if not group_chat_id:
                logger.error("❌ Missing group_chat_id for action")
                print("GROUP_ACTION_RESULT:")
                print(json.dumps({"success": False, "error": "Missing group_chat_id"}))
                sys.exit(1)
            
            # Initialize clients
            clients, user_roles, user_is_mod = initialize_clients(config_data)
            if not clients:
                logger.error("❌ No clients initialized")
                print("GROUP_ACTION_RESULT:")
                print(json.dumps({"success": False, "error": "No clients initialized"}))
                sys.exit(1)
            
            # Get event loop
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
            async def run_action():
                try:
                    # Connect all clients
                    for client in clients:
                        await client.client.connect()
                        if not await client.client.is_user_authorized():
                            logger.warning(f"⚠️ Client {client.phone} not authorized - skipping")
                            continue
                    
                    # Find creator account
                    CREATOR_PHONE = '+13124733150'
                    creator_client = None
                    for client in clients:
                        if getattr(client, 'phone', None) == CREATOR_PHONE:
                            creator_client = client
                            break
                    
                    if not creator_client:
                        logger.error(f"❌ Creator account ({CREATOR_PHONE}) not found")
                        print("GROUP_ACTION_RESULT:")
                        print(json.dumps({"success": False, "error": f"Creator account ({CREATOR_PHONE}) not found"}))
                        return
                    
                    # Get group entity
                    group_entity = await creator_client.client.get_entity(int(group_chat_id))
                    
                    # CRITICAL: Verify this is a GROUP, not a CHANNEL
                    logger.info(f"🔍 Verifying entity type...")
                    logger.info(f"   Entity ID: {group_entity.id}")
                    logger.info(f"   Entity title: {getattr(group_entity, 'title', 'N/A')}")
                    logger.info(f"   Entity type - broadcast: {getattr(group_entity, 'broadcast', None)}")
                    logger.info(f"   Entity type - megagroup: {getattr(group_entity, 'megagroup', None)}")
                    
                    # Ensure we're working with a GROUP (megagroup=True, broadcast=False)
                    # NOT a CHANNEL (broadcast=True)
                    is_channel = getattr(group_entity, 'broadcast', False)
                    is_megagroup = getattr(group_entity, 'megagroup', False)
                    
                    if is_channel and not is_megagroup:
                        logger.error(f"❌ ERROR: This is a CHANNEL, not a GROUP!")
                        logger.error(f"   Channels and Groups have different admin management!")
                        logger.error(f"   Promotion should be done in the GROUP, not the CHANNEL")
                        print("GROUP_ACTION_RESULT:")
                        print(json.dumps({"success": False, "error": "Entity is a channel, not a group. Promotion must be done in the group."}))
                        return
                    
                    if not is_megagroup:
                        logger.warning(f"⚠️ WARNING: This might be a small group (not a supergroup)")
                        logger.warning(f"   Small groups use different admin management")
                    
                    logger.info(f"✅ Confirmed: This is a {'MEGAGROUP' if is_megagroup else 'SMALL GROUP'} (not a channel)")
                    
                    # Verify creator is admin and has permission to add admins
                    logger.info(f"🔍 Verifying creator account permissions...")
                    try:
                        from telethon.tl.functions.channels import GetParticipantRequest
                        creator_participant = await creator_client.client(GetParticipantRequest(
                            channel=group_entity,
                            participant=await creator_client.client.get_me()
                        ))
                        logger.info(f"     Creator participant type: {type(creator_participant.participant)}")
                        
                        from telethon.tl.types import ChannelParticipantAdmin, ChannelParticipantCreator
                        if isinstance(creator_participant.participant, (ChannelParticipantAdmin, ChannelParticipantCreator)):
                            if isinstance(creator_participant.participant, ChannelParticipantAdmin):
                                admin_rights = creator_participant.participant.admin_rights
                                if admin_rights:
                                    can_add_admins = getattr(admin_rights, 'add_admins', False)
                                    logger.info(f"     Creator has 'add_admins' permission: {can_add_admins}")
                                    if not can_add_admins:
                                        logger.error(f"❌ CREATOR DOES NOT HAVE 'ADD ADMINS' PERMISSION!")
                                        logger.error(f"   The creator account needs 'Add new admins' permission to promote others")
                                        print("GROUP_ACTION_RESULT:")
                                        print(json.dumps({"success": False, "error": "Creator account does not have 'Add new admins' permission"}))
                                        return
                            else:
                                logger.info(f"     Creator is the group creator (has all permissions)")
                        else:
                            logger.error(f"❌ CREATOR IS NOT AN ADMIN!")
                            logger.error(f"   The creator account must be an admin to promote others")
                            print("GROUP_ACTION_RESULT:")
                            print(json.dumps({"success": False, "error": "Creator account is not an admin"}))
                            return
                    except Exception as perm_error:
                        logger.warning(f"⚠️ Could not verify creator permissions: {perm_error}")
                        logger.warning(f"   Continuing anyway, but promotion may fail...")
                    
                    if action == 'make_creator_anonymous':
                        # Make creator anonymous - using same approach as group creator
                        logger.info("🔍 Making creator anonymous...")
                        
                        # CRITICAL: Load participants first to ensure Telegram has synced user status
                        logger.info("  Loading participants to sync user status...")
                        try:
                            await creator_client.client.get_participants(group_entity, limit=100)
                            logger.info("  ✅ Participants loaded")
                            await asyncio.sleep(2)  # Wait for Telegram to fully sync
                        except Exception as e:
                            logger.warning(f"  ⚠️ Could not load participants: {e}")
                            await asyncio.sleep(2)  # Still wait even if load fails
                        
                        from telethon.tl.functions.channels import EditAdminRequest, GetFullChannelRequest
                        from telethon.tl.types import ChatAdminRights, InputUserSelf
                        from telethon.errors import FloodWaitError
                        
                        me = await creator_client.client.get_me()
                        logger.info(f"  Creator user ID: {me.id}")
                        
                        try:
                            # Get current admin info to preserve existing rights (same as group creator)
                            full_channel = await creator_client.client(GetFullChannelRequest(group_entity))
                            logger.info("  ✅ Got full channel info")
                            
                            # Get current admin rights if available
                            current_rights = None
                            if hasattr(full_channel, 'full_chat') and hasattr(full_channel.full_chat, 'admins'):
                                for admin in full_channel.full_chat.admins:
                                    if admin.user_id == me.id and hasattr(admin, 'admin_rights'):
                                        current_rights = admin.admin_rights
                                        logger.info(f"  ✅ Found current admin rights for creator")
                                        break
                            
                            # Create admin rights with anonymous=True
                            # Preserve existing rights if available, otherwise use full admin rights
                            if current_rights:
                                logger.info("  📋 Preserving existing admin rights and setting anonymous=True")
                                anonymous_rights = ChatAdminRights(
                                    change_info=getattr(current_rights, 'change_info', True),
                                    post_messages=getattr(current_rights, 'post_messages', True),
                                    edit_messages=getattr(current_rights, 'edit_messages', True),
                                    delete_messages=getattr(current_rights, 'delete_messages', True),
                                    ban_users=getattr(current_rights, 'ban_users', True),
                                    invite_users=getattr(current_rights, 'invite_users', True),
                                    pin_messages=getattr(current_rights, 'pin_messages', True),
                                    add_admins=getattr(current_rights, 'add_admins', True),
                                    anonymous=True,  # Enable "Remain Anonymous" - THIS IS THE KEY
                                    manage_call=getattr(current_rights, 'manage_call', False),
                                    other=getattr(current_rights, 'other', False)
                                )
                            else:
                                logger.info("  📋 Using full admin rights with anonymous=True")
                                # Use full admin rights with anonymous=True
                                anonymous_rights = ChatAdminRights(
                                    change_info=True,
                                    post_messages=True,
                                    edit_messages=True,
                                    delete_messages=True,
                                    ban_users=True,
                                    invite_users=True,
                                    pin_messages=True,
                                    add_admins=True,
                                    anonymous=True,  # Enable "Remain Anonymous"
                                    manage_call=False,
                                    other=False
                                )
                            
                            logger.info(f"  📋 Admin rights being set:")
                            logger.info(f"     - anonymous: {anonymous_rights.anonymous}")
                            logger.info(f"     - add_admins: {anonymous_rights.add_admins}")
                            
                            # Update admin rights with anonymous=True
                            # Use InputUserSelf() to reference the current user (same as group creator)
                            try:
                                result = await creator_client.client(EditAdminRequest(
                                    channel=group_entity,
                                    user_id=InputUserSelf(),  # Use InputUserSelf() instead of me
                                    admin_rights=anonymous_rights,
                                    rank="Admin"
                                ))
                                logger.info("  ✅ EditAdminRequest completed successfully")
                                
                                # Wait for Telegram to process
                                await asyncio.sleep(2)
                                
                                logger.info("✅ Creator 'Remain Anonymous' enabled (anonymous=True)")
                                print("GROUP_ACTION_RESULT:")
                                print(json.dumps({"success": True}))
                            except FloodWaitError as flood_error:
                                wait_time = flood_error.seconds
                                logger.warning(f"  ⚠️ RATE LIMITED: Telegram requires {wait_time} seconds wait")
                                logger.warning(f"  ⏳ Waiting {wait_time} seconds before retrying...")
                                await asyncio.sleep(wait_time)
                                
                                # Retry after waiting
                                logger.info(f"  🔄 Retrying make anonymous after rate limit wait...")
                                result = await creator_client.client(EditAdminRequest(
                                    channel=group_entity,
                                    user_id=InputUserSelf(),
                                    admin_rights=anonymous_rights,
                                    rank="Admin"
                                ))
                                logger.info("  ✅ EditAdminRequest completed successfully after retry")
                                await asyncio.sleep(2)
                                logger.info("✅ Creator 'Remain Anonymous' enabled (anonymous=True)")
                                print("GROUP_ACTION_RESULT:")
                                print(json.dumps({"success": True}))
                        except Exception as e:
                            error_str = str(e)
                            error_type = type(e).__name__
                            logger.error(f"❌ Could not enable 'Remain Anonymous' for creator: {error_str}")
                            logger.error(f"   Error type: {error_type}")
                            import traceback
                            logger.error(traceback.format_exc())
                            print("GROUP_ACTION_RESULT:")
                            print(json.dumps({"success": False, "error": error_str}))
                    
                    elif action == 'promote_mods':
                        # Promote all mod users
                        # Use Telethon's convenience method edit_admin() instead of raw EditAdminRequest
                        from telethon.tl.types import ChatAdminRights
                        
                        # Create admin rights with ALL required permissions
                        # According to Telethon docs: https://docs.telethon.dev/en/stable/modules/client.html
                        admin_rights = ChatAdminRights(
                            change_info=True,      # Can change group info
                            post_messages=True,     # Can post messages
                            edit_messages=True,     # Can edit messages
                            delete_messages=True,   # Can delete messages (CRITICAL for filters)
                            ban_users=True,         # Can ban users
                            invite_users=True,      # Can invite users
                            pin_messages=True,      # Can pin messages
                            add_admins=False,       # Mods can't add admins (only creator can)
                            anonymous=False,        # Mods are visible (not anonymous)
                            manage_call=True,       # Can manage calls
                            other=True              # Other admin rights (CRITICAL for filter management)
                        )
                        
                        promoted_count = 0
                        failed_count = 0
                        
                        logger.info(f"\n{'='*60}")
                        logger.info(f"PROMOTE_MODS ACTION - DETAILED DEBUG")
                        logger.info(f"{'='*60}")
                        logger.info(f"🔍 Total clients: {len(clients)}")
                        logger.info(f"🔍 Creator phone: {CREATOR_PHONE}")
                        logger.info(f"🔍 User roles from config:")
                        for phone, role in user_roles.items():
                            is_mod = user_is_mod.get(phone, False)
                            logger.info(f"     {phone}: role='{role}', is_mod={is_mod}")
                        logger.info(f"🔍 User is_mod flags:")
                        for phone, is_mod in user_is_mod.items():
                            logger.info(f"     {phone}: is_mod={is_mod}")
                        logger.info(f"{'='*60}\n")
                        
                        for client in clients:
                            phone = getattr(client, 'phone', None)
                            if not phone:
                                logger.warning(f"  ⚠️ Client has no phone attribute, skipping")
                                continue
                            
                            # CRITICAL: Skip creator account - NEVER promote creator
                            if phone == CREATOR_PHONE:
                                logger.info(f"  ⏭️ SKIPPING CREATOR ACCOUNT {phone} (must stay anonymous)")
                                continue
                            
                            # Get user entity to verify it's not the creator
                            try:
                                user_entity = await client.client.get_me()
                                user_id = user_entity.id
                                creator_entity = await creator_client.client.get_me()
                                creator_id = creator_entity.id
                                
                                # Double-check: Skip if this is the creator by user ID
                                if user_id == creator_id:
                                    logger.warning(f"  ⚠️ SKIPPING CREATOR (matched by user ID {user_id})")
                                    continue
                            except Exception as e:
                                logger.warning(f"  ⚠️ Could not verify user entity for {phone}: {e}")
                                continue
                            
                            # Normalize phone for lookup (remove spaces, dashes, parentheses)
                            normalized_phone = phone.replace(' ', '').replace('-', '').replace('(', '').replace(')', '')
                            
                            # Try to find user config with normalized phone
                            matching_phone = None
                            for config_phone in user_roles.keys():
                                normalized_config_phone = config_phone.replace(' ', '').replace('-', '').replace('(', '').replace(')', '')
                                if normalized_config_phone == normalized_phone:
                                    matching_phone = config_phone
                                    break
                            
                            if not matching_phone:
                                # Fallback: try exact match
                                matching_phone = phone if phone in user_roles else None
                            
                            # Check if this user should be promoted:
                            # 1. Has is_mod flag set to True
                            # 2. Has role="Mod" (case-insensitive)
                            # 3. Has role="Dev" (case-insensitive)
                            is_mod_flag = user_is_mod.get(matching_phone, False) if matching_phone else False
                            user_role = user_roles.get(matching_phone, '').lower() if matching_phone and user_roles.get(matching_phone) else ''
                            should_promote = is_mod_flag or user_role == 'mod' or user_role == 'dev'
                            
                            logger.info(f"  🔍 Checking {phone} (normalized: {normalized_phone})")
                            logger.info(f"     Matching config phone: {matching_phone}")
                            logger.info(f"     Role from config: {user_roles.get(matching_phone, 'NOT FOUND') if matching_phone else 'NO MATCH'}")
                            logger.info(f"     is_mod flag: {is_mod_flag}")
                            logger.info(f"     Should promote: {should_promote}")
                            
                            if not should_promote:
                                logger.info(f"  ⏭️ Skipping {phone} (role: {user_roles.get(matching_phone, 'unknown') if matching_phone else 'NO MATCH'}, is_mod: {is_mod_flag}) - not a mod/dev")
                                continue
                            
                            logger.info(f"  📤 Promoting {phone} (role: {user_roles.get(matching_phone, 'unknown') if matching_phone else 'NO MATCH'}, is_mod: {is_mod_flag})")
                            
                            try:
                                mod_user_entity = await client.client.get_me()
                                logger.info(f"     User ID: {mod_user_entity.id}, Username: {getattr(mod_user_entity, 'username', 'N/A')}")
                                
                                logger.info(f"     Attempting EditAdminRequest for user {mod_user_entity.id}...")
                                logger.info(f"     Group entity ID: {group_entity.id}, Title: {getattr(group_entity, 'title', 'N/A')}")
                                logger.info(f"     Group type: broadcast={getattr(group_entity, 'broadcast', None)}, megagroup={getattr(group_entity, 'megagroup', None)}")
                                
                                # Log admin rights being set - MUST specify ALL fields explicitly
                                logger.info(f"     Admin rights being set (ALL fields required by Telegram):")
                                logger.info(f"       - change_info: {admin_rights.change_info}")
                                logger.info(f"       - post_messages: {admin_rights.post_messages}")
                                logger.info(f"       - edit_messages: {admin_rights.edit_messages}")
                                logger.info(f"       - delete_messages: {admin_rights.delete_messages}")
                                logger.info(f"       - ban_users: {admin_rights.ban_users}")
                                logger.info(f"       - invite_users: {admin_rights.invite_users}")
                                logger.info(f"       - pin_messages: {admin_rights.pin_messages}")
                                logger.info(f"       - add_admins: {admin_rights.add_admins}")
                                logger.info(f"       - anonymous: {admin_rights.anonymous}")
                                logger.info(f"       - manage_call: {admin_rights.manage_call}")
                                logger.info(f"       - other: {admin_rights.other}")
                                
                                # CRITICAL: Load participants first to ensure Telegram has synced user status
                                logger.info(f"     Loading participants to sync user status...")
                                try:
                                    await creator_client.client.get_participants(group_entity, limit=100)
                                    logger.info(f"     ✅ Participants loaded")
                                    await asyncio.sleep(2)  # Wait for Telegram to fully sync
                                except Exception as e:
                                    logger.warning(f"     ⚠️ Could not load participants: {e}")
                                    await asyncio.sleep(2)  # Still wait even if load fails
                                
                                # Perform the promotion using Telethon's edit_admin() convenience method
                                # This is the recommended way according to Telethon docs
                                promotion_success = False
                                for retry in range(3):
                                    try:
                                        from telethon.errors import FloodWaitError
                                        
                                        # Use EditAdminRequest directly - this is the correct Telegram API call
                                        from telethon.tl.functions.channels import EditAdminRequest
                                        logger.info(f"     Using EditAdminRequest to promote user...")
                                        result = await creator_client.client(EditAdminRequest(
                                            channel=group_entity,
                                            user_id=mod_user_entity,
                                            admin_rights=admin_rights,
                                            rank="Moderator"
                                        ))
                                        logger.info(f"     edit_admin() completed. Result type: {type(result)}")
                                        
                                        # Check if result contains any errors
                                        updates_count = 0
                                        if hasattr(result, 'updates'):
                                            updates_count = len(result.updates)
                                            logger.info(f"     Updates count: {updates_count}")
                                            if updates_count == 0:
                                                logger.warning(f"     ⚠️ WARNING: EditAdminRequest returned 0 updates!")
                                                logger.warning(f"        This might mean:")
                                                logger.warning(f"        1. User is already admin (will verify)")
                                                logger.warning(f"        2. Telegram hasn't processed the change yet (will wait and verify)")
                                                logger.warning(f"        3. Promotion silently failed (will verify)")
                                            else:
                                                for update in result.updates:
                                                    logger.info(f"       Update type: {type(update).__name__}")
                                                    if hasattr(update, 'message'):
                                                        logger.info(f"         Message: {update.message}")
                                        
                                        # Check for RPC errors in the result
                                        if hasattr(result, 'rpc_error'):
                                            logger.error(f"     RPC Error: {result.rpc_error}")
                                        
                                        # CRITICAL: Wait longer for Telegram to process the promotion
                                        # If 0 updates, wait even longer
                                        wait_time = 8 if updates_count == 0 else 5
                                        logger.info(f"     ⏳ Waiting {wait_time} seconds for Telegram to process promotion...")
                                        await asyncio.sleep(wait_time)
                                        
                                        # Immediately verify after promotion to ensure it worked
                                        logger.info(f"     🔍 Immediate verification after promotion...")
                                        try:
                                            from telethon.tl.functions.channels import GetParticipantRequest
                                            from telethon.tl.types import ChannelParticipantAdmin, ChannelParticipantCreator
                                            
                                            verify_participant = await creator_client.client(GetParticipantRequest(
                                                channel=group_entity,
                                                participant=mod_user_entity
                                            ))
                                            
                                            if isinstance(verify_participant.participant, (ChannelParticipantAdmin, ChannelParticipantCreator)):
                                                rank = getattr(verify_participant.participant, 'rank', 'N/A')
                                                logger.info(f"     ✅ IMMEDIATE VERIFICATION: {phone} (ID: {mod_user_entity.id}) is admin with rank: {rank}")
                                                promotion_success = True
                                                break
                                            else:
                                                logger.warning(f"     ⚠️ IMMEDIATE VERIFICATION FAILED: User is NOT admin yet")
                                                logger.warning(f"        Participant type: {type(verify_participant.participant).__name__}")
                                                if retry < 2:
                                                    logger.info(f"        Will retry promotion...")
                                                    await asyncio.sleep(3)
                                                    continue
                                                else:
                                                    logger.error(f"        ❌ Promotion failed after {retry + 1} attempts")
                                                    promotion_success = False
                                                    break
                                        except Exception as immediate_verify_error:
                                            logger.warning(f"     ⚠️ Could not verify immediately: {immediate_verify_error}")
                                            # Continue anyway - will verify later
                                            promotion_success = True
                                            break
                                    except FloodWaitError as flood_error:
                                        wait_time = flood_error.seconds
                                        logger.warning(f"     ⚠️ RATE LIMITED: Telegram requires {wait_time} seconds wait")
                                        logger.warning(f"     ⏳ Waiting {wait_time} seconds before retrying...")
                                        await asyncio.sleep(wait_time)
                                        
                                        # Retry after waiting
                                        logger.info(f"     🔄 Retrying promotion after rate limit wait...")
                                        result = await creator_client.client(EditAdminRequest(
                                            channel=group_entity,
                                            user_id=mod_user_entity,
                                            admin_rights=admin_rights,
                                            rank="Moderator"
                                        ))
                                        logger.info(f"     ✅ edit_admin() completed successfully after retry")
                                        promotion_success = True
                                        break
                                    except Exception as promote_error:
                                        error_str = str(promote_error).lower()
                                        if 'database is locked' in error_str or 'locked' in error_str:
                                            if retry < 2:
                                                wait_time = (retry + 1) * 2  # 2s, 4s
                                                logger.warning(f"     ⚠️ DATABASE LOCKED: Waiting {wait_time}s and retrying...")
                                                await asyncio.sleep(wait_time)
                                                continue
                                            else:
                                                logger.error(f"     ❌ Database locked after {retry + 1} retries - giving up")
                                                raise promote_error
                                        else:
                                            # Not a lock error - raise immediately
                                            raise promote_error
                                
                                if not promotion_success:
                                    logger.error(f"  ❌ Failed to promote {phone} after retries")
                                    failed_count += 1
                                else:
                                    logger.info(f"  ✅ Successfully promoted {phone} to moderator")
                                    promoted_count += 1
                                    
                                    # CRITICAL: Wait longer for Telegram to fully process the promotion
                                    logger.info(f"     ⏳ Waiting 5 seconds for Telegram to fully process promotion...")
                                    await asyncio.sleep(5)
                                    
                                    # Verify promotion by checking admin list (only if promotion succeeded)
                                    logger.info(f"     Verifying promotion by checking admin list...")
                                    
                                    try:
                                        mod_user_entity = await client.client.get_me()
                                        
                                        # Method 1: Check participant status (most reliable)
                                        from telethon.tl.functions.channels import GetParticipantRequest
                                        from telethon.tl.types import ChannelParticipantAdmin, ChannelParticipantCreator
                                        
                                        participant = await creator_client.client(GetParticipantRequest(
                                            channel=group_entity,
                                            participant=mod_user_entity
                                        ))
                                        
                                        if isinstance(participant.participant, (ChannelParticipantAdmin, ChannelParticipantCreator)):
                                            rank = getattr(participant.participant, 'rank', 'N/A')
                                            logger.info(f"     ✅ VERIFIED (Method 1): {phone} (ID: {mod_user_entity.id}) is now admin with rank: {rank}")
                                        else:
                                            logger.warning(f"     ⚠️ VERIFICATION FAILED (Method 1): {phone} (ID: {mod_user_entity.id}) is NOT admin")
                                            logger.warning(f"        Participant type: {type(participant.participant).__name__}")
                                            
                                            # Method 2: Try checking admin list directly
                                            logger.info(f"     Trying Method 2: Checking admin list directly...")
                                            try:
                                                from telethon.tl.functions.channels import GetFullChannelRequest
                                                full_channel = await creator_client.client(GetFullChannelRequest(group_entity))
                                                
                                                admin_found = False
                                                if hasattr(full_channel, 'full_chat') and hasattr(full_channel.full_chat, 'admins'):
                                                    for admin in full_channel.full_chat.admins:
                                                        if hasattr(admin, 'user_id') and admin.user_id == mod_user_entity.id:
                                                            admin_found = True
                                                            rank = getattr(admin, 'rank', 'N/A')
                                                            logger.info(f"     ✅ VERIFIED (Method 2): {phone} (ID: {mod_user_entity.id}) found in admin list with rank: {rank}")
                                                            break
                                                
                                                if not admin_found:
                                                    logger.error(f"     ❌ VERIFICATION FAILED (Method 2): {phone} (ID: {mod_user_entity.id}) NOT found in admin list")
                                                    logger.error(f"        This means the promotion did NOT work!")
                                                    logger.error(f"        Please check manually in Telegram if the user is now an admin")
                                            except Exception as method2_error:
                                                logger.warning(f"     ⚠️ Method 2 verification failed: {method2_error}")
                                    
                                    except Exception as verify_error:
                                        logger.error(f"     ❌ Could not verify promotion: {verify_error}")
                                        import traceback
                                        logger.error(traceback.format_exc())
                                    
                            except Exception as edit_error:
                                error_str = str(edit_error)
                                logger.error(f"❌ EditAdminRequest FAILED: {error_str}")
                                logger.error(f"     Error type: {type(edit_error).__name__}")
                                import traceback
                                logger.error(f"     Traceback:\n{traceback.format_exc()}")
                                failed_count += 1
                        
                        print("GROUP_ACTION_RESULT:")
                        print(json.dumps({"success": True, "promoted": promoted_count, "failed": failed_count}))
                    
                    else:
                        logger.error(f"❌ Unknown action: {action}")
                        print("GROUP_ACTION_RESULT:")
                        print(json.dumps({"success": False, "error": f"Unknown action: {action}"}))
                    
                finally:
                    # Disconnect all clients
                    for client in clients:
                        try:
                            await client.client.disconnect()
                        except:
                            pass
            
            # Run the async action
            try:
                loop.run_until_complete(run_action())
            except Exception as e:
                logger.error(f"❌ Action failed: {e}")
                import traceback
                logger.error(traceback.format_exc())
                print("GROUP_ACTION_RESULT:")
                print(json.dumps({"success": False, "error": str(e)}))
            
            sys.exit(0)
        
        # Log what we received
        logger.info(f"\n{'='*60}")
        logger.info(f"PYTHON SCRIPT RECEIVED DATA")
        logger.info(f"{'='*60}")
        logger.info(f"scripted_conversations type: {type(scripted_conversations)}")
        logger.info(f"scripted_conversations length: {len(scripted_conversations) if scripted_conversations else 0}")
        if scripted_conversations and len(scripted_conversations) > 0:
            logger.info(f"First conversation ID: {scripted_conversations[0].get('id', 'N/A')}")
            logger.info(f"First conversation participants: {scripted_conversations[0].get('participants', [])}")
        logger.info(f"{'='*60}\n")
        
        if not config_data:
            logger.error("No config provided")
            sys.exit(1)
        
        success = run_campaign(config_data, scripted_conversations)
        sys.exit(0 if success else 1)
        
    except KeyboardInterrupt:
        logger.info("\nCampaign stopped by user")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()


