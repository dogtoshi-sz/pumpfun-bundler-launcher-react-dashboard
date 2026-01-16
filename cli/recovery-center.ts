import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createTransferCheckedInstruction, getAssociatedTokenAddress } from '@solana/spl-token';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import bs58 from 'bs58';
import { config } from 'dotenv';
import * as readline from 'readline';

// Load .env file
config({ path: join(__dirname, '.env') });

const RPC_URL = process.env.RPC_ENDPOINT || process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');

interface WalletInfo {
  type: string;
  name: string;
  address: string;
  privateKey: string;
  balance: number;
  balanceSol: number;
  hasTokens: boolean;
}

interface WalletTypeSummary {
  type: string;
  name: string;
  totalWallets: number;
  walletsWithFunds: number;
  totalBalance: number;
  wallets: WalletInfo[];
}

// ANSI color codes for terminal
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

function colorize(text: string, color: string): string {
  return `${color}${text}${colors.reset}`;
}

function printHeader() {
  console.log('\n' + '='.repeat(80));
  console.log(colorize('  🔐 WALLET RECOVERY CENTER 🔐', colors.bright + colors.cyan));
  console.log('='.repeat(80) + '\n');
}

function printSection(title: string) {
  console.log(colorize(`\n${'─'.repeat(78)}`, colors.dim));
  console.log(colorize(`  ${title}`, colors.bright + colors.blue));
  console.log(colorize(`${'─'.repeat(78)}\n`, colors.dim));
}

