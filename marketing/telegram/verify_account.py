#!/usr/bin/env python3
"""
Telegram Account Verification Script
Allows verification of Telegram accounts via API (non-interactive)
"""

import sys
import json
import asyncio
import logging
from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError, PhoneCodeInvalidError, PhoneCodeExpiredError

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def send_verification_code(api_id, api_hash, phone, session_name):
    """Send verification code to phone number"""
    try:
        client = TelegramClient(session_name, int(api_id), api_hash)
        await client.connect()
        
        if await client.is_user_authorized():
            return {
                "success": True,
                "message": "Account already verified",
                "authorized": True
            }
        
        # Send code
        result = await client.send_code_request(phone)
        await client.disconnect()
        
        return {
            "success": True,
            "message": "Verification code sent to Telegram app",
            "phone_code_hash": result.phone_code_hash,
            "authorized": False
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

async def verify_code(api_id, api_hash, phone, session_name, code, phone_code_hash=None, password=None):
    """Verify code and complete authentication"""
    try:
        client = TelegramClient(session_name, int(api_id), api_hash)
        await client.connect()
        
        if await client.is_user_authorized():
            return {
                "success": True,
                "message": "Account already verified",
                "authorized": True
            }
        
        try:
            # Sign in with code
            await client.sign_in(phone, code, phone_code_hash=phone_code_hash)
            
            # Check if authorized
            if await client.is_user_authorized():
                await client.disconnect()
                return {
                    "success": True,
                    "message": "Account verified successfully",
                    "authorized": True
                }
        except SessionPasswordNeededError:
            # 2FA required
            if password:
                try:
                    await client.sign_in(password=password)
                    if await client.is_user_authorized():
                        await client.disconnect()
                        return {
                            "success": True,
                            "message": "Account verified successfully (2FA)",
                            "authorized": True
                        }
                except Exception as e:
                    await client.disconnect()
                    return {
                        "success": False,
                        "error": f"2FA password incorrect: {str(e)}",
                        "requires_2fa": True
                    }
            else:
                await client.disconnect()
                return {
                    "success": False,
                    "error": "2FA password required",
                    "requires_2fa": True
                }
        except PhoneCodeInvalidError:
            await client.disconnect()
            return {
                "success": False,
                "error": "Invalid verification code"
            }
        except PhoneCodeExpiredError:
            await client.disconnect()
            return {
                "success": False,
                "error": "Verification code expired. Please request a new code."
            }
        except Exception as e:
            await client.disconnect()
            return {
                "success": False,
                "error": str(e)
            }
        
        await client.disconnect()
        return {
            "success": False,
            "error": "Verification failed"
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

async def check_status(api_id, api_hash, phone, session_name):
    """Check if account is already verified"""
    try:
        client = TelegramClient(session_name, int(api_id), api_hash)
        await client.connect()
        
        authorized = await client.is_user_authorized()
        await client.disconnect()
        
        return {
            "success": True,
            "authorized": authorized,
            "message": "Account is verified" if authorized else "Account needs verification"
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def main():
    """Main entry point"""
    try:
        # Read JSON from stdin
        input_data = json.loads(sys.stdin.read())
        action = input_data.get("action")
        
        api_id = input_data.get("api_id")
        api_hash = input_data.get("api_hash")
        phone = input_data.get("phone")
        session_name = input_data.get("session_name", f"telegram_session_{phone.replace('+', '').replace('-', '').replace(' ', '')}")
        
        if not api_id or not api_hash or not phone:
            print(json.dumps({
                "success": False,
                "error": "api_id, api_hash, and phone are required"
            }))
            sys.exit(1)
        
        if action == "send_code":
            result = asyncio.run(send_verification_code(api_id, api_hash, phone, session_name))
        elif action == "verify_code":
            code = input_data.get("code")
            phone_code_hash = input_data.get("phone_code_hash")
            password = input_data.get("password")
            if not code:
                print(json.dumps({
                    "success": False,
                    "error": "code is required"
                }))
                sys.exit(1)
            result = asyncio.run(verify_code(api_id, api_hash, phone, session_name, code, phone_code_hash, password))
        elif action == "check_status":
            result = asyncio.run(check_status(api_id, api_hash, phone, session_name))
        else:
            result = {
                "success": False,
                "error": f"Unknown action: {action}"
            }
        
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }))
        sys.exit(1)

if __name__ == "__main__":
    main()

