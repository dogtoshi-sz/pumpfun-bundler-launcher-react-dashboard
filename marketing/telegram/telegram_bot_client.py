#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Telegram Bot Client - Uses Bot API to send messages as a bot
"""
import logging
import requests
import time
from typing import List, Optional, Dict, Any

logger = logging.getLogger(__name__)

class TelegramBotClient:
    """Telegram Bot API Client"""
    
    def __init__(self, bot_token: str):
        """
        Initialize Telegram Bot Client
        
        Args:
            bot_token: Bot token from BotFather (e.g., "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11")
        """
        self.bot_token = bot_token
        self.api_url = f"https://api.telegram.org/bot{bot_token}"
        self._me = None
        
    def get_me(self) -> Dict[str, Any]:
        """Get bot information"""
        if self._me is None:
            response = requests.get(f"{self.api_url}/getMe")
            if response.status_code == 200:
                self._me = response.json().get('result', {})
            else:
                logger.error(f"Failed to get bot info: {response.text}")
                self._me = {}
        return self._me
    
    def get_bot_username(self) -> str:
        """Get bot username (without @)"""
        me = self.get_me()
        return me.get('username', '')
    
    def send_message(
        self,
        chat_id: str,
        text: str,
        reply_to_message_id: Optional[int] = None,
        parse_mode: str = "HTML",
        reply_markup: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Send a message as the bot
        
        Args:
            chat_id: Chat ID (can be negative for groups)
            text: Message text
            reply_to_message_id: Message ID to reply to
            parse_mode: Parse mode (HTML, Markdown, or None)
            reply_markup: Inline keyboard markup (for buttons)
        
        Returns:
            API response dict
        """
        payload = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": parse_mode
        }
        
        if reply_to_message_id:
            payload["reply_to_message_id"] = reply_to_message_id
        
        if reply_markup:
            payload["reply_markup"] = reply_markup
        
        try:
            response = requests.post(f"{self.api_url}/sendMessage", json=payload, timeout=10)
            if response.status_code == 200:
                result = response.json()
                if result.get('ok'):
                    logger.info(f"✅ Bot sent message to {chat_id}")
                    return result.get('result', {})
                else:
                    logger.error(f"❌ Bot API error: {result.get('description', 'Unknown error')}")
                    return {}
            else:
                logger.error(f"❌ Bot API HTTP error {response.status_code}: {response.text}")
                return {}
        except Exception as e:
            logger.error(f"❌ Bot send_message error: {e}")
            return {}
    
    def send_message_with_buttons(
        self,
        chat_id: str,
        text: str,
        buttons: List[List[Dict[str, str]]],
        reply_to_message_id: Optional[int] = None,
        parse_mode: str = "HTML"
    ) -> Dict[str, Any]:
        """
        Send a message with inline keyboard buttons
        
        Args:
            chat_id: Chat ID
            text: Message text
            buttons: List of button rows, each row is a list of button dicts
                     Each button dict should have 'text' and 'callback_data'
            reply_to_message_id: Message ID to reply to
            parse_mode: Parse mode
        
        Example:
            buttons = [
                [{"text": "SELL", "callback_data": "sell_123"}],
                [{"text": "PULL", "callback_data": "pull_123"}]
            ]
        
        Returns:
            API response dict
        """
        reply_markup = {
            "inline_keyboard": buttons
        }
        return self.send_message(chat_id, text, reply_to_message_id, parse_mode, reply_markup)
    
    def send_message_with_typing(
        self,
        chat_id: str,
        text: str,
        typing_duration: float = 2.0,
        reply_to_message_id: Optional[int] = None,
        parse_mode: str = "HTML"
    ) -> Dict[str, Any]:
        """
        Send a message with typing indicator simulation
        
        Args:
            chat_id: Chat ID
            text: Message text
            typing_duration: How long to "type" before sending (simulated)
            reply_to_message_id: Message ID to reply to
            parse_mode: Parse mode
        
        Returns:
            API response dict
        """
        # Send typing action
        try:
            typing_payload = {
                "chat_id": chat_id,
                "action": "typing"
            }
            requests.post(f"{self.api_url}/sendChatAction", json=typing_payload, timeout=5)
            
            # Wait for typing duration
            if typing_duration > 0:
                time.sleep(min(typing_duration, 5.0))  # Max 5 seconds for typing
        except Exception as e:
            logger.warning(f"Failed to send typing action: {e}")
        
        # Send the actual message
        return self.send_message(chat_id, text, reply_to_message_id, parse_mode)
    
    def get_updates(self, offset: Optional[int] = None, timeout: int = 0) -> List[Dict[str, Any]]:
        """
        Get bot updates (messages, mentions, etc.)
        
        Args:
            offset: Offset for pagination
            timeout: Long polling timeout
        
        Returns:
            List of updates
        """
        payload = {
            "timeout": timeout
        }
        if offset:
            payload["offset"] = offset
        
        try:
            response = requests.get(f"{self.api_url}/getUpdates", params=payload, timeout=timeout + 5)
            if response.status_code == 200:
                result = response.json()
                if result.get('ok'):
                    return result.get('result', [])
            return []
        except Exception as e:
            logger.error(f"Error getting updates: {e}")
            return []

