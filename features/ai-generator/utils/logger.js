/**
 * Colored console logging with prefixes
 */

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  
  // Foreground
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  
  // Background
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
};

const PREFIX = '[Orchestrator]';

function formatTime() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

const logger = {
  info: (message, ...args) => {
    console.log(`${colors.gray}${formatTime()}${colors.reset} ${colors.cyan}${PREFIX}${colors.reset} ${message}`, ...args);
  },
  
  success: (message, ...args) => {
    console.log(`${colors.gray}${formatTime()}${colors.reset} ${colors.green}${PREFIX} ✅${colors.reset} ${message}`, ...args);
  },
  
  warn: (message, ...args) => {
    console.log(`${colors.gray}${formatTime()}${colors.reset} ${colors.yellow}${PREFIX} ⚠️${colors.reset} ${message}`, ...args);
  },
  
  error: (message, ...args) => {
    console.log(`${colors.gray}${formatTime()}${colors.reset} ${colors.red}${PREFIX} ❌${colors.reset} ${message}`, ...args);
  },
  
  step: (stepNum, total, message) => {
    console.log(`${colors.gray}${formatTime()}${colors.reset} ${colors.magenta}${PREFIX}${colors.reset} ${colors.bright}[${stepNum}/${total}]${colors.reset} ${message}`);
  },
  
  domain: (message, ...args) => {
    console.log(`${colors.gray}${formatTime()}${colors.reset} ${colors.blue}[Domain]${colors.reset} ${message}`, ...args);
  },
  
  dns: (message, ...args) => {
    console.log(`${colors.gray}${formatTime()}${colors.reset} ${colors.yellow}[DNS]${colors.reset} ${message}`, ...args);
  },
  
  ai: (message, ...args) => {
    console.log(`${colors.gray}${formatTime()}${colors.reset} ${colors.magenta}[AI]${colors.reset} ${message}`, ...args);
  },
  
  launch: (message, ...args) => {
    console.log(`${colors.gray}${formatTime()}${colors.reset} ${colors.green}[Launch]${colors.reset} ${message}`, ...args);
  },
  
  debug: (message, ...args) => {
    if (process.env.DEBUG) {
      console.log(`${colors.gray}${formatTime()} [DEBUG] ${message}${colors.reset}`, ...args);
    }
  },
  
  divider: () => {
    console.log(`${colors.gray}${'─'.repeat(60)}${colors.reset}`);
  },
  
  banner: (text) => {
    const padding = 2;
    const width = text.length + (padding * 2) + 2;
    console.log();
    console.log(`${colors.cyan}${'═'.repeat(width)}${colors.reset}`);
    console.log(`${colors.cyan}║${' '.repeat(padding)}${colors.bright}${text}${colors.reset}${colors.cyan}${' '.repeat(padding)}║${colors.reset}`);
    console.log(`${colors.cyan}${'═'.repeat(width)}${colors.reset}`);
    console.log();
  },
};

module.exports = logger;
