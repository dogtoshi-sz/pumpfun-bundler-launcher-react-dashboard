/**
 * Recovery script for EVM Intermediary Wallets
 * 
 * This script helps recover funds from EVM intermediary wallets
 * used in the cross-chain private funding feature.
 * 
 * Usage: npx ts-node scripts/recover-evm-intermediary.ts
 */

import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as readline from 'readline';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const EVM_WALLETS_PATH = path.join(__dirname, '..', 'keys', 'evm-intermediary-wallets.json');

interface IntermediaryWallet {
  id: string;
  address: string;
  privateKey: string;
  createdAt: string;
  chain: string;
  status: string;
  balance?: string;
}

interface WalletData {
  description: string;
  wallets: IntermediaryWallet[];
}

async function loadWallets(): Promise<WalletData> {
  try {
    if (fs.existsSync(EVM_WALLETS_PATH)) {
      return JSON.parse(fs.readFileSync(EVM_WALLETS_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading EVM wallets:', e);
  }
  return { description: '', wallets: [] };
}

async function getProvider(chain: string): Promise<ethers.JsonRpcProvider> {
  const rpcUrls: Record<string, string> = {
    ethereum: process.env.ETH_RPC_URL || 'https://ethereum.publicnode.com',
    base: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  };
  return new ethers.JsonRpcProvider(rpcUrls[chain] || rpcUrls.base);
}

async function checkBalances() {
  const data = await loadWallets();
  
  console.log('\n=== EVM Intermediary Wallets ===\n');
  
  if (data.wallets.length === 0) {
    console.log('No intermediary wallets found.');
    return;
  }
  
  for (const wallet of data.wallets) {
    const chain = wallet.chain || 'base';
    const provider = await getProvider(chain);
    
    try {
      const balance = await provider.getBalance(wallet.address);
      const balanceEth = ethers.formatEther(balance);
      
      console.log(`Wallet: ${wallet.address}`);
      console.log(`  Chain: ${chain}`);
      console.log(`  Balance: ${balanceEth} ETH`);
      console.log(`  Status: ${wallet.status}`);
      console.log(`  Created: ${wallet.createdAt}`);
      
      if (balance > 0n) {
        console.log('  ⚠️ FUNDS AVAILABLE - Can be recovered!');
      }
      console.log('');
    } catch (e) {
      console.log(`Wallet: ${wallet.address}`);
      console.log(`  Error checking balance: ${e}`);
      console.log('');
    }
  }
}

async function recoverFunds(walletAddress: string, destinationAddress: string) {
  const data = await loadWallets();
  const wallet = data.wallets.find(w => w.address.toLowerCase() === walletAddress.toLowerCase());
  
  if (!wallet) {
    console.error('Wallet not found!');
    return;
  }
  
  const chain = wallet.chain || 'base';
  const provider = await getProvider(chain);
  const signer = new ethers.Wallet(wallet.privateKey, provider);
  
  const balance = await provider.getBalance(wallet.address);
  console.log(`Current balance: ${ethers.formatEther(balance)} ETH`);
  
  if (balance === 0n) {
    console.log('No funds to recover.');
    return;
  }
  
  // Estimate gas
  const gasPrice = await provider.getFeeData();
  const gasLimit = 21000n;
  const gasCost = gasLimit * (gasPrice.gasPrice || 0n);
  
  const amountToSend = balance - gasCost;
  
  if (amountToSend <= 0n) {
    console.log('Balance too low to cover gas costs.');
    return;
  }
  
  console.log(`Sending ${ethers.formatEther(amountToSend)} ETH to ${destinationAddress}...`);
  
  const tx = await signer.sendTransaction({
    to: destinationAddress,
    value: amountToSend,
    gasLimit,
  });
  
  console.log(`Transaction sent: ${tx.hash}`);
  await tx.wait();
  console.log('✅ Funds recovered successfully!');
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, resolve);
    });
  };
  
  console.log('=== EVM Intermediary Wallet Recovery Tool ===\n');
  console.log('1. Check all wallet balances');
  console.log('2. Recover funds from a wallet');
  console.log('3. Exit\n');
  
  const choice = await question('Choose an option: ');
  
  switch (choice) {
    case '1':
      await checkBalances();
      break;
    case '2':
      await checkBalances();
      const walletAddr = await question('\nEnter wallet address to recover from: ');
      const destAddr = await question('Enter destination address: ');
      await recoverFunds(walletAddr.trim(), destAddr.trim());
      break;
    default:
      console.log('Exiting...');
  }
  
  rl.close();
}

main().catch(console.error);
