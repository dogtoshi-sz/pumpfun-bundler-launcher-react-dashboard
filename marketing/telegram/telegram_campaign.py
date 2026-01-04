"""
Telegram Campaign Module - Scripted Conversations Only
Handles Telegram conversation logic using scripted conversations
"""
import threading
import time
import random
import logging
import json
import os
import asyncio
from typing import List, Dict, Optional

from telegram_bot_client import TelegramBotClient
from config import Config

logger = logging.getLogger(__name__)

class TelegramCampaign:
    """Manages Telegram-only conversations using scripted conversations"""
    
    def __init__(self, telegram_clients: List, scripted_conversations: List[Dict] = None, bot_token: str = None):
        """
        Initialize Telegram Campaign Manager
        
        Args:
            telegram_clients: List of TelegramUserClient instances
            scripted_conversations: List of scripted conversation dicts
            bot_token: Telegram bot token (optional, uses config if not provided)
        """
        self.telegram_clients = telegram_clients
        self.active_conversations = {}
        self.scripted_conversations = scripted_conversations or []
        self.used_scripted_conversations = set()
        self.last_scripted_conversation_time = {}
        self.running_scripted_conversations = set()
        # Initialize token info instance variables
        self._token_address = ''
        self._website = ''
        self._telegram = ''
        self._twitter = ''
        self._description = ''
        self._chain = ''
        self._token_name = ''
        self._token_symbol = ''
        
        # Initialize bot client if token provided
        self.bot_client = None
        if bot_token or Config.TELEGRAM_BOT_TOKEN:
            try:
                self.bot_client = TelegramBotClient(bot_token or Config.TELEGRAM_BOT_TOKEN)
                bot_username = self.bot_client.get_bot_username()
                logger.info(f"✅ Telegram bot initialized: @{bot_username}")
            except Exception as e:
                logger.warning(f"⚠️  Failed to initialize bot client: {e}")
                self.bot_client = None
    
    def start_conversation_thread(self, campaign_id: str, direction: str, chat_ids: List[str], 
                                  user_roles: Dict[str, str] = None,
                                  user_is_mod: Dict[str, bool] = None,
                                  token_name: str = None,
                                  token_symbol: str = None,
                                  token_address: str = None,
                                  website: str = None,
                                  telegram: str = None,
                                  twitter: str = None,
                                  docs: str = None,
                                  description: str = None,
                                  chain: str = None):
        """
        Start a conversation in a separate thread (non-blocking)
        
        Args:
            campaign_id: Campaign identifier
            direction: Campaign direction/theme (not used for scripted)
            chat_ids: List of Telegram chat IDs where conversations happen
            user_roles: Dict mapping user identifier to role
            user_is_mod: Dict mapping user identifier to mod status (True/False)
            token_name: Token name for placeholder replacement
            token_symbol: Token symbol for placeholder replacement
            token_address: Token contract address
            website: Website URL
            telegram: Telegram link
            twitter: Twitter link
            docs: Documentation URL
            description: Token description
            chain: Blockchain name
        """
        # Store token info as instance variables for use in scripted conversations
        # CRITICAL: Always update these to ensure latest token info is used
        self._token_name = token_name or ''
        self._token_symbol = token_symbol or ''
        self._token_address = token_address or ''
        self._website = website or ''
        self._telegram = telegram or ''
        self._twitter = twitter or ''
        self._docs = docs or ''
        self._description = description or ''
        self._chain = chain or ''
        
        thread = threading.Thread(
            target=self._start_conversation,
            args=(campaign_id, direction, chat_ids, user_roles, user_is_mod, token_name, token_symbol),
            daemon=True
        )
        thread.start()
        return thread
    
    def _start_conversation(self, campaign_id: str, direction: str, chat_ids: List[str], 
                           user_roles: Dict[str, str] = None,
                           user_is_mod: Dict[str, bool] = None,
                           token_name: str = None,
                           token_symbol: str = None):
        """Start a scripted conversation between multiple Telegram users"""
        if len(self.telegram_clients) < 2:
            logger.warning(f"Campaign {campaign_id}: Need at least 2 Telegram clients for conversations")
            return
        
        user_roles = user_roles or {}
        user_is_mod = user_is_mod or {}
        
        # Store user_roles for role-based matching in scripted conversations
        self._user_roles_map = user_roles
        
        # Use scripted conversations only
        if not self.scripted_conversations:
            logger.warning(f"Campaign {campaign_id}: No scripted conversations available")
            return
        
        current_time = time.time()
        cooldown_period = 300  # 5 minutes cooldown between same scripted conversation
        
        # Filter out conversations that are currently running or used too recently
        available = []
        for scripted in self.scripted_conversations:
            scripted_id = scripted.get('id', f"conv_{len(available)}")
            # Skip if currently running
            if scripted_id in self.running_scripted_conversations:
                continue
            # Skip if used too recently
            last_used = self.last_scripted_conversation_time.get(scripted_id, 0)
            if current_time - last_used < cooldown_period:
                continue
            available.append(scripted)
        
        # If no conversations available, skip
        if not available:
            logger.debug(f"Campaign {campaign_id}: No scripted conversations available (all on cooldown or running)")
            return
        
        # Pick a random available conversation
        scripted = random.choice(available)
        scripted_id = scripted.get('id', f"conv_{time.time()}")
        
        # Mark as running
        self.running_scripted_conversations.add(scripted_id)
        self.last_scripted_conversation_time[scripted_id] = current_time
        
        logger.info(f"Campaign {campaign_id}: Using scripted conversation '{scripted.get('name', scripted_id)}'")
        try:
            # Pass all token info to ensure latest values are used
            # CRITICAL: Use instance variables that were set in start_conversation_thread, not stale values
            self._run_scripted_conversation(
                campaign_id, scripted, chat_ids, 
                token_name or getattr(self, '_token_name', None),
                token_symbol or getattr(self, '_token_symbol', None),
                getattr(self, '_token_address', ''),
                getattr(self, '_website', ''),
                getattr(self, '_telegram', ''),
                getattr(self, '_twitter', ''),
                getattr(self, '_description', ''),
                getattr(self, '_chain', '')
            )
        finally:
            # Remove from running set when done
            self.running_scripted_conversations.discard(scripted_id)
    
    def _run_scripted_conversation(self, campaign_id: str, scripted: Dict, chat_ids: List[str], 
                                   token_name: str = None, token_symbol: str = None,
                                   token_address: str = None, website: str = None,
                                   telegram: str = None, twitter: str = None,
                                   description: str = None, chain: str = None):
        """Run a scripted conversation"""
        try:
            chat_id = random.choice(chat_ids)
            participants = scripted.get('participants', [])
            
            # Role mapping: Support dev, mod, user, user1, user2, bot
            # Scripts can use: 'dev', 'mod', 'user', 'user1', 'user2', 'bot'
            # User config has: 'dev', 'mod', 'user' (or 'community_member' for backward compatibility)
            # user1 and user2 allow distinguishing between two user accounts
            role_mapping = {
                'dev': 'dev',
                'mod': 'mod',
                'user': 'user',  # Generic user role
                'user1': 'user1',  # First user account
                'user2': 'user2',  # Second user account
                # Backward compatibility: map old roles
                'skeptic': 'user',
                'community_member': 'user',
            }
            
            # Create user mapping by phone and by role
            user_map_by_phone = {}
            user_map_by_role = {}
            for client in self.telegram_clients:
                phone = getattr(client, 'phone', None)
                if phone:
                    user_map_by_phone[phone] = client
                    # Map role to phone if we have user_roles
                    if hasattr(self, '_user_roles_map') and phone in self._user_roles_map:
                        role = self._user_roles_map[phone]
                        user_map_by_role[role] = {'phone': phone, 'client': client}
                        logger.debug(f"   Mapped role '{role}' to phone {phone}")
                    else:
                        logger.warning(f"   Phone {phone} not found in user_roles_map")
            
            logger.info(f"   User roles map: {getattr(self, '_user_roles_map', {})}")
            logger.info(f"   Available roles: {list(user_map_by_role.keys())}")
            logger.info(f"   Available phones: {list(user_map_by_phone.keys())}")
            
            # Find participants - support both user_id and role-based
            script_users = {}
            role_to_phone = {}
            
            for participant in participants:
                # Support both formats: user_id-based or role-based
                if 'user_id' in participant:
                    user_id = participant['user_id']
                    if user_id in user_map_by_phone:
                        script_users[user_id] = {
                            'client': user_map_by_phone[user_id],
                            'role': participant.get('role', '')
                        }
                        if participant.get('role'):
                            role_to_phone[participant['role']] = user_id
                elif 'role' in participant:
                    script_role = participant['role']
                    # Map script role to actual role
                    actual_role = role_mapping.get(script_role, script_role)
                    
                    # Try mapped role first, then fallback to script role
                    found = False
                    if actual_role in user_map_by_role:
                        phone = user_map_by_role[actual_role]['phone']
                        script_users[phone] = {
                            'client': user_map_by_role[actual_role]['client'],
                            'role': script_role  # Keep original script role for logging
                        }
                        role_to_phone[script_role] = phone  # Map script role to phone for message lookup
                        logger.info(f"   ✅ Found participant with role '{script_role}' (mapped to '{actual_role}') -> phone {phone}")
                        found = True
                    elif script_role in user_map_by_role:
                        # Fallback: try script role directly
                        phone = user_map_by_role[script_role]['phone']
                        script_users[phone] = {
                            'client': user_map_by_role[script_role]['client'],
                            'role': script_role
                        }
                        role_to_phone[script_role] = phone
                        logger.info(f"   ✅ Found participant with role '{script_role}' -> phone {phone}")
                        found = True
                    elif actual_role == 'user1' or actual_role == 'user2':
                        # user1/user2: Find users with 'user' role from Global Config and assign them sequentially
                        # Global Config uses role='user' for both user accounts, but scripts use user1/user2 to distinguish them
                        # Get all users with 'user' role from user_roles_map (not just user_map_by_role which only has one per role)
                        user_phones = []
                        if hasattr(self, '_user_roles_map'):
                            for phone, role in self._user_roles_map.items():
                                if role == 'user' or role == 'community_member':
                                    if phone in user_map_by_phone:
                                        user_phones.append(phone)
                        
                        # Also check user_map_by_role as fallback
                        if not user_phones:
                            for role_key, user_info in user_map_by_role.items():
                                if role_key == 'user' or role_key == 'community_member':
                                    user_phones.append(user_info['phone'])
                        
                        logger.info(f"   📋 Found {len(user_phones)} user account(s) with role 'user' in Global Config: {[p[:10] + '...' for p in user_phones]}")
                        
                        # Get already assigned phones to avoid duplicates
                        assigned_phones = set(role_to_phone.values())
                        
                        # Find first available user phone not already assigned
                        available_phone = None
                        for phone in user_phones:
                            if phone not in assigned_phones:
                                available_phone = phone
                                break
                        
                        if available_phone:
                            # Find the client for this phone
                            client = user_map_by_phone.get(available_phone)
                            if client:
                                script_users[available_phone] = {
                                    'client': client,
                                    'role': script_role
                                }
                                role_to_phone[script_role] = available_phone
                                logger.info(f"   ✅ Assigned script role '{script_role}' to user account {available_phone[:10]}... (Global Config role: 'user')")
                                found = True
                        else:
                            logger.warning(f"   ⚠️  No available user account for '{script_role}' (all user accounts already assigned or no users with 'user' role found)")
                    
                    elif actual_role == 'user':
                        # Generic 'user' role: try 'user' first, then 'community_member' as fallback
                        if 'user' in user_map_by_role:
                            phone = user_map_by_role['user']['phone']
                            script_users[phone] = {
                                'client': user_map_by_role['user']['client'],
                                'role': script_role
                            }
                            role_to_phone[script_role] = phone
                            logger.info(f"   ✅ Found participant with role '{script_role}' -> phone {phone[:10]}...")
                            found = True
                        elif 'community_member' in user_map_by_role:
                            phone = user_map_by_role['community_member']['phone']
                            script_users[phone] = {
                                'client': user_map_by_role['community_member']['client'],
                                'role': script_role
                            }
                            role_to_phone[script_role] = phone
                            logger.info(f"   ✅ Found participant with role '{script_role}' (using 'community_member' as fallback) -> phone {phone[:10]}...")
                            found = True
                    
                    elif script_role == 'bot':
                        # Bot role: don't need to find a user, bot will handle it
                        script_users['bot'] = {
                            'client': None,  # Bot client is separate
                            'role': 'bot'
                        }
                        role_to_phone['bot'] = 'bot'  # Use 'bot' as identifier
                        logger.info(f"   ✅ Found participant with role 'bot' -> will use bot client")
                        found = True
                    
                    if not found:
                        logger.warning(f"   ❌ Role '{script_role}' (mapped to '{actual_role}') not found in user_map_by_role. Available roles: {list(user_map_by_role.keys())}")
                        # Try to find any available user as fallback for this role
                        # But prefer users that aren't already assigned to avoid conflicts
                        if user_map_by_role:
                            # Get already assigned phones
                            assigned_phones = set(script_users.keys())
                            
                            # Try to find an unassigned user first
                            fallback_role = None
                            fallback_phone = None
                            for role, user_info in user_map_by_role.items():
                                phone = user_info['phone']
                                if phone not in assigned_phones:
                                    fallback_role = role
                                    fallback_phone = phone
                                    break
                            
                            # If all users assigned, use first available (will cause same user to play multiple roles)
                            if not fallback_role:
                                fallback_role = list(user_map_by_role.keys())[0]
                                fallback_phone = user_map_by_role[fallback_role]['phone']
                            
                            script_users[fallback_phone] = {
                                'client': user_map_by_role[fallback_role]['client'],
                                'role': script_role
                            }
                            role_to_phone[script_role] = fallback_phone
                            logger.warning(f"   ⚠️  Using fallback: mapped '{script_role}' to '{fallback_role}' (phone {fallback_phone})")
            
            # Check if we have enough participants (bot counts as a participant)
            # Need at least 2 participants total (can be 1 user + 1 bot, or 2+ users)
            total_participants = len(script_users)
            if total_participants < 2:
                logger.warning(f"Campaign {campaign_id}: Not enough participants for scripted conversation (found {total_participants})")
                return
            
            # Log final role assignments for debugging
            logger.info(f"Campaign {campaign_id}: Role assignments:")
            for script_role, phone in role_to_phone.items():
                user_info = script_users.get(phone, {})
                if phone == 'bot':
                    logger.info(f"   - Script role '{script_role}' → Bot (bot client)")
                else:
                    logger.info(f"   - Script role '{script_role}' → Phone {phone[:10]}... (user role: {user_info.get('role', 'unknown')})")
            
            # Check if all required script roles are assigned
            script_roles_needed = set(p.get('role') for p in participants if 'role' in p)
            script_roles_assigned = set(role_to_phone.keys())
            missing_roles = script_roles_needed - script_roles_assigned
            if missing_roles:
                logger.error(f"Campaign {campaign_id}: ⚠️  MISSING ROLES: Script requires {script_roles_needed}, but only {script_roles_assigned} are assigned. Missing: {missing_roles}")
                logger.error(f"Campaign {campaign_id}: Messages with these roles will be SKIPPED. Ensure you have users with these roles configured and enabled.")
            
            logger.info(f"Campaign {campaign_id}: Starting scripted conversation with {len(script_users)} unique users playing {len(role_to_phone)} script roles")
            
            # Use provided token info or defaults - prioritize function parameters over instance variables
            # CRITICAL: Always use instance variables if parameters are None/empty (they were set in start_conversation_thread)
            final_token_name = token_name or getattr(self, '_token_name', None) or scripted.get('token_name', 'TOKEN')
            final_token_symbol = token_symbol or getattr(self, '_token_symbol', None) or scripted.get('token_symbol', '$TOKEN')
            final_token_address = token_address if token_address else getattr(self, '_token_address', '')
            final_website = website if website else getattr(self, '_website', '')
            final_telegram = telegram if telegram else getattr(self, '_telegram', '')
            final_twitter = twitter if twitter else getattr(self, '_twitter', '')
            final_docs = getattr(self, '_docs', '')  # Docs URL (from RunConfig)
            final_description = description if description else getattr(self, '_description', '')
            final_chain = chain if chain else getattr(self, '_chain', '')
            
            # Log what we're using for debugging
            logger.info(f"Campaign {campaign_id}: Token info - name='{final_token_name}', symbol='{final_token_symbol}', address='{final_token_address[:10]}...' if final_token_address else 'none'")
            
            messages = scripted.get('messages', [])
            start_time = time.time()
            message_ids = {}
            
            for msg_idx, msg_data in enumerate(messages):
                # Support both user_id and role-based message format
                user_id = None
                script_role = None
                if 'user_id' in msg_data:
                    user_id = msg_data['user_id']
                    script_role = msg_data.get('role', None)  # May have role even with user_id
                elif 'role' in msg_data:
                    script_role = msg_data['role']
                    # Apply role mapping for messages too
                    actual_role = role_mapping.get(script_role, script_role)
                    
                    logger.debug(f"Campaign {campaign_id}: Message {msg_idx} - Looking for role '{script_role}' (mapped to '{actual_role}'). Available roles: {list(role_to_phone.keys())}")
                    
                    # Try mapped role first, then script role
                    if script_role == 'bot':
                        # Bot role: use 'bot' as identifier
                        user_id = 'bot'
                        logger.debug(f"Campaign {campaign_id}: Found 'bot' role -> will use bot client")
                    elif script_role in role_to_phone:
                        user_id = role_to_phone[script_role]
                        logger.debug(f"Campaign {campaign_id}: Found '{script_role}' in role_to_phone -> {user_id[:10]}...")
                    elif actual_role in role_to_phone:
                        user_id = role_to_phone[actual_role]
                        logger.debug(f"Campaign {campaign_id}: Found '{actual_role}' (mapped from '{script_role}') in role_to_phone -> {user_id[:10]}...")
                    elif actual_role == 'user' and 'community_member' in role_to_phone:
                        # Special handling: if 'user' role not found, try 'community_member' (backward compatibility)
                        user_id = role_to_phone['community_member']
                        logger.debug(f"Campaign {campaign_id}: Using 'community_member' for 'user' role message")
                    else:
                        logger.error(f"Campaign {campaign_id}: ❌ Role '{script_role}' (mapped to '{actual_role}') not found in role_to_phone. Available roles: {list(role_to_phone.keys())}. Message text: {msg_data.get('text', '')[:50]}...")
                        logger.error(f"Campaign {campaign_id}: This message will be SKIPPED. Check that you have a user with role '{actual_role}' configured and enabled.")
                        continue
                else:
                    logger.warning(f"Campaign {campaign_id}: Message {msg_idx} missing both 'user_id' and 'role'")
                    continue
                
                text = msg_data.get('text', '')
                # Ensure text is a Unicode string (Python 3 strings are Unicode by default, but ensure it's not bytes)
                if isinstance(text, bytes):
                    text = text.decode('utf-8', errors='replace')
                elif not isinstance(text, str):
                    text = str(text)
                
                # Fix encoding issues: replace problematic characters
                # Replace curly quotes/apostrophes with straight ones
                text = text.replace('\u2018', "'")  # Left single quotation mark
                text = text.replace('\u2019', "'")  # Right single quotation mark
                text = text.replace('\u201C', '"')  # Left double quotation mark
                text = text.replace('\u201D', '"')  # Right double quotation mark
                text = text.replace('\u2013', '-')  # En dash
                text = text.replace('\u2014', '-')  # Em dash
                text = text.replace('\u2026', '...')  # Ellipsis
                
                # Replace all token placeholders - use function parameters first, then instance variables
                # This ensures we use the latest token info from the current campaign
                text = text.replace('{token_name}', final_token_name)
                text = text.replace('{token_symbol}', final_token_symbol)
                text = text.replace('{token_address}', final_token_address)
                text = text.replace('{website}', final_website)
                text = text.replace('{telegram}', final_telegram)
                text = text.replace('{twitter}', final_twitter)
                text = text.replace('{docs}', final_docs)
                text = text.replace('{description}', final_description)
                text = text.replace('{chain}', final_chain)
                
                typing_delay = msg_data.get('typing_delay', len(text) / 10.0)
                delay_after = msg_data.get('delay_after', 2.0)
                reply_to_index = msg_data.get('reply_to', None)
                
                # Check if this is a bot message (ONLY bot role, NOT dev role)
                # Dev role messages should ALWAYS be sent by the DEV user account (Telethon), not the bot
                is_bot_message = False
                if script_role == 'bot' and self.bot_client:
                    is_bot_message = True
                    logger.info(f"Campaign {campaign_id}: Message {msg_idx} will be sent by bot (bot role)")
                # REMOVED: Dev role should NEVER use bot - always use DEV user account
                # elif script_role == 'dev' and self.bot_client:
                #     is_bot_message = True
                #     logger.info(f"Campaign {campaign_id}: Message {msg_idx} will be sent by bot (dev role - backward compat)")
                
                # For bot messages, skip user validation
                if not is_bot_message:
                    if user_id not in script_users:
                        logger.warning(f"Campaign {campaign_id}: User {user_id} not found for scripted message {msg_idx}. Skipping this message entirely to preserve conversation flow.")
                        # Skip this message entirely - don't reassign to another user (breaks immersion)
                        continue
                    client = script_users[user_id]['client']
                else:
                    client = None  # Bot client is separate
                
                # Get reply_to message_id if specified
                reply_to_message_id = None
                if reply_to_index is not None and reply_to_index in message_ids:
                    reply_to_message_id = message_ids[reply_to_index]
                
                # Send message with typing indicator
                try:
                    # Add small delay before sending to reduce database lock contention
                    # This helps when multiple users are sending messages concurrently
                    if msg_idx > 0:
                        time.sleep(0.5)  # 500ms delay between messages from different users (reduces database lock conflicts)
                    
                    if is_bot_message:
                        # Send via bot API
                        if not self.bot_client:
                            logger.error(f"Campaign {campaign_id}: Bot client not initialized, cannot send bot message")
                            continue
                        
                        result = self.bot_client.send_message_with_typing(
                            chat_id=chat_id,
                            text=text,
                            typing_duration=typing_delay,
                            reply_to_message_id=reply_to_message_id
                        )
                        
                        # Store message_id for potential replies
                        if result and result.get('message_id'):
                            message_ids[msg_idx] = result['message_id']
                        
                        logger.info(f"Campaign {campaign_id}: Bot sent: {text[:50]}..." + (f" (replying to msg {reply_to_index})" if reply_to_index is not None else ""))
                    else:
                        # Send via user client
                        if not client:
                            logger.error(f"Campaign {campaign_id}: Client not found for user_id {user_id}, skipping message")
                            continue
                        
                        result = client.send_message(
                            text,
                            chat_ids=[chat_id],
                            show_typing=True,
                            typing_duration=typing_delay,
                            reply_to=reply_to_message_id
                        )
                        
                        # Store message_id for potential replies
                        if result.get('success') and result.get('message_id'):
                            message_ids[msg_idx] = result['message_id']
                        
                        logger.info(f"Campaign {campaign_id}: {user_id[:10]}... sent: {text[:50]}..." + (f" (replying to msg {reply_to_index})" if reply_to_index is not None else ""))
                    
                    # Wait after message
                    if delay_after > 0:
                        time.sleep(delay_after)
                
                except Exception as e:
                    logger.error(f"Campaign {campaign_id}: Error sending scripted message {msg_idx} {'from bot' if is_bot_message else f'from {user_id[:10]}...'}: {e}")
                    # Skip this message entirely - don't retry with another user (breaks immersion)
                    continue
            
            elapsed = time.time() - start_time
            logger.info(f"Campaign {campaign_id}: Scripted conversation completed in {elapsed:.1f}s")
        
        except Exception as e:
            logger.error(f"Campaign {campaign_id}: Error running scripted conversation: {e}")
            import traceback
            logger.error(traceback.format_exc())

