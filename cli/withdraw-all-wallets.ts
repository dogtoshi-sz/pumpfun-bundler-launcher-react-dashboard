import { Connection, Keypair, SystemProgram, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, PublicKey, TransactionInstruction } from "@solana/web3.js";
import * as fs from 'fs';
import * as path from 'path';
import base58 from 'bs58';
import dotenv from 'dotenv';
import { retrieveEnvVariable } from '../utils';
import { TOKEN_PROGRAM_ID, createCloseAccountInstruction } from "@solana/spl-token";

// Load .env
dotenv.config();

// Check for --preview or --dry-run flag
const PREVIEW_MODE = process.argv.includes('--preview') || process.argv.includes('--dry-run');

const RPC_ENDPOINT = retrieveEnvVariable('RPC_ENDPOINT', process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com', false);
const PRIVATE_KEY = retrieveEnvVariable('PRIVATE_KEY', '', true);

// Load all wallets from file
const loadAllWallets = (): Keypair[] => {
  try {
    const keysPath = path.join(process.cwd(), 'keys', 'all-private-keys.txt');
    if (!fs.existsSync(keysPath)) {
      console.error('❌ all-private-keys.txt not found!');
      return [];
    }
    
    const content = fs.readFileSync(keysPath, 'utf8');
    const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    const wallets: Keypair[] = [];
    for (let i = 0; i < lines.length; i++) {
      const key = lines[i];
      try {
        wallets.push(Keypair.fromSecretKey(base58.decode(key)));
      } catch (e: any) {
        console.log(`⚠️  Skipping invalid key at line ${i + 1}: ${e.message}`);
      }
    }
    
    return wallets;
  } catch (e: any) {
    console.error('Error loading wallets:', e.message);
    return [];
  }
};

// Execute transaction
const execute = async (tx: VersionedTransaction, blockhash: any, retries: number = 3): Promise<string | null> => {
  const connection = new Connection(RPC_ENDPOINT, 'confirmed');
  for (let i = 0; i < retries; i++) {
    try {
      const signature = await connection.sendTransaction(tx, { skipPreflight: false, maxRetries: 3 });
      await connection.confirmTransaction(signature, 'confirmed');
      return signature;
    } catch (error: any) {
      if (i === retries - 1) {
        console.error(`   Transaction failed after ${retries} retries: ${error.message}`);
        return null;
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  return null;
};

async function withdrawFromAllWallets() {
  try {
    if (PREVIEW_MODE) {
      console.log('🔍 PREVIEW MODE - No transactions will be executed\n');
      console.log('='.repeat(60));
    }
    
    console.log('🔍 Loading wallets from all-private-keys.txt...');
    const allWallets = loadAllWallets();
    
    if (allWallets.length === 0) {
      console.log('❌ No wallets found in all-private-keys.txt');
      return;
    }
    
    // Load main wallet
    const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY));
    const mainWalletPubkey = mainKp.publicKey.toBase58();
    console.log(`💰 Main wallet: ${mainWalletPubkey}`);
    
    // SAFETY CHECK: Exclude main wallet from processing
    const wallets = allWallets.filter(w => !w.publicKey.equals(mainKp.publicKey));
    const excludedCount = allWallets.length - wallets.length;
    
    if (excludedCount > 0) {
      console.log(`🛡️  SAFETY: Excluded ${excludedCount} wallet(s) that match main wallet (PRIVATE_KEY)`);
    }
    
    if (wallets.length === 0) {
      console.log('❌ No wallets to process (all wallets match main wallet)');
      return;
    }
    
    console.log(`✅ Found ${wallets.length} wallet(s) to process\n`);
    
    const connection = new Connection(RPC_ENDPOINT, 'confirmed');
    
    // Get main wallet balance
    const mainBalance = await connection.getBalance(mainKp.publicKey);
    console.log(`📊 Main wallet balance: ${(mainBalance / 1e9).toFixed(6)} SOL\n`);
    
    // Get minimum balance for rent exemption
    const rentExemptMin = await connection.getMinimumBalanceForRentExemption(0);
    const feeBuffer = 10_000;
    const minBalanceToKeep = rentExemptMin + feeBuffer;
    
    console.log(`📋 Minimum balance to keep per wallet: ${(minBalanceToKeep / 1e9).toFixed(6)} SOL`);
    console.log(`   (Rent exemption: ${(rentExemptMin / 1e9).toFixed(6)} SOL + Fee buffer: ${(feeBuffer / 1e9).toFixed(6)} SOL)\n`);
    
    let totalRecovered = 0;
    let totalRentReclaimed = 0;
    let totalTokenAccountsClosed = 0;
    let totalNativeSOL = 0;
    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    
    if (PREVIEW_MODE) {
      console.log('📊 Scanning wallets for claimable rent and native SOL...\n');
    } else {
      console.log('🚀 Starting withdrawal process (parallel batches)...\n');
    }
    console.log('='.repeat(60));
    
    // Process wallet in parallel batches
    const BATCH_SIZE = 20;
    const batches: Keypair[][] = [];
    for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
      batches.push(wallets.slice(i, i + BATCH_SIZE));
    }
    
    // Process each batch
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`\n📦 Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} wallets)...`);
      
      const batchResults = await Promise.allSettled(
        batch.map(async (wallet, batchPos) => {
          const globalIndex = batchIndex * BATCH_SIZE + batchPos + 1;
          const walletPubkey = wallet.publicKey.toBase58();
          
          try {
            let balance = await connection.getBalance(wallet.publicKey);
            
            let tokenAccountsClosed = 0;
            let estimatedRentReclaimed = 0;
            
            try {
              if (wallet.publicKey.equals(mainKp.publicKey)) {
                console.log(`⚠️  SKIPPED: Wallet ${walletPubkey.slice(0, 8)}...${walletPubkey.slice(-8)} is the main wallet - never processed`);
                return { 
                  type: 'skipped' as const, 
                  index: globalIndex, 
                  pubkey: walletPubkey, 
                  balance: 0,
                  tokenAccountsClosed: 0,
                  rentReclaimed: 0
                };
              }
              
              const tokenAccounts = await connection.getTokenAccountsByOwner(wallet.publicKey, {
                programId: TOKEN_PROGRAM_ID,
              }, 'confirmed');
              
              if (tokenAccounts.value.length > 0) {
                const closeInstructions: TransactionInstruction[] = [];
                
                for (const { pubkey, account } of tokenAccounts.value) {
                  try {
                    if (pubkey.equals(mainKp.publicKey)) {
                      continue;
                    }
                    
                    const accountData = account.data;
                    if (accountData.length >= 64) {
                      const tokenBalance = accountData.readBigUInt64LE(64);
                      
                      if (tokenBalance === 0n) {
                        closeInstructions.push(
                          createCloseAccountInstruction(
                            pubkey,
                            mainKp.publicKey,
                            wallet.publicKey
                          )
                        );
                        tokenAccountsClosed++;
                        estimatedRentReclaimed += 0.00203928 * 1e9;
                      }
                    }
                  } catch (e) {
                    // Skip if we can't parse
                  }
                }
                
                if (closeInstructions.length > 0) {
                  if (PREVIEW_MODE) {
                    // Preview mode - just count
                  } else {
                    const estimatedCloseTxFee = 10_000;
                    const requiredBalance = minBalanceToKeep + estimatedCloseTxFee;
                    
                    if (balance < requiredBalance) {
                      tokenAccountsClosed = 0;
                      estimatedRentReclaimed = 0;
                    } else {
                      const blockhash = await connection.getLatestBlockhash('confirmed');
                      const closeTx = new TransactionMessage({
                        payerKey: wallet.publicKey,
                        recentBlockhash: blockhash.blockhash,
                        instructions: [
                          ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
                          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
                          ...closeInstructions
                        ]
                      }).compileToV0Message();
                      
                      const closeV0 = new VersionedTransaction(closeTx);
                      closeV0.sign([wallet]);
                      
                      const closeSignature = await execute(closeV0, blockhash, 3);
                      if (!closeSignature) {
                        tokenAccountsClosed = 0;
                        estimatedRentReclaimed = 0;
                      }
                    }
                  }
                }
              }
            } catch (tokenError: any) {
              // Continue even if token account closing fails
            }
            
            const availableBalance = balance > minBalanceToKeep ? balance - minBalanceToKeep : 0;
            
            if (PREVIEW_MODE) {
              return {
                type: availableBalance > 0 ? 'preview' as const : 'skipped' as const,
                index: globalIndex,
                pubkey: walletPubkey,
                balance,
                availableBalance,
                tokenAccountsClosed,
                rentReclaimed: estimatedRentReclaimed
              };
            }
            
            if (availableBalance <= 0) {
              return { 
                type: 'skipped' as const, 
                index: globalIndex, 
                pubkey: walletPubkey, 
                balance,
                tokenAccountsClosed,
                rentReclaimed: estimatedRentReclaimed
              };
            }
            
            const blockhash = await connection.getLatestBlockhash('confirmed');
            const withdrawTx = new TransactionMessage({
              payerKey: wallet.publicKey,
              recentBlockhash: blockhash.blockhash,
              instructions: [
                ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
                ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
                SystemProgram.transfer({
                  fromPubkey: wallet.publicKey,
                  toPubkey: mainKp.publicKey,
                  lamports: availableBalance
                })
              ]
            }).compileToV0Message();
            
            const withdrawV0 = new VersionedTransaction(withdrawTx);
            withdrawV0.sign([wallet]);
            
            const signature = await execute(withdrawV0, blockhash, 3);
            
            if (signature) {
              return { 
                type: 'success' as const, 
                index: globalIndex, 
                pubkey: walletPubkey, 
                balance, 
                availableBalance, 
                signature,
                tokenAccountsClosed,
                rentReclaimed: estimatedRentReclaimed
              };
            } else {
              return { 
                type: 'failed' as const, 
                index: globalIndex, 
                pubkey: walletPubkey, 
                balance,
                tokenAccountsClosed,
                rentReclaimed: estimatedRentReclaimed
              };
            }
          } catch (error: any) {
            return { type: 'error' as const, index: globalIndex, pubkey: walletPubkey, error: error.message };
          }
        })
      );
      
      // Process results
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          const data = result.value;
          
          if (data.type === 'skipped') {
            const balance = data.balance;
            const shortfall = minBalanceToKeep - balance;
            let msg = `⏭️  Wallet ${data.index}/${wallets.length} (${data.pubkey.slice(0, 8)}...${data.pubkey.slice(-8)}): No recoverable SOL`;
            if (data.tokenAccountsClosed > 0) {
              msg += ` | ${data.tokenAccountsClosed} empty token account(s) → ${(data.rentReclaimed / 1e9).toFixed(6)} SOL rent claimable`;
              totalRentReclaimed += data.rentReclaimed;
              totalTokenAccountsClosed += data.tokenAccountsClosed;
            }
            if (shortfall > 0) {
              msg += ` (balance: ${(balance / 1e9).toFixed(6)} SOL, need ${(minBalanceToKeep / 1e9).toFixed(6)} SOL to keep)`;
            } else {
              msg += ` (balance: ${(balance / 1e9).toFixed(6)} SOL, exactly at minimum)`;
            }
            console.log(msg);
            skippedCount++;
          } else if (data.type === 'preview') {
            let msg = `📊 Wallet ${data.index}/${wallets.length} (${data.pubkey.slice(0, 8)}...${data.pubkey.slice(-8)}):`;
            if (data.tokenAccountsClosed > 0) {
              msg += ` ${data.tokenAccountsClosed} empty token account(s) → ${(data.rentReclaimed / 1e9).toFixed(6)} SOL rent`;
              totalRentReclaimed += data.rentReclaimed;
              totalTokenAccountsClosed += data.tokenAccountsClosed;
            }
            if (data.availableBalance > 0) {
              msg += ` | ${(data.availableBalance / 1e9).toFixed(6)} SOL native (withdrawable)`;
              totalNativeSOL += data.availableBalance;
            }
            console.log(msg);
            successCount++;
          } else if (data.type === 'success') {
            let msg = `✅ Wallet ${data.index}/${wallets.length} (${data.pubkey.slice(0, 8)}...${data.pubkey.slice(-8)}): Withdrew ${(data.availableBalance / 1e9).toFixed(6)} SOL`;
            if (data.tokenAccountsClosed > 0) {
              msg += ` | Closed ${data.tokenAccountsClosed} empty token account(s), reclaimed ${(data.rentReclaimed / 1e9).toFixed(6)} SOL rent`;
              totalRentReclaimed += data.rentReclaimed;
              totalTokenAccountsClosed += data.tokenAccountsClosed;
            }
            console.log(msg);
            console.log(`   🔗 https://solscan.io/tx/${data.signature}`);
            totalRecovered += data.availableBalance;
            successCount++;
          } else if (data.type === 'failed') {
            console.log(`❌ Wallet ${data.index}/${wallets.length} (${data.pubkey.slice(0, 8)}...${data.pubkey.slice(-8)}): Failed to withdraw`);
            failedCount++;
          } else if (data.type === 'error') {
            console.log(`❌ Wallet ${data.index}/${wallets.length} (${data.pubkey.slice(0, 8)}...${data.pubkey.slice(-8)}): Error - ${data.error}`);
            failedCount++;
          }
        } else {
          console.log(`❌ Batch item failed: ${result.reason}`);
          failedCount++;
        }
      }
      
      if (batchIndex < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    if (PREVIEW_MODE) {
      console.log('📊 PREVIEW SUMMARY (No transactions executed)');
    } else {
      console.log('📊 WITHDRAWAL SUMMARY');
    }
    console.log('='.repeat(60));
    
    if (PREVIEW_MODE) {
      console.log(`📊 Wallets with recoverable assets: ${successCount} wallet(s)`);
      console.log(`⏭️  Wallets with no recoverable assets: ${skippedCount} wallet(s)`);
      console.log(`❌ Errors: ${failedCount} wallet(s)`);
      console.log(`\n💰 CLAIMABLE ASSETS:`);
      console.log(`   🏦 Rent from empty token accounts: ${(totalRentReclaimed / 1e9).toFixed(6)} SOL`);
      console.log(`   💵 Native SOL (withdrawable): ${(totalNativeSOL / 1e9).toFixed(6)} SOL`);
      console.log(`   🗑️  Empty token accounts to close: ${totalTokenAccountsClosed}`);
      console.log(`\n💵 TOTAL CLAIMABLE: ${((totalNativeSOL + totalRentReclaimed) / 1e9).toFixed(6)} SOL`);
      console.log(`\n💡 Run without --preview flag to execute the withdrawal`);
    } else {
      console.log(`✅ Successfully withdrawn: ${successCount} wallet(s)`);
      console.log(`⏭️  Skipped (no recoverable SOL): ${skippedCount} wallet(s)`);
      console.log(`❌ Failed: ${failedCount} wallet(s)`);
      console.log(`💰 Total native SOL recovered: ${(totalRecovered / 1e9).toFixed(6)} SOL`);
      console.log(`🏦 Total rent reclaimed from token accounts: ${(totalRentReclaimed / 1e9).toFixed(6)} SOL`);
      console.log(`🗑️  Total empty token accounts closed: ${totalTokenAccountsClosed}`);
      console.log(`💵 TOTAL RECOVERED (native + rent): ${((totalRecovered + totalRentReclaimed) / 1e9).toFixed(6)} SOL`);
      
      const finalBalance = await connection.getBalance(mainKp.publicKey);
      console.log(`\n💰 Main wallet balance after withdrawal: ${(finalBalance / 1e9).toFixed(6)} SOL`);
      console.log(`📈 Balance increase: ${((finalBalance - mainBalance) / 1e9).toFixed(6)} SOL`);
    }
    
  } catch (error: any) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

// Run the withdrawal
withdrawFromAllWallets()
  .then(() => {
    console.log('\n✅ Withdrawal complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
