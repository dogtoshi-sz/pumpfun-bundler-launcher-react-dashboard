/**
 * Telegram Group/Channel Creation Wrapper
 * 
 * Wraps the Python/Telethon script for creating Telegram groups/channels
 * Calls the Python script via child_process
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

interface TelegramConfig {
  telegram_api_id: string;
  telegram_api_hash: string;
  telegram_phone: string;
  token_name?: string;
  token_symbol?: string;
  token_address?: string;
  website?: string;
  telegram?: string;
  twitter?: string;
  description?: string;
  chain?: string;
  create_group?: boolean;
  create_channel?: boolean;
  channel_username?: string;
  group_title_template?: string;
  group_description?: string;
  group_photo_base64?: string;
  token_image_url?: string;
  use_safeguard_bot?: boolean;
  safeguard_bot_username?: string;
  create_portal?: boolean;
  reuse_existing?: boolean;
  existing_group_chat_id?: string;
  existing_channel_chat_id?: string;
  filter_script?: string;
  users?: Record<string, any>;
  invite_users?: string[];
}

interface TelegramCreateOptions {
  config: TelegramConfig;
  scripted_conversations?: any[];
}

/**
 * Get Telegram directory path
 */
function getTelegramDir(): string {
  // Check if telegram directory exists in project root
  const projectTelegramDir = path.join(process.cwd(), 'marketing', 'telegram');
  if (fs.existsSync(projectTelegramDir)) {
    return projectTelegramDir;
  }
  
  // Fallback to current directory
  return process.cwd();
}

/**
 * Detect Python command (python3, python, py)
 */
function detectPythonCommand(): string {
  const commands = ['python3', 'python', 'py'];
  for (const cmd of commands) {
    try {
      // Try to run python --version (synchronous check)
      const { execSync } = require('child_process');
      execSync(`${cmd} --version`, { stdio: 'ignore' });
      return cmd;
    } catch {
      continue;
    }
  }
  throw new Error('Python not found. Please install Python 3.x');
}

/**
 * Create Telegram group/channel using Python script
 */
export async function createTelegramGroup(options: TelegramCreateOptions): Promise<{
  success: boolean;
  group_chat_id?: string;
  channel_chat_id?: string;
  telegram_link?: string;
  error?: string;
  message?: string;
}> {
  return new Promise((resolve) => {
    try {
      const { config, scripted_conversations = [] } = options;
      
      // Validate required fields
      if (!config.telegram_api_id || !config.telegram_api_hash || !config.telegram_phone) {
        return resolve({
          success: false,
          error: 'Telegram API credentials are required (api_id, api_hash, phone)',
        });
      }

      // Get Telegram directory and Python script path
      const telegramDir = getTelegramDir();
      const pythonScript = path.join(telegramDir, 'run_campaign.py');
      
      // Check if Python script exists
      if (!fs.existsSync(pythonScript)) {
        return resolve({
          success: false,
          error: `Python script not found: ${pythonScript}\n\nPlease copy the Telegram Python files from Nodematrix-v2/telegram/ to marketing/telegram/:\n- run_campaign.py\n- telegram_user_client.py\n- telegram_campaign.py\n- config.py\n- requirements.txt`,
        });
      }

      // Detect Python command
      let pythonCmd: string;
      try {
        pythonCmd = detectPythonCommand();
      } catch (error: any) {
        return resolve({
          success: false,
          error: `Python not found: ${error.message}\n\nPlease install Python 3.x and ensure it's in your PATH.`,
        });
      }

      // Prepare request body for Python script
      const requestBody = {
        config: {
          campaign_id: `telegram_group_${Date.now()}`,
          direction: 'Telegram group/channel creation',
          chat_ids: [],
          users: config.users || {},
          ...config,
        },
        scripted_conversations: scripted_conversations,
      };

      console.log('[Telegram] Starting Python script...');
      console.log('[Telegram] Script:', pythonScript);
      console.log('[Telegram] Token:', config.token_name || 'N/A');

      // Spawn Python process
      const pythonProcess = spawn(pythonCmd, [pythonScript], {
        cwd: telegramDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // Pass credentials as environment variables (Python script will read from config)
          TELEGRAM_API_ID: config.telegram_api_id,
          TELEGRAM_API_HASH: config.telegram_api_hash,
          TELEGRAM_PHONE_NUMBER: config.telegram_phone,
        },
      });

      let stdout = '';
      let stderr = '';

      // Send JSON config to Python script via stdin
      pythonProcess.stdin.write(JSON.stringify(requestBody));
      pythonProcess.stdin.end();

      // Collect stdout
      pythonProcess.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        console.log('[Telegram Python]', output.trim());
      });

      // Collect stderr
      pythonProcess.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        console.error('[Telegram Python Error]', output.trim());
      });

      // Handle process completion
      pythonProcess.on('close', (code) => {
        if (code !== 0) {
          console.error(`[Telegram] Python script exited with code ${code}`);
          return resolve({
            success: false,
            error: `Python script failed with exit code ${code}\n\nSTDERR:\n${stderr}\n\nSTDOUT:\n${stdout}`,
          });
        }

        // Try to parse JSON response from stdout
        try {
          // Look for JSON in stdout (Python script should output JSON at the end)
          const jsonMatch = stdout.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            if (result.success) {
              return resolve({
                success: true,
                group_chat_id: result.group_chat_id,
                channel_chat_id: result.channel_chat_id,
                telegram_link: result.telegram_link,
                message: result.message || 'Telegram group/channel created successfully',
              });
            } else {
              return resolve({
                success: false,
                error: result.error || result.message || 'Unknown error from Python script',
              });
            }
          }

          // If no JSON found, check for success indicators in output
          if (stdout.includes('success') || stdout.includes('created') || stdout.includes('t.me/')) {
            // Try to extract telegram link
            const linkMatch = stdout.match(/t\.me\/[a-zA-Z0-9_]+/);
            const telegramLink = linkMatch ? `https://${linkMatch[0]}` : undefined;

            // Try to extract chat IDs
            const groupIdMatch = stdout.match(/group[_\s]*chat[_\s]*id[:\s]*(-?\d+)/i);
            const channelIdMatch = stdout.match(/channel[_\s]*chat[_\s]*id[:\s]*(-?\d+)/i);

            return resolve({
              success: true,
              group_chat_id: groupIdMatch ? groupIdMatch[1] : undefined,
              channel_chat_id: channelIdMatch ? channelIdMatch[1] : undefined,
              telegram_link: telegramLink,
              message: 'Telegram group/channel created (parsed from output)',
            });
          }

          // If we can't parse, return error with full output
          return resolve({
            success: false,
            error: `Could not parse Python script output\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`,
          });
        } catch (parseError: any) {
          return resolve({
            success: false,
            error: `Failed to parse Python script output: ${parseError.message}\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`,
          });
        }
      });

      // Handle process errors
      pythonProcess.on('error', (error) => {
        console.error('[Telegram] Python process error:', error);
        return resolve({
          success: false,
          error: `Failed to start Python process: ${error.message}\n\nMake sure Python 3.x is installed and in your PATH.`,
        });
      });

      // Set timeout (5 minutes)
      setTimeout(() => {
        if (!pythonProcess.killed) {
          pythonProcess.kill();
          return resolve({
            success: false,
            error: 'Python script timed out after 5 minutes',
          });
        }
      }, 5 * 60 * 1000);

    } catch (error: any) {
      console.error('[Telegram] Error:', error);
      return resolve({
        success: false,
        error: error.message || 'Unknown error',
      });
    }
  });
}



