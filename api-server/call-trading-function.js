// FAST wrapper - uses direct require instead of spawning processes
// Register ts-node once at startup for direct TypeScript imports
const path = require('path');
const fs = require('fs');

// Determine project root - handles both local and Railway deployments
const getProjectRoot = () => {
  const isRailway = process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID;
  if (isRailway) {
    const parentSrc = path.join(__dirname, '..', 'src');
    if (fs.existsSync(parentSrc)) {
      return path.join(__dirname, '..');
    }
    return __dirname;
  }
  return path.join(__dirname, '..');
};
const projectRoot = getProjectRoot();

// Register ts-node/esm loader for TypeScript imports
require('ts-node').register({
  project: path.join(projectRoot, 'tsconfig.ts-node.json'),
  transpileOnly: true,
  compilerOptions: {
    module: 'commonjs',
    esModuleInterop: true
  }
});

// Cache the imported module to avoid re-importing each time
let tradingTerminal = null;

function getTradingTerminal() {
  if (!tradingTerminal) {
    try {
      // Trading terminal is now in cli/ directory
      tradingTerminal = require(path.join(projectRoot, 'cli', 'trading-terminal.ts'));
      console.log('[Trading] ✅ Trading terminal loaded (fast mode)');
    } catch (e) {
      console.error('[Trading] ❌ Failed to load trading-terminal:', e.message);
      throw e;
    }
  }
  return tradingTerminal;
}

async function callTradingFunction(functionName, ...args) {
  try {
    const terminal = getTradingTerminal();
    const fn = terminal[functionName];
    
    if (typeof fn !== 'function') {
      throw new Error(`Function ${functionName} not found in trading-terminal`);
    }
    
    console.log(`[Trading] ⚡ Calling ${functionName} directly (no process spawn)`);
    const startTime = Date.now();
    
    const result = await fn(...args);
    
    const elapsed = Date.now() - startTime;
    console.log(`[Trading] ✅ ${functionName} completed in ${elapsed}ms`);
    
    return result;
  } catch (error) {
    console.error(`[Trading] ❌ ${functionName} failed:`, error.message);
    throw error;
  }
}

// CLI usage
if (require.main === module) {
  const [functionName, ...args] = process.argv.slice(2);
  
  if (!functionName) {
    console.error('Usage: node call-trading-function.js <functionName> [args...]');
    process.exit(1);
  }
  
  callTradingFunction(functionName, ...args)
    .then(result => {
      console.log(JSON.stringify(result));
      process.exit(0);
    })
    .catch(error => {
      console.error('ERROR:', error.message);
      process.exit(1);
    });
}

module.exports = { callTradingFunction };