async function scanAllWallets(): Promise<WalletTypeSummary[]> {
  const summaries: WalletTypeSummary[] = [];
  const mainWalletKey = process.env.PRIVATE_KEY;
  
  if (!mainWalletKey || mainWalletKey.trim() === '') {
    throw new Error('PRIVATE_KEY not found in .env file');
  }

  const mainKp = Keypair.fromSecretKey(bs58.decode(mainWalletKey.trim()));
  const mainAddress = mainKp.publicKey.toBase58();
  
  console.log(colorize(`📍 Destination Wallet: ${mainAddress}`, colors.green));
  console.log(colorize(`🌐 RPC Endpoint: ${RPC_URL}\n`, colors.dim));

  // 1. Scan DATA wallets (bundle wallets)
  // Try multiple possible locations
  const possibleDataPaths = [
    join(__dirname, 'data', 'data.json'),
    join(process.cwd(), 'data', 'data.json'),
    join(__dirname, '..', 'keys', 'data.json'),
  ];
  
  let dataPath: string | null = null;
  for (const path of possibleDataPaths) {
    if (existsSync(path)) {
      dataPath = path;
      break;
    }
  }
  
  if (dataPath && existsSync(dataPath)) {
    try {
      const walletsData = JSON.parse(readFileSync(dataPath, 'utf8'));
      const wallets: WalletInfo[] = [];
      
      for (const privateKey of walletsData) {
        try {
          const kp = Keypair.fromSecretKey(bs58.decode(privateKey));
          const balance = await connection.getBalance(kp.publicKey);
          const balanceSol = balance / LAMPORTS_PER_SOL;
          
          if (balanceSol > 0.0001) {
            const tokenAccounts = await connection.getTokenAccountsByOwner(kp.publicKey, {
              programId: TOKEN_PROGRAM_ID,
            });
            let hasTokens = false;
            for (const { account } of tokenAccounts.value) {
              const amount = account.data.readBigUInt64LE(64);
              if (amount > BigInt(0)) {
                hasTokens = true;
                break;
              }
            }
            
            wallets.push({
              type: 'data',
              name: 'DATA Wallet',
              address: kp.publicKey.toBase58(),
              privateKey,
              balance,
              balanceSol,
              hasTokens,
            });
          }
        } catch (e) {
          // Skip invalid keys
        }
      }
      
      summaries.push({
        type: 'data',
        name: 'DATA Wallets (Bundle)',
        totalWallets: walletsData.length,
        walletsWithFunds: wallets.length,
        totalBalance: wallets.reduce((sum, w) => sum + w.balanceSol, 0),
        wallets,
      });
    } catch (e: any) {
      console.log(colorize(`⚠️  Error reading data.json: ${e.message}`, colors.yellow));
    }
  }

  // 2. Scan Intermediary wallets
  const intermediaryPath = join(__dirname, '..', 'keys', 'intermediary-wallets.json');
  if (existsSync(intermediaryPath)) {
    try {
      const data = JSON.parse(readFileSync(intermediaryPath, 'utf-8'));
      const wallets: WalletInfo[] = [];
      
      for (const [hop, hopWallets] of Object.entries(data)) {
        if (hop === 'createdAt' || hop === 'lastUsed' || !Array.isArray(hopWallets)) continue;
        
        for (const wallet of hopWallets as any[]) {
          try {
            const kp = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
            const balance = await connection.getBalance(kp.publicKey);
            const balanceSol = balance / LAMPORTS_PER_SOL;
            
            if (balanceSol > 0.0001) {
              wallets.push({
                type: 'intermediary',
                name: `${hop.toUpperCase()} Wallet`,
                address: wallet.publicKey,
                privateKey: wallet.privateKey,
                balance,
                balanceSol,
                hasTokens: false, // Intermediary wallets typically don't hold tokens
              });
            }
          } catch (e) {
            // Skip invalid keys
          }
        }
      }
      
        const totalIntermediaryWallets = Object.values(data).reduce((sum: number, arr: any) => 
          Array.isArray(arr) ? sum + arr.length : sum, 0) as number;
        
        summaries.push({
          type: 'intermediary',
          name: 'Intermediary Wallets',
          totalWallets: totalIntermediaryWallets,
          walletsWithFunds: wallets.length,
          totalBalance: wallets.reduce((sum, w) => sum + w.balanceSol, 0),
          wallets,
        });
    } catch (e: any) {
      console.log(colorize(`⚠️  Error reading intermediary-wallets.json: ${e.message}`, colors.yellow));
    }
  }

  // 3. Scan Creator wallets
  const creatorPath = join(__dirname, '..', 'keys', 'creator-wallets.json');
  if (existsSync(creatorPath)) {
    try {
      const creatorWallets = JSON.parse(readFileSync(creatorPath, 'utf-8'));
      const wallets: WalletInfo[] = [];
      
      for (const wallet of creatorWallets) {
        try {
          const kp = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
          const balance = await connection.getBalance(kp.publicKey);
          const balanceSol = balance / LAMPORTS_PER_SOL;
          
          if (balanceSol > 0.0001) {
            const tokenAccounts = await connection.getTokenAccountsByOwner(kp.publicKey, {
              programId: TOKEN_PROGRAM_ID,
            });
            let hasTokens = false;
            for (const { account } of tokenAccounts.value) {
              const amount = account.data.readBigUInt64LE(64);
              if (amount > BigInt(0)) {
                hasTokens = true;
                break;
              }
            }
            
            wallets.push({
              type: 'creator',
              name: 'Creator Wallet',
              address: wallet.publicKey,
              privateKey: wallet.privateKey,
              balance,
              balanceSol,
              hasTokens,
            });
          }
        } catch (e) {
          // Skip invalid keys
        }
      }
      
      summaries.push({
        type: 'creator',
        name: 'Creator Wallets',
        totalWallets: creatorWallets.length,
        walletsWithFunds: wallets.length,
        totalBalance: wallets.reduce((sum, w) => sum + w.balanceSol, 0),
        wallets,
      });
    } catch (e: any) {
      console.log(colorize(`⚠️  Error reading creator-wallets.json: ${e.message}`, colors.yellow));
    }
  }

  // 4. Scan Warmed wallets
  const warmedPath = join(__dirname, '..', 'keys', 'warmed-wallets.json');
  if (existsSync(warmedPath)) {
    try {
      const warmedData = JSON.parse(readFileSync(warmedPath, 'utf-8'));
      const warmedWallets = warmedData.wallets || [];
      const wallets: WalletInfo[] = [];
      
      for (const wallet of warmedWallets) {
        try {
          const kp = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
          const balance = await connection.getBalance(kp.publicKey);
          const balanceSol = balance / LAMPORTS_PER_SOL;
          
          if (balanceSol > 0.0001) {
            const tokenAccounts = await connection.getTokenAccountsByOwner(kp.publicKey, {
              programId: TOKEN_PROGRAM_ID,
            });
            let hasTokens = false;
            for (const { account } of tokenAccounts.value) {
              const amount = account.data.readBigUInt64LE(64);
              if (amount > BigInt(0)) {
                hasTokens = true;
                break;
              }
            }
            
            wallets.push({
              type: 'warmed',
              name: 'Warmed Wallet',
              address: wallet.publicKey || kp.publicKey.toBase58(),
              privateKey: wallet.privateKey,
              balance,
              balanceSol,
              hasTokens,
            });
          }
        } catch (e) {
          // Skip invalid keys
        }
      }
      
      summaries.push({
        type: 'warmed',
        name: 'Warmed Wallets',
        totalWallets: warmedWallets.length,
        walletsWithFunds: wallets.length,
        totalBalance: wallets.reduce((sum, w) => sum + w.balanceSol, 0),
        wallets,
      });
    } catch (e: any) {
      console.log(colorize(`⚠️  Error reading warmed-wallets.json: ${e.message}`, colors.yellow));
    }
  }

  // 5. Scan Current-run wallets
  const currentRunPath = join(__dirname, '..', 'keys', 'current-run.json');
  if (existsSync(currentRunPath)) {
    try {
      const currentRunData = JSON.parse(readFileSync(currentRunPath, 'utf-8'));
      const wallets: WalletInfo[] = [];
      
      // Creator/Dev wallet
      if (currentRunData.creatorDevWalletKey) {
        try {
          const kp = Keypair.fromSecretKey(bs58.decode(currentRunData.creatorDevWalletKey));
          const balance = await connection.getBalance(kp.publicKey);
          const balanceSol = balance / LAMPORTS_PER_SOL;
          
          if (balanceSol > 0.0001) {
            wallets.push({
              type: 'current-run-creator',
              name: 'Current Run Creator/Dev',
              address: kp.publicKey.toBase58(),
              privateKey: currentRunData.creatorDevWalletKey,
              balance,
              balanceSol,
              hasTokens: false,
            });
          }
        } catch (e) {
          // Skip invalid
        }
      }
      
      // Bundle wallets
      const bundleKeys = currentRunData.bundleWalletKeys || currentRunData.walletKeys || [];
      for (const privateKey of bundleKeys) {
        try {
          const kp = Keypair.fromSecretKey(bs58.decode(privateKey));
          const balance = await connection.getBalance(kp.publicKey);
          const balanceSol = balance / LAMPORTS_PER_SOL;
          
          if (balanceSol > 0.0001) {
            wallets.push({
              type: 'current-run-bundle',
              name: 'Current Run Bundle',
              address: kp.publicKey.toBase58(),
              privateKey,
              balance,
              balanceSol,
              hasTokens: false,
            });
          }
        } catch (e) {
          // Skip invalid
        }
      }
      
      // Holder wallets
      const holderKeys = currentRunData.holderWalletKeys || [];
      for (const privateKey of holderKeys) {
        try {
          const kp = Keypair.fromSecretKey(bs58.decode(privateKey));
          const balance = await connection.getBalance(kp.publicKey);
          const balanceSol = balance / LAMPORTS_PER_SOL;
          
          if (balanceSol > 0.0001) {
            wallets.push({
              type: 'current-run-holder',
              name: 'Current Run Holder',
              address: kp.publicKey.toBase58(),
              privateKey,
              balance,
              balanceSol,
              hasTokens: false,
            });
          }
        } catch (e) {
          // Skip invalid
        }
      }
      
      if (wallets.length > 0) {
        summaries.push({
          type: 'current-run',
          name: 'Current Run Wallets',
          totalWallets: (currentRunData.creatorDevWalletKey ? 1 : 0) + bundleKeys.length + holderKeys.length,
          walletsWithFunds: wallets.length,
          totalBalance: wallets.reduce((sum, w) => sum + w.balanceSol, 0),
          wallets,
        });
      }
    } catch (e: any) {
      console.log(colorize(`⚠️  Error reading current-run.json: ${e.message}`, colors.yellow));
    }
  }

  return summaries;
}

