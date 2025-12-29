// Wrapper script to call TypeScript trading functions from Node.js
const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const execAsync = promisify(exec);

async function callTradingFunction(functionName, ...args) {
  const projectRoot = path.join(__dirname, '..');
  const fs = require('fs');
  
  // Create a temporary TypeScript file in project root to avoid import path issues
  const tempFile = path.join(projectRoot, `temp-trading-${Date.now()}.ts`);
  
  // Escape args properly for JSON
  const argsJson = JSON.stringify(args);
  
  const scriptContent = `import { ${functionName} } from './trading-terminal';

const args = ${argsJson};
${functionName}(...args)
  .then((r) => {
    console.log('RESULT:' + JSON.stringify(r));
    process.exit(0);
  })
  .catch((e) => {
    console.error('ERROR:', e.message);
    process.exit(1);
  });
`;
  
  try {
    // Write temporary file
    fs.writeFileSync(tempFile, scriptContent, 'utf8');
    
    // Use ts-node with a tsconfig that supports commonjs (required for ts-node)
    const tsconfigPath = path.join(projectRoot, 'tsconfig.ts-node.json');
    const command = `npx ts-node --project "${tsconfigPath}" --transpile-only "${tempFile}"`;
    
    const { stdout, stderr } = await execAsync(command, { 
      cwd: projectRoot,
      maxBuffer: 10 * 1024 * 1024,
      shell: true,
      env: { 
        ...process.env, 
        NODE_ENV: process.env.NODE_ENV || 'development'
      }
    });
    
    // Clean up temp file
    try {
      fs.unlinkSync(tempFile);
    } catch (e) {
      // Ignore cleanup errors
    }
    
    // Check for errors in stderr
    if (stderr) {
      // ts-node often outputs to stderr even on success, so check for actual errors
      if (stderr.includes('ERROR:') || stderr.includes('Error:')) {
        const errorMatch = stderr.match(/ERROR:\s*(.+)/i) || stderr.match(/Error:\s*(.+)/i);
        throw new Error(errorMatch ? errorMatch[1] : stderr);
      }
    }
    
    // Extract JSON result from stdout
    const resultMatch = stdout.match(/RESULT:(.+)/);
    if (resultMatch) {
      try {
        return JSON.parse(resultMatch[1]);
      } catch (e) {
        // If parsing fails, return the raw output
        return { success: true, message: 'Transaction sent', output: stdout };
      }
    }
    
    // If no RESULT found, check if there's an error in stdout
    if (stdout.includes('ERROR:')) {
      const errorMatch = stdout.match(/ERROR:\s*(.+)/i);
      throw new Error(errorMatch ? errorMatch[1] : stdout);
    }
    
    return { success: true, message: 'Transaction sent', output: stdout };
  } catch (error) {
    // Clean up temp file on error
    try {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    } catch (e) {
      // Ignore cleanup errors
    }
    
    // Extract error message
    let errorMessage = error.message || 'Unknown error';
    if (error.stderr) {
      const errorMatch = error.stderr.match(/ERROR:\s*(.+)/i);
      if (errorMatch) {
        errorMessage = errorMatch[1];
      } else if (error.stderr.includes('Error')) {
        errorMessage = error.stderr;
      }
    }
    
    throw new Error(errorMessage);
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

