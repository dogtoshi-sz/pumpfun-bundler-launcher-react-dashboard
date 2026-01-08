import logging
from telethon import TelegramClient
from telethon.tl.functions.messages import SendMessageRequest, DeleteMessagesRequest
from telethon.tl.functions.channels import CreateChannelRequest, EditPhotoRequest, InviteToChannelRequest, EditAdminRequest, EditTitleRequest, UpdateUsernameRequest as UpdateChannelUsernameRequest
from telethon.tl.functions.messages import CreateChatRequest, EditChatPhotoRequest
from telethon.tl.functions.photos import UploadProfilePhotoRequest, DeletePhotosRequest
from telethon.tl.functions.account import UpdateProfileRequest, UpdateUsernameRequest
from telethon.tl.types import InputFile
from telethon.tl.types import InputPeerChannel, InputPeerChat, InputPeerUser, SendMessageTypingAction, InputChatPhoto, InputChatUploadedPhoto
from telethon.tl.types import ChannelParticipantsAdmins, ChatAdminRights
from config import Config
import asyncio
import os
from datetime import datetime

logger = logging.getLogger(__name__)

class TelegramUserClient:
    """
    Telegram User Account Client (not Bot API)
    Uses Telethon to connect as a real user account
    """
    
    def __init__(self, api_id=None, api_hash=None, phone=None, session_name=None, personality=None, user_tag=None):
        """
        Initialize Telegram User Client
        
        Args:
            api_id: Telegram API ID (from https://my.telegram.org/apps)
            api_hash: Telegram API Hash
            phone: Phone number with country code (e.g., +1234567890)
            session_name: Session file name (default: 'user_session')
            personality: Personality description (DEPRECATED - not used for scripts)
            user_tag: User tag/name like "dev", "mod", "user1" (for logging/identification)
        """
        self.api_id = api_id or Config.TELEGRAM_API_ID
        self.api_hash = api_hash or Config.TELEGRAM_API_HASH
        self.phone = phone or Config.TELEGRAM_PHONE_NUMBER
        self.session_name = session_name or Config.TELEGRAM_SESSION_NAME
        
        # Get user tag/name from config if not provided
        if user_tag is None and self.phone:
            self.user_tag = Config.TELEGRAM_USER_NAMES.get(self.phone, self.phone)
        else:
            self.user_tag = user_tag or (self.phone if self.phone else "unknown")
        
        # Get personality from config if not provided (DEPRECATED - kept for backward compatibility)
        if personality is None and self.phone:
            self.personality = Config.TELEGRAM_USER_PERSONALITIES.get(self.phone, "Friendly, conversational, authentic")
        else:
            self.personality = personality or "Friendly, conversational, authentic"
        
        if not self.api_id or not self.api_hash:
            raise ValueError("Telegram API ID and API Hash are required. Get them from https://my.telegram.org/apps")
        
        if not self.phone:
            raise ValueError("Phone number is required for user account authentication")
        
        # Convert api_id to int if it's a string
        try:
            self.api_id = int(self.api_id)
        except (ValueError, TypeError):
            raise ValueError(f"Invalid API ID: {self.api_id}")
        
        # Initialize client lazily - don't create it here to avoid event loop issues
        # Client will be created on first connect()
        self._client = None
        self._connected = False
        self._event_loop = None  # Store the event loop for thread-safe access
        
        logger.info(f"Telegram User Client initialized: [{self.user_tag}] {self.phone} (client will connect on first use)")
    
    @property
    def client(self):
        """Lazy initialization of TelegramClient to avoid event loop issues"""
        if self._client is None:
            self._client = TelegramClient(self.session_name, self.api_id, self.api_hash)
        return self._client
    
    async def connect(self, max_retries=5, retry_delay=1):
        """Connect to Telegram with retry logic for database locked errors"""
        if not self._connected:
            last_error = None
            for attempt in range(max_retries):
                try:
                    await self.client.connect()
                    break  # Success, exit retry loop
                except Exception as e:
                    error_msg = str(e).lower()
                    if "database is locked" in error_msg or "locked" in error_msg:
                        last_error = e
                        if attempt < max_retries - 1:
                            wait_time = retry_delay * (2 ** attempt)  # Exponential backoff
                            logger.warning(f"Database locked for [{self.user_tag}] {self.phone}, retrying in {wait_time}s (attempt {attempt + 1}/{max_retries})...")
                            await asyncio.sleep(wait_time)
                            continue
                        else:
                            logger.error(f"Failed to connect [{self.user_tag}] {self.phone} after {max_retries} attempts: database locked")
                            raise Exception(f"Database locked for {self.phone} after {max_retries} attempts. Another process may be using the session file.")
                    else:
                        # Not a database locked error, raise immediately
                        raise
            
            if not await self.client.is_user_authorized():
                logger.warning(f"User not authorized. Starting authentication for [{self.user_tag}] {self.phone}")
                # Use ASCII-safe characters for Windows compatibility
                print(f"\n{'='*60}")
                print(f"TELEGRAM AUTHENTICATION REQUIRED")
                print(f"{'='*60}")
                print(f"User: [{self.user_tag}]")
                print(f"Phone: {self.phone}")
                print(f"Code will be sent to your Telegram app")
                print(f"{'='*60}\n")
                
                # This will send a code to the phone number
                try:
                    await self.client.send_code_request(self.phone)
                    print("[OK] Code sent! Check your Telegram app for the code.\n")
                    print("Waiting for code input...")
                    
                    # Try to read code with better error handling
                    # When called from Node.js, stdin is not available, so skip interactive auth
                    try:
                        import sys
                        # Check if stdin is available and is a TTY (interactive terminal)
                        if not sys.stdin.isatty():
                            raise EOFError("Not running in interactive terminal - cannot read verification code")
                        code = input(f'Enter the code you received: ')
                        if not code or not code.strip():
                            raise ValueError("No code entered")
                    except (EOFError, KeyboardInterrupt) as e:
                        error_msg = str(e)
                        print(f"\n[ERROR] Could not read code from input. Make sure you're running this script directly in a terminal.")
                        if "Not running in interactive terminal" in error_msg:
                            print(f"[INFO] This account needs verification. Please verify it first using the Verify button in the Telegram Group Creator node.")
                        raise ValueError(f"Could not read code: {str(e)}")
                    
                    code = code.strip()
                    await self.client.sign_in(self.phone, code)
                    
                    # Check if 2FA password is needed
                    if await self.client.is_user_authorized():
                        print("\n[OK] Successfully authenticated! Session saved.\n")
                        logger.info("Successfully authenticated!")
                    else:
                        # Try to get 2FA password
                        print("\n[INFO] 2FA password required.")
                        try:
                            password = input('Enter your 2FA password: ')
                            await self.client.sign_in(password=password)
                            print("\n[OK] Successfully authenticated with 2FA! Session saved.\n")
                            logger.info("Successfully authenticated with 2FA!")
                        except Exception as e2:
                            logger.error(f"2FA authentication failed: {e2}")
                            print(f"\n[ERROR] 2FA authentication failed: {e2}\n")
                            raise ValueError(f"2FA authentication failed: {str(e2)}")
                            
                except Exception as e:
                    error_msg = str(e)
                    logger.error(f"Authentication failed: {error_msg}")
                    print(f"\n[ERROR] Authentication failed: {error_msg}\n")
                    # Don't raise if it's just an input issue - let user retry
                    if "EOF" in error_msg or "read" in error_msg.lower():
                        print("[INFO] To fix: Run this script directly in a terminal (not through Node.js)")
                    raise ValueError(f"Authentication failed: {error_msg}")
            else:
                logger.info("Using existing session")
            # Store the event loop for thread-safe access (only if we're in an event loop)
            try:
                self._event_loop = asyncio.get_running_loop()
            except RuntimeError:
                # No running loop, try to get the current one
                try:
                    self._event_loop = asyncio.get_event_loop()
                except RuntimeError:
                    # No event loop at all, that's okay - we'll use the one from run_campaign
                    self._event_loop = None
            self._connected = True
            logger.info("Telegram User Client connected")
    
    async def _ensure_connected(self):
        """Ensure client is connected with retry logic for database locked errors"""
        try:
            if not self._connected:
                await self.connect(max_retries=3, retry_delay=0.5)
            elif not self.client.is_connected():
                # Reconnect if disconnected
                try:
                    await self.client.connect()
                    self._connected = True
                except Exception as e:
                    error_msg = str(e).lower()
                    if "database is locked" in error_msg or "locked" in error_msg:
                        logger.warning(f"Database locked during reconnect for {self.phone}, retrying...")
                        await asyncio.sleep(1)
                        await self.client.connect()
                        self._connected = True
                    else:
                        raise
        except Exception as e:
            error_msg = str(e).lower()
            if "database is locked" in error_msg or "locked" in error_msg:
                logger.warning(f"Connection check failed for {self.phone} (database locked), retrying: {e}")
                await asyncio.sleep(1)
                try:
                    await self.connect(max_retries=3, retry_delay=0.5)
                except Exception as e2:
                    logger.error(f"Reconnection failed for {self.phone}: {e2}")
                    raise
            else:
                logger.warning(f"Connection check failed for {self.phone}, reconnecting: {e}")
                try:
                    await self.connect(max_retries=3, retry_delay=0.5)
                except Exception as e2:
                    logger.error(f"Reconnection failed for {self.phone}: {e2}")
                    raise
    
    def _get_peer(self, chat_id):
        """
        Convert chat_id to InputPeer
        
        Args:
            chat_id: Chat ID (can be int or string)
            
        Returns:
            InputPeer object
        """
        chat_id = int(chat_id)
        
        # Try to get entity from cache
        try:
            entity = self.client.get_entity(chat_id)
            return entity
        except:
            # If not in cache, construct based on chat_id format
            if chat_id < 0:
                # Group/channel (negative)
                if abs(chat_id) > 1000000000000:
                    # Channel
                    return InputPeerChannel(channel_id=abs(chat_id) - 1000000000000, access_hash=0)
                else:
                    # Group
                    return InputPeerChat(chat_id=abs(chat_id))
            else:
                # User
                return InputPeerUser(user_id=chat_id, access_hash=0)
    
    async def send_message_async(self, text, chat_id=None, chat_ids=None, show_typing=False, typing_duration=2, reply_to=None):
        """
        Send a message asynchronously
        
        Args:
            text: Message text (must be Unicode string for proper emoji handling)
            chat_id: Single chat ID
            chat_ids: List of chat IDs
            show_typing: Show typing indicator
            typing_duration: Duration for typing indicator
            reply_to: Message ID to reply to (for quoting/replying)
            
        Returns:
            dict with success status and message_id
        """
        try:
            # Ensure text is a Unicode string (Python 3 strings are Unicode by default, but ensure it's not bytes)
            if isinstance(text, bytes):
                text = text.decode('utf-8', errors='replace')
            elif not isinstance(text, str):
                text = str(text)
            
            await self._ensure_connected()
            
            # Determine target chat IDs
            if chat_ids:
                if isinstance(chat_ids, list):
                    target_chat_ids = chat_ids
                elif isinstance(chat_ids, str):
                    target_chat_ids = [cid.strip() for cid in chat_ids.split(',') if cid.strip()]
                else:
                    target_chat_ids = [chat_ids]
            elif chat_id:
                target_chat_ids = [chat_id]
            else:
                return {
                    'success': False,
                    'error': 'No chat ID provided'
                }
            
            results = []
            errors = []
            
            for target_chat_id in target_chat_ids:
                try:
                    # Get peer entity once - this will fail if user hasn't joined the chat
                    try:
                        peer = await self.client.get_entity(int(target_chat_id))
                    except (ValueError, TypeError) as ve:
                        # More helpful error message for entity not found
                        error_msg = (
                            f"Could not find chat/channel with ID {target_chat_id}. "
                            f"This usually means:\n"
                            f"1. The user account ({self.phone}) has not joined this channel/group\n"
                            f"2. The chat ID is incorrect\n"
                            f"3. The account doesn't have permission to access the chat\n\n"
                            f"To fix: Make sure the Telegram account {self.phone} has joined the channel/group "
                            f"before running the campaign."
                        )
                        logger.error(error_msg)
                        raise ValueError(error_msg) from ve
                    except Exception as e:
                        # Catch any other Telethon exceptions related to entity not found
                        if "entity" in str(e).lower() or "peer" in str(e).lower():
                            error_msg = (
                                f"Could not access chat/channel with ID {target_chat_id}. "
                                f"Error: {str(e)}\n\n"
                                f"This usually means the user account ({self.phone}) has not joined this channel/group. "
                                f"Please join the channel/group with this account before running the campaign."
                            )
                            logger.error(error_msg)
                            raise ValueError(error_msg) from e
                        raise
                    
                    # Show typing indicator if requested
                    if show_typing:
                        import random
                        import asyncio
                        from telethon.tl.functions.messages import SetTypingRequest
                        # Keep typing indicator active - send typing indicator in chunks
                        chunk_duration = 4.5  # Telegram typing indicator expires after ~5 seconds
                        actual_duration = typing_duration * random.uniform(0.9, 1.1)  # Less variance for consistency
                        remaining_duration = actual_duration
                        
                        # Send typing indicator continuously until duration is reached
                        while remaining_duration > 0:
                            # Send typing indicator
                            await self.client(SetTypingRequest(peer=peer, action=SendMessageTypingAction()))
                            # Sleep for chunk duration or remaining time, whichever is smaller
                            sleep_time = min(chunk_duration, remaining_duration)
                            await asyncio.sleep(sleep_time)
                            remaining_duration -= sleep_time
                    
                    # Send message with optional reply (with retry for database locked errors)
                    max_send_retries = 3
                    send_success = False
                    message = None
                    for send_attempt in range(max_send_retries):
                        try:
                            if reply_to:
                                message = await self.client.send_message(peer, text, reply_to=reply_to)
                            else:
                                message = await self.client.send_message(peer, text)
                            send_success = True
                            break  # Success, exit retry loop
                        except Exception as send_error:
                            error_msg = str(send_error).lower()
                            if ("database is locked" in error_msg or "locked" in error_msg) and send_attempt < max_send_retries - 1:
                                wait_time = 1.0 * (2 ** send_attempt)  # Exponential backoff: 1s, 2s, 4s
                                logger.warning(f"Database locked during send for {self.phone}, retrying in {wait_time}s (attempt {send_attempt + 1}/{max_send_retries})...")
                                await asyncio.sleep(wait_time)
                                # Also try to reconnect if database was locked
                                try:
                                    if not self.client.is_connected():
                                        await self.client.connect()
                                except:
                                    pass  # Ignore reconnect errors, just wait and retry
                                continue
                            else:
                                # Not a database locked error or max retries reached, raise
                                raise
                    
                    if not send_success or not message:
                        raise Exception(f"Failed to send message after {max_send_retries} attempts")
                    
                    results.append({
                        'chat_id': str(target_chat_id),
                        'message_id': message.id,
                        'text': message.text
                    })
                    logger.info(f"User account sent message to {target_chat_id}" + (f" (replying to {reply_to})" if reply_to else ""))
                    
                    # Return message_id for potential replies
                    last_message_id = message.id
                    
                except Exception as e:
                    error_msg = str(e).lower()
                    # Don't log database locked errors as errors - they're handled by retry logic
                    if "database is locked" not in error_msg and "locked" not in error_msg:
                        logger.error(f"Error sending message to {target_chat_id}: {e}")
                        errors.append(f"Chat {target_chat_id}: {str(e)}")
                    else:
                        # Database locked errors are handled by retry logic, just log as warning
                        logger.warning(f"Database locked for {self.phone} when sending to {target_chat_id} (will retry)")
            
            if results:
                return {
                    'success': True,
                    'results': results,
                    'message_id': results[-1].get('message_id') if results else None,  # Return last message ID for replies
                    'errors': errors if errors else None
                }
            else:
                return {
                    'success': False,
                    'error': '; '.join(errors) if errors else 'Failed to send message'
                }
                
        except Exception as e:
            logger.error(f"Telegram User Client error: {str(e)}")
            return {
                'success': False,
                'error': f'Failed to send message: {str(e)}'
            }
    
    def send_message(self, text, chat_id=None, chat_ids=None, show_typing=False, typing_duration=2, reply_to=None):
        """
        Send a message (synchronous wrapper)
        
        Args:
            text: Message text
            chat_id: Single chat ID
            chat_ids: List of chat IDs
            show_typing: Show typing indicator
            typing_duration: Duration for typing indicator
            reply_to: Message ID to reply to (for quoting/replying)
            
        Returns:
            dict with success status and message_id
        """
        # Use the stored event loop if available (for thread-safe access)
        if self._event_loop and self._event_loop.is_running():
            # If loop is running, use run_coroutine_threadsafe to schedule in the original loop
            future = asyncio.run_coroutine_threadsafe(
                self.send_message_async(text, chat_id, chat_ids, show_typing, typing_duration, reply_to),
                self._event_loop
            )
            return future.result(timeout=30)
        else:
            # Use stored loop or get/create one
            try:
                loop = self._event_loop if self._event_loop else asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            
            return loop.run_until_complete(
                self.send_message_async(text, chat_id, chat_ids, show_typing, typing_duration, reply_to)
            )
    
    async def create_group_async(self, title, description=None, photo_path=None, is_channel=False, is_megagroup=True):
        """
        Create a new Telegram group or channel
        
        Args:
            title: Group/channel title (supports {token_name} placeholder)
            description: Group/channel description
            photo_path: Path to photo file for group/channel logo
            is_channel: If True, create a channel; if False, create a group
            is_megagroup: If True and is_channel=True, create a megagroup (supergroup)
            
        Returns:
            dict with success status and chat_id
        """
        try:
            await self._ensure_connected()
            
            # Create channel/group
            if is_channel:
                result = await self.client(CreateChannelRequest(
                    title=title,
                    about=description or '',
                    megagroup=is_megagroup,
                    broadcast=not is_megagroup
                ))
            else:
                # For regular groups, we need to use CreateChatRequest
                # But CreateChatRequest requires user IDs, so we'll create a channel megagroup instead
                result = await self.client(CreateChannelRequest(
                    title=title,
                    about=description or '',
                    megagroup=True,
                    broadcast=False
                ))
            
            # Get the created chat entity
            created_chat = result.chats[0]
            chat_id = created_chat.id
            
            # Set photo if provided
            if photo_path and os.path.exists(photo_path):
                try:
                    photo = await self.client.upload_file(photo_path)
                    if is_channel or is_megagroup:
                        await self.client(EditPhotoRequest(
                            channel=await self.client.get_entity(chat_id),
                            photo=InputChatUploadedPhoto(file=photo)
                        ))
                    else:
                        await self.client(EditChatPhotoRequest(
                            chat_id=chat_id,
                            photo=InputChatUploadedPhoto(file=photo)
                        ))
                    logger.info(f"Set group/channel photo: {photo_path}")
                    
                    # Delete system message about photo update (exposes creator)
                    try:
                        await asyncio.sleep(1)  # Wait a moment for message to appear
                        await self.delete_recent_system_messages_async(chat_id, limit=5)
                    except Exception as e:
                        logger.warning(f"Failed to delete system messages after photo update: {e}")
                except Exception as e:
                    logger.warning(f"Failed to set photo: {e}")
            
            # Description is already set during channel creation via CreateChannelRequest's 'about' parameter
            # No need to set it again after creation
            
            # Delete system message about group creation (exposes creator)
            try:
                await asyncio.sleep(1)  # Wait a moment for message to appear
                await self.delete_recent_system_messages_async(chat_id, limit=5)
            except Exception as e:
                logger.warning(f"Failed to delete system messages after group creation: {e}")
            
            logger.info(f"Created {'channel' if is_channel else 'group'}: {title} (ID: {chat_id})")
            
            return {
                'success': True,
                'chat_id': chat_id,
                'title': title,
                'invite_link': None  # Can be generated later if needed
            }
            
        except Exception as e:
            logger.error(f"Error creating group/channel: {e}")
            return {
                'success': False,
                'error': str(e)
            }
    
    async def configure_group_settings_async(self, chat_id, settings):
        """
        Configure group/channel settings using Telethon API
        
        Args:
            chat_id: Chat ID to configure
            settings: Dict with settings:
                - title: Group/channel title (uses EditTitleRequest)
                - description: Group/channel description/about (uses EditAboutRequest)
                - username: Public username without @ (for channels, uses UpdateChannelUsernameRequest)
                - photo_path: Path to photo file (uses EditPhotoRequest)
                - slow_mode: Slow mode delay in seconds (future: uses ToggleSlowModeRequest)
                - linked_chat: Linked discussion group ID (future: uses SetDiscussionGroupRequest)
        
        Returns:
            dict with success status
        """
        try:
            await self._ensure_connected()
            entity = await self.client.get_entity(chat_id)
            
            # Update title if provided
            if 'title' in settings and settings['title']:
                try:
                    await self.client(EditTitleRequest(
                        channel=entity,
                        title=settings['title']
                    ))
                    logger.info(f"Updated group/channel title to: {settings['title']}")
                except Exception as e:
                    logger.warning(f"Failed to update title: {e}")
            
            # Update description/about if provided
            # Note: Telethon doesn't have a direct EditChannelRequest for updating description
            # Description should be set during channel creation via CreateChannelRequest's 'about' parameter
            # For updates, we would need to recreate the channel or use a different approach
            if 'description' in settings and settings['description']:
                logger.warning("Updating channel description after creation is not directly supported by Telethon. Description should be set during channel creation.")
            
            # Update username if provided (channels only)
            # Note: UpdateUsernameRequest works for both channels and user accounts
            if 'username' in settings and settings['username']:
                try:
                    username = settings['username'].lstrip('@')
                    # For channels, use UpdateChannelUsernameRequest
                    await self.client(UpdateChannelUsernameRequest(
                        channel=entity,
                        username=username
                    ))
                    logger.info(f"Updated channel username to: @{username}")
                except Exception as e:
                    logger.warning(f"Failed to update username (may require channel admin rights): {e}")
            
            # Update photo if provided
            if 'photo_path' in settings and settings['photo_path']:
                photo_path = settings['photo_path']
                if os.path.exists(photo_path):
                    try:
                        photo = await self.client.upload_file(photo_path)
                        await self.client(EditPhotoRequest(
                            channel=entity,
                            photo=InputChatUploadedPhoto(file=photo)
                        ))
                        logger.info(f"Updated group/channel photo: {photo_path}")
                        
                        # Delete system message about photo update (exposes creator)
                        try:
                            await asyncio.sleep(1)  # Wait a moment for message to appear
                            await self.delete_recent_system_messages_async(chat_id, limit=5)
                        except Exception as e:
                            logger.warning(f"Failed to delete system messages after photo update: {e}")
                    except Exception as e:
                        logger.warning(f"Failed to update photo: {e}")
                else:
                    logger.warning(f"Photo file not found: {photo_path}")
            
            # TODO: Add support for:
            # - slow_mode: ToggleSlowModeRequest
            # - linked_chat: SetDiscussionGroupRequest
            # - permissions: EditChatDefaultBannedRightsRequest
            # - etc.
            
            logger.info(f"Configured settings for chat {chat_id}")
            return {'success': True}
            
        except Exception as e:
            logger.error(f"Error configuring group settings: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return {'success': False, 'error': str(e)}
    
    async def delete_recent_system_messages_async(self, chat_id, limit=5):
        """
        Delete recent system messages (like "created group" or "updated photo") to hide creator identity
        
        Args:
            chat_id: Chat ID to delete messages from
            limit: Maximum number of recent messages to check (default: 5)
            
        Returns:
            Number of messages deleted
        """
        try:
            await self._ensure_connected()
            entity = await self.client.get_entity(chat_id)
            
            # Get recent messages
            messages = await self.client.get_messages(entity, limit=limit)
            
            deleted_count = 0
            message_ids = []
            
            # Find system messages (action messages)
            for msg in messages:
                # Check if it's a service/action message (system message)
                if hasattr(msg, 'action') and msg.action is not None:
                    # Check if it's a group creation or photo update message
                    action_type = type(msg.action).__name__
                    if 'ChatCreated' in action_type or 'Photo' in action_type:
                        message_ids.append(msg.id)
                        deleted_count += 1
            
            # Delete the system messages
            if message_ids:
                try:
                    await self.client(DeleteMessagesRequest(
                        peer=entity,
                        id=message_ids,
                        revoke=True  # Delete for everyone
                    ))
                    logger.info(f"Deleted {deleted_count} system message(s) from chat {chat_id}")
                except Exception as e:
                    logger.warning(f"Failed to delete some system messages: {e}")
            
            return deleted_count
            
        except Exception as e:
            logger.warning(f"Failed to delete system messages: {e}")
            return 0
    
    async def message_safeguard_bot_async(self, command: str, safeguard_bot_username: str = '@safeguard'):
        """
        Send a command message to Safeguard bot
        
        Args:
            command: Command string to send (e.g., "/create_portal ...")
            safeguard_bot_username: Safeguard bot username (default: @safeguard_bot)
            
        Returns:
            dict with success status and response
        """
        try:
            await self._ensure_connected()
            
            # Get safeguard bot entity
            bot_entity = await self.client.get_entity(safeguard_bot_username)
            
            # Send command message
            sent_message = await self.client.send_message(bot_entity, command)
            
            logger.info(f"Sent safeguard bot command: {command}")
            
            # Wait a bit for bot response (optional - can be removed if not needed)
            await asyncio.sleep(2)
            
            # Try to get bot's response (optional)
            try:
                async for message in self.client.iter_messages(bot_entity, limit=1):
                    if message.sender_id == bot_entity.id:
                        logger.info(f"Safeguard bot response: {message.text}")
                        return {
                            'success': True,
                            'command': command,
                            'response': message.text if hasattr(message, 'text') else None,
                            'message_id': sent_message.id
                        }
            except Exception as e:
                logger.debug(f"Could not get bot response: {e}")
            
            return {
                'success': True,
                'command': command,
                'message_id': sent_message.id
            }
            
        except Exception as e:
            logger.error(f"Error messaging safeguard bot: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return {
                'success': False,
                'error': str(e)
            }
    
    def message_safeguard_bot(self, command: str, safeguard_bot_username: str = '@safeguard'):
        """Synchronous wrapper for message_safeguard_bot_async"""
        if self._event_loop and self._event_loop.is_running():
            future = asyncio.run_coroutine_threadsafe(
                self.message_safeguard_bot_async(command, safeguard_bot_username),
                self._event_loop
            )
            return future.result(timeout=60)
        else:
            try:
                loop = self._event_loop if self._event_loop else asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            return loop.run_until_complete(
                self.message_safeguard_bot_async(command, safeguard_bot_username)
            )
    
    async def setup_safeguard_portal_interactive_async(
        self,
        group_chat_id: str,
        channel_chat_id: str,
        safeguard_bot_username: str = '@safeguard'
    ):
        """
        Interactive Safeguard portal setup flow:
        1. Send /setup to @safeguard
        2. Click "Select a Group" button
        3. Select the group we created
        4. Click "Select a channel" button
        5. Select the channel we created
        6. Click "Create Portal" button
        
        Args:
            group_chat_id: Chat ID of the private group we created
            channel_chat_id: Chat ID of the public channel we created
            safeguard_bot_username: Safeguard bot username (default: @safeguard)
            
        Returns:
            dict with success status and portal info
        """
        try:
            await self._ensure_connected()
            
            # Get safeguard bot entity
            bot_entity = await self.client.get_entity(safeguard_bot_username)
            
            logger.info(f"Starting Safeguard portal setup flow...")
            logger.info(f"  - Group ID: {group_chat_id}")
            logger.info(f"  - Channel ID: {channel_chat_id}")
            
            # STEP 1: Send /setup command
            logger.info("STEP 1: Sending /setup command to Safeguard bot...")
            setup_message = await self.client.send_message(bot_entity, "/setup")
            logger.info(f"✅ Sent /setup command (message ID: {setup_message.id})")
            await asyncio.sleep(5)  # Increased wait time for bot response
            
            # STEP 2: Get bot's response and find "Select a Group" button
            logger.info("STEP 2: Waiting for bot response and finding 'Select a Group' button...")
            bot_message = None
            max_attempts = 20  # Increased attempts
            for attempt in range(max_attempts):
                logger.info(f"Attempt {attempt + 1}/{max_attempts}: Checking for bot messages...")
                async for message in self.client.iter_messages(bot_entity, limit=20):  # Increased limit
                    if message.sender_id == bot_entity.id:
                        msg_text = message.text[:100] if message.text else ''
                        logger.info(f"  Found bot message (ID: {message.id}): {msg_text}...")
                        # Check if message has buttons
                        if message.reply_markup:
                            bot_message = message
                            logger.info(f"✅ Found bot message with buttons (message ID: {message.id})")
                            logger.info(f"   Message text: {message.text[:200] if message.text else 'No text'}")
                            logger.info(f"   Button rows: {len(message.reply_markup.rows)}")
                            break
                        # Also check if it's a recent message that might be the /setup response
                        elif message.date and (datetime.now().timestamp() - message.date.timestamp()) < 60:
                            logger.info(f"  Found recent bot message (ID: {message.id}, age: {datetime.now().timestamp() - message.date.timestamp():.1f}s): {msg_text}...")
                            # Wait a bit more for buttons to appear
                            await asyncio.sleep(3)
                            # Check again for updated message with buttons
                            async for updated_msg in self.client.iter_messages(bot_entity, limit=5):
                                if updated_msg.id == message.id:
                                    if updated_msg.reply_markup:
                                        bot_message = updated_msg
                                        logger.info(f"✅ Found updated message with buttons (message ID: {updated_msg.id})")
                                        break
                                    else:
                                        logger.info(f"  Message {updated_msg.id} still has no buttons")
                            if bot_message:
                                break
                if bot_message:
                    break
                logger.info(f"  No message with buttons found, waiting 2 seconds...")
                await asyncio.sleep(2)
            
            if not bot_message:
                logger.error(f"❌ Could not get bot response after {max_attempts} attempts")
                logger.error("Make sure @safeguard bot is accessible and responded to /setup")
                # Log all recent messages for debugging
                logger.error("Recent bot messages:")
                async for msg in self.client.iter_messages(bot_entity, limit=10):
                    if msg.sender_id == bot_entity.id:
                        logger.error(f"  - ID: {msg.id}, Text: {msg.text[:100] if msg.text else 'No text'}, Has buttons: {bool(msg.reply_markup)}")
                return {'success': False, 'error': 'Could not get bot response with buttons'}
            
            logger.info(f"Got bot message: {bot_message.text[:200]}...")
            if bot_message.reply_markup:
                logger.info(f"Message has {len(bot_message.reply_markup.rows)} row(s) of buttons")
            
            # STEP 3: Click "Select a Group" button
            logger.info("STEP 3: Clicking 'Select a Group' button...")
            try:
                # Find button by text (case-insensitive)
                clicked = False
                target_button = None
                if bot_message.reply_markup:
                    logger.info(f"Searching through {len(bot_message.reply_markup.rows)} row(s) of buttons...")
                    for row_idx, row in enumerate(bot_message.reply_markup.rows):
                        logger.info(f"  Row {row_idx + 1}: {len(row.buttons)} button(s)")
                        for btn_idx, button in enumerate(row.buttons):
                            button_text = button.text.lower() if hasattr(button, 'text') else ''
                            logger.info(f"    Button {btn_idx + 1}: '{button.text}' (lowercase: '{button_text}')")
                            # More flexible matching - check for "select" OR "group" keywords
                            if ('select' in button_text and 'group' in button_text) or \
                               ('group' in button_text and ('select' in button_text or 'choose' in button_text)):
                                logger.info(f"✅ Found matching button: '{button.text}'")
                                target_button = button
                                clicked = True
                                break
                        if clicked:
                            break
                
                if not clicked or not target_button:
                    logger.error("Could not find 'Select a Group' button. Available buttons:")
                    if bot_message.reply_markup:
                        for row in bot_message.reply_markup.rows:
                            for button in row.buttons:
                                logger.error(f"  - '{button.text}'")
                    return {'success': False, 'error': 'Could not find "Select a Group" button'}
                
                # Check if it's a KeyboardButtonRequestPeer (peer selection button)
                from telethon.tl.types import KeyboardButtonRequestPeer
                from telethon.tl.functions.messages import SendBotRequestedPeerRequest
                from telethon.tl.types import InputPeerChannel, InputPeerChat
                
                if isinstance(target_button, KeyboardButtonRequestPeer):
                    logger.info(f"✅ Button is KeyboardButtonRequestPeer (peer selection popup)")
                    logger.info(f"   Button ID: {target_button.button_id}")
                    
                    # Get the group entity
                    logger.info(f"Getting group entity (ID: {group_chat_id})...")
                    group_entity_obj = await self.client.get_entity(int(group_chat_id))
                    logger.info(f"✅ Got group entity: {group_entity_obj.title}")
                    
                    # Convert to InputPeer based on type (same as test script)
                    if hasattr(group_entity_obj, 'broadcast') and group_entity_obj.broadcast:
                        selected_peer = InputPeerChannel(channel_id=group_entity_obj.id, access_hash=group_entity_obj.access_hash)
                        logger.info(f"   Type: Channel")
                    elif hasattr(group_entity_obj, 'megagroup') and group_entity_obj.megagroup:
                        selected_peer = InputPeerChannel(channel_id=group_entity_obj.id, access_hash=group_entity_obj.access_hash)
                        logger.info(f"   Type: Supergroup")
                    else:
                        selected_peer = InputPeerChat(chat_id=group_entity_obj.id)
                        logger.info(f"   Type: Regular group")
                    
                    # Use SendBotRequestedPeerRequest (same as test script that worked)
                    logger.info(f"Sending peer selection via SendBotRequestedPeerRequest...")
                    try:
                        await self.client(SendBotRequestedPeerRequest(
                            peer=bot_entity,
                            msg_id=bot_message.id,
                            button_id=target_button.button_id,
                            requested_peers=[selected_peer]
                        ))
                        logger.info(f"✅ Successfully sent peer selection via SendBotRequestedPeerRequest")
                        clicked = True
                    except Exception as e:
                        error_str = str(e)
                        logger.error(f"❌ SendBotRequestedPeerRequest failed: {error_str}")
                        import traceback
                        logger.error(traceback.format_exc())
                        return {'success': False, 'error': f'SendBotRequestedPeerRequest failed: {error_str}'}
                else:
                    # Regular inline button - use click method
                    logger.info(f"Button is regular inline button - using click method")
                    try:
                        await bot_message.click(target_button)
                        logger.info(f"✅ Successfully clicked button")
                        clicked = True
                    except Exception as e:
                        logger.error(f"❌ Button click failed: {e}")
                        import traceback
                        logger.error(traceback.format_exc())
                        return {'success': False, 'error': f'Button click failed: {str(e)}'}
                
                logger.info("✅ Sent group selection via SendBotRequestedPeerRequest")
                await asyncio.sleep(5)  # Increased wait time for bot to process group selection
                
            except Exception as e:
                logger.error(f"Error sending group selection: {e}")
                return {'success': False, 'error': f'Error sending group selection: {str(e)}'}
            
            # STEP 4: Find and send channel selection via SendBotRequestedPeerRequest
            logger.info("STEP 4: Finding 'Select a channel' button and sending channel selection...")
            try:
                # Wait for bot to respond with channel selection prompt
                channel_button_message = None
                for attempt in range(max_attempts):
                    logger.info(f"  Attempt {attempt + 1}/{max_attempts}: Looking for channel selection message...")
                    async for message in self.client.iter_messages(bot_entity, limit=10):
                        if message.sender_id == bot_entity.id and message.reply_markup:
                            msg_text = message.text.lower() if message.text else ''
                            logger.info(f"    Found message with buttons (ID: {message.id}): {message.text[:100] if message.text else 'No text'}...")
                            # Check if this is the channel selection message
                            if 'channel' in msg_text or 'select' in msg_text:
                                channel_button_message = message
                                logger.info(f"✅ Found channel selection message (ID: {message.id})")
                                break
                    if channel_button_message:
                        break
                    await asyncio.sleep(2)
                
                if not channel_button_message:
                    return {'success': False, 'error': 'Could not get channel selection prompt'}
                
                # Find "Select a channel" button
                target_channel_button = None
                if channel_button_message.reply_markup:
                    for row in channel_button_message.reply_markup.rows:
                        for button in row.buttons:
                            button_text = button.text.lower() if hasattr(button, 'text') else ''
                            if 'select' in button_text and 'channel' in button_text:
                                logger.info(f"Found channel button: {button.text}")
                                target_channel_button = button
                                break
                        if target_channel_button:
                            break
                
                if not target_channel_button:
                    return {'success': False, 'error': 'Could not find "Select a channel" button'}
                
                # Check if it's a KeyboardButtonRequestPeer
                from telethon.tl.types import KeyboardButtonRequestPeer
                from telethon.tl.functions.messages import SendBotRequestedPeerRequest
                from telethon.tl.types import InputPeerChannel, InputPeerChat
                
                if isinstance(target_channel_button, KeyboardButtonRequestPeer):
                    logger.info(f"✅ Channel button is KeyboardButtonRequestPeer (peer selection popup)")
                    logger.info(f"   Button ID: {target_channel_button.button_id}")
                    
                    # Get channel entity
                    logger.info(f"Getting channel entity (ID: {channel_chat_id})...")
                    channel_entity_obj = await self.client.get_entity(int(channel_chat_id))
                    logger.info(f"✅ Got channel entity: {channel_entity_obj.title}")
                    
                    # Convert to InputPeer (same as test script)
                    if hasattr(channel_entity_obj, 'broadcast') and channel_entity_obj.broadcast:
                        channel_selected_peer = InputPeerChannel(
                            channel_id=channel_entity_obj.id,
                            access_hash=channel_entity_obj.access_hash
                        )
                        logger.info(f"   Type: Channel")
                    elif hasattr(channel_entity_obj, 'megagroup') and channel_entity_obj.megagroup:
                        channel_selected_peer = InputPeerChannel(
                            channel_id=channel_entity_obj.id,
                            access_hash=channel_entity_obj.access_hash
                        )
                        logger.info(f"   Type: Supergroup")
                    else:
                        channel_selected_peer = InputPeerChat(chat_id=channel_entity_obj.id)
                        logger.info(f"   Type: Regular group")
                    
                    # Send channel selection via SendBotRequestedPeerRequest (same as test script)
                    logger.info(f"Sending channel selection via SendBotRequestedPeerRequest...")
                    try:
                        await self.client(SendBotRequestedPeerRequest(
                            peer=bot_entity,
                            msg_id=channel_button_message.id,
                            button_id=target_channel_button.button_id,
                            requested_peers=[channel_selected_peer]
                        ))
                        logger.info(f"✅ Successfully sent channel selection via SendBotRequestedPeerRequest")
                    except Exception as e:
                        logger.error(f"❌ SendBotRequestedPeerRequest failed: {e}")
                        import traceback
                        logger.error(traceback.format_exc())
                        return {'success': False, 'error': f'Channel selection failed: {str(e)}'}
                else:
                    # Regular inline button - use click method
                    logger.info(f"Channel button is regular inline button - using click method")
                    try:
                        await channel_button_message.click(target_channel_button)
                        logger.info(f"✅ Successfully clicked channel button")
                    except Exception as e:
                        logger.error(f"❌ Channel button click failed: {e}")
                        import traceback
                        logger.error(traceback.format_exc())
                        return {'success': False, 'error': f'Channel button click failed: {str(e)}'}
                
                logger.info("✅ Channel selection sent, waiting for bot response...")
                await asyncio.sleep(5)  # Wait for bot to process channel selection
                
            except Exception as e:
                logger.error(f"❌ Error sending channel selection: {e}")
                import traceback
                logger.error(traceback.format_exc())
                return {'success': False, 'error': f'Error sending channel selection: {str(e)}'}
            
            # STEP 7: Click "Create Portal" button
            logger.info("\n" + "="*60)
            logger.info("STEP 7: CLICKING 'CREATE PORTAL' BUTTON")
            logger.info("="*60)
            try:
                # Wait longer for bot to send the "Create Portal" message
                logger.info("Waiting 5 seconds for bot to send 'Create Portal' message...")
                await asyncio.sleep(5)
                
                create_portal_message = None
                logger.info("Searching for 'Create Portal' button message...")
                for attempt in range(max_attempts):
                    logger.info(f"  Attempt {attempt + 1}/{max_attempts}: Checking bot messages...")
                    async for message in self.client.iter_messages(bot_entity, limit=15):
                        if message.sender_id == bot_entity.id:
                            msg_text = message.text[:200] if message.text else ''
                            has_buttons = bool(message.reply_markup)
                            logger.info(f"    Message ID: {message.id}, Has buttons: {has_buttons}, Text: {msg_text[:100]}...")
                            
                            # Check if this message has buttons (it should be the "Create Portal" message)
                            if has_buttons:
                                # Check if any button says "Create Portal"
                                found_create_portal = False
                                if message.reply_markup:
                                    for row in message.reply_markup.rows:
                                        for btn in row.buttons:
                                            btn_text = btn.text.lower() if hasattr(btn, 'text') else ''
                                            logger.info(f"      Button: '{btn.text}'")
                                            if 'create' in btn_text and 'portal' in btn_text:
                                                logger.info(f"      ✅ Found 'Create Portal' button!")
                                                found_create_portal = True
                                                break
                                        if found_create_portal:
                                            break
                                
                                # If message has buttons and either says "portal" in text OR has "Create Portal" button, use it
                                if 'portal' in msg_text.lower() or found_create_portal:
                                    logger.info(f"    ✅ This is the portal creation message!")
                                    create_portal_message = message
                                    break
                    
                    if create_portal_message:
                        break
                    logger.info(f"  No portal message found yet, waiting 3 seconds...")
                    await asyncio.sleep(3)
                
                if not create_portal_message:
                    logger.error("❌ Could not find 'Create Portal' button message")
                    logger.error("Recent bot messages:")
                    async for msg in self.client.iter_messages(bot_entity, limit=10):
                        if msg.sender_id == bot_entity.id:
                            logger.error(f"  - ID: {msg.id}, Text: {msg.text[:100] if msg.text else 'No text'}, Has buttons: {bool(msg.reply_markup)}")
                    return {'success': False, 'error': 'Could not get "Create Portal" button message'}
                
                logger.info(f"✅ Found portal creation message (ID: {create_portal_message.id})")
                logger.info(f"   Message text: {create_portal_message.text[:200] if create_portal_message.text else 'No text'}")
                if create_portal_message.reply_markup:
                    logger.info(f"   Button rows: {len(create_portal_message.reply_markup.rows)}")
                    for row_idx, row in enumerate(create_portal_message.reply_markup.rows):
                        logger.info(f"     Row {row_idx + 1}: {len(row.buttons)} button(s)")
                        for btn_idx, btn in enumerate(row.buttons):
                            logger.info(f"       Button {btn_idx + 1}: '{btn.text}'")
                
                # Find "Create Portal" button - get both the button object and its index
                portal_created = False
                target_portal_button = None
                target_button_index = None
                button_text_to_click = None
                
                if create_portal_message.reply_markup:
                    # Flatten buttons to get index
                    flat_buttons = []
                    for row in create_portal_message.reply_markup.rows:
                        for button in row.buttons:
                            flat_buttons.append(button)
                    
                    logger.info(f"  Total buttons: {len(flat_buttons)}")
                    for btn_idx, button in enumerate(flat_buttons):
                        button_text = button.text.lower() if hasattr(button, 'text') else ''
                        logger.info(f"    Button {btn_idx}: '{button.text}' (lowercase: '{button_text}')")
                        # Look for "Create Portal" - be flexible with matching
                        if ('create' in button_text and 'portal' in button_text) or \
                           button_text == 'create portal' or \
                           'portal' in button_text and 'create' in button_text:
                            logger.info(f"    ✅ Found matching button at index {btn_idx}: '{button.text}'")
                            target_portal_button = button
                            target_button_index = btn_idx
                            button_text_to_click = button.text  # Use text for clicking
                            portal_created = True
                            break
                
                if not portal_created or not target_portal_button:
                    logger.error("❌ Could not find 'Create Portal' button. Available buttons:")
                    if create_portal_message.reply_markup:
                        for row in create_portal_message.reply_markup.rows:
                            for button in row.buttons:
                                logger.error(f"  - '{button.text}'")
                    return {'success': False, 'error': 'Could not find "Create Portal" button'}
                
                # Click the button (this is a regular inline button, not a popup)
                logger.info(f"\n{'='*60}")
                logger.info(f"CLICKING 'CREATE PORTAL' BUTTON")
                logger.info(f"{'='*60}")
                logger.info(f"Button text: '{button_text_to_click}'")
                logger.info(f"Button index: {target_button_index}")
                logger.info(f"Message ID: {create_portal_message.id}")
                logger.info(f"Button type: {type(target_portal_button)}")
                
                try:
                    # Use message.click() with button text (safer than passing button object)
                    # Telethon's click() accepts: int (index), str (button text), or button object
                    logger.info(f"Calling create_portal_message.click('{button_text_to_click}')...")
                    result = await create_portal_message.click(button_text_to_click)
                    logger.info(f"✅ Click result: {result}")
                    logger.info("✅ Successfully clicked 'Create Portal' button!")
                    portal_created = True
                except Exception as e:
                    error_str = str(e)
                    logger.error(f"❌ Failed to click with text, trying index...")
                    # Fallback: try with index
                    try:
                        logger.info(f"Trying create_portal_message.click({target_button_index})...")
                        result = await create_portal_message.click(target_button_index)
                        logger.info(f"✅ Click result: {result}")
                        logger.info("✅ Successfully clicked 'Create Portal' button using index!")
                        portal_created = True
                    except Exception as e2:
                        logger.error(f"❌ Failed to click 'Create Portal' button: {error_str}")
                        logger.error(f"   Fallback also failed: {str(e2)}")
                        import traceback
                        logger.error(traceback.format_exc())
                        return {'success': False, 'error': f'Failed to click Create Portal button: {error_str}'}
                
                logger.info("✅ 'Create Portal' button clicked successfully")
                logger.info("Waiting 8 seconds for portal creation confirmation...")
                await asyncio.sleep(8)  # Wait longer for portal creation confirmation
                
            except Exception as e:
                logger.error(f"Error clicking 'Create Portal' button: {e}")
                import traceback
                logger.error(traceback.format_exc())
                return {'success': False, 'error': f'Error creating portal: {str(e)}'}
            
            # STEP 8: Get final confirmation
            logger.info("STEP 8: Waiting for portal creation confirmation...")
            try:
                confirmation_message = None
                for attempt in range(max_attempts):
                    async for message in self.client.iter_messages(bot_entity, limit=3):
                        if message.sender_id == bot_entity.id:
                            confirmation_message = message
                            break
                    if confirmation_message:
                        break
                    await asyncio.sleep(1)
                
                if confirmation_message:
                    logger.info(f"Portal creation response: {confirmation_message.text[:200]}")
                    return {
                        'success': True,
                        'group_chat_id': group_chat_id,
                        'channel_chat_id': channel_chat_id,
                        'response': confirmation_message.text if hasattr(confirmation_message, 'text') else None
                    }
                else:
                    # Portal might have been created even without confirmation message
                    logger.info("No confirmation message received, but portal setup flow completed")
                    return {
                        'success': True,
                        'group_chat_id': group_chat_id,
                        'channel_chat_id': channel_chat_id,
                        'response': 'Portal setup flow completed'
                    }
                    
            except Exception as e:
                logger.warning(f"Could not get confirmation: {e}")
                # Still return success if we got through all steps
                return {
                    'success': True,
                    'group_chat_id': group_chat_id,
                    'channel_chat_id': channel_chat_id,
                    'response': 'Portal setup flow completed (no confirmation received)'
                }
            
        except Exception as e:
            logger.error(f"Error in Safeguard portal setup flow: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return {
                'success': False,
                'error': str(e)
            }
    
    async def setup_safeguard_buy_bot_interactive_async(
        self,
        group_chat_id: str,
        token_address: str,
        chain: str = "base",
        safeguard_bot_username: str = '@safeguard'
    ):
        """
        Interactive Safeguard buy bot setup flow:
        1. Send /add@safeguard to the group
        2. Click "Add Token" button in Safeguard's response (redirects to bot DM)
        3. Select chain (Ethereum/Base) in Safeguard bot DM
        4. Send contract address
        5. Select first token pair option (usually TOKEN / WETH)
        
        Args:
            group_chat_id: Chat ID of the group
            token_address: Contract address of the token
            chain: Chain name (base, ethereum, etc.)
            safeguard_bot_username: Safeguard bot username (default: @safeguard)
            
        Returns:
            dict with success status and buy bot info
        """
        try:
            await self._ensure_connected()
            
            # Get safeguard bot entity
            bot_entity = await self.client.get_entity(safeguard_bot_username)
            
            # Get group entity
            group_entity = await self.client.get_entity(int(group_chat_id))
            
            logger.info(f"Starting Safeguard buy bot setup flow...")
            logger.info(f"  - Group ID: {group_chat_id}")
            logger.info(f"  - Token Address: {token_address}")
            logger.info(f"  - Chain: {chain}")
            
            # STEP 1: Send /add@safeguard to the group
            logger.info("STEP 1: Sending /add@safeguard command to group...")
            add_command = f"/add{safeguard_bot_username}"
            group_message = await self.client.send_message(group_entity, add_command)
            logger.info(f"✅ Sent {add_command} to group (message ID: {group_message.id})")
            await asyncio.sleep(5)  # Wait for bot response
            
            # STEP 2: Find Safeguard bot's response in group with "Add Token" button
            logger.info("STEP 2: Looking for Safeguard bot response with 'Add Token' button in group...")
            add_token_message = None
            max_attempts = 20
            for attempt in range(max_attempts):
                logger.info(f"  Attempt {attempt + 1}/{max_attempts}: Checking group messages...")
                async for message in self.client.iter_messages(group_entity, limit=20):
                    if message.sender_id == bot_entity.id and message.reply_markup:
                        msg_text = message.text.lower() if message.text else ''
                        logger.info(f"    Found bot message with buttons (ID: {message.id}): {message.text[:100] if message.text else 'No text'}...")
                        # Check if this is the "Add Token" button message
                        if 'add token' in msg_text or 'add' in msg_text:
                            add_token_message = message
                            logger.info(f"✅ Found 'Add Token' button message (ID: {message.id})")
                            break
                if add_token_message:
                    break
                await asyncio.sleep(2)
            
            if not add_token_message:
                logger.error("❌ Could not find Safeguard bot response with 'Add Token' button")
                return {'success': False, 'error': 'Could not find Add Token button in group'}
            
            # STEP 3: Click "Add Token" button (this redirects to Safeguard bot DM)
            logger.info("STEP 3: Clicking 'Add Token' button...")
            try:
                # Find the "Add Token" button
                add_token_button = None
                if add_token_message.reply_markup:
                    for row in add_token_message.reply_markup.rows:
                        for button in row.buttons:
                            button_text = button.text.lower() if hasattr(button, 'text') else ''
                            logger.info(f"    Button: '{button.text}'")
                            if 'add' in button_text and 'token' in button_text:
                                add_token_button = button
                                logger.info(f"✅ Found 'Add Token' button: '{button.text}'")
                                break
                        if add_token_button:
                            break
                
                if not add_token_button:
                    return {'success': False, 'error': 'Could not find "Add Token" button'}
                
                # Click the button
                await add_token_message.click(add_token_button)
                logger.info(f"✅ Clicked 'Add Token' button, redirecting to Safeguard bot DM...")
                await asyncio.sleep(5)  # Wait for redirect to bot DM
                
            except Exception as e:
                logger.error(f"❌ Error clicking 'Add Token' button: {e}")
                import traceback
                logger.error(traceback.format_exc())
                return {'success': False, 'error': f'Failed to click Add Token button: {str(e)}'}
            
            # STEP 4: In Safeguard bot DM, find chain selection buttons
            logger.info("STEP 4: Looking for chain selection buttons in Safeguard bot DM...")
            chain_selection_message = None
            for attempt in range(max_attempts):
                logger.info(f"  Attempt {attempt + 1}/{max_attempts}: Checking bot DM messages...")
                async for message in self.client.iter_messages(bot_entity, limit=10):
                    if message.sender_id == bot_entity.id and message.reply_markup:
                        msg_text = message.text.lower() if message.text else ''
                        logger.info(f"    Found message with buttons (ID: {message.id}): {message.text[:100] if message.text else 'No text'}...")
                        # Check if this is the chain selection message
                        if 'chain' in msg_text or 'ethereum' in msg_text or 'base' in msg_text:
                            chain_selection_message = message
                            logger.info(f"✅ Found chain selection message (ID: {message.id})")
                            break
                if chain_selection_message:
                    break
                await asyncio.sleep(2)
            
            if not chain_selection_message:
                return {'success': False, 'error': 'Could not find chain selection message'}
            
            # STEP 5: Click the chain button (Ethereum or Base)
            logger.info(f"STEP 5: Clicking chain button ({chain})...")
            try:
                if chain.lower() == "ethereum":
                    chain_name = "Ethereum"
                elif chain.lower() == "base":
                    chain_name = "Base"
                else:
                    chain_name = chain.capitalize()
                chain_button = None
                if chain_selection_message.reply_markup:
                    for row in chain_selection_message.reply_markup.rows:
                        for button in row.buttons:
                            button_text = button.text.lower() if hasattr(button, 'text') else ''
                            logger.info(f"    Button: '{button.text}'")
                            # Match chain name (case-insensitive)
                            if chain_name.lower() in button_text or button_text in chain_name.lower():
                                chain_button = button
                                logger.info(f"✅ Found chain button: '{button.text}'")
                                break
                        if chain_button:
                            break
                
                if not chain_button:
                    logger.warning(f"Could not find exact chain button for '{chain_name}', trying first button...")
                    # Fallback: use first button
                    if chain_selection_message.reply_markup and chain_selection_message.reply_markup.rows:
                        chain_button = chain_selection_message.reply_markup.rows[0].buttons[0]
                        logger.info(f"Using first button: '{chain_button.text}'")
                
                if not chain_button:
                    return {'success': False, 'error': 'Could not find chain selection button'}
                
                await chain_selection_message.click(chain_button)
                logger.info(f"✅ Clicked chain button: {chain_button.text}")
                await asyncio.sleep(3)  # Wait for bot to process chain selection
                
            except Exception as e:
                logger.error(f"❌ Error clicking chain button: {e}")
                import traceback
                logger.error(traceback.format_exc())
                return {'success': False, 'error': f'Failed to click chain button: {str(e)}'}
            
            # STEP 6: Wait for contract address prompt and send address
            logger.info("STEP 6: Waiting for contract address prompt...")
            address_prompt_message = None
            for attempt in range(max_attempts):
                async for message in self.client.iter_messages(bot_entity, limit=5):
                    if message.sender_id == bot_entity.id:
                        msg_text = message.text.lower() if message.text else ''
                        if 'address' in msg_text or 'token address' in msg_text or '[eth]' in msg_text:
                            address_prompt_message = message
                            logger.info(f"✅ Found contract address prompt (ID: {message.id})")
                            break
                if address_prompt_message:
                    break
                await asyncio.sleep(2)
            
            if address_prompt_message:
                logger.info("STEP 7: Sending contract address to Safeguard bot...")
                await self.client.send_message(bot_entity, token_address)
                logger.info(f"✅ Sent contract address: {token_address}")
                await asyncio.sleep(5)  # Wait for bot to process and find token
            else:
                logger.warning("Could not find address prompt, sending address anyway...")
                await self.client.send_message(bot_entity, token_address)
                await asyncio.sleep(5)
            
            # STEP 8: Find token pair selection message and click first option
            logger.info("STEP 8: Looking for token pair selection...")
            token_pair_message = None
            for attempt in range(max_attempts):
                async for message in self.client.iter_messages(bot_entity, limit=10):
                    if message.sender_id == bot_entity.id:
                        msg_text = message.text.lower() if message.text else ''
                        # Check if this is the token pair selection message
                        if ('token found' in msg_text or 'select' in msg_text) and message.reply_markup:
                            token_pair_message = message
                            logger.info(f"✅ Found token pair selection message (ID: {message.id})")
                            break
                if token_pair_message:
                    break
                await asyncio.sleep(2)
            
            if token_pair_message and token_pair_message.reply_markup:
                logger.info("STEP 9: Clicking first token pair option...")
                try:
                    # Click first button (usually TOKEN / WETH)
                    first_button = token_pair_message.reply_markup.rows[0].buttons[0]
                    logger.info(f"Clicking first option: '{first_button.text}'")
                    await token_pair_message.click(first_button)
                    logger.info(f"✅ Clicked token pair: {first_button.text}")
                    await asyncio.sleep(3)  # Wait for confirmation
                except Exception as e:
                    logger.error(f"❌ Error clicking token pair: {e}")
                    # Don't fail completely - the address was sent
                    logger.warning("Token pair selection failed, but contract address was sent")
            
            logger.info("✅ Buy bot setup completed!")
            return {
                'success': True,
                'message': f'Buy bot setup completed for {token_address} on {chain}',
                'token_address': token_address,
                'chain': chain
            }
            
        except Exception as e:
            logger.error(f"❌ Error in buy bot setup: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return {'success': False, 'error': f'Buy bot setup failed: {str(e)}'}

    def setup_safeguard_buy_bot_interactive(
        self,
        group_chat_id: str,
        token_address: str,
        chain: str = "base",
        safeguard_bot_username: str = '@safeguard'
    ):
        """
        Synchronous wrapper for setup_safeguard_buy_bot_interactive_async
        """
        if self._event_loop and self._event_loop.is_running():
            # If event loop is running, we need to use a different approach
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as executor:
                future = executor.submit(
                    asyncio.run,
                    self.setup_safeguard_buy_bot_interactive_async(group_chat_id, token_address, chain, safeguard_bot_username)
                )
                return future.result()
        else:
            try:
                loop = self._event_loop if self._event_loop else asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            return loop.run_until_complete(
                self.setup_safeguard_buy_bot_interactive_async(group_chat_id, token_address, chain, safeguard_bot_username)
            )

    def setup_safeguard_portal_interactive(
        self,
        group_chat_id: str,
        channel_chat_id: str,
        safeguard_bot_username: str = '@safeguard'
    ):
        """Synchronous wrapper for setup_safeguard_portal_interactive_async"""
        if self._event_loop and self._event_loop.is_running():
            future = asyncio.run_coroutine_threadsafe(
                self.setup_safeguard_portal_interactive_async(group_chat_id, channel_chat_id, safeguard_bot_username),
                self._event_loop
            )
            return future.result(timeout=300)  # 5 minute timeout for full flow
        else:
            try:
                loop = self._event_loop if self._event_loop else asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            return loop.run_until_complete(
                self.setup_safeguard_portal_interactive_async(group_chat_id, channel_chat_id, safeguard_bot_username)
            )
    
    async def create_group_via_safeguard_async(
        self,
        token_name: str,
        token_symbol: str,
        token_address: str,
        description: str = '',
        photo_path: str = None,
        is_channel: bool = False,
        channel_username: str = None,  # For channel username (with retry logic)
        safeguard_bot_username: str = '@safeguard'
    ):
        """
        Create a Telegram group/channel via Safeguard bot
        
        Args:
            token_name: Token name
            token_symbol: Token symbol
            token_address: Token contract address
            description: Group/channel description
            photo_path: Path to photo file (optional)
            is_channel: If True, create channel; if False, create group
            channel_username: Desired channel username (without @). For channels only. Will retry with variations if taken.
            safeguard_bot_username: Safeguard bot username
            
        Returns:
            dict with success status, chat_id, and group info
        """
        try:
            await self._ensure_connected()
            
            # Build safeguard bot command
            # Groups: Safeguard bot handles naming, so we don't send custom name
            # Channels: We need to specify username and retry if taken
            
            if is_channel:
                # Channel creation - need to try username with variations
                if not channel_username:
                    # Generate base username from token symbol/name
                    base_username = (token_symbol.replace('$', '') + '_official').lower().replace(' ', '_')
                else:
                    base_username = channel_username.replace('@', '').lower()
                
                # Try variations if username is taken
                username_variations = [
                    base_username,
                    f"{base_username}_official",
                    f"{base_username}_community",
                    f"{token_symbol.replace('$', '').lower()}_official",
                    f"{token_symbol.replace('$', '').lower()}_channel",
                    f"{token_name.lower().replace(' ', '_')}_official",
                    f"{base_username}_{token_symbol.replace('$', '').lower()}",
                ]
                
                # Remove duplicates while preserving order
                seen = set()
                username_variations = [x for x in username_variations if not (x in seen or seen.add(x))]
                
                last_error = None
                for attempt, username in enumerate(username_variations):
                    try:
                        # Build channel creation command
                        # Format may vary - will be updated based on actual bot behavior
                        command = f"/create_channel {token_symbol} {token_address}"
                        if username:
                            command += f" @{username}"
                        if description:
                            command += f' "{description}"'
                        
                        logger.info(f"Creating channel via safeguard bot (attempt {attempt + 1}/{len(username_variations)}): {command}")
                        
                        # Send command to safeguard bot
                        result = await self.message_safeguard_bot_async(command, safeguard_bot_username)
                        
                        if result.get('success'):
                            # Check if response indicates username was taken
                            response_text = result.get('response', '').lower()
                            if 'taken' in response_text or 'already' in response_text or 'unavailable' in response_text:
                                logger.warning(f"Username @{username} is taken, trying next variation...")
                                last_error = f"Username @{username} is taken"
                                continue  # Try next variation
                            
                            # Success - extract chat_id
                            chat_id = None
                            if response_text:
                                import re
                                match = re.search(r'-?\d{10,}', result.get('response', ''))
                                if match:
                                    chat_id = match.group()
                            
                            logger.info(f"✅ Channel created successfully with username: @{username}")
                            # Build telegram link from username
                            telegram_link = f"https://t.me/{username}"
                            return {
                                'success': True,
                                'chat_id': chat_id,
                                'username': username,
                                'telegram_link': telegram_link,
                                'method': 'safeguard_bot',
                                'response': result.get('response', ''),
                                'command': command
                            }
                        else:
                            # Check if error is username-related
                            error_text = result.get('error', '').lower()
                            if 'taken' in error_text or 'already' in error_text or 'unavailable' in error_text:
                                logger.warning(f"Username @{username} is taken, trying next variation...")
                                last_error = result.get('error', 'Username taken')
                                continue  # Try next variation
                            else:
                                # Other error, return it
                                return {
                                    'success': False,
                                    'error': result.get('error', 'Unknown error'),
                                    'command': command
                                }
                    except Exception as e:
                        logger.warning(f"Attempt {attempt + 1} failed: {e}")
                        last_error = str(e)
                        if attempt < len(username_variations) - 1:
                            continue  # Try next variation
                        else:
                            raise  # Re-raise if last attempt
                
                # All variations failed
                return {
                    'success': False,
                    'error': f"All username variations failed. Last error: {last_error}",
                    'tried_usernames': username_variations
                }
            else:
                # Group creation - Safeguard bot handles naming, no custom name needed
                command = f"/create_group {token_symbol} {token_address}"
                if description:
                    command += f' "{description}"'
                
                logger.info(f"Creating group via safeguard bot: {command}")
                
                # Send command to safeguard bot
                result = await self.message_safeguard_bot_async(command, safeguard_bot_username)
                
                if result.get('success'):
                    # Safeguard bot should respond with group info
                    # Parse response to extract chat_id if possible
                    response_text = result.get('response', '')
                    
                    # Try to extract chat ID from response (format may vary)
                    chat_id = None
                    if response_text:
                        import re
                        # Pattern: -1001234567890 or chat ID: -1001234567890
                        match = re.search(r'-?\d{10,}', response_text)
                        if match:
                            chat_id = match.group()
                    
                    return {
                        'success': True,
                        'chat_id': chat_id,
                        'method': 'safeguard_bot',
                        'response': response_text,
                        'command': command
                    }
                else:
                    return {
                        'success': False,
                        'error': result.get('error', 'Unknown error'),
                        'command': command
                    }
                
        except Exception as e:
            logger.error(f"Error creating group via safeguard bot: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return {
                'success': False,
                'error': str(e)
            }
    
    def create_group_via_safeguard(
        self,
        token_name: str,
        token_symbol: str,
        token_address: str,
        description: str = '',
        photo_path: str = None,
        is_channel: bool = False,
        channel_username: str = None,
        safeguard_bot_username: str = '@safeguard'
    ):
        """Synchronous wrapper for create_group_via_safeguard_async"""
        if self._event_loop and self._event_loop.is_running():
            future = asyncio.run_coroutine_threadsafe(
                self.create_group_via_safeguard_async(
                    token_name, token_symbol, token_address, description,
                    photo_path, is_channel, channel_username, safeguard_bot_username
                ),
                self._event_loop
            )
            return future.result(timeout=180)  # Increased timeout for retry logic
        else:
            try:
                loop = self._event_loop if self._event_loop else asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            return loop.run_until_complete(
                self.create_group_via_safeguard_async(
                    token_name, token_symbol, token_address, description,
                    photo_path, is_channel, channel_username, safeguard_bot_username
                )
            )
    
    async def invite_users_async(self, chat_id, user_phones):
        """
        Invite users to a group/channel
        
        Args:
            chat_id: Chat ID to invite users to
            user_phones: List of phone numbers to invite
            
        Returns:
            dict with success status and results
        """
        try:
            await self._ensure_connected()
            entity = await self.client.get_entity(chat_id)
            
            # Get user entities by phone numbers
            users_to_invite = []
            for phone in user_phones:
                try:
                    # Try to get user by phone
                    user = await self.client.get_entity(phone)
                    users_to_invite.append(user)
                except Exception as e:
                    logger.warning(f"Could not find user {phone}: {e}")
            
            if not users_to_invite:
                return {
                    'success': False,
                    'error': 'No valid users found to invite'
                }
            
            # Invite users
            await self.client(InviteToChannelRequest(
                channel=entity,
                users=users_to_invite
            ))
            
            logger.info(f"Invited {len(users_to_invite)} users to chat {chat_id}")
            
            return {
                'success': True,
                'invited_count': len(users_to_invite)
            }
            
        except Exception as e:
            logger.error(f"Error inviting users: {e}")
            return {
                'success': False,
                'error': str(e)
            }
    
    def create_group(self, title, description=None, photo_path=None, is_channel=False, is_megagroup=True):
        """Synchronous wrapper for create_group_async"""
        if self._event_loop and self._event_loop.is_running():
            future = asyncio.run_coroutine_threadsafe(
                self.create_group_async(title, description, photo_path, is_channel, is_megagroup),
                self._event_loop
            )
            return future.result(timeout=60)
        else:
            try:
                loop = self._event_loop if self._event_loop else asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            return loop.run_until_complete(
                self.create_group_async(title, description, photo_path, is_channel, is_megagroup)
            )
    
    def configure_group_settings(self, chat_id, settings):
        """Synchronous wrapper for configure_group_settings_async"""
        if self._event_loop and self._event_loop.is_running():
            future = asyncio.run_coroutine_threadsafe(
                self.configure_group_settings_async(chat_id, settings),
                self._event_loop
            )
            return future.result(timeout=30)
        else:
            try:
                loop = self._event_loop if self._event_loop else asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            return loop.run_until_complete(
                self.configure_group_settings_async(chat_id, settings)
            )
    
    def invite_users(self, chat_id, user_phones):
        """Synchronous wrapper for invite_users_async"""
        if self._event_loop and self._event_loop.is_running():
            future = asyncio.run_coroutine_threadsafe(
                self.invite_users_async(chat_id, user_phones),
                self._event_loop
            )
            return future.result(timeout=60)
        else:
            try:
                loop = self._event_loop if self._event_loop else asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            return loop.run_until_complete(
                self.invite_users_async(chat_id, user_phones)
            )
    
    async def update_profile_picture_async(self, photo_path: str) -> dict:
        """
        Update profile picture
        
        Args:
            photo_path: Path to image file (jpg, png, etc.)
        
        Returns:
            dict with success status and result
        """
        try:
            await self._ensure_connected()
            
            if not os.path.exists(photo_path):
                return {'success': False, 'error': f'Photo file not found: {photo_path}'}
            
            # Upload and set profile photo
            file = await self.client.upload_file(photo_path)
            result = await self.client(UploadProfilePhotoRequest(file=file))
            
            logger.info(f"[{self.user_tag}] Profile picture updated successfully")
            return {'success': True, 'result': result}
        except Exception as e:
            error_msg = str(e)
            logger.error(f"[{self.user_tag}] Failed to update profile picture: {error_msg}")
            return {'success': False, 'error': error_msg}
    
    def update_profile_picture(self, photo_path: str) -> dict:
        """Synchronous wrapper for update_profile_picture_async"""
        if self._event_loop and self._event_loop.is_running():
            future = asyncio.run_coroutine_threadsafe(
                self.update_profile_picture_async(photo_path),
                self._event_loop
            )
            return future.result(timeout=30)
        else:
            try:
                loop = self._event_loop if self._event_loop else asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            return loop.run_until_complete(
                self.update_profile_picture_async(photo_path)
            )
    
    async def update_username_async(self, username: str) -> dict:
        """
        Update username (without @)
        
        Args:
            username: New username (without @ symbol)
        
        Returns:
            dict with success status and result
        """
        try:
            await self._ensure_connected()
            
            # Remove @ if present
            username = username.lstrip('@')
            
            # Update username
            result = await self.client(UpdateUsernameRequest(username=username))
            
            logger.info(f"[{self.user_tag}] Username updated to: @{username}")
            return {'success': True, 'result': result, 'username': username}
        except Exception as e:
            error_msg = str(e)
            logger.error(f"[{self.user_tag}] Failed to update username: {error_msg}")
            return {'success': False, 'error': error_msg}
    
    def update_username(self, username: str) -> dict:
        """Synchronous wrapper for update_username_async"""
        if self._event_loop and self._event_loop.is_running():
            future = asyncio.run_coroutine_threadsafe(
                self.update_username_async(username),
                self._event_loop
            )
            return future.result(timeout=30)
        else:
            try:
                loop = self._event_loop if self._event_loop else asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            return loop.run_until_complete(
                self.update_username_async(username)
            )
    
    async def update_bio_async(self, bio: str) -> dict:
        """
        Update bio/description
        
        Args:
            bio: New bio text (max 70 characters)
        
        Returns:
            dict with success status and result
        """
        try:
            await self._ensure_connected()
            
            # Update bio
            result = await self.client(UpdateProfileRequest(about=bio))
            
            logger.info(f"[{self.user_tag}] Bio updated: {bio[:50]}...")
            return {'success': True, 'result': result, 'bio': bio}
        except Exception as e:
            error_msg = str(e)
            logger.error(f"[{self.user_tag}] Failed to update bio: {error_msg}")
            return {'success': False, 'error': error_msg}
    
    def update_bio(self, bio: str) -> dict:
        """Synchronous wrapper for update_bio_async"""
        if self._event_loop and self._event_loop.is_running():
            future = asyncio.run_coroutine_threadsafe(
                self.update_bio_async(bio),
                self._event_loop
            )
            return future.result(timeout=30)
        else:
            try:
                loop = self._event_loop if self._event_loop else asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            return loop.run_until_complete(
                self.update_bio_async(bio)
            )
    
    async def get_profile_info_async(self) -> dict:
        """
        Get current profile information
        
        Returns:
            dict with username, bio, and profile photo info
        """
        try:
            await self._ensure_connected()
            
            me = await self.client.get_me()
            
            profile_info = {
                'id': me.id,
                'first_name': me.first_name,
                'last_name': me.last_name,
                'username': me.username,
                'phone': me.phone,
                'bio': getattr(me, 'about', None) or '',
            }
            
            # Get full user entity for bio
            try:
                full_user = await self.client.get_entity(me.id)
                if hasattr(full_user, 'about'):
                    profile_info['bio'] = full_user.about or ''
            except:
                pass
            
            return {'success': True, 'profile': profile_info}
        except Exception as e:
            error_msg = str(e)
            logger.error(f"[{self.user_tag}] Failed to get profile info: {error_msg}")
            return {'success': False, 'error': error_msg}
    
    def get_profile_info(self) -> dict:
        """Synchronous wrapper for get_profile_info_async"""
        if self._event_loop and self._event_loop.is_running():
            future = asyncio.run_coroutine_threadsafe(
                self.get_profile_info_async(),
                self._event_loop
            )
            return future.result(timeout=30)
        else:
            try:
                loop = self._event_loop if self._event_loop else asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            return loop.run_until_complete(
                self.get_profile_info_async()
            )
    
    async def update_display_name_async(self, first_name: str, last_name: str = '') -> dict:
        """
        Update display name (first name and optional last name)
        
        Args:
            first_name: New first name
            last_name: New last name (optional)
        
        Returns:
            dict with success status and result
        """
        try:
            await self._ensure_connected()
            
            # Update profile with new name
            result = await self.client(UpdateProfileRequest(
                first_name=first_name,
                last_name=last_name or ''
            ))
            
            logger.info(f"[{self.user_tag}] Display name updated: {first_name} {last_name}")
            return {'success': True, 'result': result, 'first_name': first_name, 'last_name': last_name}
        except Exception as e:
            error_msg = str(e)
            logger.error(f"[{self.user_tag}] Failed to update display name: {error_msg}")
            return {'success': False, 'error': error_msg}
    
    def update_display_name(self, first_name: str, last_name: str = '') -> dict:
        """Synchronous wrapper for update_display_name_async"""
        if self._event_loop and self._event_loop.is_running():
            future = asyncio.run_coroutine_threadsafe(
                self.update_display_name_async(first_name, last_name),
                self._event_loop
            )
            return future.result(timeout=30)
        else:
            try:
                loop = self._event_loop if self._event_loop else asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            return loop.run_until_complete(
                self.update_display_name_async(first_name, last_name)
            )