function displaySummary(summaries: WalletTypeSummary[]) {
  printSection('📊 WALLET SCAN SUMMARY');
  
  let totalWallets = 0;
  let totalWithFunds = 0;
  let totalBalance = 0;
  
  summaries.forEach((summary, index) => {
    totalWallets += summary.totalWallets;
    totalWithFunds += summary.walletsWithFunds;
    totalBalance += summary.totalBalance;
    
    const statusColor = summary.walletsWithFunds > 0 ? colors.green : colors.dim;
    const balanceColor = summary.totalBalance > 0 ? colors.yellow : colors.dim;
    
    console.log(colorize(`${index + 1}. ${summary.name}`, colors.bright));
    console.log(`   Total Wallets: ${summary.totalWallets}`);
    console.log(colorize(`   Wallets with Funds: ${summary.walletsWithFunds}`, statusColor));
    console.log(colorize(`   Total Balance: ${summary.totalBalance.toFixed(6)} SOL`, balanceColor));
    console.log();
  });
  
  console.log(colorize('─'.repeat(78), colors.dim));
  console.log(colorize('TOTAL', colors.bright + colors.cyan));
  console.log(`   Total Wallets Scanned: ${totalWallets}`);
  console.log(colorize(`   Wallets with Funds: ${totalWithFunds}`, colors.green));
  console.log(colorize(`   Total Recoverable: ${totalBalance.toFixed(6)} SOL`, colors.yellow + colors.bright));
  console.log();
}

