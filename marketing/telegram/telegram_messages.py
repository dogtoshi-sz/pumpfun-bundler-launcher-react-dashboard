#!/usr/bin/env python3
"""
Telegram Message Monitor & Reply System
Fetches messages from Telegram groups and sends replies
"""

import sys
import json
import os
import asyncio
from telethon import TelegramClient
from telethon.tl.types import User, Channel, Chat
from datetime import datetime, timedelta
from dotenv import load_dotenv

# Load .env from project root
env_path = os.path.join(os.path.dirname(__file__), '..', '..', '.env')
if os.path.exists(env_path):
    load_dotenv(env_path)

class TelegramMessageManager:
    def __init__(self, api_id, api_hash, phone):
        self.api_id = api_id
        self.api_hash = api_hash
        self.phone = phone
        self.client = None
        
    async def initialize(self):
        """Initialize Telegram client"""
        # Session file in marketing/telegram directory
        session_dir = os.path.dirname(__file__)
        session_file = os.path.join(session_dir, f'telegram_session_{self.phone}')
        
        self.client = TelegramClient(session_file, self.api_id, self.api_hash)
        await self.client.start(phone=self.phone)
        return self.client.is_connected()
    
    async def get_messages(self, chat_id, limit=50, users_only=True, hours_ago=24):
        """
        Fetch recent messages from a Telegram group
        
        Args:
            chat_id: Chat ID or username (@groupname)
            limit: Number of messages to fetch
            users_only: Only fetch messages from users (exclude bots/service messages)
            hours_ago: Only fetch messages from last X hours
        """
        try:
            messages = []
            cutoff_time = datetime.now() - timedelta(hours=hours_ago)
            
            # Fetch messages
            async for message in self.client.iter_messages(chat_id, limit=limit):
                # Skip if older than cutoff
                if message.date < cutoff_time:
                    continue
                
                # Skip service messages
                if message.service:
                    continue
                    
                # Get sender info
                sender = await message.get_sender()
                
                # Skip if users_only and sender is a bot
                if users_only and sender and getattr(sender, 'bot', False):
                    continue
                
                # Build message object
                msg_obj = {
                    'id': message.id,
                    'text': message.text or '',
                    'date': message.date.isoformat(),
                    'timestamp': int(message.date.timestamp()),
                    'sender': {
                        'id': sender.id if sender else None,
                        'username': getattr(sender, 'username', None),
                        'first_name': getattr(sender, 'first_name', None),
                        'last_name': getattr(sender, 'last_name', None),
                        'is_bot': getattr(sender, 'bot', False),
                    },
                    'has_media': message.media is not None,
                    'is_reply': message.reply_to is not None,
                }
                
                messages.append(msg_obj)
            
            return {
                'success': True,
                'messages': messages,
                'count': len(messages),
                'chat_id': str(chat_id),
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'messages': [],
            }
    
    async def send_message(self, chat_id, text, reply_to_msg_id=None):
        """
        Send a message to a Telegram group
        
        Args:
            chat_id: Chat ID or username
            text: Message text
            reply_to_msg_id: Optional message ID to reply to
        """
        try:
            message = await self.client.send_message(
                chat_id,
                text,
                reply_to=reply_to_msg_id
            )
            
            return {
                'success': True,
                'message_id': message.id,
                'date': message.date.isoformat(),
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
            }
    
    async def pin_message(self, chat_id, message_id):
        """Pin a message in the chat"""
        try:
            await self.client.pin_message(chat_id, message_id)
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    async def delete_message(self, chat_id, message_id):
        """Delete a message"""
        try:
            await self.client.delete_messages(chat_id, [message_id])
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    async def get_chat_info(self, chat_id):
        """Get information about a chat"""
        try:
            entity = await self.client.get_entity(chat_id)
            
            info = {
                'id': entity.id,
                'title': getattr(entity, 'title', None),
                'username': getattr(entity, 'username', None),
                'participants_count': getattr(entity, 'participants_count', None),
                'type': type(entity).__name__,
            }
            
            return {
                'success': True,
                'chat': info,
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
            }
    
    async def close(self):
        """Close client connection"""
        if self.client:
            await self.client.disconnect()

async def main():
    """Main entry point"""
    try:
        # Read request from stdin
        request_json = sys.stdin.read()
        request = json.loads(request_json)
        
        action = request.get('action')
        api_id = request.get('api_id')
        api_hash = request.get('api_hash')
        phone = request.get('phone')
        chat_id = request.get('chat_id')
        
        # Validate required fields
        if not all([api_id, api_hash, phone]):
            print(json.dumps({
                'success': False,
                'error': 'Missing required credentials (api_id, api_hash, phone)',
            }))
            return
        
        # Initialize manager
        manager = TelegramMessageManager(api_id, api_hash, phone)
        await manager.initialize()
        
        result = None
        
        # Handle different actions
        if action == 'get_messages':
            limit = request.get('limit', 50)
            users_only = request.get('users_only', True)
            hours_ago = request.get('hours_ago', 24)
            result = await manager.get_messages(chat_id, limit, users_only, hours_ago)
            
        elif action == 'send_message':
            text = request.get('text')
            reply_to = request.get('reply_to_msg_id')
            if not text:
                result = {'success': False, 'error': 'Missing message text'}
            else:
                result = await manager.send_message(chat_id, text, reply_to)
                
        elif action == 'pin_message':
            message_id = request.get('message_id')
            if not message_id:
                result = {'success': False, 'error': 'Missing message_id'}
            else:
                result = await manager.pin_message(chat_id, message_id)
                
        elif action == 'delete_message':
            message_id = request.get('message_id')
            if not message_id:
                result = {'success': False, 'error': 'Missing message_id'}
            else:
                result = await manager.delete_message(chat_id, message_id)
                
        elif action == 'get_chat_info':
            result = await manager.get_chat_info(chat_id)
            
        else:
            result = {'success': False, 'error': f'Unknown action: {action}'}
        
        # Close connection
        await manager.close()
        
        # Output result as JSON
        print(json.dumps(result, indent=2))
        
    except json.JSONDecodeError as e:
        print(json.dumps({
            'success': False,
            'error': f'Invalid JSON input: {str(e)}',
        }))
    except Exception as e:
        print(json.dumps({
            'success': False,
            'error': f'Unexpected error: {str(e)}',
        }))

if __name__ == '__main__':
    asyncio.run(main())
