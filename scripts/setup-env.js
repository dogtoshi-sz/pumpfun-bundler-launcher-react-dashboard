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
  const projectRoot = path.join(__dirname, '..');
  const keysDir = path.join(projectRoot, 'keys');
  
  // Create keys directory if it doesn't exist
  if (!fs.existsSync(keysDir)) {
    fs.mkdirSync(keysDir, { recursive: true });
    console.log('✓ Created keys directory');
  }
  
  // Create all necessary subdirectories in keys/
  const requiredDirs = [
    'trade-configs',    // For auto-sell and auto-buy configs
    'token-configs',    // For saved token configurations
    'wallet-profiles',  // For wallet profile management
    'pnl'               // For profit/loss tracking
  ];
  
  for (const dir of requiredDirs) {
    const dirPath = path.join(keysDir, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`✓ Created keys/${dir} directory`);
    }
  }
  
  // Create image directory if it doesn't exist (for logo uploads)
  const imageDir = path.join(projectRoot, 'image');
  if (!fs.existsSync(imageDir)) {
    fs.mkdirSync(imageDir, { recursive: true });
    console.log('✓ Created image directory');
  }
  
  // Create image/createdlogos subdirectory (for generated logos)
  const createdLogosDir = path.join(imageDir, 'createdlogos');
  if (!fs.existsSync(createdLogosDir)) {
    fs.mkdirSync(createdLogosDir, { recursive: true });
    console.log('✓ Created image/createdlogos directory');
  }
  
  // Create psd-assets directory if it doesn't exist (for PSD uploads)
  const psdAssetsDir = path.join(projectRoot, 'psd-assets');
  if (!fs.existsSync(psdAssetsDir)) {
    fs.mkdirSync(psdAssetsDir, { recursive: true });
    console.log('✓ Created psd-assets directory');
  }
  
} catch (error) {
  console.error('✗ Error creating directory structure:', error.message);
  // Don't exit on directory creation errors - they're not critical
}
