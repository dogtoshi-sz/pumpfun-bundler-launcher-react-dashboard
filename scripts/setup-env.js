#!/usr/bin/env node

/**
 * Setup script to automatically create .env from .env.example
 * Runs automatically after npm install via postinstall script
 */

const fs = require('fs');
const path = require('path');

const envExamplePath = path.join(__dirname, '..', '.env.example');
const envPath = path.join(__dirname, '..', '.env');

// Check if .env.example exists
if (!fs.existsSync(envExamplePath)) {
  console.log('⚠️  .env.example not found. Skipping setup.');
  process.exit(0);
}

// Check if .env already exists
if (fs.existsSync(envPath)) {
  console.log('✓ .env file already exists. Skipping auto-setup.');
} else {
  // Copy .env.example to .env
  try {
    fs.copyFileSync(envExamplePath, envPath);
    console.log('✓ Created .env file from .env.example');
    console.log('⚠️  Please edit .env and add your PRIVATE_KEY and RPC_ENDPOINT before running the app.');
  } catch (error) {
    console.error('✗ Error creating .env file:', error.message);
    process.exit(1);
  }
}

// Create necessary directory structure
try {
  const keysDir = path.join(__dirname, '..', 'keys');
  const tradeConfigsDir = path.join(keysDir, 'trade-configs');
  
  // Create keys directory if it doesn't exist
  if (!fs.existsSync(keysDir)) {
    fs.mkdirSync(keysDir, { recursive: true });
    console.log('✓ Created keys directory');
  }
  
  // Create trade-configs directory if it doesn't exist
  if (!fs.existsSync(tradeConfigsDir)) {
    fs.mkdirSync(tradeConfigsDir, { recursive: true });
    console.log('✓ Created keys/trade-configs directory');
  }
} catch (error) {
  console.error('✗ Error creating directory structure:', error.message);
  // Don't exit on directory creation errors - they're not critical
}
