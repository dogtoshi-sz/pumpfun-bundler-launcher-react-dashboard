/**
 * Telegram Account Verification Wrapper
 * 
 * Wraps the Python verification script for non-interactive Telegram account verification
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

interface TelegramVerificationOptions {
  api_id: string;
  api_hash: string;
  phone: string;
  code?: string;
  phone_code_hash?: string;
  password?: string;
}

/**
 * Get Telegram directory path
 * Matches Nodematrix-v2 approach but for marketing/telegram location
 */
function getTelegramDir(): string {
  // If TELEGRAM_PYTHON_DIR is set, use it (for custom deployments)
  if (process.env.TELEGRAM_PYTHON_DIR) {
    return process.env.TELEGRAM_PYTHON_DIR;
  }
  
  // Get current working directory (where the API server is running from)
  const cwd = process.cwd();
  
  // Check if we're in api-server directory - if so, go up one level to project root
  const isApiServer = cwd.endsWith('api-server') || path.basename(cwd) === 'api-server';
  const projectRoot = isApiServer ? path.resolve(cwd, '..') : cwd;
  
  // Try marketing/telegram from project root
  const telegramDir = path.join(projectRoot, 'marketing', 'telegram');
  
  if (fs.existsSync(telegramDir)) {
    console.log(`[Telegram Verification] Using telegram directory: ${telegramDir}`);
    return telegramDir;
  }
  
  // Fallback: try current directory
  console.warn(`[Telegram Verification] Telegram directory not found at ${telegramDir}, using current directory: ${cwd}`);
  return cwd;
}

/**
 * Detect Python command (python3, python, py)
 */
function detectPythonCommand(): string {
  const commands = ['python3', 'python', 'py'];
  for (const cmd of commands) {
    try {
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
 * Run Python verification script
 */
async function runVerificationScript(action: string, options: TelegramVerificationOptions): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      const telegramDir = getTelegramDir();
      const pythonScript = path.join(telegramDir, 'verify_account.py');
      
      if (!fs.existsSync(pythonScript)) {
        return reject(new Error(`Python script not found: ${pythonScript}`));
      }

      let pythonCmd: string;
      try {
        pythonCmd = detectPythonCommand();
      } catch (error: any) {
        return reject(new Error(`Python not found: ${error.message}`));
      }

      const sessionName = `telegram_session_${options.phone.replace(/\+|-| /g, '')}`;
      
      const requestData = {
        action,
        api_id: options.api_id,
        api_hash: options.api_hash,
        phone: options.phone,
        session_name: sessionName,
        ...(options.code && { code: options.code }),
        ...(options.phone_code_hash && { phone_code_hash: options.phone_code_hash }),
        ...(options.password && { password: options.password }),
      };

      console.log(`[Telegram Verification] Running ${action}...`);
      console.log(`[Telegram Verification] Python command: ${pythonCmd}`);
      console.log(`[Telegram Verification] Script path: ${pythonScript}`);
      console.log(`[Telegram Verification] Request data:`, JSON.stringify(requestData, null, 2));
      
      // Ensure PYTHONPATH includes the telegram directory so imports work
      const pythonPath = process.env.PYTHONPATH 
        ? `${telegramDir}${path.delimiter}${process.env.PYTHONPATH}`
        : telegramDir;
      
      const pythonProcess = spawn(pythonCmd, [pythonScript], {
        cwd: telegramDir, // Working directory must be telegramDir for relative imports
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONPATH: pythonPath, // Add telegram directory to Python path
          PYTHONUNBUFFERED: '1', // Ensure output is not buffered
        },
      });

      let stdout = '';
      let stderr = '';

      // Send JSON to Python script via stdin
      console.log(`[Telegram Verification] Sending request to Python script...`);
      pythonProcess.stdin.write(JSON.stringify(requestData));
      pythonProcess.stdin.end();

      pythonProcess.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        console.log(`[Telegram Verification Python Output]`, output.trim());
      });

      pythonProcess.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        console.error('[Telegram Verification Python Error]', output.trim());
      });

      pythonProcess.on('close', (code) => {
        console.log(`[Telegram Verification] Python process exited with code: ${code}`);
        console.log(`[Telegram Verification] STDOUT: ${stdout || '(empty)'}`);
        console.log(`[Telegram Verification] STDERR: ${stderr || '(empty)'}`);
        
        if (code !== 0) {
          return reject(new Error(`Python script failed with exit code ${code}\nSTDERR: ${stderr}\nSTDOUT: ${stdout}`));
        }

        if (!stdout.trim()) {
          return reject(new Error(`Python script returned no output\nSTDERR: ${stderr || '(empty)'}`));
        }

        try {
          const result = JSON.parse(stdout.trim());
          console.log(`[Telegram Verification] Parsed result:`, JSON.stringify(result, null, 2));
          resolve(result);
        } catch (parseError: any) {
          reject(new Error(`Failed to parse Python script output: ${parseError.message}\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`));
        }
      });

      pythonProcess.on('error', (error) => {
        reject(new Error(`Failed to start Python process: ${error.message}`));
      });

      // Set timeout (2 minutes)
      setTimeout(() => {
        if (!pythonProcess.killed) {
          pythonProcess.kill();
          reject(new Error('Python script timed out after 2 minutes'));
        }
      }, 2 * 60 * 1000);

    } catch (error: any) {
      reject(error);
    }
  });
}

/**
 * Send verification code to phone number
 */
export async function sendTelegramVerificationCode(options: TelegramVerificationOptions): Promise<{
  success: boolean;
  message?: string;
  phone_code_hash?: string;
  authorized?: boolean;
  error?: string;
}> {
  try {
    const result = await runVerificationScript('send_code', options);
    return result;
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * Verify code and complete authentication
 */
export async function verifyTelegramCode(options: TelegramVerificationOptions): Promise<{
  success: boolean;
  message?: string;
  authorized?: boolean;
  requires_2fa?: boolean;
  error?: string;
}> {
  if (!options.code) {
    return {
      success: false,
      error: 'Verification code is required',
    };
  }

  try {
    const result = await runVerificationScript('verify_code', options);
    return result;
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * Check if account is already verified
 */
export async function checkTelegramStatus(options: TelegramVerificationOptions): Promise<{
  success: boolean;
  authorized?: boolean;
  message?: string;
  error?: string;
}> {
  try {
    const result = await runVerificationScript('check_status', options);
    return result;
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Unknown error',
    };
  }
}