async function recoverWallets(wallets: WalletInfo[], typeName: string): Promise<{ success: number; failed: number; totalRecovered: number }> {
  const mainWalletKey = process.env.PRIVATE_KEY;
  if (!mainWalletKey || mainWalletKey.trim() === '') {
    throw new Error('PRIVATE_KEY not found in .env file');
  }
  
  const mainKp = Keypair.fromSecretKey(bs58.decode(mainWalletKey.trim()));
  const rentExemption = 890_880;
  let success = 0;
  let failed = 0;
  let totalRecovered = 0;
  
  printSection(`🔄 RECOVERING ${typeName.toUpperCase()}`);
  
  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    try {
      const kp = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
      const address = wallet.address;
      
      console.log(colorize(`[${i + 1}/${wallets.length}] Processing: ${address.slice(0, 8)}...${address.slice(-6)}`, colors.cyan));
      
      // Transfer tokens first if any
      if (wallet.hasTokens) {
        try {
          const tokenAccounts = await connection.getTokenAccountsByOwner(kp.publicKey, {
            programId: TOKEN_PROGRAM_ID,
          });
          
          for (const { pubkey, account } of tokenAccounts.value) {
            try {
              const accountInfo = account.data;
              const mint = new PublicKey(accountInfo.slice(0, 32));
              const amount = accountInfo.readBigUInt64LE(64);
              
              if (amount > BigInt(0)) {
                const tokenBalance = await connection.getTokenAccountBalance(pubkey);
                const mainTokenAccount = await getAssociatedTokenAddress(mint, mainKp.publicKey);
                const latestBlockhash = await connection.getLatestBlockhash();
                
                const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
                  mainKp.publicKey,
                  mainTokenAccount,
                  mainKp.publicKey,
                  mint
                );
                
                const transferIx = createTransferCheckedInstruction(
                  pubkey,
                  mint,
                  mainTokenAccount,
                  kp.publicKey,
                  BigInt(tokenBalance.value.amount),
                  tokenBalance.value.decimals
                );
                
                const closeIx = createCloseAccountInstruction(
                  pubkey,
                  mainKp.publicKey,
                  kp.publicKey
                );
                
                const msg = new TransactionMessage({
                  payerKey: kp.publicKey,
                  recentBlockhash: latestBlockhash.blockhash,
                  instructions: [createAtaIx, transferIx, closeIx]
                }).compileToV0Message();
                
                const tx = new VersionedTransaction(msg);
                tx.sign([kp, mainKp]);
                
                const sig = await connection.sendTransaction(tx, { skipPreflight: false, maxRetries: 3 });
                await connection.confirmTransaction(sig, 'confirmed');
                
                console.log(colorize(`   ✅ Transferred tokens: https://solscan.io/tx/${sig}`, colors.green));
              }
            } catch (e: any) {
              console.log(colorize(`   ⚠️  Token transfer error: ${e.message}`, colors.yellow));
            }
          }
        } catch (e: any) {
          console.log(colorize(`   ⚠️  Error checking tokens: ${e.message}`, colors.yellow));
        }
      }
      
      // Transfer SOL
      const balance = await connection.getBalance(kp.publicKey);
      const transferAmount = balance - rentExemption - 5000;
      
      if (transferAmount > 0) {
        const latestBlockhash = await connection.getLatestBlockhash();
        const transferIx = SystemProgram.transfer({
          fromPubkey: kp.publicKey,
          toPubkey: mainKp.publicKey,
          lamports: transferAmount
        });
        
        const msg = new TransactionMessage({
          payerKey: kp.publicKey,
          recentBlockhash: latestBlockhash.blockhash,
          instructions: [transferIx]
        }).compileToV0Message();
        
        const tx = new VersionedTransaction(msg);
        tx.sign([kp]);
        
        const sig = await connection.sendTransaction(tx, { skipPreflight: false, maxRetries: 3 });
        await connection.confirmTransaction(sig, 'confirmed');
        
        const recoveredSol = transferAmount / LAMPORTS_PER_SOL;
        totalRecovered += recoveredSol;
        success++;
        
        console.log(colorize(`   ✅ Recovered ${recoveredSol.toFixed(6)} SOL: https://solscan.io/tx/${sig}`, colors.green));
      } else {
        console.log(colorize(`   ℹ️  No recoverable SOL (only rent exemption)`, colors.dim));
        success++;
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error: any) {
      failed++;
      console.log(colorize(`   ❌ Error: ${error.message}`, colors.red));
    }
  }
  
  return { success, failed, totalRecovered };
}

