/**
 * Telegram Message Manager Wrapper
 * 
 * TypeScript wrapper for telegram_messages.py
 * Handles fetching messages, sending messages, and moderation
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

interface TelegramMessageRequest {
  action: 'get_messages' | 'send_message' | 'pin_message' | 'delete_message' | 'get_chat_info';
  api_id: string;
  api_hash: string;
  phone: string;
  chat_id: string;
  // Optional fields
  limit?: number;
  users_only?: boolean;
  hours_ago?: number;
  text?: string;
  reply_to_msg_id?: number;
  message_id?: number;
}

interface TelegramMessage {
  id: number;
  text: string;
  date: string;
  timestamp: number;
  sender: {
    id: number | null;
    username: string | null;
    first_name: string | null;
    last_name: string | null;
    is_bot: boolean;
  };
  has_media: boolean;
  is_reply: boolean;
}

interface TelegramMessagesResponse {
  success: boolean;
  messages?: TelegramMessage[];
  count?: number;
  chat_id?: string;
  error?: string;
  message_id?: number;
  date?: string;
  chat?: any;
}

/**
 * Get Telegram directory path
 */
function getTelegramDir(): string {
  if (process.env.TELEGRAM_PYTHON_DIR) {
    return process.env.TELEGRAM_PYTHON_DIR;
  }
  
  const cwd = process.cwd();
  const isApiServer = cwd.endsWith('api-server') || path.basename(cwd) === 'api-server';
  const projectRoot = isApiServer ? path.resolve(cwd, '..') : cwd;
  const telegramDir = path.join(projectRoot, 'marketing', 'telegram');
  
  if (fs.existsSync(telegramDir)) {
    return telegramDir;
  }
  
  return cwd;
}

/**
 * Detect Python command
 */
function detectPythonCommand(): string {
  const { execSync } = require('child_process');
  const commands = ['python3', 'python3.11', 'python3.10', 'python3.9', 'python3.8', 'py', 'python'];
  
  for (const cmd of commands) {
    try {
      execSync(`${cmd} --version`, { stdio: 'ignore', timeout: 2000 });
      
      try {
        const telegramDir = getTelegramDir();
        execSync(`${cmd} -c "import dotenv; import telethon"`, { 
          stdio: 'ignore', 
          timeout: 2000,
          cwd: telegramDir
        });
        return cmd;
      } catch {
        continue;
      }
    } catch {
      continue;
    }
  }
  
  return 'python';
}

/**
 * Execute Telegram message action
 */
export async function executeTelegramAction(request: TelegramMessageRequest): Promise<TelegramMessagesResponse> {
  return new Promise((resolve) => {
    try {
      const telegramDir = getTelegramDir();
      const pythonScript = path.join(telegramDir, 'telegram_messages.py');
      
      if (!fs.existsSync(pythonScript)) {
        return resolve({
          success: false,
          error: `Python script not found: ${pythonScript}`,
        });
      }
      
      const pythonCmd = detectPythonCommand();
      console.log(`[Telegram Messages] Using Python: ${pythonCmd}`);
      console.log(`[Telegram Messages] Action: ${request.action}`);
      console.log(`[Telegram Messages] Chat ID: ${request.chat_id}`);
      
      const pythonPath = process.env.PYTHONPATH 
        ? `${telegramDir}${path.delimiter}${process.env.PYTHONPATH}`
        : telegramDir;
      
      const pythonProcess = spawn(pythonCmd, [pythonScript], {
        cwd: telegramDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONPATH: pythonPath,
          PYTHONUNBUFFERED: '1',
        },
      });
      
      let stdout = '';
      let stderr = '';
      
      // Send request to Python script
      pythonProcess.stdin.write(JSON.stringify(request));
      pythonProcess.stdin.end();
      
      pythonProcess.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        console.log('[Telegram Messages Python]', output.trim());
      });
      
      pythonProcess.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        console.error('[Telegram Messages Error]', output.trim());
      });
      
      pythonProcess.on('close', (code) => {
        if (code !== 0) {
          return resolve({
            success: false,
            error: `Python script exited with code ${code}\n\nSTDERR:\n${stderr}`,
          });
        }
        
        try {
          const jsonMatch = stdout.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            return resolve(result);
          }
          
          return resolve({
            success: false,
            error: `Could not parse Python output\n\nSTDOUT:\n${stdout}`,
          });
        } catch (parseError: any) {
          return resolve({
            success: false,
            error: `Failed to parse output: ${parseError.message}`,
          });
        }
      });
      
      pythonProcess.on('error', (error) => {
        return resolve({
          success: false,
          error: `Failed to start Python: ${error.message}`,
        });
      });
      
      // Timeout: 30 seconds
      setTimeout(() => {
        if (!pythonProcess.killed) {
          pythonProcess.kill();
          return resolve({
            success: false,
            error: 'Operation timed out after 30 seconds',
          });
        }
      }, 30000);
      
    } catch (error: any) {
      return resolve({
        success: false,
        error: error.message || 'Unknown error',
      });
    }
  });
}

/**
 * Get messages from Telegram group
 */
export async function getTelegramMessages(
  apiId: string,
  apiHash: string,
  phone: string,
  chatId: string,
  limit: number = 50,
  usersOnly: boolean = true,
  hoursAgo: number = 24
): Promise<TelegramMessagesResponse> {
  return executeTelegramAction({
    action: 'get_messages',
    api_id: apiId,
    api_hash: apiHash,
    phone: phone,
    chat_id: chatId,
    limit: limit,
    users_only: usersOnly,
    hours_ago: hoursAgo,
  });
}

/**
 * Send message to Telegram group
 */
export async function sendTelegramMessage(
  apiId: string,
  apiHash: string,
  phone: string,
  chatId: string,
  text: string,
  replyToMsgId?: number
): Promise<TelegramMessagesResponse> {
  return executeTelegramAction({
    action: 'send_message',
    api_id: apiId,
    api_hash: apiHash,
    phone: phone,
    chat_id: chatId,
    text: text,
    reply_to_msg_id: replyToMsgId,
  });
}

/**
 * Pin message in Telegram group
 */
export async function pinTelegramMessage(
  apiId: string,
  apiHash: string,
  phone: string,
  chatId: string,
  messageId: number
): Promise<TelegramMessagesResponse> {
  return executeTelegramAction({
    action: 'pin_message',
    api_id: apiId,
    api_hash: apiHash,
    phone: phone,
    chat_id: chatId,
    message_id: messageId,
  });
}

/**
 * Delete message from Telegram group
 */
export async function deleteTelegramMessage(
  apiId: string,
  apiHash: string,
  phone: string,
  chatId: string,
  messageId: number
): Promise<TelegramMessagesResponse> {
  return executeTelegramAction({
    action: 'delete_message',
    api_id: apiId,
    api_hash: apiHash,
    phone: phone,
    chat_id: chatId,
    message_id: messageId,
  });
}

/**
 * Get chat information
 */
export async function getTelegramChatInfo(
  apiId: string,
  apiHash: string,
  phone: string,
  chatId: string
): Promise<TelegramMessagesResponse> {
  return executeTelegramAction({
    action: 'get_chat_info',
    api_id: apiId,
    api_hash: apiHash,
    phone: phone,
    chat_id: chatId,
  });
}