async function main() {
  printHeader();
  
  try {
    // Scan all wallets
    console.log(colorize('🔍 Scanning all wallet types...', colors.cyan));
    const summaries = await scanAllWallets();
    
    if (summaries.length === 0) {
      console.log(colorize('\n⚠️  No wallet files found. Make sure you have wallet JSON files in the keys/ directory.', colors.yellow));
      return;
    }
    
    // Display summary
    displaySummary(summaries);
    
    // Filter summaries with funds
    const summariesWithFunds = summaries.filter(s => s.walletsWithFunds > 0);
    
    if (summariesWithFunds.length === 0) {
      console.log(colorize('✅ No wallets with recoverable funds found!', colors.green));
      return;
    }
    
    // Ask user what to recover
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const question = (query: string): Promise<string> => {
      return new Promise((resolve) => {
        rl.question(query, resolve);
      });
    };
    
    console.log(colorize('📋 RECOVERY OPTIONS:', colors.bright + colors.cyan));
    console.log('   1. Recover ALL wallets');
    summariesWithFunds.forEach((summary, index) => {
      console.log(`   ${index + 2}. Recover ${summary.name} (${summary.walletsWithFunds} wallets, ${summary.totalBalance.toFixed(6)} SOL)`);
    });
    console.log(`   ${summariesWithFunds.length + 2}. Exit\n`);
    
    const answer = await question(colorize('Select option: ', colors.bright));
    const choice = parseInt(answer.trim());
    
    if (choice === 1) {
      // Recover all
      let totalSuccess = 0;
      let totalFailed = 0;
      let grandTotalRecovered = 0;
      
      for (const summary of summariesWithFunds) {
        const result = await recoverWallets(summary.wallets, summary.name);
        totalSuccess += result.success;
        totalFailed += result.failed;
        grandTotalRecovered += result.totalRecovered;
      }
      
      printSection('📊 FINAL SUMMARY');
      console.log(colorize(`✅ Successful: ${totalSuccess}`, colors.green));
      console.log(colorize(`❌ Failed: ${totalFailed}`, colors.red));
      console.log(colorize(`💰 Total Recovered: ${grandTotalRecovered.toFixed(6)} SOL`, colors.yellow + colors.bright));
    } else if (choice >= 2 && choice <= summariesWithFunds.length + 1) {
      // Recover specific type
      const selectedSummary = summariesWithFunds[choice - 2];
      const result = await recoverWallets(selectedSummary.wallets, selectedSummary.name);
      
      printSection('📊 RECOVERY SUMMARY');
      console.log(colorize(`✅ Successful: ${result.success}`, colors.green));
      console.log(colorize(`❌ Failed: ${result.failed}`, colors.red));
      console.log(colorize(`💰 Total Recovered: ${result.totalRecovered.toFixed(6)} SOL`, colors.yellow + colors.bright));
    } else {
      console.log(colorize('\n👋 Exiting...', colors.cyan));
    }
    
    rl.close();
  } catch (error: any) {
    console.error(colorize(`\n❌ Error: ${error.message}`, colors.red));
    process.exit(1);
  }
}

main().catch(console.error);
